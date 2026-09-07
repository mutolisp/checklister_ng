/**
 * Fixture check for src/lib/diversity.ts — the formulas were verified against
 * vegan's docs and Chao et al. 2014 (see the module header); these fixtures
 * pin the implementation to hand-computed values so a later edit can't drift
 * silently. Run: npm run check:diversity
 */
import {
  betaSimilarity,
  chao1,
  chao2,
  computeDiversity,
  relativeFrequency,
  speciesKey,
} from '../src/lib/diversity.ts';

let failures = 0;
const fail = (m) => {
  failures += 1;
  console.error(`  ✗ ${m}`);
};
const close = (label, got, want, eps = 1e-9) => {
  if (got == null || Math.abs(got - want) > eps) fail(`${label}: got ${got}, expected ${want}`);
};
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
};

const count = (taxon, n, subplot = null) => ({
  taxon_id: taxon,
  organism_quantity: String(n),
  organism_quantity_type: 'individuals',
  subplot_id: subplot,
});
const bb = (taxon, code) => ({
  taxon_id: taxon,
  organism_quantity: code,
  organism_quantity_type: 'Braun-Blanquet Scale',
  subplot_id: null,
});

// ── Shannon / Simpson: 4 equally-abundant species → H′ = ln 4, D = 0.25 ──
{
  const d = computeDiversity([count('t1', 5), count('t2', 5), count('t3', 5), count('t4', 5)]);
  eq('richness', d.richness, 4);
  close('H′ equal-4', d.shannonH, Math.log(4));
  close('exp(H′) = 4 effective species', d.shannonDiversity, 4);
  close('D equal-4', d.simpsonD, 0.25);
  close('1−D', d.simpson1mD, 0.75);
  close('1/D', d.invSimpson, 4);
  eq('basis count', d.basis, 'count');
  eq('not lossy', d.lossy, false);
}

// ── Pielou J′ ──
{
  const eq4 = computeDiversity([count('t1', 5), count('t2', 5), count('t3', 5), count('t4', 5)]);
  close('J′ = 1 when perfectly even', eq4.pielouJ, 1);
  const uneven = computeDiversity([count('t1', 1), count('t2', 9)]);
  const h = -(0.1 * Math.log(0.1) + 0.9 * Math.log(0.9));
  close('J′ = H′/ln S', uneven.pielouJ, h / Math.log(2));
  const single = computeDiversity([count('t1', 7)]);
  eq('J′ null when S = 1', single.pielouJ, null);
}

// ── Dominance: Berger–Parker d = max(pᵢ) ──
{
  // counts 10,5,3,2 → total 20 → shares .50 .25 .15 .10
  const d = computeDiversity([count('t1', 10), count('t2', 5), count('t3', 3), count('t4', 2)]);
  close('Berger–Parker d = max share', d.bergerParker, 0.5);
  close('Hill ∞ = 1/d', 1 / d.bergerParker, 2);
  eq('dominants sorted desc', d.dominants.map((x) => x.key), [
    't1|', 't2|', 't3|', 't4|',
  ]);
  close('top share', d.dominants[0].share, 0.5);
  close('second share', d.dominants[1].share, 0.25);
  close('shares sum to 1', d.dominants.reduce((a, b) => a + b.share, 0), 1);
  // Perfectly even → d = 1/S
  const even = computeDiversity([count('a', 5), count('b', 5), count('c', 5), count('d', 5)]);
  close('even → d = 1/S', even.bergerParker, 0.25);
  // BB basis: 2→15, 5→88 → d = 88/103
  const bbD = computeDiversity([bb('t1', '2'), bb('t2', '5')]);
  close('BB basis d', bbD.bergerParker, 88 / 103);
  eq('BB dominant is the higher cover', bbD.dominants[0].key, 't2|');
  // Nothing quantified → null, empty list
  const none = computeDiversity([
    { taxon_id: 'z', organism_quantity: null, organism_quantity_type: null, subplot_id: null },
  ]);
  eq('no quantities → d null', none.bergerParker, null);
  eq('no quantities → no dominants', none.dominants.length, 0);
}

// ── Relative frequency (IVI frequency component) ──
{
  const recs = [
    count('t1', 1, 11), count('t1', 1, 12), // 2 of 3 units
    count('t2', 1, 11), count('t2', 1, 12), count('t2', 1, 13), // all 3
    count('t3', 1, 13), // 1 of 3
  ];
  const f = relativeFrequency(recs, [11, 12, 13]);
  close('freq 2/3', f.get('t1|'), 2 / 3);
  close('freq 3/3', f.get('t2|'), 1);
  close('freq 1/3', f.get('t3|'), 1 / 3);
  // repeated records in the SAME unit count once
  const dup = relativeFrequency(
    [count('t1', 1, 11), count('t1', 9, 11), count('t2', 1, 12)],
    [11, 12],
  );
  close('duplicate in one unit counts once', dup.get('t1|'), 0.5);
  eq('fewer than 2 units → empty', relativeFrequency(recs, [11]).size, 0);
  eq('speciesKey helper', speciesKey({ taxon_id: 'q', used_scientific_name: 'A b' }), 'q|A b');
}

// ── β similarity (Sørensen / Jaccard) ──
{
  const A = [count('x', 1), count('y', 1), count('z', 1)];
  const B = [count('y', 2), count('z', 3), count('w', 1)];
  const r = betaSimilarity(A, B);
  eq('shared C', r.shared, 2);
  eq('onlyA', r.onlyA, 1);
  eq('onlyB', r.onlyB, 1);
  close('Sørensen 2C/(A+B) = 4/6', r.sorensen, 4 / 6);
  close('Jaccard C/(A+B−C) = 2/4', r.jaccard, 0.5);
  const same = betaSimilarity(A, A);
  close('identical → Sørensen 1', same.sorensen, 1);
  close('identical → Jaccard 1', same.jaccard, 1);
  const disjoint = betaSimilarity(A, [count('q', 1)]);
  close('disjoint → Sørensen 0', disjoint.sorensen, 0);
  close('disjoint → Jaccard 0', disjoint.jaccard, 0);
  const empty = betaSimilarity([], []);
  close('empty → 0', empty.sorensen, 0);
  close('empty → 0 (jaccard)', empty.jaccard, 0);
}

// ── Hand-computed unequal case: counts 1, 9 → p = 0.1/0.9 ──
{
  const d = computeDiversity([count('t1', 1), count('t2', 9)]);
  close('H′ 0.1/0.9', d.shannonH, -(0.1 * Math.log(0.1) + 0.9 * Math.log(0.9)));
  close('D 0.1/0.9', d.simpsonD, 0.01 + 0.81);
}

// ── BB basis uses the settled cover midpoints (2→15, 5→88) ──
{
  const d = computeDiversity([bb('t1', '2'), bb('t2', '5')]);
  const p1 = 15 / 103;
  const p2 = 88 / 103;
  close('H′ from BB midpoints', d.shannonH, -(p1 * Math.log(p1) + p2 * Math.log(p2)));
  eq('basis BB', d.basis, 'BB');
}

// ── Same species across layers: BB takes MAX (merged-matrix rule) ──
{
  const d = computeDiversity([bb('t1', '2'), bb('t1', '4'), bb('t2', '2')]);
  eq('richness dedupes species', d.richness, 2);
  const p1 = 63 / 78; // BB 4 → 63 beats BB 2 → 15
  const p2 = 15 / 78;
  close('cross-layer BB max', d.shannonH, -(p1 * Math.log(p1) + p2 * Math.log(p2)));
}

// ── Mixed kinds flagged ──
{
  const d = computeDiversity([bb('t1', '2'), count('t2', 3)]);
  eq('mixed basis', d.basis, 'mixed');
  eq('mixed is lossy', d.lossy, true);
}

// ── Chao1 classic: S0=4, f1=2 (t1,t2), f2=1 (t3) → 4 + 4/2 = 6 ──
{
  const r = chao1([count('t1', 1), count('t2', 1), count('t3', 2), count('t4', 5)]);
  if (!r.applicable) fail('chao1 should apply to pure counts');
  else {
    eq('chao1 f1', r.f1, 2);
    eq('chao1 f2', r.f2, 1);
    close('chao1 classic', r.estimate, 6);
    eq('chao1 not bias-corrected', r.biasCorrected, false);
    // n = 9, C = 1 − 2/9
    close('coverage', r.coverage, 1 - 2 / 9);
    close('completeness', r.completeness, 4 / 6);
  }
}

// ── Chao1 bias-corrected when f2 = 0: S0=3, f1=2 → 3 + 2·1/2 = 4 ──
{
  const r = chao1([count('t1', 1), count('t2', 1), count('t3', 5)]);
  if (!r.applicable) fail('chao1 bc should apply');
  else {
    eq('chao1 bc flag', r.biasCorrected, true);
    close('chao1 bias-corrected', r.estimate, 4);
  }
}

// ── Chao1 refuses non-count data ──
{
  const r = chao1([bb('t1', '2'), count('t2', 3)]);
  eq('chao1 mixed → inapplicable', r.applicable, false);
  const r2 = chao1([bb('t1', '2')]);
  eq('chao1 BB-only → inapplicable', r2.applicable, false);
}

// ── Chao2 over 3 subplots: q1=2, q2=1, S0=4 → 4 + (4/2)·(2/3) = 16/3 ──
{
  const recs = [
    count('t1', 1, 11), // only subplot 11
    count('t2', 1, 12), // only subplot 12
    count('t3', 1, 11),
    count('t3', 2, 12), // two subplots
    count('t4', 1, 11),
    count('t4', 1, 12),
    count('t4', 1, 13), // three subplots
  ];
  const r = chao2(recs, [11, 12, 13]);
  if (!r.applicable) fail('chao2 should apply with 3 subplots');
  else {
    eq('chao2 q1', r.q1, 2);
    eq('chao2 q2', r.q2, 1);
    close('chao2 classic with (N−1)/N', r.estimate, 4 + (4 / 2) * (2 / 3));
    close('chao2 completeness', r.completeness, 4 / (4 + (4 / 2) * (2 / 3)));
  }
}

// ── Chao2 bias-corrected when q2 = 0: S0=2, q1=2, N=2 → 2 + (2·1/2)·(1/2) = 2.5 ──
{
  const recs = [count('t1', 1, 11), count('t2', 1, 12)];
  const r = chao2(recs, [11, 12]);
  if (!r.applicable) fail('chao2 bc should apply');
  else {
    eq('chao2 bc flag', r.biasCorrected, true);
    close('chao2 bias-corrected', r.estimate, 2.5);
  }
}

// ── Chao2 needs ≥2 subplots; null-subplot records carry no incidence ──
{
  eq('chao2 one unit → inapplicable', chao2([count('t1', 1, 11)], [11]).applicable, false);
  const r = chao2([count('t1', 1, null)], [11, 12]);
  eq('chao2 null-subplot only → empty', r.applicable, false);
}

// ── v28 composite key: same taxon under two used names = two species ──
{
  const d = computeDiversity([
    { taxon_id: 't9', used_scientific_name: 'A b', organism_quantity: '1', organism_quantity_type: 'individuals', subplot_id: null },
    { taxon_id: 't9', used_scientific_name: 'A c', organism_quantity: '1', organism_quantity_type: 'individuals', subplot_id: null },
  ]);
  eq('composite key richness', d.richness, 2);
}

if (failures > 0) {
  console.error(`check-diversity: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-diversity: all assertions passed');
