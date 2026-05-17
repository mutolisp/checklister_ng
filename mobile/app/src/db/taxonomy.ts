/**
 * Taxonomy tree query helpers.
 * Port of backend/api/taxonomy_api.py — MVP scope skips virus realm handling
 * (defer to iteration after first taxonomy ship).
 */
import { getTaicolDb } from './init';

export const RANK_ORDER = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as const;
export type Rank = (typeof RANK_ORDER)[number];
export type ChildRank = Rank | 'species';

export const RANK_LABELS: Record<string, string> = {
  kingdom: '界',
  phylum: '門',
  class: '綱',
  order: '目',
  family: '科',
  genus: '屬',
  species: '種',
};

const RANK_C_COL: Record<string, string> = {
  kingdom: 'kingdom_c',
  phylum: 'phylum_c',
  class: 'class_c',
  order: 'order_c',
  family: 'family_c',
  genus: 'genus_c',
};

const VIRUS_KINGDOMS = new Set([
  'Bamfordvirae',
  'Heunggongvirae',
  'Orthornavirae',
  'Pararnavirae',
  'Shotokuvirae',
  'Ribozyviria kingdom incertae sedis',
  'Viruses kingdom incertae sedis',
]);

/**
 * Ancestor chain leading to a node (NOT including the node itself).
 * Empty for kingdom-level nodes. Required at every drill-down because
 * scientific names (especially genera like Taiwania, Pieris, Aotus) are
 * homonyms across kingdoms — ICN (plants) and ICZN (animals) don't enforce
 * uniqueness across each other. Filtering by immediate parent only would
 * mix species from the homonym in the other kingdom.
 */
export type Ancestors = Partial<Record<Rank, string>>;

export type TaxonNode = {
  name: string;
  name_c: string;
  rank: string;
  rank_key: string;
  child_rank: ChildRank;
  stats: Record<string, number>;
  ancestors: Ancestors;
};

function quoteCol(col: string): string {
  return col === 'order' || col === 'class' ? `"${col}"` : col;
}

/** Stable, lineage-unique key for a tree node. The same scientific name in
 *  two kingdoms (e.g. genus Taiwania in Plantae vs Animalia) collides under
 *  the naïve `${rank}:${name}` scheme — full-path keys keep both branches
 *  independent in expanded set / childrenMap / speciesMap. */
export function nodeKeyFor(node: {
  rank_key: string;
  name: string;
  ancestors: Ancestors;
}): string {
  const parts: string[] = [];
  for (const r of RANK_ORDER) {
    const v = node.ancestors[r];
    if (v) parts.push(`${r}:${v}`);
  }
  parts.push(`${node.rank_key}:${node.name}`);
  return parts.join('|');
}

/** Build `AND col = ?` fragments for every populated ancestor rank.
 *  Mutates `params` in place. Returns the SQL fragment (with leading space)
 *  or empty string if no ancestors. */
function buildAncestorWhere(ancestors: Ancestors | undefined, params: string[]): string {
  if (!ancestors) return '';
  let where = '';
  for (const r of RANK_ORDER) {
    const v = ancestors[r];
    if (v) {
      where += ` AND ${quoteCol(r)} = ?`;
      params.push(v);
    }
  }
  return where;
}

function buildStatsCols(rankIdx: number): string {
  const cols: string[] = [];
  for (const r of RANK_ORDER.slice(rankIdx + 1)) {
    cols.push(`COUNT(DISTINCT ${quoteCol(r)}) AS ${r}_count`);
  }
  cols.push("SUM(CASE WHEN rank='Species' THEN 1 ELSE 0 END) AS species_count");
  cols.push(
    "SUM(CASE WHEN rank IN ('Subspecies','Variety','Form') THEN 1 ELSE 0 END) AS infraspecific_count",
  );
  return cols.join(', ');
}

function buildStatsDict(row: Record<string, unknown>, rankIdx: number): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const r of RANK_ORDER.slice(rankIdx + 1)) {
    const key = `${r}_count`;
    if (key in row) stats[RANK_LABELS[r]] = (row[key] as number) ?? 0;
  }
  stats[RANK_LABELS.species] = (row.species_count as number) ?? 0;
  const infra = (row.infraspecific_count as number) ?? 0;
  if (infra) stats['種下'] = infra;
  return stats;
}

/** Module-level cache for the top-level kingdom listing. The bundled TaiCOL
 *  DB is read-only at runtime so the result never changes mid-session.
 *  Hit by `getTopLevel()` → triggered by every taxonomy tab mount; the
 *  uncached SQL runs ~200ms (GROUP BY + 7 aggregations over in-Taiwan
 *  accepted rows) which is enough to feel laggy when switching tabs. */
let CACHED_KINGDOMS: TaxonNode[] | null = null;

function getTopLevel(): TaxonNode[] {
  if (CACHED_KINGDOMS === null) CACHED_KINGDOMS = computeTopLevel();
  return CACHED_KINGDOMS;
}

/** Force-fill the kingdom cache. Mirrors `prewarmKeys()` / `prewarmFuzzyIndex()`:
 *  call from DBProvider after splash so the first taxonomy tab open is
 *  instant instead of paying the ~200ms SQL cost on mount. */
export function prewarmKingdoms(): void {
  if (CACHED_KINGDOMS === null) CACHED_KINGDOMS = computeTopLevel();
}

/**
 * Top-level: non-virus kingdoms.
 * (Virus realm handling deferred from MVP.)
 */
function computeTopLevel(): TaxonNode[] {
  const db = getTaicolDb();
  const virusList = [...VIRUS_KINGDOMS].map((k) => `'${k.replace(/'/g, "''")}'`).join(', ');
  const statsCols = buildStatsCols(0);
  const cCol = RANK_C_COL.kingdom;

  const sql = `
    SELECT kingdom AS name, ${statsCols}, MAX(${cCol}) AS name_c
    FROM taicol_names
    WHERE usage_status='accepted'
      AND is_in_taiwan LIKE '%true%'
      AND rank IN ('Species','Subspecies','Variety','Form')
      AND kingdom NOT IN (${virusList})
    GROUP BY kingdom
    HAVING name IS NOT NULL AND name != ''
    ORDER BY name
  `;

  const res = db.executeSync(sql);
  const rows = (res.rows ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: row.name as string,
    name_c: (row.name_c as string) ?? '',
    rank: RANK_LABELS.kingdom,
    rank_key: 'kingdom',
    child_rank: 'phylum',
    stats: buildStatsDict(row, 0),
    ancestors: {},
  }));
}

export type ChildrenOptions = {
  rank: ChildRank;
  /**
   * Ancestors of the children we want. e.g. when loading genera under
   * Cupressaceae, pass `{kingdom:'Plantae', phylum:'Tracheophyta',
   * class:'Pinopsida', order:'Pinales', family:'Cupressaceae'}`. Pass
   * `undefined` / `{}` only for the top-level kingdom listing.
   */
  ancestors?: Ancestors;
};

export function getTaxonChildren(opts: ChildrenOptions): TaxonNode[] {
  const hasAncestors = opts.ancestors && Object.keys(opts.ancestors).length > 0;
  if (opts.rank === 'kingdom' && !hasAncestors) return getTopLevel();
  if (opts.rank === 'species') return getSpeciesAsNodes();
  if (opts.rank === 'kingdom') return [];

  const rankIdx = RANK_ORDER.indexOf(opts.rank);
  if (rankIdx === -1) return [];

  const db = getTaicolDb();
  const statsCols = buildStatsCols(rankIdx);
  const cCol = RANK_C_COL[opts.rank];
  const extraCols = cCol ? `, MAX(${cCol}) AS name_c` : '';
  const dbCol = quoteCol(opts.rank);

  let where = `usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank IN ('Species','Subspecies','Variety','Form')`;
  const params: string[] = [];
  where += buildAncestorWhere(opts.ancestors, params);

  const sql = `
    SELECT ${dbCol} AS name, ${statsCols} ${extraCols}
    FROM taicol_names
    WHERE ${where}
    GROUP BY ${dbCol}
    HAVING name IS NOT NULL AND name != ''
    ORDER BY name
  `;
  const res = db.executeSync(sql, params);
  const rows = (res.rows ?? []) as Array<Record<string, unknown>>;
  const childRank: ChildRank = rankIdx + 1 < RANK_ORDER.length ? RANK_ORDER[rankIdx + 1] : 'species';
  const ancestors: Ancestors = opts.ancestors ?? {};

  return rows.map((row) => ({
    name: row.name as string,
    name_c: (row.name_c as string) ?? '',
    rank: RANK_LABELS[opts.rank],
    rank_key: opts.rank,
    child_rank: childRank,
    stats: buildStatsDict(row, rankIdx),
    ancestors,
  }));
}

export type TaxonSpecies = {
  taxon_id: string;
  simple_name: string;
  name_author: string;
  common_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  is_endemic: string;
  alien_type: string;
  redlist: string;
  iucn: string;
  cites: string;
  protected: string;
  is_hybrid: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  genus: string;
  alternative_name_c: string;
  nomenclature_name: string;
  is_autonym: boolean;
};

function isAutonym(simpleName: string, rank: string): boolean {
  if (!['Subspecies', 'Variety', 'Form'].includes(rank)) return false;
  const parts = (simpleName || '').split(/\s+/);
  return parts.length >= 3 && parts[1] === parts[parts.length - 1];
}

export function getSpeciesUnder(ancestors?: Ancestors): TaxonSpecies[] {
  const db = getTaicolDb();
  let where = `usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank IN ('Species','Subspecies','Variety','Form')`;
  const params: string[] = [];
  where += buildAncestorWhere(ancestors, params);
  const sql = `
    SELECT taxon_id, simple_name, name_author, common_name_c, family, family_c, rank,
           is_endemic, alien_type, redlist, iucn, cites, protected, is_hybrid,
           kingdom, phylum, class, "order", genus, alternative_name_c, nomenclature_name
    FROM taicol_names
    WHERE ${where}
    ORDER BY simple_name
  `;
  const res = db.executeSync(sql, params);
  const rows = (res.rows ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    taxon_id: (row.taxon_id as string) ?? '',
    simple_name: (row.simple_name as string) ?? '',
    name_author: (row.name_author as string) ?? '',
    common_name_c: (row.common_name_c as string) ?? '',
    family: (row.family as string) ?? '',
    family_c: (row.family_c as string) ?? '',
    rank: (row.rank as string) ?? '',
    is_endemic: (row.is_endemic as string) ?? '',
    alien_type: (row.alien_type as string) ?? '',
    redlist: (row.redlist as string) ?? '',
    iucn: (row.iucn as string) ?? '',
    cites: (row.cites as string) ?? '',
    protected: (row.protected as string) ?? '',
    is_hybrid: (row.is_hybrid as string) ?? '',
    kingdom: (row.kingdom as string) ?? '',
    phylum: (row.phylum as string) ?? '',
    class: (row.class as string) ?? '',
    order: (row.order as string) ?? '',
    genus: (row.genus as string) ?? '',
    alternative_name_c: (row.alternative_name_c as string) ?? '',
    nomenclature_name: (row.nomenclature_name as string) ?? '',
    is_autonym: isAutonym((row.simple_name as string) ?? '', (row.rank as string) ?? ''),
  }));
}

function getSpeciesAsNodes(): TaxonNode[] {
  // The actual species rendering uses getSpeciesUnder + a different list UI.
  return [];
}

/**
 * Taxonomy search: find taxa by Chinese / Latin name across all ranks.
 * Returns each match with the full ancestor path for tree expansion.
 *
 * Port of backend taxonomy_search (skips virus realm prefix for MVP).
 */
export type TaxonSearchHit = {
  display: string;
  name: string;
  cname: string;
  rank: string;
  author: string;
  path: Array<{ rank: Rank; value: string }>;
};

function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizeTw(q: string): string[] {
  const variants = [q];
  if (q.includes('台')) variants.push(q.replaceAll('台', '臺'));
  else if (q.includes('臺')) variants.push(q.replaceAll('臺', '台'));
  return variants;
}

const RANK_PRIORITY: Record<string, number> = {
  Phylum: 1,
  Class: 2,
  Order: 3,
  Family: 4,
  Genus: 5,
  Species: 6,
  Subspecies: 6,
  Variety: 6,
  Form: 6,
};

export function searchTaxonomy(q: string): TaxonSearchHit[] {
  const trimmed = q.trim();
  if (trimmed.length < 1) return [];

  const variants = normalizeTw(trimmed);
  const db = getTaicolDb();

  const conditions: string[] = [];
  const params: string[] = [];
  const cols = ['common_name_c', 'simple_name', 'family_c', 'family', 'genus', 'genus_c', 'order_c', 'class_c', 'phylum_c'];
  for (const v of variants) {
    const pattern = `%${escapeLike(v)}%`;
    for (const col of cols) {
      conditions.push(`${col} LIKE ? ESCAPE '\\'`);
      params.push(pattern);
    }
  }

  const sql = `
    SELECT DISTINCT simple_name, common_name_c, rank,
           kingdom, kingdom_c, phylum, phylum_c,
           class, class_c, "order", order_c,
           family, family_c, genus, genus_c,
           name_author
    FROM taicol_names
    WHERE (${conditions.join(' OR ')})
      AND usage_status = 'accepted'
      AND is_in_taiwan LIKE '%true%'
      AND rank IN ('Species', 'Subspecies', 'Variety', 'Form', 'Genus', 'Family', 'Order', 'Class', 'Phylum')
    LIMIT 50
  `;

  const res = db.executeSync(sql, params);
  const rows = (res.rows ?? []) as Array<Record<string, unknown>>;

  const hits: TaxonSearchHit[] = rows.map((r) => {
    const cname = (r.common_name_c as string) ?? '';
    const sname = (r.simple_name as string) ?? '';
    const rank = (r.rank as string) ?? '';
    const display = cname ? `${cname} (${sname})` : sname;

    const path: Array<{ rank: Rank; value: string }> = [];
    for (const level of RANK_ORDER) {
      const val = (r[level] as string) ?? '';
      if (val) path.push({ rank: level, value: val });
    }

    return {
      display,
      name: sname,
      cname,
      rank,
      author: (r.name_author as string) ?? '',
      path,
    };
  });

  hits.sort((a, b) => {
    const pa = RANK_PRIORITY[a.rank] ?? 9;
    const pb = RANK_PRIORITY[b.rank] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  return hits.slice(0, 20);
}
