import { create } from 'zustand';
import {
  addFavorite,
  backfillFavoriteFamilyNames,
  createFavoriteFolder,
  deleteFavoriteFolder,
  DEFAULT_FOLDER_ID,
  isTaxonInFolder,
  listFavoriteFolders,
  listFavorites,
  moveFavorite,
  removeFavorite,
  renameFavoriteFolder,
  searchByTaxonId,
  taxonIdsOfRecord,
  type FavoriteFolder,
  type RecordKind,
  type FavoriteItem,
  type SearchResult,
} from '~/db';

type FavoritesState = {
  folders: FavoriteFolder[];
  /** Every row across every folder. The favourites screen slices this per
   *  folder; keeping one list means a single refresh path.
   *
   *  Deliberately NO `itemsIn(folderId)` selector on the store: components must
   *  subscribe to `items` (a value) and filter locally. Subscribing to a store
   *  METHOD returns a reference that never changes, so the component never
   *  re-renders when items do — that shipped once as "adding a species doesn't
   *  show up until you leave the folder and come back". */
  items: FavoriteItem[];
  /** taxon_id set for O(1) "is this favorited?" checks in list rows / detail.
   *  Membership is ACROSS ALL FOLDERS — the star on a species row means "is in
   *  the favourites somewhere", so un-starring removes it from every folder. */
  ids: Set<string>;
  loading: boolean;
  refresh: () => void;
  /** Quick-add entry points (species rows, detail panel) omit the folder and
   *  land in the default folder. The favourites screen passes one explicitly. */
  add: (r: SearchResult, folderId?: number) => void;
  /** Convenience for entry points that only have a taxon_id (record rows). Looks
   *  up the full TaiCOL row first. Returns false if the taxon_id can't resolve. */
  addById: (taxonId: string, folderId?: number) => boolean;
  /** Omit folderId to remove from every folder (star toggle semantics). */
  remove: (taxonId: string, folderId?: number) => void;
  has: (taxonId: string) => boolean;
  createFolder: (name: string) => number;
  renameFolder: (id: number, name: string) => void;
  deleteFolder: (id: number) => void;
  moveItem: (id: number, toFolderId: number) => void;
  /** Copy every species of an existing record (名錄 / 樣區 / 採集) into a folder.
   *  Returns counts so the caller can report what happened — silent partial
   *  success is exactly the kind of thing users notice later and distrust. */
  importFromRecord: (
    kind: RecordKind,
    recordId: number,
    folderId: number,
  ) => { added: number; skipped: number; unresolved: number };
};

/** The backfill is a one-off repair, not something to redo on every refresh. */
let familyNamesBackfilled = false;

export const useFavorites = create<FavoritesState>((set, get) => ({
  folders: [],
  items: [],
  ids: new Set(),
  loading: false,
  refresh: () => {
    set({ loading: true });
    if (!familyNamesBackfilled) {
      familyNamesBackfilled = true;
      backfillFavoriteFamilyNames();
    }
    const items = listFavorites();
    set({
      folders: listFavoriteFolders(),
      items,
      ids: new Set(items.map((i) => i.taxon_id)),
      loading: false,
    });
  },
  add: (r, folderId = DEFAULT_FOLDER_ID) => {
    addFavorite(r, folderId);
    get().refresh();
  },
  addById: (taxonId, folderId = DEFAULT_FOLDER_ID) => {
    const r = searchByTaxonId(taxonId);
    if (!r) return false;
    addFavorite(r, folderId);
    get().refresh();
    return true;
  },
  remove: (taxonId, folderId) => {
    removeFavorite(taxonId, folderId);
    get().refresh();
  },
  has: (taxonId) => get().ids.has(taxonId),
  createFolder: (name) => {
    const id = createFavoriteFolder(name);
    get().refresh();
    return id;
  },
  renameFolder: (id, name) => {
    renameFavoriteFolder(id, name);
    get().refresh();
  },
  deleteFolder: (id) => {
    deleteFavoriteFolder(id);
    get().refresh();
  },
  moveItem: (id, toFolderId) => {
    moveFavorite(id, toFolderId);
    get().refresh();
  },
  importFromRecord: (kind, recordId, folderId) => {
    let added = 0;
    let skipped = 0;
    let unresolved = 0;
    for (const taxonId of taxonIdsOfRecord(kind, recordId)) {
      if (isTaxonInFolder(folderId, taxonId)) {
        skipped++;
        continue;
      }
      // A record can hold a taxon_id that no longer resolves (name DB updated
      // between recording and now); it must not silently become a blank row.
      const r = searchByTaxonId(taxonId);
      if (!r) {
        unresolved++;
        continue;
      }
      addFavorite(r, folderId);
      added++;
    }
    get().refresh();
    return { added, skipped, unresolved };
  },
}));
