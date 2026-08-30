import { getUserDb } from './init';
import { resolveTaxa } from './taxonLookup';
import type { SearchResult } from './types';

/** Folder id that always exists (seeded by migration v23). Quick-add entry
 *  points that have no folder picker land here, so there is always a target. */
export const DEFAULT_FOLDER_ID = 1;

/** A 常用名錄 folder. `is_default` marks the seeded one — the UI renders its
 *  label via i18n rather than the stored name, so the default is not locked to
 *  one language. The user can still rename it, which clears that behaviour. */
export type FavoriteFolder = {
  id: number;
  name: string;
  note: string;
  is_default: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  /** GeoJSON of the map area this folder was built from (v25). Empty for a
   *  hand-made folder. Kept so a list of species can still be explained weeks
   *  later — "why these species?" is otherwise unanswerable. */
  area_geojson: string;
  /** Which service produced it: 'inat' | 'gbif'. Empty for a hand-made folder. */
  source: string;
  /** Denormalised for the folder list; not a stored column. */
  species_count: number;
};

/** A row of a 常用名錄 folder. Denormalised so the list renders offline without
 *  joining twnamelist.db. For the full species detail / add-to-record flow,
 *  re-fetch via `searchByTaxonId(taxon_id)`. */
export type FavoriteItem = {
  id: number;
  folder_id: number;
  taxon_id: string;
  simple_name: string;
  common_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  kingdom: string;
  added_at: number;
};

// ───────────────────────────── folders ─────────────────────────────

export function listFavoriteFolders(): FavoriteFolder[] {
  const res = getUserDb().executeSync(
    `SELECT f.*, (SELECT COUNT(*) FROM favorite_taxa t WHERE t.folder_id = f.id) AS species_count
       FROM favorite_folders f
      ORDER BY f.is_default DESC, f.sort_order, f.id;`,
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: (r.id as number) ?? 0,
    name: (r.name as string) ?? '',
    note: (r.note as string) ?? '',
    is_default: (r.is_default as number) ?? 0,
    sort_order: (r.sort_order as number) ?? 0,
    created_at: (r.created_at as number) ?? 0,
    updated_at: (r.updated_at as number) ?? 0,
    area_geojson: (r.area_geojson as string) ?? '',
    source: (r.source as string) ?? '',
    species_count: (r.species_count as number) ?? 0,
  }));
}

export function createFavoriteFolder(name: string, note?: string): number {
  const now = Date.now();
  const res = getUserDb().executeSync(
    `INSERT INTO favorite_folders (name, note, sort_order, created_at, updated_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM favorite_folders), ?, ?);`,
    [name.trim(), note?.trim() ?? null, now, now],
  );
  return Number(res.insertId ?? 0);
}

export function renameFavoriteFolder(id: number, name: string): void {
  getUserDb().executeSync(
    `UPDATE favorite_folders SET name = ?, updated_at = ? WHERE id = ?;`,
    [name.trim(), Date.now(), id],
  );
}

/** Record the map area a folder was built from. Separate from
 *  `createFavoriteFolder` because the folder is created first (the id is needed
 *  to write its species into) and only then do we know the import succeeded. */
export function setFavoriteFolderArea(id: number, areaGeoJson: string, source: string): void {
  getUserDb().executeSync(
    `UPDATE favorite_folders SET area_geojson = ?, source = ?, updated_at = ? WHERE id = ?;`,
    [areaGeoJson || null, source || null, Date.now(), id],
  );
}

/**
 * Delete a folder and everything in it.
 *
 * Children are deleted explicitly rather than relying on ON DELETE CASCADE:
 * FK enforcement is off during migrations and startup cleanup, so cascades
 * cannot be trusted as the only mechanism (same reason deletePlotSurvey /
 * deleteSession / deleteCollectionTrip all delete by hand).
 *
 * The default folder cannot be deleted — quick-add needs a guaranteed target.
 */
export function deleteFavoriteFolder(id: number): void {
  if (id === DEFAULT_FOLDER_ID) throw new Error('Cannot delete the default favourites folder');
  const db = getUserDb();
  db.executeSync(`DELETE FROM favorite_taxa WHERE folder_id = ?;`, [id]);
  db.executeSync(`DELETE FROM favorite_folders WHERE id = ?;`, [id]);
}

// ───────────────────────────── species ─────────────────────────────

/** Add a taxon to a folder. No-op without a taxon_id, or if already in that
 *  folder (UNIQUE(folder_id, taxon_id) + INSERT OR IGNORE). The same taxon may
 *  live in several folders — that is the point of the two-level model. */
export function addFavorite(r: SearchResult, folderId: number = DEFAULT_FOLDER_ID): void {
  addFavoriteRow(
    {
      taxon_id: r.taxon_id,
      simple_name: r.name ?? '',
      common_name_c: r._raw_cname ?? '',
      family: r.family ?? '',
      family_c: r.family_cname ?? '',
      rank: r.rank ?? '',
      kingdom: r.kingdom ?? '',
    },
    folderId,
  );
}

/** The columns `favorite_taxa` actually stores, without requiring a full
 *  `SearchResult`. External ('g…') taxa have no row in twnamelist.db and so can
 *  never produce one — they come from GBIF/iNaturalist with far fewer fields. */
export type FavoriteRowInput = Pick<
  FavoriteItem,
  'taxon_id' | 'simple_name' | 'common_name_c' | 'family' | 'family_c' | 'rank' | 'kingdom'
>;

export function addFavoriteRow(
  row: FavoriteRowInput,
  folderId: number = DEFAULT_FOLDER_ID,
): void {
  if (!row.taxon_id) return;
  getUserDb().executeSync(
    `INSERT OR IGNORE INTO favorite_taxa
       (folder_id, taxon_id, simple_name, common_name_c, family, family_c, rank, kingdom, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      folderId,
      row.taxon_id,
      row.simple_name ?? '',
      row.common_name_c ?? '',
      row.family ?? '',
      row.family_c ?? '',
      row.rank ?? '',
      row.kingdom ?? '',
      Date.now(),
    ],
  );
}

/**
 * Remove a taxon from one folder, or from every folder when `folderId` is
 * omitted.
 *
 * The omit-folder form backs the star toggle on species rows, where "is
 * favourited" means "is in ANY folder" — so un-starring has to clear it
 * everywhere, otherwise the star would stay lit after the user tapped it off.
 */
export function removeFavorite(taxonId: string, folderId?: number): void {
  if (!taxonId) return;
  if (folderId == null) {
    getUserDb().executeSync(`DELETE FROM favorite_taxa WHERE taxon_id = ?;`, [taxonId]);
    return;
  }
  getUserDb().executeSync(
    `DELETE FROM favorite_taxa WHERE taxon_id = ? AND folder_id = ?;`,
    [taxonId, folderId],
  );
}

/** Is this taxon already in THIS folder? Used by the import flows to skip
 *  duplicates without relying on INSERT OR IGNORE (which cannot report how
 *  many it dropped). */
export function isTaxonInFolder(folderId: number, taxonId: string): boolean {
  if (!taxonId) return false;
  const res = getUserDb().executeSync(
    `SELECT 1 FROM favorite_taxa WHERE folder_id = ? AND taxon_id = ? LIMIT 1;`,
    [folderId, taxonId],
  );
  return (res.rows?.length ?? 0) > 0;
}

/** Is this taxon in any folder? */
export function isFavorite(taxonId: string): boolean {
  if (!taxonId) return false;
  const res = getUserDb().executeSync(
    `SELECT 1 FROM favorite_taxa WHERE taxon_id = ? LIMIT 1;`,
    [taxonId],
  );
  return (res.rows?.length ?? 0) > 0;
}

/** Rows of one folder, or of every folder when `folderId` is omitted. */
export function listFavorites(folderId?: number): FavoriteItem[] {
  const res =
    folderId == null
      ? getUserDb().executeSync(`SELECT * FROM favorite_taxa ORDER BY added_at DESC;`)
      : getUserDb().executeSync(
          `SELECT * FROM favorite_taxa WHERE folder_id = ? ORDER BY added_at DESC;`,
          [folderId],
        );
  return ((res.rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: (row.id as number) ?? 0,
    folder_id: (row.folder_id as number) ?? DEFAULT_FOLDER_ID,
    taxon_id: (row.taxon_id as string) ?? '',
    simple_name: (row.simple_name as string) ?? '',
    common_name_c: (row.common_name_c as string) ?? '',
    family: (row.family as string) ?? '',
    family_c: (row.family_c as string) ?? '',
    rank: (row.rank as string) ?? '',
    kingdom: (row.kingdom as string) ?? '',
    added_at: (row.added_at as number) ?? 0,
  }));
}

/**
 * Fill in Chinese family names that an earlier import left blank.
 *
 * `favorite_taxa` is denormalised so the list renders offline without joining
 * twnamelist.db, which means anything not written at import time is never
 * shown — and the area-import path stored an empty `family_c`, so those rows
 * displayed a bare `Fagaceae` where every other entry point shows 殼斗科.
 *
 * Runs once per session and only when there is something to fix: the common
 * case is one indexed COUNT-shaped query that finds nothing. External ('g…')
 * taxa are skipped — GBIF and iNaturalist have no Chinese name to supply.
 */
export function backfillFavoriteFamilyNames(): number {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT DISTINCT taxon_id FROM favorite_taxa
      WHERE (family_c IS NULL OR family_c = '')
        AND taxon_id IS NOT NULL AND taxon_id != ''
        AND SUBSTR(taxon_id, 1, 1) != 'g'
      LIMIT 2000;`,
  );
  const ids = ((res.rows ?? []) as { taxon_id?: string }[])
    .map((r) => r.taxon_id ?? '')
    .filter(Boolean);
  if (ids.length === 0) return 0;

  let fixed = 0;
  for (const [id, f] of resolveTaxa(ids)) {
    if (!f.family_c) continue;
    db.executeSync(
      `UPDATE favorite_taxa SET family_c = ?, family = CASE WHEN family IS NULL OR family = ''
         THEN ? ELSE family END
        WHERE taxon_id = ? AND (family_c IS NULL OR family_c = '');`,
      [f.family_c, f.family, id],
    );
    fixed++;
  }
  return fixed;
}

/** Move a row to another folder. Silently no-ops if the target already has it. */
export function moveFavorite(id: number, toFolderId: number): void {
  getUserDb().executeSync(
    `UPDATE OR IGNORE favorite_taxa SET folder_id = ? WHERE id = ?;`,
    [toFolderId, id],
  );
}
