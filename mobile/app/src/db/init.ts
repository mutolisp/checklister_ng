import { Asset } from 'expo-asset';
import i18n from '~/i18n';
import { File, Paths } from 'expo-file-system';
import { open, type DB } from '@op-engineering/op-sqlite';
import { runUserMigrations } from './migrations';
import { enforceSingleActiveOnStartup, purgeOrphanRows } from './cleanup';
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

  // Migrations and the repair passes run with FK enforcement OFF, then it is
  // switched on for the rest of the session. Order matters both ways:
  //
  //  - OFF during migrations: restoreBackup() re-runs migrations against a
  //    restored older-schema DB, and with FK on, v3's `ALTER TABLE sites
  //    RENAME` rewrites plot_surveys' REFERENCES clause and its DROP fires
  //    ON DELETE SET NULL across every plot. Destructive.
  //  - OFF during cleanup: purgeOrphanRows/repair fix rows that currently have
  //    dangling references. SQLite validates FK on every row it modifies, so
  //    with FK already on, updating such a row would throw instead of healing.
  //  - ON afterwards: this is what finally makes ON DELETE CASCADE / SET NULL
  //    actually fire. Until now every cascade in the schema was inert, which
  //    is why the delete helpers all delete children by hand.
  userDb.executeSync('PRAGMA foreign_keys = OFF;');

  onProgress?.(i18n.t('splash.migrating'));
  await runUserMigrations(userDb);

  onProgress?.(i18n.t('splash.cleanup'));
  // Idempotent: mops up any leftover multi-active records from older builds.
  enforceSingleActiveOnStartup();
  purgeOrphanRows();

  userDb.executeSync('PRAGMA foreign_keys = ON;');
  if (__DEV__) {
    // Report, never auto-delete: a surviving violation is a bug to look at,
    // not something to silently destroy user data over.
    const bad = userDb.executeSync('PRAGMA foreign_key_check;');
    const n = bad.rows?.length ?? 0;
    if (n > 0) console.warn(`[db] ${n} foreign-key violation(s) remain`, bad.rows);
  }

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

let txDepth = 0;

/**
 * Run `fn` inside a single SQLite transaction on the user DB.
 *
 * op-sqlite's own `db.transaction()` is async (its `execute` returns a
 * Promise), so it can't wrap the synchronous `executeSync` call sites the DB
 * layer is built on — hence explicit BEGIN/COMMIT here.
 *
 * Reentrant by depth counter: SQLite rejects a nested BEGIN, so an inner call
 * just joins the outer transaction. `fn` must stay synchronous — awaiting
 * inside would hold the write lock across the event loop.
 *
 * This is for multi-statement writes that must not half-apply (record import
 * deletes the previous copy before inserting the new one). Migrations
 * deliberately stay outside it: they rely on idempotent replay instead.
 */
export function withTransaction<T>(fn: () => T): T {
  const db = getUserDb();
  if (txDepth > 0) return fn();
  db.executeSync('BEGIN IMMEDIATE;');
  txDepth = 1;
  try {
    const out = fn();
    db.executeSync('COMMIT;');
    return out;
  } catch (e) {
    try {
      db.executeSync('ROLLBACK;');
    } catch {
      // already rolled back by SQLite (e.g. a fatal statement error)
    }
    throw e;
  } finally {
    txDepth = 0;
  }
}

export function closeDbs(): void {
  taicolDb?.close();
  userDb?.close();
  taicolDb = null;
  userDb = null;
}

/**
 * Wipe every user table and rebuild an empty DB. TaiCOL DB is untouched.
 *
 * Implemented as delete-the-file rather than a list of DROP TABLEs, because
 * the list is exactly what went wrong before: it named 9 tables (one of them,
 * `abundance_records`, never existed) while the schema had 16, so 樣區 / 樣點 /
 * 常用名錄 / 常用調查者 all survived "清除所有資料". Worse, it also dropped
 * `schema_version`, so migrations replayed from v1 against the surviving
 * tables and died at v6 on `duplicate column name: plot_type`, leaving a
 * half-migrated DB that bricked the app on the next launch with no route to
 * the restore screen.
 *
 * Deleting the file cannot miss a table and needs no maintenance when a new
 * one is added. This is the same sequence `restoreBackup` already uses
 * (backup.ts), which is proven in production.
 */
export async function clearAllUserData(): Promise<void> {
  // Release op-sqlite handles before unlinking the file on disk.
  closeDbs();

  const dest = new File(Paths.document, USER_DB_NAME);
  if (dest.exists) dest.delete();
  // Stale journal sidecars would otherwise replay rows back into the new file.
  for (const sidecar of [`${USER_DB_NAME}-wal`, `${USER_DB_NAME}-shm`]) {
    const f = new File(Paths.document, sidecar);
    if (f.exists) f.delete();
  }

  // Re-open and migrate from scratch; initDb() re-seeds the 未分類 project.
  await initDb();
}
