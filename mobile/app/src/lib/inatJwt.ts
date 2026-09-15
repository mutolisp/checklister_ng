/**
 * iNaturalist JWT helpers — pure, no Expo imports (scripts/check-inat-payload.mjs
 * loads this under plain Node).
 *
 * The token comes from https://www.inaturalist.org/users/api_token, which
 * returns `{"api_token": "<jwt>"}` and is signed HS512 with a 24 h `exp`
 * (iNaturalist `lib/json_web_token.rb`). We never verify the signature — only
 * the server can — but we do read `exp` so an expired token is replaced
 * before a request fails on it, and `user_id` for display.
 */

export type JwtPayload = {
  user_id?: number;
  exp?: number;
  oauth_application_id?: number;
};

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** How early we treat a token as expired: a batch of uploads paced at one
 *  request per second must not start on a token that dies mid-way. */
export const JWT_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

function base64UrlToText(s: string): string | null {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    // Hermes and Node both provide atob. The payload is ASCII JSON, so the
    // binary string IS the text — no UTF-8 decode step needed.
    return globalThis.atob(padded);
  } catch {
    return null;
  }
}

export function looksLikeJwt(s: string): boolean {
  return JWT_RE.test(s);
}

export function decodeJwtPayload(jwt: string): JwtPayload | null {
  if (!looksLikeJwt(jwt)) return null;
  const text = base64UrlToText(jwt.split('.')[1]);
  if (text === null) return null;
  try {
    const obj = JSON.parse(text) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    return obj as JwtPayload;
  } catch {
    return null;
  }
}

/** `exp` in epoch milliseconds, or null when absent / undecodable. */
export function jwtExpiryMs(jwt: string): number | null {
  const p = decodeJwtPayload(jwt);
  if (!p || typeof p.exp !== 'number') return null;
  return p.exp * 1000;
}

export function jwtUsable(jwt: string, nowMs: number = Date.now(), marginMs: number = JWT_EXPIRY_MARGIN_MS): boolean {
  const exp = jwtExpiryMs(jwt);
  if (exp === null) return false;
  return exp - nowMs > marginMs;
}

/**
 * Turn whatever the user pasted into a token, or null.
 *
 * Accepts the raw JSON the api_token page shows (`{"api_token":"…"}`), that
 * JSON with surrounding whitespace/newlines, a bare JWT, or a line of text
 * that contains the JSON somewhere. Rejects anything that does not decode to
 * a JWT with an `exp` in the future — a stale paste must not "succeed" and
 * then fail on the first upload.
 */
export function parseTokenText(text: string, nowMs: number = Date.now()): string | null {
  const s = (text ?? '').trim();
  if (!s) return null;
  let candidate: string | null = null;
  if (looksLikeJwt(s)) {
    candidate = s;
  } else {
    const m = s.match(/"api_token"\s*:\s*"([^"]+)"/);
    if (m) candidate = m[1];
  }
  if (!candidate || !looksLikeJwt(candidate)) return null;
  return jwtUsable(candidate, nowMs, 0) ? candidate : null;
}
