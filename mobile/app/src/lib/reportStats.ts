/**
 * Survey statistics that no other module computes — the analysis gaps the
 * report feature exists to close.
 *
 * Everything the app already derives (richness, H′, J′, Simpson, Chao1/2,
 * coverage, β) lives in `diversity.ts` and is NOT duplicated here; this file
 * only adds what was captured in the schema but never summarised: taxonomic
 * composition, conservation tallies as DATA (they previously existed only as
 * prose inside `markdown.ts`), the vertical layer profile, transect and
 * point-count effort, and the ground-cover budget.
 *
 * Pure module — no DB / expo / `~/i18n` imports, so `scripts/check-report.mjs`
 * can run it under Node. Labels come from the caller (`t` is injected at the
 * report-model level, never here).
 */
import { kindForType } from './dwcAbundanceCore';
import { speciesKey, type DiversityRecord } from './diversity';
import { trackLengthMeters, type TrackSegment } from './track';

/**
 * The record shape the report reads. Structurally satisfied by both
 * `PlotSpeciesRecordWithTaxon` and `RecordWithTaxon` — every field beyond the
 * abundance pair is optional so a caller can pass either.
 */
export type ReportRecord = DiversityRecord & {
  simple_name?: string;
  common_name_c?: string;
  family?: string;
  family_c?: string;
  order?: string;
  order_c?: string;
  kingdom?: string;
  phylum?: string;
  /** Class. Named `class` on the taxon join (a reserved word, hence the
   *  quoting in the SQL), so it is read through an index signature there. */
  class?: string;
  /** Taxonomic rank from the taxon join. Values are NOT normalised — TaiCOL
   *  supplies English, the JP list Traditional Chinese (`rankColors.ts` has
   *  the mapping). Used to separate species-level from genus-level records,
   *  which otherwise silently inflate richness. */
  rank?: string;
  genus?: string;
  is_endemic?: string;
  alien_type?: string;
  redlist?: string;
  iucn?: string;
  cites?: string;
  protected?: string;
  layer?: string;
  detection_type?: string | null;
};

/** Distinct species (v28 composite key) among the given records. */
function distinctSpecies(records: ReportRecord[]): Map<string, ReportRecord> {
  const m = new Map<string, ReportRecord>();
  for (const r of records) {
    const k = speciesKey(r);
    if (!m.has(k)) m.set(k, r);
  }
  return m;
}

export type CompositionRow = { name: string; nameLocal: string; count: number };

/**
 * Species count per family (or order), descending. Counts SPECIES, not
 * records — a species recorded in four layers is one species.
 */
export function taxonComposition(
  records: ReportRecord[],
  level: 'family' | 'order' = 'family',
): CompositionRow[] {
  const localKey = level === 'family' ? 'family_c' : 'order_c';
  const byName = new Map<string, { local: string; n: number }>();
  for (const r of distinctSpecies(records).values()) {
    const name = (r[level] ?? '').trim();
    if (!name) continue;
    const local = ((r as Record<string, unknown>)[localKey] as string | undefined) ?? '';
    const cur = byName.get(name);
    if (cur) cur.n += 1;
    else byName.set(name, { local, n: 1 });
  }
  return [...byName.entries()]
    .map(([name, v]) => ({ name, nameLocal: v.local, count: v.n }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Categories that mean "not of concern" and are therefore left out of the
 * conservation summary. Same set `markdown.ts` uses, so the report and the
 * checklist export can never disagree about what counts as noteworthy.
 */
const SAFE_CATEGORIES = new Set(['LC', 'NLC', 'NE', 'NA', '']);

export type CategoryCount = { code: string; count: number };
export type AlienCount = CategoryCount & { kingdom: string };

export type ConservationTally = {
  /** Distinct species considered (the denominator for every figure below). */
  total: number;
  endemic: number;
  /**
   * alien_type → species count, raw DB values ('native' | 'naturalized' | …),
   * split by kingdom. The kingdom is carried per row because 'cultured' means
   * captive for an animal and cultivated for a plant; tallying it against one
   * kingdom picked from the whole record set mislabels every mixed dataset.
   */
  alien: AlienCount[];
  /** Threatened categories only; LC/NLC/NE/NA dropped. */
  redlist: CategoryCount[];
  iucn: CategoryCount[];
  /** Any non-empty CITES appendix. */
  cites: CategoryCount[];
  /** Protection level: I / II / III (wildlife act) or 1 (cultural heritage). */
  protected: CategoryCount[];
};

function tallyField(
  species: ReportRecord[],
  pick: (r: ReportRecord) => string,
  dropSafe: boolean,
): CategoryCount[] {
  const m = new Map<string, number>();
  for (const r of species) {
    const v = (pick(r) ?? '').trim();
    if (!v) continue;
    if (dropSafe && SAFE_CATEGORIES.has(v)) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Tally alien status per (code, kingdom) so the caller can label 'cultured'
 *  correctly for each. Sorted by code then kingdom for a stable order. */
function tallyAlien(species: ReportRecord[]): AlienCount[] {
  const m = new Map<string, number>();
  for (const r of species) {
    const code = (r.alien_type ?? '').trim();
    if (!code) continue;
    const key = `${code}\u0000${(r.kingdom ?? '').trim()}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => {
      const [code, kingdom] = key.split('\u0000');
      return { code, kingdom, count };
    })
    .sort((a, b) => a.code.localeCompare(b.code) || a.kingdom.localeCompare(b.kingdom));
}

export function conservationTally(records: ReportRecord[]): ConservationTally {
  const species = [...distinctSpecies(records).values()];
  return {
    total: species.length,
    endemic: species.filter((r) => r.is_endemic === 'true').length,
    alien: tallyAlien(species),
    redlist: tallyField(species, (r) => r.redlist ?? '', true),
    iucn: tallyField(species, (r) => r.iucn ?? '', true),
    cites: tallyField(species, (r) => r.cites ?? '', false),
    protected: tallyField(species, (r) => r.protected ?? '', false),
  };
}

export type LayerProfileRow = {
  /** 'E1'…'E6' — the layer key as stored on records. */
  layer: string;
  layerIndex: number;
  coverPct: number | null;
  heightCm: number | null;
  /** Display unit the surveyor chose; `heightCm` stays canonical cm. */
  heightUnit: string;
  method: string;
  /** Species recorded in this layer. */
  richness: number;
};

export type LayerInput = {
  layer_index: number;
  cover_pct: number | null;
  height_cm: number | null;
  height_unit?: string;
  method?: string;
};

/**
 * Vertical structure: the configured cover/height of each layer plus the
 * species richness actually recorded in it. Layers with no configuration and
 * no records are dropped — an unused E6 is noise in a report.
 */
export function layerProfile(layers: LayerInput[], records: ReportRecord[]): LayerProfileRow[] {
  const richnessByLayer = new Map<string, Set<string>>();
  for (const r of records) {
    const l = (r.layer ?? '').trim();
    if (!l) continue;
    const set = richnessByLayer.get(l);
    if (set) set.add(speciesKey(r));
    else richnessByLayer.set(l, new Set([speciesKey(r)]));
  }
  const rows: LayerProfileRow[] = [];
  for (const l of [...layers].sort((a, b) => a.layer_index - b.layer_index)) {
    const key = `E${l.layer_index}`;
    const richness = richnessByLayer.get(key)?.size ?? 0;
    if (l.cover_pct == null && l.height_cm == null && richness === 0) continue;
    rows.push({
      layer: key,
      layerIndex: l.layer_index,
      coverPct: l.cover_pct,
      heightCm: l.height_cm,
      heightUnit: l.height_unit ?? 'cm',
      method: l.method ?? '',
      richness,
    });
  }
  return rows;
}

export type TransectEffort = {
  lengthM: number;
  lengthKm: number;
  richness: number;
  /** Species per km — null when the track is too short to divide by. */
  speciesPerKm: number | null;
};

/** Transect effort. The track length was already computable but never
 *  surfaced anywhere outside two preview modals. */
export function transectEffort(
  segments: TrackSegment[],
  records: ReportRecord[],
): TransectEffort {
  const lengthM = trackLengthMeters(segments);
  const lengthKm = lengthM / 1000;
  const richness = distinctSpecies(records).size;
  return {
    lengthM,
    lengthKm,
    richness,
    // Below ~10 m the ratio explodes into a meaningless number.
    speciesPerKm: lengthM >= 10 ? richness / lengthKm : null,
  };
}

export type PointCountEffort = {
  radiusM: number | null;
  areaM2: number | null;
  areaHa: number | null;
  richness: number;
  /** Total individuals — only when every quantified record is a count. */
  individuals: number | null;
  /** Individuals per hectare; null when either input is unavailable. */
  densityPerHa: number | null;
  /** seen / heard / flying → record count. */
  detection: CategoryCount[];
};

export function pointCountEffort(
  radiusM: number | null,
  records: ReportRecord[],
): PointCountEffort {
  const areaM2 = radiusM != null && radiusM > 0 ? Math.PI * radiusM * radiusM : null;
  const areaHa = areaM2 != null ? areaM2 / 10000 : null;
  const quantified = records.filter(
    (r) => r.organism_quantity != null && r.organism_quantity !== '',
  );
  const allCounts =
    quantified.length > 0 &&
    quantified.every((r) => kindForType(r.organism_quantity_type) === 'count');
  let individuals: number | null = null;
  if (allCounts) {
    individuals = 0;
    for (const r of quantified) {
      const n = Number(r.organism_quantity);
      if (Number.isFinite(n)) individuals += n;
    }
  }
  const detect = new Map<string, number>();
  for (const r of records) {
    const d = (r.detection_type ?? '').trim();
    if (!d) continue;
    detect.set(d, (detect.get(d) ?? 0) + 1);
  }
  return {
    radiusM,
    areaM2,
    areaHa,
    richness: distinctSpecies(records).size,
    individuals,
    densityPerHa: individuals != null && areaHa ? individuals / areaHa : null,
    detection: [...detect.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export type GroundCoverRow = { key: string; pct: number };
export type GroundCoverBudget = {
  rows: GroundCoverRow[];
  /** Sum of the ground-surface fractions (rock + gravel + bareland + litter). */
  surfaceTotal: number | null;
  /** True when those fractions exceed 100 % — a data-entry warning, not an
   *  error: the app never constrained them. */
  surfaceOver100: boolean;
  totalCoverPct: number | null;
};

type GroundCoverInput = {
  rock_cover_pct?: number | null;
  gravel_cover_pct?: number | null;
  bareland_cover_pct?: number | null;
  litter_cover_pct?: number | null;
  vascular_cover_pct?: number | null;
  bryophyte_cover_pct?: number | null;
  lichen_cover_pct?: number | null;
  total_cover_pct?: number | null;
};

/**
 * Ground-cover budget. The surface fractions (rock/gravel/bareland/litter)
 * partition the ground and should approach 100 %; the living covers
 * (vascular/bryophyte/lichen) overlap them and each other, so they are
 * reported but deliberately NOT summed into the same total.
 */
export function groundCoverBudget(plot: GroundCoverInput): GroundCoverBudget {
  const pick = (k: keyof GroundCoverInput): number | null => {
    const v = plot[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const rows: GroundCoverRow[] = [];
  const surface: Array<keyof GroundCoverInput> = [
    'rock_cover_pct',
    'gravel_cover_pct',
    'bareland_cover_pct',
    'litter_cover_pct',
  ];
  const living: Array<keyof GroundCoverInput> = [
    'vascular_cover_pct',
    'bryophyte_cover_pct',
    'lichen_cover_pct',
  ];
  let surfaceTotal: number | null = null;
  for (const k of surface) {
    const v = pick(k);
    if (v == null) continue;
    rows.push({ key: k, pct: v });
    surfaceTotal = (surfaceTotal ?? 0) + v;
  }
  for (const k of living) {
    const v = pick(k);
    if (v != null) rows.push({ key: k, pct: v });
  }
  return {
    rows,
    surfaceTotal,
    surfaceOver100: surfaceTotal != null && surfaceTotal > 100,
    totalCoverPct: pick('total_cover_pct'),
  };
}
