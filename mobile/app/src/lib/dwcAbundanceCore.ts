/**
 * Pure organismQuantity helpers — no i18n, no DB, no expo.
 *
 * Split out of `dwcAbundance.ts` for the same reason `dwcMultiValue.ts` was
 * split out of `dwcAttributes.ts`: `dwcAbundance` imports `~/i18n` (which
 * imports react-native NativeModules) at module level, and these helpers must
 * stay runnable in the Node check scripts (`scripts/check-vegmatrix.mjs`).
 * `dwcAbundance.ts` re-exports everything here for existing call sites.
 */

export type QuantityKind = 'BB' | 'percent' | 'count' | 'DBH' | 'custom';

/** Stored `organism_quantity_type` string → input kind. The keys are the
 *  stable persisted `value` strings from `quantityTypes()` (labels are i18n'd,
 *  values are not). Anything else is a user-typed custom type. */
const KIND_BY_TYPE: Record<string, QuantityKind> = {
  individuals: 'count',
  '% cover': 'percent',
  'Braun-Blanquet Scale': 'BB',
  'DBH (cm)': 'DBH',
};

/** Determine the input kind given a stored type. Custom strings fall back to 'custom'. */
export function kindForType(stored: string | null | undefined): QuantityKind {
  return (stored != null ? KIND_BY_TYPE[stored] : undefined) ?? 'custom';
}

// ────────── DBH array helpers (organism_quantity = JSON array TEXT) ──────────

export function parseDbhArray(s: string | null | undefined): number[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.filter((x): x is number => typeof x === 'number');
  } catch {
    // ignore — could be a plain number string (single DBH)
  }
  const single = Number(s);
  return Number.isFinite(single) && single > 0 ? [single] : [];
}

export function serializeDbhArray(arr: number[] | null | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return JSON.stringify(arr);
}

// ────────── BA helper ──────────

export function basalArea(dbhCm: number[]): number {
  return dbhCm.reduce((s, d) => s + Math.PI * (d / 2) ** 2, 0);
}

// ────────── Legacy method mapping ──────────

/** Legacy abundance method (BB|percent|DBH) → DwC organismQuantityType. */
export function legacyMethodToType(method: string | null | undefined): string | null {
  switch (method) {
    case 'BB':
      return 'Braun-Blanquet Scale';
    case 'percent':
      return '% cover';
    case 'DBH':
      return 'DBH (cm)';
    default:
      return null;
  }
}

// ────────── Braun-Blanquet code ordering ──────────

/** The BB codes this app records (PlotSpeciesValueModal's BB_OPTIONS), in
 *  ascending cover-abundance order: r (solitary) < + (few) < 1 … 5. */
export const BB_CODES_ASC = ['r', '+', '1', '2', '3', '4', '5'] as const;

/** Rank of a BB code on the ascending scale, or null for a non-BB string. */
export function bbRank(code: string | null | undefined): number | null {
  if (code == null) return null;
  const i = (BB_CODES_ASC as readonly string[]).indexOf(code.trim());
  return i >= 0 ? i : null;
}
