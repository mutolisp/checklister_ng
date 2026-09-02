/**
 * Plot round-trip import — the yml half.
 *
 * Turns the `plot:` document emitted by `buildPlotEntries` (src/lib/bundleExport.ts)
 * into an `ImportedPlot` that `importPlotSurvey` (src/db/plots.ts) writes back.
 * File/zip reading, geometry fallbacks and photo bytes live in
 * `src/lib/recordImport.ts`; this module stays pure so it can be exercised
 * without a device (see scripts/check-roundtrip.mjs).
 */
import yaml from 'js-yaml';
import { ImportError } from './importError';
import { serializeMultiAttribute } from './dwcMultiValue';
import type {
  ImportedPlot,
  ImportedPlotLayer,
  ImportedPlotSpecies,
  ImportedSite,
  ImportedSubplot,
  PlotType,
} from '~/db';

const PLOT_TYPES: PlotType[] = ['fixed', 'transect', 'point_count'];
const METHODS = ['BB', 'percent', 'DBH'];

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
/** yml stores multi-value attrs pipe-joined; DB stores a JSON array string. */
export function pipeToJson(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  return serializeMultiAttribute(v.split('|').map((x) => x.trim()).filter(Boolean));
}
/** Pipe-joined filename list → array. Same convention as the attribute fields
 *  (filenames are sanitised at export, so they never contain a pipe). */
export function pipeToList(v: unknown): string[] {
  if (typeof v !== 'string' || v === '') return [];
  return v.split('|').map((x) => x.trim()).filter(Boolean);
}

/** Read a `site:` block. Geometry is a GeoJSON object in the yml (authored
 *  data), unlike the DB column which stores it stringified. */
export function parseSiteBlock(v: unknown): ImportedSite | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const geometry = o.geometry as { type?: string; coordinates?: unknown } | undefined;
  if (!geometry || typeof geometry.type !== 'string' || geometry.coordinates === undefined) {
    return null;
  }
  return {
    name: str(o.name) ?? '',
    notes: str(o.notes),
    geometry: geometry as ImportedSite['geometry'],
  };
}

export function parsePlotYaml(text: string): ImportedPlot {
  const doc = yaml.load(text) as Record<string, unknown> | null;
  return plotFromDoc(doc);
}

export function plotFromDoc(doc: Record<string, unknown> | null): ImportedPlot {
  const p = (doc?.plot ?? null) as Record<string, unknown> | null;
  if (!doc || !p) throw new ImportError('invalidYml');
  if (!p.uuid || !p.plotid) throw new ImportError('missingFields');

  const plot_type: PlotType = PLOT_TYPES.includes(p.plot_type as PlotType)
    ? (p.plot_type as PlotType)
    : 'fixed';

  const speciesRaw = Array.isArray(doc.species) ? (doc.species as Record<string, unknown>[]) : [];
  const species: ImportedPlotSpecies[] = speciesRaw
    .map((s) => ({
      occurrence_id: str(s.occurrence_id),
      taxon_id: String(s.taxon_id ?? ''),
      name: str(s.name),
      family: str(s.family),
      subplot: str(s.subplot),
      layer: str(s.layer),
      organism_quantity: str(s.organism_quantity),
      organism_quantity_type: str(s.organism_quantity_type),
      notes: str(s.notes),
      sex: str(s.sex),
      life_stage: str(s.life_stage),
      reproductive_condition: pipeToJson(s.reproductive_condition),
      leaf_phenology: pipeToJson(s.leaf_phenology),
      detection_type: str(s.detection_type),
      lat: num(s.lat),
      lng: num(s.lng),
      accuracy: num(s.accuracy),
      observed_at: num(s.observed_at),
      photo_files: pipeToList(s.photo_files),
      used_name_id: num(s.used_name_id),
      used_scientific_name: str(s.used_scientific_name) ?? str(s.name),
    }))
    .filter((s) => s.taxon_id);

  const layersRaw = Array.isArray(doc.layers) ? (doc.layers as Record<string, unknown>[]) : null;
  const layers: ImportedPlotLayer[] | undefined = layersRaw?.map((l) => ({
    layer_index: Number(l.layer_index),
    cover_pct: num(l.cover_pct),
    height_cm: num(l.height_cm),
    height_unit: l.height_unit === 'm' ? 'm' : 'cm',
    method: METHODS.includes(l.method as string) ? (l.method as ImportedPlotLayer['method']) : 'BB',
  }));

  const subplotsRaw = Array.isArray(doc.subplots) ? (doc.subplots as Record<string, unknown>[]) : null;
  const subplots: ImportedSubplot[] | undefined = subplotsRaw?.map((s) => ({
    idx: Number(s.idx),
    label: String(s.label ?? `S${s.idx}`),
    width_m: num(s.width_m),
    length_m: num(s.length_m),
    layers: Array.isArray(s.layers)
      ? (s.layers as Record<string, unknown>[]).map((sl) => ({
          layer_index: Number(sl.layer_index),
          cover_pct: num(sl.cover_pct),
          height_cm: num(sl.height_cm),
        }))
      : [],
  }));

  return {
    uuid: String(p.uuid),
    plotid: String(p.plotid),
    plot_type,
    project_name: str(p.project),
    layer_count: num(p.layer_count),
    start_ts: num(p.start_ts),
    stop_ts: num(p.stop_ts),
    recorded_by: str(p.recorded_by),
    locality: str(p.locality),
    field_note: str(p.field_note),
    sampling_protocol: str(p.sampling_protocol),
    sample_size_value: num(p.sample_size_value),
    sample_size_unit: str(p.sample_size_unit),
    decimal_latitude: num(p.decimal_latitude),
    decimal_longitude: num(p.decimal_longitude),
    coord_uncertainty_m: num(p.coord_uncertainty_m),
    elevation_m: num(p.elevation_m),
    slope_deg: num(p.slope_deg),
    aspect_deg: num(p.aspect_deg),
    terrain_position: str(p.terrain_position),
    total_cover_pct: num(p.total_cover_pct),
    rock_cover_pct: num(p.rock_cover_pct),
    gravel_cover_pct: num(p.gravel_cover_pct),
    bareland_cover_pct: num(p.bareland_cover_pct),
    vascular_cover_pct: num(p.vascular_cover_pct),
    bryophyte_cover_pct: num(p.bryophyte_cover_pct),
    lichen_cover_pct: num(p.lichen_cover_pct),
    litter_cover_pct: num(p.litter_cover_pct),
    point_radius_m: num(p.point_radius_m),
    track_geojson: str(p.track_geojson),
    track_finalized: num(p.track_finalized),
    env_photo_files: pipeToList(p.env_photo_files),
    site: parseSiteBlock(doc.site),
    layers,
    subplots,
    species,
  };
}
