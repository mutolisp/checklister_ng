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
import type { PlotSpeciesRecordWithTaxon, RecordWithTaxon } from '~/db';

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
   *  `plot_survey_id` for plot species. Either may be omitted. */
  session_id?: number;
  plot_survey_id?: number;
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

/**
 * Compose a piexifjs ExifDict that contains:
 *  - Existing EXIF tags (preserved from the camera output, including GPS)
 *  - ImageDescription / UserComment with our metadata
 */
function composeExif(existing: piexif.ExifDict, ctx: PhotoSpeciesContext): piexif.ExifDict {
  const dict: piexif.ExifDict = {
    '0th': { ...(existing['0th'] ?? {}) },
    Exif: { ...(existing.Exif ?? {}) },
    GPS: { ...(existing.GPS ?? {}) },
    Interop: { ...(existing.Interop ?? {}) },
    '1st': { ...(existing['1st'] ?? {}) },
    thumbnail: existing.thumbnail ?? null,
  };

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

  return dict;
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
function embedMetadata(jpegBase64: string, existingExif: piexif.ExifDict, ctx: PhotoSpeciesContext): string {
  const exifBytes = piexif.dump(composeExif(existingExif, ctx));
  // piexifjs uses "data:image/jpeg;base64," prefixed strings.
  const dataUrl = `data:image/jpeg;base64,${jpegBase64}`;
  const newDataUrl = piexif.insert(exifBytes, dataUrl);
  return newDataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

/**
 * Capture an environmental context photo for a plot (no species metadata
 * embedded — just preserves the camera's native EXIF including GPS + capture
 * timestamp). Saves to Photos.app and returns the asset URI. Caller stores
 * the URI in `plot_surveys.env_photos_json`.
 */
export async function captureEnvPhoto(): Promise<string | null> {
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
  const asset = result.assets[0];
  if (!asset?.uri) return null;
  const saved = await MediaLibrary.createAssetAsync(asset.uri);
  return saved.uri;
}

/**
 * Launch system camera, force JPEG, embed metadata, save to Photos.app.
 * Returns the asset URI (ph://...) on success, or null if cancelled.
 */
export async function captureAndSavePhoto(ctx: PhotoSpeciesContext): Promise<string | null> {
  // Camera permission
  const camPerm = await ImagePicker.requestCameraPermissionsAsync();
  if (camPerm.status !== 'granted') {
    throw new Error(i18n.t('photo.camPerm'));
  }
  // Media library write permission
  const libPerm = await MediaLibrary.requestPermissionsAsync(true);
  if (libPerm.status !== 'granted') {
    throw new Error(i18n.t('photo.libPerm'));
  }

  // quality < 1 forces JPEG on iOS while preserving EXIF
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    exif: true,
    base64: false,
    allowsEditing: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) return null;

  // Best-effort metadata embedding. If anything fails (HEIC, base64 too large,
  // piexif throws), fall back to saving the original file untouched so the
  // photo still gets attached to the record.
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
    const enrichedBase64 = embedMetadata(jpegBase64, existingExif, ctx);
    const tmpName = `checklister_${Date.now()}.jpg`;
    tmpToCleanup = await writeBase64ToCache(tmpName, enrichedBase64);
    pathToSave = tmpToCleanup;
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
  const target = `${APP_PHOTOS_DIR}${randomUuid()}.${ext}`;
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

function randomUuid(): string {
  // Simple v4-ish; doesn't need to be cryptographic for a filename.
  const hex = (n: number) =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0')
      .slice(0, n);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${hex(4)}`;
}
