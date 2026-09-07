/**
 * Multi-select state for the records list. Long-pressing a record in
 * `(tabs)/index.tsx` calls `enter(key)` to activate the mode, then `toggle`
 * picks more. `key` = `${kind}-${id}` (e.g. `session-42`).
 *
 * Module-level store so the records list, the top selection bar, and the
 * SwipeRow children can all read/write without prop drilling.
 */
import { create } from 'zustand';
import type { RecordKind } from '~/db';

type State = {
  active: boolean;
  selected: Set<string>;
  enter: (key: string) => void;
  toggle: (key: string) => void;
  /** Bulk add / remove (group-header select-all in the byProject view). */
  setMany: (keys: string[], on: boolean) => void;
  clear: () => void;
};

export const useRecordSelection = create<State>((set, get) => ({
  active: false,
  selected: new Set<string>(),
  enter: (key) => {
    const next = new Set<string>();
    next.add(key);
    set({ active: true, selected: next });
  },
  toggle: (key) => {
    const cur = get().selected;
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set({ selected: next });
  },
  setMany: (keys, on) => {
    const next = new Set(get().selected);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    set({ selected: next });
  },
  clear: () => set({ active: false, selected: new Set<string>() }),
}));

export function selectionKey(kind: RecordKind, id: number): string {
  return `${kind}-${id}`;
}
