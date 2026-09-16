/**
 * Pure DwC value helpers, split out of `dwcAttributes.ts`
 * so the import parsers and the yml builders can use it without dragging in
 * `~/i18n` (they must stay runnable outside the app — see
 * scripts/check-roundtrip.mjs). `dwcAttributes` re-exports both for existing
 * call sites.
 */

/**
 * Parse a DB-side string into an array of values.
 *
 *   null / ''     → []
 *   '["a","b"]'   → ['a','b']           (JSON array — current canonical form)
 *   'a|b'         → ['a','b']           (legacy `|` separator, DwC import)
 *   'flowering'   → ['flowering']        (legacy single-value plain string)
 */
export function parseMultiAttribute(s: string | null | undefined): string[] {
  if (s == null || s === '') return [];
  // JSON array form
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    } catch {
      // fall through to single-value treatment
    }
  }
  // `|`-separated legacy form (DwC convention)
  if (s.includes('|')) {
    return s.split('|').map((x) => x.trim()).filter((x) => x.length > 0);
  }
  return [s];
}

/** Serialize a string[] back to a DB cell. Returns null when empty. */
export function serializeMultiAttribute(arr: string[] | null | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return JSON.stringify(arr);
}

/**
 * The `degreeOfEstablishment` value a DwC deliverable may carry.
 *
 * `captive` and `cultivated` are TDWG vocabulary values; `wild` is ours and has
 * no term there, so it blanks. Lives in this pure module rather than
 * `dwcAttributes.ts` so `scripts/check-roundtrip.mjs` can assert on the real
 * function instead of a copy of its rule.
 */
export function establishmentDwcValue(v: string | null | undefined): string {
  return v === 'captive' || v === 'cultivated' ? v : '';
}
