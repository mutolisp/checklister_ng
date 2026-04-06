// frontend/src/stores/speciesStore.ts
import { writable } from 'svelte/store';
// uuid 
import { v4 as uuidv4 } from "uuid";
import { browser } from "$app/environment";
//export const selectedSpecies = writable<any[]>([]);

export type ChecklistItem = {
  taxonID: number;                      // 原 id
  occurrenceID: string;                // uuid
  scientificName: string;              // 原 name
  scientificNameAuthorship: string;    // 原 fullname
  vernacularName: string;              // 原 cname
  family: string;
  family_cname: string;
  higherClassification: string;        // 原 pt_name
  establishmentMeans?: string;         // 原 source
  threatStatus?: string;               // 原 iucn_category
  eventDate: string;                   // created_at
  modified: string;                    // modified_at
};

// 從 fullname 提取不含命名者的學名（含 var./subsp./f.）
function extractName(fullname: string): string {
  if (!fullname) return '';
  // 逐步取 Genus species [rank epithet]... 直到碰到大寫開頭的命名者
  const match = fullname.match(
    /^([A-Z][a-z]+ [a-z\-]+(?:\s+(?:subsp\.|var\.|f\.|fo\.)\s+[a-z\-]+)*)/
  );
  return match ? match[1] : fullname;
}

// 從 localStorage 載入暫存資料，自動補齊缺少的 name 欄位
const stored = browser ? localStorage.getItem("checklist") : null;
const initialData: ChecklistItem[] = stored
  ? JSON.parse(stored).map((item: any) => {
      if (!item.name && item.fullname) {
        item.name = extractName(item.fullname);
      }
      return item;
    })
  : [];

export const selectedSpecies = writable<ChecklistItem[]>(initialData);


// ✅ 每次更新 store，自動寫入 localStorage
selectedSpecies.subscribe((value) => {
  if (browser) {
    localStorage.setItem("checklist", JSON.stringify(value));
  }
});

// ✅ 工具函式：加入新物種（自動補 uuid / 日期）
export function addSpecies(raw: {
  taxonID: number;
  scientificName: string;
  scientificNameAuthorship: string;
  vernacularName: string;
  family: string;
  higherClassification: string;
  establishmentMeans?: string;
  threatStatus?: string;
}) {
  const now = new Date().toISOString();
  const newItem: ChecklistItem = {
    ...raw,
    occurrenceID: uuidv4(),
    eventDate: now,
    modified: now
  };

  selectedSpecies.update((current) => {
    if (!current.find((d) => d.taxonID === raw.taxonID)) {
      return [...current, newItem];
    }
    return current;
  });
}
