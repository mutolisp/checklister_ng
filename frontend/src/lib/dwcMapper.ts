// src/lib/dwcMapper.ts
// src/lib/dwcMapper.ts

// twnamelist原始的欄位 → Darwin Core 名稱
export const dwcFieldMap: Record<string, string> = {
  taxon_id: "taxonID",
  name: "scientificName",
  fullname: "scientificNameAuthorship",
  cname: "vernacularName",
  family: "family",
  family_cname: "familyVernacularName",
  pt_name: "higherClassification",
  source: "establishmentMeans",
  iucn_category: "iucnStatus",
  redlist: "redlistCategory",
  endemic: "endemic",
  occurrenceID: "occurrenceID",
  eventDate: "eventDate",
  modified: "modified"
};

// 自動建立 Darwin Core → 原始 欄位對照表
export const reverseFieldMap: Record<string, string> = Object.fromEntries(
  Object.entries(dwcFieldMap).map(([orig, dwc]) => [dwc, orig])
);

// ✅ 匯出時使用：原始 → Darwin Core
export function convertToDarwinCore(record: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key in record) {
    const newKey = dwcFieldMap[key] ?? key;
    result[newKey] = record[key];
  }
  return result;
}

// 舊版相容：舊版匯出 id → taxonID，匯入時 taxonID → id
// 新版匯出 taxon_id → taxonID，匯入時 taxonID → taxon_id
// 區分方式：TaiCOL taxon_id 為 "t" 開頭字串，舊版 id 為數字
const legacyReverseMap: Record<string, string> = {
  ...reverseFieldMap,
  taxonID: "taxon_id",  // 新版預設
};

// ✅ 匯入時使用：Darwin Core → 原始
export function convertFromDarwinCore(record: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key in record) {
    const origKey = legacyReverseMap[key] ?? key;
    result[origKey] = record[key];
  }

  // 舊版相容：若 taxon_id 是數字（舊 name_id），標記需要遷移
  if (result.taxon_id != null && !String(result.taxon_id).startsWith('t')) {
    result._legacy_id = result.taxon_id;
    result.taxon_id = '';  // 清空，等遷移流程填入
  }

  return result;
}

