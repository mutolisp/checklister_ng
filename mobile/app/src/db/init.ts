import { Asset } from 'expo-asset';
import i18n from '~/i18n';
import { File, Paths } from 'expo-file-system';
import { open, type DB } from '@op-engineering/op-sqlite';
import { runUserMigrations } from './migrations';
import { enforceSingleActiveOnStartup } from './cleanup';
import { perf } from '~/lib/perf';

let taicolDb: DB | null = null;
let userDb: DB | null = null;

const TAICOL_DB_NAME = 'twnamelist.db';
const TAICOL_VERSION_FILE = 'twnamelist.db.version';
const USER_DB_NAME = 'user.db';

async function ensureTaicolDb(onProgress?: (step: string) => void): Promise<void> {
  const dest = new File(Paths.document, TAICOL_DB_NAME);
  const versionFile = new File(Paths.document, TAICOL_VERSION_FILE);

  const asset = Asset.fromModule(require('../../assets/db/twnamelist.db'));
  // `asset.hash` is set by Metro at build time; if the bundled DB changes
  // (e.g. we shipped a new keys table), the hash changes too and we re-copy.
  const bundleHash = asset.hash ?? '';

  let installedHash = '';
  if (versionFile.exists) {
    try {
      const txt = await versionFile.text();
      installedHash = (txt ?? '').trim();
    } catch {
      installedHash = '';
    }
  }

  if (dest.exists && installedHash && installedHash === bundleHash) {
    return; // up-to-date
  }

  const reason = !dest.exists
    ? i18n.t('splash.firstInstall')
    : i18n.t('splash.newDb');
  onProgress?.(i18n.t('splash.extracting', { reason }));

  // First-install path is the dominant cold-start cost (118MB asset copy).
  // Time each phase so we can see in perf log whether asset extraction or
  // file copy dominates, and whether either is worth optimizing.
  await perf.timeAsync('db:asset-download', () => asset.downloadAsync());
  if (!asset.localUri) throw new Error('TaiCOL asset localUri unavailable after download');

  // Replace existing copy if any (schema may have new tables).
  if (dest.exists) {
    try {
      dest.delete();
    } catch {
      // ignore — File.copy may overwrite
    }
  }
  const src = new File(asset.localUri);
  perf.time('db:asset-copy', () => src.copy(dest));

  // Record the hash so we skip the copy on subsequent cold starts.
  try {
    if (versionFile.exists) versionFile.delete();
    versionFile.write(bundleHash);
  } catch {
    // non-fatal: next start will re-copy if write failed
  }
}

export type InitProgressFn = (step: string) => void;

export async function initDb(
  onProgress?: InitProgressFn,
): Promise<{ taicol: DB; user: DB }> {
  if (taicolDb && userDb) return { taicol: taicolDb, user: userDb };

  onProgress?.(i18n.t('splash.preparing'));
  await ensureTaicolDb(onProgress);

  onProgress?.(i18n.t('splash.opening'));
  taicolDb = open({ name: TAICOL_DB_NAME, location: Paths.document.uri });
  userDb = open({ name: USER_DB_NAME, location: Paths.document.uri });

  onProgress?.(i18n.t('splash.migrating'));
  await runUserMigrations(userDb);

  onProgress?.(i18n.t('splash.cleanup'));
  // Idempotent: mops up any leftover multi-active records from older builds.
  enforceSingleActiveOnStartup();

  return { taicol: taicolDb, user: userDb };
}

export function getTaicolDb(): DB {
  if (!taicolDb) throw new Error('TaiCOL DB not initialized — call initDb() first');
  return taicolDb;
}

export function getUserDb(): DB {
  if (!userDb) throw new Error('User DB not initialized — call initDb() first');
  return userDb;
}

export function closeDbs(): void {
  taicolDb?.close();
  userDb?.close();
  taicolDb = null;
  userDb = null;
}

/**
 * Drop all user data (sessions, records, projects, settings, search_history)
 * and re-run migrations. TaiCOL DB is untouched.
 */
export async function clearAllUserData(): Promise<void> {
  if (!userDb) await initDb();
  const db = userDb!;
  db.executeSync(`PRAGMA foreign_keys = OFF;`);
  db.executeSync(`DROP TABLE IF EXISTS checklist_records;`);
  db.executeSync(`DROP TABLE IF EXISTS abundance_records;`);
  db.executeSync(`DROP TABLE IF EXISTS sessions;`);
  db.executeSync(`DROP TABLE IF EXISTS projects;`);
  db.executeSync(`DROP TABLE IF EXISTS search_history;`);
  db.executeSync(`DROP TABLE IF EXISTS settings;`);
  db.executeSync(`DROP TABLE IF EXISTS schema_version;`);
  db.executeSync(`PRAGMA foreign_keys = ON;`);
  await runUserMigrations(db);
}
