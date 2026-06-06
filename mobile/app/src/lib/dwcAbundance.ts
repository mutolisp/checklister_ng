/**
 * DwC organismQuantity / organismQuantityType helpers.
 *
 * Storage rule:
 *   - organism_quantity:       TEXT (can be a plain number string, a BB code
 *                              like '+' or '5', or a JSON array string for
 *                              multi-stem DBH).
 *   - organism_quantity_type:  TEXT (one of QUANTITY_TYPES.value or a free
 *                              custom string from the user).
 *
 * The set of "built-in" types below covers vegetation + animal surveys.
 * Anything else the user types into a custom field is stored verbatim.
 */

export type QuantityKind = 'BB' | 'percent' | 'count' | 'DBH' | 'custom';

export type QuantityTypeOption = {
  /** Persisted enum value. Stable for DwC export. */
  value: string;
  /** UI label (zh-TW). */
  label: string;
  /** Drives which input widget the modal renders. */
  kind: QuantityKind;
  /** Short text shown next to the numeric input as suffix. */
  suffix?: string;
};

export const QUANTITY_TYPES: QuantityTypeOption[] = [
  {
    value: 'individuals',
    label: '個體數 (individuals)',
    kind: 'count',
  },
  {
    value: '% cover',
    label: '覆蓋度 (% cover)',
    kind: 'percent',
    suffix: '%',
  },
  {
    value: 'Braun-Blanquet Scale',
    label: 'Braun-Blanquet',
    kind: 'BB',
  },
  {
    value: 'DBH (cm)',
    label: '胸高直徑 (DBH, cm)',
    kind: 'DBH',
  },
];

/** Look up the built-in option matching a stored type string. */
export function findQuantityType(stored: string | null | undefined): QuantityTypeOption | null {
  if (!stored) return null;
  return QUANTITY_TYPES.find((q) => q.value === stored) ?? null;
}

/** Determine the input kind given a stored type. Custom strings fall back to 'custom'. */
export function kindForType(stored: string | null | undefined): QuantityKind {
  return findQuantityType(stored)?.kind ?? 'custom';
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

// ────────── Default suggested type per kingdom ──────────

/** Sensible default quantity_type for a freshly-added taxon based on kingdom. */
export function defaultQuantityTypeFor(kingdom: string | null | undefined): string {
  if (!kingdom) return 'individuals';
  const k = kingdom.toLowerCase();
  if (k === 'animalia') return 'individuals';
  // Plants and others default to Braun-Blanquet (vegetation convention).
  if (k === 'plantae') return 'Braun-Blanquet Scale';
  return 'individuals';
}

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

// ────────── Display badge helper ──────────

/**
 * Returns a short, human-readable badge for the record summary line.
 *   '5'         ← count (個體數, no unit suffix)
 *   '25%'       ← percent
 *   'BB: 3'     ← Braun-Blanquet
 *   '2 分枝'    ← DBH
 *   '3 莖節'    ← custom (uses the type string itself as suffix)
 */
export function formatQuantityBadge(
  quantity: string | null | undefined,
  type: string | null | undefined,
): string {
  if (!quantity) return '–';
  const opt = findQuantityType(type);
  if (!opt) {
    // Custom type
    return `${quantity} ${type ?? ''}`.trim();
  }
  if (opt.kind === 'BB') return `BB: ${quantity}`;
  if (opt.kind === 'percent') return `${quantity}%`;
  if (opt.kind === 'count') return `${quantity} ${opt.suffix ?? ''}`.trim();
  if (opt.kind === 'DBH') {
    const stems = parseDbhArray(quantity);
    if (stems.length === 0) return '–';
    return `${stems.length} 分枝`;
  }
  return quantity;
}
