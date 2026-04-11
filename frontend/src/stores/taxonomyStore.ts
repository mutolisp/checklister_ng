import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// 已展開的節點 key: "rank:name" (e.g. "kingdom:Animalia", "family:Colubridae")
const STORAGE_KEY = 'taxonomy_expanded';

const stored = browser ? localStorage.getItem(STORAGE_KEY) : null;
const initial: string[] = stored ? JSON.parse(stored) : [];

export const expandedNodes = writable<Set<string>>(new Set(initial));

// 同步到 localStorage
expandedNodes.subscribe((value) => {
  if (browser) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...value]));
  }
});

export function nodeKey(rankKey: string, name: string): string {
  return `${rankKey}:${name}`;
}

export function markExpanded(rankKey: string, name: string) {
  expandedNodes.update(s => { s.add(nodeKey(rankKey, name)); return new Set(s); });
}

export function markCollapsed(rankKey: string, name: string) {
  expandedNodes.update(s => { s.delete(nodeKey(rankKey, name)); return new Set(s); });
}

export function clearAll() {
  expandedNodes.set(new Set());
}
