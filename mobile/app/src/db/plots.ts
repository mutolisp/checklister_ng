import {
  EMPTY_TAXON_FIELDS,
  applyAdoptedName,
  resolveAdoptedNames,
  resolveTaxa,
  type AdoptionInput,
  type AdoptionStatus,
} from './taxonLookup';
import { buildTrackGeoJSON, parseTrackSegments, type TrackSegment } from '~/lib/track';
import { generateUuid } from './uuid';
import { getUserDb, withTransaction } from './init';
import { existingProjectId, resolveProjectIdByName } from './projects';
import { createSite, deleteSiteIfUnreferenced, type ImportedSite } from './sites';
import type { DuplicateRecordOptions } from './duplicate';
import { defaultSurveyorString } from './surveyors';
import i18n from '~/i18n';

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
export function layerLabel(layer: Layer): string {
  return i18n.t('layer.' + layer);
}

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
  /** Living ground cover (v21), complementing the substrate trio above. */
  vascular_cover_pct: number | null;
  bryophyte_cover_pct: number | null;
  lichen_cover_pct: number | null;
  /** Litterfall / dead organic ground cover (v22). */
  litter_cover_pct: number | null;
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
  /** Subplot this record belongs to (v18); NULL on un-split plots. */
  subplot_id: number | null;
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
  /** The name this record was deliberately filed under (v28). Both NULL = the
   *  taxon's accepted name. */
  used_name_id: number | null;
  used_scientific_name: string | null;
};

export type PlotSpeciesRecordWithTaxon = PlotSpeciesRecord & AdoptionStatus & {
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

// 實作移到 ./uuid（SQLite CSPRNG）。這裡 re-export 讓既有 import 路徑不變。
export { generateUuid };

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
      // % cover is the default unit for new layers. E4 (亞喬木層) keeps DBH —
      // stem diameter is the standard measure for a tree layer, and that
      // default predates this change.
      const defaultMethod: AbundanceMethod = i === 4 ? 'DBH' : 'percent';
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
    `INSERT INTO plot_survey_layers (plot_survey_id, layer_index, method) VALUES (?, ?, 'percent')`,
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

// ── Subplots 小區 (v18, fixed plots only) ──────────────────────────────────
// Layer DEFINITION (count + method + height_unit) stays shared at plot level
// (plot_survey_layers). A subplot only carries per-layer cover/height
// (subplot_layers) + its own species (plot_species_records.subplot_id).

export type Subplot = {
  id: number;
  plot_survey_id: number;
  idx: number;
  label: string;
  width_m: number | null;
  length_m: number | null;
  created_at: number;
};

export type SubplotLayer = {
  id: number;
  subplot_id: number;
  layer_index: number;
  cover_pct: number | null;
  height_cm: number | null;
};

export function listSubplots(plotId: number): Subplot[] {
  const res = getUserDb().executeSync(
    `SELECT * FROM plot_subplots WHERE plot_survey_id = ? ORDER BY idx ASC`,
    [plotId],
  );
  return (res.rows ?? []) as unknown as Subplot[];
}

/** Grow/shrink to exactly `count` subplots (S1..S{count}). 0 = un-split. When
 *  shrinking, surplus subplots' species are kept (subplot_id reset to NULL) so
 *  no observation is silently lost; their cover/height rows cascade-delete. */
export function setSubplotCount(plotId: number, count: number): void {
  const db = getUserDb();
  const clamped = Math.max(0, Math.min(50, Math.round(count)));
  const existing = listSubplots(plotId);
  const now = Date.now();
  for (let i = 1; i <= clamped; i++) {
    if (!existing.find((s) => s.idx === i)) {
      db.executeSync(
        `INSERT INTO plot_subplots (plot_survey_id, idx, label, created_at) VALUES (?, ?, ?, ?)`,
        [plotId, i, `S${i}`, now],
      );
    }
  }
  for (const s of existing) {
    if (s.idx > clamped) {
      db.executeSync(`UPDATE plot_species_records SET subplot_id = NULL WHERE subplot_id = ?`, [s.id]);
      db.executeSync(`DELETE FROM plot_subplots WHERE id = ?`, [s.id]);
    }
  }
  db.executeSync(`UPDATE plot_surveys SET updated_at = ? WHERE id = ?`, [now, plotId]);
}

export function updateSubplot(
  id: number,
  patch: { label?: string; width_m?: number | null; length_m?: number | null },
): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.label !== undefined && patch.label.trim()) {
    sets.push('label = ?');
    args.push(patch.label.trim());
  }
  if ('width_m' in patch) {
    sets.push('width_m = ?');
    args.push(patch.width_m ?? null);
  }
  if ('length_m' in patch) {
    sets.push('length_m = ?');
    args.push(patch.length_m ?? null);
  }
  if (sets.length === 0) return;
  args.push(id);
  getUserDb().executeSync(`UPDATE plot_subplots SET ${sets.join(', ')} WHERE id = ?`, args);
}

export function getSubplotLayers(subplotId: number): SubplotLayer[] {
  const res = getUserDb().executeSync(
    `SELECT * FROM subplot_layers WHERE subplot_id = ? ORDER BY layer_index ASC`,
    [subplotId],
  );
  return (res.rows ?? []) as unknown as SubplotLayer[];
}

export function updateSubplotLayer(
  subplotId: number,
  layerIndex: number,
  patch: { cover_pct?: number | null; height_cm?: number | null },
): void {
  const db = getUserDb();
  db.executeSync(`INSERT OR IGNORE INTO subplot_layers (subplot_id, layer_index) VALUES (?, ?)`, [
    subplotId,
    layerIndex,
  ]);
  const sets: string[] = [];
  const args: (number | null)[] = [];
  if ('cover_pct' in patch) {
    sets.push('cover_pct = ?');
    args.push(patch.cover_pct ?? null);
  }
  if ('height_cm' in patch) {
    sets.push('height_cm = ?');
    args.push(patch.height_cm ?? null);
  }
  if (sets.length === 0) return;
  args.push(subplotId, layerIndex);
  db.executeSync(
    `UPDATE subplot_layers SET ${sets.join(', ')} WHERE subplot_id = ? AND layer_index = ?`,
    args,
  );
}

export function listPlotSurveys(): PlotSurvey[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM plot_surveys ORDER BY COALESCE(start_ts, created_at) DESC`,
  );
  return (res.rows ?? []) as unknown as PlotSurvey[];
}

/** Plot survey + project name + species count, for the map overlay. */
export type PlotSurveyWithMeta = PlotSurvey & {
  project_name: string;
  species_count: number;
};

/**
 * All plots with their project name and species count in one query (no N+1).
 * NOTE: uses LEFT JOIN projects (unlike listSites which inner-joins) because a
 * plot's project_id may be 0 (未指定) — an inner join would silently drop those.
 * COUNT(psr.id) (not *) yields 0 for plots with no species.
 */
export function listPlotSurveysWithMeta(): PlotSurveyWithMeta[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT ps.*,
            COALESCE(p.name, '未指定') AS project_name,
            COUNT(psr.id) AS species_count
     FROM plot_surveys ps
       LEFT JOIN projects p ON p.id = ps.project_id
       LEFT JOIN plot_species_records psr ON psr.plot_survey_id = ps.id
     GROUP BY ps.id
     ORDER BY COALESCE(ps.start_ts, ps.created_at) DESC`,
  );
  return (res.rows ?? []) as unknown as PlotSurveyWithMeta[];
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
  'vascular_cover_pct',
  'bryophyte_cover_pct',
  'lichen_cover_pct',
  'litter_cover_pct',
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

// 純資料形狀移到 ~/lib/track（匯入解析器也要用，不能相依 DB）；re-export 讓既有
// import 路徑不變。
export { buildTrackGeoJSON, parseTrackSegments, type TrackSegment };

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
  // ON DELETE CASCADE 在這個 app 是失效的：PRAGMA foreign_keys 從未在連線開啟時
  // 設定，而 op-sqlite 沒有定義 SQLITE_DEFAULT_FOREIGN_KEYS，所以 SQLite 走預設的
  // OFF。子列必須自己刪，否則會變成看不見卻仍佔用編號的孤兒列。
  // subplot_layers 掛在 plot_subplots 底下，所以要先於 plot_subplots 刪。
  db.executeSync(
    `DELETE FROM subplot_layers WHERE subplot_id IN
       (SELECT id FROM plot_subplots WHERE plot_survey_id = ?)`,
    [id],
  );
  db.executeSync(`DELETE FROM plot_subplots WHERE plot_survey_id = ?`, [id]);
  db.executeSync(`DELETE FROM plot_species_records WHERE plot_survey_id = ?`, [id]);
  db.executeSync(`DELETE FROM plot_survey_layers WHERE plot_survey_id = ?`, [id]);
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
 *  config — caller falls back to the % cover default. */
export function plotMethodForLayer(plot: PlotSurvey, layer: Layer): AbundanceMethod {
  if (layer === 'T') return 'percent';
  const idx = layerIndexOf(layer);
  const layers = getPlotLayers(plot.id);
  return layers.find((l) => l.layer_index === idx)?.method ?? 'percent';
}

// ---------- species records ----------

export type AddPlotSpeciesInput = {
  plot_survey_id: number;
  taxon_id: string;
  /** Subplot id (v18); omit / null for un-split plots. */
  subplot_id?: number | null;
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
  /** Set only when the user deliberately chose a non-accepted name (v28). */
  adopted?: AdoptionInput | null;
};

export function addPlotSpecies(input: AddPlotSpeciesInput): number {
  const db = getUserDb();
  const now = Date.now();
  const res = db.executeSync(
    `INSERT INTO plot_species_records
       (plot_survey_id, taxon_id, occurrence_id, subplot_id, layer,
        organism_quantity, organism_quantity_type,
        notes, sex, life_stage, reproductive_condition, leaf_phenology,
        lat, lng, accuracy, detection_type,
        used_name_id, used_scientific_name,
        observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.plot_survey_id,
      input.taxon_id,
      generateUuid(),
      input.subplot_id ?? null,
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
      input.adopted?.name_id ?? null,
      input.adopted?.scientific_name ?? null,
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

/** Move a species record to a different vegetation layer (fix mis-entry). */
/** Re-identify a recorded plant/animal: swap the taxon, keep everything else
 *  (layer, abundance, attributes, photos, coordinates). Mirrors the specimen
 *  re-determination path — the observation is the same, only the name changes. */
export function updatePlotSpeciesTaxon(id: number, taxonId: string): void {
  const db = getUserDb();
  db.executeSync(`UPDATE plot_species_records SET taxon_id = ? WHERE id = ?`, [taxonId, id]);
}

export function updatePlotSpeciesLayer(id: number, layer: Layer): void {
  const db = getUserDb();
  db.executeSync(`UPDATE plot_species_records SET layer = ? WHERE id = ?`, [layer, id]);
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

export function listPlotSpecies(
  plotSurveyId: number,
  subplotId?: number | null,
): PlotSpeciesRecordWithTaxon[] {
  const userDb = getUserDb();

  // subplotId === undefined → all records (export / un-split). A number scopes
  // to that subplot (per-subplot recording UI).
  const recordsRes =
    subplotId === undefined
      ? userDb.executeSync(
          `SELECT * FROM plot_species_records WHERE plot_survey_id = ? ORDER BY observed_at ASC`,
          [plotSurveyId],
        )
      : userDb.executeSync(
          `SELECT * FROM plot_species_records WHERE plot_survey_id = ? AND subplot_id IS ? ORDER BY observed_at ASC`,
          [plotSurveyId, subplotId],
        );
  const records = (recordsRes.rows ?? []) as unknown as PlotSpeciesRecord[];
  if (records.length === 0) return [];

  const taxa = resolveTaxa(records.map((r) => r.taxon_id));
  const adopted = resolveAdoptedNames(records);
  return records.map((r) => ({
    ...r,
    ...applyAdoptedName(taxa.get(r.taxon_id) ?? EMPTY_TAXON_FIELDS, r, adopted),
  }));
}

// ── Plot round-trip import (v18+) ──────────────────────────────────────────
// Re-create a plot survey from an exported yml. `uuid` is the stable key; the
// imported plot lands as status='done' so it never hijacks the single-active
// record. reproductive_condition / leaf_phenology are expected pre-serialized
// to the DB JSON-array format by the caller (plotImport.ts).

export type ImportedPlotLayer = {
  layer_index: number;
  cover_pct: number | null;
  height_cm: number | null;
  height_unit?: HeightUnit;
  method?: AbundanceMethod;
};

export type ImportedSubplot = {
  idx: number;
  label: string;
  width_m: number | null;
  length_m: number | null;
  layers: Array<{ layer_index: number; cover_pct: number | null; height_cm: number | null }>;
};

export type ImportedPlotSpecies = {
  occurrence_id?: string | null;
  taxon_id: string;
  /** Scientific name / family as exported. Not stored — used only to
   *  re-resolve `taxon_id` when this device's checklist doesn't have it. */
  name?: string | null;
  family?: string | null;
  subplot?: string | null; // subplot label
  layer?: string | null;
  organism_quantity?: string | null;
  organism_quantity_type?: string | null;
  notes?: string | null;
  sex?: string | null;
  life_stage?: string | null;
  reproductive_condition?: string | null;
  leaf_phenology?: string | null;
  detection_type?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  observed_at?: number | null;
  /** Photo filenames inside the zip's `photos/` belonging to this record. */
  photo_files?: string[];
  /** The name this record was filed under, when not the accepted one (v28). */
  used_name_id?: number | null;
  used_scientific_name?: string | null;
};

export type ImportedPlot = {
  uuid: string;
  plotid: string;
  plot_type: PlotType;
  /** `site:` block from the yml, or a geometry recovered from the zip's
   *  `site.geojson|gpx|kml`. Becomes a new `sites` row + `site_id`. */
  site?: ImportedSite | null;
  /** Photo filenames inside the zip's `photos/`, plot-wide (environment
   *  context photos). Resolved to device URIs by the caller. */
  env_photo_files?: string[];
  track_finalized?: number | null;
  project_name?: string | null;
  layer_count?: number | null;
  start_ts?: number | null;
  stop_ts?: number | null;
  recorded_by?: string | null;
  locality?: string | null;
  field_note?: string | null;
  sampling_protocol?: string | null;
  sample_size_value?: number | null;
  sample_size_unit?: string | null;
  decimal_latitude?: number | null;
  decimal_longitude?: number | null;
  coord_uncertainty_m?: number | null;
  elevation_m?: number | null;
  slope_deg?: number | null;
  aspect_deg?: number | null;
  terrain_position?: string | null;
  total_cover_pct?: number | null;
  rock_cover_pct?: number | null;
  gravel_cover_pct?: number | null;
  bareland_cover_pct?: number | null;
  vascular_cover_pct?: number | null;
  bryophyte_cover_pct?: number | null;
  lichen_cover_pct?: number | null;
  litter_cover_pct?: number | null;
  point_radius_m?: number | null;
  track_geojson?: string | null;
  layers?: ImportedPlotLayer[];
  subplots?: ImportedSubplot[];
  species: ImportedPlotSpecies[];
};

export function getPlotSurveyByUuid(uuid: string): PlotSurvey | null {
  const res = getUserDb().executeSync(`SELECT * FROM plot_surveys WHERE uuid = ? LIMIT 1`, [uuid]);
  return (res.rows?.[0] as unknown as PlotSurvey) ?? null;
}

export function importPlotSurvey(
  data: ImportedPlot,
  opts: { newUuid: boolean; photoUriByName?: Map<string, string> },
): { plotId: number; plotid: string } {
  // One transaction for the whole record: the overwrite path deletes the
  // previous copy first, so a failure halfway through the species loop would
  // otherwise leave the user with neither the old plot nor a complete new one.
  return withTransaction(() => importPlotSurveyTx(data, opts));
}

function importPlotSurveyTx(
  data: ImportedPlot,
  opts: { newUuid: boolean; photoUriByName?: Map<string, string> },
): { plotId: number; plotid: string } {
  const db = getUserDb();
  const now = Date.now();
  const uuid = opts.newUuid ? generateUuid() : data.uuid;
  const photoUri = (name: string) => opts.photoUriByName?.get(name) ?? null;
  const photoPaths = (files: string[] | undefined): string | null => {
    const uris = (files ?? []).map(photoUri).filter((u): u is string => u !== null);
    return uris.length > 0 ? JSON.stringify(uris) : null;
  };

  // Overwrite mode: drop any existing plot with this uuid first. The FK
  // cascades do NOT fire (PRAGMA foreign_keys is off), so children must be
  // deleted by hand exactly as deletePlotSurvey does — otherwise the previous
  // version's species rows survive as orphans carrying the very occurrence_ids
  // that are about to be re-inserted.
  let prevSiteId: number | null = null;
  if (!opts.newUuid) {
    const prev = db.executeSync(`SELECT id, site_id FROM plot_surveys WHERE uuid = ?`, [uuid]);
    const prevRow = prev.rows?.[0] as { id?: number; site_id?: number | null } | undefined;
    if (prevRow?.id != null) {
      prevSiteId = prevRow.site_id ?? null;
      deletePlotSurvey(prevRow.id);
    }
  }

  // Resolve project by name, creating it when unknown — the name is user data
  // that would otherwise be lost to 未分類 on every cross-device import.
  const projectId = resolveProjectIdByName(data.project_name, { create: true });

  const res = db.executeSync(
    `INSERT INTO plot_surveys (
       uuid, plotid, plot_type, project_id, status, track_geojson, track_finalized, env_photos_json,
       start_ts, stop_ts, decimal_latitude, decimal_longitude, coord_uncertainty_m, point_radius_m,
       sample_size_value, sample_size_unit, sampling_protocol, total_cover_pct,
       recorded_by, locality, field_note,
       elevation_m, slope_deg, aspect_deg, terrain_position,
       rock_cover_pct, gravel_cover_pct, bareland_cover_pct,
       vascular_cover_pct, bryophyte_cover_pct, lichen_cover_pct, litter_cover_pct,
       layer_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid,
      data.plotid,
      data.plot_type,
      projectId,
      data.track_geojson ?? null,
      // Older ymls carry no track_finalized; a track that exists at all was
      // finalized in every pre-v27 export, so that stays the fallback.
      data.track_finalized ?? (data.track_geojson ? 1 : 0),
      photoPaths(data.env_photo_files),
      data.start_ts ?? null,
      data.stop_ts ?? null,
      data.decimal_latitude ?? null,
      data.decimal_longitude ?? null,
      data.coord_uncertainty_m ?? null,
      data.point_radius_m ?? null,
      data.sample_size_value ?? null,
      data.sample_size_unit ?? null,
      data.sampling_protocol ?? null,
      data.total_cover_pct ?? null,
      data.recorded_by ?? null,
      data.locality ?? null,
      data.field_note ?? null,
      data.elevation_m ?? null,
      data.slope_deg ?? null,
      data.aspect_deg ?? null,
      data.terrain_position ?? null,
      data.rock_cover_pct ?? null,
      data.gravel_cover_pct ?? null,
      data.bareland_cover_pct ?? null,
      data.vascular_cover_pct ?? null,
      data.bryophyte_cover_pct ?? null,
      data.lichen_cover_pct ?? null,
      data.litter_cover_pct ?? null,
      data.layer_count ?? DEFAULT_LAYER_COUNT,
      now,
      now,
    ],
  );
  const plotId = res.insertId ?? 0;
  if (plotId === 0) throw new Error(i18n.t('plotImport.createFail'));

  if (data.plot_type === 'fixed') {
    for (const l of data.layers ?? []) {
      db.executeSync(
        `INSERT INTO plot_survey_layers (plot_survey_id, layer_index, cover_pct, height_cm, height_unit, method)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [plotId, l.layer_index, l.cover_pct ?? null, l.height_cm ?? null, l.height_unit ?? 'cm', l.method ?? 'BB'],
      );
    }
  }

  const subplotIdByLabel = new Map<string, number>();
  for (const s of data.subplots ?? []) {
    const sres = db.executeSync(
      `INSERT INTO plot_subplots (plot_survey_id, idx, label, width_m, length_m, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [plotId, s.idx, s.label, s.width_m ?? null, s.length_m ?? null, now],
    );
    const subplotId = sres.insertId ?? 0;
    subplotIdByLabel.set(s.label, subplotId);
    for (const sl of s.layers ?? []) {
      db.executeSync(
        `INSERT INTO subplot_layers (subplot_id, layer_index, cover_pct, height_cm) VALUES (?, ?, ?, ?)`,
        [subplotId, sl.layer_index, sl.cover_pct ?? null, sl.height_cm ?? null],
      );
    }
  }

  const fallbackLayer: Layer = data.plot_type === 'fixed' ? 'E1' : TRANSECT_LAYER;
  for (const sp of data.species ?? []) {
    const subplotId = sp.subplot ? subplotIdByLabel.get(sp.subplot) ?? null : null;
    // `layer` has a CHECK constraint; anything else (a pre-v12 yml still using
    // 'E0', a hand-edited file) would throw here and abort the import after the
    // previous copy was already deleted. Coerce instead.
    const layer: Layer =
      sp.layer && (LAYERS as string[]).concat(TRANSECT_LAYER).includes(sp.layer)
        ? (sp.layer as Layer)
        : fallbackLayer;
    db.executeSync(
      `INSERT INTO plot_species_records (
         plot_survey_id, taxon_id, occurrence_id, subplot_id, layer,
         organism_quantity, organism_quantity_type, notes, sex, life_stage,
         reproductive_condition, leaf_phenology, lat, lng, accuracy, detection_type,
         photo_paths, used_name_id, used_scientific_name, observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plotId,
        sp.taxon_id,
        // 另存新檔＝一份新的 occurrence，必須重新配號；沿用來源檔的 id 會讓
        // 同一個 occurrenceID 出現在兩筆記錄上（DwC 識別碼必須唯一）。
        opts.newUuid ? generateUuid() : (sp.occurrence_id ?? generateUuid()),
        subplotId,
        layer,
        sp.organism_quantity ?? null,
        sp.organism_quantity_type ?? null,
        sp.notes ?? null,
        sp.sex ?? null,
        sp.life_stage ?? null,
        sp.reproductive_condition ?? null,
        sp.leaf_phenology ?? null,
        sp.lat ?? null,
        sp.lng ?? null,
        sp.accuracy ?? null,
        sp.detection_type ?? null,
        photoPaths(sp.photo_files),
        sp.used_name_id ?? null,
        sp.used_scientific_name ?? null,
        sp.observed_at ?? now,
        now,
      ],
    );
  }

  // Site last: it needs no plot reference, but the plot needs its id.
  if (data.site) {
    const siteId = createSite({
      project_id: projectId,
      name: data.site.name,
      geometry: data.site.geometry,
      notes: data.site.notes,
    });
    db.executeSync(`UPDATE plot_surveys SET site_id = ?, updated_at = ? WHERE id = ?`, [
      siteId,
      now,
      plotId,
    ]);
  }
  // The overwritten copy's site is now unreferenced unless the user shares it
  // with another record — otherwise every re-import would leave one behind.
  if (prevSiteId !== null) deleteSiteIfUnreferenced(prevSiteId);

  return { plotId, plotid: data.plotid };
}

// ── 複製樣區 ────────────────────────────────────────────────────────────────

/**
 * Copy a plot survey as the next one in the series.
 *
 * Deliberately NOT routed through `importPlotSurvey`: that path exists for the
 * yml round trip and is lossy inside one DB (no legacy bb_value / percent /
 * dbh_values_json, photos keyed by zip filename, project resolved by name,
 * subplots matched by label). Copying columns directly is both shorter and
 * exact about what is carried.
 *
 * Never carried, whatever the options say: the GPS fix, the walked track, the
 * bound site, environment photos, and every per-record observation value —
 * those describe one survey, not the setup it shared.
 */
export function duplicatePlotSurvey(
  id: number,
  opts: DuplicateRecordOptions,
): number | null {
  return withTransaction(() => duplicatePlotSurveyTx(id, opts));
}

function duplicatePlotSurveyTx(id: number, opts: DuplicateRecordOptions): number | null {
  const source = getPlotSurvey(id);
  if (!source) return null;
  const name = opts.name.trim();
  if (!name) return null;
  const db = getUserDb();
  const now = Date.now();

  if (opts.activate) {
    // Same belt + suspenders as createPlotSurvey: the copy can only become the
    // active record if nothing else is.
    db.executeSync(
      `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active'`,
      [now, now],
    );
    db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [now]);
  }

  // Species rows are read up front: without the source's layer settings the
  // copy still has to keep enough layers to hold them, or an E5 record would
  // have to be misfiled into E1 (the CHECK allows E1–E6 regardless of
  // layer_count, but `PlotSpeciesTab` only renders the active ones, so an
  // out-of-range row becomes invisible AND undeletable).
  const species = opts.includeSpecies
    ? ((db.executeSync(
        `SELECT taxon_id, layer, subplot_id, used_name_id, used_scientific_name
           FROM plot_species_records
          WHERE plot_survey_id = ? AND taxon_id IS NOT NULL AND taxon_id != ''
          ORDER BY id`,
        [id],
      ).rows ?? []) as unknown as Array<
        Pick<
        PlotSpeciesRecord,
        'taxon_id' | 'layer' | 'subplot_id' | 'used_name_id' | 'used_scientific_name'
      >
      >)
    : [];
  const usedLayerIdx = species.reduce(
    (max, sp) => (sp.layer !== TRANSECT_LAYER ? Math.max(max, Number(sp.layer.slice(1)) || 0) : max),
    0,
  );
  const layerCount = opts.includeEnv
    ? source.layer_count
    : Math.min(MAX_LAYER_COUNT, Math.max(DEFAULT_LAYER_COUNT, usedLayerIdx));
  const env = <T,>(v: T): T | null => (opts.includeEnv ? v : null);

  const res = db.executeSync(
    `INSERT INTO plot_surveys (
       uuid, plotid, plot_type, project_id, status, recorded_by, sampling_protocol,
       layer_count, sample_size_value, sample_size_unit, point_radius_m,
       locality, field_note, elevation_m, slope_deg, aspect_deg, terrain_position,
       total_cover_pct, rock_cover_pct, gravel_cover_pct, bareland_cover_pct,
       vascular_cover_pct, bryophyte_cover_pct, lichen_cover_pct, litter_cover_pct,
       start_ts, stop_ts, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateUuid(),
      name,
      source.plot_type,
      existingProjectId(source.project_id),
      opts.activate ? 'active' : 'done',
      source.recorded_by,
      // Protocol, plot size and point-count radius describe the METHOD, not
      // this survey's observations, so they follow the plot type even when the
      // environmental values are left out.
      source.sampling_protocol,
      layerCount,
      source.sample_size_value,
      source.sample_size_unit,
      source.point_radius_m,
      env(source.locality),
      env(source.field_note),
      env(source.elevation_m),
      env(source.slope_deg),
      env(source.aspect_deg),
      env(source.terrain_position),
      env(source.total_cover_pct),
      env(source.rock_cover_pct),
      env(source.gravel_cover_pct),
      env(source.bareland_cover_pct),
      env(source.vascular_cover_pct),
      env(source.bryophyte_cover_pct),
      env(source.lichen_cover_pct),
      env(source.litter_cover_pct),
      // A transect is "ready to record" precisely when start_ts is set (see
      // plotCanAcceptSpecies) — that flag means the track recorder ran. A copy
      // has walked nothing, so it must start null or the species tab unlocks
      // on a survey that never happened.
      source.plot_type === 'transect' ? null : now,
      opts.activate ? null : now,
      now,
      now,
    ],
  );
  const newId = res.insertId ?? 0;
  if (newId === 0) return null;

  // Layers: `plot_survey_layers` must stay in lockstep with layer_count
  // (setPlotLayerCount's invariant), so both branches write layerCount rows.
  if (source.plot_type === 'fixed') {
    const sourceLayers = new Map(getPlotLayers(id).map((l) => [l.layer_index, l]));
    for (let i = 1; i <= layerCount; i++) {
      const l = opts.includeEnv ? sourceLayers.get(i) : undefined;
      db.executeSync(
        `INSERT INTO plot_survey_layers (plot_survey_id, layer_index, cover_pct, height_cm, height_unit, method)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newId,
          i,
          l?.cover_pct ?? null,
          l?.height_cm ?? null,
          l?.height_unit ?? 'cm',
          // Matches createPlotSurvey's seeding when there is nothing to copy.
          l?.method ?? (i === 4 ? 'DBH' : 'percent'),
        ],
      );
    }
  }

  // Subplots are part of the plot's structure, so they ride with 環境.
  const subplotIdByOldId = new Map<number, number>();
  if (opts.includeEnv) {
    for (const s of listSubplots(id)) {
      const sres = db.executeSync(
        `INSERT INTO plot_subplots (plot_survey_id, idx, label, width_m, length_m, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId, s.idx, s.label, s.width_m, s.length_m, now],
      );
      const newSubplotId = sres.insertId ?? 0;
      subplotIdByOldId.set(s.id, newSubplotId);
      for (const sl of getSubplotLayers(s.id)) {
        db.executeSync(
          `INSERT INTO subplot_layers (subplot_id, layer_index, cover_pct, height_cm) VALUES (?, ?, ?, ?)`,
          [newSubplotId, sl.layer_index, sl.cover_pct, sl.height_cm],
        );
      }
    }
  }

  if (opts.includeSpecies) {
    const activeLayers = getActiveLayers(layerCount) as string[];
    const seen = new Set<string>();
    for (const sp of species) {
      // A layer beyond the copy's layer_count would be invisible in the UI.
      const layer: Layer =
        sp.layer === TRANSECT_LAYER || activeLayers.includes(sp.layer) ? sp.layer : 'E1';
      const subplotId = subplotIdByOldId.get(sp.subplot_id ?? -1) ?? null;
      // Without subplots, rows that differed only by subplot collapse into
      // duplicates of the same taxon+layer.
      // The adopted name is part of the identity here: the same taxon filed
      // under two different names is two rows, not a duplicate.
      const key = `${sp.taxon_id}|${layer}|${subplotId ?? ''}|${sp.used_scientific_name ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      db.executeSync(
        `INSERT INTO plot_species_records
           (plot_survey_id, taxon_id, occurrence_id, subplot_id, layer,
            used_name_id, used_scientific_name, observed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          sp.taxon_id,
          generateUuid(),
          subplotId,
          layer,
          sp.used_name_id ?? null,
          sp.used_scientific_name ?? null,
          now,
          now,
        ],
      );
    }
  }

  return newId;
}
