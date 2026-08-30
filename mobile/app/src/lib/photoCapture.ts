/**
 * Photo capture with embedded EXIF / IPTC metadata (Level 2 design).
 *
 * Workflow:
 *  - Take photo via expo-image-picker (quality < 1 forces JPEG on iOS, EXIF preserved)
 *  - Read existing EXIF from the camera output
 *  - Add UserComment (JSON blob) + IPTC Caption + Keywords describing the species
 *  - Save the modified JPEG to Photos.app via expo-media-library
 *  - Return the asset URI (ph://...) for storage in checklist_records.photo_paths
 *
 * Album-pick path (no metadata write to preserve user's originals):
 *  - launchImageLibraryAsync → just return the picked URI
 */
import {
  cacheDirectory,
  copyAsync,
  deleteAsync,
  documentDirectory,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import i18n from '~/i18n';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import piexif from 'piexifjs';
import { generateUuid } from '~/db';
import type { PlotSpeciesRecordWithTaxon, RecordWithTaxon, SpecimenWithTaxon } from '~/db';

export type PhotoSpeciesContext = {
  taxon_id: string;
  simple_name: string;
  name_author: string;
  common_name_c: string;
  family: string;
  family_c: string;
  kingdom: string;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  observed_at: number;
  /** Owning record reference. `session_id` for checklist records,
   *  `plot_survey_id` for plot species, `collection_trip_id` for specimens.
   *  All are optional. */
  session_id?: number;
  plot_survey_id?: number;
  collection_trip_id?: number;
  /** Collector number (DwC recordNumber) — specimens only. */
  record_number?: string;
};

export function buildContext(record: RecordWithTaxon): PhotoSpeciesContext {
  return {
    taxon_id: record.taxon_id,
    simple_name: record.simple_name,
    name_author: record.name_author,
    common_name_c: record.common_name_c,
    family: record.family,
    family_c: record.family_c,
    kingdom: record.kingdom,
    notes: record.notes,
    lat: record.lat,
    lng: record.lng,
    observed_at: record.observed_at,
    session_id: record.session_id,
  };
}

/** Build a photo context from a plot species record. Plot species don't carry
 *  per-individual GPS (the plot itself does), so lat/lng are omitted here —
 *  the camera EXIF will still capture device GPS at capture time. */
export function buildContextFromPlotRecord(
  record: PlotSpeciesRecordWithTaxon,
): PhotoSpeciesContext {
  return {
    taxon_id: record.taxon_id,
    simple_name: record.simple_name,
    name_author: record.name_author,
    common_name_c: record.common_name_c,
    family: record.family,
    family_c: record.family_c,
    kingdom: record.kingdom,
    notes: record.notes,
    observed_at: record.observed_at,
    plot_survey_id: record.plot_survey_id,
  };
}

/** Photo context for a collected specimen. Unlike plot species, a specimen
 *  carries its own coordinate, so it is passed through and overrides the
 *  camera's GPS the same way a checklist record's does. */
export function buildContextFromSpecimen(sp: SpecimenWithTaxon): PhotoSpeciesContext {
  return {
    taxon_id: sp.taxon_id,
    simple_name: sp.simple_name,
    name_author: sp.name_author,
    common_name_c: sp.common_name_c,
    family: sp.family,
    family_c: sp.family_c,
    kingdom: sp.kingdom,
    notes: sp.notes,
    lat: sp.lat,
    lng: sp.lng,
    observed_at: sp.collected_at,
    collection_trip_id: sp.trip_id,
    record_number: sp.record_number,
  };
}

function buildCaption(ctx: PhotoSpeciesContext): string {
  const fullname = ctx.name_author ? `${ctx.simple_name} ${ctx.name_author}` : ctx.simple_name;
  const parts: string[] = [fullname];
  if (ctx.common_name_c) parts.push(ctx.common_name_c);
  const fam = ctx.family_c && ctx.family ? `${ctx.family_c} (${ctx.family})` : ctx.family || ctx.family_c;
  if (fam) parts.push(fam);
  return parts.join(' · ');
}

/**
 * piexifjs internally treats string values as Latin-1 bytes. To embed UTF-8
 * content (e.g. Chinese common names) into ImageDescription / UserComment,
 * encode the string as UTF-8 then reinterpret each byte as a Latin-1 codepoint.
 * Tools that decode the tag as UTF-8 (Photos.app, exiftool, most viewers) will
 * recover the original characters.
 */
function utf8ToLatin1(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

// ─────────────── Restoring the EXIF expo-image-picker throws away ───────────────
//
// `launchCameraAsync` with `quality < 1` makes expo re-encode the capture via
// `UIImage.jpegData(compressionQuality:)` (ios/ImageUtils.swift, reached because
// ios/MediaHandler.swift sets `imageModified = allowsEditing || quality < 1` and
// so skips `tryCopyingOriginalImageFrom`). That API writes a JPEG carrying **no
// EXIF at all** — Make / Model / LensModel / FocalLength / FNumber / ISO /
// DateTimeOriginal are gone before `piexif.load` ever sees the file. Raising
// quality to 1 doesn't help: for a camera capture `mediaInfo[.imageURL]` is nil,
// so the copy path can't engage either.
//
// The picker does still hand the original metadata back in `asset.exif` (we
// already pass `exif: true`), so we re-inject it below.
//
// Android needs none of this — CompressionImageExporter.kt calls `copyExifData`
// onto the compressed file — which is why `mergePickerExif` only ever *fills
// gaps* and never overwrites. That makes it a no-op there instead of a
// platform branch.

type ExifSlot = { ifd: '0th' | 'Exif' | 'GPS'; tag: number; type: string };

/** CoreGraphics spells a few keys differently from the EXIF tag name. */
const CG_NAME_ALIAS: Record<string, string> = {
  FocalLenIn35mmFilm: 'FocalLengthIn35mmFilm',
};

/**
 * Tags we must not restore: the picker bakes rotation into the bitmap via
 * `fixOrientation()`, and re-encoding changes the pixel dimensions, so carrying
 * the originals over would rotate or mis-size the image.
 */
const SKIP_EXIF_NAMES = new Set(['Orientation', 'PixelXDimension', 'PixelYDimension']);

let nameToSlot: Map<string, ExifSlot> | null = null;

/** Reverse index of `piexif.TAGS`: tag name → which IFD + tag number + type. */
function exifNameMap(): Map<string, ExifSlot> {
  if (nameToSlot) return nameToSlot;
  const map = new Map<string, ExifSlot>();
  // '0th' first so a name present in both (e.g. ExposureTime) resolves to Exif.
  for (const ifd of ['0th', 'Exif', 'GPS'] as const) {
    const table = piexif.TAGS[ifd] ?? {};
    for (const key of Object.keys(table)) {
      const tag = Number(key);
      const def = table[tag];
      if (!def?.name) continue;
      map.set(def.name, { ifd, tag, type: def.type });
    }
  }
  nameToSlot = map;
  return map;
}

/**
 * Approximate `n` as an EXIF rational. piexif packs both halves with `>L` / `>l`
 * and `pack()` throws when a value falls outside that range, so pick the finest
 * denominator that still fits.
 */
function toRational(n: number, signed: boolean): [number, number] | null {
  if (!Number.isFinite(n)) return null;
  if (n < 0 && !signed) return null;
  const max = signed ? 0x7fffffff : 0xffffffff;
  for (const den of [1000000, 10000, 100, 1]) {
    const num = Math.round(n * den);
    if (Math.abs(num) <= max) return [num, den];
  }
  return null;
}

function toInt(v: unknown, max: number): number | null {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

const INT_MAX_BY_TYPE: Record<string, number> = {
  Byte: 0xff,
  Short: 0xffff,
  Long: 0xffffffff,
};

/**
 * Convert a CoreGraphics/ExifInterface value into the shape piexif's
 * `_value_to_bytes` expects for `type`. Returns undefined for anything that
 * can't be represented — `piexif.dump` throws on a mismatch, and a missing tag
 * is far better than losing the whole embed to the fallback path.
 */
function coerceExifValue(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return undefined;

  if (type === 'Ascii') {
    const s = String(v);
    return s.length ? utf8ToLatin1(s) : undefined;
  }

  if (type === 'Rational' || type === 'SRational') {
    const signed = type === 'SRational';
    if (Array.isArray(v)) {
      const pairs = v.map((x) => toRational(Number(x), signed));
      return pairs.every((x): x is [number, number] => x !== null) ? pairs : undefined;
    }
    return toRational(Number(v), signed) ?? undefined;
  }

  const intMax = INT_MAX_BY_TYPE[type];
  if (intMax !== undefined) {
    if (Array.isArray(v)) {
      const nums = v.map((x) => toInt(x, intMax));
      return nums.every((x): x is number => x !== null) ? nums : undefined;
    }
    return toInt(v, intMax) ?? undefined;
  }

  // `Undefined` is packed by string length/concatenation, so only strings work.
  if (type === 'Undefined') return typeof v === 'string' && v.length ? v : undefined;

  // `Float` has no branch in piexif's `_value_to_bytes` — packing one yields a
  // bogus length. Drop it rather than corrupt the segment.
  return undefined;
}

/**
 * Fill `dict` with tags from the picker's `asset.exif`, **never overwriting**
 * what the file already carries. GPS keys arrive prefixed ("GPSLatitude"),
 * which is exactly how piexif names them, so no unwrapping is needed.
 *
 * Returns how many tags were actually restored — 0 means the file already had
 * everything the picker knows about, i.e. nothing was stripped.
 */
function mergePickerExif(
  dict: piexif.ExifDict,
  assetExif: Record<string, unknown> | null | undefined,
): number {
  if (!assetExif) return 0;
  const map = exifNameMap();
  let restored = 0;
  for (const [rawKey, rawValue] of Object.entries(assetExif)) {
    const name = CG_NAME_ALIAS[rawKey] ?? rawKey;
    if (SKIP_EXIF_NAMES.has(name)) continue;
    const slot = map.get(name);
    if (!slot) continue;
    const target = dict[slot.ifd];
    if (!target || target[slot.tag] !== undefined) continue;
    const value = coerceExifValue(slot.type, rawValue);
    if (value === undefined) continue;
    target[slot.tag] = value;
    restored += 1;
  }
  return restored;
}

/**
 * Compose a piexifjs ExifDict that contains:
 *  - Existing EXIF tags (preserved from the camera output, including GPS)
 *  - ImageDescription / UserComment with our metadata
 */
function composeExif(
  existing: piexif.ExifDict,
  ctx: PhotoSpeciesContext | null,
  assetExif?: Record<string, unknown> | null,
): { dict: piexif.ExifDict; changed: boolean } {
  const dict: piexif.ExifDict = {
    '0th': { ...(existing['0th'] ?? {}) },
    Exif: { ...(existing.Exif ?? {}) },
    GPS: { ...(existing.GPS ?? {}) },
    Interop: { ...(existing.Interop ?? {}) },
    '1st': { ...(existing['1st'] ?? {}) },
    thumbnail: existing.thumbnail ?? null,
  };

  // Camera metadata first, so our own tags below still win on collision.
  const restored = mergePickerExif(dict, assetExif);

  // Environment photos carry no species context — original EXIF only. When
  // nothing had to be restored (Android, where the picker copies EXIF onto the
  // compressed file itself) there is nothing to write, and the caller keeps the
  // original file rather than pushing it through a piexif load/dump round-trip
  // that would drop any tag piexif doesn't know.
  if (!ctx) return { dict, changed: restored > 0 };

  const caption = buildCaption(ctx);
  // ImageDescription technically defined as ASCII, but most modern tools decode
  // it as UTF-8 if the bytes are valid UTF-8. Write UTF-8 bytes wrapped in
  // Latin-1 so piexifjs emits them unchanged.
  dict['0th']![piexif.ImageIFD.ImageDescription] = utf8ToLatin1(caption);

  const userCommentJson = JSON.stringify({
    schema: 'checklister.v1',
    taxon_id: ctx.taxon_id,
    name: ctx.simple_name,
    author: ctx.name_author,
    cname: ctx.common_name_c,
    family: ctx.family,
    family_c: ctx.family_c,
    kingdom: ctx.kingdom,
    notes: ctx.notes ?? null,
    lat: ctx.lat ?? null,
    lng: ctx.lng ?? null,
    observed_at: ctx.observed_at,
    session_id: ctx.session_id,
    plot_survey_id: ctx.plot_survey_id,
    collection_trip_id: ctx.collection_trip_id,
    record_number: ctx.record_number ?? null,
  });
  // EXIF UserComment supports a charset prefix. Use ASCII prefix; payload is
  // valid UTF-8 bytes which exiftool / Photos.app decode correctly.
  dict.Exif![piexif.ExifIFD.UserComment] = `ASCII\0\0\0${utf8ToLatin1(userCommentJson)}`;

  // GPS: if record has explicit lat/lng, override (camera GPS might be wrong if recorded later).
  if (typeof ctx.lat === 'number' && typeof ctx.lng === 'number') {
    const latAbs = Math.abs(ctx.lat);
    const lngAbs = Math.abs(ctx.lng);
    dict.GPS![piexif.GPSIFD.GPSLatitudeRef] = ctx.lat >= 0 ? 'N' : 'S';
    dict.GPS![piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(latAbs);
    dict.GPS![piexif.GPSIFD.GPSLongitudeRef] = ctx.lng >= 0 ? 'E' : 'W';
    dict.GPS![piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(lngAbs);
  }

  return { dict, changed: true };
}

async function readBase64(uri: string): Promise<string> {
  return await readAsStringAsync(uri, { encoding: 'base64' });
}

async function writeBase64ToCache(name: string, base64: string): Promise<string> {
  const dir = cacheDirectory ?? '';
  const path = `${dir}${name}`;
  await writeAsStringAsync(path, base64, { encoding: 'base64' });
  return path;
}

/**
 * Embed our metadata into a JPEG base64 (using existing EXIF as base).
 * Returns a new base64 with full EXIF/IPTC data.
 */
function embedMetadata(
  jpegBase64: string,
  existingExif: piexif.ExifDict,
  ctx: PhotoSpeciesContext | null,
  assetExif?: Record<string, unknown> | null,
): string | null {
  const { dict, changed } = composeExif(existingExif, ctx, assetExif);
  if (!changed) return null;
  const exifBytes = piexif.dump(dict);
  // piexifjs uses "data:image/jpeg;base64," prefixed strings.
  const dataUrl = `data:image/jpeg;base64,${jpegBase64}`;
  const newDataUrl = piexif.insert(exifBytes, dataUrl);
  return newDataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

/** Ask for camera + media-library write access, then launch the system camera.
 *  `quality < 1` forces JPEG on iOS (HEIC can't take a piexif segment); the
 *  EXIF it strips in doing so is restored from `asset.exif` further down. */
async function launchCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
  const camPerm = await ImagePicker.requestCameraPermissionsAsync();
  if (camPerm.status !== 'granted') throw new Error(i18n.t('photo.camPerm'));
  const libPerm = await MediaLibrary.requestPermissionsAsync(true);
  if (libPerm.status !== 'granted') throw new Error(i18n.t('photo.libPerm'));

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    exif: true,
    base64: false,
    allowsEditing: false,
  });
  if (result.canceled) return null;
  return result.assets[0]?.uri ? result.assets[0] : null;
}

/**
 * Rewrite the capture with a full EXIF segment — the camera's own tags restored
 * from `asset.exif`, plus our species metadata when `ctx` is given — and save it
 * to Photos.app. Returns the asset URI.
 *
 * Best-effort: if anything fails (HEIC, base64 too large, piexif throws) the
 * original file is saved untouched so the photo still reaches the record.
 */
async function saveWithRestoredExif(
  asset: ImagePicker.ImagePickerAsset,
  ctx: PhotoSpeciesContext | null,
): Promise<string> {
  let pathToSave = asset.uri.replace(/^file:\/\//, '');
  let tmpToCleanup: string | null = null;
  try {
    const jpegBase64 = await readBase64(asset.uri);
    let existingExif: piexif.ExifDict;
    try {
      existingExif = piexif.load(`data:image/jpeg;base64,${jpegBase64}`) as piexif.ExifDict;
    } catch {
      existingExif = { '0th': {}, Exif: {}, GPS: {} } as piexif.ExifDict;
    }
    const enrichedBase64 = embedMetadata(jpegBase64, existingExif, ctx, asset.exif);
    if (enrichedBase64 !== null) {
      const tmpName = `checklister_${Date.now()}.jpg`;
      tmpToCleanup = await writeBase64ToCache(tmpName, enrichedBase64);
      pathToSave = tmpToCleanup;
    }
  } catch (e) {
    console.warn('[photoCapture] metadata embed failed, saving original:', e);
  }

  const saved = await MediaLibrary.createAssetAsync(pathToSave);
  if (tmpToCleanup) {
    try {
      await deleteAsync(tmpToCleanup, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
  return saved.uri;
}

/**
 * Capture an environmental context photo for a plot (no species metadata
 * embedded — just the camera's native EXIF including lens/exposure and, where
 * the platform provides it, GPS + capture timestamp). Saves to Photos.app and
 * returns the asset URI. Caller stores the URI in `plot_surveys.env_photos_json`.
 */
export async function captureEnvPhoto(): Promise<string | null> {
  const asset = await launchCamera();
  if (!asset) return null;
  return saveWithRestoredExif(asset, null);
}

/**
 * Launch system camera, force JPEG, embed metadata, save to Photos.app.
 * Returns the asset URI (ph://...) on success, or null if cancelled.
 */
export async function captureAndSavePhoto(ctx: PhotoSpeciesContext): Promise<string | null> {
  const asset = await launchCamera();
  if (!asset) return null;
  return saveWithRestoredExif(asset, ctx);
}

/**
 * Launch image library picker with multi-selection. Returns an array of
 * persistent `file://` URIs (empty if cancelled).
 *
 * ⚠️ Why we copy instead of returning `result.assets[].uri` directly:
 * `ImagePicker.launchImageLibraryAsync` returns a **temporary** file in the
 * picker's own cache (`file:///.../ImagePicker/<uuid>.jpg`). iOS purges it
 * within minutes; by the time the user exports the zip, the file is gone →
 * photo silently missing from the bundle.
 *
 * `assetId` would let us reference back to the original PHAsset / MediaStore
 * entry, but PHPicker only populates it when the app has full read access
 * (we ask for write-only at capture time), so we can't rely on it either.
 *
 * Cheapest robust option: copy each pick into the app's own
 * `documentDirectory/photos/` with a uuid name. The file is then owned by
 * the app and only deleted when the user removes the photo from a record.
 */
export async function pickPhotos(): Promise<string[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') {
    throw new Error('Photo library access required');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: true,
    quality: 1,
  });
  if (result.canceled) return [];

  const out: string[] = [];
  for (const a of result.assets) {
    const persistent = await persistPickedPhoto(a);
    if (persistent) out.push(persistent);
  }
  return out;
}

/** Persistent dir for picker-imported photos. Created lazily. */
const APP_PHOTOS_DIR = documentDirectory ? `${documentDirectory}photos/` : null;

async function persistPickedPhoto(asset: ImagePicker.ImagePickerAsset): Promise<string | null> {
  const src = typeof asset.uri === 'string' ? asset.uri : null;
  if (!src) return null;
  if (!APP_PHOTOS_DIR) return src; // can't persist (no documentDirectory) — best-effort
  try {
    await makeDirectoryAsync(APP_PHOTOS_DIR, { intermediates: true });
  } catch {
    // already exists; ignore
  }
  const ext = guessPickerExt(src, asset.mimeType);
  const target = `${APP_PHOTOS_DIR}${generateUuid()}.${ext}`;
  try {
    await copyAsync({ from: src, to: target });
    return target;
  } catch (e) {
    if (__DEV__) console.warn('[photoCapture] copy picker file failed', e);
    // Even the temp uri is better than nothing for in-session display; the
    // caller stores it and exports may still pick it up if quickly.
    return src;
  }
}

function guessPickerExt(uri: string, mime: string | null | undefined): string {
  const m = uri.toLowerCase().match(/\.(jpg|jpeg|png|heic|heif|webp)(?:\?|$)/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  if (mime?.includes('heic') || mime?.includes('heif')) return 'heic';
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('webp')) return 'webp';
  return 'jpg';
}


