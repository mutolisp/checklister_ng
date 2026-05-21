/**
 * Bundle export: pack one or more records (session / plot) into a single zip
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
  getProject,
  getSession,
  getSite,
  getPlotSurvey,
  listSessionRecords,
  listPlotSpecies,
  type RecordWithTaxon,
  type PlotSpeciesRecordWithTaxon,
} from '~/db';
import { convertToDwc } from './dwcMapper';
import { parseMultiAttribute } from './dwcAttributes';
import { generateMarkdown } from './markdown';
import { geoJsonToGpx, geoJsonToKml } from './geoSerializers';

/** DwC multi-value convention: pipe-separated. Pulls JSON-array DB cells out
 *  and joins with `|`; empty → empty string (CSV column kept positional). */
function multiToPipe(raw: string | null | undefined): string {
  const arr = parseMultiAttribute(raw);
  return arr.join('|');
}

export type GeoFormat = 'geojson' | 'gpx' | 'kml';

export type BundleOptions = {
  geoFormats: GeoFormat[];
  includePhotos: boolean;
  /** Called as each photo is processed. Use for "12/45 張照片..." toast. */
  onProgress?: (done: number, total: number) => void;
};

export type ExportFile = {
  uri: string;
  filename: string;
  mimeType: string;
};

export type BundleItem =
  | { kind: 'session'; id: number }
  | { kind: 'plot'; id: number };

function sanitizeFilename(name: string): string {
  // Allow Unicode letters (incl. CJK), digits, underscore, hyphen, dot. Without
  // \p{L}/\p{N} a Chinese name like 「樹木學」 becomes 「___」 because \w only
  // matches ASCII. Drop separators (space, slash, etc.) → underscore.
  // Trim leading/trailing dots so the entry doesn't accidentally become hidden.
  const cleaned = name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
  return cleaned.replace(/^[._]+|[._]+$/g, '').slice(0, 80) || 'export';
}

function parsePhotoUris(json: string | null): string[] {
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

function recordToYamlItem(r: RecordWithTaxon): Record<string, unknown> {
  const fullname = r.name_author ? `${r.simple_name} ${r.name_author}` : r.simple_name;
  const item: Record<string, unknown> = {
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
    eventDate: new Date(r.observed_at).toISOString(),
  };
  if (r.lat !== null) item.lat = r.lat;
  if (r.lng !== null) item.lng = r.lng;
  if (r.accuracy !== null) item.accuracy = r.accuracy;
  if (r.organism_quantity !== null) item.organism_quantity = r.organism_quantity;
  if (r.organism_quantity_type !== null) item.organism_quantity_type = r.organism_quantity_type;
  return item;
}

function mapAlienToSource(alienType: string, kingdom: string): string {
  if (alienType === 'cultured') return kingdom === 'Animalia' ? '圈養' : '栽培';
  if (alienType === 'native') return '原生';
  if (alienType === 'naturalized' || alienType === 'invasive') return '歸化';
  return '';
}

function recordToMarkdownItem(r: RecordWithTaxon): Parameters<typeof generateMarkdown>[0][number] {
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
    phylum: r.phylum,
    class_name: r.class,
    order: r.order,
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
  push('eventType', plot.plot_type); // fixed | transect
  if (projectName) push('datasetName', projectName);
  if (plot.start_ts !== null) {
    const startIso = new Date(plot.start_ts).toISOString();
    const endIso = plot.stop_ts !== null ? new Date(plot.stop_ts).toISOString() : null;
    push('eventDate', endIso ? `${startIso}/${endIso}` : startIso);
  }
  push('samplingProtocol', plot.sampling_protocol);
  push('sampleSizeValue', plot.sample_size_value);
  push('sampleSizeUnit', plot.sample_size_unit);
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

  // Per-layer vegetation cover / height / abundance method
  push('e0CoverPct', plot.e0_cover_pct);
  push('e0HeightCm', plot.e0_height_cm);
  push('e0Method', plot.e0_method);
  push('e1CoverPct', plot.e1_cover_pct);
  push('e1HeightCm', plot.e1_height_cm);
  push('e1Method', plot.e1_method);
  push('e2CoverPct', plot.e2_cover_pct);
  push('e2HeightCm', plot.e2_height_cm);
  push('e2Method', plot.e2_method);
  push('e3CoverPct', plot.e3_cover_pct);
  push('e3HeightCm', plot.e3_height_cm);
  push('e3Method', plot.e3_method);

  return rows;
}

/** Build the species CSV body for a plot. Columns are DwC terms — only
 *  `verbatimVegetationLayer` is non-standard because there's no DwC term for
 *  a within-event vegetation stratum. */
function buildPlotSpeciesCsv(species: PlotSpeciesRecordWithTaxon[]): string {
  const headers = [
    'taxonID',
    'scientificName',
    'scientificNameAuthorship',
    'vernacularName',
    'family',
    'verbatimVegetationLayer',
    'organismQuantity',
    'organismQuantityType',
    'sex',
    'lifeStage',
    'reproductiveCondition',
    'leafPhenology',
    'eventDate',
    'eventRemarks',
  ];
  const lines = [headers.join(',')];
  for (const r of species) {
    lines.push(
      [
        csvEscape(r.taxon_id),
        csvEscape(r.simple_name),
        csvEscape(r.name_author),
        csvEscape(r.common_name_c),
        csvEscape(r.family),
        csvEscape(r.layer),
        csvEscape(r.organism_quantity ?? ''),
        csvEscape(r.organism_quantity_type ?? ''),
        csvEscape(r.sex ?? ''),
        csvEscape(r.life_stage ?? ''),
        csvEscape(multiToPipe(r.reproductive_condition)),
        csvEscape(multiToPipe(r.leaf_phenology)),
        csvEscape(r.observed_at ? new Date(r.observed_at).toISOString() : ''),
        csvEscape(r.notes ?? ''),
      ].join(','),
    );
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
        observed_at: new Date(r.observed_at).toISOString(),
      },
    });
  }
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

function buildPlotPoints(records: PlotSpeciesRecordWithTaxon[]): { type: 'FeatureCollection'; features: PointFeature[] } | null {
  // Plot species records don't carry per-individual GPS in this app, so this
  // is currently always empty. Stub for parity with session points.
  void records;
  return null;
}

// ---- Public API -----------------------------------------------------------

type BuiltZipEntry = { name: string; bytes: Uint8Array };

async function buildSessionEntries(
  sessionId: number,
  opts: BundleOptions,
  progressCtx: { done: number; total: number; onProgress?: (d: number, t: number) => void },
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
  const startIso = new Date(session.started_at).toISOString();
  const endIso = session.ended_at !== null ? new Date(session.ended_at).toISOString() : null;
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
  pushEnv('eventRemarks', session.notes);
  if (session.start_lat !== null) pushEnv('decimalLatitude', session.start_lat);
  if (session.start_lng !== null) pushEnv('decimalLongitude', session.start_lng);
  const envCsv = '﻿' + ['term,value', ...envRows.map((r) => `${csvEscape(r.term)},${csvEscape(r.value)}`)].join('\n');
  entries.push({
    name: `${base}/${sanitizeFilename(session.name)}_env.csv`,
    bytes: strToU8(envCsv),
  });

  // ${session.name}_sp.csv — DwC species records (was the old `${base}.csv`).
  const allKeys = new Set<string>();
  for (const row of dwcItems) for (const k of Object.keys(row)) allKeys.add(k);
  const keys = Array.from(allKeys);
  const csvLines = [keys.join(',')];
  for (const row of dwcItems) csvLines.push(keys.map((k) => csvEscape(row[k])).join(','));
  const csv = '﻿' + csvLines.join('\n');
  entries.push({
    name: `${base}/${sanitizeFilename(session.name)}_sp.csv`,
    bytes: strToU8(csv),
  });

  // Markdown
  const md = generateMarkdown(records.map(recordToMarkdownItem), {
    project: project?.id !== 0 ? project?.name : '',
    site: '',
  });
  entries.push({ name: `${base}/${base}.md`, bytes: strToU8(md) });

  // Geo: per-record GPS points
  const points = buildSessionPoints(records);
  if (points) addGeoEntries(entries, base, 'points', points, opts.geoFormats);

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
  progressCtx: { done: number; total: number; onProgress?: (d: number, t: number) => void },
): Promise<{ entries: BuiltZipEntry[]; folderName: string }> {
  const plot = getPlotSurvey(plotId);
  if (!plot) throw new Error(`樣區 ${plotId} 不存在`);
  const project = plot.project_id !== null ? getProject(plot.project_id) : null;
  const species = listPlotSpecies(plotId);

  const base = sanitizeFilename(`${plot.plotid}_${project?.name ?? 'plot'}`);
  const entries: BuiltZipEntry[] = [];

  // YAML — minimal shape similar to session but per plot
  const yamlItems = species.map((r) => ({
    taxon_id: r.taxon_id,
    name: r.simple_name,
    cname: r.common_name_c,
    family: r.family,
    layer: r.layer,
    organism_quantity: r.organism_quantity,
    organism_quantity_type: r.organism_quantity_type,
  }));
  const yamlData: Record<string, unknown> = {
    plot: { plotid: plot.plotid, type: plot.plot_type, project: project?.name ?? '' },
    species: yamlItems,
  };
  entries.push({ name: `${base}/${base}.yml`, bytes: strToU8(yaml.dump(yamlData, { lineWidth: -1, noRefs: true })) });

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
  const spCsv = buildPlotSpeciesCsv(species);
  entries.push({ name: `${base}/${plot.plotid}_sp.csv`, bytes: strToU8(spCsv) });

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
  }

  // Manifest
  const manifest = buildManifest({
    kind: 'plot',
    id: plotId,
    name: plot.plotid,
    project_name: project?.name ?? '',
    record_count: species.length,
    photo_count: opts.includePhotos
      ? species.reduce((n, r) => n + parsePhotoUris(r.photo_paths).length, 0)
      : 0,
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

async function resolveAssetUri(uri: string): Promise<string | null> {
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
async function ensurePhotosReadAccess(): Promise<void> {
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

async function collectPhotos(
  records: RecordWithTaxon[],
  folder: string,
  ctx: { done: number; total: number; onProgress?: (d: number, t: number) => void },
): Promise<BuiltZipEntry[]> {
  await ensurePhotosReadAccess();
  const out: BuiltZipEntry[] = [];
  for (const r of records) {
    const uris = parsePhotoUris(r.photo_paths);
    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      const fileUri = await resolveAssetUri(uri);
      ctx.done += 1;
      ctx.onProgress?.(ctx.done, ctx.total);
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

async function collectPhotosPlot(
  species: PlotSpeciesRecordWithTaxon[],
  folder: string,
  ctx: { done: number; total: number; onProgress?: (d: number, t: number) => void },
): Promise<BuiltZipEntry[]> {
  await ensurePhotosReadAccess();
  const out: BuiltZipEntry[] = [];
  for (const r of species) {
    const uris = parsePhotoUris(r.photo_paths);
    for (let i = 0; i < uris.length; i++) {
      const uri = uris[i];
      const fileUri = await resolveAssetUri(uri);
      ctx.done += 1;
      ctx.onProgress?.(ctx.done, ctx.total);
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

function guessExt(uri: string): string {
  const m = uri.toLowerCase().match(/\.(jpg|jpeg|png|heic|webp)(?:\?|$)/);
  return m ? m[1] : 'jpg';
}

function base64ToBytes(b64: string): Uint8Array {
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
  kind: 'session' | 'plot' | 'bundle';
  id?: number;
  name?: string;
  project_name?: string;
  record_count?: number;
  photo_count?: number;
  geoFormats?: GeoFormat[];
  items?: BundleItem[];
}): object {
  return {
    app: 'checklister-ng-mobile',
    schema_version: 1,
    created_at: new Date().toISOString(),
    ...meta,
  };
}

// Count photos before reading so we can publish the total to the progress
// callback up front.
function countPhotosSession(records: RecordWithTaxon[]): number {
  let n = 0;
  for (const r of records) n += parsePhotoUris(r.photo_paths).length;
  return n;
}
function countPhotosPlot(records: PlotSpeciesRecordWithTaxon[]): number {
  let n = 0;
  for (const r of records) n += parsePhotoUris(r.photo_paths).length;
  return n;
}

export async function bundleSession(
  sessionId: number,
  opts: BundleOptions,
): Promise<ExportFile> {
  const records = listSessionRecords(sessionId);
  const total = opts.includePhotos ? countPhotosSession(records) : 0;
  const ctx = { done: 0, total, onProgress: opts.onProgress };
  if (total > 0) opts.onProgress?.(0, total);
  const { entries, folderName } = await buildSessionEntries(sessionId, opts, ctx);
  return finalizeZip(entries, folderName);
}

export async function bundlePlot(
  plotId: number,
  opts: BundleOptions,
): Promise<ExportFile> {
  const species = listPlotSpecies(plotId);
  const total = opts.includePhotos ? countPhotosPlot(species) : 0;
  const ctx = { done: 0, total, onProgress: opts.onProgress };
  if (total > 0) opts.onProgress?.(0, total);
  const { entries, folderName } = await buildPlotEntries(plotId, opts, ctx);
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
      else totalPhotos += countPhotosPlot(listPlotSpecies(it.id));
    }
  }
  const ctx = { done: 0, total: totalPhotos, onProgress: opts.onProgress };
  if (totalPhotos > 0) opts.onProgress?.(0, totalPhotos);

  const allEntries: BuiltZipEntry[] = [];
  const itemMeta: Array<Record<string, unknown>> = [];
  for (const it of items) {
    try {
      if (it.kind === 'session') {
        const { entries, folderName } = await buildSessionEntries(it.id, opts, ctx);
        allEntries.push(...entries);
        itemMeta.push({ kind: 'session', id: it.id, folder: folderName });
      } else {
        const { entries, folderName } = await buildPlotEntries(it.id, opts, ctx);
        allEntries.push(...entries);
        itemMeta.push({ kind: 'plot', id: it.id, folder: folderName });
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
  return finalizeZip(allEntries, `checklister_bundle_${ts}`);
}

function finalizeZip(entries: BuiltZipEntry[], folderName: string): ExportFile {
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
