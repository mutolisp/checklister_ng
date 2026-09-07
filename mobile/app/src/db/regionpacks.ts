/**
 * Country species-list packs ("region packs") — a third database.
 *
 * A pack is a GBIF SPECIES_LIST download for one country (optionally narrowed
 * to taxon groups), imported so the field user can search that country's
 * species offline. Packs are DISPOSABLE reference data, so they live in their
 * own `regionpacks.db`, not user.db:
 *
 *  - user.db backups (VACUUM INTO whole-file copies) must not balloon by tens
 *    of MB of re-downloadable names; the backup screen offers packs as an
 *    opt-in extra instead.
 *  - deleting a pack must never break user records: any pack taxon that gets
 *    referenced by a record is first copied into user.db's external_taxa
 *    (`ensureExternalCopy`), keeping user.db self-sufficient — the same
 *    invariant external GBIF/iNat lookups already follow.
 *
 * Not part of cold start: the DB is opened lazily on first use. Pack taxa
 * share the 'g' + GBIF-usageKey namespace with external_taxa, so a species
 * added from a pack and the same species fetched via the GBIF lookup carry
 * the same identity.
 */
import { open, type DB } from '@op-engineering/op-sqlite';
import { Paths } from 'expo-file-system';
import { getUserDb } from './init';
import { groupFilterClause } from './search';
import { upsertExternalTaxon } from './externalTaxa';
import type { SearchResult, TaxonGroup } from './types';
import type { SpeciesListRow } from '~/lib/gbifSpeciesList';

export const PACKS_DB_NAME = 'regionpacks.db';

let packsDb: DB | null = null;

/** Same reason as externalTaxa.ts's local copy: no wildcard injection, no import cycle. */
function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function getPacksDb(): DB {
  if (packsDb) return packsDb;
  packsDb = open({ name: PACKS_DB_NAME, location: Paths.document.uri });
  migratePacksDb(packsDb);
  return packsDb;
}

/** For backup include / restore replace. */
export function closePacksDb(): void {
  packsDb?.close();
  packsDb = null;
}

/**
 * Own migration ladder (PRAGMA user_version), independent of user.db's
 * schema_version: the two files restore independently.
 */
function migratePacksDb(db: DB): void {
  const res = db.executeSync('PRAGMA user_version;');
  const version = Number(((res.rows ?? [])[0] as { user_version?: number })?.user_version ?? 0);
  if (version < 1) {
    db.executeSync(`CREATE TABLE IF NOT EXISTS region_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT NOT NULL,
      groups_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'requested',
      gbif_download_key TEXT,
      gbif_doi TEXT,
      error TEXT,
      species_count INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
    db.executeSync(`CREATE TABLE IF NOT EXISTS pack_taxa (
      pack_id INTEGER NOT NULL,
      taxon_id TEXT NOT NULL,
      simple_name TEXT NOT NULL,
      name_author TEXT,
      rank TEXT,
      taxonomic_status TEXT,
      accepted_taxon_id TEXT,
      kingdom TEXT, phylum TEXT, class TEXT, "order" TEXT, family TEXT, genus TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      iucn TEXT,
      UNIQUE(pack_id, taxon_id)
    );`);
    db.executeSync('CREATE INDEX IF NOT EXISTS idx_pack_taxa_name ON pack_taxa(simple_name);');
    db.executeSync('CREATE INDEX IF NOT EXISTS idx_pack_taxa_pack ON pack_taxa(pack_id);');
    db.executeSync('PRAGMA user_version = 1;');
  }
}

/** requested → running → importing → ready | failed */
export type PackStatus = 'requested' | 'running' | 'importing' | 'ready' | 'failed';

export type RegionPack = {
  id: number;
  country_code: string;
  groups: string[];
  status: PackStatus;
  gbif_download_key: string | null;
  gbif_doi: string | null;
  error: string | null;
  species_count: number | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

function rowToPack(row: Record<string, unknown>): RegionPack {
  let groups: string[] = [];
  try {
    const parsed = JSON.parse((row.groups_json as string) ?? '[]');
    if (Array.isArray(parsed)) groups = parsed.filter((g) => typeof g === 'string');
  } catch {
    // Corrupt groups_json only loses the label, never the pack.
  }
  return {
    id: Number(row.id),
    country_code: (row.country_code as string) ?? '',
    groups,
    status: ((row.status as string) ?? 'failed') as PackStatus,
    gbif_download_key: (row.gbif_download_key as string) ?? null,
    gbif_doi: (row.gbif_doi as string) ?? null,
    error: (row.error as string) ?? null,
    species_count: row.species_count == null ? null : Number(row.species_count),
    enabled: Number(row.enabled ?? 1) === 1,
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  };
}

export function listPacks(): RegionPack[] {
  const res = getPacksDb().executeSync('SELECT * FROM region_packs ORDER BY created_at DESC;');
  return ((res.rows ?? []) as Record<string, unknown>[]).map(rowToPack);
}

export function getPack(id: number): RegionPack | null {
  const res = getPacksDb().executeSync('SELECT * FROM region_packs WHERE id = ? LIMIT 1;', [id]);
  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
  return row ? rowToPack(row) : null;
}

export function createPack(countryCode: string, groups: string[]): RegionPack {
  const now = Date.now();
  getPacksDb().executeSync(
    `INSERT INTO region_packs (country_code, groups_json, status, created_at, updated_at)
     VALUES (?, ?, 'requested', ?, ?);`,
    [countryCode, JSON.stringify(groups), now, now],
  );
  const res = getPacksDb().executeSync(
    'SELECT * FROM region_packs ORDER BY id DESC LIMIT 1;',
  );
  return rowToPack((res.rows ?? [])[0] as Record<string, unknown>);
}

export function updatePack(
  id: number,
  patch: Partial<{
    status: PackStatus;
    gbif_download_key: string | null;
    gbif_doi: string | null;
    error: string | null;
    species_count: number | null;
    enabled: boolean;
  }>,
): void {
  const sets: string[] = ['updated_at = ?'];
  const params: (string | number | null)[] = [Date.now()];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    params.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null));
  }
  params.push(id);
  getPacksDb().executeSync(`UPDATE region_packs SET ${sets.join(', ')} WHERE id = ?;`, params);
}

export function deletePack(id: number): void {
  const db = getPacksDb();
  db.executeSync('BEGIN IMMEDIATE;');
  try {
    db.executeSync('DELETE FROM pack_taxa WHERE pack_id = ?;', [id]);
    db.executeSync('DELETE FROM region_packs WHERE id = ?;', [id]);
    db.executeSync('COMMIT;');
  } catch (e) {
    db.executeSync('ROLLBACK;');
    throw e;
  }
}

/**
 * Bulk-insert parsed SPECIES_LIST rows. One transaction, chunked with an
 * event-loop yield between chunks: a France-sized list is ~250k rows, and a
 * fully synchronous loop would freeze the progress overlay it reports to
 * (while the area-import's row-by-row uncommitted pattern is exactly what
 * this must NOT repeat on the SQL side). Holding the transaction across the
 * yields is safe — nothing else writes regionpacks.db.
 */
export async function importPackRows(
  packId: number,
  rows: SpeciesListRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const db = getPacksDb();
  const CHUNK = 2000;
  db.executeSync('BEGIN IMMEDIATE;');
  try {
    db.executeSync('DELETE FROM pack_taxa WHERE pack_id = ?;', [packId]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      db.executeSync(
        `INSERT OR IGNORE INTO pack_taxa
           (pack_id, taxon_id, simple_name, name_author, rank, taxonomic_status,
            accepted_taxon_id, kingdom, phylum, class, "order", family, genus,
            occurrence_count, iucn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          packId,
          `g${r.taxonKey}`,
          r.simpleName,
          r.author || null,
          r.rank || null,
          r.taxonomicStatus || null,
          r.acceptedTaxonId,
          r.kingdom || null,
          r.phylum || null,
          r.class || null,
          r.order || null,
          r.family || null,
          r.genus || null,
          r.occurrenceCount,
          r.iucnCategory || null,
        ],
      );
      if (i % CHUNK === CHUNK - 1) {
        onProgress?.(i + 1, rows.length);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
    db.executeSync('COMMIT;');
  } catch (e) {
    db.executeSync('ROLLBACK;');
    throw e;
  }
  const res = db.executeSync('SELECT COUNT(*) AS n FROM pack_taxa WHERE pack_id = ?;', [packId]);
  const n = Number(((res.rows ?? [])[0] as { n?: number })?.n ?? 0);
  onProgress?.(rows.length, rows.length);
  return n;
}

/** True when at least one enabled, ready pack exists — the search gate. */
let hasPacksCache: boolean | null = null;
export function invalidatePackCache(): void {
  hasPacksCache = null;
}
function hasEnabledPacks(): boolean {
  if (hasPacksCache != null) return hasPacksCache;
  try {
    const res = getPacksDb().executeSync(
      `SELECT 1 FROM region_packs WHERE enabled = 1 AND status = 'ready' LIMIT 1;`,
    );
    hasPacksCache = (res.rows ?? []).length > 0;
  } catch {
    hasPacksCache = false;
  }
  return hasPacksCache;
}

type PackTaxonRowDb = {
  taxon_id: string;
  simple_name: string;
  name_author: string | null;
  rank: string | null;
  taxonomic_status: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  iucn: string | null;
  country_code: string;
};

function packRowToSearchResult(r: PackTaxonRowDb): SearchResult {
  const fullname = r.name_author ? `${r.simple_name} ${r.name_author}` : r.simple_name;
  // TaiCOL rank values are Capitalized ('Species'); everything downstream —
  // RANK_PRIORITY sorting in the tree search, rank badges, infraspecific
  // checks — keys on that convention, so pack rows must match it.
  const rank = r.rank ? r.rank.charAt(0).toUpperCase() + r.rank.slice(1) : '';
  return {
    id: 0,
    name: r.simple_name,
    fullname,
    cname: '',
    _raw_cname: '',
    family: r.family ?? '',
    family_cname: '',
    iucn_category: r.iucn ?? '',
    redlist: '',
    endemic: 0,
    source: '',
    alien_type: '',
    pt_name: '',
    taxon_id: r.taxon_id,
    usage_status: r.taxonomic_status || 'accepted',
    alternative_name_c: '',
    kingdom: r.kingdom ?? '',
    kingdom_c: '',
    phylum: r.phylum ?? '',
    phylum_c: '',
    class_name: r.class ?? '',
    class_c: '',
    order: r.order ?? '',
    order_c: '',
    genus: r.genus ?? '',
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
    rank,
    is_autonym: false,
    is_sensu_lato: false,
    region: 'TW',
    pack_country: r.country_code,
  };
}

/**
 * Scientific-name search over every enabled, ready pack.
 *
 * Packs carry no Chinese vernaculars, so there is no cname/fuzzy leg here —
 * prefix matches on the scientific name rank first, then commonness
 * (occurrence_count). Taxon-group chips work because pack_taxa stores the same
 * kingdom/phylum/class column names `groupFilterClause` binds against.
 * Merged into `searchWithFuzzyFallback` AFTER bundled + external results.
 */
export function searchPackTaxa(
  q: string,
  groups?: TaxonGroup[],
  limit = 15,
): SearchResult[] {
  if (!hasEnabledPacks()) return [];
  const trimmed = q.trim();
  // This is a %LIKE% sweep over a table that can hold 250k rows, fired per
  // keystroke by the SearchBox — and a 1-2 letter Latin fragment matches half
  // the pack anyway. Three characters is where a scientific-name query starts
  // meaning something ("Poa" clears the bar). The bundled-checklist paths
  // keep their own rules; this gate is pack-only.
  if (trimmed.length < 3) return [];
  const params: (string | number)[] = [];
  const groupSql = groupFilterClause(groups, params as (string | number)[]);
  const like = `%${escapeLike(trimmed)}%`;
  const prefix = `${escapeLike(trimmed)}%`;
  const res = getPacksDb().executeSync(
    `SELECT t.*, p.country_code FROM pack_taxa t
      JOIN region_packs p ON p.id = t.pack_id
      WHERE p.enabled = 1 AND p.status = 'ready'
        AND (t.simple_name LIKE ? ESCAPE '\\' OR t.genus LIKE ? ESCAPE '\\')${groupSql.replace(
          /"(kingdom|phylum|class)"/g,
          't."$1"',
        )}
      ORDER BY (t.simple_name LIKE ? ESCAPE '\\') DESC, t.occurrence_count DESC
      LIMIT ?;`,
    [like, like, ...params, prefix, limit],
  );
  return ((res.rows ?? []) as unknown as PackTaxonRowDb[]).map(packRowToSearchResult);
}

/**
 * Copy one pack taxon into user.db's external_taxa, if it is not there yet.
 *
 * Called by the record/favorite insert helpers for any 'g…' taxon_id: a pack
 * is disposable, user records are not, so the moment a pack species is used
 * its identity moves into user.db. No-op for ids external_taxa already has
 * (including 'gi…' iNat ids, which no pack ever mints).
 */
export function ensureExternalCopy(taxonId: string): void {
  if (!taxonId || taxonId.charAt(0) !== 'g') return;
  try {
    const exists = getUserDb().executeSync(
      'SELECT 1 FROM external_taxa WHERE taxon_id = ? LIMIT 1;',
      [taxonId],
    );
    if ((exists.rows ?? []).length > 0) return;
    const res = getPacksDb().executeSync(
      'SELECT * FROM pack_taxa WHERE taxon_id = ? LIMIT 1;',
      [taxonId],
    );
    const r = (res.rows ?? [])[0] as unknown as PackTaxonRowDb | undefined;
    if (!r) return;
    upsertExternalTaxon({
      source: 'gbif',
      source_key: taxonId.slice(1),
      simple_name: r.simple_name,
      name_author: r.name_author ?? '',
      rank: r.rank ?? '',
      kingdom: r.kingdom ?? '',
      phylum: r.phylum ?? '',
      class: r.class ?? '',
      order: r.order ?? '',
      family: r.family ?? '',
      genus: r.genus ?? '',
      common_name_c: '',
      taxonomic_status: r.taxonomic_status ?? null,
    });
  } catch (e) {
    // Copy failure must never block the record write itself; the id still
    // resolves as long as the pack exists, and the next use retries.
    // eslint-disable-next-line no-console
    console.warn('[regionpacks] ensureExternalCopy failed:', e);
  }
}

// ── Taxonomy-tree contributions ─────────────────────────────────────────────
// Pack rows feed the same merged tree as TaiCOL/YList. Queries mirror the
// GROUP BY shapes in src/db/taxonomy.ts but differ in two data facts: pack
// ranks are stored LOWERCASE ('species', not 'Species'), and there are no
// Chinese `*_c` columns. Cross-DB, so taxonomy.ts merges these results in JS.

/** Mirror of taxonomy.ts RANK_ORDER — kept local to avoid an import cycle
 *  (taxonomy.ts imports this module). */
const TREE_RANKS = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as const;
const PACK_SPECIES_RANKS = `('species','subspecies','variety','form')`;

function quoteCol(col: string): string {
  return col === 'order' || col === 'class' ? `"${col}"` : col;
}

function packAncestorWhere(
  ancestors: Partial<Record<string, string>> | undefined,
  params: string[],
): string {
  let where = '';
  for (const r of TREE_RANKS) {
    const v = ancestors?.[r];
    if (v) {
      where += ` AND t.${quoteCol(r)} = ?`;
      params.push(v);
    }
  }
  return where;
}

/** Signature of the packs that contribute to search/tree scope — part of the
 *  taxonomy cache key, so toggling or adding a pack invalidates the tree. */
export function packScopeSig(): string {
  try {
    const res = getPacksDb().executeSync(
      `SELECT id FROM region_packs WHERE enabled = 1 AND status = 'ready' ORDER BY id;`,
    );
    return ((res.rows ?? []) as { id: number }[]).map((r) => r.id).join('.');
  } catch {
    return '';
  }
}

export type PackTreeNodeRow = { name: string; stats: Record<string, number> };

/**
 * Children of one tree node contributed by every enabled, ready pack —
 * same aggregate set as taxonomy.ts buildStatsCols, computed over pack rows.
 */
export function packTreeChildren(
  rank: (typeof TREE_RANKS)[number],
  ancestors?: Partial<Record<string, string>>,
): PackTreeNodeRow[] {
  if (!hasEnabledPacks()) return [];
  const rankIdx = TREE_RANKS.indexOf(rank);
  if (rankIdx === -1) return [];
  try {
    const statsCols: string[] = [];
    for (const r of TREE_RANKS.slice(rankIdx + 1)) {
      statsCols.push(`COUNT(DISTINCT t.${quoteCol(r)}) AS ${r}_count`);
    }
    statsCols.push(`SUM(CASE WHEN t.rank='species' THEN 1 ELSE 0 END) AS species_count`);
    statsCols.push(
      `SUM(CASE WHEN t.rank IN ('subspecies','variety','form') THEN 1 ELSE 0 END) AS infraspecific_count`,
    );
    const params: string[] = [];
    const where =
      `p.enabled = 1 AND p.status = 'ready' AND t.rank IN ${PACK_SPECIES_RANKS}` +
      packAncestorWhere(ancestors, params);
    const col = `t.${quoteCol(rank)}`;
    const res = getPacksDb().executeSync(
      `SELECT ${col} AS name, ${statsCols.join(', ')}
         FROM pack_taxa t JOIN region_packs p ON p.id = t.pack_id
        WHERE ${where}
        GROUP BY ${col}
        HAVING name IS NOT NULL AND name != ''
        ORDER BY name;`,
      params,
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map((row) => {
      const stats: Record<string, number> = {};
      for (const r of TREE_RANKS.slice(rankIdx + 1)) {
        stats[r] = Number(row[`${r}_count`] ?? 0);
      }
      stats['species'] = Number(row.species_count ?? 0);
      const infra = Number(row.infraspecific_count ?? 0);
      if (infra) stats['infraspecific'] = infra;
      return { name: String(row.name), stats };
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[regionpacks] packTreeChildren failed:', e);
    return [];
  }
}

export type PackSpeciesRow = {
  taxon_id: string;
  simple_name: string;
  name_author: string;
  rank: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  iucn: string;
  country_code: string;
};

function packSpeciesQuery(where: string, params: string[]): PackSpeciesRow[] {
  const res = getPacksDb().executeSync(
    `SELECT t.taxon_id, t.simple_name, t.name_author, t.rank,
            t.kingdom, t.phylum, t.class, t."order", t.family, t.genus,
            t.iucn, p.country_code
       FROM pack_taxa t JOIN region_packs p ON p.id = t.pack_id
      WHERE p.enabled = 1 AND p.status = 'ready' AND ${where}
      ORDER BY t.simple_name;`,
    params,
  );
  return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
    taxon_id: String(r.taxon_id ?? ''),
    simple_name: String(r.simple_name ?? ''),
    name_author: String(r.name_author ?? ''),
    rank: String(r.rank ?? ''),
    kingdom: String(r.kingdom ?? ''),
    phylum: String(r.phylum ?? ''),
    class: String(r.class ?? ''),
    order: String(r.order ?? ''),
    family: String(r.family ?? ''),
    genus: String(r.genus ?? ''),
    iucn: String(r.iucn ?? ''),
    country_code: String(r.country_code ?? ''),
  }));
}

/** Species-level pack rows under one lineage (tree leaf listing). */
export function packSpeciesUnder(ancestors?: Partial<Record<string, string>>): PackSpeciesRow[] {
  if (!hasEnabledPacks()) return [];
  try {
    const params: string[] = [];
    const where = `t.rank IN ${PACK_SPECIES_RANKS}` + packAncestorWhere(ancestors, params);
    return packSpeciesQuery(where, params);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[regionpacks] packSpeciesUnder failed:', e);
    return [];
  }
}

/** Infraspecific pack rows under a binomial (species detail 下級分類群). */
export function packInfraspeciesOf(
  speciesName: string,
  ancestors?: Partial<Record<string, string>>,
): PackSpeciesRow[] {
  if (!hasEnabledPacks()) return [];
  try {
    const pattern = `${escapeLike(speciesName)} %`;
    const params: string[] = [pattern, speciesName];
    const where =
      `t.simple_name LIKE ? ESCAPE '\\' AND t.simple_name != ?` +
      ` AND t.rank IN ('subspecies','variety','form')` +
      packAncestorWhere(ancestors, params);
    return packSpeciesQuery(where, params);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[regionpacks] packInfraspeciesOf failed:', e);
    return [];
  }
}

export type PackLineageRow = {
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
};

/**
 * Family / genus level hits for the taxonomy search — 照臺灣模式: TaiCOL's
 * LIKE sweep returns family/genus-rank rows, but a pack only stores
 * genus-and-below rows, so higher-taxon hits are SYNTHESIZED from the
 * distinct lineages of matching species rows.
 */
export function searchPackLineages(
  column: 'family' | 'genus',
  variants: string[],
  limit = 10,
): PackLineageRow[] {
  if (!hasEnabledPacks() || variants.length === 0) return [];
  try {
    const conds = variants.map(() => `t.${column} LIKE ? ESCAPE '\\'`).join(' OR ');
    const params = variants.map((v) => `%${escapeLike(v)}%`);
    const genusSel = column === 'genus' ? 't.genus' : `'' AS genus`;
    const groupCols =
      column === 'genus'
        ? 't.kingdom, t.phylum, t.class, t."order", t.family, t.genus'
        : 't.kingdom, t.phylum, t.class, t."order", t.family';
    const res = getPacksDb().executeSync(
      `SELECT t.kingdom, t.phylum, t.class, t."order", t.family, ${genusSel}
         FROM pack_taxa t JOIN region_packs p ON p.id = t.pack_id
        WHERE p.enabled = 1 AND p.status = 'ready' AND (${conds})
          AND t.${column} IS NOT NULL AND t.${column} != ''
        GROUP BY ${groupCols}
        ORDER BY t.${column}
        LIMIT ?;`,
      [...params, limit],
    );
    return ((res.rows ?? []) as Record<string, unknown>[]).map((r) => ({
      kingdom: String(r.kingdom ?? ''),
      phylum: String(r.phylum ?? ''),
      class: String(r.class ?? ''),
      order: String(r.order ?? ''),
      family: String(r.family ?? ''),
      genus: String(r.genus ?? ''),
    }));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[regionpacks] searchPackLineages failed:', e);
    return [];
  }
}
