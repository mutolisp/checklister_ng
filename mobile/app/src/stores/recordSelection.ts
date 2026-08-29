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
  clear: () => set({ active: false, selected: new Set<string>() }),
}));

export function selectionKey(kind: RecordKind, id: number): string {
  return `${kind}-${id}`;
}
