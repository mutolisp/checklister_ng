import { writable } from 'svelte/store';

// 有檢索表的屬名集合
export const availableKeys = writable<Set<string>>(new Set());

export async function loadAvailableKeys() {
  try {
    const res = await fetch('/api/key');
    if (res.ok) {
      const genera: string[] = await res.json();
      availableKeys.set(new Set(genera));
    }
  } catch { /* ignore */ }
}
