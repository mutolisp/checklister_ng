import { writable } from "svelte/store";

// key: 原始俗名, value: 可能對應的物種陣列
export const ambiguousStore = writable<Record<string, any[]>>({});
export const unresolvedStore = writable<string[]>([]);

// 舊版 YAML 遷移：key = 學名, value = { original: 舊資料, candidates: API 搜尋結果 }
export type MigrationEntry = {
  original: any;
  candidates: any[];
};
export const migrationStore = writable<Record<string, MigrationEntry>>({});
