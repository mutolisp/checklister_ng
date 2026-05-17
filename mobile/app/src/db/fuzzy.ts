import { distance } from 'fastest-levenshtein';
import { getTaicolDb } from './init';
import { SEARCH_COLUMNS, searchSpecies, TAXON_GROUP_FILTERS } from './search';
import type { SearchResult, TaxonGroup } from './types';

type FuzzyOptions = {
  q: string;
  group?: TaxonGroup;
  excludeIds?: Set<number>;
  limit?: number;
};

let cnameIndex: Array<{ cname: string; nameIds: number[] }> | null = null;
let cnameIndexMissing = false;

function loadCnameIndex(): Array<{ cname: string; nameIds: number[] }> | null {
  if (cnameIndex) return cnameIndex;
  if (cnameIndexMissing) return null;
  const db = getTaicolDb();
  // The fuzzy index is built by `backend/scripts/build_mobile_fuzzy_index.py`
  // before the asset DB is bundled. Older bundles (or bundles built without
  // that step) won't have it — fail gracefully instead of throwing on every
  // keystroke (an uncaught throw inside the search-debounce setTimeout has
  // been observed to destabilize the Hermes runtime).
  try {
    const exists = db.executeSync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cname_fuzzy_index' LIMIT 1`,
    );
    if (!((exists.rows ?? []) as unknown[]).length) {
      cnameIndexMissing = true;
      // eslint-disable-next-line no-console
      console.warn('[fuzzy] cname_fuzzy_index missing — fuzzy fallback disabled');
      return null;
    }
    const res = db.executeSync(`SELECT cname, name_ids FROM cname_fuzzy_index`);
    cnameIndex = ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      cname: row.cname as string,
      nameIds: (row.name_ids as string).split(',').map((s) => parseInt(s, 10)),
    }));
    return cnameIndex;
  } catch (e) {
    cnameIndexMissing = true;
    // eslint-disable-next-line no-console
    console.warn('[fuzzy] failed to load cname_fuzzy_index, disabling fuzzy:', e);
    return null;
  }
}

export function fuzzySearch({ q, group, excludeIds, limit = 10 }: FuzzyOptions): SearchResult[] {
  if (!q || q.length < 2) return [];

  const index = loadCnameIndex();
  if (!index) return [];

  let matches = index
    .map((entry) => ({ entry, dist: distance(q, entry.cname) }))
    .filter((m) => m.dist <= 1);

  if (matches.length < 3 && q.length >= 3) {
    matches = index
      .map((entry) => ({ entry, dist: distance(q, entry.cname) }))
      .filter((m) => m.dist <= 2);
  }

  if (matches.length === 0) return [];

  matches.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return Math.abs(a.entry.cname.length - q.length) - Math.abs(b.entry.cname.length - q.length);
  });

  const matchedNameIds: number[] = [];
  const fuzzyInfo = new Map<number, { matched: string; score: number }>();
  for (const m of matches.slice(0, 15)) {
    for (const nameId of m.entry.nameIds) {
      if (excludeIds?.has(nameId)) continue;
      if (!fuzzyInfo.has(nameId)) {
        matchedNameIds.push(nameId);
        fuzzyInfo.set(nameId, { matched: m.entry.cname, score: m.dist });
      }
    }
  }

  if (matchedNameIds.length === 0) return [];

  const db = getTaicolDb();
  const placeholders = matchedNameIds.map(() => '?').join(',');
  // Honor the user's taxon-group filter — without this the fuzzy index sweeps
  // across all 62k cnames and returns matches from any kingdom, so picking
  // "維管束植物" had no effect on fuzzy results (only exact-search was filtered).
  let sql = `SELECT ${SEARCH_COLUMNS} FROM taicol_names WHERE name_id IN (${placeholders})`;
  const params: (string | number)[] = [...matchedNameIds];
  if (group && TAXON_GROUP_FILTERS[group]) {
    for (const [field, value] of Object.entries(TAXON_GROUP_FILTERS[group])) {
      sql += ` AND "${field}" = ?`;
      params.push(value);
    }
  }
  const res = db.executeSync(sql, params);

  const rows = (res.rows ?? []) as Array<Record<string, unknown>>;
  const results: SearchResult[] = [];
  for (const row of rows) {
    const nameId = row.name_id as number;
    const info = fuzzyInfo.get(nameId);
    if (!info) continue;

    results.push({
      id: nameId,
      name: (row.simple_name as string) ?? '',
      fullname: row.name_author
        ? `${(row.simple_name as string) ?? ''} ${row.name_author as string}`
        : ((row.simple_name as string) ?? ''),
      cname: (row.common_name_c as string) ?? '',
      _raw_cname: (row.common_name_c as string) ?? '',
      family: (row.family as string) ?? '',
      family_cname: (row.family_c as string) ?? '',
      iucn_category: (row.iucn as string) ?? '',
      redlist: (row.redlist as string) ?? '',
      endemic: row.is_endemic === 'true' ? 1 : 0,
      source: '',
      alien_type: (row.alien_type as string) ?? '',
      pt_name: '',
      taxon_id: (row.taxon_id as string) ?? '',
      usage_status: 'accepted',
      alternative_name_c: (row.alternative_name_c as string) ?? '',
      kingdom: (row.kingdom as string) ?? '',
      kingdom_c: (row.kingdom_c as string) ?? '',
      phylum: (row.phylum as string) ?? '',
      phylum_c: (row.phylum_c as string) ?? '',
      class_name: (row.class as string) ?? '',
      class_c: (row.class_c as string) ?? '',
      order: (row.order as string) ?? '',
      order_c: (row.order_c as string) ?? '',
      genus: (row.genus as string) ?? '',
      genus_c: (row.genus_c as string) ?? '',
      nomenclature_name: (row.nomenclature_name as string) ?? '',
      cites: (row.cites as string) ?? '',
      protected: (row.protected as string) ?? '',
      is_hybrid: (row.is_hybrid as string) ?? '',
      is_terrestrial: (row.is_terrestrial as string) ?? '',
      is_freshwater: (row.is_freshwater as string) ?? '',
      is_brackish: (row.is_brackish as string) ?? '',
      is_marine: (row.is_marine as string) ?? '',
      is_fossil: (row.is_fossil as string) ?? '',
      alien_status_note: (row.alien_status_note as string) ?? '',
      rank: (row.rank as string) ?? '',
      is_autonym: false,
      is_sensu_lato: false,
      fuzzy_match: { query: q, matched: info.matched, score: info.score },
    });
  }

  results.sort((a, b) => (a.fuzzy_match?.score ?? 99) - (b.fuzzy_match?.score ?? 99));
  return results.slice(0, limit);
}

/**
 * Combined search: exact/like first, fall back to fuzzy if results are sparse.
 * Mirrors backend search_api logic.
 */
export function searchWithFuzzyFallback(opts: {
  q: string;
  group?: TaxonGroup;
}): SearchResult[] {
  let exact: SearchResult[] = [];
  try {
    exact = searchSpecies({ q: opts.q, group: opts.group, limit: 30 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[search] exact search failed:', e);
    return [];
  }
  if (exact.length >= 5) return exact;

  try {
    const excludeIds = new Set(exact.map((r) => r.id));
    const fuzzy = fuzzySearch({ q: opts.q, group: opts.group, excludeIds });
    return [...exact, ...fuzzy];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[search] fuzzy fallback failed:', e);
    return exact;
  }
}

export function clearFuzzyIndexCache(): void {
  cnameIndex = null;
  cnameIndexMissing = false;
}

/**
 * Force-load the 62k cname fuzzy index into JS heap. Call this off the
 * critical path (e.g. `setTimeout(prewarmFuzzyIndex, 0)` on SearchBox mount)
 * so the *first* user query doesn't pay the ~200-500ms cold-load cost.
 */
export function prewarmFuzzyIndex(): void {
  loadCnameIndex();
}
