/**
 * The yml documents an export produces — assembled from already-fetched rows,
 * with no DB, file or i18n access.
 *
 * Split out of `bundleExport.ts` so the export↔import round trip can be
 * checked without a device: `scripts/check-roundtrip.mjs` builds a document
 * here, runs it through the parsers in `plotImport.ts` / `sessionImport.ts`,
 * and compares. Every field added to one side has to survive that trip.
 */
import { convertToDwc } from './dwcMapper';
import { parseMultiAttribute } from './dwcMultiValue';
import type {
  PlotLayer,
  PlotSpeciesRecordWithTaxon,
  PlotSurvey,
  RecordWithTaxon,
  Session,
  Subplot,
  SubplotLayer,
  ImportedSite,
} from '~/db';

/** DwC multi-value convention: pipe-separated. Pulls JSON-array DB cells out
 *  and joins with `|`; empty → empty string (CSV column kept positional). */
export function multiToPipe(raw: string | null | undefined): string {
  return parseMultiAttribute(raw).join('|');
}

/** ISO 8601 with offset (e.g. `2026-06-11T14:30:00+08:00`). Preserves the
 *  instant while showing local wall-clock time instead of UTC ('…Z'), which is
 *  what field recorders expect to see for observation / event times. */
export function localIso(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`
  );
}

/** Photo filenames assigned by the exporter, keyed by occurrence_id. */
export type PhotoNames = Map<string, string[]>;

function photoField(names: PhotoNames | undefined, occurrenceId: string | null): string | null {
  const list = occurrenceId ? names?.get(occurrenceId) : undefined;
  return list && list.length > 0 ? list.join('|') : null;
}

/** `site:` block — same shape in both files. Geometry stays a real mapping
 *  (not the stringified DB cell) because it is authored data a human may edit. */
function siteBlock(site: ImportedSite | null): Record<string, unknown> | null {
  if (!site) return null;
  return { name: site.name, notes: site.notes ?? '', geometry: site.geometry };
}

// ── Session (名錄) ─────────────────────────────────────────────────────────

export function recordToYamlItem(
  r: RecordWithTaxon,
  photoNames?: PhotoNames,
): Record<string, unknown> {
  const fullname = r.name_author ? `${r.simple_name} ${r.name_author}` : r.simple_name;
  const item: Record<string, unknown> = {
    occurrence_id: r.occurrence_id,
    taxon_id: r.taxon_id,
    name: r.simple_name,
    fullname,
    cname: r.common_name_c,
    family: r.family,
    family_c: r.family_c,
    kingdom: r.kingdom,
    phylum: r.phylum,
    class_name: r.class,
    order: r.order,
    iucn_category: r.iucn,
    redlist: r.redlist,
    cites: r.cites,
    protected: r.protected,
    endemic: r.is_endemic === 'true' ? 1 : 0,
    is_hybrid: r.is_hybrid,
    eventDate: localIso(r.observed_at),
  };
  if (r.lat !== null) item.lat = r.lat;
  if (r.lng !== null) item.lng = r.lng;
  if (r.accuracy !== null) item.accuracy = r.accuracy;
  if (r.organism_quantity !== null) item.organism_quantity = r.organism_quantity;
  if (r.organism_quantity_type !== null) item.organism_quantity_type = r.organism_quantity_type;
  // DwC species attributes + notes (these were previously dropped from the
  // bundle YAML, so user-entered values silently vanished on export).
  if (r.notes) item.notes = r.notes;
  if (r.sex) item.sex = r.sex;
  if (r.life_stage) item.life_stage = r.life_stage;
  const repro = multiToPipe(r.reproductive_condition);
  if (repro) item.reproductive_condition = repro;
  const leaf = multiToPipe(r.leaf_phenology);
  if (leaf) item.leaf_phenology = leaf;
  // → DwC `associatedMedia`; the filenames inside the zip's photos/.
  const photos = photoField(photoNames, r.occurrence_id);
  if (photos) item.photo_files = photos;
  return item;
}

export type SessionYamlInput = {
  session: Session;
  projectName: string;
  records: RecordWithTaxon[];
  site: ImportedSite | null;
  photoNames?: PhotoNames;
};

export function buildSessionYamlDoc(input: SessionYamlInput): Record<string, unknown> {
  const { session, projectName, records, site, photoNames } = input;
  const startIso = localIso(session.started_at);
  const endIso = session.ended_at !== null ? localIso(session.ended_at) : null;

  // `eventID` stays the human-facing session name (backend and web export both
  // read it that way), so the machine identity gets its own key.
  const event: Record<string, unknown> = {
    eventID: session.name,
    eventUUID: session.uuid,
    eventType: session.type,
    eventDate: endIso ? `${startIso}/${endIso}` : startIso,
    startedAt: startIso,
  };
  if (endIso) event.endedAt = endIso;
  if (session.recorded_by) event.recordedBy = session.recorded_by;
  if (session.notes) event.eventRemarks = session.notes;
  if (session.start_lat !== null) event.decimalLatitude = session.start_lat;
  if (session.start_lng !== null) event.decimalLongitude = session.start_lng;
  if (session.gps_mode) event.gpsMode = session.gps_mode;
  // Verbatim, exactly as the plot yml carries `track_geojson`: re-serializing
  // through WKT or a Feature would not round-trip byte-for-byte.
  if (session.track_geojson) event.trackGeoJSON = session.track_geojson;

  const doc: Record<string, unknown> = {
    event,
    checklist: records.map((r) => convertToDwc(recordToYamlItem(r, photoNames))),
  };
  if (projectName) doc.project = projectName;
  const sb = siteBlock(site);
  if (sb) doc.site = sb;
  return doc;
}

// ── Plot (樣區) ────────────────────────────────────────────────────────────

export type PlotYamlInput = {
  plot: PlotSurvey;
  projectName: string;
  species: PlotSpeciesRecordWithTaxon[];
  layers: PlotLayer[];
  subplots: Array<Subplot & { layers: SubplotLayer[] }>;
  subplotLabelById: Map<number, string>;
  site: ImportedSite | null;
  photoNames?: PhotoNames;
  envPhotoNames?: string[];
};

export function buildPlotYamlDoc(input: PlotYamlInput): Record<string, unknown> {
  const { plot, projectName, species, layers, subplots, subplotLabelById, site } = input;

  // Raw snake_case keys (not run through convertToDwc), matching the existing
  // organism_quantity convention here.
  const yamlItems = species.map((r) => {
    const item: Record<string, unknown> = {
      occurrence_id: r.occurrence_id,
      taxon_id: r.taxon_id,
      name: r.simple_name,
      cname: r.common_name_c,
      family: r.family,
      // Vegetation stratum only meaningful for fixed plots.
      ...(plot.plot_type === 'fixed' ? { layer: r.layer } : {}),
      organism_quantity: r.organism_quantity,
      organism_quantity_type: r.organism_quantity_type,
    };
    // Round-trip: which subplot this record belongs to (by label).
    if (r.subplot_id != null && subplotLabelById.has(r.subplot_id)) {
      item.subplot = subplotLabelById.get(r.subplot_id);
    }
    if (r.notes) item.notes = r.notes;
    if (r.sex) item.sex = r.sex;
    if (r.life_stage) item.life_stage = r.life_stage;
    const repro = multiToPipe(r.reproductive_condition);
    if (repro) item.reproductive_condition = repro;
    const leaf = multiToPipe(r.leaf_phenology);
    if (leaf) item.leaf_phenology = leaf;
    if (r.detection_type) item.detection_type = r.detection_type;
    if (r.lat !== null) item.lat = r.lat;
    if (r.lng !== null) item.lng = r.lng;
    if (r.accuracy !== null) item.accuracy = r.accuracy;
    item.observed_at = r.observed_at;
    const photos = photoField(input.photoNames, r.occurrence_id);
    if (photos) item.photo_files = photos;
    return item;
  });

  // Full plot block — every field needed to losslessly re-import the survey.
  // null/empty fields are dropped to keep the yml tidy; import treats missing
  // keys as null. `uuid` is the stable round-trip key.
  const plotBlock: Record<string, unknown> = {
    uuid: plot.uuid,
    plotid: plot.plotid,
    plot_type: plot.plot_type,
    project: projectName,
    layer_count: plot.layer_count,
  };
  const plotNumOrStr: Array<keyof PlotSurvey> = [
    'start_ts', 'stop_ts', 'recorded_by', 'locality', 'field_note', 'sampling_protocol',
    'sample_size_value', 'sample_size_unit', 'decimal_latitude', 'decimal_longitude',
    'coord_uncertainty_m', 'elevation_m', 'slope_deg', 'aspect_deg', 'terrain_position',
    'total_cover_pct', 'rock_cover_pct', 'gravel_cover_pct', 'bareland_cover_pct',
    'vascular_cover_pct', 'bryophyte_cover_pct', 'lichen_cover_pct', 'litter_cover_pct',
    'point_radius_m', 'track_geojson', 'track_finalized',
  ];
  for (const k of plotNumOrStr) {
    const v = plot[k];
    if (v !== null && v !== undefined && v !== '') plotBlock[k] = v;
  }
  // Pipe-joined filename list, not the `env_photos_json` column: the value is
  // filenames inside this zip, not the device URIs the column holds.
  if (input.envPhotoNames && input.envPhotoNames.length > 0) {
    plotBlock.env_photo_files = input.envPhotoNames.join('|');
  }

  const doc: Record<string, unknown> = { plot: plotBlock };
  const sb = siteBlock(site);
  if (sb) doc.site = sb;
  if (plot.plot_type === 'fixed') {
    doc.layers = layers.map((l) => ({
      layer_index: l.layer_index,
      cover_pct: l.cover_pct,
      height_cm: l.height_cm,
      height_unit: l.height_unit,
      method: l.method,
    }));
    if (subplots.length > 0) {
      doc.subplots = subplots.map((s) => ({
        idx: s.idx,
        label: s.label,
        width_m: s.width_m,
        length_m: s.length_m,
        layers: s.layers.map((sl) => ({
          layer_index: sl.layer_index,
          cover_pct: sl.cover_pct,
          height_cm: sl.height_cm,
        })),
      }));
    }
  }
  doc.species = yamlItems;
  return doc;
}
