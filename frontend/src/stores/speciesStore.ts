// frontend/src/stores/speciesStore.ts
import { writable } from 'svelte/store';
import { browser } from "$app/environment";

/** 物種資料型別（匹配 search API 回傳的 snake_case 欄位） */
export type ChecklistItem = {
  taxon_id: string;
  id: number;
  name: string;                    // 不含命名者的學名
  fullname: string;                // 含命名者的完整學名
  cname: string;                   // 俗名
  alternative_name_c?: string;
  family: string;
  family_cname: string;
  kingdom: string;
  kingdom_c?: string;
  phylum: string;
  phylum_c?: string;
  class_name: string;
  class_c?: string;
  order: string;
  order_c?: string;
  genus: string;
  genus_c?: string;
  pt_name: string;
  source: string;                  // 原生/歸化/栽培/圈養
  endemic: number;                 // 0 or 1
  redlist: string;
  iucn_category: string;
  cites: string;
  protected: string;
  is_hybrid: string;
  nomenclature_name: string;
  usage_status: string;
  is_terrestrial?: string;
  is_freshwater?: string;
  is_brackish?: string;
  is_marine?: string;
  is_fossil?: string;
  alien_status_note?: string;
  abundance?: number;              // 使用者自行填入
  [key: string]: any;              // 允許額外欄位（如 _raw_cname）
};

// 從 fullname 提取不含命名者的學名（含 var./subsp./f.）
function extractName(fullname: string): string {
  if (!fullname) return '';
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

// 每次更新 store，自動寫入 localStorage
selectedSpecies.subscribe((value) => {
  if (browser) {
    localStorage.setItem("checklist", JSON.stringify(value));
  }
});
