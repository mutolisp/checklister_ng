import { distance } from 'fastest-levenshtein';
import { pinyin } from 'pinyin-pro';
import { getTaicolDb } from './init';
import { SEARCH_COLUMNS, searchSpecies, groupFilterClause } from './search';
import type { SearchResult, TaxonGroup } from './types';

type FuzzyOptions = {
  q: string;
  groups?: TaxonGroup[];
  excludeIds?: Set<number>;
  limit?: number;
  /** Enable toneless-pinyin (phonetic) fallback for homophone garbles, e.g.
   *  voice dictation. Off by default so per-keystroke SearchBox queries never
   *  pay the extra pinyin sweep. */
  phonetic?: boolean;
};

type CnameEntry = { cname: string; nameIds: number[]; pinyin: string };

let cnameIndex: CnameEntry[] | null = null;
let cnameIndexMissing = false;

/** Convert a query string to a list of toneless pinyin syllables. Non-Han
 *  output (latin letters from scientific names, punctuation) is dropped so it
 *  never spuriously matches Chinese candidate syllables. Mirrors the build-time
 *  conversion in `scripts/build_pinyin_index.mjs` (same lib, same options). */
function toPinyinSyllables(s: string): string[] {
  try {
    return (pinyin(s, { toneType: 'none', type: 'array' }) as string[]).filter((x) =>
      /^[a-z]+$/.test(x),
    );
  } catch {
    return [];
  }
}

/** Levenshtein distance over two syllable sequences (one edit = one syllable). */
function seqDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function loadCnameIndex(): CnameEntry[] | null {
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
    // `pinyin` is filled by `scripts/build_pinyin_index.mjs` after the python
    // index build. Older bundles may lack the column — degrade to hanzi-only
    // fuzzy (pinyin = '') instead of throwing, which would disable fuzzy
    // entirely.
    const cols = db.executeSync(`PRAGMA table_info(cname_fuzzy_index)`);
    const hasPinyin = ((cols.rows ?? []) as Array<Record<string, unknown>>).some(
      (c) => c.name === 'pinyin',
    );
    const res = db.executeSync(
      hasPinyin
        ? `SELECT cname, name_ids, pinyin FROM cname_fuzzy_index`
        : `SELECT cname, name_ids FROM cname_fuzzy_index`,
    );
    cnameIndex = ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      cname: row.cname as string,
      nameIds: (row.name_ids as string).split(',').map((s) => parseInt(s, 10)),
      pinyin: (row.pinyin as string) ?? '',
    }));
    return cnameIndex;
  } catch (e) {
    cnameIndexMissing = true;
    // eslint-disable-next-line no-console
    console.warn('[fuzzy] failed to load cname_fuzzy_index, disabling fuzzy:', e);
    return null;
  }
}

export function fuzzySearch({
  q,
  groups,
  excludeIds,
  limit = 10,
  phonetic = false,
}: FuzzyOptions): SearchResult[] {
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

  // Phonetic (toneless pinyin) fallback for homophone garbles from voice
  // dictation, e.g. 台灣時力 / 臺灣實例 → 臺灣石櫟 (all "tai wan shi li").
  // Only when the caller opts in AND hanzi matching is sparse: keeps the
  // default SearchBox path (phonetic=false) free of the extra pinyin sweep,
  // and avoids drowning a good hanzi hit in homophone noise.
  if (phonetic && matches.length < 3) {
    const qSyl = toPinyinSyllables(q);
    if (qSyl.length > 0) {
      const seen = new Set(matches.map((m) => m.entry.cname));
      const maxDist = qSyl.length >= 3 ? 1 : 0;
      const phon = index
        .filter((e) => e.pinyin && !seen.has(e.cname))
        .map((e) => ({ entry: e, dist: seqDistance(qSyl, e.pinyin.split(' ')) }))
        .filter((m) => m.dist <= maxDist)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20);
      matches = matches.concat(phon);
    }
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
  sql += groupFilterClause(groups, params);
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
  groups?: TaxonGroup[];
  /** Forwarded to `fuzzySearch` — enable toneless-pinyin homophone matching
   *  (voice / batch import). Off for the live SearchBox path. */
  phonetic?: boolean;
}): SearchResult[] {
  let exact: SearchResult[] = [];
  try {
    exact = searchSpecies({ q: opts.q, groups: opts.groups, limit: 30 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[search] exact search failed:', e);
    return [];
  }
  if (exact.length >= 5) return exact;

  try {
    const excludeIds = new Set(exact.map((r) => r.id));
    const fuzzy = fuzzySearch({ q: opts.q, groups: opts.groups, excludeIds, phonetic: opts.phonetic });
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
