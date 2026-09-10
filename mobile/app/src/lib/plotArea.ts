/**
 * Plot area in square metres — the denominator every per-hectare figure needs,
 * and the one number the schema does NOT simply hold.
 *
 * `plot_surveys` has no width/length/radius columns. What exists is
 * `sample_size_value` (a bare number) paired with `sample_size_unit` (FREE
 * TEXT, never validated), plus `point_radius_m` for point counts and
 * `width_m`/`length_m` on subplots. So the area has to be derived, and
 * sometimes cannot be derived at all.
 *
 * The governing rule here is that a wrong per-hectare figure is worse than no
 * per-hectare figure. A surveyor who types "10 m" for a 10 × 10 m plot has
 * written something this module cannot safely interpret — reading it as 10 m²
 * understates the area hundredfold and inflates every density by the same
 * factor, invisibly. So every path that cannot be resolved returns a REASON
 * the report can print, never a guess.
 *
 * Pure module — no DB / expo / `~/i18n` imports.
 */

export type PlotAreaSource = 'subplots' | 'point-radius' | 'sample-size';

export type PlotAreaReason =
  | 'no-sample-size'
  | 'unrecognised-unit'
  | 'non-positive'
  | 'subplot-dims-missing'
  | 'zero-radius';

export type PlotAreaResult =
  | { ok: true; areaM2: number; source: PlotAreaSource; matchedUnit: string | null }
  | { ok: false; reason: PlotAreaReason; rawUnit: string | null };

export type PlotAreaInput = {
  plotType: string;
  subplots: Array<{ width_m: number | null; length_m: number | null }>;
  pointRadiusM: number | null;
  sampleSizeValue: number | null;
  sampleSizeUnit: string | null;
};

/**
 * Area units accepted, mapped to square metres.
 *
 * Two deliberate refusals:
 *   - bare `m` / `cm` / `ft` — a LENGTH, not an area. This is the exact case
 *     ("10 m" for a 10 × 10 plot) where guessing is worst.
 *   - a lone `a`, even though `are` is accepted: a single letter is far more
 *     likely a stray keystroke than the unit 公畝.
 */
const AREA_UNITS: Array<{ toM2: number; canonical: string; forms: string[] }> = [
  { toM2: 1, canonical: 'm²', forms: ['m2', 'm²', '㎡', 'sqm', 'sqmeter', 'sqmetre', 'squaremeter', 'squaremetre', '平方公尺', '平方米'] },
  { toM2: 100, canonical: 'a', forms: ['are', 'ares', '公畝', 'アール'] },
  { toM2: 10000, canonical: 'ha', forms: ['ha', 'hectare', 'hectares', '公頃', 'ヘクタール'] },
  { toM2: 1_000_000, canonical: 'km²', forms: ['km2', 'km²', '平方公里', '平方千米', 'sqkm'] },
];

/** Normalise for matching: fold case, strip spaces/dots, map full-width ASCII
 *  and the superscript two to their plain forms. */
function normaliseUnit(unit: string): string {
  return unit
    .trim()
    .toLowerCase()
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s._-]/g, '');
}

export function parseAreaUnit(unit: string | null | undefined): { toM2: number; canonical: string } | null {
  if (!unit) return null;
  const n = normaliseUnit(unit);
  if (!n) return null;
  for (const u of AREA_UNITS) {
    if (u.forms.some((f) => normaliseUnit(f) === n)) return { toM2: u.toM2, canonical: u.canonical };
  }
  return null;
}

/**
 * Resolve the plot area, in precedence order:
 *
 *  1. Sum of subplot rectangles, when EVERY subplot has both dimensions — the
 *     most direct measurement available. A PARTIAL set is refused outright:
 *     summing only the sized ones under-reports the area and inflates every
 *     density, invisibly. Subplots with no dimensions at all are not a partial
 *     set, so those fall through to the plot-level size instead.
 *  2. πr² for a point count.
 *  3. `sample_size_value` with a whitelisted unit.
 *  4. Refuse, with the reason.
 */
export function resolvePlotArea(input: PlotAreaInput): PlotAreaResult {
  if (input.subplots.length > 0) {
    const sized = (s: { width_m: number | null; length_m: number | null }) =>
      s.width_m != null && s.length_m != null && s.width_m > 0 && s.length_m > 0;
    const withDims = input.subplots.filter(sized).length;
    if (withDims === input.subplots.length) {
      const areaM2 = input.subplots.reduce((sum, s) => sum + (s.width_m ?? 0) * (s.length_m ?? 0), 0);
      return { ok: true, areaM2, source: 'subplots', matchedUnit: 'm²' };
    }
    // SOME subplots sized and others not is the dangerous case: summing what
    // exists under-reports the area and inflates every density, with nothing
    // on the page to show it happened. Refuse.
    if (withDims > 0) return { ok: false, reason: 'subplot-dims-missing', rawUnit: null };
    // NONE sized carries no such risk — the subplots simply do not record
    // geometry, so fall through to the plot-level size below.
  }

  if (input.plotType === 'point_count') {
    const r = input.pointRadiusM;
    if (r == null || r <= 0) return { ok: false, reason: 'zero-radius', rawUnit: null };
    return { ok: true, areaM2: Math.PI * r * r, source: 'point-radius', matchedUnit: 'm²' };
  }

  const v = input.sampleSizeValue;
  if (v == null) return { ok: false, reason: 'no-sample-size', rawUnit: input.sampleSizeUnit ?? null };
  if (!(v > 0)) return { ok: false, reason: 'non-positive', rawUnit: input.sampleSizeUnit ?? null };
  const unit = parseAreaUnit(input.sampleSizeUnit);
  if (!unit) return { ok: false, reason: 'unrecognised-unit', rawUnit: input.sampleSizeUnit ?? null };
  return { ok: true, areaM2: v * unit.toM2, source: 'sample-size', matchedUnit: unit.canonical };
}

export const M2_PER_HA = 10000;
