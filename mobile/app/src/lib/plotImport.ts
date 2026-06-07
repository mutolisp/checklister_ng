/**
 * Plot round-trip import: read an exported `.yml` (standalone, or the one inside
 * an export `.zip`) and turn it into an `ImportedPlot` that `importPlotSurvey`
 * (src/db/plots.ts) can write back to the DB. Mirrors the full plot yml schema
 * emitted by `buildPlotEntries` (src/lib/bundleExport.ts).
 *
 * Data only — photos are not imported (zip `photos/` is ignored).
 */
import { readAsStringAsync } from 'expo-file-system/legacy';
import { strFromU8, unzipSync } from 'fflate';
import yaml from 'js-yaml';
import { base64ToBytes } from './bundleExport';
import { serializeMultiAttribute } from './dwcAttributes';
import type {
  ImportedPlot,
  ImportedPlotLayer,
  ImportedPlotSpecies,
  ImportedSubplot,
  PlotType,
} from '~/db';

const PLOT_TYPES: PlotType[] = ['fixed', 'transect', 'point_count'];
const METHODS = ['BB', 'percent', 'DBH'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
/** yml stores multi-value attrs pipe-joined; DB stores a JSON array string. */
function pipeToJson(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  return serializeMultiAttribute(v.split('|').map((x) => x.trim()).filter(Boolean));
}

function parsePlotYaml(text: string): ImportedPlot {
  const doc = yaml.load(text) as Record<string, unknown> | null;
  const p = (doc?.plot ?? null) as Record<string, unknown> | null;
  if (!doc || !p) throw new Error('不是有效的樣區 yml（缺 plot 區塊）');
  if (!p.uuid || !p.plotid) throw new Error('樣區 yml 缺 uuid 或 plotid');

  const plot_type: PlotType = PLOT_TYPES.includes(p.plot_type as PlotType)
    ? (p.plot_type as PlotType)
    : 'fixed';

  const speciesRaw = Array.isArray(doc.species) ? (doc.species as Record<string, unknown>[]) : [];
  const species: ImportedPlotSpecies[] = speciesRaw
    .map((s) => ({
      occurrence_id: str(s.occurrence_id),
      taxon_id: String(s.taxon_id ?? ''),
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
    point_radius_m: num(p.point_radius_m),
    track_geojson: str(p.track_geojson),
    layers,
    subplots,
    species,
  };
}

/** Read a `.yml` file (or the yml inside an export `.zip`) into an ImportedPlot. */
export async function readPlotImport(uri: string): Promise<ImportedPlot> {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.zip')) {
    const b64 = await readAsStringAsync(uri, { encoding: 'base64' });
    const files = unzipSync(base64ToBytes(b64));
    const ymlName = Object.keys(files).find(
      (n) => n.toLowerCase().endsWith('.yml') || n.toLowerCase().endsWith('.yaml'),
    );
    if (!ymlName) throw new Error('zip 內找不到 .yml 檔');
    return parsePlotYaml(strFromU8(files[ymlName]));
  }
  const text = await readAsStringAsync(uri, { encoding: 'utf8' });
  return parsePlotYaml(text);
}
