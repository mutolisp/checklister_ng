// src/lib/importer.ts

// import yaml from 'js-yaml';
// import { convertFromDarwinCore } from '$lib/dwcMapper';
// import { selectedSpecies } from '$stores/speciesStore';
// 
// export async function importYAMLFile(file: File): Promise<string | null> {
//   try {
//     const text = await file.text();
//     const data = yaml.load(text);
// 
//     if (!data || typeof data !== 'object' || !Array.isArray(data['checklist'])) {
//       return "YAML 檔案格式錯誤，應包含 checklist 陣列";
//     }
// 
//     const rawList = data['checklist'].map(convertFromDarwinCore);
// 
//     selectedSpecies.update(current => {
//       const existingIds = new Set(current.map(d => d.taxonID));
//       const merged = [...current];
// 
//       for (const item of rawList) {
//         if (!existingIds.has(item.taxonID)) {
//           merged.push(item);
//         }
//       }
// 
//       return merged;
//     });
// 
//     return null; // 匯入成功
//   } catch (e: any) {
//     return `匯入失敗：${e.message}`;
//   }
// }
// 

import yaml from "js-yaml";
import { selectedSpecies } from "$stores/speciesStore";
import { convertFromDarwinCore } from "$lib/dwcMapper";
import { ambiguousStore, unresolvedStore } from "$stores/importState";
import { distance } from "fastest-levenshtein";

export async function importYAMLText(yamlText: string): Promise<string | null> {
  try {
    const parsed = yaml.load(yamlText);

    // ✅ case 1: checklist or checklister-ng.checklist exists
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

      // 若有 checklist，展開後直接匯入
      if (list.length > 0) {
        const restored = list.map(convertFromDarwinCore);
        selectedSpecies.update((current) => {
          const ids = new Set(current.map((d) => d.taxonID));
          return [...current, ...restored.filter((d) => !ids.has(d.taxonID))];
        });
        return null;
      } else {
        return "⚠️ YAML 檔案缺少 checklist 陣列";
      }
    }

    // ✅ fallback: treat as plain-text list of vernacular names
    const lines = yamlText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.some((line) => line.includes(":"))) {
      return "⚠️ YAML 檔案格式錯誤，請確認是否為 checklist 陣列格式或俗名清單";
    }

    const resolved: any[] = [];
    const ambiguous: Record<string, any[]> = {};
    const unresolved: string[] = [];

    for (const name of lines) {
      const normalized = name.replace(/^台/g, "臺");
      const res = await fetch(`/api/resolve_name?q=${encodeURIComponent(normalized)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          if (data.length === 1) {
            resolved.push(data[0]);
          } else if (data.length > 1) {
            ambiguous[name] = data;
          } else {
            unresolved.push(name);
          }
        }
      } else {
        unresolved.push(name);
      }
    }

    selectedSpecies.update((current) => {
      const ids = new Set(current.map((d) => d.taxonID));
      return [...current, ...resolved.filter((d) => !ids.has(d.taxonID))];
    });

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
