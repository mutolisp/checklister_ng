/**
 * Cross-plot analysis tables for the project export: relevé model, species ×
 * relevé matrices (vegan), wide environmental table, lossless long table and
 * the Braun-Blanquet conversion tables.
 *
 * Pure module — no DB, i18n or expo imports (type-only imports from ~/db are
 * erased at compile time), so `scripts/check-vegmatrix.mjs` can drive it on
 * Node, the same contract as `bundleYaml.ts` / check-roundtrip.
 */
import type {
  PlotLayer,
  PlotSpeciesRecordWithTaxon,
  PlotSurvey,
  Subplot,
  SubplotLayer,
} from '~/db';
import { buildPlotEnvRows, csvEscape } from './bundleYaml';
import { basalArea, bbRank, kindForType, parseDbhArray } from './dwcAbundanceCore';

/** Numeric representation for Braun-Blanquet codes in the matrices. 'bb'
 *  keeps the raw code (matrix cells become non-numeric — documented). */
export type MatrixValueMode = 'bb' | 'cover' | 'ordinal';

// ── Braun-Blanquet conversion tables ────────────────────────────────────────
//
// 'cover': integer cover-% equivalents, the JUICE/Turboveg storage convention.
//   r=1, +=2, 1=3, 3=38, 4=63 are verbatim from the JUICE manual §1.11.6
//   example "1(r) 2(+) 3(1) … 38(3) 63(4)" (JUICE stores all cover as integer
//   percentages). 2=15 and 5=88 are the arithmetic midpoints of the class
//   intervals 5–25% and 75–100% (the 50–75% / 75–100% intervals for codes 4/5
//   are stated verbatim in van der Maarel 2007, J Veg Sci 18:767, abstract),
//   rounded to stay on the same integer convention.
// 'ordinal': ordinal transform values on van der Maarel's 1–9 scale for the
//   extended BB scale (r,+,1,2m,2a,2b,3,4,5 → 1..9; van der Maarel 2007,
//   abstract). This app's scale has a plain 2 (no 2m/2a/2b); mapping 2→5 (the
//   2a position, whose 5–15% interval lies inside 2's 5–25%) is this app's
//   documented convention, not a literature citation.
export const BB_COVER_PCT: Record<string, number> = {
  r: 1, '+': 2, '1': 3, '2': 15, '3': 38, '4': 63, '5': 88,
};
export const BB_ORDINAL: Record<string, number> = {
  r: 1, '+': 2, '1': 3, '2': 5, '3': 7, '4': 8, '5': 9,
};

/** Rows for cover_scale.csv — the audit trail for the tables above. */
export function coverScaleRows(): Array<Record<string, string | number>> {
  const provenance: Record<string, string> = {
    r: 'JUICE manual §1.11.6 (verbatim: 1(r))',
    '+': 'JUICE manual §1.11.6 (verbatim: 2(+))',
    '1': 'JUICE manual §1.11.6 (verbatim: 3(1))',
    '2': 'arithmetic midpoint of the 5-25% interval',
    '3': 'JUICE manual §1.11.6 (verbatim: 38(3))',
    '4': 'JUICE manual §1.11.6 (verbatim: 63(4))',
    '5': 'arithmetic midpoint of the 75-100% interval (interval verbatim in van der Maarel 2007 abstract), rounded',
  };
  return Object.keys(BB_COVER_PCT).map((code) => ({
    bbCode: code,
    coverPct: BB_COVER_PCT[code],
    ordinal: BB_ORDINAL[code],
    coverProvenance: provenance[code],
    ordinalProvenance:
      code === '2'
        ? "app convention: plain 2 → 5 (2a position on van der Maarel's extended 1-9 scale)"
        : "van der Maarel 2007 (J Veg Sci 18:767) abstract: extended BB scale r,+,1,2m,2a,2b,3,4,5 → OTV 1-9",
  }));
}

// ── Relevé model ────────────────────────────────────────────────────────────

export type RelevePlotInput = {
  plot: PlotSurvey;
  projectName: string;
  /** plot_survey_layers rows (empty for transect / point_count). */
  layers: PlotLayer[];
  subplots: Array<Subplot & { layers: SubplotLayer[] }>;
  species: PlotSpeciesRecordWithTaxon[];
};

export type Releve = {
  nr: number;
  /** Unique row id: plotid, plotid-S1, or date/seq-suffixed on collision. */
  id: string;
  plotUuid: string;
  plotid: string;
  subplotLabel: string | null;
  /** YYYY-MM-DD of plot start (empty when unset). */
  startDate: string;
  /** Tall env rows, ready to pivot into the wide table. */
  envRows: Array<{ term: string; value: string }>;
  records: PlotSpeciesRecordWithTaxon[];
};

/** JUICE .TAB relevé numbers are integers 1–999999. */
export const MAX_RELEVES = 999999;

function ymd(ts: number | null): string {
  if (ts == null) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Overwrite (or append) one term in a tall env row list, in place. */
function setTerm(rows: Array<{ term: string; value: string }>, term: string, value: string): void {
  const hit = rows.find((r) => r.term === term);
  if (hit) hit.value = value;
  else rows.push({ term, value });
}

export function buildReleves(inputs: RelevePlotInput[]): {
  releves: Releve[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const releves: Releve[] = [];
  const usedIds = new Set<string>();

  // Deterministic order: plotid, then start time (resurveys of one plot stay
  // chronological), then row id as the final tiebreak.
  const sorted = [...inputs].sort((a, b) => {
    const byPlotid = a.plot.plotid.localeCompare(b.plot.plotid);
    if (byPlotid !== 0) return byPlotid;
    const byStart = (a.plot.start_ts ?? 0) - (b.plot.start_ts ?? 0);
    if (byStart !== 0) return byStart;
    return a.plot.id - b.plot.id;
  });

  const uniqueId = (base: string, startDate: string): string => {
    if (!usedIds.has(base)) return base;
    // plotid is NOT UNIQUE in the schema — resurveys of one plot are expected.
    const dated = startDate ? `${base}_${startDate.replace(/-/g, '')}` : base;
    if (dated !== base && !usedIds.has(dated)) return dated;
    for (let n = 2; ; n++) {
      const candidate = `${dated}_${n}`;
      if (!usedIds.has(candidate)) return candidate;
    }
  };

  const push = (
    input: RelevePlotInput,
    idBase: string,
    subplotLabel: string | null,
    records: PlotSpeciesRecordWithTaxon[],
    envRows: Array<{ term: string; value: string }>,
  ) => {
    const startDate = ymd(input.plot.start_ts);
    const id = uniqueId(idBase, startDate);
    if (id !== idBase) {
      warnings.push(`releveId "${idBase}" 重複（同 plotid 多次調查），改用 "${id}"`);
    }
    usedIds.add(id);
    releves.push({
      nr: releves.length + 1,
      id,
      plotUuid: input.plot.uuid,
      plotid: input.plot.plotid,
      subplotLabel,
      startDate,
      envRows,
      records,
    });
  };

  for (const input of sorted) {
    const { plot, projectName, layers, subplots, species } = input;
    const baseEnv = () => buildPlotEnvRows(plot, projectName, layers);

    if (subplots.length === 0) {
      push(input, plot.plotid, null, species, baseEnv());
      continue;
    }

    // Split plot: one relevé per subplot; records with subplot_id NULL exist
    // too (recorded before splitting, or orphaned by setSubplotCount shrink —
    // src/db/plots.ts keeps them on purpose) and get a parent relevé so no
    // observation silently drops out of the matrix.
    const direct = species.filter((r) => r.subplot_id == null);
    if (direct.length > 0) {
      warnings.push(
        `樣區 ${plot.plotid} 有 ${direct.length} 筆未歸屬小區的記錄，另立母樣區列 ${plot.plotid}`,
      );
      push(input, plot.plotid, null, direct, baseEnv());
    }
    for (const sp of [...subplots].sort((a, b) => a.idx - b.idx)) {
      const rows = baseEnv();
      setTerm(rows, 'eventID', `${plot.plotid}-${sp.label}`);
      setTerm(rows, 'subplotLabel', sp.label);
      if (sp.width_m != null) setTerm(rows, 'subplotWidthM', String(sp.width_m));
      if (sp.length_m != null) setTerm(rows, 'subplotLengthM', String(sp.length_m));
      // Per-subplot cover/height override the plot-level layer values; the
      // layer definition (method / height unit) stays shared at plot level.
      for (const sl of sp.layers) {
        const plotLayer = layers.find((l) => l.layer_index === sl.layer_index);
        const inM = plotLayer?.height_unit === 'm';
        const key = `e${sl.layer_index}`;
        if (sl.cover_pct != null) setTerm(rows, `${key}CoverPct`, String(sl.cover_pct));
        if (sl.height_cm != null) {
          setTerm(rows, `${key}Height${inM ? 'M' : 'Cm'}`, String(inM ? sl.height_cm / 100 : sl.height_cm));
        }
      }
      push(input, `${plot.plotid}-${sp.label}`, sp.label, species.filter((r) => r.subplot_id === sp.id), rows);
    }
  }

  if (releves.length > MAX_RELEVES) {
    throw new Error(`樣方數 ${releves.length} 超過 JUICE 上限 ${MAX_RELEVES}`);
  }
  return { releves, warnings };
}

// ── Species columns ─────────────────────────────────────────────────────────

export type SpeciesCol = {
  /** taxon_id|used_scientific_name — the checklist dedup key (a taxon
   *  deliberately recorded under two names is two taxonomic opinions). */
  key: string;
  /** Column label in the matrices (unique). */
  name: string;
  taxonId: string;
  scientificName: string;
  author: string;
  usedScientificName: string | null;
  vernacularName: string;
  family: string;
};

export function colKeyOf(r: PlotSpeciesRecordWithTaxon): string {
  return `${r.taxon_id}|${r.used_scientific_name ?? ''}`;
}

export function buildSpeciesCols(releves: Releve[]): SpeciesCol[] {
  const byKey = new Map<string, SpeciesCol>();
  for (const rel of releves) {
    for (const r of rel.records) {
      const key = colKeyOf(r);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        name: r.used_scientific_name || r.simple_name || r.taxon_id,
        taxonId: r.taxon_id,
        scientificName: r.simple_name,
        author: r.name_author,
        usedScientificName: r.used_scientific_name ?? null,
        vernacularName: r.common_name_c,
        family: r.family,
      });
    }
  }
  const cols = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Same display name under two different keys (e.g. one record filed under a
  // synonym string that equals another taxon's accepted name) → disambiguate.
  const nameCount = new Map<string, number>();
  for (const c of cols) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  for (const c of cols) {
    if ((nameCount.get(c.name) ?? 0) > 1) c.name = `${c.name}_${c.taxonId}`;
  }
  return cols;
}

// ── Abundance aggregation / conversion ──────────────────────────────────────

export type CellAgg = {
  /** Highest BB code when every record is BB, else null. */
  bbCode: string | null;
  /** Numeric value under the chosen mode, null when not derivable. */
  num: number | null;
  /** True when quantity kinds were mixed or a value failed to parse. */
  lossy: boolean;
};

function numOf(quantity: string | null, type: string | null, mode: MatrixValueMode): number | null {
  if (quantity == null || quantity === '') return null;
  const kind = kindForType(type);
  if (kind === 'BB') {
    const table = mode === 'ordinal' ? BB_ORDINAL : BB_COVER_PCT;
    return table[quantity.trim()] ?? null;
  }
  if (kind === 'DBH') {
    const stems = parseDbhArray(quantity);
    return stems.length > 0 ? basalArea(stems) : null;
  }
  const n = Number(quantity);
  return Number.isFinite(n) ? n : null;
}

/** Aggregate the records that landed in one matrix cell.
 *  BB → max code (r < + < 1..5); percent → max; count → SUM; DBH → union of
 *  stems (basal areas add); mixed kinds → max of the numericised values. */
export function aggregateCell(
  records: Array<{ organism_quantity: string | null; organism_quantity_type: string | null }>,
  mode: MatrixValueMode,
): CellAgg {
  const kinds = new Set(records.map((r) => kindForType(r.organism_quantity_type)));
  if (kinds.size === 1) {
    const kind = [...kinds][0];
    if (kind === 'BB') {
      let best: string | null = null;
      let lossy = false;
      for (const r of records) {
        const rank = bbRank(r.organism_quantity);
        if (rank == null) {
          lossy = true;
          continue;
        }
        if (best == null || rank > (bbRank(best) ?? -1)) best = r.organism_quantity!.trim();
      }
      const table = mode === 'ordinal' ? BB_ORDINAL : BB_COVER_PCT;
      return { bbCode: best, num: best != null ? (table[best] ?? null) : null, lossy };
    }
    if (kind === 'count') {
      let sum = 0;
      let any = false;
      let lossy = false;
      for (const r of records) {
        const n = Number(r.organism_quantity);
        if (r.organism_quantity != null && Number.isFinite(n)) {
          sum += n;
          any = true;
        } else lossy = true;
      }
      return { bbCode: null, num: any ? sum : null, lossy };
    }
    if (kind === 'DBH') {
      const stems = records.flatMap((r) => parseDbhArray(r.organism_quantity));
      return { bbCode: null, num: stems.length > 0 ? basalArea(stems) : null, lossy: false };
    }
  }
  // percent, custom, or mixed kinds: max of the numericised values.
  let best: number | null = null;
  let lossy = kinds.size > 1;
  for (const r of records) {
    const n = numOf(r.organism_quantity, r.organism_quantity_type, mode);
    if (n == null) {
      lossy = true;
      continue;
    }
    if (best == null || n > best) best = n;
  }
  return { bbCode: null, num: best, lossy };
}

/** Cell → CSV string. Absence is '0'; a present-but-unparseable value falls
 *  back to '1' (presence) and is reported via the warnings list. */
export function cellString(agg: CellAgg | undefined, mode: MatrixValueMode): string {
  if (!agg) return '0';
  if (mode === 'bb' && agg.bbCode != null) return agg.bbCode;
  if (agg.num != null) return formatNum(agg.num);
  return '1';
}

export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ── Matrix / table builders ─────────────────────────────────────────────────

export type CsvTable = { header: string[]; rows: string[][] };

export function tableToCsv(t: CsvTable): string {
  // No UTF-8 BOM: these files are R-first (read.csv mangles the first column
  // name of a BOM'd file unless fileEncoding is set). records/*.csv keep BOM.
  return [t.header, ...t.rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function layerOf(r: PlotSpeciesRecordWithTaxon): string | null {
  return r.layer && r.layer !== 'T' ? r.layer : null;
}

/** Merged matrix: rows = relevés, columns = species (cross-layer aggregated). */
export function buildMatrix(
  releves: Releve[],
  cols: SpeciesCol[],
  mode: MatrixValueMode,
): CsvTable {
  const header = ['releveId', ...cols.map((c) => c.name)];
  const rows = releves.map((rel) => {
    const byKey = new Map<string, PlotSpeciesRecordWithTaxon[]>();
    for (const r of rel.records) {
      const k = colKeyOf(r);
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    }
    return [
      rel.id,
      ...cols.map((c) => {
        const recs = byKey.get(c.key);
        return recs ? cellString(aggregateCell(recs, mode), mode) : '0';
      }),
    ];
  });
  return { header, rows };
}

/** Layered matrix: columns = species@layer (layerless records keep the plain
 *  species name as their column). Column set derived from the data. */
export function buildMatrixByLayer(
  releves: Releve[],
  cols: SpeciesCol[],
  mode: MatrixValueMode,
): CsvTable {
  const colByKey = new Map(cols.map((c) => [c.key, c]));
  const layerCols: Array<{ key: string; layer: string | null; name: string }> = [];
  const seen = new Set<string>();
  for (const rel of releves) {
    for (const r of rel.records) {
      const key = colKeyOf(r);
      const layer = layerOf(r);
      const lk = `${key}#${layer ?? ''}`;
      if (seen.has(lk)) continue;
      seen.add(lk);
      const base = colByKey.get(key)!;
      layerCols.push({ key, layer, name: layer ? `${base.name}@${layer}` : base.name });
    }
  }
  layerCols.sort((a, b) => a.name.localeCompare(b.name));
  const header = ['releveId', ...layerCols.map((c) => c.name)];
  const rows = releves.map((rel) => {
    const byLk = new Map<string, PlotSpeciesRecordWithTaxon[]>();
    for (const r of rel.records) {
      const lk = `${colKeyOf(r)}#${layerOf(r) ?? ''}`;
      (byLk.get(lk) ?? byLk.set(lk, []).get(lk)!).push(r);
    }
    return [
      rel.id,
      ...layerCols.map((c) => {
        const recs = byLk.get(`${c.key}#${c.layer ?? ''}`);
        return recs ? cellString(aggregateCell(recs, mode), mode) : '0';
      }),
    ];
  });
  return { header, rows };
}

/** Wide env table: rows = relevés, columns = union of env terms (first-seen
 *  order, which follows buildPlotEnvRows's stable emission order). */
export function buildEnvWide(releves: Releve[]): CsvTable {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const rel of releves) {
    for (const { term } of rel.envRows) {
      if (!seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
    }
  }
  const header = ['releveId', 'releveNr', ...terms];
  const rows = releves.map((rel) => {
    const byTerm = new Map(rel.envRows.map((r) => [r.term, r.value]));
    return [rel.id, String(rel.nr), ...terms.map((tm) => byTerm.get(tm) ?? '')];
  });
  return { header, rows };
}

/** Lossless long table: one row per plot species record. */
export function buildSpeciesLong(
  releves: Releve[],
  cols: SpeciesCol[],
  mode: MatrixValueMode,
): CsvTable {
  const colByKey = new Map(cols.map((c) => [c.key, c]));
  const header = [
    'releveNr',
    'releveId',
    'occurrenceID',
    'taxonID',
    'colName',
    'scientificName',
    'layer',
    'quantity',
    'quantityType',
    'value',
  ];
  const rows: string[][] = [];
  for (const rel of releves) {
    for (const r of rel.records) {
      const col = colByKey.get(colKeyOf(r));
      rows.push([
        String(rel.nr),
        rel.id,
        r.occurrence_id ?? '',
        r.taxon_id,
        col?.name ?? '',
        r.used_scientific_name || r.simple_name,
        r.layer ?? '',
        r.organism_quantity ?? '',
        r.organism_quantity_type ?? '',
        (() => {
          const n = numOf(r.organism_quantity, r.organism_quantity_type, mode);
          return n != null ? formatNum(n) : '';
        })(),
      ]);
    }
  }
  return { header, rows };
}

/** releve_index.csv — the UUID ↔ integer mapping JUICE forces on us. */
export function buildReleveIndex(releves: Releve[]): CsvTable {
  return {
    header: ['releveNr', 'releveId', 'plotid', 'subplotLabel', 'plotUuid', 'startDate'],
    rows: releves.map((r) => [
      String(r.nr),
      r.id,
      r.plotid,
      r.subplotLabel ?? '',
      r.plotUuid,
      r.startDate,
    ]),
  };
}

export function buildSpeciesIndex(cols: SpeciesCol[]): CsvTable {
  return {
    header: [
      'colName',
      'taxonID',
      'scientificName',
      'scientificNameAuthorship',
      'usedScientificName',
      'vernacularName',
      'family',
    ],
    rows: cols.map((c) => [
      c.name,
      c.taxonId,
      c.scientificName,
      c.author,
      c.usedScientificName ?? '',
      c.vernacularName,
      c.family,
    ]),
  };
}

export function buildCoverScaleCsv(): string {
  const rows = coverScaleRows();
  const header = ['bbCode', 'coverPct', 'ordinal', 'coverProvenance', 'ordinalProvenance'];
  return [header, ...rows.map((r) => header.map((h) => csvEscape(r[h])))]
    .map((row) => row.join(','))
    .join('\n');
}
