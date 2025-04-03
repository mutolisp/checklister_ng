import { writable } from "svelte/store";

// key: 原始俗名, value: 可能對應的物種陣列
export const ambiguousStore = writable<Record<string, any[]>>({});
export const unresolvedStore = writable<string[]>([]);
