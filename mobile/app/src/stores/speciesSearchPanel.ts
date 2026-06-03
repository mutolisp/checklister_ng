/**
 * Persisted state for the species (物種) tab's "search" segment, so the inline detail
 * survives segment switches (e.g. user picks a result, taps a rank chip on
 * the detail panel which forces the segment to 'tree', then comes back to
 * 'search' — the previously-shown detail should still be there).
 *
 * Module-level state (not AsyncStorage) so it resets on app cold start; we
 * don't want stale species cached across launches.
 */
import { create } from 'zustand';
import type { SearchResult } from '~/db';

type State = {
  active: SearchResult | null;
  setActive: (r: SearchResult | null) => void;
};

export const useSpeciesSearchPanel = create<State>((set) => ({
  active: null,
  setActive: (r) => set({ active: r }),
}));
