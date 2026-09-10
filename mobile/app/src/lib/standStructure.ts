/**
 * Forest stand structure: the analysis the app's DBH data always supported and
 * nothing ever performed.
 *
 * A DBH record stores one array element per stem, so a single record carries
 * BOTH a count (how many stems) and a size (their diameters). That is what
 * makes density and dominance simultaneously derivable here, and it is the
 * reason the app's earlier blanket refusal to compute an Importance Value
 * Index has been narrowed rather than kept: the refusal is right for
 * Braun-Blanquet and percent cover, where one record is one cover figure, and
 * wrong for DBH, which is the very data IVI was defined on.
 *
 * IVI — Curtis & McIntosh (1951), Ecology 32:476–496, as implemented by
 * `BiodiversityR::importancevalue`, whose documentation states the components
 * verbatim:
 *   relative frequency = a species' frequency ÷ the SUM of all species'
 *                        frequencies × 100
 *   relative density   = its density ÷ the sum of all densities × 100
 *   relative dominance = its basal area ÷ the sum of all basal areas × 100
 *   importance value   = the sum of the three, ranging 0–300 (NOT divided by 3)
 *
 * Note the relative frequency is a share of the total frequency, which is NOT
 * what `diversity.ts`'s `relativeFrequency()` returns — that is occupancy
 * (subplots occupied ÷ subplots sampled). Both are useful and both appear in
 * the report, so `iviRelativeFrequency` renormalises the occupancy map rather
 * than defining a second thing under the same name.
 *
 * When a component cannot be derived it is omitted and `components` says so;
 * the caller must print the component count, because a two-component sum runs
 * 0–200 and comparing it against a three-component 0–300 is meaningless.
 *
 * Pure module — no DB / expo / `~/i18n` imports.
 */
import { basalArea, kindForType, parseDbhArray } from './dwcAbundanceCore';
import { speciesKey } from './diversity';
import { M2_PER_HA } from './plotArea';
import { aggregateCell } from './vegMatrix';
import type { ReportRecord } from './reportStats';

/** cm² → m². `basalArea()` works in cm² because DBH is entered in cm. */
const CM2_PER_M2 = 10000;

/**
 * Recording threshold for woody stems, from 「植物生態評估技術規範」附件二
 * §三(二)1(1): 「調查樣方內胸高直徑≥1cm 以上所有樹種樹幹之胸高直徑(dbh)」.
 * Used as the lower edge of the first diameter class so the histogram starts
 * where the data can start.
 */
export const DBH_MIN_CM = 1;

function kindsOf(records: ReportRecord[]): Set<string> {
  const s = new Set<string>();
  for (const r of records) {
    if (r.organism_quantity == null || r.organism_quantity === '') continue;
    s.add(kindForType(r.organism_quantity_type));
  }
  return s;
}

/** Stems per record: a DBH array's length, or an individual count. */
function stemsOf(r: ReportRecord): number | null {
  const kind = kindForType(r.organism_quantity_type);
  if (kind === 'DBH') return parseDbhArray(r.organism_quantity).length;
  if (kind === 'count') {
    const n = Number(r.organism_quantity);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/** All stem diameters (cm) in the record set. */
export function stemDiameters(records: ReportRecord[]): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (kindForType(r.organism_quantity_type) !== 'DBH') continue;
    for (const d of parseDbhArray(r.organism_quantity)) if (d > 0) out.push(d);
  }
  return out;
}

export type StandDensity = {
  /** True when the stems came from DBH arrays, so basal area and QMD are real
   *  measurements rather than the zeros an individual count would leave. */
  hasDbh: boolean;
  areaM2: number;
  areaHa: number;
  stems: number;
  stemsPerHa: number;
  basalAreaM2: number;
  basalAreaM2PerHa: number;
  /** √(Σd²/n) — the diameter of the tree of mean basal area. */
  quadraticMeanDbhCm: number | null;
};

/**
 * Stems and basal area per hectare. Returns null when there is no stem data at
 * all; the caller states why rather than printing zeros.
 */
export function standDensity(records: ReportRecord[], areaM2: number): StandDensity | null {
  if (!(areaM2 > 0)) return null;
  const diameters = stemDiameters(records);
  let stems = 0;
  for (const r of records) stems += stemsOf(r) ?? 0;
  if (stems === 0 && diameters.length === 0) return null;

  const baCm2 = basalArea(diameters);
  const basalAreaM2 = baCm2 / CM2_PER_M2;
  const areaHa = areaM2 / M2_PER_HA;
  return {
    hasDbh: diameters.length > 0,
    areaM2,
    areaHa,
    stems,
    stemsPerHa: stems / areaHa,
    basalAreaM2,
    basalAreaM2PerHa: basalAreaM2 / areaHa,
    quadraticMeanDbhCm: diameters.length
      ? Math.sqrt(diameters.reduce((s, d) => s + d * d, 0) / diameters.length)
      : null,
  };
}

export type DbhBin = { lowCm: number; highCm: number; stems: number };

export type DbhDistribution = {
  bins: DbhBin[];
  binWidthCm: number;
  stems: number;
  minCm: number;
  maxCm: number;
  quadraticMeanDbhCm: number;
};

/**
 * Diameter-class distribution. The shape is the point: a reverse-J says the
 * stand is regenerating, a bell says even-aged, and neither is visible from a
 * mean.
 *
 * Bins are `[low, high)`, so a stem exactly on a boundary falls in the upper
 * class. The first class begins at the specification's 1 cm recording
 * threshold rather than at zero.
 */
export function dbhDistribution(
  records: ReportRecord[],
  opts: { binWidthCm?: number; maxBins?: number; minCm?: number } = {},
): DbhDistribution | null {
  const d = stemDiameters(records);
  if (d.length === 0) return null;
  const minCm = opts.minCm ?? DBH_MIN_CM;
  const maxCm = Math.max(...d);
  const maxBins = opts.maxBins ?? 12;

  let binWidthCm = opts.binWidthCm ?? 5;
  // Widen rather than emit forty slivers; doubling keeps the class edges on
  // round numbers, which is what makes the labels readable.
  while (Math.floor(maxCm / binWidthCm) + 1 > maxBins) binWidthCm *= 2;

  // The first class starts at the RECORDING THRESHOLD, not at zero: the
  // specification records stems of dbh ≥ 1 cm, so a leading 0–5 cm class is
  // guaranteed empty and reads as a finding ("no small stems") when it is
  // really just an artefact of where the axis began.
  const count = Math.floor(maxCm / binWidthCm) + 1;
  const bins: DbhBin[] = Array.from({ length: count }, (_, i) => ({
    lowCm: i === 0 ? minCm : i * binWidthCm,
    highCm: (i + 1) * binWidthCm,
    stems: 0,
  }));
  for (const v of d) {
    // Anything under the first edge (below the protocol threshold, so out of
    // spec but present) is counted in the first class rather than dropped.
    const idx = v < binWidthCm ? 0 : Math.floor(v / binWidthCm);
    bins[Math.min(idx, count - 1)].stems += 1;
  }
  return {
    bins,
    binWidthCm,
    stems: d.length,
    minCm: Math.min(...d),
    maxCm,
    quadraticMeanDbhCm: Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length),
  };
}

/**
 * Stem density per hectare split into the diameter classes 「植物生態評估技術
 * 規範」範例 2.11 tabulates: 1–3, 3–10 and >10 cm, plus the total.
 *
 * The class boundaries are the specification's, not a choice — an EIA table is
 * compared against other EIA tables, so the columns have to line up. Stems
 * below 1 cm fall in the first class rather than being dropped; the total is
 * every measured stem, so the three classes always add up to it.
 */
export type DbhClassDensity = {
  label: '1-3' | '3-10' | '>10' | 'all';
  stems: number;
  stemsPerHa: number;
};

export function densityByDbhClass(
  records: ReportRecord[],
  areaM2: number,
): DbhClassDensity[] | null {
  const d = stemDiameters(records);
  if (d.length === 0 || !(areaM2 > 0)) return null;
  const areaHa = areaM2 / M2_PER_HA;
  const counts = { small: 0, mid: 0, large: 0 };
  for (const v of d) {
    if (v < 3) counts.small += 1;
    else if (v < 10) counts.mid += 1;
    else counts.large += 1;
  }
  const rows: DbhClassDensity[] = [
    { label: '1-3', stems: counts.small, stemsPerHa: counts.small / areaHa },
    { label: '3-10', stems: counts.mid, stemsPerHa: counts.mid / areaHa },
    { label: '>10', stems: counts.large, stemsPerHa: counts.large / areaHa },
  ];
  rows.push({ label: 'all', stems: d.length, stemsPerHa: d.length / areaHa });
  return rows;
}

/** Per-species figures for the 範例 2.11 composition table. */
export type SpeciesStandRow = {
  key: string;
  /** stems/ha in each class, in the order 1-3, 3-10, >10, all. */
  densityPerHa: number[];
  basalAreaM2PerHa: number;
};

export function speciesStandRows(
  records: ReportRecord[],
  areaM2: number,
): Map<string, SpeciesStandRow> | null {
  if (!(areaM2 > 0)) return null;
  const areaHa = areaM2 / M2_PER_HA;
  const byKey = new Map<string, ReportRecord[]>();
  for (const r of records) {
    const k = speciesKey(r);
    const cur = byKey.get(k);
    if (cur) cur.push(r);
    else byKey.set(k, [r]);
  }
  const out = new Map<string, SpeciesStandRow>();
  let any = false;
  for (const [k, recs] of byKey) {
    const d = stemDiameters(recs);
    if (d.length === 0) continue;
    any = true;
    const c = [0, 0, 0];
    for (const v of d) c[v < 3 ? 0 : v < 10 ? 1 : 2] += 1;
    out.set(k, {
      key: k,
      densityPerHa: [...c.map((n) => n / areaHa), d.length / areaHa],
      basalAreaM2PerHa: basalArea(d) / CM2_PER_M2 / areaHa,
    });
  }
  return any ? out : null;
}

/**
 * Re-express DBH records as stem counts, so the diversity indices can also be
 * computed the way 「植物生態評估技術規範」附件二 §三 3 specifies:
 * 「木本植物以株數計算，草本植物則以覆蓋度計算」.
 *
 * The app's own chain weights a DBH species by its total basal area, which is
 * the ecologically stronger weighting for a stand — a single large tree
 * genuinely dominates. The specification's stem-count weighting answers a
 * different question and is what an EIA reviewer expects to see. Both are
 * reported side by side rather than one being silently chosen.
 *
 * Implemented as a record transform rather than an option on
 * `computeDiversity`, so the tested numericisation chain is reused unchanged.
 */
export function asStemCounts(records: ReportRecord[]): ReportRecord[] {
  return records.map((r) => {
    if (kindForType(r.organism_quantity_type) !== 'DBH') return r;
    const stems = parseDbhArray(r.organism_quantity).filter((d) => d > 0).length;
    return { ...r, organism_quantity: String(stems), organism_quantity_type: 'individuals' };
  });
}

/** True when at least one record carries DBH, i.e. the stem-count basis is a
 *  genuinely different second reading rather than the same numbers twice. */
export function hasDbhRecords(records: ReportRecord[]): boolean {
  return records.some((r) => kindForType(r.organism_quantity_type) === 'DBH');
}

// ── Importance Value Index ──────────────────────────────────────────────────

export type IviComponent = 'density' | 'dominance' | 'frequency';

export type IviRow = {
  key: string;
  relDensity: number | null;
  relDominance: number | null;
  relFrequency: number | null;
  /** Subplots occupied ÷ subplots sampled (0–1). Reported alongside because it
   *  is the figure people usually mean by "frequency"; NOT an IVI component. */
  occupancy: number | null;
  /** Sum of the derivable components, 0–100·n. */
  sum: number;
  /** `sum / components.length`, so plots with different component counts can
   *  still be compared. */
  normalised: number;
};

export type IviOmission = {
  component: IviComponent;
  reason: 'no-stems' | 'mixed-units' | 'no-dominance' | 'need-2-units';
};

export type IviResult = {
  rows: IviRow[];
  components: IviComponent[];
  /** What the dominance component actually measures. Basal area is the
   *  classic definition; cover is a defensible substitute but must be named,
   *  because it is not the same quantity. */
  dominanceBasis: 'basal-area' | 'cover' | null;
  omitted: IviOmission[];
};

/**
 * IVI's relative frequency: a species' share of the summed frequencies, which
 * is what makes the component sum to 100. Takes the occupancy map
 * `relativeFrequency()` already returns, so there is exactly one place that
 * decides what "occupied" means.
 */
export function iviRelativeFrequency(occupancy: Map<string, number>): Map<string, number> {
  const total = [...occupancy.values()].reduce((s, v) => s + v, 0);
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const [k, v] of occupancy) out.set(k, (v / total) * 100);
  return out;
}

/** Share of a total, as a percentage; null when the total is not positive. */
function shares(values: Map<string, number>): Map<string, number> | null {
  const total = [...values.values()].reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  const out = new Map<string, number>();
  for (const [k, v] of values) out.set(k, (v / total) * 100);
  return out;
}

export function importanceValue(
  records: ReportRecord[],
  occupancy: Map<string, number>,
): IviResult {
  const omitted: IviOmission[] = [];
  const keys = new Set(records.map((r) => speciesKey(r)));
  const kinds = kindsOf(records);

  // ── density: stem counts, from DBH arrays or individual counts ──
  let relDensity: Map<string, number> | null = null;
  if (kinds.size > 1) {
    omitted.push({ component: 'density', reason: 'mixed-units' });
  } else {
    const stemsByKey = new Map<string, number>();
    let any = false;
    for (const r of records) {
      const n = stemsOf(r);
      if (n == null) continue;
      any = true;
      const k = speciesKey(r);
      stemsByKey.set(k, (stemsByKey.get(k) ?? 0) + n);
    }
    relDensity = any ? shares(stemsByKey) : null;
    if (!relDensity) omitted.push({ component: 'density', reason: 'no-stems' });
  }

  // ── dominance: basal area where DBH exists, otherwise cover ──
  let dominanceBasis: IviResult['dominanceBasis'] = null;
  let relDominance: Map<string, number> | null = null;
  const byKey = new Map<string, ReportRecord[]>();
  for (const r of records) {
    const k = speciesKey(r);
    const cur = byKey.get(k);
    if (cur) cur.push(r);
    else byKey.set(k, [r]);
  }
  if (kinds.size === 1 && kinds.has('DBH')) {
    const ba = new Map<string, number>();
    for (const [k, recs] of byKey) ba.set(k, basalArea(stemDiameters(recs)));
    relDominance = shares(ba);
    if (relDominance) dominanceBasis = 'basal-area';
  } else if (kinds.size === 1 && (kinds.has('BB') || kinds.has('percent'))) {
    const cov = new Map<string, number>();
    for (const [k, recs] of byKey) cov.set(k, aggregateCell(recs, 'cover').num ?? 0);
    relDominance = shares(cov);
    if (relDominance) dominanceBasis = 'cover';
  }
  if (!relDominance) {
    omitted.push({ component: 'dominance', reason: kinds.size > 1 ? 'mixed-units' : 'no-dominance' });
  }

  // ── frequency: needs at least two sampling units, same rule as elsewhere ──
  const relFrequency = occupancy.size > 0 ? iviRelativeFrequency(occupancy) : new Map<string, number>();
  if (relFrequency.size === 0) omitted.push({ component: 'frequency', reason: 'need-2-units' });

  const components: IviComponent[] = [];
  if (relDensity) components.push('density');
  if (relDominance) components.push('dominance');
  if (relFrequency.size > 0) components.push('frequency');

  const rows: IviRow[] = [...keys].map((k) => {
    const parts = [
      relDensity?.get(k) ?? null,
      relDominance?.get(k) ?? null,
      relFrequency.size > 0 ? (relFrequency.get(k) ?? 0) : null,
    ];
    const sum = parts.reduce<number>((s, v) => s + (v ?? 0), 0);
    return {
      key: k,
      relDensity: relDensity ? (relDensity.get(k) ?? 0) : null,
      relDominance: relDominance ? (relDominance.get(k) ?? 0) : null,
      relFrequency: relFrequency.size > 0 ? (relFrequency.get(k) ?? 0) : null,
      occupancy: occupancy.get(k) ?? null,
      sum,
      normalised: components.length > 0 ? sum / components.length : 0,
    };
  });
  rows.sort((a, b) => b.sum - a.sum || a.key.localeCompare(b.key));

  return { rows, components, dominanceBasis, omitted };
}
