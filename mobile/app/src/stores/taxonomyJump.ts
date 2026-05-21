/**
 * Cross-screen request to expand the taxonomy tree to a specific path.
 *
 * Sender (SpeciesDetailPanel rank chip): calls `request(path)` then
 * `router.push('/(tabs)/taxonomy')`.
 *
 * Consumer (`(tabs)/taxonomy.tsx`): on tab focus, if `pendingPath` is set,
 * forces segment back to 'tree', runs the cascade expand-to-path logic,
 * then calls `clear()` so the same jump doesn't fire on every subsequent
 * focus.
 */
import { create } from 'zustand';
import type { Rank } from '~/db';

export type JumpPath = Array<{ rank: Rank; value: string }>;

type State = {
  pendingPath: JumpPath | null;
  request: (path: JumpPath) => void;
  clear: () => void;
};

export const useTaxonomyJump = create<State>((set) => ({
  pendingPath: null,
  request: (path) => set({ pendingPath: path }),
  clear: () => set({ pendingPath: null }),
}));
