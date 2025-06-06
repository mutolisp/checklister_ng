// src/lib/dwcMapper.ts
// src/lib/dwcMapper.ts

// twnamelist原始的欄位 → Darwin Core 名稱
export const dwcFieldMap: Record<string, string> = {
  id: "taxonID",
  name: "scientificName",
  fullname: "scientificNameAuthorship",
  cname: "vernacularName",
  family: "family",
  // Darwin Core uses "vernacular". Fix a long-standing typo here.
  family_cname: "familyVernacularName",
  pt_name: "higherClassification",
  source: "establishmentMeans",
  iucn_category: "iucnStatus", // not standard, but used in export
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

// ✅ 匯入時使用：Darwin Core → 原始
export function convertFromDarwinCore(record: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key in record) {
    const origKey = reverseFieldMap[key] ?? key;
    result[origKey] = record[key];
  }
  return result;
}

