/**
 * Language-neutral ISO 8601 date/time formatting in the device's *local* time.
 * Used app-wide so displayed timestamps stay consistent regardless of the UI
 * language (i18n) — dates are never locale-formatted. Mirrors the export-side
 * `localIso` in bundleExport.ts (which additionally carries the UTC offset).
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` (local). */
export function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM` (local, 24h). */
export function isoTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:MM` (local). */
export function isoDateTime(ts: number): string {
  return `${isoDate(ts)}T${isoTime(ts)}`;
}
