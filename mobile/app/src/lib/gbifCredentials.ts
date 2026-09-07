/**
 * Locally saved GBIF credentials for region-pack downloads (opt-in).
 *
 * Stored as a small JSON file in the app's document directory, deliberately
 * NOT in user.db's settings table: backups are whole-file VACUUM copies of
 * user.db, and a password must never ride along into a backup zip the user
 * then shares. This file stays on-device only.
 *
 * Plain-text on purpose (no expo-secure-store): adding a native module forces
 * a dev-client rebuild, and the file lives inside the app sandbox, which is
 * the same protection the rest of the user's field data gets. Saving at all
 * is the user's explicit choice via a prompt.
 */
import { File, Paths } from 'expo-file-system';

const CREDS_FILE = 'gbif_credentials.json';

export type GbifCredentials = { username: string; password: string };

export async function loadGbifCredentials(): Promise<GbifCredentials | null> {
  try {
    const f = new File(Paths.document, CREDS_FILE);
    if (!f.exists) return null;
    const parsed = JSON.parse(await f.text());
    if (typeof parsed?.username === 'string' && typeof parsed?.password === 'string') {
      return { username: parsed.username, password: parsed.password };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gbif] credentials load failed:', e);
  }
  return null;
}

export function saveGbifCredentials(creds: GbifCredentials): void {
  try {
    const f = new File(Paths.document, CREDS_FILE);
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(creds));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gbif] credentials save failed:', e);
  }
}

/** Called on a 401 (stale password) or when the user opts out. */
export function clearGbifCredentials(): void {
  try {
    const f = new File(Paths.document, CREDS_FILE);
    if (f.exists) f.delete();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gbif] credentials clear failed:', e);
  }
}
