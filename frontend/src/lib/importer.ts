import yaml from "js-yaml";
import { selectedSpecies } from "$stores/speciesStore";
import { convertFromDarwinCore } from "$lib/dwcMapper";
import { ambiguousStore, unresolvedStore } from "$stores/importState";
import { get } from "svelte/store";

export async function importYAMLText(yamlText: string): Promise<string | null> {
  try {
    const parsed = yaml.load(yamlText);

    let list: any[] = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === "object") {
      if ("checklist" in parsed && Array.isArray(parsed["checklist"])) {
        list = parsed["checklist"];
      } else if (
        "checklister-ng" in parsed &&
        Array.isArray(parsed["checklister-ng"]?.checklist)
      ) {
        list = parsed["checklister-ng"]["checklist"];
      }

      if (list.length > 0) {
        const restored = list.map(convertFromDarwinCore);
        const existing = get(selectedSpecies);

        if (existing.length > 0) {
          const shouldMerge = confirm("目前已有名錄資料，是否要合併匯入的資料？\n✅ 確定合併\n❌ 取消取代");
          if (shouldMerge) {
            const existingIds = new Set(existing.map((d) => d.id));
            const merged = [...existing];
            for (const item of restored) {
              if (!existingIds.has(item.id)) {
                merged.push(item);
              }
            }
            selectedSpecies.set(merged);
          } else {
            selectedSpecies.set(restored);
          }
        } else {
          selectedSpecies.set(restored);
        }

        return null;
      } else {
        return "⚠️ YAML 檔案缺少 checklist 陣列";
      }
    }

    // fallback: 以文字俗名逐筆查詢
    const lines = yamlText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.some((line) => line.includes(":"))) {
      return "⚠️ YAML 檔案格式錯誤，請確認是否為 checklist 陣列格式或俗名清單";
    }

    const normalizedNames = lines.map(name => name.replace(/^台/g, "臺"));

    const res = await fetch("/api/resolve_name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: normalizedNames })
    });

    const resolved: any[] = [];
    const ambiguous: Record<string, any[]> = {};
    const unresolved: string[] = [];

    if (res.ok) {
      const result = await res.json();
      for (const name of normalizedNames) {
        const matches = result[name] || [];
        if (matches.length === 1) {
          resolved.push(matches[0]);
        } else if (matches.length > 1) {
          ambiguous[name] = matches;
        } else {
          unresolved.push(name);
        }
      }
    } else {
      return "❌ 後端名稱解析失敗";
    }

    const existing = get(selectedSpecies);
    const existingIds = new Set(existing.map((d) => d.id));
    const merged = [...existing, ...resolved.filter((d) => !existingIds.has(d.id))];
    selectedSpecies.set(merged);

    ambiguousStore.set(ambiguous);
    unresolvedStore.set(unresolved);

    if (Object.keys(ambiguous).length > 0 || unresolved.length > 0) {
      console.warn("未完全解析：", { ambiguous, unresolved });
      return "⚠️ 有些俗名無法唯一對應，請手動選擇或確認。";
    }

    return null;
  } catch (e: any) {
    console.error(e);
    return "❌ 匯入失敗：" + e.message;
  }
}
