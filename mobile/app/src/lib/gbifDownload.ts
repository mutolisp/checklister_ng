/**
 * GBIF SPECIES_LIST download orchestration for region packs.
 *
 * The flow is asynchronous on GBIF's side: POST a download request (this is
 * the ONE call that needs the user's GBIF account, via HTTP Basic auth), get
 * back a download key, poll its status until SUCCEEDED, then fetch the zip
 * from the documented retrieval endpoint and hand the TSV to the pure parser.
 *
 * Credentials are needed only here; saving them is the user's opt-in choice
 * (gbifCredentials.ts — a standalone file, never user.db/backups). The
 * download key IS persisted (on the pack row), so a poll interrupted by an
 * app restart resumes without the password: polling and retrieval are public.
 */
import { File, Paths } from 'expo-file-system';
import { createDownloadResumable, readAsStringAsync } from 'expo-file-system/legacy';
import { strFromU8, unzipSync } from 'fflate';
import { ApiError, getJson, sleep, USER_AGENT } from './apiFetch';
import { base64ToBytes } from './bundleExport';
import { gbifGroupKeys } from './gbif';
import type { IconicTaxon } from './inat';
import { buildDownloadRequestBody, parseSpeciesListTsv } from './gbifSpeciesList';
import { router, type Href } from 'expo-router';
import { create } from 'zustand';
import i18n from '~/i18n';
import { useToast } from '~/stores/toast';
import { getPack, importPackRows, invalidatePackCache, updatePack } from '~/db/regionpacks';

const API = 'https://api.gbif.org/v1';

/** First poll after 15 s (small downloads finish in about a minute), then a
 *  gentle 30 s cadence — GBIF's queue can hold a request for a long while and
 *  polling harder does not move it. */
const POLL_FIRST_MS = 15_000;
const POLL_INTERVAL_MS = 30_000;

/** Hermes provides no btoa; Basic auth needs base64 of `user:pass`. */
function toBase64(s: string): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++; // consumed a surrogate pair
    // UTF-8 encode
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b == null ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c == null ? '=' : ALPHABET[c & 63];
  }
  return out;
}

export type PackProgress =
  | { phase: 'requesting' }
  /** GBIF is preparing the file. Its status API exposes NO percentage — only
   *  PREPARING/RUNNING — so elapsed time is the only honest progress here. */
  | { phase: 'waiting'; gbifStatus: string; elapsedMs: number }
  | { phase: 'downloading'; receivedBytes: number; totalBytes: number | null }
  | { phase: 'importing'; done: number; total: number };

/**
 * POST the download request. Returns the GBIF download key.
 *
 * 401 gets its own message upstream (wrong username/password is the one
 * failure the user can actually fix); everything else surfaces as ApiError
 * with GBIF's own detail text.
 */
export async function requestSpeciesListDownload(
  countryCode: string,
  groups: IconicTaxon[],
  username: string,
  password: string,
  notifyEmail?: string,
  signal?: AbortSignal,
): Promise<string> {
  const keys = groups.length === 0 ? [] : gbifGroupKeys(groups).map((k) => k.key);
  const body = buildDownloadRequestBody(countryCode, keys, notifyEmail);
  let res: Response;
  try {
    res = await fetch(`${API}/occurrence/download/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Authorization: `Basic ${toBase64(`${username}:${password}`)}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new ApiError('gbif', 'aborted', 'aborted');
    throw new ApiError('gbif', 'network', String((e as Error)?.message ?? e));
  }
  const text = (await res.text()).trim();
  if (!res.ok) {
    throw new ApiError('gbif', 'http', `HTTP ${res.status}`, res.status, text.slice(0, 300));
  }
  // The body is the bare download key (e.g. "0001234-250907123456789").
  const key = text.replace(/^"|"$/g, '');
  if (!key) throw new ApiError('gbif', 'parse', 'empty download key');
  return key;
}

type DownloadStatus = {
  status: string;
  doi: string | null;
  totalRecords: number | null;
};

export async function getDownloadStatus(key: string, signal?: AbortSignal): Promise<DownloadStatus> {
  const json = await getJson('gbif', `${API}/occurrence/download/${encodeURIComponent(key)}`, signal);
  return {
    status: String(json.status ?? ''),
    doi: typeof json.doi === 'string' ? json.doi : null,
    totalRecords: typeof json.totalRecords === 'number' ? json.totalRecords : null,
  };
}

/**
 * Poll a pack's download to completion, fetch the file, parse and import it.
 * Resumable: everything it needs is on the pack row (`gbif_download_key`), so
 * calling it again after an app restart continues where the queue is.
 *
 * Throws ApiError (network/timeout/http) or Error; the caller decides whether
 * that means `failed` (FAILED/KILLED from GBIF) or just "try again later"
 * (network trouble mid-poll — the key is still valid).
 */
export async function runPackDownload(
  packId: number,
  onProgress?: (p: PackProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pack = getPack(packId);
  if (!pack?.gbif_download_key) throw new Error(`pack ${packId} has no download key`);
  const key = pack.gbif_download_key;

  updatePack(packId, { status: 'running', error: null });
  const waitStart = Date.now();
  let first = true;
  for (;;) {
    if (signal?.aborted) throw new ApiError('gbif', 'aborted', 'aborted');
    const st = await getDownloadStatus(key, signal);
    if (st.status === 'SUCCEEDED') {
      if (st.doi) updatePack(packId, { gbif_doi: st.doi });
      break;
    }
    if (st.status === 'FAILED' || st.status === 'KILLED' || st.status === 'CANCELLED') {
      updatePack(packId, { status: 'failed', error: `GBIF: ${st.status}` });
      throw new Error(`GBIF download ${st.status}`);
    }
    onProgress?.({ phase: 'waiting', gbifStatus: st.status, elapsedMs: Date.now() - waitStart });
    await sleep(first ? POLL_FIRST_MS : POLL_INTERVAL_MS);
    first = false;
  }

  onProgress?.({ phase: 'downloading', receivedBytes: 0, totalBytes: null });
  // Documented retrieval endpoint; redirects to the file. No auth needed.
  // Downloaded to a cache file via the legacy resumable API because it is the
  // one path that reports byte progress — RN's fetch cannot stream a body.
  const cacheFile = new File(Paths.cache, `gbif-pack-${packId}.zip`);
  if (cacheFile.exists) cacheFile.delete();
  const dl = createDownloadResumable(
    `${API}/occurrence/download/request/${encodeURIComponent(key)}`,
    cacheFile.uri,
    { headers: { 'User-Agent': USER_AGENT } },
    (p) =>
      onProgress?.({
        phase: 'downloading',
        receivedBytes: p.totalBytesWritten,
        totalBytes: p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : null,
      }),
  );
  let dlRes: { status: number } | undefined;
  try {
    dlRes = await dl.downloadAsync();
  } catch (e) {
    throw new ApiError('gbif', 'network', String((e as Error)?.message ?? e));
  }
  if (!dlRes || dlRes.status < 200 || dlRes.status >= 300) {
    if (cacheFile.exists) cacheFile.delete();
    throw new ApiError('gbif', 'http', `HTTP ${dlRes?.status ?? '?'}`, dlRes?.status);
  }
  const buf = base64ToBytes(await readAsStringAsync(cacheFile.uri, { encoding: 'base64' }));
  cacheFile.delete();

  onProgress?.({ phase: 'importing', done: 0, total: 1 });
  updatePack(packId, { status: 'importing' });
  const files = unzipSync(buf);
  // The zip holds a single delimited text file named after the key; find it by
  // extension rather than trusting the name.
  const entry = Object.keys(files).find((n) => /\.(csv|tsv|txt)$/i.test(n)) ?? Object.keys(files)[0];
  if (!entry) throw new Error('download zip is empty');
  const { rows } = parseSpeciesListTsv(strFromU8(files[entry]));
  const count = await importPackRows(packId, rows, (done, total) =>
    onProgress?.({ phase: 'importing', done, total }),
  );
  updatePack(packId, { status: 'ready', species_count: count, error: null });
  invalidatePackCache();
}

/**
 * Module-level download driver — the trackRecorder lesson applied here: the
 * poll/download/import loop must NOT live in a screen component. Navigating
 * away from the packs screen leaves the promise running; if the driver state
 * lived in the component, re-entering the screen would show a misleading
 * "unfinished — tap Resume" for a download that is in fact still running, and
 * tapping it would start a SECOND concurrent loop on the same pack.
 *
 * The screen only subscribes to this store; `drivePack` dedupes by pack id.
 */
type PackDownloadState = {
  /** Live progress per pack id. Presence of a key == that pack is running. */
  progress: Record<number, PackProgress>;
};

export const usePackDownloads = create<PackDownloadState>(() => ({ progress: {} }));

function setPackProgress(packId: number, p: PackProgress | null): void {
  usePackDownloads.setState((prev) => {
    const next = { ...prev.progress };
    if (p) next[packId] = p;
    else delete next[packId];
    return { progress: next };
  });
}

export function isPackRunning(packId: number): boolean {
  return usePackDownloads.getState().progress[packId] != null;
}

/**
 * Run one pack's download to completion in the background. Safe to call from
 * anywhere (create flow, resume button, screen re-entry); a pack already being
 * driven is left alone. Completion/failure surfaces as a toast because the
 * user may be on any screen by then.
 */
export function drivePack(packId: number): void {
  if (isPackRunning(packId)) return;
  setPackProgress(packId, { phase: 'requesting' });
  void (async () => {
    try {
      await runPackDownload(packId, (p) => setPackProgress(packId, p));
      // The user is likely on some other screen by now (a big pack takes
      // minutes) — give the toast a way back and more time to be seen.
      useToast.getState().show(i18n.t('regionPacks.ready'), {
        durationMs: 10000,
        action: { label: i18n.t('regionPacks.view'), onPress: () => router.push('/regionpacks' as Href) },
      });
    } catch (e) {
      const msg =
        e instanceof ApiError && e.detail
          ? `${e.message}: ${e.detail}`
          : String((e as Error)?.message ?? e);
      useToast.getState().show(i18n.t('regionPacks.downloadError', { msg }));
    } finally {
      setPackProgress(packId, null);
    }
  })();
}
