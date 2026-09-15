/**
 * iNaturalist login state — how the app gets and keeps the 24 h JWT.
 *
 * No OAuth app, no client id, no password ever touches this code. The token
 * is whatever https://www.inaturalist.org/users/api_token returns to a
 * logged-in browser session, and the "browser" is a WebView owned by
 * `InatTokenHost`: the user logs in on iNaturalist's own page, we read the
 * JSON off the api_token page and nothing else (the host only ever injects
 * JS on that exact URL). Its cookies stay in the WebView's own store inside
 * the app sandbox, which is what lets the next day's token be fetched
 * silently. 「解除連結」 logs that session out server-side.
 *
 * Imperative API + module-level zustand store + host component, the same
 * pattern as TextPromptModal / ActionSheet / GbifLookupHost, so the upload
 * driver can call `ensureInatJwt()` from anywhere without knowing about
 * screens.
 *
 * Storage: JWT in expo-secure-store (Keychain / Keystore); the login name in
 * the settings table (not secret). Backups are a whitelist of files
 * (backup.ts) so neither the token nor the WebView cookies can ride along.
 */
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { ApiError } from './apiFetch';
import { fetchMe } from './inatApi';
import { jwtExpiryMs, jwtUsable, parseTokenText } from './inatJwt';
import { useSettings } from '~/stores/settings';

export const INAT_API_TOKEN_URL = 'https://www.inaturalist.org/users/api_token';
export const INAT_LOGOUT_URL = 'https://www.inaturalist.org/logout';
export const INAT_AUTHORIZED_APPS_URL = 'https://www.inaturalist.org/oauth/authorized_applications';

const KEY_JWT = 'inat_jwt';

export type TokenFlowPurpose = 'token' | 'logout';
export type TokenFlowMode = 'hidden' | 'visible';

export type TokenFlowRequest = {
  purpose: TokenFlowPurpose;
  mode: TokenFlowMode;
  /** When false, landing on the login page fails the flow instead of
   *  showing it — used mid-upload so a batch never pops a login sheet on
   *  its own. */
  interactive: boolean;
  resolve: (jwt: string | null) => void;
  reject: (e: Error) => void;
};

type TokenFlowState = {
  pending: TokenFlowRequest | null;
  open: (req: TokenFlowRequest) => void;
  /** Hidden → visible when the login page appears and the flow may interact. */
  show: () => void;
  finish: (jwt: string | null, error?: Error) => void;
};

export const useInatTokenFlow = create<TokenFlowState>((set, get) => ({
  pending: null,
  open: (req) => set({ pending: req }),
  show: () => {
    const p = get().pending;
    if (p && p.mode === 'hidden') set({ pending: { ...p, mode: 'visible' } });
  },
  finish: (jwt, error) => {
    const p = get().pending;
    set({ pending: null });
    if (!p) return;
    if (error) p.reject(error);
    else p.resolve(jwt);
  },
}));

export class InatAuthCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'InatAuthCancelled';
  }
}

/** Login page reached while non-interactive, or the token page produced no
 *  token: the user has to log in before anything else can happen. */
export class InatLoginRequired extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InatLoginRequired';
  }
}

function runFlow(purpose: TokenFlowPurpose, interactive: boolean, mode: TokenFlowMode): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    useInatTokenFlow.getState().open({ purpose, mode, interactive, resolve, reject });
  });
}

// ── storage ──────────────────────────────────────────────────────────────────

export async function getStoredJwt(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_JWT);
  } catch (e) {
    if (__DEV__) console.warn('[inatAuth] SecureStore read failed', e);
    return null;
  }
}

async function storeJwt(jwt: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_JWT, jwt, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** Forget the token only (no network). The WebView session is untouched, so
 *  the next `ensureInatJwt` can still refresh silently. */
export async function clearInatTokens(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_JWT);
  } catch (e) {
    if (__DEV__) console.warn('[inatAuth] SecureStore delete failed', e);
  }
  useSettings.getState().set('inat_login', '');
}

// ── the one entry point ─────────────────────────────────────────────────────

let inflight: Promise<string> | null = null;

/**
 * A JWT good for at least the next few minutes.
 *
 * Order: stored token still usable → return it; else fetch a new one through
 * the hidden WebView (cookies permitting); if that lands on the login page and
 * `interactive` is set, the WebView is shown for the user to log in. Concurrent
 * callers share one flow.
 */
export function ensureInatJwt(opts: { interactive?: boolean } = {}): Promise<string> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const stored = await getStoredJwt();
      if (stored && jwtUsable(stored)) return stored;
      const jwt = await runFlow('token', opts.interactive ?? false, 'hidden');
      if (!jwt) throw new InatAuthCancelled();
      await storeJwt(jwt);
      await rememberLogin(jwt);
      return jwt;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function rememberLogin(jwt: string): Promise<void> {
  try {
    const me = await fetchMe(jwt);
    useSettings.getState().set('inat_login', me.login);
  } catch (e) {
    // A token that cannot even read its own user is worthless — treat a 401
    // as "not logged in" rather than caching it.
    if (e instanceof ApiError && e.status === 401) {
      await clearInatTokens();
      throw new InatLoginRequired('users/me rejected the token');
    }
    if (__DEV__) console.warn('[inatAuth] users/me failed (keeping token)', e);
  }
}

/** Account page 「連結」: always interactive; the WebView is shown straight
 *  away if the session has lapsed. */
export async function requestInatToken(): Promise<'ok' | 'cancelled'> {
  try {
    await clearJwtOnly();
    await ensureInatJwt({ interactive: true });
    return 'ok';
  } catch (e) {
    if (e instanceof InatAuthCancelled) return 'cancelled';
    throw e;
  }
}

/** Forget the JWT but keep the login name and the WebView session — for a
 *  401 mid-batch, where the next `ensureInatJwt` should refresh silently. */
export async function discardInatJwt(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_JWT);
  } catch {
    // nothing stored
  }
}

const clearJwtOnly = discardInatJwt;

/** Fallback path: the user opened the api_token page in a real browser,
 *  copied the JSON, and taps 「從剪貼簿貼上」. */
export async function pasteInatToken(): Promise<'ok' | 'invalid'> {
  let text = '';
  try {
    text = await Clipboard.getStringAsync();
  } catch {
    return 'invalid';
  }
  const jwt = parseTokenText(text);
  if (!jwt) return 'invalid';
  await storeJwt(jwt);
  try {
    await rememberLogin(jwt);
  } catch (e) {
    if (e instanceof InatLoginRequired) return 'invalid';
    throw e;
  }
  return 'ok';
}

/** 「解除連結」: log the WebView session out on the server (best effort —
 *  offline just skips it), then forget the token. */
export async function logoutInat(): Promise<void> {
  try {
    await runFlow('logout', false, 'hidden');
  } catch (e) {
    if (__DEV__) console.warn('[inatAuth] logout page failed', e);
  }
  await clearInatTokens();
}

export type InatStatus = {
  login: string;
  /** Epoch ms, or null when the stored token has no exp. */
  expiresAt: number | null;
  /** Token present and not within the expiry margin. */
  usable: boolean;
};

/** null = nothing stored (never linked, or cleared). */
export async function getInatStatus(): Promise<InatStatus | null> {
  const jwt = await getStoredJwt();
  if (!jwt) return null;
  return {
    login: useSettings.getState().inat_login,
    expiresAt: jwtExpiryMs(jwt),
    usable: jwtUsable(jwt),
  };
}
