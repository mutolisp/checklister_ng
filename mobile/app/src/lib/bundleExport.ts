/**
 * Bundle export: pack one or more records (session / plot / collection) into a single zip
 * containing YAML / CSV / Markdown checklist, GeoJSON / GPX / KML for points
 * + tracks + bound site, plus photos copied from the device library.
 *
 * Uses `fflate.zipSync` for the final pack — synchronous but memory-bounded
 * because we don't keep the source strings/bytes alive once they're in the
 * input map. Photo reads are async (asset → file URI → base64 → bytes) and
 * happen serially with a progress callback so the UI can update.
 */
import { File, Paths } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import yaml from 'js-yaml';
import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  getActiveLayers,
  getPlotLayers,
  getSubplotLayers,
  listSubplots,
  getProject,
  getSession,
  getSite,
  getPlotSurvey,
  layerIndexOf,
  listSessionRecords,
  listPlotSpecies,
  parseEnvPhotos,
  getCollectionTrip,
  listSpecimens,
  type FixedLayer,
  type PlotType,
  type PlotSurvey,
  type RecordWithTaxon,
  type TaxonFields,
  type PlotSpeciesRecordWithTaxon,
  type SpecimenWithTaxon,
} from '~/db';
import { convertToDwc } from './dwcMapper';
import { parseMultiAttribute } from './dwcAttributes';
import { generateMarkdown, type ConservationField } from './markdown';
import { markdownToDocx } from './docx';
import { geoJsonToGpx, geoJsonToKml } from './geoSerializers';

/** DwC multi-value convention: pipe-separated. Pulls JSON-array DB cells out
 *  and joins with `|`; empty → empty string (CSV column kept positional). */
function multiToPipe(raw: string | null | undefined): string {
  const arr = parseMultiAttribute(raw);
  return arr.join('|');
}

export type GeoFormat = 'geojson' | 'gpx' | 'kml';

/** Structured progress update for the export overlay. `done`/`total` (when
 *  present) drive a progress bar; `label` is the current stage caption. */
export type ExportProgress = { label: string; done?: number; total?: number };

/** Internal cumulative photo-progress context threaded through the builders. */
type ProgressCtx = { done: number; total: number; onProgress?: (p: ExportProgress) => void };

export type BundleOptions = {
  geoFormats: GeoFormat[];
  includePhotos: boolean;
  /** Emit a Word (.docx) version of the checklist alongside the .md. */
  includeDocx: boolean;
  /** Classification levels override for the checklist; empty = per-group defaults. */
  levels: string[];
  /** Conservation-status columns to include in the checklist. */
  conservationFields: ConservationField[];
  /** Reports export progress (stage + optional done/total). */
  onProgress?: (p: ExportProgress) => void;
};

/** Canonical ordering for checklist hierarchy levels (mirrors backend
 *  LEVEL_ORDER). The picker stores tap order; we reorder here so the grouping
 *  is always taxonomically sensible regardless of how the user clicked. */
const LEVEL_ORDER = ['kingdom', 'phylum', 'class_name', 'order', 'family', 'genus'];
function orderLevels(sel: string[]): string[] {
  return LEVEL_ORDER.filter((l) => sel.includes(l));
}

export type ExportFile = {
  uri: string;
  filename: string;
  mimeType: string;
};

export type BundleItem =
  | { kind: 'session'; id: number }
  | { kind: 'plot'; id: number }
  | { kind: 'collection'; id: number };

export function sanitizeFilename(name: string): string {
  // Allow Unicode letters (incl. CJK), digits, underscore, hyphen, dot. Without
  // \p{L}/\p{N} a Chinese name like 「樹木學」 becomes 「___」 because \w only
  // matches ASCII. Drop separators (space, slash, etc.) → underscore.
  // Trim leading/trailing dots so the entry doesn't accidentally become hidden.
  const cleaned = name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
  return cleaned.replace(/^[._]+|[._]+$/g, '').slice(0, 80) || 'export';
}

export function parsePhotoUris(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    // ignore
  }
  return [];
}

function parseGeoJsonSafe(s: string | null): object | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as object;
  } catch {
    return null;
  }
}

// ---- DwC helpers (mirror exporters.ts shape) ------------------------------

/** Format a millisecond timestamp as ISO 8601 in the device's *local* timezone
 *  with offset (e.g. `2026-06-11T14:30:00+08:00`). Preserves the instant while
 *  showing local wall-clock time instead of UTC ('…Z'), which is what field
 *  recorders expect to see for observation / event times. */
function localIso(ts: number): string {
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

/** Compare two taxon-bearing rows by full taxonomic hierarchy, then scientific
 *  name — kingdom → phylum → class → order → family → genus → species (all
 *  alphabetical). Used to order exported CSV rows. */
type TaxonSortable = {
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  simple_name: string;
};
function taxonSortCompare(a: TaxonSortable, b: TaxonSortable): number {
  const fields: (keyof TaxonSortable)[] = [
    'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'simple_name',
  ];
  for (const f of fields) {
    const c = (a[f] ?? '').localeCompare(b[f] ?? '');
    if (c !== 0) return c;
  }
  return 0;
}

function recordToYamlItem(r: RecordWithTaxon): Record<string, unknown> {
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
  return item;
}

/** A specimen is a DwC occurrence with `basisOfRecord: PreservedSpecimen` and a
 *  collector number (`recordNumber`). Kept literal — a DwC controlled-vocabulary
 *  value, so it is never localized (same rule as `sampling_protocol`). */
function specimenToYamlItem(sp: SpecimenWithTaxon): Record<string, unknown> {
  const fullname = sp.name_author ? `${sp.simple_name} ${sp.name_author}` : sp.simple_name;
  const item: Record<string, unknown> = {
    occurrence_id: sp.occurrence_id,
    basis_of_record: 'PreservedSpecimen',
    record_number: sp.record_number,
    taxon_id: sp.taxon_id,
    name: sp.simple_name,
    fullname,
    cname: sp.common_name_c,
    family: sp.family,
    family_c: sp.family_c,
    kingdom: sp.kingdom,
    phylum: sp.phylum,
    class_name: sp.class,
    order: sp.order,
    iucn_category: sp.iucn,
    redlist: sp.redlist,
    cites: sp.cites,
    protected: sp.protected,
    endemic: sp.is_endemic === 'true' ? 1 : 0,
    is_hybrid: sp.is_hybrid,
    eventDate: localIso(sp.collected_at),
  };
  if (sp.recorded_by) item.recorded_by = sp.recorded_by;
  if (sp.identified_by) item.identified_by = sp.identified_by;
  if (sp.lat !== null) item.lat = sp.lat;
  if (sp.lng !== null) item.lng = sp.lng;
  if (sp.accuracy !== null) item.accuracy = sp.accuracy;
  if (sp.locality) item.locality = sp.locality;
  if (sp.sex) item.sex = sp.sex;
  if (sp.life_stage) item.life_stage = sp.life_stage;
  const repro = multiToPipe(sp.reproductive_condition);
  if (repro) item.reproductive_condition = repro;
  const leaf = multiToPipe(sp.leaf_phenology);
  if (leaf) item.leaf_phenology = leaf;
  if (sp.notes) item.notes = sp.notes;
  return item;
}

function specimenToMarkdownItem(
  sp: SpecimenWithTaxon,
): Parameters<typeof generateMarkdown>[0][number] {
  const fullname = sp.name_author ? `${sp.simple_name} ${sp.name_author}` : sp.simple_name;
  return {
    taxon_id: sp.taxon_id,
    name: sp.simple_name,
    fullname,
    cname: sp.common_name_c,
    family: sp.family,
    family_c: sp.family_c,
    family_cname: sp.family_c,
    kingdom: sp.kingdom,
    kingdom_c: sp.kingdom_c,
    phylum: sp.phylum,
    phylum_c: sp.phylum_c,
    class_name: sp.class,
    class_c: sp.class_c,
    order: sp.order,
    order_c: sp.order_c,
    genus: sp.genus,
    genus_c: sp.genus_c,
    rank: sp.rank,
    endemic: sp.is_endemic === 'true' ? 1 : 0,
    source: mapAlienToSource(sp.alien_type, sp.kingdom),
    redlist: sp.redlist,
    iucn_category: sp.iucn,
    cites: sp.cites,
    protected: sp.protected,
    is_hybrid: sp.is_hybrid,
    nomenclature_name: '',
    notes: sp.notes,
  };
}

export function mapAlienToSource(alienType: string, kingdom: string): string {
  if (alienType === 'cultured') return kingdom === 'Animalia' ? '圈養' : '栽培';
  if (alienType === 'native') return '原生';
  if (alienType === 'naturalized' || alienType === 'invasive') return '歸化';
  return '';
}

/**
 * The taxon-derived half of a checklist item, with nothing observation-specific
 * in it.
 *
 * Split out so a 常用名錄 — which has a taxon_id and resolved TaxonFields but no
 * observation at all — can be exported through exactly the same Markdown/DOCX
 * pipeline as a session, rather than growing a second mapping that would drift.
 */
export function taxonToMarkdownItem(
  taxonId: string,
  r: TaxonFields,
): Parameters<typeof generateMarkdown>[0][number] {
  const fullname = r.name_author ? `${r.simple_name} ${r.name_author}` : r.simple_name;
  return {
    taxon_id: taxonId,
    name: r.simple_name,
    fullname,
    cname: r.common_name_c,
    family: r.family,
    family_c: r.family_c,
    family_cname: r.family_c,
    kingdom: r.kingdom,
    kingdom_c: r.kingdom_c,
    phylum: r.phylum,
    phylum_c: r.phylum_c,
    class_name: r.class,
    class_c: r.class_c,
    order: r.order,
    order_c: r.order_c,
    genus: r.genus,
    genus_c: r.genus_c,
    rank: r.rank,
    endemic: r.is_endemic === 'true' ? 1 : 0,
    source: mapAlienToSource(r.alien_type, r.kingdom),
    redlist: r.redlist,
    iucn_category: r.iucn,
    cites: r.cites,
    protected: r.protected,
    is_hybrid: r.is_hybrid,
    nomenclature_name: '',
  };
}

function recordToMarkdownItem(r: RecordWithTaxon): Parameters<typeof generateMarkdown>[0][number] {
  return { ...taxonToMarkdownItem(r.taxon_id, r), notes: r.notes };
}

/** Map a plot species record to a checklist MarkdownItem (mirrors
 *  recordToMarkdownItem). Used for the deduped `_checklist.md` per plot. */
function plotSpeciesToMarkdownItem(
  r: PlotSpeciesRecordWithTaxon,
): Parameters<typeof generateMarkdown>[0][number] {
  const fullname = r.name_author ? `${r.simple_name} ${r.name_author}` : r.simple_name;
  return {
    taxon_id: r.taxon_id,
    name: r.simple_name,
    fullname,
    cname: r.common_name_c,
    family: r.family,
    family_c: r.family_c,
    family_cname: r.family_c,
    kingdom: r.kingdom,
    kingdom_c: r.kingdom_c,
    phylum: r.phylum,
    phylum_c: r.phylum_c,
    class_name: r.class,
    class_c: r.class_c,
    order: r.order,
    order_c: r.order_c,
    genus: r.genus,
    genus_c: r.genus_c,
    rank: r.rank,
    endemic: r.is_endemic === 'true' ? 1 : 0,
    source: mapAlienToSource(r.alien_type, r.kingdom),
    redlist: r.redlist,
    iucn_category: r.iucn,
    cites: r.cites,
    protected: r.protected,
    is_hybrid: r.is_hybrid,
    nomenclature_name: '',
  };
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type PlotForEnv = Awaited<ReturnType<typeof getPlotSurvey>>;

/** Build the (term,value) rows for a plot's environmental CSV. Omits any
 *  field whose value is null / empty so the file is dense. DwC terms used:
 *  eventID (plotid), eventDate (start/stop), samplingProtocol, sampleSizeValue,
 *  sampleSizeUnit, recordedBy, locality, decimalLatitude, decimalLongitude,
 *  coordinateUncertaintyInMeters, minimumElevationInMeters. Vegetation fields
 *  use descriptive non-DwC keys. */
function buildPlotEnvRows(plot: NonNullable<PlotForEnv>, projectName: string): Array<{ term: string; value: string }> {
  const rows: Array<{ term: string; value: string }> = [];
  const push = (term: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const s = String(v);
    if (!s) return;
    rows.push({ term, value: s });
  };

  // Event / location identity
  push('eventID', plot.plotid);
  push('eventType', plot.plot_type); // fixed | transect | point_count
  if (projectName) push('datasetName', projectName);
  if (plot.start_ts !== null) {
    const startIso = localIso(plot.start_ts);
    const endIso = plot.stop_ts !== null ? localIso(plot.stop_ts) : null;
    push('eventDate', endIso ? `${startIso}/${endIso}` : startIso);
  }
  push('samplingProtocol', plot.sampling_protocol);
  push('sampleSizeValue', plot.sample_size_value);
  push('sampleSizeUnit', plot.sample_size_unit);
  push('pointRadiusM', plot.point_radius_m); // 定點計數法 count circle radius (m)
  push('recordedBy', plot.recorded_by);
  push('locality', plot.locality);
  push('eventRemarks', plot.field_note);

  // Coordinates (decimal)
  push('decimalLatitude', plot.decimal_latitude);
  push('decimalLongitude', plot.decimal_longitude);
  push('coordinateUncertaintyInMeters', plot.coord_uncertainty_m);
  push('minimumElevationInMeters', plot.elevation_m);

  // Site morphology (no standard DwC term — use descriptive keys)
  push('slopeDeg', plot.slope_deg);
  push('aspectDeg', plot.aspect_deg);
  push('terrainPosition', plot.terrain_position);
  push('totalCoverPct', plot.total_cover_pct);
  push('rockCoverPct', plot.rock_cover_pct);
  push('gravelCoverPct', plot.gravel_cover_pct);
  push('barelandCoverPct', plot.bareland_cover_pct);
  push('vascularCoverPct', plot.vascular_cover_pct);
  push('bryophyteCoverPct', plot.bryophyte_cover_pct);
  push('lichenCoverPct', plot.lichen_cover_pct);
  push('litterCoverPct', plot.litter_cover_pct);

  // Per-layer vegetation cover / height / abundance method (fixed plots only;
  // transect plots have no layer concept and the active layer list is empty).
  if (plot.plot_type === 'fixed') {
    const layers = getPlotLayers(plot.id);
    const activeLayers = getActiveLayers(plot.layer_count);
    for (const layerKey of activeLayers) {
      const idx = layerIndexOf(layerKey as FixedLayer);
      const row = layers.find((l) => l.layer_index === idx);
      if (!row) continue;
      push(`${layerKey.toLowerCase()}CoverPct`, row.cover_pct);
      // Emit height in the layer's chosen unit; height_cm is stored in cm.
      const inM = row.height_unit === 'm';
      const heightVal =
        row.height_cm == null ? null : inM ? row.height_cm / 100 : row.height_cm;
      push(`${layerKey.toLowerCase()}Height${inM ? 'M' : 'Cm'}`, heightVal);
      push(`${layerKey.toLowerCase()}Method`, row.method);
    }
  }

  return rows;
}

/** Build the species CSV body for a plot. Columns are DwC terms — only
 *  `verbatimVegetationLayer` is non-standard because there's no DwC term for
 *  a within-event vegetation stratum. */
function buildPlotSpeciesCsv(
  species: PlotSpeciesRecordWithTaxon[],
  plotType: PlotType,
  plotid: string,
  subplotLabelById: Map<number, string>,
): string {
  // verbatimVegetationLayer only carries meaning for fixed plots (E1-E6).
  // Transect ('T') and point_count have no vegetation stratum, so the column
  // is omitted entirely for them.
  const includeLayer = plotType === 'fixed';
  // leafPhenology (落葉/常綠) only applies to vascular plants; drop the column
  // when the plot has no vascular taxa (e.g. an all-animal point count).
  const includeLeaf = species.some((s) => s.phylum === 'Tracheophyta');
  // DwC event hierarchy: subplot record → eventID=plotid-label, parentEventID=plotid.
  const hasSubplots = species.some((s) => s.subplot_id != null);
  const eventIdOf = (r: PlotSpeciesRecordWithTaxon) =>
    r.subplot_id != null ? `${plotid}-${subplotLabelById.get(r.subplot_id) ?? r.subplot_id}` : plotid;
  const cols: Array<{ h: string; v: (r: PlotSpeciesRecordWithTaxon) => unknown }> = [
    { h: 'occurrenceID', v: (r) => r.occurrence_id },
    { h: 'eventID', v: eventIdOf },
    ...(hasSubplots
      ? [{ h: 'parentEventID', v: (r: PlotSpeciesRecordWithTaxon) => (r.subplot_id != null ? plotid : '') }]
      : []),
    { h: 'taxonID', v: (r) => r.taxon_id },
    { h: 'scientificName', v: (r) => r.simple_name },
    { h: 'scientificNameAuthorship', v: (r) => r.name_author },
    { h: 'vernacularName', v: (r) => r.common_name_c },
    { h: 'family', v: (r) => r.family },
    ...(includeLayer
      ? [{ h: 'verbatimVegetationLayer', v: (r: PlotSpeciesRecordWithTaxon) => r.layer }]
      : []),
    { h: 'organismQuantity', v: (r) => r.organism_quantity ?? '' },
    { h: 'organismQuantityType', v: (r) => r.organism_quantity_type ?? '' },
    { h: 'sex', v: (r) => r.sex ?? '' },
    { h: 'lifeStage', v: (r) => r.life_stage ?? '' },
    { h: 'reproductiveCondition', v: (r) => multiToPipe(r.reproductive_condition) },
    ...(includeLeaf
      ? [{ h: 'leafPhenology', v: (r: PlotSpeciesRecordWithTaxon) => multiToPipe(r.leaf_phenology) }]
      : []),
    { h: 'detectionType', v: (r) => r.detection_type ?? '' },
    { h: 'decimalLatitude', v: (r) => r.lat ?? '' },
    { h: 'decimalLongitude', v: (r) => r.lng ?? '' },
    { h: 'coordinateUncertaintyInMeters', v: (r) => r.accuracy ?? '' },
    { h: 'eventDate', v: (r) => (r.observed_at ? localIso(r.observed_at) : '') },
    { h: 'eventRemarks', v: (r) => r.notes ?? '' },
  ];
  const lines = [cols.map((c) => c.h).join(',')];
  for (const r of species) {
    lines.push(cols.map((c) => csvEscape(c.v(r))).join(','));
  }
  return '﻿' + lines.join('\n');
}

// Build the points/track/site GeoJSON FeatureCollections from a record set.

type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: Record<string, unknown>;
};

function buildSessionPoints(records: RecordWithTaxon[]): { type: 'FeatureCollection'; features: PointFeature[] } | null {
  const features: PointFeature[] = [];
  for (const r of records) {
    if (r.lat === null || r.lng === null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        name: r.common_name_c || r.simple_name,
        description: r.simple_name + (r.name_author ? ` ${r.name_author}` : ''),
        taxon_id: r.taxon_id,
        observed_at: localIso(r.observed_at),
      },
    });
  }
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

function buildCollectionPoints(
  specimens: SpecimenWithTaxon[],
): { type: 'FeatureCollection'; features: PointFeature[] } | null {
  const features: PointFeature[] = [];
  for (const sp of specimens) {
    if (sp.lat === null || sp.lng === null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [sp.lng, sp.lat] },
      properties: {
        name: `${sp.record_number} ${sp.common_name_c || sp.simple_name}`.trim(),
        description: sp.simple_name + (sp.name_author ? ` ${sp.name_author}` : ''),
        taxon_id: sp.taxon_id,
        recordNumber: sp.record_number,
        collected_at: localIso(sp.collected_at),
      },
    });
  }
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

function buildPlotPoints(records: PlotSpeciesRecordWithTaxon[]): { type: 'FeatureCollection'; features: PointFeature[] } | null {
  // Per-record GPS (v13): a species observation may carry its own coordinate
  // (most common for transect / point count). Emit a Point per such record.
  const features: PointFeature[] = [];
  for (const r of records) {
    if (r.lat === null || r.lng === null) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        name: r.common_name_c || r.simple_name,
        description: r.simple_name + (r.name_author ? ` ${r.name_author}` : ''),
        taxon_id: r.taxon_id,
        organismQuantity: r.organism_quantity ?? '',
        organismQuantityType: r.organism_quantity_type ?? '',
        detectionType: r.detection_type ?? '',
        observed_at: localIso(r.observed_at),
      },
    });
  }
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

// ---- Public API -----------------------------------------------------------

export type BuiltZipEntry = { name: string; bytes: Uint8Array };

async function buildSessionEntries(
  sessionId: number,
  opts: BundleOptions,
  progressCtx: ProgressCtx,
): Promise<{ entries: BuiltZipEntry[]; folderName: string }> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`記錄 ${sessionId} 不存在`);
  const project = getProject(session.project_id);
  const records = listSessionRecords(sessionId);
  if (records.length === 0) throw new Error(`「${session.name}」內無物種，無法匯出`);

  const base = sanitizeFilename(`${session.name}_${project?.name ?? ''}`);
  const entries: BuiltZipEntry[] = [];

  // Session-level event metadata, used by both the yml header and the
  // tall-format env CSV. Shared between formats so they don't drift.
  const startIso = localIso(session.started_at);
  const endIso = session.ended_at !== null ? localIso(session.ended_at) : null;
  const eventDate = endIso ? `${startIso}/${endIso}` : startIso;
  const eventMeta = {
    eventID: session.name,
    eventDate,
    eventStartedAt: startIso,
    eventEndedAt: endIso,
    datasetName: project?.name ?? '',
  };

  // YAML — event block + checklist array
  const dwcItems = records.map((r) => convertToDwc(recordToYamlItem(r)));
  const yamlData: Record<string, unknown> = {
    event: {
      eventID: eventMeta.eventID,
      eventDate: eventMeta.eventDate,
      startedAt: eventMeta.eventStartedAt,
      ...(eventMeta.eventEndedAt ? { endedAt: eventMeta.eventEndedAt } : {}),
      ...(session.recorded_by ? { recordedBy: session.recorded_by } : {}),
    },
    checklist: dwcItems,
  };
  if (project?.name) yamlData.project = project.name;
  entries.push({ name: `${base}/${base}.yml`, bytes: strToU8(yaml.dump(yamlData, { lineWidth: -1, noRefs: true })) });

  // ${session.name}_env.csv — tall (term,value) format, mirrors plot env.
  const envRows: Array<{ term: string; value: string }> = [];
  const pushEnv = (term: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const s = String(v);
    if (!s) return;
    envRows.push({ term, value: s });
  };
  pushEnv('eventID', eventMeta.eventID);
  pushEnv('eventDate', eventMeta.eventDate);
  pushEnv('startedAt', eventMeta.eventStartedAt);
  pushEnv('endedAt', eventMeta.eventEndedAt);
  pushEnv('datasetName', eventMeta.datasetName);
  pushEnv('recordedBy', session.recorded_by);
  pushEnv('eventRemarks', session.notes);
  if (session.start_lat !== null) pushEnv('decimalLatitude', session.start_lat);
  if (session.start_lng !== null) pushEnv('decimalLongitude', session.start_lng);
  const envCsv = '﻿' + ['term,value', ...envRows.map((r) => `${csvEscape(r.term)},${csvEscape(r.value)}`)].join('\n');
  entries.push({
    name: `${base}/${sanitizeFilename(session.name)}_env.csv`,
    bytes: strToU8(envCsv),
  });

  // ${session.name}_sp.csv — DwC species records (was the old `${base}.csv`).
  // CSV rows are ordered taxonomically (kingdom→…→genus→species); the yml
  // checklist above stays in observation order.
  const csvItems = [...records]
    .sort(taxonSortCompare)
    .map((r) => convertToDwc(recordToYamlItem(r)));
  const allKeys = new Set<string>();
  for (const row of dwcItems) for (const k of Object.keys(row)) allKeys.add(k);
  const keys = Array.from(allKeys);
  const csvLines = [keys.join(',')];
  for (const row of csvItems) csvLines.push(keys.map((k) => csvEscape(row[k])).join(','));
  const csv = '﻿' + csvLines.join('\n');
  entries.push({
    name: `${base}/${sanitizeFilename(session.name)}_sp.csv`,
    bytes: strToU8(csv),
  });

  // Markdown
  const md = generateMarkdown(
    records.map(recordToMarkdownItem),
    { project: project?.id !== 0 ? project?.name : '', site: '' },
    {
      levelsOverride: opts.levels.length ? orderLevels(opts.levels) : undefined,
      conservationFields: opts.conservationFields,
    },
  );
  entries.push({ name: `${base}/${base}.md`, bytes: strToU8(md) });
  if (opts.includeDocx) {
    entries.push({ name: `${base}/${base}.docx`, bytes: markdownToDocx(md) });
  }

  // Geo: per-record GPS points
  const points = buildSessionPoints(records);
  if (points) addGeoEntries(entries, base, 'points', points, opts.geoFormats);

  // Geo: session track (full_track mode). Old data is a bare LineString; tracks
  // recorded with the unified recorder are MultiLineString — both parse through
  // parseGeoJsonSafe and serialize via addGeoEntries, same as the plot path.
  if (session.track_geojson) {
    const track = parseGeoJsonSafe(session.track_geojson);
    if (track) addGeoEntries(entries, base, 'track', track as never, opts.geoFormats);
  }

  // Geo: bound site geometry (if any)
  if (session.site_id !== null) {
    const site = getSite(session.site_id);
    if (site) {
      const geom = parseGeoJsonSafe(site.geometry_geojson);
      if (geom) {
        const feature = {
          type: 'Feature' as const,
          geometry: geom as never,
          properties: { name: site.name, description: site.notes ?? '' },
        };
        const fc = { type: 'FeatureCollection' as const, features: [feature] };
        addGeoEntries(entries, base, 'site', fc, opts.geoFormats);
      }
    }
  }

  // Photos
  if (opts.includePhotos) {
    const photoEntries = await collectPhotos(records, base, progressCtx);
    entries.push(...photoEntries);
  }

  // Manifest
  const manifest = buildManifest({
    kind: 'session',
    id: sessionId,
    name: session.name,
    project_name: project?.name ?? '',
    record_count: records.length,
    photo_count: opts.includePhotos
      ? records.reduce((n, r) => n + parsePhotoUris(r.photo_paths).length, 0)
      : 0,
    geoFormats: opts.geoFormats,
  });
  entries.push({ name: `${base}/manifest.json`, bytes: strToU8(JSON.stringify(manifest, null, 2)) });

  return { entries, folderName: base };
}

async function buildPlotEntries(
  plotId: number,
  opts: BundleOptions,
  progressCtx: ProgressCtx,
): Promise<{ entries: BuiltZipEntry[]; folderName: string }> {
  const plot = getPlotSurvey(plotId);
  if (!plot) throw new Error(`樣區 ${plotId} 不存在`);
  const project = plot.project_id !== null ? getProject(plot.project_id) : null;
  const species = listPlotSpecies(plotId);
  // Loaded once and reused by the yml round-trip block + sp.csv + subplots.csv.
  const subplots = listSubplots(plot.id);
  const subplotLabelById = new Map(subplots.map((s) => [s.id, s.label]));
  const plotLayers = plot.plot_type === 'fixed' ? getPlotLayers(plotId) : [];

  const base = sanitizeFilename(`${plot.plotid}_${project?.name ?? 'plot'}`);
  const entries: BuiltZipEntry[] = [];

  // YAML — per-plot shape. Carries the full set of user-entered fields (notes,
  // DwC attributes, detection method, per-record GPS) so the YAML is symmetric
  // with the sp.csv. Raw snake_case keys (not run through convertToDwc), matching
  // the existing organism_quantity convention here.
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
    return item;
  });

  // Full plot block — every field needed to losslessly re-import the survey.
  // null/empty fields are dropped to keep the yml tidy; import treats missing
  // keys as null. `uuid` is the stable round-trip key.
  const plotBlock: Record<string, unknown> = {
    uuid: plot.uuid,
    plotid: plot.plotid,
    plot_type: plot.plot_type,
    project: project?.name ?? '',
    layer_count: plot.layer_count,
  };
  const plotNumOrStr: Array<keyof PlotSurvey> = [
    'start_ts', 'stop_ts', 'recorded_by', 'locality', 'field_note', 'sampling_protocol',
    'sample_size_value', 'sample_size_unit', 'decimal_latitude', 'decimal_longitude',
    'coord_uncertainty_m', 'elevation_m', 'slope_deg', 'aspect_deg', 'terrain_position',
    'total_cover_pct', 'rock_cover_pct', 'gravel_cover_pct', 'bareland_cover_pct',
    'vascular_cover_pct', 'bryophyte_cover_pct', 'lichen_cover_pct', 'litter_cover_pct',
    'point_radius_m', 'track_geojson',
  ];
  for (const k of plotNumOrStr) {
    const v = plot[k];
    if (v !== null && v !== undefined && v !== '') plotBlock[k] = v;
  }

  const yamlData: Record<string, unknown> = { plot: plotBlock };
  if (plot.plot_type === 'fixed') {
    yamlData.layers = plotLayers.map((l) => ({
      layer_index: l.layer_index,
      cover_pct: l.cover_pct,
      height_cm: l.height_cm,
      height_unit: l.height_unit,
      method: l.method,
    }));
    if (subplots.length > 0) {
      yamlData.subplots = subplots.map((s) => ({
        idx: s.idx,
        label: s.label,
        width_m: s.width_m,
        length_m: s.length_m,
        layers: getSubplotLayers(s.id).map((sl) => ({
          layer_index: sl.layer_index,
          cover_pct: sl.cover_pct,
          height_cm: sl.height_cm,
        })),
      }));
    }
  }
  yamlData.species = yamlItems;
  entries.push({ name: `${base}/${base}.yml`, bytes: strToU8(yaml.dump(yamlData, { lineWidth: -1, noRefs: true })) });

  // ${plotid}_checklist.md — deduped (one row per taxon) human-readable 名錄,
  // mirrors the session .md. Same dedup feeds the optional .docx below.
  const uniqueSpecies = [...new Map(species.map((s) => [s.taxon_id, s])).values()];
  const checklistMd = generateMarkdown(
    uniqueSpecies.map(plotSpeciesToMarkdownItem),
    { project: project && project.id !== 0 ? project.name : '', site: plot.plotid },
    {
      levelsOverride: opts.levels.length ? orderLevels(opts.levels) : undefined,
      conservationFields: opts.conservationFields,
    },
  );
  entries.push({ name: `${base}/${plot.plotid}_checklist.md`, bytes: strToU8(checklistMd) });
  if (opts.includeDocx) {
    entries.push({
      name: `${base}/${plot.plotid}_checklist.docx`,
      bytes: markdownToDocx(checklistMd),
    });
  }

  // ${plotid}_env.csv — environmental metadata. Tall format (term,value) so
  // we can emit only the fields that were actually filled in, without leaving
  // empty columns. Standard DwC location / event terms where they exist;
  // vegetation-survey columns (cover/height/method per layer) kept under
  // descriptive camelCase keys (no DwC equivalent exists).
  const envRows = buildPlotEnvRows(plot, project?.name ?? '');
  if (envRows.length > 0) {
    const envCsv = '﻿' + ['term,value', ...envRows.map((r) => `${csvEscape(r.term)},${csvEscape(r.value)}`)].join('\n');
    entries.push({ name: `${base}/${plot.plotid}_env.csv`, bytes: strToU8(envCsv) });
  }

  // ${plotid}_sp.csv — species records under DwC terms (scientificName,
  // vernacularName, organismQuantity, organismQuantityType, family, taxonID).
  // Layer kept as a non-standard column since there is no DwC term for a
  // vegetation stratum within an event.
  // CSV rows ordered taxonomically (kingdom→…→genus→species); the yml above
  // keeps observation/subplot order for round-trip fidelity.
  const spCsv = buildPlotSpeciesCsv(
    [...species].sort(taxonSortCompare),
    plot.plot_type,
    plot.plotid,
    subplotLabelById,
  );
  entries.push({ name: `${base}/${plot.plotid}_sp.csv`, bytes: strToU8(spCsv) });

  // ${plotid}_subplots.csv — per-subplot dimensions + per-layer cover/height
  // (only when the plot is split into subplots). Layer method/unit are shared.
  if (subplots.length > 0) {
    const aLayers = getActiveLayers(plot.layer_count);
    const pLayers = getPlotLayers(plot.id);
    const unitFor = (idx: number) =>
      pLayers.find((l) => l.layer_index === idx)?.height_unit === 'm' ? 'm' : 'cm';
    const header = [
      'subplotLabel',
      'eventID',
      'parentEventID',
      'widthM',
      'lengthM',
      ...aLayers.flatMap((l) => {
        const u = unitFor(layerIndexOf(l));
        return [`${l.toLowerCase()}CoverPct`, `${l.toLowerCase()}Height${u === 'm' ? 'M' : 'Cm'}`];
      }),
    ];
    const lines = [header.join(',')];
    for (const s of subplots) {
      const sl = getSubplotLayers(s.id);
      const cells: unknown[] = [
        s.label,
        `${plot.plotid}-${s.label}`,
        plot.plotid,
        s.width_m ?? '',
        s.length_m ?? '',
        ...aLayers.flatMap((l) => {
          const idx = layerIndexOf(l);
          const row = sl.find((r) => r.layer_index === idx);
          const inM = unitFor(idx) === 'm';
          const h = row?.height_cm == null ? '' : inM ? row.height_cm / 100 : row.height_cm;
          return [row?.cover_pct ?? '', h];
        }),
      ];
      lines.push(cells.map(csvEscape).join(','));
    }
    entries.push({ name: `${base}/${plot.plotid}_subplots.csv`, bytes: strToU8('﻿' + lines.join('\n')) });
  }

  // Geo: per-record species points (v13 — present when observations carry
  // their own GPS; most common for transect / point count).
  const points = buildPlotPoints(species);
  if (points) addGeoEntries(entries, base, 'points', points, opts.geoFormats);

  // Geo: track (transect)
  if (plot.track_geojson) {
    const track = parseGeoJsonSafe(plot.track_geojson);
    if (track) addGeoEntries(entries, base, 'track', track as never, opts.geoFormats);
  }

  // Geo: bound site
  if (plot.site_id !== null) {
    const site = getSite(plot.site_id);
    if (site) {
      const geom = parseGeoJsonSafe(site.geometry_geojson);
      if (geom) {
        const fc = {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              geometry: geom as never,
              properties: { name: site.name, description: site.notes ?? '' },
            },
          ],
        };
        addGeoEntries(entries, base, 'site', fc, opts.geoFormats);
      }
    }
  }

  // Photos (plot species records each may have photos)
  if (opts.includePhotos) {
    const photoEntries = await collectPhotosPlot(species, base, progressCtx);
    entries.push(...photoEntries);
    // Plot environment context photos. Filename: plotid_YYYYMMDD_env-N.jpg
    // where YYYYMMDD is the plot start date (fallback today). Sequence is the
    // order user added the photos (already stable in env_photos_json).
    const envUris = parseEnvPhotos(plot.env_photos_json);
    if (envUris.length > 0) {
      const dateStr = ymdString(plot.start_ts ?? Date.now());
      const envPhotoEntries = await collectEnvPhotos(
        envUris,
        base,
        plot.plotid,
        dateStr,
        progressCtx,
      );
      entries.push(...envPhotoEntries);
    }
  }

  // Manifest
  const manifest = buildManifest({
    kind: 'plot',
    id: plotId,
    uuid: plot.uuid,
    name: plot.plotid,
    project_name: project?.name ?? '',
    record_count: species.length,
    photo_count: opts.includePhotos
      ? species.reduce((n, r) => n + parsePhotoUris(r.photo_paths).length, 0) +
        parseEnvPhotos(plot.env_photos_json).length
      : 0,
    geoFormats: opts.geoFormats,
  });
  entries.push({ name: `${base}/manifest.json`, bytes: strToU8(JSON.stringify(manifest, null, 2)) });

  return { entries, folderName: base };
}

async function buildCollectionEntries(
  tripId: number,
  opts: BundleOptions,
  progressCtx: ProgressCtx,
): Promise<{ entries: BuiltZipEntry[]; folderName: string }> {
  const trip = getCollectionTrip(tripId);
  if (!trip) throw new Error(`採集記錄 ${tripId} 不存在`);
  const project = getProject(trip.project_id);
  const specimens = listSpecimens(tripId);
  if (specimens.length === 0) throw new Error(`「${trip.name}」內無標本，無法匯出`);

  const base = sanitizeFilename(`${trip.name}_${project?.name ?? ''}`);
  const entries: BuiltZipEntry[] = [];

  const startIso = localIso(trip.started_at);
  const endIso = trip.ended_at !== null ? localIso(trip.ended_at) : null;
  const eventDate = endIso ? `${startIso}/${endIso}` : startIso;

  // YAML — event block + specimens array (collection order).
  const dwcItems = specimens.map((sp) => convertToDwc(specimenToYamlItem(sp)));
  const yamlData: Record<string, unknown> = {
    event: {
      eventID: trip.name,
      eventDate,
      startedAt: startIso,
      ...(endIso ? { endedAt: endIso } : {}),
      ...(trip.recorded_by ? { recordedBy: trip.recorded_by } : {}),
      ...(trip.locality ? { locality: trip.locality } : {}),
    },
    specimens: dwcItems,
  };
  if (project?.name) yamlData.project = project.name;
  entries.push({
    name: `${base}/${base}.yml`,
    bytes: strToU8(yaml.dump(yamlData, { lineWidth: -1, noRefs: true })),
  });

  // _env.csv — tall (term,value), mirrors the session/plot shape.
  const envRows: Array<{ term: string; value: string }> = [];
  const pushEnv = (term: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const str = String(v);
    if (!str) return;
    envRows.push({ term, value: str });
  };
  pushEnv('eventID', trip.name);
  pushEnv('eventType', 'Collection');
  pushEnv('eventDate', eventDate);
  pushEnv('startedAt', startIso);
  pushEnv('endedAt', endIso);
  pushEnv('datasetName', project?.name ?? '');
  pushEnv('recordedBy', trip.recorded_by);
  pushEnv('locality', trip.locality);
  pushEnv('eventRemarks', trip.notes);
  const envCsv =
    '﻿' +
    ['term,value', ...envRows.map((r) => `${csvEscape(r.term)},${csvEscape(r.value)}`)].join('\n');
  entries.push({ name: `${base}/${sanitizeFilename(trip.name)}_env.csv`, bytes: strToU8(envCsv) });

  // _sp.csv — DwC occurrence rows, ordered taxonomically (the yml above keeps
  // collection order, same split as sessions).
  const csvItems = [...specimens].sort(taxonSortCompare).map((sp) => convertToDwc(specimenToYamlItem(sp)));
  const allKeys = new Set<string>();
  for (const row of dwcItems) for (const k of Object.keys(row)) allKeys.add(k);
  const keys = Array.from(allKeys);
  const csvLines = [keys.join(',')];
  for (const row of csvItems) csvLines.push(keys.map((k) => csvEscape(row[k])).join(','));
  entries.push({
    name: `${base}/${sanitizeFilename(trip.name)}_sp.csv`,
    bytes: strToU8('﻿' + csvLines.join('\n')),
  });

  // Markdown checklist — dedupe by taxon (a trip may hold several duplicates of
  // the same species, each its own specimen).
  const seen = new Set<string>();
  const mdItems = [];
  for (const sp of specimens) {
    if (seen.has(sp.taxon_id)) continue;
    seen.add(sp.taxon_id);
    mdItems.push(specimenToMarkdownItem(sp));
  }
  const md = generateMarkdown(
    mdItems,
    { project: project?.id !== 0 ? project?.name : '', site: trip.locality ?? '' },
    {
      levelsOverride: opts.levels.length ? orderLevels(opts.levels) : undefined,
      conservationFields: opts.conservationFields,
    },
  );
  entries.push({ name: `${base}/${base}.md`, bytes: strToU8(md) });
  if (opts.includeDocx) {
    entries.push({ name: `${base}/${base}.docx`, bytes: markdownToDocx(md) });
  }

  // Geo: one point per georeferenced specimen.
  const points = buildCollectionPoints(specimens);
  if (points) addGeoEntries(entries, base, 'points', points, opts.geoFormats);

  if (opts.includePhotos) {
    entries.push(...(await collectPhotos(specimens, base, progressCtx)));
  }

  const manifest = buildManifest({
    kind: 'collection',
    id: tripId,
    uuid: trip.uuid,
    name: trip.name,
    project_name: project?.name ?? '',
    record_count: specimens.length,
    photo_count: opts.includePhotos ? countPhotosSession(specimens) : 0,
    geoFormats: opts.geoFormats,
  });
  entries.push({ name: `${base}/manifest.json`, bytes: strToU8(JSON.stringify(manifest, null, 2)) });

  return { entries, folderName: base };
}

function addGeoEntries(
  out: BuiltZipEntry[],
  folder: string,
  stem: 'points' | 'track' | 'site',
  geo: object,
  formats: GeoFormat[],
): void {
  if (formats.includes('geojson')) {
    out.push({ name: `${folder}/${stem}.geojson`, bytes: strToU8(JSON.stringify(geo)) });
  }
  if (formats.includes('gpx')) {
    try {
      out.push({ name: `${folder}/${stem}.gpx`, bytes: strToU8(geoJsonToGpx(geo as never)) });
    } catch {
      // skip silently if geometry is unsupported by GPX
    }
  }
  if (formats.includes('kml')) {
    try {
      out.push({ name: `${folder}/${stem}.kml`, bytes: strToU8(geoJsonToKml(geo as never)) });
    } catch {
      // skip silently
    }
  }
}

export async function resolveAssetUri(uri: string): Promise<string | null> {
  if (uri.startsWith('file://')) return uri;

  // PHAsset (iOS) and Android MediaStore URIs both need an extra hop to get
  // the underlying file path.
  //
  // iOS `ph://<localIdentifier>`: getAssetInfoAsync takes the bare
  //   localIdentifier string, NOT the prefixed URI — passing the full URI
  //   silently throws (caught here) → photo skipped.
  //
  // Android `content://media/external/images/media/<id>`: getAssetInfoAsync
  //   takes the trailing numeric MediaStore _id. If we can't extract it (e.g.
  //   custom provider URI), we fall back to the URI itself which
  //   `expo-file-system::readAsStringAsync` can usually open via the platform
  //   ContentResolver.
  let assetId: string | null = null;
  let fallback: string | null = null;
  if (uri.startsWith('ph://')) {
    assetId = uri.slice(5);
  } else if (uri.startsWith('content://')) {
    const m = uri.match(/\/(\d+)(?:\?|$)/);
    if (m) assetId = m[1];
    fallback = uri;
  } else {
    assetId = uri;
  }

  if (assetId) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId);
      const localUri = info?.localUri ?? info?.uri ?? null;
      if (localUri) return localUri;
      if (__DEV__) console.warn('[bundleExport] no localUri for asset', assetId);
    } catch (e) {
      if (__DEV__) console.warn('[bundleExport] getAssetInfoAsync failed', uri, e);
    }
  }
  return fallback;
}

/** Filename for a single photo entry: `{taxonID}_{cname or scientific}_{n}.{ext}`
 *  e.g. `t0040215_蔓花生_2.heic`. cname is sanitised so it's filesystem-safe;
 *  if absent, falls back to the binomial scientific name with spaces → '_'. */
function photoEntryName(
  folder: string,
  taxonId: string,
  cname: string,
  simpleName: string,
  index: number,
  ext: string,
): string {
  const label = sanitizeFilename(cname || simpleName.replace(/\s+/g, '_') || 'unknown');
  const tid = taxonId || 'unknown';
  return `${folder}/photos/${tid}_${label}_${index}.${ext}`;
}

/** Photos.app permission elevation, once per export run.
 *
 * The capture flow requested `MediaLibrary.requestPermissionsAsync(true)` —
 * `true` = **write-only**. That lets the app SAVE new photos but **denies
 * reading existing assets**, so `requestContentEditingInput` inside
 * `getAssetInfoAsync` resolves with `contentInput = nil` →
 * `info.localUri = null` → photo silently skipped at export.
 *
 * Before any photo read, ask for FULL access. The first time, the system
 * shows the upgrade prompt; subsequent runs no-op. If the user refuses,
 * `getAssetInfoAsync` will continue to return null and we'll just skip
 * photos (the rest of the bundle still ships). */
let photosFullAccessAttempted = false;
export async function ensurePhotosReadAccess(): Promise<void> {
  if (photosFullAccessAttempted) return;
  photosFullAccessAttempted = true;
  try {
    const current = await MediaLibrary.getPermissionsAsync(false);
    if (current.granted) return;
    if (!current.canAskAgain) {
      if (__DEV__) console.warn('[bundleExport] full Photos permission permanently denied; photos will be skipped');
      return;
    }
    await MediaLibrary.requestPermissionsAsync(false);
  } catch (e) {
    if (__DEV__) console.warn('[bundleExport] could not elevate Photos permission', e);
  }
}

/** The minimum shape `collectPhotos` needs — satisfied by session records,
 *  plot species records and specimens alike. */
type PhotoBearing = {
  photo_paths: string | null;
  taxon_id: string;
  common_name_c: string;
  simple_name: string;
};

async function collectPhotos(
  records: PhotoBearing[],
  folder: string,
  ctx: ProgressCtx,
): Promise<BuiltZipEntry[]> {
  await ensurePhotosReadAccess();
  const out: BuiltZipEntry[] = [];
  for (const r of records) {
    const uris = parsePhotoUris(r.photo_paths);
    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      const fileUri = await resolveAssetUri(uri);
      ctx.done += 1;
      ctx.onProgress?.({ label: '處理照片', done: ctx.done, total: ctx.total });
      if (!fileUri) continue;
      try {
        const b64 = await readAsStringAsync(fileUri, { encoding: 'base64' });
        const bytes = base64ToBytes(b64);
        const ext = guessExt(fileUri);
        out.push({
          name: photoEntryName(folder, r.taxon_id, r.common_name_c, r.simple_name, i + 1, ext),
          bytes,
        });
      } catch {
        // skip unreadable photo
      }
    }
  }
  return out;
}

/** Pack environment context photos into the zip with the user-requested
 *  naming convention `${plotid}_${YYYYMMDD}_env-${N}.jpg`. Index is 1-based
 *  and reflects the order the user added them (preserved in
 *  `env_photos_json`). Extension is detected from the source URI; the user's
 *  example used `.jpg` but HEIC / PNG are also passed through unchanged. */
async function collectEnvPhotos(
  uris: string[],
  folder: string,
  plotid: string,
  dateStr: string,
  ctx: ProgressCtx,
): Promise<BuiltZipEntry[]> {
  await ensurePhotosReadAccess();
  const out: BuiltZipEntry[] = [];
  const safePlotid = sanitizeFilename(plotid || 'plot');
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    const fileUri = await resolveAssetUri(uri);
    ctx.done += 1;
    ctx.onProgress?.({ label: '處理照片', done: ctx.done, total: ctx.total });
    if (!fileUri) continue;
    try {
      const b64 = await readAsStringAsync(fileUri, { encoding: 'base64' });
      const bytes = base64ToBytes(b64);
      const ext = guessExt(fileUri);
      out.push({
        name: `${folder}/photos/${safePlotid}_${dateStr}_env-${i + 1}.${ext}`,
        bytes,
      });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

/** Format a millisecond timestamp as YYYYMMDD using the device timezone. */
function ymdString(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}

async function collectPhotosPlot(
  species: PlotSpeciesRecordWithTaxon[],
  folder: string,
  ctx: ProgressCtx,
): Promise<BuiltZipEntry[]> {
  await ensurePhotosReadAccess();
  const out: BuiltZipEntry[] = [];
  for (const r of species) {
    const uris = parsePhotoUris(r.photo_paths);
    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      const fileUri = await resolveAssetUri(uri);
      ctx.done += 1;
      ctx.onProgress?.({ label: '處理照片', done: ctx.done, total: ctx.total });
      if (!fileUri) continue;
      try {
        const b64 = await readAsStringAsync(fileUri, { encoding: 'base64' });
        const bytes = base64ToBytes(b64);
        const ext = guessExt(fileUri);
        out.push({
          name: photoEntryName(folder, r.taxon_id, r.common_name_c, r.simple_name, i + 1, ext),
          bytes,
        });
      } catch {
        // skip
      }
    }
  }
  return out;
}

export function guessExt(uri: string): string {
  const m = uri.toLowerCase().match(/\.(jpg|jpeg|png|heic|webp)(?:\?|$)/);
  return m ? m[1] : 'jpg';
}

export function base64ToBytes(b64: string): Uint8Array {
  // Hermes doesn't have atob in older builds; expo's runtime has it but to be
  // safe we decode manually. Strip data: prefix if present.
  const data = b64.includes(',') ? b64.split(',')[1] : b64;
  const cleaned = data.replace(/\s+/g, '');
  // global.atob is available in Hermes 0.72+ (RN 0.74+); RN 0.81 has it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bin = (globalThis as any).atob(cleaned) as string;
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

function buildManifest(meta: {
  kind: 'session' | 'plot' | 'collection' | 'bundle';
  id?: number;
  /** Plot survey uuid (plot_surveys.uuid) — the stable round-trip key. */
  uuid?: string;
  name?: string;
  project_name?: string;
  record_count?: number;
  photo_count?: number;
  geoFormats?: GeoFormat[];
  items?: BundleItem[];
}): object {
  return {
    app: 'checklister-ng-mobile',
    schema_version: 2,
    created_at: new Date().toISOString(),
    ...meta,
  };
}

// Count photos before reading so we can publish the total to the progress
// callback up front.
function countPhotosSession(records: { photo_paths: string | null }[]): number {
  let n = 0;
  for (const r of records) n += parsePhotoUris(r.photo_paths).length;
  return n;
}
function countPhotosPlot(records: PlotSpeciesRecordWithTaxon[]): number {
  let n = 0;
  for (const r of records) n += parsePhotoUris(r.photo_paths).length;
  return n;
}

/** Total photo count for a plot including env photos. Used for progress bar. */
function countPhotosPlotWithEnv(plotId: number): number {
  const species = listPlotSpecies(plotId);
  const plot = getPlotSurvey(plotId);
  return countPhotosPlot(species) + (plot ? parseEnvPhotos(plot.env_photos_json).length : 0);
}

/** Announce the (synchronous, UI-blocking) zip step and yield one frame so the
 *  overlay can paint "壓縮中…" before zipSync freezes the JS thread. */
async function reportZipStage(onProgress?: (p: ExportProgress) => void): Promise<void> {
  if (!onProgress) return;
  onProgress({ label: '壓縮中…' });
  await new Promise((r) => setTimeout(r, 0));
}

export async function bundleSession(
  sessionId: number,
  opts: BundleOptions,
): Promise<ExportFile> {
  const records = listSessionRecords(sessionId);
  const total = opts.includePhotos ? countPhotosSession(records) : 0;
  const ctx = { done: 0, total, onProgress: opts.onProgress };
  opts.onProgress?.(total > 0 ? { label: '處理照片', done: 0, total } : { label: '準備中…' });
  const { entries, folderName } = await buildSessionEntries(sessionId, opts, ctx);
  await reportZipStage(opts.onProgress);
  return finalizeZip(entries, folderName);
}

export async function bundlePlot(
  plotId: number,
  opts: BundleOptions,
): Promise<ExportFile> {
  const total = opts.includePhotos ? countPhotosPlotWithEnv(plotId) : 0;
  const ctx = { done: 0, total, onProgress: opts.onProgress };
  opts.onProgress?.(total > 0 ? { label: '處理照片', done: 0, total } : { label: '準備中…' });
  const { entries, folderName } = await buildPlotEntries(plotId, opts, ctx);
  await reportZipStage(opts.onProgress);
  return finalizeZip(entries, folderName);
}

export async function bundleCollection(
  tripId: number,
  opts: BundleOptions,
): Promise<ExportFile> {
  const total = opts.includePhotos ? countPhotosSession(listSpecimens(tripId)) : 0;
  const ctx = { done: 0, total, onProgress: opts.onProgress };
  opts.onProgress?.(total > 0 ? { label: '處理照片', done: 0, total } : { label: '準備中…' });
  const { entries, folderName } = await buildCollectionEntries(tripId, opts, ctx);
  await reportZipStage(opts.onProgress);
  return finalizeZip(entries, folderName);
}

export async function bundleMany(items: BundleItem[], opts: BundleOptions): Promise<ExportFile> {
  if (items.length === 0) throw new Error('沒有選擇任何記錄');

  // Compute total photos across all items first so progress reflects the
  // whole batch, not just the current item.
  let totalPhotos = 0;
  if (opts.includePhotos) {
    for (const it of items) {
      if (it.kind === 'session') totalPhotos += countPhotosSession(listSessionRecords(it.id));
      else if (it.kind === 'collection') totalPhotos += countPhotosSession(listSpecimens(it.id));
      else totalPhotos += countPhotosPlotWithEnv(it.id);
    }
  }
  const ctx = { done: 0, total: totalPhotos, onProgress: opts.onProgress };
  opts.onProgress?.({ label: '準備中…' });

  const allEntries: BuiltZipEntry[] = [];
  const itemMeta: Array<Record<string, unknown>> = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // Per-record progress so the user sees movement across a multi-record batch
    // even before photo reads kick in (photos report their own 處理照片 x/y).
    opts.onProgress?.({ label: `處理記錄 ${i + 1}/${items.length}`, done: i, total: items.length });
    try {
      if (it.kind === 'session') {
        const { entries, folderName } = await buildSessionEntries(it.id, opts, ctx);
        allEntries.push(...entries);
        itemMeta.push({ kind: 'session', id: it.id, folder: folderName });
      } else if (it.kind === 'collection') {
        const { entries, folderName } = await buildCollectionEntries(it.id, opts, ctx);
        allEntries.push(...entries);
        itemMeta.push({
          kind: 'collection',
          id: it.id,
          uuid: getCollectionTrip(it.id)?.uuid,
          folder: folderName,
        });
      } else {
        const { entries, folderName } = await buildPlotEntries(it.id, opts, ctx);
        allEntries.push(...entries);
        itemMeta.push({ kind: 'plot', id: it.id, uuid: getPlotSurvey(it.id)?.uuid, folder: folderName });
      }
    } catch (e) {
      // Skip a record that fails (e.g. empty) but record it in the bundle manifest.
      itemMeta.push({
        kind: it.kind,
        id: it.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const bundleManifest = {
    app: 'checklister-ng-mobile',
    schema_version: 1,
    created_at: new Date().toISOString(),
    item_count: items.length,
    items: itemMeta,
    geoFormats: opts.geoFormats,
    includePhotos: opts.includePhotos,
  };
  allEntries.push({
    name: `bundle_manifest.json`,
    bytes: strToU8(JSON.stringify(bundleManifest, null, 2)),
  });

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  await reportZipStage(opts.onProgress);
  return finalizeZip(allEntries, `checklister_bundle_${ts}`);
}

export function finalizeZip(entries: BuiltZipEntry[], folderName: string): ExportFile {
  const zippable: Zippable = {};
  for (const e of entries) zippable[e.name] = e.bytes;
  const zipped = zipSync(zippable, { level: 6 });

  const filename = `${folderName}.zip`;
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(zipped);

  return { uri: file.uri, filename, mimeType: 'application/zip' };
}
