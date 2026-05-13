import { distance } from 'fastest-levenshtein';
import { getTaicolDb } from './init';
import { searchSpecies } from './search';
import type { SearchResult, TaxonGroup } from './types';

type FuzzyOptions = {
  q: string;
  group?: TaxonGroup;
  excludeIds?: Set<number>;
  limit?: number;
};

let cnameIndex: Array<{ cname: string; nameIds: number[] }> | null = null;

function loadCnameIndex(): Array<{ cname: string; nameIds: number[] }> {
  if (cnameIndex) return cnameIndex;
  const db = getTaicolDb();
  const res = db.executeSync(`SELECT cname, name_ids FROM cname_fuzzy_index`);
  cnameIndex = ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    cname: row.cname as string,
    nameIds: (row.name_ids as string).split(',').map((s) => parseInt(s, 10)),
  }));
  return cnameIndex;
}

export function fuzzySearch({ q, group, excludeIds, limit = 10 }: FuzzyOptions): SearchResult[] {
  if (!q || q.length < 2) return [];

  const index = loadCnameIndex();

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
  const res = db.executeSync(
    `SELECT * FROM taicol_names WHERE name_id IN (${placeholders})`,
    matchedNameIds,
  );

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
  const exact = searchSpecies({ q: opts.q, group: opts.group, limit: 30 });
  if (exact.length >= 5) return exact;

  const excludeIds = new Set(exact.map((r) => r.id));
  const fuzzy = fuzzySearch({ q: opts.q, group: opts.group, excludeIds });
  return [...exact, ...fuzzy];
}

export function clearFuzzyIndexCache(): void {
  cnameIndex = null;
}
