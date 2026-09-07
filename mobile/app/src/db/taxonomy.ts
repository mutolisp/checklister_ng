/**
 * Taxonomy tree query helpers.
 * Port of backend/api/taxonomy_api.py — MVP scope skips virus realm handling
 * (defer to iteration after first taxonomy ship).
 */
import { getTaicolDb } from './init';
import { searchWithFuzzyFallback } from './fuzzy';
import {
  getEnabledRegions,
  regionOfTaxonId,
  normalizeSci,
  crossRegionVernacular,
  composeVernacular,
} from './regions';
import {
  packInfraspeciesOf,
  packScopeSig,
  packSpeciesUnder,
  packTreeChildren,
  searchPackLineages,
  type PackSpeciesRow,
  type PackTreeNodeRow,
} from './regionpacks';
import type { SearchResult } from './types';

/**
 * Scope for the BUNDLED half of tree queries (twnamelist.db). Three states:
 * TW+JP → the `all_names` view (single query, DISTINCT counts stay exact —
 * splitting into two queries would double-count shared genera); TW only →
 * the original taicol_names path, byte-identical to pre-region behavior;
 * JP only → jp_names directly. `null` when neither bundled region is on
 * (packs-only mode) — callers then skip the bundled query entirely.
 * Region packs live in a different DB file and are ALWAYS a separate query
 * merged in JS (this app never ATTACHes).
 */
function bundledScope(): { table: string; taiwanClause: string } | null {
  const regions = getEnabledRegions();
  const tw = regions.includes('TW');
  const jp = regions.includes('JP');
  if (tw && jp)
    return { table: 'all_names', taiwanClause: "(is_in_taiwan LIKE '%true%' OR region='JP')" };
  if (tw) return { table: 'taicol_names', taiwanClause: "is_in_taiwan LIKE '%true%'" };
  if (jp) return { table: 'jp_names', taiwanClause: "region='JP'" };
  return null;
}

/** Merge pack tree rows into bundled nodes: same-name nodes combine (stats
 *  added — an approximation, since a species present in two sources counts
 *  once per source at this level; leaf species lists DO dedupe), pack-only
 *  nodes are appended. Sorted by name to match the SQL ORDER BY. */
function mergePackNodes(
  bundled: TaxonNode[],
  packRows: PackTreeNodeRow[],
  rank: string,
  childRank: ChildRank,
  ancestors: Ancestors,
): TaxonNode[] {
  if (packRows.length === 0) return bundled;
  const byName = new Map(bundled.map((n) => [n.name, n]));
  for (const pr of packRows) {
    const existing = byName.get(pr.name);
    if (existing) {
      for (const [k, v] of Object.entries(pr.stats)) {
        existing.stats[k] = (existing.stats[k] ?? 0) + v;
      }
    } else {
      byName.set(pr.name, {
        name: pr.name,
        name_c: '',
        rank,
        rank_key: rank,
        child_rank: childRank,
        stats: pr.stats,
        ancestors,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const RANK_ORDER = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as const;
export type Rank = (typeof RANK_ORDER)[number];
export type ChildRank = Rank | 'species';

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
  // Keyed by language-independent rank-key (e.g. 'phylum', 'species',
  // 'infraspecific'); the tree row localizes via t('rank.'+key) at render so
  // the kingdom cache / fetched nodes re-localize on a language switch.
  const stats: Record<string, number> = {};
  for (const r of RANK_ORDER.slice(rankIdx + 1)) {
    const key = `${r}_count`;
    if (key in row) stats[r] = (row[key] as number) ?? 0;
  }
  stats['species'] = (row.species_count as number) ?? 0;
  const infra = (row.infraspecific_count as number) ?? 0;
  if (infra) stats['infraspecific'] = infra;
  return stats;
}

/** Module-level cache for the top-level kingdom listing. The bundled TaiCOL
 *  DB is read-only at runtime so the result never changes mid-session.
 *  Hit by `getTopLevel()` → triggered by every taxonomy tab mount; the
 *  uncached SQL runs ~200ms (GROUP BY + 7 aggregations over in-Taiwan
 *  accepted rows) which is enough to feel laggy when switching tabs. */
let CACHED_KINGDOMS: TaxonNode[] | null = null;
/** Region signature the kingdom cache was computed under; cache is invalid when
 *  the enabled regions change (JP toggled in settings). */
let CACHED_KINGDOMS_SCOPE: string | null = null;

function scopeSig(): string {
  return `${getEnabledRegions().join(',')}|${packScopeSig()}`;
}

/** Exposed for the taxonomy screen: it must reset its in-memory tree when the
 *  dataset scope changed while it stayed mounted (the tab never remounts). */
export function taxonomyScopeSig(): string {
  return scopeSig();
}

function getTopLevel(): TaxonNode[] {
  const sig = scopeSig();
  if (CACHED_KINGDOMS === null || CACHED_KINGDOMS_SCOPE !== sig) {
    CACHED_KINGDOMS = computeTopLevel();
    CACHED_KINGDOMS_SCOPE = sig;
  }
  return CACHED_KINGDOMS;
}

/** Force-fill the kingdom cache. Mirrors `prewarmKeys()` / `prewarmFuzzyIndex()`:
 *  call from DBProvider after splash so the first taxonomy tab open is
 *  instant instead of paying the ~200ms SQL cost on mount. */
export function prewarmKingdoms(): void {
  getTopLevel();
}

/** Invalidate the kingdom cache — call when enabled regions change so the tree
 *  reflects the new dataset on next open. */
export function clearTaxonomyCache(): void {
  CACHED_KINGDOMS = null;
  CACHED_KINGDOMS_SCOPE = null;
}

/**
 * Top-level: non-virus kingdoms.
 * (Virus realm handling deferred from MVP.)
 */
function computeTopLevel(): TaxonNode[] {
  const scope = bundledScope();
  let nodes: TaxonNode[] = [];
  if (scope) {
    const db = getTaicolDb();
    const virusList = [...VIRUS_KINGDOMS].map((k) => `'${k.replace(/'/g, "''")}'`).join(', ');
    const statsCols = buildStatsCols(0);
    const cCol = RANK_C_COL.kingdom;
    const sql = `
      SELECT kingdom AS name, ${statsCols}, MAX(${cCol}) AS name_c
      FROM ${scope.table}
      WHERE usage_status='accepted'
        AND ${scope.taiwanClause}
        AND rank IN ('Species','Subspecies','Variety','Form')
        AND kingdom NOT IN (${virusList})
      GROUP BY kingdom
      HAVING name IS NOT NULL AND name != ''
      ORDER BY name
    `;
    const res = db.executeSync(sql);
    nodes = ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      name: row.name as string,
      name_c: (row.name_c as string) ?? '',
      rank: 'kingdom',
      rank_key: 'kingdom',
      child_rank: 'phylum',
      stats: buildStatsDict(row, 0),
      ancestors: {},
    }));
  }
  // Virus handling is deferred app-wide; GBIF-derived packs use the plain
  // kingdom name 'Viruses', which the bundled exclusion list doesn't carry.
  const packRows = packTreeChildren('kingdom', {}).filter(
    (r) => !VIRUS_KINGDOMS.has(r.name) && r.name !== 'Viruses',
  );
  return mergePackNodes(nodes, packRows, 'kingdom', 'phylum', {});
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

  const childRank: ChildRank = rankIdx + 1 < RANK_ORDER.length ? RANK_ORDER[rankIdx + 1] : 'species';
  const ancestors: Ancestors = opts.ancestors ?? {};
  const scope = bundledScope();
  let nodes: TaxonNode[] = [];
  if (scope) {
    const db = getTaicolDb();
    const statsCols = buildStatsCols(rankIdx);
    const cCol = RANK_C_COL[opts.rank];
    const extraCols = cCol ? `, MAX(${cCol}) AS name_c` : '';
    const dbCol = quoteCol(opts.rank);

    let where = `usage_status='accepted' AND ${scope.taiwanClause} AND rank IN ('Species','Subspecies','Variety','Form')`;
    const params: string[] = [];
    where += buildAncestorWhere(opts.ancestors, params);

    const sql = `
      SELECT ${dbCol} AS name, ${statsCols} ${extraCols}
      FROM ${scope.table}
      WHERE ${where}
      GROUP BY ${dbCol}
      HAVING name IS NOT NULL AND name != ''
      ORDER BY name
    `;
    const res = db.executeSync(sql, params);
    nodes = ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      name: row.name as string,
      name_c: (row.name_c as string) ?? '',
      rank: opts.rank,
      rank_key: opts.rank,
      child_rank: childRank,
      stats: buildStatsDict(row, rankIdx),
      ancestors,
    }));
  }
  return mergePackNodes(nodes, packTreeChildren(opts.rank, opts.ancestors), opts.rank, childRank, ancestors);
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
  kingdom_c: string;
  phylum: string;
  phylum_c: string;
  class: string;
  class_c: string;
  order: string;
  order_c: string;
  genus: string;
  genus_c: string;
  alternative_name_c: string;
  nomenclature_name: string;
  alien_status_note: string;
  is_autonym: boolean;
  /** ISO country code of the region pack this row came from (GBIF-derived,
   *  not checklist-verified) — drives the provenance badge. */
  pack_country?: string;
};

/** Merge preference when the same scientific name appears in several sources:
 *  TaiCOL ('t…') carries the richest data, then YList ('y…'), then packs. */
function idPreference(taxonId: string): number {
  const c = taxonId.charAt(0);
  return c === 't' ? 0 : c === 'y' ? 1 : 2;
}

function packRowToTaxonSpecies(r: PackSpeciesRow): TaxonSpecies {
  // Pack ranks are lowercase; the tree's autonym check and rank chips expect
  // TaiCOL-style capitalized values.
  const rank = r.rank ? r.rank.charAt(0).toUpperCase() + r.rank.slice(1) : '';
  return {
    taxon_id: r.taxon_id,
    simple_name: r.simple_name,
    name_author: r.name_author,
    common_name_c: '',
    family: r.family,
    family_c: '',
    rank,
    is_endemic: '',
    alien_type: '',
    redlist: '',
    iucn: r.iucn,
    cites: '',
    protected: '',
    is_hybrid: '',
    kingdom: r.kingdom,
    kingdom_c: '',
    phylum: r.phylum,
    phylum_c: '',
    class: r.class,
    class_c: '',
    order: r.order,
    order_c: '',
    genus: r.genus,
    genus_c: '',
    alternative_name_c: '',
    nomenclature_name: '',
    alien_status_note: '',
    is_autonym: isAutonym(r.simple_name, rank),
    pack_country: r.country_code,
  };
}

function isAutonym(simpleName: string, rank: string): boolean {
  if (!['Subspecies', 'Variety', 'Form'].includes(rank)) return false;
  const parts = (simpleName || '').split(/\s+/);
  return parts.length >= 3 && parts[1] === parts[parts.length - 1];
}

const TAXON_SPECIES_COLUMNS = `
  taxon_id, simple_name, name_author, common_name_c, family, family_c, rank,
  is_endemic, alien_type, redlist, iucn, cites, protected, is_hybrid,
  kingdom, kingdom_c, phylum, phylum_c, class, class_c, "order", order_c,
  genus, genus_c, alternative_name_c, nomenclature_name, alien_status_note
`;

function taxonRowToSpecies(row: Record<string, unknown>): TaxonSpecies {
  return {
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
    kingdom_c: (row.kingdom_c as string) ?? '',
    phylum: (row.phylum as string) ?? '',
    phylum_c: (row.phylum_c as string) ?? '',
    class: (row.class as string) ?? '',
    class_c: (row.class_c as string) ?? '',
    order: (row.order as string) ?? '',
    order_c: (row.order_c as string) ?? '',
    genus: (row.genus as string) ?? '',
    genus_c: (row.genus_c as string) ?? '',
    alternative_name_c: (row.alternative_name_c as string) ?? '',
    nomenclature_name: (row.nomenclature_name as string) ?? '',
    alien_status_note: (row.alien_status_note as string) ?? '',
    is_autonym: isAutonym((row.simple_name as string) ?? '', (row.rank as string) ?? ''),
  };
}

export function getSpeciesUnder(ancestors?: Ancestors): TaxonSpecies[] {
  const regions = getEnabledRegions();
  const scope = bundledScope();
  let species: TaxonSpecies[] = [];
  if (scope) {
    const db = getTaicolDb();
    let where = `usage_status='accepted' AND ${scope.taiwanClause} AND rank IN ('Species','Subspecies','Variety','Form')`;
    const params: string[] = [];
    where += buildAncestorWhere(ancestors, params);
    const sql = `SELECT ${TAXON_SPECIES_COLUMNS} FROM ${scope.table} WHERE ${where} ORDER BY simple_name`;
    const res = db.executeSync(sql, params);
    species = ((res.rows ?? []) as Array<Record<string, unknown>>).map(taxonRowToSpecies);
  }
  const packRows = packSpeciesUnder(ancestors).map(packRowToTaxonSpecies);
  const multiSource = packRows.length > 0 || (regions.includes('TW') && regions.includes('JP'));
  if (packRows.length > 0) species = species.concat(packRows);

  if (multiSource) {
    // Collapse shared species (same scientific name across sources) to one
    // row, preferring TaiCOL > YList > pack for hierarchy/conservation.
    const byKey = new Map<string, TaxonSpecies>();
    for (const sp of species) {
      const key = normalizeSci(sp.simple_name);
      const existing = byKey.get(key);
      if (!existing || idPreference(sp.taxon_id) < idPreference(existing.taxon_id)) {
        byKey.set(key, sp);
      }
    }
    species = [...byKey.values()].sort((a, b) => a.simple_name.localeCompare(b.simple_name));
  }
  if (regions.includes('TW') && regions.includes('JP')) {
    // Cross-region vernacular ("臺灣俗名 / 和名") only means something with
    // both bundled regions on.
    const cross = crossRegionVernacular(
      species.map((sp) => sp.taxon_id),
      regions,
    );
    species = species.map((sp) => ({
      ...sp,
      common_name_c: composeVernacular(
        sp.common_name_c,
        regionOfTaxonId(sp.taxon_id),
        cross.get(sp.taxon_id),
        regions,
      ),
    }));
  }
  return species;
}

function getSpeciesAsNodes(): TaxonNode[] {
  // The actual species rendering uses getSpeciesUnder + a different list UI.
  return [];
}

/** Accepted infraspecies (Subspecies / Variety / Form) sitting under a binomial
 *  species name. Used by the species detail panel to surface "下級分類群". The
 *  caller passes the binomial + the species' ancestor chain so we can defend
 *  against homonym genera by matching ancestors as well as the LIKE prefix. */
export function getInfraspeciesOf(
  speciesName: string,
  ancestors?: Ancestors,
): TaxonSpecies[] {
  if (!speciesName || speciesName.split(/\s+/).length !== 2) return [];
  const scope = bundledScope();
  let out: TaxonSpecies[] = [];
  if (scope) {
    const db = getTaicolDb();
    const pattern = `${speciesName.replace(/%/g, '\\%').replace(/_/g, '\\_')} %`;
    const params: string[] = [pattern, speciesName];
    let where = `simple_name LIKE ? ESCAPE '\\'
        AND simple_name != ?
        AND rank IN ('Subspecies','Variety','Form')
        AND usage_status='accepted'
        AND ${scope.taiwanClause}`;
    where += buildAncestorWhere(ancestors, params);
    const sql = `SELECT ${TAXON_SPECIES_COLUMNS} FROM ${scope.table} WHERE ${where} ORDER BY simple_name`;
    const res = db.executeSync(sql, params);
    out = ((res.rows ?? []) as Array<Record<string, unknown>>).map(taxonRowToSpecies);
  }
  const packRows = packInfraspeciesOf(speciesName, ancestors).map(packRowToTaxonSpecies);
  if (packRows.length > 0) {
    const byKey = new Map<string, TaxonSpecies>();
    for (const sp of [...out, ...packRows]) {
      const key = normalizeSci(sp.simple_name);
      const existing = byKey.get(key);
      if (!existing || idPreference(sp.taxon_id) < idPreference(existing.taxon_id)) {
        byKey.set(key, sp);
      }
    }
    out = [...byKey.values()].sort((a, b) => a.simple_name.localeCompare(b.simple_name));
  }
  return out;
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
  /** Set when the user's query matched a synonym that resolved to this
   *  accepted name (mirrors SearchResult.matched_as in the main search). */
  matched_as?: { name: string; fullname: string; status: string };
  /** Set when this hit came from the fuzzy (Levenshtein) fallback. */
  fuzzy_match?: { query: string; matched: string; score: number };
};

/** Map a species-level `SearchResult` (from the main search pipeline, which
 *  already does synonym resolution + fuzzy fallback) onto a `TaxonSearchHit`
 *  so the taxonomy tree can expand to it. The ancestor `path` is built from
 *  the accepted row's hierarchy columns. */
function resultToTaxonHit(r: SearchResult): TaxonSearchHit {
  const levelVals: Record<Rank, string> = {
    kingdom: r.kingdom,
    phylum: r.phylum,
    class: r.class_name,
    order: r.order,
    family: r.family,
    genus: r.genus,
  };
  const path: Array<{ rank: Rank; value: string }> = [];
  for (const level of RANK_ORDER) {
    const val = levelVals[level];
    if (val) path.push({ rank: level, value: val });
  }
  const display = r.cname ? `${r.cname} (${r.name})` : r.name;
  return {
    display,
    name: r.name,
    cname: r.cname,
    rank: r.rank,
    author: r.fullname.replace(r.name, '').trim(),
    path,
    matched_as: r.matched_as,
    fuzzy_match: r.fuzzy_match,
  };
}

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

  const scope = bundledScope();
  let rows: Array<Record<string, unknown>> = [];
  if (scope) {
    const sql = `
      SELECT DISTINCT simple_name, common_name_c, rank,
             kingdom, kingdom_c, phylum, phylum_c,
             class, class_c, "order", order_c,
             family, family_c, genus, genus_c,
             name_author
      FROM ${scope.table}
      WHERE (${conditions.join(' OR ')})
        AND usage_status = 'accepted'
        AND ${scope.taiwanClause}
        AND rank IN ('Species', 'Subspecies', 'Variety', 'Form', 'Genus', 'Family', 'Order', 'Class', 'Phylum')
      LIMIT 50
    `;
    const res = db.executeSync(sql, params);
    rows = (res.rows ?? []) as Array<Record<string, unknown>>;
  }

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

  // Pack higher-taxon hits, 照臺灣模式: TaiCOL's sweep above returns
  // family/genus-rank rows with rank badge + lineage; packs store only
  // genus-and-below, so equivalent hits are synthesized from distinct
  // lineages of matching pack rows. Species-level pack hits arrive via the
  // fuzzy augment below.
  const packSeen = new Set(hits.map((h) => `${h.rank}:${h.name}`));
  for (const rankName of ['family', 'genus'] as const) {
    for (const lin of searchPackLineages(rankName, variants)) {
      const name = rankName === 'genus' ? lin.genus : lin.family;
      if (!name) continue;
      // A TW/JP row of the same taxon already produced this hit (with its
      // Chinese name) — the synthesized pack hit would be a bare duplicate.
      const key = `${rankName === 'genus' ? 'Genus' : 'Family'}:${name}`;
      if (packSeen.has(key)) continue;
      packSeen.add(key);
      const path: Array<{ rank: Rank; value: string }> = [];
      for (const level of RANK_ORDER) {
        if (level === 'genus' && rankName === 'family') break;
        const val = lin[level];
        if (val) path.push({ rank: level, value: val });
      }
      hits.push({
        display: name,
        name,
        cname: '',
        rank: rankName === 'genus' ? 'Genus' : 'Family',
        author: '',
        path,
      });
    }
  }

  // Augment with synonym + fuzzy species matches by reusing the main search
  // pipeline (searchWithFuzzyFallback already resolves synonyms to accepted
  // names and falls back to the Levenshtein cname index). The accepted row's
  // hierarchy gives us the ancestor path for tree expansion. Dedupe against
  // the LIKE hits above by rank:name so direct matches aren't doubled.
  const seen = new Set(hits.map((h) => `${h.rank}:${h.name}`));
  try {
    for (const r of searchWithFuzzyFallback({ q: trimmed })) {
      const key = `${r.rank}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(resultToTaxonHit(r));
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[searchTaxonomy] synonym/fuzzy augment failed:', e);
  }

  hits.sort((a, b) => {
    // 精確命中的俗名／學名永遠優先於 rank 高低。使用者打「櫸」要的是櫸樹
    // (Zelkova serrata)，不是櫸屬；而單字查詢會命中大量屬名／科名，高階類群
    // 在 RANK_PRIORITY 下一律排在 Species 前面 —— 沒有這一層，「芒」的精確列
    // 會落到第 47 名而被下面的 slice(0, 20) 整個切掉，使用者根本看不到。
    const exactRank = (h: TaxonSearchHit): number =>
      h.cname === trimmed ? 0 : h.name === trimmed ? 1 : 2;
    const ea = exactRank(a);
    const eb = exactRank(b);
    if (ea !== eb) return ea - eb;
    const pa = RANK_PRIORITY[a.rank] ?? 9;
    const pb = RANK_PRIORITY[b.rank] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  return hits.slice(0, 20);
}
