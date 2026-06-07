import { getUserDb, getTaicolDb } from './init';
import { defaultSurveyorString } from './surveyors';

/** Fixed-plot vertical layers (vegetation profile, semantic labels). */
export type FixedLayer = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6';
/** Any layer that may appear in `plot_species_records.layer`. */
export type Layer = FixedLayer | 'T';
export type AbundanceMethod = 'BB' | 'percent' | 'DBH';
/** All possible fixed-plot layers. Which subset is *active* for a given plot
 *  is determined by `plot.layer_count` (1..6); see `getActiveLayers`. */
export const LAYERS: FixedLayer[] = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];
export const MAX_LAYER_COUNT = 6;
export const DEFAULT_LAYER_COUNT = 4;
export const TRANSECT_LAYER: Layer = 'T';
export const LAYER_LABEL: Record<Layer, string> = {
  E1: 'E1 苔蘚層',
  E2: 'E2 草本層',
  E3: 'E3 灌木層',
  E4: 'E4 亞喬木層',
  E5: 'E5 主林冠層',
  E6: 'E6 突出層',
  T: 'Transect 穿越線',
};

/** Convert layer_index (1..6) ↔ string layer key. */
export function layerKeyForIndex(idx: number): FixedLayer {
  return `E${idx}` as FixedLayer;
}
export function layerIndexOf(key: FixedLayer): number {
  return Number(key.slice(1));
}
/** First N active layers for a plot of given layer_count. */
export function getActiveLayers(layerCount: number): FixedLayer[] {
  return LAYERS.slice(0, Math.max(1, Math.min(MAX_LAYER_COUNT, layerCount)));
}

export type PlotStatus = 'active' | 'done';
/** Survey method.
 *  - fixed: 方形/固定樣區，分植群層 (E1..E6)，靜態 GPS。
 *  - transect: 穿越線，錄製軌跡，不分層。
 *  - point_count: 定點計數法，靜態 GPS + 半徑，不分層（reuses 'T' bucket）。 */
export type PlotType = 'fixed' | 'transect' | 'point_count';

/** Only fixed plots have vegetation strata (E1..E6) + plot_survey_layers rows. */
export function isStratified(plot: Pick<PlotSurvey, 'plot_type'>): boolean {
  return plot.plot_type === 'fixed';
}
/** Only transect plots record a GPS track. */
export function usesTrack(plot: Pick<PlotSurvey, 'plot_type'>): boolean {
  return plot.plot_type === 'transect';
}
/** Fixed + point_count need a static GPS fix before accepting species;
 *  transect unlocks via the track recorder stamping start_ts instead. */
export function requiresStaticGps(plot: Pick<PlotSurvey, 'plot_type'>): boolean {
  return plot.plot_type !== 'transect';
}

export type PlotSurvey = {
  id: number;
  uuid: string;
  plotid: string;
  plot_type: PlotType;
  /** Transect track as GeoJSON MultiLineString (transect only). */
  track_geojson: string | null;
  /** 1 = 軌跡已停止儲存（不可再 append）；0 = 仍可繼續錄 / 暫停。 */
  track_finalized: number;
  project_id: number;
  site_id: number | null;
  start_ts: number | null;
  stop_ts: number | null;
  /** Most recent reopen timestamp (status: done → active). Used by
   *  `StalePlotWatcher` so reopening an old plot doesn't immediately re-fire
   *  the idle alert. */
  resumed_at: number | null;
  status: PlotStatus;
  decimal_longitude: number | null;
  decimal_latitude: number | null;
  coord_uncertainty_m: number | null;
  /** Point-count circle radius in metres (point_count survey only, v13). */
  point_radius_m: number | null;
  sample_size_value: number | null;
  sample_size_unit: string | null;
  sampling_protocol: string | null;
  total_cover_pct: number | null;
  recorded_by: string | null;
  locality: string | null;
  field_note: string | null;
  elevation_m: number | null;
  slope_deg: number | null;
  aspect_deg: number | null;
  terrain_position: string | null;
  rock_cover_pct: number | null;
  gravel_cover_pct: number | null;
  bareland_cover_pct: number | null;
  /** Active vegetation layer count for this plot (1..6, default 4). */
  layer_count: number;
  /** JSON array of env photo URIs ({uri, sequence?, caption?}). */
  env_photos_json: string | null;
  // Legacy per-layer columns (v5 schema). Kept in DB for rollback safety until
  // v13; new code reads/writes via `plot_survey_layers` instead. Keep the
  // fields here so type-checking against legacy callsites still works during
  // the transition. Will be removed when the v13 drop migration ships.
  e0_cover_pct: number | null;
  e0_height_cm: number | null;
  e1_cover_pct: number | null;
  e1_height_cm: number | null;
  e2_cover_pct: number | null;
  e2_height_cm: number | null;
  e3_cover_pct: number | null;
  e3_height_cm: number | null;
  e0_method: AbundanceMethod;
  e1_method: AbundanceMethod;
  e2_method: AbundanceMethod;
  e3_method: AbundanceMethod;
  created_at: number;
  updated_at: number;
};

/** Display/export unit for a layer's height; height_cm is always stored in cm. */
export type HeightUnit = 'cm' | 'm';

/** Normalized per-layer environmental data (v12 schema). */
export type PlotLayer = {
  id: number;
  plot_survey_id: number;
  layer_index: number;
  cover_pct: number | null;
  /** Canonical height, always stored in cm regardless of height_unit. */
  height_cm: number | null;
  height_unit: HeightUnit;
  method: AbundanceMethod;
};

export type PlotSpeciesRecord = {
  id: number;
  plot_survey_id: number;
  taxon_id: string;
  /** DwC occurrenceID — stable v4 uuid assigned at insert. */
  occurrence_id: string;
  layer: Layer;
  bb_value: string | null;
  percent: number | null;
  dbh_values_json: string | null;
  notes: string | null;
  photo_paths: string | null;
  observed_at: number;
  created_at: number;
  // DwC species attributes (v8)
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
  // DwC abundance generalization (v9). New writes go here; bb_value /
  // percent / dbh_values_json are deprecated for new records.
  organism_quantity: string | null;
  organism_quantity_type: string | null;
  // Per-record GPS (v13). Available for all plot types; most useful for
  // transect (each observation along the line has its own location).
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  // Detection method (v13): 'seen' | 'heard' | 'flying'. Point count / animal
  // records; null for plant/unspecified.
  detection_type: string | null;
};

export type PlotSpeciesRecordWithTaxon = PlotSpeciesRecord & {
  simple_name: string;
  name_author: string;
  common_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  is_endemic: string;
  alien_type: string;
  is_hybrid: string;
  kingdom: string;
  kingdom_c: string;
  /** Class name from TaiCOL (used by life-stage UI for animals). */
  class: string;
  class_c: string;
  phylum: string;
  phylum_c: string;
  order: string;
  order_c: string;
  genus: string;
  genus_c: string;
  // Conservation status (for checklist export). From TaiCOL.
  redlist: string;
  iucn: string;
  cites: string;
  protected: string;
};

export function generateUuid(): string {
  // Simple v4-ish UUID; not crypto-grade but fine for local plot identifiers.
  const hex = (n: number) =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0')
      .slice(0, n);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${hex(4)}`;
}

export type CreatePlotInput = {
  plotid: string;
  plot_type?: PlotType;
  project_id?: number;
  recorded_by?: string | null;
  sampling_protocol?: string | null;
  sample_size_value?: number | null;
  sample_size_unit?: string | null;
};

/**
 * Force-end every still-open plot survey. Safety net to guarantee at most
 * one active plot at any moment.
 */
export function endAllActivePlots(): void {
  const db = getUserDb();
  const now = Date.now();
  db.executeSync(
    `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active'`,
    [now, now],
  );
}

export function createPlotSurvey(input: CreatePlotInput): number {
  const db = getUserDb();
  const now = Date.now();
  // Belt + suspenders: enforce single-active across BOTH kinds before we open
  // another. UI gate (recordCreate.ts) is the primary check, but the plots
  // tab "+" button bypasses it, so the DB layer must close any active session
  // AND any active plot here.
  db.executeSync(
    `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active'`,
    [now, now],
  );
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [now]);
  const res = db.executeSync(
    `INSERT INTO plot_surveys (
       uuid, plotid, plot_type, project_id, status,
       sampling_protocol, sample_size_value, sample_size_unit, recorded_by,
       start_ts, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateUuid(),
      input.plotid,
      input.plot_type ?? 'fixed',
      input.project_id ?? 0,
      input.sampling_protocol ?? null,
      input.sample_size_value ?? null,
      input.sample_size_unit ?? null,
      // Omitted → auto-fill from default surveyors; explicit null → stays empty.
      input.recorded_by !== undefined ? input.recorded_by : defaultSurveyorString(),
      now,
      now,
      now,
    ],
  );
  const plotId = res.insertId ?? 0;
  // Pre-seed `plot_survey_layers` with rows for the default layer count (4 =
  // E1-E4). Transect plots get no layer rows. Keeping the layer rows in lockstep
  // with `plot_surveys.layer_count` is enforced by setPlotLayerCount() below.
  if ((input.plot_type ?? 'fixed') === 'fixed' && plotId > 0) {
    for (let i = 1; i <= DEFAULT_LAYER_COUNT; i++) {
      // E4 (亞喬木層) historically used DBH method; preserve that default so
      // existing user expectations carry across schemas.
      const defaultMethod: AbundanceMethod = i === 4 ? 'DBH' : 'BB';
      db.executeSync(
        `INSERT INTO plot_survey_layers (plot_survey_id, layer_index, method) VALUES (?, ?, ?)`,
        [plotId, i, defaultMethod],
      );
    }
  }
  return plotId;
}

// ─────────────────────────────────────────────────────────────────────
// Per-layer environmental data (v12: normalized into plot_survey_layers)
// ─────────────────────────────────────────────────────────────────────

/** Get all layer rows for a plot, ordered by layer_index ascending. Always
 *  returns at most plot.layer_count rows for fixed plots; empty for transect. */
export function getPlotLayers(plotId: number): PlotLayer[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM plot_survey_layers WHERE plot_survey_id = ? ORDER BY layer_index ASC`,
    [plotId],
  );
  return (res.rows ?? []) as unknown as PlotLayer[];
}

/** Get a single layer (creates an empty row on-demand if missing — handy for
 *  the UI which renders one cell per layer_index regardless of whether the
 *  user has typed anything yet). */
export function getOrCreatePlotLayer(plotId: number, layerIndex: number): PlotLayer {
  const db = getUserDb();
  const existing = db.executeSync(
    `SELECT * FROM plot_survey_layers WHERE plot_survey_id = ? AND layer_index = ? LIMIT 1`,
    [plotId, layerIndex],
  );
  const row = existing.rows?.[0] as unknown as PlotLayer | undefined;
  if (row) return row;
  db.executeSync(
    `INSERT INTO plot_survey_layers (plot_survey_id, layer_index, method) VALUES (?, ?, 'BB')`,
    [plotId, layerIndex],
  );
  const reread = db.executeSync(
    `SELECT * FROM plot_survey_layers WHERE plot_survey_id = ? AND layer_index = ? LIMIT 1`,
    [plotId, layerIndex],
  );
  return reread.rows![0] as unknown as PlotLayer;
}

export type UpdatePlotLayerPatch = Partial<
  Pick<PlotLayer, 'cover_pct' | 'height_cm' | 'height_unit' | 'method'>
>;

export function updatePlotLayer(
  plotId: number,
  layerIndex: number,
  patch: UpdatePlotLayerPatch,
): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if ('cover_pct' in patch) {
    sets.push('cover_pct = ?');
    args.push(patch.cover_pct ?? null);
  }
  if ('height_cm' in patch) {
    sets.push('height_cm = ?');
    args.push(patch.height_cm ?? null);
  }
  if ('height_unit' in patch && patch.height_unit) {
    sets.push('height_unit = ?');
    args.push(patch.height_unit);
  }
  if ('method' in patch && patch.method) {
    sets.push('method = ?');
    args.push(patch.method);
  }
  if (sets.length === 0) return;
  // Ensure the row exists before updating (avoids silent no-op when the user
  // edits a layer that hasn't been touched yet).
  getOrCreatePlotLayer(plotId, layerIndex);
  args.push(plotId, layerIndex);
  const db = getUserDb();
  db.executeSync(
    `UPDATE plot_survey_layers SET ${sets.join(', ')} WHERE plot_survey_id = ? AND layer_index = ?`,
    args,
  );
  db.executeSync(`UPDATE plot_surveys SET updated_at = ? WHERE id = ?`, [Date.now(), plotId]);
}

/** Parse the JSON-array `env_photos_json` cell into a list of URIs. Returns
 *  empty array for null / invalid input. Same shape as
 *  `plot_species_records.photo_paths` so the existing PhotoGrid component
 *  works against env photos without modification. */
export function parseEnvPhotos(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr.filter((s): s is string => typeof s === 'string');
  } catch {
    /* ignore */
  }
  return [];
}

/** Write a fresh env-photo URI list back to the plot. Pass an empty array to
 *  clear all env photos. */
export function updatePlotEnvPhotos(plotId: number, uris: string[]): void {
  const db = getUserDb();
  const value = uris.length === 0 ? null : JSON.stringify(uris);
  db.executeSync(`UPDATE plot_surveys SET env_photos_json = ?, updated_at = ? WHERE id = ?`, [
    value,
    Date.now(),
    plotId,
  ]);
}

/** Adjust the active layer count. Increasing adds default rows; decreasing
 *  KEEPS the data in higher-index rows (don't delete — user might bump count
 *  back up). UI just hides them via getActiveLayers(plot.layer_count). */
export function setPlotLayerCount(plotId: number, count: number): void {
  const clamped = Math.max(1, Math.min(MAX_LAYER_COUNT, count));
  const db = getUserDb();
  // Ensure all layer rows up to `clamped` exist.
  for (let i = 1; i <= clamped; i++) {
    getOrCreatePlotLayer(plotId, i);
  }
  db.executeSync(`UPDATE plot_surveys SET layer_count = ?, updated_at = ? WHERE id = ?`, [
    clamped,
    Date.now(),
    plotId,
  ]);
}

export function listPlotSurveys(): PlotSurvey[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM plot_surveys ORDER BY COALESCE(start_ts, created_at) DESC`,
  );
  return (res.rows ?? []) as unknown as PlotSurvey[];
}

export function getActivePlot(): PlotSurvey | null {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM plot_surveys WHERE status = 'active' ORDER BY COALESCE(start_ts, created_at) DESC LIMIT 1`,
  );
  return ((res.rows?.[0] as unknown as PlotSurvey) ?? null) as PlotSurvey | null;
}

export function getPlotSurvey(id: number): PlotSurvey | null {
  const db = getUserDb();
  const res = db.executeSync(`SELECT * FROM plot_surveys WHERE id = ? LIMIT 1`, [id]);
  return ((res.rows?.[0] as unknown as PlotSurvey) ?? null) as PlotSurvey | null;
}

export type UpdatePlotPatch = Partial<
  Omit<PlotSurvey, 'id' | 'uuid' | 'created_at' | 'updated_at'>
>;

const PLOT_UPDATABLE_KEYS: (keyof UpdatePlotPatch)[] = [
  'plotid',
  'project_id',
  'site_id',
  'start_ts',
  'stop_ts',
  'status',
  'decimal_longitude',
  'decimal_latitude',
  'coord_uncertainty_m',
  'point_radius_m',
  'sample_size_value',
  'sample_size_unit',
  'sampling_protocol',
  'total_cover_pct',
  'recorded_by',
  'locality',
  'field_note',
  'elevation_m',
  'slope_deg',
  'aspect_deg',
  'terrain_position',
  'rock_cover_pct',
  'gravel_cover_pct',
  'bareland_cover_pct',
  'layer_count',
  'env_photos_json',
  // Legacy per-layer columns. Still listed so any in-flight writer from older
  // code paths doesn't error out, but new UI must go through updatePlotLayer
  // against `plot_survey_layers`. Will be removed in v13.
  'e0_cover_pct',
  'e0_height_cm',
  'e1_cover_pct',
  'e1_height_cm',
  'e2_cover_pct',
  'e2_height_cm',
  'e3_cover_pct',
  'e3_height_cm',
  'e0_method',
  'e1_method',
  'e2_method',
  'e3_method',
  'track_geojson',
  'track_finalized',
];

export function updatePlotSurvey(id: number, patch: UpdatePlotPatch): void {
  const db = getUserDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const key of PLOT_UPDATABLE_KEYS) {
    if (key in patch) {
      sets.push(`${key} = ?`);
      const v = patch[key];
      args.push(v === undefined ? null : (v as string | number | null));
    }
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = ?`);
  args.push(Date.now());
  args.push(id);
  db.executeSync(`UPDATE plot_surveys SET ${sets.join(', ')} WHERE id = ?`, args);
}

// ─────────────────────────────────────────────────────────────────────
// Transect track (MultiLineString segments)
// ─────────────────────────────────────────────────────────────────────

export type TrackSegment = [number, number][]; // [[lng, lat], ...]

type MultiLineString = {
  type: 'MultiLineString';
  coordinates: TrackSegment[];
};

/** Parse plot.track_geojson into segments. Returns [] if missing/invalid. */
export function parseTrackSegments(geojson: string | null): TrackSegment[] {
  if (!geojson) return [];
  try {
    const obj = JSON.parse(geojson);
    if (obj && obj.type === 'MultiLineString' && Array.isArray(obj.coordinates)) {
      return obj.coordinates as TrackSegment[];
    }
    // Backward-compat: a legacy LineString gets wrapped as one segment.
    if (obj && obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
      return [obj.coordinates as TrackSegment];
    }
  } catch {
    // ignore
  }
  return [];
}

export function buildTrackGeoJSON(segments: TrackSegment[]): string {
  const obj: MultiLineString = { type: 'MultiLineString', coordinates: segments };
  return JSON.stringify(obj);
}

/** Replace the plot's track with the given segments (fast path used by UI). */
export function writePlotTrack(plotId: number, segments: TrackSegment[]): void {
  const db = getUserDb();
  db.executeSync(
    `UPDATE plot_surveys SET track_geojson = ?, updated_at = ? WHERE id = ?`,
    [buildTrackGeoJSON(segments), Date.now(), plotId],
  );
}

/** Mark the track finalized (locked from further append). Plot itself stays active. */
export function finalizePlotTrack(plotId: number): void {
  const db = getUserDb();
  db.executeSync(
    `UPDATE plot_surveys SET track_finalized = 1, updated_at = ? WHERE id = ?`,
    [Date.now(), plotId],
  );
}

/** Reverse of finalize: allow further track recording. */
export function unfinalizePlotTrack(plotId: number): void {
  const db = getUserDb();
  db.executeSync(
    `UPDATE plot_surveys SET track_finalized = 0, updated_at = ? WHERE id = ?`,
    [Date.now(), plotId],
  );
}

/** Haversine length in meters; sums per-segment distances. */
export function trackLengthMeters(segments: TrackSegment[]): number {
  let total = 0;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const [lng1, lat1] = seg[i - 1];
      const [lng2, lat2] = seg[i];
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      total += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }
  }
  return total;
}

export function endPlotSurvey(id: number): void {
  const db = getUserDb();
  const now = Date.now();
  db.executeSync(
    `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

export function reopenPlotSurvey(id: number): void {
  const db = getUserDb();
  const now = Date.now();
  // Force-end any other active plot AND any active session first to keep the
  // single-active-across-kinds invariant. UI's `recordCreate.ts` is the
  // primary gate but the plot/[id] "重開" button bypasses it.
  db.executeSync(
    `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active' AND id != ?`,
    [now, now, id],
  );
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [now]);
  // Stamp `resumed_at` so StalePlotWatcher's baseline isn't the original
  // `start_ts` (which could be days old when reopening an ended plot).
  db.executeSync(
    `UPDATE plot_surveys SET status = 'active', stop_ts = NULL, resumed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

export function deletePlotSurvey(id: number): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM plot_surveys WHERE id = ?`, [id]);
}

/** True iff plot has the hard-required fields filled.
 *
 *  - fixed / point_count plot: plotid + static GPS (lat/lng/uncertainty)
 *  - transect plot: plotid + track has been activated at least once
 *                   (signalled by start_ts being set; trackRecorder.startRecording
 *                   stamps this immediately on ▶, without waiting for a GPS fix).
 */
export function plotCanAcceptSpecies(plot: PlotSurvey): boolean {
  if (!plot.plotid) return false;
  if (!requiresStaticGps(plot)) {
    return plot.start_ts != null;
  }
  return (
    plot.decimal_latitude !== null &&
    plot.decimal_longitude !== null &&
    plot.coord_uncertainty_m !== null
  );
}

/** Look up the abundance method configured for a given layer of this plot.
 *  Reads from plot_survey_layers (v12 schema). Transect plots have no per-layer
 *  config — caller falls back to BB. */
export function plotMethodForLayer(plot: PlotSurvey, layer: Layer): AbundanceMethod {
  if (layer === 'T') return 'BB';
  const idx = layerIndexOf(layer);
  const layers = getPlotLayers(plot.id);
  return layers.find((l) => l.layer_index === idx)?.method ?? 'BB';
}

// ---------- species records ----------

export type AddPlotSpeciesInput = {
  plot_survey_id: number;
  taxon_id: string;
  layer: Layer;
  /** New DwC fields (v9). */
  organism_quantity?: string | null;
  organism_quantity_type?: string | null;
  notes?: string | null;
  sex?: string | null;
  life_stage?: string | null;
  reproductive_condition?: string | null;
  leaf_phenology?: string | null;
  /** Per-record GPS (v13). */
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  /** Detection method (v13): 'seen' | 'heard' | 'flying'. */
  detection_type?: string | null;
};

export function addPlotSpecies(input: AddPlotSpeciesInput): number {
  const db = getUserDb();
  const now = Date.now();
  const res = db.executeSync(
    `INSERT INTO plot_species_records
       (plot_survey_id, taxon_id, occurrence_id, layer,
        organism_quantity, organism_quantity_type,
        notes, sex, life_stage, reproductive_condition, leaf_phenology,
        lat, lng, accuracy, detection_type,
        observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.plot_survey_id,
      input.taxon_id,
      generateUuid(),
      input.layer,
      input.organism_quantity ?? null,
      input.organism_quantity_type ?? null,
      input.notes ?? null,
      input.sex ?? null,
      input.life_stage ?? null,
      input.reproductive_condition ?? null,
      input.leaf_phenology ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.accuracy ?? null,
      input.detection_type ?? null,
      now,
      now,
    ],
  );
  return res.insertId ?? 0;
}

export function deletePlotSpecies(id: number): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM plot_species_records WHERE id = ?`, [id]);
}

export function parseDbhValues(s: string | null): number[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.filter((x): x is number => typeof x === 'number');
  } catch {
    /* ignore */
  }
  return [];
}

export type PlotSpeciesAttributePatch = Partial<{
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
  detection_type: string | null;
}>;

export function updatePlotSpeciesValue(
  id: number,
  patch: {
    organism_quantity?: string | null;
    organism_quantity_type?: string | null;
    notes?: string | null;
  } & PlotSpeciesAttributePatch,
): void {
  const db = getUserDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if ('organism_quantity' in patch) {
    sets.push(`organism_quantity = ?`);
    args.push(patch.organism_quantity ?? null);
  }
  if ('organism_quantity_type' in patch) {
    sets.push(`organism_quantity_type = ?`);
    args.push(patch.organism_quantity_type ?? null);
  }
  if ('notes' in patch) {
    sets.push(`notes = ?`);
    args.push(patch.notes ?? null);
  }
  for (const col of [
    'sex',
    'life_stage',
    'reproductive_condition',
    'leaf_phenology',
    'detection_type',
  ] as const) {
    if (col in patch) {
      sets.push(`${col} = ?`);
      args.push(patch[col] ?? null);
    }
  }
  if (sets.length === 0) return;
  args.push(id);
  db.executeSync(`UPDATE plot_species_records SET ${sets.join(', ')} WHERE id = ?`, args);
}

/** Persist per-record GPS for a plot species record. Mirrors
 *  `records.ts::updateRecordLocation`. Pass nulls to clear. */
export function updatePlotSpeciesLocation(
  id: number,
  lat: number | null,
  lng: number | null,
  accuracy: number | null = null,
): void {
  const db = getUserDb();
  db.executeSync(`UPDATE plot_species_records SET lat = ?, lng = ?, accuracy = ? WHERE id = ?`, [
    lat,
    lng,
    accuracy,
    id,
  ]);
}

/** Persist the list of photo URIs (`ph://` or `file://`) for a plot species
 *  record. Pass an empty array to clear. Stored as JSON in `photo_paths`. */
export function updatePlotSpeciesPhotos(id: number, paths: string[]): void {
  const db = getUserDb();
  const value = paths.length > 0 ? JSON.stringify(paths) : null;
  db.executeSync(`UPDATE plot_species_records SET photo_paths = ? WHERE id = ?`, [value, id]);
}

/** Last species observation epoch (ms) for the given plot; null if none. */
export function latestPlotActivityAt(plotSurveyId: number): number | null {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT MAX(observed_at) AS m FROM plot_species_records WHERE plot_survey_id = ?`,
    [plotSurveyId],
  );
  const row = (res.rows?.[0] ?? {}) as { m?: number | null };
  return row.m ?? null;
}

export function listPlotSpecies(plotSurveyId: number): PlotSpeciesRecordWithTaxon[] {
  const userDb = getUserDb();
  const taicolDb = getTaicolDb();

  const recordsRes = userDb.executeSync(
    `SELECT * FROM plot_species_records WHERE plot_survey_id = ? ORDER BY observed_at ASC`,
    [plotSurveyId],
  );
  const records = (recordsRes.rows ?? []) as unknown as PlotSpeciesRecord[];
  if (records.length === 0) return [];

  const taxonIds = Array.from(new Set(records.map((r) => r.taxon_id)));
  const placeholders = taxonIds.map(() => '?').join(',');
  const taxaRes = taicolDb.executeSync(
    `SELECT taxon_id, simple_name, name_author, common_name_c,
            family, family_c, rank, is_endemic, alien_type, is_hybrid,
            kingdom, kingdom_c, class, class_c, phylum, phylum_c, "order", order_c, genus, genus_c,
            redlist, iucn, cites, protected
     FROM taicol_names
     WHERE taxon_id IN (${placeholders}) AND usage_status = 'accepted'`,
    taxonIds,
  );
  const taxonMap = new Map<string, Record<string, unknown>>();
  for (const row of (taxaRes.rows ?? []) as Array<Record<string, unknown>>) {
    taxonMap.set(row.taxon_id as string, row);
  }

  return records.map((r) => {
    const t = taxonMap.get(r.taxon_id) ?? {};
    return {
      ...r,
      simple_name: (t.simple_name as string) ?? '',
      name_author: (t.name_author as string) ?? '',
      common_name_c: (t.common_name_c as string) ?? '',
      family: (t.family as string) ?? '',
      family_c: (t.family_c as string) ?? '',
      rank: (t.rank as string) ?? '',
      is_endemic: (t.is_endemic as string) ?? '',
      alien_type: (t.alien_type as string) ?? '',
      is_hybrid: (t.is_hybrid as string) ?? '',
      kingdom: (t.kingdom as string) ?? '',
      kingdom_c: (t.kingdom_c as string) ?? '',
      class: (t.class as string) ?? '',
      class_c: (t.class_c as string) ?? '',
      phylum: (t.phylum as string) ?? '',
      phylum_c: (t.phylum_c as string) ?? '',
      order: (t.order as string) ?? '',
      order_c: (t.order_c as string) ?? '',
      genus: (t.genus as string) ?? '',
      genus_c: (t.genus_c as string) ?? '',
      redlist: (t.redlist as string) ?? '',
      iucn: (t.iucn as string) ?? '',
      cites: (t.cites as string) ?? '',
      protected: (t.protected as string) ?? '',
    };
  });
}
