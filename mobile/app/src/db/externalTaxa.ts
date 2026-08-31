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
import type { SearchResult } from './types';

/** LIKE wildcards in user input must not act as wildcards. Local copy of
 *  search.ts's helper on purpose: search.ts imports THIS module (for the
 *  external branch of `searchByTaxonId`), so importing back would cycle. */
function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

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
    findExternalTaxonIdByName(input.simple_name, input.kingdom) ??
    externalTaxonId(input.source, input.source_key);
  getUserDb().executeSync(
    `INSERT INTO external_taxa
       (taxon_id, source, source_key, simple_name, name_author, rank,
        kingdom, phylum, class, "order", family, genus, common_name_c, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(taxon_id) DO UPDATE SET
       source = excluded.source,
       -- Must move WITH source: updating one without the other leaves the row
       -- claiming e.g. source='gbif' with an iNaturalist key, which
       -- idx_external_source then indexes as if it were true.
       source_key = excluded.source_key,
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
export function findExternalTaxonIdByName(
  simpleName: string,
  kingdom?: string | null,
): string | null {
  const n = (simpleName ?? '').trim().toLowerCase();
  if (!n) return null;
  // Kingdom narrows the match when the caller knows it. A scientific name is
  // NOT an identity on its own: the bundled checklist alone holds 72 genus
  // names and 2 species names that are cross-kingdom homonyms (see
  // src/lib/sciMatch.ts), and collapsing two organisms onto one taxon_id
  // silently merges every record that points at either.
  const k = (kingdom ?? '').trim();
  const res = k
    ? getUserDb().executeSync(
        `SELECT taxon_id FROM external_taxa
          WHERE LOWER(simple_name) = ? AND (kingdom IS NULL OR kingdom = '' OR kingdom = ?)
          LIMIT 1;`,
        [n, k],
      )
    : getUserDb().executeSync(
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

/**
 * An external taxon as a `SearchResult`, so it slots into the search box, the
 * detail sheet and every other place a local taxon goes.
 *
 * Modelled on `taxonSpeciesToSearchResult` (src/lib/taxonSpecies.ts): the
 * fields GBIF/iNat cannot supply are '' and the detail UI hides empty rows.
 * `id` is 0 — that field is TaiCOL's `name_id`, and an external taxon has
 * none; callers key lists by `taxon_id`, which is unique across all three
 * namespaces.
 */
export function externalToSearchResult(t: ExternalTaxon): SearchResult {
  const fullname = t.name_author ? `${t.simple_name} ${t.name_author}` : t.simple_name;
  return {
    id: 0,
    name: t.simple_name,
    fullname,
    cname: t.common_name_c ?? '',
    _raw_cname: t.common_name_c ?? '',
    family: t.family ?? '',
    family_cname: '',
    iucn_category: '',
    redlist: '',
    endemic: 0,
    source: '',
    alien_type: '',
    pt_name: '',
    taxon_id: t.taxon_id,
    usage_status: 'accepted',
    alternative_name_c: '',
    kingdom: t.kingdom ?? '',
    kingdom_c: '',
    phylum: t.phylum ?? '',
    phylum_c: '',
    class_name: t.class ?? '',
    class_c: '',
    order: t.order ?? '',
    order_c: '',
    genus: t.genus ?? '',
    genus_c: '',
    nomenclature_name: '',
    cites: '',
    protected: '',
    is_hybrid: '',
    is_terrestrial: '',
    is_freshwater: '',
    is_brackish: '',
    is_marine: '',
    is_fossil: '',
    alien_status_note: '',
    rank: t.rank ?? '',
    is_autonym: false,
    is_sensu_lato: false,
    region: 'TW',
  };
}

/**
 * Name search over the user's own external taxa.
 *
 * They live in user.db while the two bundled checklists live in
 * twnamelist.db, and this app never ATTACHes, so they cannot be part of the
 * main query — `searchWithFuzzyFallback` merges this in afterwards. The table
 * is user-accumulated (tens of rows, not 300k) and `idx_external_name` covers
 * the scientific name, so a LIKE sweep is cheap.
 */
export function searchExternalTaxa(q: string, limit = 10): SearchResult[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const like = `%${escapeLike(trimmed)}%`;
  const res = getUserDb().executeSync(
    `SELECT * FROM external_taxa
      WHERE simple_name LIKE ? ESCAPE "\\" OR common_name_c LIKE ? ESCAPE "\\"
      ORDER BY simple_name LIMIT ?;`,
    [like, like, limit],
  );
  return ((res.rows ?? []) as unknown as ExternalTaxon[]).map(externalToSearchResult);
}
