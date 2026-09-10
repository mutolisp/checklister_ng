/**
 * Rarefaction, extrapolation and their confidence intervals.
 *
 * Formulas transcribed from Chao, Gotelli, Hsieh, Sander, Ma, Colwell &
 * Ellison (2014), "Rarefaction and extrapolation with Hill numbers",
 * Ecological Monographs 84:45–67, doi:10.1890/13-0133.1 — the same paper the
 * app's Chao estimators already cite — together with its Appendix G, obtained
 * from Ecological Archives M084-003-A7. Do NOT edit these from memory.
 *
 * The curve itself is ANALYTIC, not a resampling average: Table 1 (abundance)
 * and Table 2 (incidence) give minimum-variance-unbiased interpolation
 * estimators for q = 0. A random-accumulation curve would depend on the
 * shuffle; this one does not.
 *
 *   abundance, m < n:   D̂⁰(m) = S_obs − Σ_{Xᵢ} C(n−Xᵢ, m)/C(n, m)
 *   incidence, t < T:   Δ̂⁰(t) = S_obs − Σ_{Yᵢ} C(T−Yᵢ, t)/C(T, t)
 *
 * Extrapolation (Table 1 / Table 2), bounded at double the reference sample
 * because the paper marks it "reliable if m* < n" / "reliable if t* < T":
 *
 *   D̂⁰(n+m*) = S_obs + f̂₀[1 − (1 − f₁/(n·f̂₀ + f₁))^m*]
 *   Δ̂⁰(T+t*) = S_obs + Q̂₀[1 − (1 − Q₁/(T·Q̂₀ + Q₁))^t*]
 *
 * Confidence intervals come from Appendix G's BOOTSTRAP, which is the paper's
 * own recommendation: "extending this analytic approach for variance
 * estimators to a general order of q becomes mathematically intractable.
 * Therefore, we suggest a simpler, bootstrap method (Appendix G), to obtain
 * unconditional variances and confidence intervals". The interval is
 * unconditional — it describes another sample drawn from the assemblage, not
 * resampling within this one — which is the variance a reader needs.
 *
 * The RNG is seeded from the data, so the same records always produce the same
 * interval. A report exported twice must not disagree with itself.
 *
 * Pure module — no DB / expo / `~/i18n` imports.
 */
import { speciesKey, type DiversityRecord } from './diversity';
import { kindForType } from './dwcAbundanceCore';

/** Appendix G uses B = 200 and states that "a replication size of 200 is
 *  sufficient to obtain stable variance estimates and confidence intervals". */
const DEFAULT_REPLICATES = 200;

/** Table 1/Table 2 mark extrapolation "reliable if m* < n" (resp. t* < T), so
 *  the curve stops at double the reference sample. */
const EXTRAPOLATION_FACTOR = 2;

/** Points on the curve; a long reference sample is thinned to keep the chart
 *  and the bootstrap affordable on a phone. */
const MAX_POINTS = 40;

// ── numerics ────────────────────────────────────────────────────────────────

/** Lanczos log-gamma. `C(n−Xᵢ, m)/C(n, m)` overflows doubles for even modest
 *  individual counts, so the ratio is computed in log space throughout. */
const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i += 1) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log C(n, k); −Infinity when the choice is impossible. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Deterministic RNG (xorshift32). Seeded from the data so a report exported
 *  twice gives the same interval. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

// ── frequency counts ────────────────────────────────────────────────────────

/** Individual counts per species; null when any quantified record is not a
 *  count, because a Braun-Blanquet midpoint is not an individual. */
function abundanceCounts(records: DiversityRecord[]): number[] | null {
  const byKey = new Map<string, number>();
  let sawQuantity = false;
  for (const r of records) {
    const q = r.organism_quantity;
    if (q == null || q === '') continue;
    if (kindForType(r.organism_quantity_type) !== 'count') return null;
    const n = Number(q);
    if (!Number.isFinite(n) || n < 0) return null;
    sawQuantity = true;
    const k = speciesKey(r);
    byKey.set(k, (byKey.get(k) ?? 0) + n);
  }
  if (!sawQuantity) return null;
  return [...byKey.values()].map((v) => Math.round(v)).filter((v) => v > 0);
}

/** Incidence counts Yᵢ: in how many of the given units each species occurs. */
function incidenceCounts(records: DiversityRecord[], unitIds: number[]): number[] {
  const units = new Set(unitIds);
  const bySpecies = new Map<string, Set<number>>();
  for (const r of records) {
    const u = r.subplot_id;
    if (u == null || !units.has(u)) continue;
    const k = speciesKey(r);
    const cur = bySpecies.get(k);
    if (cur) cur.add(u);
    else bySpecies.set(k, new Set([u]));
  }
  return [...bySpecies.values()].map((s) => s.size).filter((n) => n > 0);
}

const countOf = (freqs: number[], k: number) => freqs.filter((f) => f === k).length;

// ── analytic curves ─────────────────────────────────────────────────────────

/**
 * Interpolated richness at sample size `m`, from frequency counts.
 * Works for both bases: pass individual counts with `total = n`, or incidence
 * counts with `total = T`.
 */
function interpolate(freqs: number[], total: number, m: number): number {
  const sObs = freqs.length;
  if (m >= total) return sObs;
  let sum = 0;
  const logDen = logChoose(total, m);
  for (const f of freqs) {
    const logNum = logChoose(total - f, m);
    if (logNum === -Infinity) continue;
    sum += Math.exp(logNum - logDen);
  }
  return sObs - sum;
}

/** Undetected-species predictor used by BOTH the extrapolation and the
 *  bootstrap assemblage. Appendix G's f̂₀ carries the (n−1)/n correction; note
 *  this is NOT the app's reported Chao1, which follows vegan's `estimateR` in
 *  omitting it for the abundance case. Two different jobs, two formulas. */
function undetected(freqs: number[], total: number): number {
  const f1 = countOf(freqs, 1);
  const f2 = countOf(freqs, 2);
  const c = (total - 1) / total;
  return f2 > 0 ? (c * f1 * f1) / (2 * f2) : (c * f1 * (f1 - 1)) / 2;
}

/** Extrapolated richness `steps` beyond the reference sample. */
function extrapolate(freqs: number[], total: number, steps: number): number {
  const sObs = freqs.length;
  const f1 = countOf(freqs, 1);
  const f0 = undetected(freqs, total);
  if (f0 <= 0 || f1 <= 0) return sObs;
  return sObs + f0 * (1 - Math.pow(1 - f1 / (total * f0 + f1), steps));
}

/**
 * Sample coverage of the reference sample (Chao & Jost 2012, quoted in
 * Appendix G). More accurate than the Good–Turing 1 − f₁/n the app reports
 * elsewhere, so it is offered alongside rather than replacing it.
 *
 * `unitTotal` is n for abundance; for incidence it is U, the total number of
 * incidences, while `total` stays T.
 */
export function sampleCoverage(freqs: number[], total: number, unitTotal: number): number | null {
  const f1 = countOf(freqs, 1);
  const f2 = countOf(freqs, 2);
  if (unitTotal <= 0) return null;
  if (f1 === 0) return 1;
  const num = (total - 1) * f1;
  const den = f2 > 0 ? num + 2 * f2 : (total - 1) * (f1 - 1) + 2;
  const top = f2 > 0 ? num : (total - 1) * (f1 - 1);
  if (den <= 0) return null;
  return 1 - (f1 / unitTotal) * (top / den);
}

// ── bootstrap (Appendix G) ──────────────────────────────────────────────────

/**
 * The "bootstrap assemblage": detected species with their tuned probabilities
 * plus f̂₀* undetected species sharing the uncovered probability equally.
 *
 * Detected species are tuned because the raw Xᵢ/n over-estimates pᵢ (Appendix
 * G shows E[Xᵢ/n | Xᵢ>0] > pᵢ):
 *   p̂ᵢ = (Xᵢ/n)[1 − λ̂(1 − Xᵢ/n)ⁿ],  λ̂ = (1 − Ĉ)/Σ(Xᵢ/n)(1 − Xᵢ/n)ⁿ
 */
function bootstrapAssemblage(freqs: number[], total: number, unitTotal: number): number[] {
  const coverage = sampleCoverage(freqs, total, unitTotal) ?? 1;
  const uncovered = Math.max(0, 1 - coverage);
  const props = freqs.map((f) => f / total);
  let denom = 0;
  for (const p of props) denom += p * Math.pow(1 - p, total);
  const lambda = denom > 0 ? uncovered / denom : 0;
  const tuned = props.map((p) => p * (1 - lambda * Math.pow(1 - p, total)));

  const f0 = Math.ceil(Math.max(0, undetected(freqs, total)));
  if (f0 > 0 && uncovered > 0) {
    const each = uncovered / f0;
    for (let i = 0; i < f0; i += 1) tuned.push(each);
  }
  return tuned;
}

/** Multinomial draw of `n` individuals over `probs`, returning the non-zero
 *  frequency counts of the generated sample. */
function drawAbundance(probs: number[], n: number, rng: () => number): number[] {
  const cum: number[] = [];
  let acc = 0;
  for (const p of probs) {
    acc += p;
    cum.push(acc);
  }
  const total = acc > 0 ? acc : 1;
  const counts = new Array<number>(probs.length).fill(0);
  for (let i = 0; i < n; i += 1) {
    const x = rng() * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    counts[lo] += 1;
  }
  return counts.filter((c) => c > 0);
}

/** T independent Bernoulli units over the assemblage's incidence
 *  probabilities, returning the generated Yᵢ. */
function drawIncidence(probs: number[], t: number, rng: () => number): number[] {
  const counts = new Array<number>(probs.length).fill(0);
  for (let u = 0; u < t; u += 1) {
    for (let i = 0; i < probs.length; i += 1) {
      if (rng() < probs[i]) counts[i] += 1;
    }
  }
  return counts.filter((c) => c > 0);
}

// ── public API ──────────────────────────────────────────────────────────────

export type CurvePoint = {
  /** Sample size: individuals for the abundance basis, units for incidence. */
  size: number;
  richness: number;
  /** 95% bootstrap interval; absent when the bootstrap was not run. */
  lo?: number;
  hi?: number;
  /** True beyond the reference sample. */
  extrapolated: boolean;
};

export type RarefactionCurve = {
  applicable: true;
  basis: 'abundance' | 'incidence';
  /** n (individuals) or T (units). */
  reference: number;
  observed: number;
  coverage: number | null;
  points: CurvePoint[];
  replicates: number;
};

export type RarefactionRefusal = {
  applicable: false;
  reason: 'not-counts' | 'need-2-units' | 'too-few-species' | 'empty';
};

export type RarefactionResult = RarefactionCurve | RarefactionRefusal;

type Options = { replicates?: number; extrapolate?: boolean };

/** Seed from the data, so the interval is reproducible across exports. */
function seedFrom(freqs: number[], total: number): number {
  let h = 2166136261 ^ total;
  for (const f of freqs) {
    h = Math.imul(h ^ f, 16777619);
  }
  return h >>> 0;
}

/** The sizes to evaluate: every step for a small reference sample, thinned to
 *  `MAX_POINTS` for a large one, always including the reference size itself. */
function sampleSizes(reference: number, maxSize: number): number[] {
  const step = Math.max(1, Math.ceil(maxSize / MAX_POINTS));
  const sizes = new Set<number>([1, reference, maxSize]);
  for (let s = step; s <= maxSize; s += step) sizes.add(s);
  return [...sizes].filter((s) => s >= 1).sort((a, b) => a - b);
}

function buildCurve(
  freqs: number[],
  total: number,
  unitTotal: number,
  basis: 'abundance' | 'incidence',
  opts: Options,
): RarefactionResult {
  if (freqs.length === 0 || total <= 0) return { applicable: false, reason: 'empty' };
  if (freqs.length < 2) return { applicable: false, reason: 'too-few-species' };

  const replicates = opts.replicates ?? DEFAULT_REPLICATES;
  const wantExtrapolation = opts.extrapolate !== false;
  const maxSize = wantExtrapolation ? total * EXTRAPOLATION_FACTOR : total;
  const sizes = sampleSizes(total, maxSize);

  const value = (f: number[], tot: number, size: number): number =>
    size <= tot ? interpolate(f, tot, size) : extrapolate(f, tot, size - tot);

  const points: CurvePoint[] = sizes.map((size) => ({
    size,
    richness: value(freqs, total, size),
    extrapolated: size > total,
  }));

  if (replicates > 0) {
    const probs = bootstrapAssemblage(freqs, total, unitTotal);
    const rng = makeRng(seedFrom(freqs, total));
    const samples: number[][] = sizes.map(() => []);
    for (let b = 0; b < replicates; b += 1) {
      const gen =
        basis === 'abundance' ? drawAbundance(probs, total, rng) : drawIncidence(probs, total, rng);
      if (gen.length === 0) continue;
      sizes.forEach((size, i) => samples[i].push(value(gen, total, size)));
    }
    points.forEach((p, i) => {
      const xs = samples[i];
      if (xs.length < 2) return;
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      const varr = xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (xs.length - 1);
      const se = Math.sqrt(Math.max(0, varr));
      // Appendix G: "the bootstrap s.e. … is then used to construct a 95%
      // confidence interval D̂(m) ± 1.96 s.e." The lower bound is clamped at
      // zero; a negative species count is not a thing.
      p.lo = Math.max(0, p.richness - 1.96 * se);
      p.hi = p.richness + 1.96 * se;
    });
  }

  return {
    applicable: true,
    basis,
    reference: total,
    observed: freqs.length,
    coverage: sampleCoverage(freqs, total, unitTotal),
    points,
    replicates,
  };
}

/** Individual-based rarefaction. Refuses unless every quantified record is a
 *  count — a cover value has no "individuals" to rarefy. */
export function abundanceRarefaction(
  records: DiversityRecord[],
  opts: Options = {},
): RarefactionResult {
  const counts = abundanceCounts(records);
  if (!counts) return { applicable: false, reason: 'not-counts' };
  const n = counts.reduce((s, c) => s + c, 0);
  return buildCurve(counts, n, n, 'abundance', opts);
}

/** Sample-based rarefaction over sampling units (subplots, or plots within a
 *  project). Needs at least two units for the curve to say anything. */
export function incidenceRarefaction(
  records: DiversityRecord[],
  unitIds: number[],
  opts: Options = {},
): RarefactionResult {
  if (unitIds.length < 2) return { applicable: false, reason: 'need-2-units' };
  const y = incidenceCounts(records, unitIds);
  const u = y.reduce((s, c) => s + c, 0);
  return buildCurve(y, unitIds.length, u, 'incidence', opts);
}

/** Exported for the check script: the analytic pieces, without the bootstrap. */
export const __internals = { interpolate, extrapolate, logChoose, undetected };
