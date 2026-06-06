import { getUserDb } from './init';
import type { SearchResult } from './types';

/** A row of the 常用名錄 (favorite_taxa). Denormalised so the list renders
 *  offline without joining twnamelist.db. For the full species detail / add-to
 *  -record flow, re-fetch via `searchByTaxonId(taxon_id)`. */
export type FavoriteItem = {
  taxon_id: string;
  simple_name: string;
  common_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  kingdom: string;
  added_at: number;
};

/** Add a taxon to 常用名錄. No-op if it has no taxon_id or is already present
 *  (taxon_id PRIMARY KEY + INSERT OR IGNORE). */
export function addFavorite(r: SearchResult): void {
  if (!r.taxon_id) return;
  getUserDb().executeSync(
    `INSERT OR IGNORE INTO favorite_taxa
       (taxon_id, simple_name, common_name_c, family, family_c, rank, kingdom, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      r.taxon_id,
      r.name ?? '',
      r._raw_cname ?? '',
      r.family ?? '',
      r.family_cname ?? '',
      r.rank ?? '',
      r.kingdom ?? '',
      Date.now(),
    ],
  );
}

export function removeFavorite(taxonId: string): void {
  if (!taxonId) return;
  getUserDb().executeSync(`DELETE FROM favorite_taxa WHERE taxon_id = ?;`, [taxonId]);
}

export function isFavorite(taxonId: string): boolean {
  if (!taxonId) return false;
  const res = getUserDb().executeSync(
    `SELECT 1 FROM favorite_taxa WHERE taxon_id = ? LIMIT 1;`,
    [taxonId],
  );
  return (res.rows?.length ?? 0) > 0;
}

export function listFavorites(): FavoriteItem[] {
  const res = getUserDb().executeSync(
    `SELECT taxon_id, simple_name, common_name_c, family, family_c, rank, kingdom, added_at
       FROM favorite_taxa ORDER BY added_at DESC;`,
  );
  return ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
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
