/**
 * Record import — the file-reading edge.
 *
 * One base64 read covers both shapes: Android hands back a `content://` URI
 * with no extension, so the magic bytes decide the format, not the filename.
 * Everything after that is in `recordImportZip.ts`, which stays pure.
 */
import { readAsStringAsync } from 'expo-file-system/legacy';
import { base64ToBytes } from './bundleExport';
import {
  readRecordImportFromBytes,
  readRecordYamlTextFromBytes,
  type ReadRecordImport,
} from './recordImportZip';

export {
  safePhotoBasename,
  type ImportedPhotoBlob,
  type ReadRecordImport,
} from './recordImportZip';

async function readBytes(uri: string): Promise<Uint8Array> {
  return base64ToBytes(await readAsStringAsync(uri, { encoding: 'base64' }));
}

/** The record yml as text — from a bare `.yml` or from inside an export zip. */
export async function readRecordYamlText(uri: string): Promise<string> {
  return readRecordYamlTextFromBytes(await readBytes(uri));
}

export async function readRecordImport(uri: string): Promise<ReadRecordImport> {
  return readRecordImportFromBytes(await readBytes(uri));
}
