/**
 * User-data backup / restore + photo archive.
 *
 *  - createBackup(): snapshot user.db (VACUUM INTO → consistent copy regardless
 *    of journal mode) + manifest → zip. TaiCOL bundle DB is read-only / re-
 *    derived from the app asset, so it is NOT backed up.
 *  - restoreBackup(): replace user.db with the one inside a backup zip, then
 *    reload the app so every store + migration re-runs cleanly.
 *  - createPhotoBackup(): EXPORT-only archive of every photo referenced by
 *    records (session / plot species / plot env) + a CSV mapping. Photos live
 *    in the device photo library, not in user.db — cross-device re-linking is
 *    not attempted, this is for safekeeping / transfer only.
 *
 * Reuses the photo URI→bytes resolver, permission elevation and zip writer from
 * `bundleExport.ts` rather than reimplementing the ph:// / content:// handling.
 */
import { reloadAppAsync } from 'expo';
import i18n from '~/i18n';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { closeDbs, getUserDb, initDb, parseEnvPhotos, searchByTaxonId, type SearchResult } from '~/db';
import { LATEST_SCHEMA_VERSION } from '~/db/migrations';
import {
  base64ToBytes,
  ensurePhotosReadAccess,
  finalizeZip,
  guessExt,
  parsePhotoUris,
  resolveAssetUri,
  sanitizeFilename,
  type BuiltZipEntry,
  type ExportFile,
} from './bundleExport';

const USER_DB_NAME = 'user.db';

/** SQLite VACUUM INTO needs a plain filesystem path, not a file:// URI. */
function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

type BackupManifest = {
  kind: 'checklister-user-backup';
  schemaVersion: number;
  appVersion: string;
  createdAt: number;
};

/** Snapshot user.db into a zip ready to share. */
export async function createBackup(): Promise<ExportFile> {
  const ts = timestamp();

  // VACUUM INTO produces a consistent, compacted copy with no -wal/-shm
  // sidecar, sidestepping journal-mode / open-handle concerns.
  const snapshot = new File(Paths.cache, `backup-snapshot-${ts}.db`);
  if (snapshot.exists) snapshot.delete();
  getUserDb().executeSync(`VACUUM INTO ?;`, [uriToPath(snapshot.uri)]);

  const b64 = await readAsStringAsync(snapshot.uri, { encoding: 'base64' });
  const dbBytes = base64ToBytes(b64);
  snapshot.delete();

  const manifest: BackupManifest = {
    kind: 'checklister-user-backup',
    schemaVersion: LATEST_SCHEMA_VERSION,
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    createdAt: Date.now(),
  };

  const entries: BuiltZipEntry[] = [
    { name: USER_DB_NAME, bytes: dbBytes },
    { name: 'manifest.json', bytes: strToU8(JSON.stringify(manifest, null, 2)) },
  ];
  return finalizeZip(entries, `checklister-backup-${ts}`);
}

/**
 * Restore user.db from a backup zip, then reload the app. DESTRUCTIVE: replaces
 * all current user data. Throws (before touching anything) if the zip is not a
 * valid backup or was made by a newer app whose schema this build can't satisfy.
 */
export async function restoreBackup(zipUri: string): Promise<void> {
  const b64 = await readAsStringAsync(zipUri, { encoding: 'base64' });
  const files = unzipSync(base64ToBytes(b64));

  const dbBytes = files[USER_DB_NAME];
  const manifestBytes = files['manifest.json'];
  if (!dbBytes || !manifestBytes) {
    throw new Error(i18n.t('backup.invalidFile'));
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error(i18n.t('backup.corrupt'));
  }
  if (manifest.kind !== 'checklister-user-backup') {
    throw new Error(i18n.t('backup.notChecklister'));
  }
  if (manifest.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      i18n.t('backup.tooNew', { version: manifest.schemaVersion }),
    );
  }

  await replaceUserDb((dest) => {
    dest.create();
    dest.write(dbBytes);
  });
}

/**
 * Swap user.db for something else, then re-open and restart the app.
 *
 * Shared by `restoreBackup` (zip) and `restoreSafetyBackup` (raw snapshot).
 * The op-sqlite handles must be released first, and the -wal/-shm sidecars
 * deleted, or the old journal replays over the file that was just written.
 */
async function replaceUserDb(write: (dest: File) => void): Promise<void> {
  closeDbs();

  const dest = new File(Paths.document, USER_DB_NAME);
  if (dest.exists) dest.delete();
  for (const sidecar of [`${USER_DB_NAME}-wal`, `${USER_DB_NAME}-shm`]) {
    const f = new File(Paths.document, sidecar);
    if (f.exists) f.delete();
  }
  write(dest);

  // Re-open + run migrations (upgrades an older-schema DB) so a botched reload
  // still leaves a usable DB; then restart so every store re-seeds.
  await initDb();
  await reloadAppAsync();
}

/**
 * Restore one of the automatic pre-repair snapshots taken by `cleanup.ts`.
 *
 * Those are raw `VACUUM INTO` copies of user.db, not zips — they are written
 * on the cold-start path, where zipping (base64 of the whole DB through a JS
 * string) would be far too heavy. So there is no manifest to validate; the
 * file was produced by this app moments before a repair, and `initDb()` will
 * migrate it forward if it is somehow older.
 */
export async function restoreSafetyBackup(name: string): Promise<void> {
  const src = new File(Paths.document, name);
  if (!src.exists) throw new Error(i18n.t('backup.invalidFile'));
  await replaceUserDb((dest) => {
    src.copy(dest);
  });
}

/** Delete one automatic snapshot. */
export function deleteSafetyBackup(name: string): void {
  const f = new File(Paths.document, name);
  if (f.exists) f.delete();
}

type PhotoSource = {
  folder: string;
  taxonId: string | null;
  uris: string[];
};

/** Collect every photo referenced anywhere in user.db, grouped by owner. */
function collectPhotoSources(): PhotoSource[] {
  const db = getUserDb();
  const out: PhotoSource[] = [];

  const sess = db.executeSync(
    `SELECT cr.taxon_id AS taxon_id, cr.photo_paths AS photo_paths,
            s.id AS owner_id, s.name AS owner_name
       FROM checklist_records cr JOIN sessions s ON cr.session_id = s.id
      WHERE cr.photo_paths IS NOT NULL AND cr.photo_paths != ''`,
  );
  for (const r of (sess.rows ?? []) as Array<Record<string, unknown>>) {
    const uris = parsePhotoUris(r.photo_paths as string);
    if (uris.length) {
      out.push({
        folder: `session_${r.owner_id}_${sanitizeFilename(String(r.owner_name ?? ''))}`,
        taxonId: (r.taxon_id as string) ?? null,
        uris,
      });
    }
  }

  const plot = db.executeSync(
    `SELECT psr.taxon_id AS taxon_id, psr.photo_paths AS photo_paths,
            p.id AS owner_id, p.plotid AS owner_name
       FROM plot_species_records psr JOIN plot_surveys p ON psr.plot_survey_id = p.id
      WHERE psr.photo_paths IS NOT NULL AND psr.photo_paths != ''`,
  );
  for (const r of (plot.rows ?? []) as Array<Record<string, unknown>>) {
    const uris = parsePhotoUris(r.photo_paths as string);
    if (uris.length) {
      out.push({
        folder: `plot_${r.owner_id}_${sanitizeFilename(String(r.owner_name ?? ''))}`,
        taxonId: (r.taxon_id as string) ?? null,
        uris,
      });
    }
  }

  const specimens = db.executeSync(
    `SELECT cs.taxon_id AS taxon_id, cs.photo_paths AS photo_paths,
            c.id AS owner_id, c.name AS owner_name
       FROM collection_specimens cs JOIN collection_trips c ON cs.trip_id = c.id
      WHERE cs.photo_paths IS NOT NULL AND cs.photo_paths != ''`,
  );
  for (const r of (specimens.rows ?? []) as Array<Record<string, unknown>>) {
    const uris = parsePhotoUris(r.photo_paths as string);
    if (uris.length) {
      out.push({
        folder: `collection_${r.owner_id}_${sanitizeFilename(String(r.owner_name ?? ''))}`,
        taxonId: (r.taxon_id as string) ?? null,
        uris,
      });
    }
  }

  const env = db.executeSync(
    `SELECT p.id AS owner_id, p.plotid AS owner_name, p.env_photos_json AS env_photos_json
       FROM plot_surveys p WHERE p.env_photos_json IS NOT NULL AND p.env_photos_json != ''`,
  );
  for (const r of (env.rows ?? []) as Array<Record<string, unknown>>) {
    const uris = parseEnvPhotos(r.env_photos_json as string);
    if (uris.length) {
      out.push({
        folder: `plot_${r.owner_id}_${sanitizeFilename(String(r.owner_name ?? ''))}/env`,
        taxonId: null,
        uris,
      });
    }
  }

  return out;
}

const csvEscape = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * Export every record photo into a zip + photos.csv mapping. Returns null if
 * there are no photos to back up.
 */
export async function createPhotoBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<ExportFile | null> {
  const sources = collectPhotoSources();
  const total = sources.reduce((n, s) => n + s.uris.length, 0);
  if (total === 0) return null;

  await ensurePhotosReadAccess();

  const nameCache = new Map<string, SearchResult | null>();
  const lookup = (taxonId: string | null): SearchResult | null => {
    if (!taxonId) return null;
    if (!nameCache.has(taxonId)) nameCache.set(taxonId, searchByTaxonId(taxonId));
    return nameCache.get(taxonId) ?? null;
  };

  const entries: BuiltZipEntry[] = [];
  const csv: string[] = ['filename,taxon_id,scientific_name,common_name,source'];
  let done = 0;

  for (const src of sources) {
    const sr = lookup(src.taxonId);
    const label = sanitizeFilename(sr?.cname || sr?.name || src.taxonId || 'env');
    for (let i = 0; i < src.uris.length; i++) {
      const fileUri = await resolveAssetUri(src.uris[i]);
      done += 1;
      onProgress?.(done, total);
      if (!fileUri) continue;
      try {
        const b64 = await readAsStringAsync(fileUri, { encoding: 'base64' });
        const ext = guessExt(fileUri);
        const name = `${src.folder}/${label}_${i + 1}.${ext}`;
        entries.push({ name, bytes: base64ToBytes(b64) });
        csv.push(
          [
            csvEscape(name),
            csvEscape(src.taxonId ?? ''),
            csvEscape(sr?.name ?? ''),
            csvEscape(sr?.cname ?? ''),
            csvEscape(src.folder),
          ].join(','),
        );
      } catch {
        // skip unreadable photo
      }
    }
  }

  if (entries.length === 0) return null;

  // UTF-8 BOM so Excel reads the CJK CSV correctly (matches desktop export).
  entries.push({ name: 'photos.csv', bytes: strToU8(`﻿${csv.join('\n')}`) });
  return finalizeZip(entries, `checklister-photos-${timestamp()}`);
}
