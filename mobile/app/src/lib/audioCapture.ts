/**
 * Audio clips attached to records (v29 `audio_paths`).
 *
 * Recording itself is a hook (`useAudioRecorder` in AudioClipList); this
 * module owns what is NOT React: the audio session mode, permissions, and
 * moving a finished recording out of the recorder's cache into
 * documentDirectory/audio/ — the same persistence rule picker photos follow
 * (`photoCapture.ts` → documentDirectory/photos/): iOS purges the cache, and
 * a record must never point at a file that has quietly gone.
 *
 * Unlike photos, clips are app-owned files, so removing one from a record
 * also deletes the file.
 */
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { deleteAsync, documentDirectory, makeDirectoryAsync, moveAsync } from 'expo-file-system/legacy';
import { generateUuid } from '~/db';
import { rebaseAppFileUri } from './appFiles';

export const APP_AUDIO_DIR = documentDirectory ? `${documentDirectory}audio/` : null;

/** What `RecordingPresets.HIGH_QUALITY` writes on both platforms. iNaturalist
 *  accepts M4A (`local_sound.rb`: WAV/MP3/M4A/AMR). */
export const AUDIO_EXT = 'm4a';

export async function ensureMicPermission(): Promise<boolean> {
  const res = await requestRecordingPermissionsAsync();
  return res.granted;
}

/** iOS needs the session switched to a recording-capable category before
 *  `record()`; leaving it there afterwards routes playback to the earpiece,
 *  so callers pair this with `endRecordingMode` in a finally. */
export async function beginRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

export async function endRecordingMode(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  } catch (e) {
    if (__DEV__) console.warn('[audioCapture] endRecordingMode failed', e);
  }
}

/** Move a finished recording to its permanent home and return the file:// URI. */
export async function persistRecording(tempUri: string): Promise<string> {
  if (!APP_AUDIO_DIR) return tempUri;
  try {
    await makeDirectoryAsync(APP_AUDIO_DIR, { intermediates: true });
  } catch {
    // exists
  }
  const target = `${APP_AUDIO_DIR}${generateUuid()}.${AUDIO_EXT}`;
  await moveAsync({ from: tempUri, to: target });
  return target;
}

export async function deleteAudioFile(uri: string): Promise<void> {
  if (!uri.startsWith('file:')) return;
  try {
    await deleteAsync(rebaseAppFileUri(uri), { idempotent: true });
  } catch (e) {
    if (__DEV__) console.warn('[audioCapture] delete failed', uri, e);
  }
}

/** Same shape as `parsePhotoUris`: JSON array of strings, `[]` on anything else. */
export function parseAudioPaths(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    // ignore
  }
  return [];
}
