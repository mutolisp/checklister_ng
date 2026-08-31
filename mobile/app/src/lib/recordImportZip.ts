/**
 * Record import — parsing an export `.yml` / `.zip` that is already in memory.
 *
 *   - which kind of record it is (名錄 / 樣區), from the yml itself
 *   - the parsed document (`plotImport.ts` / `sessionImport.ts`)
 *   - geometry the yml did not carry, recovered from the zip's `track.*` /
 *     `site.*` sidecars — **only** as a fallback: the yml is authoritative
 *   - the photo bytes under `photos/`, keyed by filename so the yml's
 *     `photo_files` / `associatedMedia` lists can point at them
 *
 * Deliberately free of expo / DB imports: reading the file is `recordImport.ts`
 * job, and keeping this half pure is what lets `npm run check:roundtrip`
 * exercise the zip handling (kind detection, yml selection, geo fallback) —
 * the layer where "the text encoding of its contents can't be determined"
 * slipped through.
 */
import { strFromU8, unzipSync } from 'fflate';
import { detectFormat, parseGeoFile, type ImportedGeometry } from './geoConverters';
import { ImportError } from './importError';
import { plotFromDoc } from './plotImport';
import { sessionFromDoc } from './sessionImport';
import { buildTrackGeoJSON } from './track';
import type { ImportedPlot, ImportedSession, ImportedSite, TrackSegment } from '~/db';
import yaml from 'js-yaml';

export type ImportedPhotoBlob = { name: string; bytes: Uint8Array };

export type ReadRecordImport =
  | { kind: 'plot'; plot: ImportedPlot; photos: ImportedPhotoBlob[] }
  | { kind: 'session'; session: ImportedSession; photos: ImportedPhotoBlob[] };

type Entries = Record<string, Uint8Array>;

const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'];
const GEO_EXTS = ['geojson', 'gpx', 'kml'] as const;

/**
 * Reduce a zip entry name to a filename that is safe to write.
 *
 * Zip entry names are attacker-controlled (`photos/../../user.db`), and this
 * is the first feature in the app that writes files out of a zip. Strip every
 * path component, then require a known image extension — a traversal payload
 * survives the first step but never the second.
 */
export function safePhotoBasename(entryName: string): string | null {
  const base = entryName.split('/').pop() ?? '';
  const m = base.match(/^(.+)\.([A-Za-z0-9]+)$/);
  if (!m) return null;
  const ext = m[2].toLowerCase();
  if (!PHOTO_EXTS.includes(ext)) return null;
  // Keep letters/digits/._- (the same shape sanitizeFilename emits), collapse
  // anything else — including the '.' and '/' a traversal needs.
  const stem = m[1].replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
  if (!stem) return null;
  return `${stem}.${ext}`;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** `a/b/c.yml` → `a/b`; a root-level entry → ''. */
function dirOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i);
}

function findEntry(entries: Entries, pred: (name: string) => boolean): string | null {
  return Object.keys(entries).find(pred) ?? null;
}

function textOf(entries: Entries, name: string): string {
  return strFromU8(entries[name]);
}

/** Geometry from `${folder}/${stem}.{geojson,gpx,kml}`, in that order —
 *  GeoJSON first because it is the lossless one. */
function geoSidecar(entries: Entries, folder: string, stem: string): ImportedGeometry[] {
  for (const ext of GEO_EXTS) {
    const wanted = folder ? `${folder}/${stem}.${ext}` : `${stem}.${ext}`;
    const name = findEntry(entries, (n) => n.toLowerCase() === wanted.toLowerCase());
    if (!name) continue;
    try {
      const text = textOf(entries, name);
      // Pass the filename so the extension decides the format: detectFormat's
      // content sniffing classifies any `<?xml` prolog as KML before it ever
      // looks for `<gpx`.
      const fmt = detectFormat(text, name);
      if (!fmt) continue;
      const geos = parseGeoFile(text, fmt);
      if (geos.length > 0) return geos;
    } catch {
      // unreadable sidecar — fall through to the next extension
    }
  }
  return [];
}

/** LineString / MultiLineString geometries → the app's canonical track
 *  representation (a stringified MultiLineString), dropping any elevation. */
function geometriesToTrack(geos: ImportedGeometry[]): string | null {
  const segments: TrackSegment[] = [];
  for (const g of geos) {
    const geom = g.geometry;
    if (geom.type === 'LineString') {
      segments.push((geom.coordinates as number[][]).map((c) => [c[0], c[1]] as [number, number]));
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates as number[][][]) {
        segments.push(line.map((c) => [c[0], c[1]] as [number, number]));
      }
    }
  }
  const nonEmpty = segments.filter((s) => s.length > 0);
  return nonEmpty.length > 0 ? buildTrackGeoJSON(nonEmpty) : null;
}

function geometryToSite(geos: ImportedGeometry[], fallbackName: string): ImportedSite | null {
  const g = geos[0];
  if (!g) return null;
  return {
    name: g.name?.trim() || fallbackName,
    notes: g.notes?.trim() || null,
    geometry: g.geometry as ImportedSite['geometry'],
  };
}

function collectPhotos(entries: Entries, folder: string): ImportedPhotoBlob[] {
  const prefix = folder ? `${folder}/photos/` : 'photos/';
  const out: ImportedPhotoBlob[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const safe = safePhotoBasename(name);
    if (!safe) continue;
    out.push({ name: safe, bytes });
  }
  return out;
}

function docKind(doc: Record<string, unknown> | null): 'plot' | 'session' {
  if (doc?.plot) return 'plot';
  if (doc?.event || doc?.checklist) return 'session';
  throw new ImportError('unknownKind');
}

/**
 * Inflate only the metadata entries of an export zip.
 *
 * A photo-heavy bundle is mostly bytes we may not even need (a session export,
 * a refused collection zip), so the photos are a separate pass.
 */
function metaEntries(raw: Uint8Array): Entries {
  return unzipSync(raw, { filter: (f) => /\.(ya?ml|json|geojson|gpx|kml)$/i.test(f.name) });
}

/** Which record a zip holds, and where its yml is. */
function locateRecord(meta: Entries): { folder: string; manifestKind: string | null; ymlName: string } {
  if (findEntry(meta, (n) => n.toLowerCase().endsWith('bundle_manifest.json'))) {
    // A multi-record bundle: importing "the first yml" would silently pick one
    // of N records. Refuse and let the user unzip.
    throw new ImportError('unsupportedBundle');
  }

  const manifestName = findEntry(meta, (n) => n.toLowerCase().endsWith('manifest.json'));
  let folder = '';
  let manifestKind: string | null = null;
  if (manifestName) {
    folder = dirOf(manifestName);
    try {
      manifestKind = String(
        (JSON.parse(textOf(meta, manifestName)) as { kind?: string }).kind ?? '',
      );
    } catch {
      manifestKind = null;
    }
  }
  if (manifestKind === 'collection') throw new ImportError('unsupportedCollection');

  // Prefer the record's own `${folder}/${folder}.yml`; fall back to any yml.
  const stem = folder.split('/').pop() ?? '';
  const ymlName =
    (folder && findEntry(meta, (n) => n.toLowerCase() === `${folder}/${stem}.yml`.toLowerCase())) ||
    findEntry(meta, (n) => /\.(ya?ml)$/i.test(n) && (!folder || dirOf(n) === folder)) ||
    findEntry(meta, (n) => /\.(ya?ml)$/i.test(n));
  if (!ymlName) throw new ImportError('noYmlInZip');
  return { folder: folder || dirOf(ymlName), manifestKind, ymlName };
}

/**
 * The record yml as text, whether the user picked the bare `.yml` or the whole
 * export `.zip`.
 *
 * For callers that only want what's inside the document (the batch species
 * importer reads names/taxonIDs out of it) — reading a zip as a string is what
 * produced iOS's "the text encoding of its contents can't be determined".
 */
export function readRecordYamlTextFromBytes(raw: Uint8Array): string {
  if (!isZip(raw)) return strFromU8(raw);
  const meta = metaEntries(raw);
  return textOf(meta, locateRecord(meta).ymlName);
}

export function readRecordImportFromBytes(raw: Uint8Array): ReadRecordImport {
  if (!isZip(raw)) {
    const doc = yaml.load(strFromU8(raw)) as Record<string, unknown> | null;
    return docKind(doc) === 'plot'
      ? { kind: 'plot', plot: plotFromDoc(doc), photos: [] }
      : { kind: 'session', session: sessionFromDoc(doc), photos: [] };
  }

  const meta = metaEntries(raw);
  const { folder, manifestKind, ymlName } = locateRecord(meta);

  const doc = yaml.load(textOf(meta, ymlName)) as Record<string, unknown> | null;
  const kind = manifestKind === 'plot' || manifestKind === 'session' ? manifestKind : docKind(doc);

  // Pass 2 — the photo bytes, now that the kind is known and accepted.
  const photoEntries = unzipSync(raw, { filter: (f) => /(^|\/)photos\//i.test(f.name) });
  const photos = collectPhotos(photoEntries, folder);

  if (kind === 'plot') {
    const plot = plotFromDoc(doc);
    if (!plot.track_geojson) plot.track_geojson = geometriesToTrack(geoSidecar(meta, folder, 'track'));
    if (!plot.site) plot.site = geometryToSite(geoSidecar(meta, folder, 'site'), plot.plotid);
    return { kind: 'plot', plot, photos };
  }

  const session = sessionFromDoc(doc);
  if (!session.track_geojson) {
    session.track_geojson = geometriesToTrack(geoSidecar(meta, folder, 'track'));
  }
  if (!session.site) session.site = geometryToSite(geoSidecar(meta, folder, 'site'), session.name);
  return { kind: 'session', session, photos };
}
