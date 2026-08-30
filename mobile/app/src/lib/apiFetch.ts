/**
 * The one HTTP entry point. Both external clients (iNaturalist, GBIF) go
 * through it so failure has a single vocabulary.
 *
 * Why a timeout at all: React Native's fetch has none, and this app is used in
 * the field where a request does not fail so much as never answer. A survey
 * screen that spins forever is worse than one that says it could not connect.
 */

export type ApiErrorKind =
  /** fetch() itself failed — offline, DNS, TLS. */
  | 'network'
  /** No answer within the timeout. Common on a weak mobile signal. */
  | 'timeout'
  /** Reached the server, got a non-2xx. */
  | 'http'
  /** HTTP 429: we are asking too fast. Its own kind because the remedy is to
   *  wait, not to retry harder or to tell the user the service is broken. */
  | 'rate_limit'
  /** 2xx with a body we could not read. */
  | 'parse'
  /** The caller aborted. */
  | 'aborted';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  /**
   * The server's own explanation, when it sent one.
   *
   * Worth carrying because GBIF's 400s are specific and actionable — "Too few
   * distinct points in geometry component", "Self-intersection at or near
   * point (121.55, 25.175)" — and a bare "HTTP 400" throws that away, leaving
   * the user with nothing to act on.
   */
  detail?: string;
  /** Which service produced it, for the cross-probe in `connectivity.ts`. */
  service: 'inat' | 'gbif';

  constructor(
    service: 'inat' | 'gbif',
    kind: ApiErrorKind,
    message: string,
    status?: number,
    detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.service = service;
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** Cap on the error body we keep — enough for a sentence, not a stack trace. */
const MAX_DETAIL = 300;

/** Both services ask API consumers to identify themselves. */
export const USER_AGENT = 'Checklister-NG/1.0 (Taiwan species checklist; mutolisp@gmail.com)';

export const DEFAULT_TIMEOUT_MS = 20000;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long to wait out a 429 when the server does not say. */
const RATE_LIMIT_WAIT_MS = 2500;
/** Never sit on a Retry-After longer than this; tell the user instead. */
const MAX_RATE_LIMIT_WAIT_MS = 10000;
const MAX_RATE_LIMIT_RETRIES = 2;

export async function getJson(
  service: 'inat' | 'gbif',
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  attempt = 0,
): Promise<Record<string, unknown>> {
  // A timeout and a caller cancellation are different outcomes, so they get
  // their own flag rather than being read back off one shared signal.
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut) throw new ApiError(service, 'timeout', `timed out after ${timeoutMs} ms`);
      if (signal?.aborted) throw new ApiError(service, 'aborted', 'aborted');
      throw new ApiError(service, 'network', String((e as Error)?.message ?? e));
    }
    if (!res.ok) {
      let detail: string | undefined;
      try {
        detail = (await res.text()).trim().slice(0, MAX_DETAIL) || undefined;
      } catch {
        // Body unreadable; the status alone still has to be reported.
      }
      if (res.status === 429) {
        // Measured, not assumed: GBIF answers a burst of faceted queries with
        // `Too many API requests have been detected from your client`. Retrying
        // after a wait is the documented remedy, so one bounded retry happens
        // here rather than surfacing a failure the user cannot act on.
        const after = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(after) && after > 0 ? after * 1000 : RATE_LIMIT_WAIT_MS;
        if (attempt < MAX_RATE_LIMIT_RETRIES && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
          await sleep(waitMs);
          if (signal?.aborted) throw new ApiError(service, 'aborted', 'aborted');
          return getJson(service, url, signal, timeoutMs, attempt + 1);
        }
        throw new ApiError(service, 'rate_limit', `HTTP 429`, 429, detail);
      }
      throw new ApiError(service, 'http', `HTTP ${res.status}`, res.status, detail);
    }
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      throw new ApiError(service, 'parse', String((e as Error)?.message ?? e));
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Reachability only: is this host answering?
 *
 * A HEAD request, because the body is irrelevant and the alternative is not
 * free — iNaturalist's smallest GET returns ~64 KB, which is a poor thing to
 * spend a field user's mobile data on just to find out whether there is a
 * connection. Both APIs were verified to answer HEAD with 200 and 0 bytes.
 */
export async function probe(
  service: 'inat' | 'gbif',
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new ApiError(service, 'http', `HTTP ${res.status}`, res.status);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (timedOut) throw new ApiError(service, 'timeout', 'probe timed out');
    throw new ApiError(service, 'network', String((e as Error)?.message ?? e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Build a query string.
 *
 * Deliberately NOT `URLSearchParams`, even though React Native polyfills it as
 * a global: its constructor has no copy branch, so `new URLSearchParams(other)`
 * falls through to the plain-object case and `Object.entries()` on the instance
 * yields its private field — the whole thing collapses to
 * `_searchParams=[object Map]` and every parameter is silently dropped. A
 * bounding-box query that quietly loses its bounding box is the worst possible
 * failure here, so this does the encoding itself.
 */
export function qs(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

