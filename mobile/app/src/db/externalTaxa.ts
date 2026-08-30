/**
 * Taxa that exist in neither bundled checklist, cached locally so they render
 * offline.
 *
 * Only reached when TaiCOL and jp_names both miss — a species present locally
 * always keeps its 't…'/'y…' id, or the same organism would end up with two
 * identities and records, exports and statistics would split.
 *
 * Rows live in user.db on purpose: twnamelist.db is rebuilt from the asset
 * whenever the bundle hash changes, so anything written there is destroyed by
 * the next app update.
 */
import { getUserDb } from './init';

export type ExternalTaxonSource = 'gbif' | 'inat';

export type ExternalTaxon = {
  taxon_id: string;
  source: ExternalTaxonSource;
  source_key: string;
  simple_name: string;
  name_author: string;
  rank: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  common_name_c: string;
  fetched_at: number;
};

export type ExternalTaxonInput = Omit<ExternalTaxon, 'taxon_id' | 'fetched_at'>;

/**
 * Mint the local id for an external taxon.
 *
 * The FIRST character is the entire namespace discriminator (`sourceOfTaxonId`
 * reads `charAt(0)`), so every external id must start with 'g' and none may
 * collide with 't…' or 'y…'.
 *
 * Within that constraint the two sources still have to be told apart, because
 * a GBIF usageKey and an iNaturalist taxon id are both bare integers and
 * `g2492463` would otherwise mean two different organisms. GBIF keeps the plain
 * form (it is the backbone we treat as authoritative); iNat gets 'gi' + key,
 * which cannot collide because a GBIF key is all digits.
 */
export function externalTaxonId(source: ExternalTaxonSource, sourceKey: string): string {
  return source === 'inat' ? `gi${sourceKey}` : `g${sourceKey}`;
}

/**
 * Insert or refresh one external taxon.
 *
 * Re-fetching the same key updates the cached fields (GBIF revises its
 * backbone) but keeps the id stable, because user records persist it. If some
 * OTHER source already cached this scientific name, that row's id wins for the
 * same reason — `source` / `source_key` then describe where the current field
 * values came from, while the id stays whatever records already point at.
 */
export function upsertExternalTaxon(input: ExternalTaxonInput): string {
  const taxonId =
    findExternalTaxonIdByName(input.simple_name) ??
    externalTaxonId(input.source, input.source_key);
  getUserDb().executeSync(
    `INSERT INTO external_taxa
       (taxon_id, source, source_key, simple_name, name_author, rank,
        kingdom, phylum, class, "order", family, genus, common_name_c, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(taxon_id) DO UPDATE SET
       source = excluded.source,
       simple_name = excluded.simple_name,
       name_author = excluded.name_author,
       rank = excluded.rank,
       kingdom = excluded.kingdom,
       phylum = excluded.phylum,
       class = excluded.class,
       "order" = excluded."order",
       family = excluded.family,
       genus = excluded.genus,
       common_name_c = excluded.common_name_c,
       fetched_at = excluded.fetched_at;`,
    [
      taxonId,
      input.source,
      input.source_key,
      input.simple_name,
      input.name_author || null,
      input.rank || null,
      input.kingdom || null,
      input.phylum || null,
      input.class || null,
      input.order || null,
      input.family || null,
      input.genus || null,
      input.common_name_c || null,
      Date.now(),
    ],
  );
  return taxonId;
}

export function getExternalTaxon(taxonId: string): ExternalTaxon | null {
  const res = getUserDb().executeSync(`SELECT * FROM external_taxa WHERE taxon_id = ? LIMIT 1;`, [
    taxonId,
  ]);
  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const str = (k: string) => (row[k] as string) ?? '';
  return {
    taxon_id: str('taxon_id'),
    source: (str('source') || 'gbif') as ExternalTaxonSource,
    source_key: str('source_key'),
    simple_name: str('simple_name'),
    name_author: str('name_author'),
    rank: str('rank'),
    kingdom: str('kingdom'),
    phylum: str('phylum'),
    class: str('class'),
    order: str('order'),
    family: str('family'),
    genus: str('genus'),
    common_name_c: str('common_name_c'),
    fetched_at: (row.fetched_at as number) ?? 0,
  };
}

/**
 * An already-cached external taxon with this scientific name, whatever source
 * minted it.
 *
 * Prevents the one way two identities can still appear for a single organism:
 * a species absent from both bundled checklists, fetched once from iNaturalist
 * ('gi…') and later from GBIF ('g…'). Callers reuse the existing id instead of
 * minting a second one. Comparison is on the lowercased name because both
 * sources supply canonical names, already free of authors.
 */
export function findExternalTaxonIdByName(simpleName: string): string | null {
  const n = (simpleName ?? '').trim().toLowerCase();
  if (!n) return null;
  const res = getUserDb().executeSync(
    `SELECT taxon_id FROM external_taxa WHERE LOWER(simple_name) = ? LIMIT 1;`,
    [n],
  );
  const row = (res.rows ?? [])[0] as { taxon_id?: string } | undefined;
  return row?.taxon_id ?? null;
}

/** Rows nothing references any more. Not called automatically — an unreferenced
 *  row today may be referenced tomorrow if the user re-adds the species. */
export function countOrphanExternalTaxa(): number {
  const res = getUserDb().executeSync(
    `SELECT COUNT(*) AS n FROM external_taxa e
      WHERE NOT EXISTS (SELECT 1 FROM favorite_taxa f WHERE f.taxon_id = e.taxon_id)
        AND NOT EXISTS (SELECT 1 FROM checklist_records c WHERE c.taxon_id = e.taxon_id)
        AND NOT EXISTS (SELECT 1 FROM plot_species_records p WHERE p.taxon_id = e.taxon_id)
        AND NOT EXISTS (SELECT 1 FROM collection_specimens s WHERE s.taxon_id = e.taxon_id);`,
  );
  return Number(((res.rows ?? [])[0] as { n?: number })?.n ?? 0);
}
