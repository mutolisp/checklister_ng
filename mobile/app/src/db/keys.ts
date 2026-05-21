/**
 * Identification keys read-only query layer (mobile).
 *
 * Keys / couplets live in the TaiCOL bundle DB alongside `taicol_names`, so
 * the mobile app can run dichotomous keys completely offline. Server-side
 * additions become available after a `cp backend/twnamelist.db mobile/app/assets/db/`
 * + rebuild. Online sync from `/api/keys` is deferred to Step 5-4.
 */
import { getTaicolDb } from './init';

export type IdentificationKey = {
  id: number;
  scope_taxon_id: string | null;
  scope_rank: string;
  scope_name: string;
  scope_cname: string | null;
  title: string;
  source: string | null;
  mode: string;
  parent_key_id: number | null;
  notes: string | null;
  /** JSON array string of alternative names that should also match this key
   *  during `findSubkeyForTaxon` / `findSubkeyByScopeName`. Used to bridge
   *  TaiCOL genus moves (Amauropelta ↔ Parathelypteris) and single-genus
   *  family worksheets named at family rank (Davalliaceae ↔ Davallia). */
  aliases: string | null;
  updated_at: number | null;
};

export type KeyLeadTargetType = 'couplet' | 'taxon' | 'subkey' | 'unresolved';

/** Multi-access (matrix) key feature definition. One row per filterable
 *  character. `values_json` is a JSON-encoded string[] of allowed categorical
 *  states (null for numeric/text — UI infers numeric range from taxon values
 *  and treats text as display-only). */
export type KeyFeature = {
  id: number;
  key_id: number;
  name: string;
  type: 'categorical' | 'numeric' | 'text' | string;
  values_json: string | null;
  category: string | null;
  sort_order: number | null;
};

/** One value of a multi-access feature for a taxon. Multi-value cells in the
 *  source sheet (`橫走|短直立`) become multiple rows sharing
 *  (key_id, taxon_id, feature_id) with different `value`. */
export type KeyTaxonFeatureRow = {
  id: number;
  key_id: number;
  taxon_id: string;
  feature_id: number;
  value: string;
};

export type KeyCouplet = {
  id: number;
  key_id: number;
  number: number;
  lead_a_text: string;
  lead_a_target_type: KeyLeadTargetType;
  lead_a_target_id: string | null;
  lead_a_taxon_marker: string | null;
  lead_a_taxon_status: string | null;
  lead_b_text: string;
  lead_b_target_type: KeyLeadTargetType;
  lead_b_target_id: string | null;
  lead_b_taxon_marker: string | null;
  lead_b_taxon_status: string | null;
};

/** Lightweight taxon info joined by taxon_id; mirrors what the key UI needs. */
export type KeyTaxonInfo = {
  taxon_id: string;
  simple_name: string;
  name_author: string;
  common_name_c: string;
  alternative_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  kingdom: string;
  redlist: string;
  iucn: string;
  cites: string;
  protected: string;
  is_endemic: string;
  alien_type: string;
};

/** Plain key SQL — no child_count subquery. The previous version joined a
 *  per-key COUNT subquery over 251k taicol_names rows; on real device that
 *  was measured at 15s for 895 keys (correlated subqueries + LIKE filter on
 *  is_in_taiwan can't use an index). Since child_count was decorative-only,
 *  it was dropped rather than precomputed. */
const KEY_SELECT_SQL = `SELECT k.* FROM identification_keys k`;

export function listIdentificationKeys(): IdentificationKey[] {
  const db = getTaicolDb();
  // Order by mode so two rows sharing the same (scope_rank, scope_name) —
  // one dichotomous, one multi_access — appear in a consistent order
  // (dichotomous first, then multi_access, then any future 'both' merge).
  const res = db.executeSync(
    `${KEY_SELECT_SQL} ORDER BY k.scope_rank, k.scope_name,
       CASE k.mode
         WHEN 'dichotomous'  THEN 0
         WHEN 'multi_access' THEN 1
         WHEN 'both'         THEN 2
         ELSE 3
       END`,
  );
  return ((res.rows ?? []) as unknown) as IdentificationKey[];
}

/** Module-level cache for the full keys list. The bundled TaiCOL DB is
 *  read-only at runtime, so the SQL result can't change mid-session.
 *  Cache once, reuse forever. */
let CACHED_KEYS: IdentificationKey[] | null = null;

/** Reverse index for TaxonRow's per-row「有沒有對應 key」lookup. Built
 *  alongside CACHED_KEYS in prewarmKeys / getCachedKeys. Key format:
 *  `${scope_rank}:${scope_name}` lower-cased. Value: 1-2 entry array (typical
 *  case is 1 dichotomous + optionally 1 multi_access for the same scope). */
let SCOPE_INDEX: Map<string, IdentificationKey[]> | null = null;

function scopeKey(rank: string, name: string): string {
  return `${rank.toLowerCase()}:${name}`;
}

function buildScopeIndex(keys: IdentificationKey[]): Map<string, IdentificationKey[]> {
  const m = new Map<string, IdentificationKey[]>();
  for (const k of keys) {
    if (!k.scope_name) continue;
    const k1 = scopeKey(k.scope_rank, k.scope_name);
    const arr = m.get(k1) ?? [];
    arr.push(k);
    m.set(k1, arr);
    // Also index by aliases so e.g. Davalliaceae (family scope) matches a
    // tree node showing Davallia genus, mirroring findSubkeyByScopeName.
    if (k.aliases) {
      try {
        const aliases = JSON.parse(k.aliases) as unknown;
        if (Array.isArray(aliases)) {
          for (const a of aliases) {
            if (typeof a !== 'string' || !a) continue;
            const k2 = scopeKey(k.scope_rank, a);
            const arr2 = m.get(k2) ?? [];
            arr2.push(k);
            m.set(k2, arr2);
          }
        }
      } catch {
        // ignore malformed aliases JSON
      }
    }
  }
  return m;
}

/** Returns cached keys, computing on first call. Used by KeyListView. */
export function getCachedKeys(): IdentificationKey[] {
  if (CACHED_KEYS === null) {
    CACHED_KEYS = listIdentificationKeys();
    SCOPE_INDEX = buildScopeIndex(CACHED_KEYS);
  }
  return CACHED_KEYS;
}

/** Force-fill the cache. Called from DBProvider after splash so the first
 *  tap on 檢索表 / KeyPopup / taxonomy 樹的 key icon 是即時。SQL itself is
 *  now ~5ms (plain `SELECT * FROM identification_keys` after child_count was
 *  dropped); kept as a marker so future heavy joins re-introduce the same
 *  prewarm slot. */
export function prewarmKeys(): void {
  if (CACHED_KEYS === null) {
    CACHED_KEYS = listIdentificationKeys();
    SCOPE_INDEX = buildScopeIndex(CACHED_KEYS);
  }
}

/** O(1) lookup for taxonomy tree's per-row key chip. Returns the list of
 *  IdentificationKey rows matching this scope (rank + name) — typically
 *  0 (no key for this scope), 1 (dichotomous OR multi-access), or 2 (both).
 *  Returns empty array if `prewarmKeys()` hasn't been called yet — fail
 *  open so tree rendering doesn't depend on key cache being ready. */
export function getKeysForScope(rank: string, name: string): IdentificationKey[] {
  if (!SCOPE_INDEX || !name) return [];
  return SCOPE_INDEX.get(scopeKey(rank, name)) ?? [];
}

export function getIdentificationKey(id: number): IdentificationKey | null {
  const db = getTaicolDb();
  const res = db.executeSync(`${KEY_SELECT_SQL} WHERE k.id = ?`, [id]);
  const rows = (res.rows ?? []) as unknown as IdentificationKey[];
  return rows[0] ?? null;
}

export function listKeyCouplets(keyId: number): KeyCouplet[] {
  const db = getTaicolDb();
  const res = db.executeSync(
    `SELECT * FROM key_couplets WHERE key_id = ? ORDER BY number ASC`,
    [keyId],
  );
  return ((res.rows ?? []) as unknown) as KeyCouplet[];
}

/** Features for a multi-access key, ordered by header column position. */
export function listKeyFeatures(keyId: number): KeyFeature[] {
  const db = getTaicolDb();
  const res = db.executeSync(
    `SELECT id, key_id, name, type, values_json, category, sort_order
       FROM key_features
      WHERE key_id = ?
      ORDER BY COALESCE(sort_order, 0) ASC, id ASC`,
    [keyId],
  );
  return ((res.rows ?? []) as unknown) as KeyFeature[];
}

/** Taxon × feature value rows for a multi-access key. Caller indexes by
 *  taxon_id / feature_id; runtime cost is O(rows) and the typical scope
 *  (≤ ~100 taxa × ~20 features × multi-value ≈ a few thousand rows) fits
 *  comfortably in JS memory. */
export function listKeyTaxonFeatures(keyId: number): KeyTaxonFeatureRow[] {
  const db = getTaicolDb();
  const res = db.executeSync(
    `SELECT id, key_id, taxon_id, feature_id, value
       FROM key_taxon_features
      WHERE key_id = ?`,
    [keyId],
  );
  return ((res.rows ?? []) as unknown) as KeyTaxonFeatureRow[];
}

/** Parse a `KeyFeature.values_json` JSON-encoded string[] into an array.
 *  Returns [] for null / malformed (treated as "no declared palette"). */
export function parseFeatureValues(values_json: string | null): string[] {
  if (!values_json) return [];
  try {
    const parsed = JSON.parse(values_json);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
  } catch {
    // ignore corrupt JSON
  }
  return [];
}

/** Build a number → couplet lookup for fast traversal. */
export function indexCoupletsByNumber(couplets: KeyCouplet[]): Map<number, KeyCouplet> {
  const map = new Map<number, KeyCouplet>();
  for (const c of couplets) map.set(c.number, c);
  return map;
}

/**
 * Look up a more specific identification key for a terminal taxon
 * ("subkey chain"). Returns the genus key when a key-runner terminates at
 * a genus row, the family key when it terminates at a family, etc.
 *
 * Matching rule: a key whose `scope_name` (and matching `scope_rank`)
 * equals the terminal taxon's `simple_name`. We do NOT trust
 * `scope_taxon_id` because the import pipeline currently leaves it null.
 *
 * Returns null when the taxon row can't be located, the rank isn't one of
 * the supported scopes, or no key exists for that scope. Callers should
 * gate the "續查屬內檢索表" button on this being non-null.
 */
const RANK_TO_SCOPE: Record<string, string> = {
  Family: 'family',
  Subfamily: 'subfamily',
  Tribe: 'tribe',
  Genus: 'genus',
  Subgenus: 'subgenus',
};

export function findSubkeyForTaxon(taxonId: string): IdentificationKey | null {
  if (!taxonId) return null;
  const db = getTaicolDb();
  // Prefer the accepted-name row for rank + simple_name.
  let res = db.executeSync(
    `SELECT simple_name, rank FROM taicol_names
      WHERE taxon_id = ? AND usage_status = 'accepted' LIMIT 1`,
    [taxonId],
  );
  let row = (res.rows ?? [])[0] as { simple_name: string; rank: string } | undefined;
  if (!row) {
    res = db.executeSync(
      `SELECT simple_name, rank FROM taicol_names WHERE taxon_id = ? LIMIT 1`,
      [taxonId],
    );
    row = (res.rows ?? [])[0] as { simple_name: string; rank: string } | undefined;
  }
  if (!row || !row.simple_name) return null;
  const scope = RANK_TO_SCOPE[row.rank];
  if (!scope) return null;

  // 1. Exact match on accepted simple_name + matching scope_rank.
  const exact = findSubkeyByScopeName(row.simple_name, scope);
  if (exact) return exact;

  // 2. Try the accepted name with any scope_rank (handles single-genus
  //    families where the worksheet is named at family rank: e.g. taxon
  //    rank=Genus name=Davallia but worksheet is family Davalliaceae —
  //    catchable via the alias seed "Davallia" written on Davalliaceae).
  const anyRank = findSubkeyByScopeName(row.simple_name);
  if (anyRank) return anyRank;

  // 3. TaiCOL genus-move fallback: query the same taxon_id's non-accepted
  //    rows at the same rank, parse out the first sciname token (old
  //    genus), and try it as a scope_name. Covers Amauropelta beddomei
  //    (accepted) → "Parathelypteris" (non-accepted alias) → Parathelypteris
  //    worksheet.
  const altRes = db.executeSync(
    `SELECT DISTINCT simple_name FROM taicol_names
      WHERE taxon_id = ? AND usage_status != 'accepted' AND rank = ?`,
    [taxonId, row.rank],
  );
  const alts = (altRes.rows ?? []) as { simple_name: string }[];
  for (const alt of alts) {
    const sn = (alt.simple_name ?? '').trim();
    if (!sn) continue;
    const firstToken = sn.split(/\s+/)[0];
    if (!firstToken || firstToken === row.simple_name) continue;
    const k = findSubkeyByScopeName(firstToken);
    if (k) return k;
  }
  return null;
}

/** Find a key by scope_name (preferring matching scope_rank when given).
 *  Also matches keys whose `aliases` JSON array contains the token.
 *
 *  Used by:
 *  - `findSubkeyForTaxon` (with mapped scope from taxon rank)
 *  - Key-runner lead-text fallback (when a terminal's target_id is null
 *    but the lead text starts with a known scope name, e.g. PDF lead
 *    "Bambusoideae 竹亞科" within Poaceae family key → navigate to the
 *    Bambusoideae subkey).
 *
 *  When `preferredRank` is provided, results matching that rank rank
 *  ahead of others. Otherwise we pick the most specific available scope
 *  (subfamily/tribe/genus before family) so the navigation lands on the
 *  finer-grained key when both exist. */
export function findSubkeyByScopeName(
  token: string,
  preferredRank?: string,
): IdentificationKey | null {
  const t = (token ?? '').trim();
  if (!t) return null;
  const db = getTaicolDb();
  // We use a UNION to keep the query plan simple: first try aliases match
  // (rare but explicit), then scope_name match. Order results by:
  //   1. exact scope_rank match when preferredRank given
  //   2. specificity (genus > subfamily > family) as a sensible default
  const rankOrder = preferredRank
    ? `CASE WHEN k.scope_rank = ? THEN 0 ELSE 1 END,`
    : '';
  const rankSpecificity = `CASE k.scope_rank
    WHEN 'genus' THEN 1
    WHEN 'subgenus' THEN 2
    WHEN 'tribe' THEN 3
    WHEN 'subfamily' THEN 4
    WHEN 'family' THEN 5
    ELSE 9 END`;
  // Placeholder order in the SQL below is: scope_name, alias_value,
  // (optionally) scope_rank for the ORDER BY tiebreaker. Pass params in
  // that exact order — the previous [preferredRank, t, t] arrangement
  // bound preferredRank into scope_name (`WHERE scope_name='genus'`),
  // so no row ever matched and the subkey button silently never showed.
  const params: any[] = preferredRank ? [t, t, preferredRank] : [t, t];
  const sql = `${KEY_SELECT_SQL}
    WHERE k.scope_name = ?
       OR (k.aliases IS NOT NULL AND EXISTS (
            SELECT 1 FROM json_each(k.aliases) WHERE value = ?
          ))
    ORDER BY ${rankOrder} ${rankSpecificity}
    LIMIT 1`;
  const res = db.executeSync(sql, params);
  return ((res.rows ?? [])[0] as IdentificationKey | undefined) ?? null;
}

/** Plural variant of `findSubkeyByScopeName`: returns ALL matching keys
 *  (one per mode). The same scope can carry both a dichotomous and a
 *  multi_access key — the runner offers a button for each.
 *
 *  Sort order matches the singular version (preferredRank wins, then by
 *  rank specificity), with mode as the tiebreaker so dichotomous comes
 *  before multi_access. */
export function findSubkeysByScopeName(
  token: string,
  preferredRank?: string,
): IdentificationKey[] {
  const t = (token ?? '').trim();
  if (!t) return [];
  const db = getTaicolDb();
  const rankOrder = preferredRank
    ? `CASE WHEN k.scope_rank = ? THEN 0 ELSE 1 END,`
    : '';
  const rankSpecificity = `CASE k.scope_rank
    WHEN 'genus' THEN 1
    WHEN 'subgenus' THEN 2
    WHEN 'tribe' THEN 3
    WHEN 'subfamily' THEN 4
    WHEN 'family' THEN 5
    ELSE 9 END`;
  const modeOrder = `CASE k.mode
    WHEN 'dichotomous' THEN 0
    WHEN 'multi_access' THEN 1
    WHEN 'both' THEN 2
    ELSE 3 END`;
  // Placeholder order: scope_name, alias_value, optional rank for ORDER BY.
  // See findSubkeyByScopeName above — same param-order trap, kept in sync.
  const params: any[] = preferredRank ? [t, t, preferredRank] : [t, t];
  const sql = `${KEY_SELECT_SQL}
    WHERE k.scope_name = ?
       OR (k.aliases IS NOT NULL AND EXISTS (
            SELECT 1 FROM json_each(k.aliases) WHERE value = ?
          ))
    ORDER BY ${rankOrder} ${rankSpecificity}, ${modeOrder}
    LIMIT 8`;
  const res = db.executeSync(sql, params);
  return ((res.rows ?? []) as unknown) as IdentificationKey[];
}

/** Plural variant of `findSubkeyForTaxon`: returns all subkeys (one per
 *  mode) for the taxon's rank-mapped scope. Empty array if none. */
export function findSubkeysForTaxon(taxonId: string): IdentificationKey[] {
  if (!taxonId) return [];
  const db = getTaicolDb();
  let res = db.executeSync(
    `SELECT simple_name, rank FROM taicol_names
      WHERE taxon_id = ? AND usage_status = 'accepted' LIMIT 1`,
    [taxonId],
  );
  let row = (res.rows ?? [])[0] as { simple_name: string; rank: string } | undefined;
  if (!row) {
    res = db.executeSync(
      `SELECT simple_name, rank FROM taicol_names WHERE taxon_id = ? LIMIT 1`,
      [taxonId],
    );
    row = (res.rows ?? [])[0] as { simple_name: string; rank: string } | undefined;
  }
  if (!row || !row.simple_name) return [];
  const scope = RANK_TO_SCOPE[row.rank];
  return findSubkeysByScopeName(row.simple_name, scope);
}

/** Lead-text fallback: when a key runner reaches a terminal lead whose
 *  `target_id` is null (PDF wrote a sub-scope pointer like "Bambusoideae
 *  竹亞科" not a leaf taxon), parse the lead text for a candidate
 *  scope_name token and look up a subkey.
 *
 *  Strategy: take the first whitespace-separated token of the lead. PDF
 *  convention puts the Latin scope name first; the CJK descriptor follows
 *  ("Bambusoideae 竹亞科"). Returns null when the lead clearly isn't a
 *  scope-name pointer (no Latin first token, etc.). */
export function findSubkeyFromLeadText(leadText: string): IdentificationKey | null {
  const s = (leadText ?? '').trim();
  if (!s) return null;
  const firstToken = s.split(/\s+/)[0];
  if (!firstToken) return null;
  // Must look like a Latin name: leading uppercase ASCII letter.
  if (!/^[A-Z][a-zA-Z×-]+$/.test(firstToken)) return null;
  return findSubkeyByScopeName(firstToken);
}

/**
 * Lookup taxon info by taxon_id. Prefers the accepted-name row; falls back
 * to any row matching the id (so synonym-only ids still produce sensible UI).
 */
export function getKeyTaxonInfo(taxonId: string): KeyTaxonInfo | null {
  const db = getTaicolDb();
  // accepted first
  let res = db.executeSync(
    `SELECT taxon_id, simple_name, name_author, common_name_c, alternative_name_c,
            family, family_c, rank, kingdom,
            redlist, iucn, cites, protected, is_endemic, alien_type
       FROM taicol_names
      WHERE taxon_id = ? AND usage_status = 'accepted'
      LIMIT 1`,
    [taxonId],
  );
  let row = (res.rows ?? [])[0] as KeyTaxonInfo | undefined;
  if (row) return row;
  res = db.executeSync(
    `SELECT taxon_id, simple_name, name_author, common_name_c, alternative_name_c,
            family, family_c, rank, kingdom,
            redlist, iucn, cites, protected, is_endemic, alien_type
       FROM taicol_names
      WHERE taxon_id = ?
      LIMIT 1`,
    [taxonId],
  );
  row = (res.rows ?? [])[0] as KeyTaxonInfo | undefined;
  return row ?? null;
}
