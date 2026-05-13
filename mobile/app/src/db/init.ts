import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { open, type DB } from '@op-engineering/op-sqlite';
import { runUserMigrations } from './migrations';
import { enforceSingleActiveOnStartup } from './cleanup';

let taicolDb: DB | null = null;
let userDb: DB | null = null;

const TAICOL_DB_NAME = 'twnamelist.db';
const USER_DB_NAME = 'user.db';

async function ensureTaicolDb(onProgress?: (step: string) => void): Promise<void> {
  const dest = new File(Paths.document, TAICOL_DB_NAME);
  if (dest.exists) return;

  onProgress?.('解壓縮物種資料庫（首次安裝需數秒）...');
  const asset = Asset.fromModule(require('../../assets/db/twnamelist.db'));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('TaiCOL asset localUri unavailable after download');

  const src = new File(asset.localUri);
  src.copy(dest);
}

export type InitProgressFn = (step: string) => void;

export async function initDb(
  onProgress?: InitProgressFn,
): Promise<{ taicol: DB; user: DB }> {
  if (taicolDb && userDb) return { taicol: taicolDb, user: userDb };

  onProgress?.('準備物種資料庫...');
  await ensureTaicolDb(onProgress);

  onProgress?.('開啟資料庫...');
  taicolDb = open({ name: TAICOL_DB_NAME, location: Paths.document.uri });
  userDb = open({ name: USER_DB_NAME, location: Paths.document.uri });

  onProgress?.('更新資料結構...');
  await runUserMigrations(userDb);

  onProgress?.('清理狀態...');
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
