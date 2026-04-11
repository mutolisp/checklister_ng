import yaml from "js-yaml";
import { selectedSpecies, type ChecklistItem } from "$stores/speciesStore";
import { convertFromDarwinCore } from "$lib/dwcMapper";
import { ambiguousStore, unresolvedStore } from "$stores/importState";
import { migrationStore } from "$stores/importState";
import { projectMetadata } from "$stores/metadataStore";
import { get } from "svelte/store";

/**
 * 解析 YAML 檔案，回傳結構化資料（不寫入 store，供比較功能使用）
 */
export function parseChecklistYAML(text: string): { species: any[]; metadata: any } {
  const parsed: any = yaml.load(text);
  let list: any[] = [];
  const metadata: any = {};

  // 取得資料根（可能在頂層或 checklister-ng 底下）
  let root = parsed;
  if (parsed && typeof parsed === "object" && "checklister-ng" in parsed) {
    root = parsed["checklister-ng"];
  }

  if (Array.isArray(root)) {
    list = root;
  } else if (root && typeof root === "object") {
    if ("checklist" in root && Array.isArray(root["checklist"])) {
      list = root["checklist"];
    }
    if (root["project"]) metadata.project = root["project"];
    if (root["site"]) metadata.site = root["site"];
    if (root["footprintWKT"]) metadata.footprintWKT = root["footprintWKT"];
  }

  const species = list.map(convertFromDarwinCore);
  return { species, metadata };
}

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

      // 讀取地圖/計畫 metadata
      if (parsed["footprintWKT"] || parsed["project"] || parsed["site"]) {
        projectMetadata.update(m => ({
          ...m,
          projectName: parsed["project"] || m.projectName,
          siteName: parsed["site"] || m.siteName,
          footprintWKT: parsed["footprintWKT"] || m.footprintWKT,
        }));
      }

      if (list.length > 0) {
        const restored = list.map(convertFromDarwinCore) as ChecklistItem[];

        // 偵測舊版資料（有 _legacy_id 或缺少 taxon_id）
        const needsMigration = restored.filter((d: any) => d._legacy_id || !d.taxon_id);
        const readyItems = restored.filter(d => d.taxon_id && !d._legacy_id);

        if (needsMigration.length > 0) {
          // 用學名批次查詢 API 取得新的 taxon_id
          const migrated = await migrateLegacyItems(needsMigration);
          readyItems.push(...migrated.resolved);
          // migrated.ambiguous 交給 migrationStore 讓使用者選擇
        }

        const existing = get(selectedSpecies);
        if (existing.length > 0) {
          const shouldMerge = confirm("目前已有名錄資料，是否要合併匯入的資料？\n✅ 確定合併\n❌ 取消取代");
          if (shouldMerge) {
            const existingIds = new Set(existing.map(d => d.taxon_id));
            const merged = [...existing];
            for (const item of readyItems) {
              if (!existingIds.has(item.taxon_id)) {
                merged.push(item);
              }
            }
            selectedSpecies.set(merged);
          } else {
            selectedSpecies.set(readyItems);
          }
        } else {
          selectedSpecies.set(readyItems);
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
    const existingIds = new Set(existing.map(d => d.taxon_id));
    const merged: ChecklistItem[] = [...existing, ...resolved.filter(d => !existingIds.has(d.taxon_id))];
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

/**
 * 舊版 YAML 遷移：用學名查 API，精確匹配自動更新，多筆交給使用者選
 */
async function migrateLegacyItems(items: any[]): Promise<{ resolved: any[]; }> {
  const resolved: any[] = [];
  const pending: Record<string, { original: any; candidates: any[] }> = {};

  for (const item of items) {
    const searchName = item.name || item.fullname || '';
    if (!searchName) {
      // 無學名可查，保留原資料
      resolved.push(item);
      continue;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchName)}`);
      if (!res.ok) {
        resolved.push(item);
        continue;
      }
      const results: any[] = await res.json();

      // 精確比對：學名完全一致且只有一筆
      const exactMatches = results.filter(
        (r: any) => r.name === searchName || r.fullname === item.fullname
      );

      if (exactMatches.length === 1) {
        // 自動遷移：保留舊資料的 abundance 等使用者欄位，更新 API 資料
        const migrated = { ...exactMatches[0], abundance: item.abundance || 0 };
        delete migrated._legacy_id;
        resolved.push(migrated);
      } else if (exactMatches.length > 1) {
        // 多筆精確匹配 → 使用者選擇
        const label = item.cname ? `${item.cname} ${searchName}` : searchName;
        pending[label] = { original: item, candidates: exactMatches };
      } else if (results.length === 1) {
        // 只有一筆結果
        const migrated = { ...results[0], abundance: item.abundance || 0 };
        delete migrated._legacy_id;
        resolved.push(migrated);
      } else if (results.length > 1) {
        // 多筆模糊結果 → 使用者選擇
        const label = item.cname ? `${item.cname} ${searchName}` : searchName;
        pending[label] = { original: item, candidates: results };
      } else {
        // 無結果，保留原資料
        resolved.push(item);
      }
    } catch {
      resolved.push(item);
    }
  }

  if (Object.keys(pending).length > 0) {
    migrationStore.set(pending);
  }

  return { resolved };
}
