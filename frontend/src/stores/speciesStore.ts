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

// ✅ 從 localStorage 載入暫存資料
//
const stored = browser ? localStorage.getItem("checklist") : null;
const initialData: ChecklistItem[] = stored ? JSON.parse(stored) : [];

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
