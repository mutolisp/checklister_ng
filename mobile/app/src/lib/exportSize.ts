/**
 * Estimate the on-disk size of an export bundle BEFORE doing the actual zip.
 *
 * Used by the multi-select export flow to surface a warning when the user
 * picks N records whose photos add up to hundreds of MB.
 *
 * Strategy:
 *  - Photos: query `MediaLibrary.getAssetInfoAsync` for each asset and read
 *    `fileSize` when available. PHAsset on iOS exposes this; Android usually
 *    does too. Falls back to a 3 MB-per-photo heuristic when unknown.
 *  - Text artefacts (yml / csv / md / geo): cheap approximation — 1 KB per
 *    record. We never block on these because they're dwarfed by photos.
 */
import * as MediaLibrary from 'expo-media-library';
import { listPlotSpecies, listSessionRecords, listSpecimens } from '~/db';
import type { BundleItem } from './bundleExport';

const PHOTO_FALLBACK_BYTES = 3 * 1024 * 1024; // 3 MB per photo when size unknown
const TEXT_BYTES_PER_RECORD = 1024; // 1 KB per record for yml+csv+md combined

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

async function photoBytes(uri: string): Promise<number> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(uri);
    // MediaLibrary.AssetInfo doesn't strictly type `fileSize` across platforms
    // but the underlying native module returns it when available.
    const size = (info as unknown as { fileSize?: number }).fileSize;
    if (typeof size === 'number' && size > 0) return size;
  } catch {
    // fall through to fallback
  }
  return PHOTO_FALLBACK_BYTES;
}

async function recordsPhotoBytes(records: { photo_paths: string | null }[]): Promise<number> {
  let total = 0;
  for (const r of records) {
    for (const uri of parsePhotoUris(r.photo_paths)) {
      total += await photoBytes(uri);
    }
  }
  return total;
}

export type SizeEstimate = {
  totalBytes: number;
  photoBytes: number;
  textBytes: number;
  photoCount: number;
  recordCount: number;
};

export async function estimateBundleSize(
  items: BundleItem[],
  opts: { includePhotos: boolean },
): Promise<SizeEstimate> {
  let totalPhotoBytes = 0;
  let photoCount = 0;
  let recordCount = 0;

  for (const it of items) {
    const records: { photo_paths: string | null }[] =
      it.kind === 'session'
        ? listSessionRecords(it.id)
        : it.kind === 'collection'
          ? listSpecimens(it.id)
          : listPlotSpecies(it.id);
    recordCount += records.length;
    photoCount += records.flatMap((r) => parsePhotoUris(r.photo_paths)).length;
    if (opts.includePhotos) totalPhotoBytes += await recordsPhotoBytes(records);
  }

  const textBytes = recordCount * TEXT_BYTES_PER_RECORD;
  return {
    totalBytes: totalPhotoBytes + textBytes,
    photoBytes: totalPhotoBytes,
    textBytes,
    photoCount,
    recordCount,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
