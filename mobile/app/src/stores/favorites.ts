import { create } from 'zustand';
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  searchByTaxonId,
  type FavoriteItem,
  type SearchResult,
} from '~/db';

type FavoritesState = {
  items: FavoriteItem[];
  /** taxon_id set for O(1) "is this favorited?" checks in list rows / detail. */
  ids: Set<string>;
  loading: boolean;
  refresh: () => void;
  add: (r: SearchResult) => void;
  /** Convenience for entry points that only have a taxon_id (record rows). Looks
   *  up the full TaiCOL row first. Returns false if the taxon_id can't resolve. */
  addById: (taxonId: string) => boolean;
  remove: (taxonId: string) => void;
  has: (taxonId: string) => boolean;
};

export const useFavorites = create<FavoritesState>((set, get) => ({
  items: [],
  ids: new Set(),
  loading: false,
  refresh: () => {
    set({ loading: true });
    const items = listFavorites();
    set({ items, ids: new Set(items.map((i) => i.taxon_id)), loading: false });
  },
  add: (r) => {
    addFavorite(r);
    get().refresh();
  },
  addById: (taxonId) => {
    const r = searchByTaxonId(taxonId);
    if (!r) return false;
    addFavorite(r);
    get().refresh();
    return true;
  },
  remove: (taxonId) => {
    removeFavorite(taxonId);
    get().refresh();
  },
  has: (taxonId) => get().ids.has(taxonId),
}));
