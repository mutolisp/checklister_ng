/**
 * Fixture check for the report pipeline (`src/lib/reportStats.ts`,
 * `src/lib/reportModel.ts`).
 *
 * What this is defending: the report is the one place where a wrong number is
 * invisible — a table of plausible-looking figures does not crash, it just
 * misinforms. So the assertions below pin (a) the new statistics against hand
 * computations, and (b) the report model against `diversity.ts` called
 * directly, so the document can never drift from the card the user saw.
 *
 * The DOCX block at the end guards a different failure: a malformed OOXML
 * package is WORSE than a missing feature, because Word refuses the whole
 * document rather than one chart. So it unzips the real output and checks the
 * package holds together — every relationship resolves to a part that exists,
 * every part is declared in [Content_Types].xml, and the drawing sits where
 * the schema puts it.
 *
 * Run: npm run check:report
 */
import {
  conservationTally,
  groundCoverBudget,
  layerProfile,
  pointCountEffort,
  taxonComposition,
  transectEffort,
} from '../src/lib/reportStats.ts';
import {
  buildPlotReport,
  buildProjectReport,
  buildSessionReport,
} from '../src/lib/reportModel.ts';
import { conservationSection } from '../src/lib/reportSections.ts';
import { parseAreaUnit, resolvePlotArea } from '../src/lib/plotArea.ts';
import { abundanceText } from '../src/lib/reportFormat.ts';
import { groupRecords, taxonGroupOf } from '../src/lib/taxonGroup.ts';
import { compareCells } from '../src/lib/reportSort.ts';
import { dataQuality, normaliseRank } from '../src/lib/dataQuality.ts';
import {
  abundanceRarefaction,
  incidenceRarefaction,
  sampleCoverage,
  __internals as rare,
} from '../src/lib/rarefaction.ts';
import { conservationSpeciesSection } from '../src/lib/reportSections.ts';
import { scientificNameMd, stripNameMd } from '../src/lib/scientificNameSegments.ts';
import {
  asStemCounts,
  dbhDistribution,
  importanceValue,
  iviRelativeFrequency,
  standDensity,
} from '../src/lib/standStructure.ts';
import { relativeFrequency } from '../src/lib/diversity.ts';
import { betaSimilarity, computeDiversity, chao1, chao2 } from '../src/lib/diversity.ts';
import { buildReportHtml } from '../src/lib/reportHtml.ts';
import { CHART_PRIMARY, CHART_SECONDARY, withHash } from '../src/lib/reportTheme.ts';
import { buildReportDocx } from '../src/lib/reportDocx.ts';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync, readdirSync } from 'node:fs';

let failures = 0;
const fail = (m) => {
  failures += 1;
  console.error(`  ✗ ${m}`);
};
const eq = (label, got, want) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fail(`${label}: got ${a}, expected ${b}`);
};
const close = (label, got, want, eps = 1e-9) => {
  if (got == null || Math.abs(got - want) > eps) fail(`${label}: got ${got}, expected ${want}`);
};
const ok = (label, cond) => {
  if (!cond) fail(label);
};

/**
 * Identity translator: always returns the key, so assertions match on keys
 * rather than on any one language. `defaultValue` is deliberately ignored —
 * in production i18next only falls back to it when the key is MISSING, and
 * every key the model uses exists, so returning the key is the faithful
 * model of the normal path.
 */
const t = (k) => k;

const sp = (taxon, over = {}) => ({
  taxon_id: taxon,
  organism_quantity: '1',
  organism_quantity_type: 'individuals',
  subplot_id: null,
  simple_name: `Genus ${taxon}`,
  family: 'Fagaceae',
  ...over,
});

// ── taxonComposition: counts SPECIES, not records ──────────────────────────
{
  const recs = [
    sp('a', { family: 'Fagaceae', family_c: '殼斗科' }),
    sp('a', { family: 'Fagaceae', family_c: '殼斗科', layer: 'E5' }), // same species again
    sp('b', { family: 'Fagaceae', family_c: '殼斗科' }),
    sp('c', { family: 'Poaceae', family_c: '禾本科' }),
  ];
  const comp = taxonComposition(recs, 'family');
  eq('composition counts species not records', comp, [
    { name: 'Fagaceae', nameLocal: '殼斗科', count: 2 },
    { name: 'Poaceae', nameLocal: '禾本科', count: 1 },
  ]);
  eq('blank family dropped', taxonComposition([sp('x', { family: '' })], 'family'), []);
}

// ── conservationTally: safe categories dropped, species-level ──────────────
{
  const recs = [
    sp('a', { is_endemic: 'true', redlist: 'VU', iucn: 'LC', alien_type: 'native' }),
    sp('a', { is_endemic: 'true', redlist: 'VU', iucn: 'LC', alien_type: 'native' }), // dup
    sp('b', { redlist: 'LC', cites: 'II', protected: 'II', alien_type: 'naturalized' }),
    sp('c', { redlist: 'NLC', iucn: 'EN' }),
  ];
  const c = conservationTally(recs);
  eq('tally total is distinct species', c.total, 3);
  eq('endemic counted once', c.endemic, 1);
  eq('redlist drops LC/NLC', c.redlist, [{ code: 'VU', count: 1 }]);
  eq('iucn drops LC, keeps EN', c.iucn, [{ code: 'EN', count: 1 }]);
  eq('cites keeps any value', c.cites, [{ code: 'II', count: 1 }]);
  eq('protected kept', c.protected, [{ code: 'II', count: 1 }]);
  eq('alien not filtered', c.alien, [
    { code: 'native', kingdom: '', count: 1 },
    { code: 'naturalized', kingdom: '', count: 1 },
  ]);

  // 'cultured' means captive for an animal and cultivated for a plant. The
  // tally used to pick ONE kingdom for the whole record set, so a mixed
  // dataset labelled every row after whichever record happened to come first.
  const mixedKingdom = conservationTally([
    sp('x', { alien_type: 'cultured', kingdom: 'Animalia' }),
    sp('y', { alien_type: 'cultured', kingdom: 'Plantae' }),
    sp('z', { alien_type: 'native', kingdom: 'Plantae' }),
  ]);
  eq('cultured is split by kingdom', mixedKingdom.alien, [
    { code: 'cultured', kingdom: 'Animalia', count: 1 },
    { code: 'cultured', kingdom: 'Plantae', count: 1 },
    { code: 'native', kingdom: 'Plantae', count: 1 },
  ]);
  const mixedSection = conservationSection(
    [
      sp('x', { alien_type: 'cultured', kingdom: 'Animalia' }),
      sp('y', { alien_type: 'cultured', kingdom: 'Plantae' }),
    ],
    t,
  );
  const labels = mixedSection.table.rows.map((r) => r[0]);
  ok('captive row present', labels.includes('alien.captive'));
  ok('cultivated row present', labels.includes('alien.cultivated'));
}

// ── layerProfile: richness per layer, unused layers dropped ────────────────
{
  const layers = [
    { layer_index: 1, cover_pct: 10, height_cm: 5, method: 'BB' },
    { layer_index: 2, cover_pct: 60, height_cm: 80, method: 'BB' },
    { layer_index: 5, cover_pct: null, height_cm: null, method: 'DBH' }, // unused
  ];
  const recs = [
    sp('a', { layer: 'E2' }),
    sp('b', { layer: 'E2' }),
    sp('a', { layer: 'E1' }), // same species, other layer
  ];
  const prof = layerProfile(layers, recs);
  eq('unused empty layer dropped', prof.length, 2);
  eq('E1 richness', prof[0].richness, 1);
  eq('E2 richness counts distinct species', prof[1].richness, 2);
  eq('layer key', prof[1].layer, 'E2');
  // A layer with no config but with records must survive.
  const prof2 = layerProfile([{ layer_index: 5, cover_pct: null, height_cm: null }], [
    sp('z', { layer: 'E5' }),
  ]);
  eq('layer kept when it has records', prof2.length, 1);
}

// ── transectEffort ─────────────────────────────────────────────────────────
{
  // Two points ~111.19 m apart in latitude at the equator (0.001°).
  const seg = [[[121.0, 0.0], [121.0, 0.001]]];
  const e = transectEffort(seg, [sp('a'), sp('b')]);
  ok('track length ~111 m', Math.abs(e.lengthM - 111.19) < 1);
  eq('transect richness', e.richness, 2);
  close('species per km', e.speciesPerKm, 2 / (e.lengthM / 1000), 1e-6);
  // A degenerate track must not produce an exploding ratio.
  eq('too-short track → null', transectEffort([[[121, 0], [121, 0]]], [sp('a')]).speciesPerKm, null);
}

// ── pointCountEffort ───────────────────────────────────────────────────────
{
  const recs = [
    sp('a', { organism_quantity: '3', detection_type: 'seen' }),
    sp('b', { organism_quantity: '2', detection_type: 'heard' }),
    sp('c', { organism_quantity: '5', detection_type: 'seen' }),
  ];
  const e = pointCountEffort(25, recs);
  close('area = πr²', e.areaM2, Math.PI * 625, 1e-9);
  close('area in ha', e.areaHa, (Math.PI * 625) / 10000, 1e-12);
  eq('individuals summed', e.individuals, 10);
  close('density per ha', e.densityPerHa, 10 / ((Math.PI * 625) / 10000), 1e-9);
  eq('detection tally sorted desc', e.detection, [
    { code: 'seen', count: 2 },
    { code: 'heard', count: 1 },
  ]);
  // Cover data has no individuals — density must refuse rather than invent one.
  const bb = pointCountEffort(25, [
    { taxon_id: 'x', organism_quantity: '3', organism_quantity_type: 'Braun-Blanquet Scale' },
  ]);
  eq('non-count data → individuals null', bb.individuals, null);
  eq('non-count data → density null', bb.densityPerHa, null);
  eq('no radius → area null', pointCountEffort(null, recs).areaM2, null);
}

// ── groundCoverBudget ──────────────────────────────────────────────────────
{
  const b = groundCoverBudget({
    rock_cover_pct: 40,
    gravel_cover_pct: 30,
    bareland_cover_pct: 20,
    litter_cover_pct: 20,
    vascular_cover_pct: 80,
    total_cover_pct: 85,
  });
  close('surface total sums only surface fractions', b.surfaceTotal, 110);
  eq('over 100 flagged', b.surfaceOver100, true);
  eq('living cover listed but not summed', b.rows.length, 5);
  eq('total cover passed through', b.totalCoverPct, 85);
  const empty = groundCoverBudget({});
  eq('no data → null total', empty.surfaceTotal, null);
  eq('no data → not flagged', empty.surfaceOver100, false);
}

// ── buildPlotReport: structure + agreement with diversity.ts ───────────────
const plot = {
  id: 1,
  plotid: 'P-01',
  plot_type: 'fixed',
  status: 'done',
  start_ts: Date.UTC(2026, 0, 2, 1, 0),
  stop_ts: Date.UTC(2026, 0, 2, 2, 30),
  decimal_latitude: 24.5,
  decimal_longitude: 121.5,
  coord_uncertainty_m: null, // hand-placed
  sample_size_value: 100,
  sample_size_unit: 'm²',
  sampling_protocol: 'Braun-Blanquet',
  point_radius_m: null,
  recorded_by: 'A. Botanist',
  locality: 'Test ridge',
  field_note: null,
  elevation_m: 1200,
  slope_deg: 25,
  aspect_deg: 180,
  terrain_position: 'ridge',
  total_cover_pct: 90,
  rock_cover_pct: 10,
  gravel_cover_pct: null,
  bareland_cover_pct: 5,
  litter_cover_pct: 60,
  vascular_cover_pct: 85,
  bryophyte_cover_pct: null,
  lichen_cover_pct: null,
};
const species = [
  sp('a', { layer: 'E5', organism_quantity: '10', subplot_id: 11, family: 'Fagaceae' }),
  sp('b', { layer: 'E5', organism_quantity: '5', subplot_id: 11, family: 'Fagaceae' }),
  sp('c', { layer: 'E2', organism_quantity: '3', subplot_id: 12, family: 'Poaceae' }),
  sp('d', { layer: 'E2', organism_quantity: '2', subplot_id: 12, family: 'Poaceae' }),
];
const report = buildPlotReport(
  {
    plot,
    projectName: 'Test project',
    layers: [
      { layer_index: 2, cover_pct: 40, height_cm: 60, method: 'BB', height_unit: 'cm' },
      { layer_index: 5, cover_pct: 70, height_cm: 1500, method: 'DBH', height_unit: 'm' },
    ],
    subplots: [
      { id: 11, label: 'S1', width_m: 10, length_m: 10 },
      { id: 12, label: 'S2', width_m: 10, length_m: 10 },
    ],
    species,
    trackSegments: [],
  },
  t,
);

{
  eq('report kind', report.kind, 'plot');
  const ids = report.sections.map((s) => s.id);
  eq('section order', ids, [
    'basics',
    'environment',
    'layers',
    'species',
    'diversity',
    'dominants',
    'rankAbundance',
    // Stand structure sits between the relative summary and the effort
    // estimate: same question, area basis instead of a relative one.
    'stand',
    'ivi',
    'effort',
    'rarefaction',
    'composition',
    'subplots',
    'dataQuality',
    'methods',
  ]);
  // This fixture records individual counts, not DBH — so density is reported
  // but basal area is NOT, because it was never measured. Printing 0 m²/ha
  // would read as a finding rather than as an absence.
  const standSec = report.sections.find((s) => s.id === 'stand');
  const standLabels = standSec.table.rows.map((r) => r[0]);
  ok('count data gives individuals per hectare', standLabels.includes('report.individualsPerHa'));
  ok('and no basal area', !standLabels.includes('report.basalAreaM2PerHa'));
  ok('no diameter classes without DBH', !ids.includes('dbhClasses'));
  ok('has subplot section', ids.includes('subplots'));
  ok('no transect section on a fixed plot', !ids.includes('transect'));
  ok('no point-count section on a fixed plot', !ids.includes('pointCount'));

  // Numbers must equal diversity.ts called directly — the whole point of the
  // one-model design.
  const d = computeDiversity(species);
  const divSec = report.sections.find((s) => s.id === 'diversity');
  // Rows are labelled with the symbol the specification uses (S, λ, H′, N₁,
  // N₂, E5) followed by the localisable name, so match on the suffix.
  const divRow = (key) => divSec.table.rows.find((r) => r[0].endsWith(key));
  eq('richness matches diversity.ts', divRow('plotStats.richness')[1], String(d.richness));
  eq('shannon matches diversity.ts', divRow('plotStats.shannon')[1], d.shannonH.toFixed(2));

  // 「植物生態評估技術規範」附件二 §三 3 lists S, λ, H′, N₁, N₂, E5 in that
  // order (Ludwig & Reynolds 1988). An EIA table is read against other EIA
  // tables, so the set and the order are both part of the contract.
  eq('spec index order', divSec.table.rows.slice(0, 6).map((r) => r[0].split(' ')[0]),
     ['S', 'λ', 'H′', 'N₁', 'N₂', 'E5']);
  eq('lambda is the Simpson concentration', divRow('report.simpsonLambda')[1], d.simpsonD.toFixed(2));
  eq('N1 is exp(H′)', divRow('report.shannonEffective')[1], Math.exp(d.shannonH).toFixed(3));
  eq('N2 is 1/lambda', divRow('report.invSimpson')[1], (1 / d.simpsonD).toFixed(3));
  // E5 = (N₂−1)/(N₁−1)
  eq('E5 is Hill\u2019s modified ratio', divRow('report.hillE5')[1],
     ((1 / d.simpsonD - 1) / (Math.exp(d.shannonH) - 1)).toFixed(3));
  ok('index provenance is stated', divSec.note.includes('report.diversityIndexSource'));

  // Dominants chart: top row share must equal Berger–Parker d.
  const domSec = report.sections.find((s) => s.id === 'dominants');
  close('top bar equals Berger-Parker d', domSec.chart.rows[0].value / 100, d.bergerParker, 1e-9);
  ok('dominants chart capped at 100', domSec.chart.max === 100);

  // Effort: pure counts → Chao1 applies.
  const c1 = chao1(species);
  ok('chao1 applicable on count data', c1.applicable);
  const effSec = report.sections.find((s) => s.id === 'effort');
  ok('effort table present', !!effSec.table);

  // Hand-placed point must be labelled, not left blank.
  const basics = report.sections.find((s) => s.id === 'basics');
  const acc = basics.meta.find((m) => m.key === 'report.metaAccuracy');
  eq('null accuracy labelled as manual', acc.value, 'plot.manualCoord');

  // Ground cover over 100 % must warn (10+5+60 = 75 → no warning here).
  const env = report.sections.find((s) => s.id === 'environment');
  eq('no false cover warning', env.note, undefined);

  // Layer chart uses the localisable layer key, and heights respect the unit.
  // The CHART is ordered tallest-first (a vertical profile reads downwards);
  // the TABLE stays E1-upwards. These two orders are deliberately opposite,
  // which is why both are pinned.
  const layerSec = report.sections.find((s) => s.id === 'layers');
  // Both strata carry heights, so the figure is a metric PROFILE rather than
  // a bar per layer: E2 occupies 0–0.6 m and E5 sits above it at 0.6–15 m.
  eq('drawn as a profile', layerSec.chart.kind, 'profile');
  eq('chart starts at the tallest layer', layerSec.chart.bands[0].label, 'layer.E5');
  eq('top band reaches its height', layerSec.chart.bands[0].y1, 15);
  eq('and starts where the one below ended', layerSec.chart.bands[0].y0, 0.6);
  eq('table starts at the lowest layer', layerSec.table.rows[0][0], 'layer.E2');
  // The table still carries the raw heights in the surveyor's own unit.
  eq('m-unit height in the table', layerSec.table.rows[1][2], '15.0 m');
  eq('cm height in the table', layerSec.table.rows[0][2], '60 cm');

  // Subplot table: 10×10 m → 100 m².
  const subSec = report.sections.find((s) => s.id === 'subplots');
  eq('subplot area', subSec.table.rows[0][1], '100.0 m²');
  eq('subplot richness', subSec.table.rows[0][2], '2');
}

// ── transect / point-count plots get their own sections ────────────────────
{
  const tr = buildPlotReport(
    {
      plot: { ...plot, plot_type: 'transect' },
      projectName: '',
      layers: [],
      subplots: [],
      species,
      trackSegments: [[[121.0, 0.0], [121.0, 0.01]]],
    },
    t,
  );
  const ids = tr.sections.map((s) => s.id);
  ok('transect section present', ids.includes('transect'));
  ok('no layers section without layers', !ids.includes('layers'));

  const pc = buildPlotReport(
    {
      plot: { ...plot, plot_type: 'point_count', point_radius_m: 25 },
      projectName: '',
      layers: [],
      subplots: [],
      species,
      trackSegments: [],
    },
    t,
  );
  ok('point-count section present', pc.sections.map((s) => s.id).includes('pointCount'));
}

// ── empty plot must still produce a valid, honest report ───────────────────
{
  const empty = buildPlotReport(
    {
      plot: { ...plot, plot_type: 'fixed' },
      projectName: '',
      layers: [],
      subplots: [],
      species: [],
      trackSegments: [],
    },
    t,
  );
  const ids = empty.sections.map((s) => s.id);
  ok('empty plot keeps basics', ids.includes('basics'));
  ok('empty plot has no species section', !ids.includes('species'));
  ok('empty plot has no diversity section', !ids.includes('diversity'));
  ok('empty plot still explains effort', ids.includes('effort'));
}

// ── project report ─────────────────────────────────────────────────────────
const plotA = { ...plot, id: 1, plotid: 'P-A' };
const plotB = { ...plot, id: 2, plotid: 'P-B' };
const speciesA = [
  // One threatened species so the conservation section is exercised rather
  // than silently skipped.
  sp('a', { organism_quantity: '10', subplot_id: 11, redlist: 'VU', is_endemic: 'true' }),
  sp('b', { organism_quantity: '5', subplot_id: 11 }),
  sp('c', { organism_quantity: '1', subplot_id: 12 }),
];
const speciesB = [
  sp('b', { organism_quantity: '4', subplot_id: 21 }),
  sp('c', { organism_quantity: '2', subplot_id: 21 }),
  sp('d', { organism_quantity: '1', subplot_id: 22, family: 'Poaceae' }),
];
{
  const proj = buildProjectReport(
    {
      project: { id: 3, name: 'Proj', abstract: 'Abs', location_description: 'Loc', notes: null },
      plots: [
        { plot: plotA, species: speciesA, subplotIds: [11, 12] },
        { plot: plotB, species: speciesB, subplotIds: [21, 22] },
      ],
      counts: { session: 2, plot: 2, collection: 1 },
      siteCount: 1,
    },
    t,
  );
  eq('project report kind', proj.kind, 'project');
  const ids = proj.sections.map((s) => s.id);
  eq('project section order', ids, [
    'basics',
    'overview',
    'plots',
    'unitDiversity',
    'effort',
    'species',
    'similarity',
    'composition',
    'conservation',
    'conservationSpecies',
    'dataQuality',
    'methods',
  ]);

  // Effort chart is the two-series one: observed vs estimated, per plot.
  const eff = proj.sections.find((s) => s.id === 'effort');
  eq('effort chart has one row per plot', eff.chart.rows.length, 2);
  ok('effort chart has legend', !!eff.chart.seriesLabels);
  eq('observed value is richness', eff.chart.rows[0].value, computeDiversity(speciesA).richness);
  ok('estimate is at least the observed count', eff.chart.rows[0].value2 >= eff.chart.rows[0].value);

  // Cross-plot Chao2 must equal calling chao2 with plot ids as units.
  const crossRecords = [
    ...speciesA.map((r) => ({ ...r, subplot_id: 1 })),
    ...speciesB.map((r) => ({ ...r, subplot_id: 2 })),
  ];
  const cross = chao2(crossRecords, [1, 2]);
  ok('cross chao2 applicable', cross.applicable);
  const crossRow = eff.table.rows.find((r) => r[0] === 'report.crossChao2');
  eq('cross chao2 matches diversity.ts', crossRow[1], cross.estimate.toFixed(1));

  // Species table: b and c are in both plots, a and d in one.
  const spSec = proj.sections.find((s) => s.id === 'species');
  eq('project species count', spSec.table.rows.length, 4);
  // Scientific names carry `*italic*` markers now, so match on the epithet.
  const freqCol = new Map(spSec.table.rows.map((r) => [r[0], r[3]]));
  const freqOf = (name) => freqCol.get(`*${name}*`);
  eq('shared species frequency', freqOf('Genus b'), '2 / 2');
  eq('unique species frequency', freqOf('Genus a'), '1 / 2');
  eq('rows sorted by frequency', spSec.table.rows[0][3], '2 / 2');

  // Two plots → paired indices, not a matrix.
  const sim = proj.sections.find((s) => s.id === 'similarity');
  const b = betaSimilarity(speciesA, speciesB);
  const sor = sim.table.rows.find((r) => r[0] === 'Sørensen');
  eq('sorensen matches diversity.ts', sor[1], b.sorensen.toFixed(2));

  // Three plots → matrix, diagonal blank.
  const proj3 = buildProjectReport(
    {
      project: { id: 3, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [
        { plot: plotA, species: speciesA, subplotIds: [] },
        { plot: plotB, species: speciesB, subplotIds: [] },
        { plot: { ...plot, id: 3, plotid: 'P-C' }, species: speciesA, subplotIds: [] },
      ],
      counts: { session: 0, plot: 3, collection: 0 },
      siteCount: 0,
    },
    t,
  );
  const sim3 = proj3.sections.find((s) => s.id === 'similarity');
  eq('matrix has a header cell per plot', sim3.table.columns.length, 4);
  eq('matrix diagonal blank', sim3.table.rows[0][1], '–');
  eq('matrix symmetric', sim3.table.rows[0][2], sim3.table.rows[1][1]);

  // A project with no plots must still produce a usable document.
  const empty = buildProjectReport(
    {
      project: { id: 4, name: 'Empty', abstract: null, location_description: null, notes: null },
      plots: [],
      counts: { session: 0, plot: 0, collection: 0 },
      siteCount: 0,
    },
    t,
  );
  eq('empty project sections', empty.sections.map((s) => s.id), ['basics', 'overview', 'methods']);
}

// ── per-plot diversity, in the specification's table shape ────────────────
{
  const proj = buildProjectReport(
    {
      project: { id: 5, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [
        { plot: plotA, species: speciesA, subplotIds: [] },
        { plot: plotB, species: speciesB, subplotIds: [] },
      ],
      counts: { session: 0, plot: 2, collection: 0 },
      siteCount: 0,
    },
    t,
  );
  const sec = proj.sections.find((s) => s.id === 'unitDiversity');
  // 範例 2.13: 樣區 | S | λ | H′ | N₁ | N₂ | E5
  eq('columns follow the specification', sec.table.columns.slice(1), [
    'S plotStats.richness', 'λ', 'H′', 'N₁', 'N₂', 'E5',
  ]);
  eq('one row per plot plus the pooled row', sec.table.rows.length, 3);
  eq('pooled row is last', sec.table.rows[2][0], 'report.pooledRow');

  // The pooled row is recomputed over every record, NOT averaged — the
  // specification's own example has it exceeding every individual plot, and
  // averaging would quietly understate it.
  const pooled = computeDiversity([...speciesA, ...speciesB]);
  eq('pooled richness is recomputed', sec.table.rows[2][1], String(pooled.richness));
  const perPlotMean =
    (computeDiversity(speciesA).richness + computeDiversity(speciesB).richness) / 2;
  ok('and is not the mean of the rows', pooled.richness !== perPlotMean);
  eq('pooled H′ matches diversity.ts', sec.table.rows[2][3], pooled.shannonH.toFixed(3));
  ok('the distinction is stated', sec.note.includes('report.pooledNote'));
}

// ── session report ─────────────────────────────────────────────────────────
{
  const withQty = buildSessionReport(
    {
      session: {
        id: 7,
        name: 'Walk',
        started_at: Date.UTC(2026, 0, 2, 1, 0),
        ended_at: Date.UTC(2026, 0, 2, 2, 0),
        recorded_by: 'X',
        gps_mode: 'single_point',
        notes: null,
      },
      projectName: 'Proj',
      species: speciesA,
    },
    t,
  );
  const ids = withQty.sections.map((s) => s.id);
  ok('session with abundance gets diversity', ids.includes('diversity'));
  ok('session gets composition', ids.includes('composition'));

  // The common case: a checklist with no abundance at all. Printing a table of
  // dashes would be worse than omitting the block.
  const noQty = buildSessionReport(
    {
      session: {
        id: 8,
        name: 'List',
        started_at: Date.UTC(2026, 0, 3),
        ended_at: null,
        recorded_by: null,
        gps_mode: null,
        notes: null,
      },
      projectName: '',
      species: [
        { taxon_id: 'a', organism_quantity: null, organism_quantity_type: null, simple_name: 'A', family: 'F' },
        { taxon_id: 'b', organism_quantity: null, organism_quantity_type: null, simple_name: 'B', family: 'F' },
      ],
    },
    t,
  );
  const ids2 = noQty.sections.map((s) => s.id);
  ok('no-abundance checklist still lists species', ids2.includes('species'));
  ok('no-abundance checklist omits diversity', !ids2.includes('diversity'));
}

// ── HTML renderer ──────────────────────────────────────────────────────────
{
  // Hostile data: a species name carrying markup and an ampersand must come
  // out as text, never as tags. This is the failure mode that silently
  // produces a broken (or worse, mis-rendered) document.
  const nasty = buildPlotReport(
    {
      plot: { ...plot, locality: 'A & B <script>alert(1)</script>' },
      projectName: 'P & Q',
      layers: [],
      subplots: [],
      species: [sp('x', { simple_name: '<i>Quercus</i> & co', organism_quantity: '2' })],
      trackSegments: [],
    },
    t,
  );
  const html = buildReportHtml(nasty, 'zh-TW');

  ok('doctype present', html.startsWith('<!doctype html>'));
  ok('lang attribute set', html.includes('<html lang="zh-TW">'));
  ok('charset declared', html.includes('<meta charset="utf-8">'));
  ok('self-contained: no external refs', !/<(script|link|img)\b/i.test(html.replace(/&lt;script&gt;/g, '')));

  // Escaping: the raw markup must not survive, the escaped form must.
  ok('script tag escaped', !html.includes('<script>'));
  ok('escaped lt present', html.includes('&lt;script&gt;'));
  ok('ampersand escaped', html.includes('A &amp; B'));
  ok('italic markup in species name escaped', html.includes('&lt;i&gt;Quercus&lt;/i&gt;'));

  // Every & must begin a real entity — a bare & is invalid and betrays a
  // missed escape.
  const badAmp = [...html.matchAll(/&(?!(amp|lt|gt|quot|#\d+);)/g)];
  eq('no unescaped ampersands', badAmp.length, 0);

  // Tag balance for the containers the renderer emits.
  for (const tag of ['html', 'head', 'body', 'section', 'table', 'thead', 'tbody', 'dl']) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    eq(`<${tag}> balanced`, open, close);
  }

  // Bar widths must stay inside the track.
  for (const m of html.matchAll(/width:([\d.]+)%/g)) {
    const w = Number(m[1]);
    ok(`bar width in range (${w})`, w >= 0 && w <= 100);
  }

  // The real report renders every section it was given.
  const full = buildReportHtml(report, 'en');
  for (const s of report.sections) {
    ok(`section ${s.id} rendered`, full.includes(`id="${s.id}"`));
  }
  // Bars stay CSS. SVG is permitted for line charts — the invariant that
  // matters is the one asserted above: no <text> node inside any SVG, because
  // the app bundles no fonts and CJK there renders as tofu.
  ok('bars are CSS, not SVG', full.includes('class="track"'));
}

// ── rarefaction: the analytic curve, hand-checked ─────────────────────────
{
  // Chao et al. 2014 Table 1, q = 0:  D̂(m) = S_obs − Σ C(n−Xᵢ,m)/C(n,m).
  // Two species with 2 and 1 individuals, n = 3, S_obs = 2.
  //   m = 1: 2 − [C(1,1) + C(2,1)]/C(3,1) = 2 − (1 + 2)/3 = 1.0
  eq('m=1 is the mean per-individual richness', Number(rare.interpolate([2, 1], 3, 1).toFixed(6)), 1);
  //   m = 2: 2 − [C(1,2) + C(2,2)]/C(3,2) = 2 − (0 + 1)/3 = 1.6667
  eq('m=2', Number(rare.interpolate([2, 1], 3, 2).toFixed(4)), 1.6667);
  // At the reference size the curve must return exactly S_obs — the single
  // most diagnostic check on the combinatorics.
  eq('m=n equals S_obs', rare.interpolate([2, 1], 3, 3), 2);
  eq('m>n clamps to S_obs', rare.interpolate([2, 1], 3, 9), 2);

  // Log-space arithmetic must survive counts that overflow a plain factorial.
  const big = rare.interpolate([500, 300, 200], 1000, 500);
  ok('large samples do not overflow', Number.isFinite(big) && big > 0 && big <= 3);

  // Monotone non-decreasing: adding effort cannot lose species.
  const curve = [];
  for (let m = 1; m <= 12; m += 1) curve.push(rare.interpolate([5, 4, 2, 1], 12, m));
  ok('curve is monotone', curve.every((v, i) => i === 0 || v >= curve[i - 1] - 1e-12));

  // Chao & Jost (2012) coverage, quoted in Appendix G:
  //   Ĉ = 1 − (f₁/n)[(n−1)f₁ / ((n−1)f₁ + 2f₂)]
  // f₁ = 1, f₂ = 1, n = 12:  1 − (1/12)(11/13) = 0.9294872
  eq('coverage matches Chao & Jost 2012',
     Number(sampleCoverage([5, 4, 2, 1], 12, 12).toFixed(7)), 0.9294872);
  eq('no singletons means complete coverage', sampleCoverage([5, 5], 10, 10), 1);
}

// ── rarefaction: refusals, extrapolation bound, reproducible intervals ────
{
  const counted = (id, n, sub = null) =>
    sp(id, { subplot_id: sub, organism_quantity: String(n), organism_quantity_type: 'individuals' });
  const recs = [counted('a', 5), counted('b', 4), counted('c', 2), counted('d', 1)];

  const ab = abundanceRarefaction(recs, { replicates: 50 });
  ok('abundance curve applies to counts', ab.applicable);
  eq('reference is the individual total', ab.reference, 12);
  eq('observed richness', ab.observed, 4);
  const atRef = ab.points.find((p) => p.size === ab.reference);
  eq('curve passes through S_obs at n', Number(atRef.richness.toFixed(9)), 4);
  // Table 1 marks extrapolation "reliable if m* < n", so the curve stops at 2n.
  eq('extrapolation stops at double the reference',
     Math.max(...ab.points.map((p) => p.size)), 24);
  ok('points past the reference are flagged',
     ab.points.filter((p) => p.size > 12).every((p) => p.extrapolated));
  ok('extrapolation never dips below the observed',
     ab.points.filter((p) => p.extrapolated).every((p) => p.richness >= 4 - 1e-9));

  // Appendix G's interval is a bootstrap, so it must be REPRODUCIBLE: a report
  // exported twice cannot disagree with itself.
  const again = abundanceRarefaction(recs, { replicates: 50 });
  eq('bootstrap is deterministic',
     ab.points.map((p) => [p.lo, p.hi]), again.points.map((p) => [p.lo, p.hi]));
  ok('interval brackets the estimate',
     ab.points.every((p) => p.lo == null || (p.lo <= p.richness + 1e-9 && p.hi >= p.richness - 1e-9)));
  ok('lower bound never goes negative', ab.points.every((p) => p.lo == null || p.lo >= 0));

  // Cover data has no individuals to rarefy.
  const bb = abundanceRarefaction(
    [sp('x', { organism_quantity: '4', organism_quantity_type: 'Braun-Blanquet Scale' })],
    { replicates: 0 },
  );
  eq('cover data is refused', bb.applicable, false);
  eq('with the reason', bb.reason, 'not-counts');

  // Sample-based rarefaction over units.
  const inUnits = [
    counted('a', 1, 1), counted('b', 1, 1), counted('c', 1, 1),
    counted('a', 1, 2), counted('b', 1, 2),
    counted('a', 1, 3), counted('d', 1, 3),
  ];
  const inc = incidenceRarefaction(inUnits, [1, 2, 3], { replicates: 30 });
  ok('incidence curve applies', inc.applicable);
  eq('reference is the unit count', inc.reference, 3);
  eq('observed richness', inc.observed, 4);
  eq('t=T equals S_obs',
     Number(inc.points.find((p) => p.size === 3).richness.toFixed(9)), 4);
  eq('one unit is not a curve', incidenceRarefaction(inUnits, [1], {}).reason, 'need-2-units');
}

// ── rank–abundance: the shape no index shows ──────────────────────────────
{
  const counted = (id, n) =>
    sp(id, { organism_quantity: String(n), organism_quantity_type: 'individuals' });
  const rep = buildPlotReport(
    {
      plot, projectName: '', layers: [], subplots: [],
      species: [counted('a', 20), counted('b', 8), counted('c', 3), counted('d', 1)],
      trackSegments: [],
    },
    t,
  );
  const sec = rep.sections.find((s) => s.id === 'rankAbundance');
  eq('drawn as a line chart', sec.chart.kind, 'line');
  eq('on a log value axis', sec.chart.yAxis.scale, 'log10');
  const pts = sec.chart.series[0].points;
  eq('ranks start at 1', pts[0].x, 1);
  ok('ranks are consecutive', pts.every((p, i) => p.x === i + 1));
  // Descending by definition, and the first point is Berger–Parker × 100.
  ok('monotone decreasing', pts.every((p, i) => i === 0 || p.y <= pts[i - 1].y + 1e-9));
  const d = computeDiversity([counted('a', 20), counted('b', 8), counted('c', 3), counted('d', 1)]);
  close('rank 1 equals Berger-Parker', pts[0].y / 100, d.bergerParker, 1e-9);
  // A log axis cannot show a zero, so every plotted point must be positive.
  ok('no non-positive point on a log axis', pts.every((p) => p.y > 0));

  // Mixed units cannot be ranked against one another.
  const mixed = buildPlotReport(
    {
      plot, projectName: '', layers: [], subplots: [],
      species: [
        counted('a', 5),
        sp('b', { organism_quantity: '4', organism_quantity_type: 'Braun-Blanquet Scale' }),
        sp('c', { organism_quantity: '2', organism_quantity_type: 'Braun-Blanquet Scale' }),
      ],
      trackSegments: [],
    },
    t,
  );
  const refused = mixed.sections.find((s) => s.id === 'rankAbundance');
  eq('no curve for mixed units', refused.chart, undefined);
  ok('and the reason is printed', refused.note.includes('rankAbundanceMixed'));
}

// ── vertical profile: bands on a real metre axis ──────────────────────────
{
  const rep = buildPlotReport(
    {
      plot, projectName: '',
      layers: [
        { layer_index: 1, cover_pct: 30, height_cm: 20, height_unit: 'cm', method: 'BB' },
        { layer_index: 2, cover_pct: 25, height_cm: 150, height_unit: 'cm', method: 'BB' },
        { layer_index: 4, cover_pct: 80, height_cm: 1800, height_unit: 'm', method: 'BB' },
      ],
      subplots: [], species, trackSegments: [],
    },
    t,
  );
  const sec = rep.sections.find((s) => s.id === 'layers');
  eq('drawn as a profile', sec.chart.kind, 'profile');
  // Bands stack: each starts where the one below ended, so the SPACING is the
  // information — 0–0.2, 0.2–1.5, 1.5–18 m.
  const bands = [...sec.chart.bands].reverse(); // model orders highest first
  eq('bands stack from the ground', bands.map((b) => [b.y0, b.y1]), [[0, 0.2], [0.2, 1.5], [1.5, 18]]);
  eq('highest band is drawn first', sec.chart.bands[0].label, 'layer.E4');
  eq('cover rides on the bar length', sec.chart.bands[0].value, 80);
  // Word cannot place a band at 12.4 m, so it degrades — and says so.
  ok('the degradation is spelled out', !!sec.chart.degradedNote);

  // A layer with no height cannot go on a metre axis.
  const partial = buildPlotReport(
    {
      plot, projectName: '',
      layers: [
        { layer_index: 1, cover_pct: 30, height_cm: 20, height_unit: 'cm', method: 'BB' },
        { layer_index: 2, cover_pct: 25, height_cm: null, height_unit: 'cm', method: 'BB' },
      ],
      subplots: [], species, trackSegments: [],
    },
    t,
  );
  const psec = partial.sections.find((s) => s.id === 'layers');
  eq('unplaceable layer is left off the axis', psec.chart.bands.length, 1);
  eq('but stays in the table', psec.table.rows.length, 2);
  ok('and the omission is counted', psec.chart.note.includes('profileMissingHeight'));

  // No heights at all: there is no axis to draw on, so it degrades in the
  // MODEL and every renderer degrades together.
  const flat = buildPlotReport(
    {
      plot, projectName: '',
      layers: [{ layer_index: 1, cover_pct: 30, height_cm: null, height_unit: 'cm', method: 'BB' }],
      subplots: [], species, trackSegments: [],
    },
    t,
  );
  const fsec = flat.sections.find((s) => s.id === 'layers');
  eq('falls back to bars', fsec.chart.kind, 'bar');
  ok('and says why', fsec.chart.note.includes('profileNoHeights'));
}

// ── methods describe what was done, and nothing that was not ──────────────
{
  // A checklist with no abundance gets no diversity, no dominance and no
  // stand structure — so the methods must not describe them. Claiming an
  // analysis that was omitted is worse than omitting the paragraph.
  const bare = buildSessionReport(
    {
      session: { id: 1, name: 'S', started_at: 1, ended_at: null, recorded_by: null,
                 gps_mode: null, notes: null },
      projectName: '',
      species: [
        { taxon_id: 'a', organism_quantity: null, organism_quantity_type: null,
          simple_name: 'A', family: 'F', rank: 'Species' },
        { taxon_id: 'b', organism_quantity: null, organism_quantity_type: null,
          simple_name: 'B', family: 'F', rank: 'Species' },
      ],
    },
    t,
  );
  const ids = bare.sections.map((s) => s.id);
  const methods = bare.sections.find((s) => s.id === 'methods');
  ok('no diversity section here', !ids.includes('diversity'));
  ok('so no Shannon paragraph', !methods.paras.includes('report.methodsShannon'));
  ok('and no importance-value paragraph', !methods.paras.includes('report.methodsIvi'));

  // A DBH plot gets the full set, and every paragraph corresponds to a
  // section that is actually present.
  const dbh = (id, sub, stems) =>
    sp(id, { subplot_id: sub, rank: 'Species', organism_quantity: JSON.stringify(stems),
             organism_quantity_type: 'DBH (cm)' });
  const full = buildPlotReport(
    {
      plot: { ...plot, sample_size_value: 100, sample_size_unit: 'm2' },
      projectName: '', layers: [],
      subplots: [
        { id: 1, label: 'S1', width_m: null, length_m: null },
        { id: 2, label: 'S2', width_m: null, length_m: null },
      ],
      species: [dbh('a', 1, [10, 20]), dbh('b', 2, [20, 30])],
      trackSegments: [],
    },
    t,
  );
  const fullIds = new Set(full.sections.map((s) => s.id.split(':')[0]));
  const fullMethods = full.sections.find((s) => s.id === 'methods');
  ok('stand paragraph present', fullMethods.paras.includes('report.methodsStand'));
  ok('diameter-class paragraph present', fullMethods.paras.includes('report.methodsDbhClasses'));
  ok('IVI paragraph present', fullMethods.paras.includes('report.methodsIvi'));
  ok('data-quality paragraph present', fullMethods.paras.includes('report.methodsDataQuality'));
  // The invariant, stated directly: a paragraph implies its section.
  const requires = {
    'report.methodsStand': 'stand',
    'report.methodsDbhClasses': 'dbhClasses',
    'report.methodsIvi': 'ivi',
    'report.methodsRarefaction': 'rarefaction',
    'report.methodsChao': 'effort',
    'report.methodsShannon': 'diversity',
    'report.methodsDominance': 'dominants',
    'report.methodsDataQuality': 'dataQuality',
  };
  for (const [para, sec] of Object.entries(requires)) {
    if (fullMethods.paras.includes(para)) {
      ok(`${para} implies its section`, fullIds.has(sec));
    }
  }
  ok('provenance is still stated', fullMethods.note.includes('report.methodsProvenance'));
}

// ── data quality: what the indices above actually rest on ─────────────────
{
  const q = dataQuality(
    [
      sp('a', { rank: 'Species', organism_quantity: '1', organism_quantity_type: 'individuals' }),
      sp('b', { rank: 'Species', organism_quantity: '2', organism_quantity_type: 'individuals' }),
      sp('c', { rank: 'Genus', simple_name: 'Carex', organism_quantity: '5',
                organism_quantity_type: 'individuals' }),
      sp('d', { rank: '種', organism_quantity: null, organism_quantity_type: null }),
      sp('e', { rank: '', organism_quantity: '3', organism_quantity_type: 'individuals' }),
    ],
    {},
  );
  const codes = q.issues.map((i) => i.code);
  eq('totals', [q.totalRecords, q.totalSpecies], [5, 5]);
  ok('unquantified records are counted', codes.includes('no-abundance'));
  ok('genus-level identifications are counted', codes.includes('genus-only'));
  ok('missing rank is counted', codes.includes('rank-unknown'));
  // Chao rests on the rare species, so their number belongs on the page.
  ok('singletons reported', codes.includes('singletons'));
  ok('doubletons reported', codes.includes('doubletons'));
  const genus = q.issues.find((i) => i.code === 'genus-only');
  eq('one genus-level taxon', genus.species, 1);
  eq('and it is named', genus.examples, ['Carex']);
  // 種 is Traditional Chinese for species; the Japanese list supplies Chinese
  // ranks, so normalisation has to happen before anything is judged.
  eq('Chinese rank labels normalise', normaliseRank('種'), 'species');
  eq('and so do English ones', normaliseRank('Species'), 'species');
  eq('genus in Chinese', normaliseRank('屬'), 'genus');

  // Mixed units are a caveat on every index above.
  const mixed = dataQuality([
    sp('a', { rank: 'Species', organism_quantity: '1', organism_quantity_type: 'individuals' }),
    sp('b', { rank: 'Species', organism_quantity: '4',
              organism_quantity_type: 'Braun-Blanquet Scale' }),
  ], {});
  ok('mixed units flagged', mixed.issues.some((i) => i.code === 'mixed-units'));
  // Cover data has no individuals, so singleton counts would be meaningless.
  ok('no singleton claim for cover data',
     !mixed.issues.some((i) => i.code === 'singletons'));

  // A missing subplot is only a gap when the plot HAS subplots.
  const undivided = dataQuality(
    [sp('a', { rank: 'Species', subplot_id: null })], {});
  ok('undivided plot raises no subplot gap',
     !undivided.issues.some((i) => i.code === 'no-subplot'));
  const divided = dataQuality(
    [sp('a', { rank: 'Species', subplot_id: null })], { hasSubplots: true });
  ok('divided plot does', divided.issues.some((i) => i.code === 'no-subplot'));

  // A clean record set still gets a section, saying so.
  const clean = buildPlotReport(
    {
      plot, projectName: '', layers: [], subplots: [],
      species: [
        sp('a', { rank: 'Species', organism_quantity: '4', organism_quantity_type: 'individuals' }),
        sp('b', { rank: 'Species', organism_quantity: '5', organism_quantity_type: 'individuals' }),
      ],
      trackSegments: [],
    },
    t,
  );
  const sec = clean.sections.find((s) => s.id === 'dataQuality');
  ok('clean data still reports', sec.paras.includes('report.dq.clean'));
  ok('and disclaims fault-finding', sec.note.includes('report.dq.note'));
}

// ── the rarefaction section, and its refusals ─────────────────────────────
{
  const counted = (id, n, sub = null) =>
    sp(id, { subplot_id: sub, organism_quantity: String(n), organism_quantity_type: 'individuals' });
  const rep = buildPlotReport(
    {
      plot, projectName: '', layers: [], subplots: [],
      species: [counted('a', 8), counted('b', 5), counted('c', 3), counted('d', 1)],
      trackSegments: [],
    },
    t,
  );
  const sec = rep.sections.find((s) => s.id === 'rarefaction');
  eq('accumulation curve is a line chart', sec.chart.kind, 'line');
  eq('one series', sec.chart.series.length, 1);
  ok('with a confidence band', sec.chart.series[0].band.length === sec.chart.series[0].points.length);
  ok('band brackets the curve', sec.chart.series[0].points.every((p, i) => {
    const b = sec.chart.series[0].band[i];
    return b.lo <= p.y + 1e-9 && b.hi >= p.y - 1e-9;
  }));
  ok('richness axis starts at zero', sec.chart.yAxis.min === 0);
  ok('the bootstrap is disclosed', sec.chart.note.includes('report.rarefactionNote'));
  ok('the extrapolation bound is disclosed', sec.note.includes('report.extrapolationBound'));
  ok('and the source is named', sec.note.includes('report.rarefactionSource'));

  // Cover data cannot be rarefied — the section says so rather than drawing
  // something that looks like a curve.
  const cover = buildPlotReport(
    {
      plot, projectName: '', layers: [], subplots: [],
      species: [
        sp('x', { organism_quantity: '4', organism_quantity_type: 'Braun-Blanquet Scale' }),
        sp('y', { organism_quantity: '2', organism_quantity_type: 'Braun-Blanquet Scale' }),
      ],
      trackSegments: [],
    },
    t,
  );
  const refused = cover.sections.find((s) => s.id === 'rarefaction');
  eq('no curve for cover data', refused.chart, undefined);
  ok('and the reason is printed', refused.note.includes('rarefactionUnavailable'));
}

// ── table sorting: the comparator the in-app tables use ───────────────────
{
  // Numbers sort numerically even when the model formatted them as strings —
  // '9' must not come after '10'.
  ok('numeric, not lexical', compareCells('9', '10', 'asc') < 0);
  ok('percentages compare numerically', compareCells('9.5%', '10.0%', 'asc') < 0);
  ok('descending reverses', compareCells('9', '10', 'desc') > 0);
  ok('text falls back to locale order', compareCells('Abies', 'Betula', 'asc') < 0);
  // Missing data sorts LAST in both directions: an en dash is "not measured",
  // not "zero", and burying it at the top of an ascending sort would read as
  // the smallest value.
  ok('dash last ascending', compareCells('–', '5', 'asc') > 0);
  ok('dash last descending', compareCells('–', '5', 'desc') > 0);
  eq('two blanks tie', compareCells('–', '', 'asc'), 0);
}

// ── conservation: the species behind the counts ───────────────────────────
{
  const listed = (id, over) => sp(id, { simple_name: `Sp ${id}`, family: 'F', ...over });
  const sec = conservationSpeciesSection(
    [
      listed('a', { redlist: 'VU' }),
      listed('b', { redlist: 'CR' }),
      listed('c', { iucn: 'EN', cites: 'II' }),
      listed('d', { redlist: 'LC' }),            // safe → excluded
      listed('e', { is_endemic: 'true' }),       // endemic alone still qualifies
    ],
    t,
  );
  // A count ("VU: 3") cannot be checked against a site; the species can.
  eq('only species of concern are listed', sec.table.rows.length, 4);
  // Ordered by the highest threat category held: CR > EN > VU > (endemic only).
  eq('ordered by threat', sec.table.rows.map((r) => r[0]), [
    '*Sp b*', '*Sp c*', '*Sp a*', '*Sp e*',
  ]);
  eq('each status gets its own column', sec.table.columns.length, 7);
  const cRow = sec.table.rows[1];
  eq('IUCN shown', cRow[3], 'EN');
  eq('CITES shown', cRow[4], 'II');
  eq('unlisted reads as a dash, not a blank', cRow[2], '–');
  eq('nothing to list, no section', conservationSpeciesSection([listed('d', { redlist: 'LC' })], t), null);
}

// ── scientific-name italics follow the app's one definition ───────────────
{
  // Genus + species epithet italic; rank token and author upright.
  eq('binomial', scientificNameMd('Castanopsis carlesii'), '*Castanopsis carlesii*');
  eq('author stays upright', scientificNameMd('Machilus thunbergii Siebold & Zucc.'),
     '*Machilus thunbergii* Siebold & Zucc.');
  eq('rank token breaks italics', scientificNameMd('Neolitsea aciculata var. variabillima'),
     '*Neolitsea aciculata* var. *variabillima*');
  // Family and above are upright in full — the classic mistake is to italicise
  // everything Latin.
  eq('family upright', scientificNameMd('Fagaceae', { rank: 'Family' }), 'Fagaceae');
  eq('family upright by suffix alone', scientificNameMd('Orchidaceae'), 'Orchidaceae');
  // ICZN: the whole trinomial is italic, the author block is not.
  eq('animal trinomial', scientificNameMd('Parus major minor (Temminck, 1850)', { kingdom: 'Animalia' }),
     '*Parus major minor* (Temminck, 1850)');
  eq('markers strip cleanly', stripNameMd('*Genus species* var. *x* Auth.'),
     'Genus species var. x Auth.');

  // The species table carries the markers; the HTML renderer turns them into
  // <i> and escapes everything else.
  const rep = buildPlotReport(
    {
      plot, projectName: '', layers: [], subplots: [],
      species: [sp('a', { simple_name: 'Castanopsis carlesii', kingdom: 'Plantae' })],
      trackSegments: [],
    },
    t,
  );
  const cell = rep.sections.find((s) => s.id === 'species').table.rows[0][0];
  eq('species cell carries italic markers', cell, '*Castanopsis carlesii*');
  const html = buildReportHtml(rep, 'zh-TW');
  ok('html renders the italics', html.includes('<i>Castanopsis carlesii</i>'));
  ok('and no literal asterisk leaks', !html.includes('*Castanopsis'));
}

// ── mixed taxonomic groups are analysed separately ────────────────────────
{
  // Precedence: the groups nest, so a bird must not fall through to Animalia
  // and a fern must not fall through to Plantae.
  eq('vascular plant', taxonGroupOf({ kingdom: 'Plantae', phylum: 'Tracheophyta' }), 'Tracheophyta');
  eq('moss stays Plantae', taxonGroupOf({ kingdom: 'Plantae', phylum: 'Bryophyta' }), 'Plantae');
  eq('bird', taxonGroupOf({ kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves' }), 'Aves');
  eq('mammal', taxonGroupOf({ kingdom: 'Animalia', class: 'Mammalia' }), 'Mammalia');
  eq('other animal falls back', taxonGroupOf({ kingdom: 'Animalia', class: 'Clitellata' }), 'Animalia');
  eq('unknown', taxonGroupOf({}), 'other');

  const bird = (id, n) =>
    sp(id, {
      kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves', family: 'Turdidae',
      organism_quantity: String(n), organism_quantity_type: 'individuals',
    });
  const plant = (id, code) =>
    sp(id, {
      kingdom: 'Plantae', phylum: 'Tracheophyta', family: 'Fagaceae',
      organism_quantity: code, organism_quantity_type: 'Braun-Blanquet Scale',
    });
  const mixed = [bird('b1', 5), bird('b2', 2), plant('p1', '4'), plant('p2', '2')];

  eq('groups in presentation order', groupRecords(mixed).map((g) => g.key),
     ['Tracheophyta', 'Aves']);

  const rep = buildPlotReport(
    { plot, projectName: '', layers: [], subplots: [], species: mixed, trackSegments: [] },
    t,
  );
  const ids = rep.sections.map((s) => s.id);
  // One index set per group, never a pooled one: a Shannon index over birds
  // and vascular plants together is arithmetically valid and ecologically
  // meaningless.
  ok('diversity is per group', ids.includes('diversity:Aves') && ids.includes('diversity:Tracheophyta'));
  ok('and never pooled', !ids.includes('diversity'));
  ok('dominants likewise', ids.includes('dominants:Aves') && !ids.includes('dominants'));
  ok('effort likewise', ids.includes('effort:Aves') && !ids.includes('effort'));

  // The bird half is pure counts, so Chao1 applies to it even though the
  // pooled set would have been refused for mixed units.
  const birdEffort = rep.sections.find((s) => s.id === 'effort:Aves');
  ok('Chao1 reaches the counted group', birdEffort.table != null);
  const plantEffort = rep.sections.find((s) => s.id === 'effort:Tracheophyta');
  eq('and is refused for the cover group', plantEffort.table, undefined);

  // Indices must be the group's own, not the pooled set's.
  const birdDiv = rep.sections.find((s) => s.id === 'diversity:Aves');
  eq('group richness is the group’s', birdDiv.table.rows[0][1],
     String(computeDiversity([bird('b1', 5), bird('b2', 2)]).richness));
  ok('the split is explained', birdDiv.note.includes('report.groupSplitNote'));
  ok('and the heading names the group', birdDiv.heading.includes('report.sectionForGroup'));

  // Inventory sections stay pooled — a family tally across groups is a count,
  // and splitting it would only fragment the table.
  ok('species list stays whole', ids.includes('species'));
  ok('composition stays whole', ids.includes('composition'));

  // A single-group report must be untouched by any of this.
  const single = buildPlotReport(
    { plot, projectName: '', layers: [], subplots: [],
      species: [plant('p1', '4'), plant('p2', '2')], trackSegments: [] },
    t,
  );
  const sids = single.sections.map((s) => s.id);
  ok('single group keeps the plain ids', sids.includes('diversity') && !sids.includes('diversity:Tracheophyta'));
  const plainDiv = single.sections.find((s) => s.id === 'diversity');
  ok('and adds no split note', !(plainDiv.note ?? '').includes('report.groupSplitNote'));
}

// ── abundance is printed with its unit, never as raw storage ──────────────
{
  // A DBH record stores a JSON array; printing it verbatim put
  // "[12,18,25,31,44]" in the species table and made the reader decode it.
  eq('DBH renders as stems and a range',
     abundanceText('[12,18,25,44]', 'DBH (cm)', (k, v) => `${k}:${v.count}:${v.range}`),
     'report.abundanceDbh:4:12.0–44.0');
  eq('a single stem has no range',
     abundanceText('[30]', 'DBH (cm)', (k, v) => `${k}:${v.count}:${v.range}`),
     'report.abundanceDbh:1:30.0');
  // A bare "4" is indistinguishable from a count of four without its scale.
  eq('BB names its scale', abundanceText('4', 'Braun-Blanquet Scale', t), 'Br.-Bq. 4');
  eq('percent keeps its sign', abundanceText('25', '% cover', t), '25%');
  eq('a custom unit is named', abundanceText('7', 'clumps', t), '7 clumps');
  eq('empty stays empty', abundanceText('', 'individuals', t), '');
}

// ── the stand sections on a real DBH plot ────────────────────────────────
{
  const dbh = (id, sub, stems) =>
    sp(id, { subplot_id: sub, organism_quantity: JSON.stringify(stems),
             organism_quantity_type: 'DBH (cm)' });
  const rep = buildPlotReport(
    {
      plot: { ...plot, sample_size_value: 100, sample_size_unit: 'm2' },
      projectName: '',
      layers: [],
      subplots: [
        { id: 1, label: 'S1', width_m: null, length_m: null },
        { id: 2, label: 'S2', width_m: null, length_m: null },
      ],
      species: [dbh('a', 1, [10, 20]), dbh('b', 2, [20, 30])],
      trackSegments: [],
    },
    t,
  );
  const ids = rep.sections.map((s) => s.id);
  ok('DBH plot gets stand structure', ids.includes('stand'));
  ok('DBH plot gets diameter classes', ids.includes('dbhClasses'));
  ok('DBH plot gets IVI', ids.includes('ivi'));

  const stand = rep.sections.find((s) => s.id === 'stand');
  const byLabel = new Map(stand.table.rows.map((r) => [r[0], r[1]]));
  eq('area from the sample-size field', byLabel.get('report.plotAreaM2'), '100.0');
  eq('stems per hectare', byLabel.get('report.stemsPerHa'), '400.0');
  eq('basal area per hectare', byLabel.get('report.basalAreaM2PerHa'), '14.1372');
  eq('quadratic mean diameter', byLabel.get('report.quadraticMeanDbh'), '21.21');
  eq('area source is stated', stand.note, 'report.areaSource.sample-size');

  // A plot with a length where an area belongs must refuse, and say so.
  const badUnit = buildPlotReport(
    {
      plot: { ...plot, sample_size_value: 10, sample_size_unit: 'm' },
      projectName: '', layers: [], subplots: [],
      species: [dbh('a', 1, [10])], trackSegments: [],
    },
    t,
  );
  const refused = badUnit.sections.find((s) => s.id === 'stand');
  eq('no table when the area is unusable', refused.table, undefined);
  eq('and the reason is printed', refused.note, 'report.areaUnknown.unrecognised-unit');

  // The histogram is a column chart, and its bins must stay in ascending order
  // — reversing them yields a plausible-looking, wrong figure.
  const classes = rep.sections.find((s) => s.id === 'dbhClasses');
  eq('diameter classes are a column chart', classes.chart.kind, 'column');
  eq('bins ascend from the threshold', classes.chart.rows.map((r) => r.label)[0], '1–5');
  eq('stems binned', classes.chart.rows.map((r) => r.value), [0, 0, 1, 0, 2, 0, 1]);

  // IVI: two subplots and DBH, so all three components are available.
  const iviSec = rep.sections.find((s) => s.id === 'ivi');
  // 「植物生態評估技術規範」defines IV＝(相對密度＋相對優勢度＋相對頻度)×100/3
  // and its 範例 2.11 closes with a Sum row of exactly 100. So the scale is
  // 0–100 whatever the component count, and the species must total 100 — that
  // is precisely what makes plots with different component counts comparable.
  eq('IV is on the specification\u2019s 0-100 scale', iviSec.chart.max, 100);
  const ivTotal = iviSec.table.rows
    .filter((r) => r[0] !== 'report.sumRow')
    .reduce((sum, r) => sum + Number(r[r.length - 1]), 0);
  ok(`IV totals 100 across species (got ${ivTotal.toFixed(2)})`, Math.abs(ivTotal - 100) < 0.05);

  // 範例 2.11's layout: density per hectare by dbh class, basal area per
  // hectare, IV100, closed by a Sum row.
  eq('table follows the specification columns', iviSec.table.columns.slice(1, 5),
     ['1-3', '3-10', '>10', 'report.dbhClassAll']);
  eq('and carries basal area per hectare', iviSec.table.columns[5], 'report.colBasalAreaHa');
  eq('and IV100', iviSec.table.columns[6], 'report.colIv100');
  const sumRow = iviSec.table.rows[iviSec.table.rows.length - 1];
  eq('closed by a Sum row', sumRow[0], 'report.sumRow');
  // 4 stems in 100 m² = 400/ha, and the class columns must add up to it.
  eq('Sum row totals the density classes', sumRow[4], '400');
  eq('class columns add to the total',
     String(Number(sumRow[1]) + Number(sumRow[2]) + Number(sumRow[3])), sumRow[4]);
  eq('Sum row totals IV to 100', sumRow[6], '100.00');

  // Subplot dimensions are absent, so the area comes from the sample-size
  // field — declaring subplots must not silently change the denominator.
  eq('subplots without dims do not claim the area', stand.note, 'report.areaSource.sample-size');
  ok('component count is in the caption', iviSec.note.includes('report.iviComponents'));
  ok('dominance basis is named', iviSec.note.includes('report.iviDominance.basal-area'));

  // Woody data gets BOTH readings: the app weights a DBH species by basal
  // area, the specification counts stems (「木本植物以株數計算」). Neither is
  // silently chosen.
  const divDual = rep.sections.find((s) => s.id === 'diversity');
  eq('two value columns for woody data', divDual.table.columns.length, 3);
  eq('columns are named', divDual.table.columns.slice(1),
     ['report.basisBasalArea', 'report.basisStems']);
  const stemsD = computeDiversity(asStemCounts([dbh('a', 1, [10, 20]), dbh('b', 2, [20, 30])]));
  const hRow = divDual.table.rows.find((r) => r[0].startsWith('H′'));
  eq('stem-count column matches diversity.ts on transformed records',
     hRow[2], stemsD.shannonH.toFixed(2));
  // The two bases must actually differ here, or the second column would be
  // decoration: 2 stems each vs basal areas of 500π/4 and 1300π/4.
  ok('the two bases give different answers', hRow[1] !== hRow[2]);
  ok('and the difference is explained', divDual.note.includes('report.dualBasisNote'));

  // Cover-only data has no second reading, so it keeps a single column.
  const coverDiv = report.sections.find((s) => s.id === 'diversity');
  eq('non-woody data keeps one value column', coverDiv.table.columns.length, 2);

  // Without declared subplots there is no frequency component, so the scale
  // drops to 0–200. A two-component sum is not comparable with a
  // three-component one, which is why the axis max moves with it.
  const noSubplots = buildPlotReport(
    {
      plot: { ...plot, sample_size_value: 100, sample_size_unit: 'm2' },
      projectName: '', layers: [], subplots: [],
      species: [dbh('a', 1, [10, 20]), dbh('b', 2, [20, 30])], trackSegments: [],
    },
    t,
  );
  const ivi2 = noSubplots.sections.find((s) => s.id === 'ivi');
  // The scale does NOT change with the component count — IV is a mean, not a
  // sum, so two components still run 0–100 and still total 100. The component
  // count is disclosed in the caption instead.
  eq('two components keep the 0-100 scale', ivi2.chart.max, 100);
  const ivTotal2 = ivi2.table.rows
    .filter((r) => r[0] !== 'report.sumRow')
    .reduce((sum, r) => sum + Number(r[r.length - 1]), 0);
  ok('two-component IV still totals 100', Math.abs(ivTotal2 - 100) < 0.05);
  ok('and the omission is explained', ivi2.note.includes('report.iviOmitted'));
}

// ── plot area: the resolver that guards every per-hectare figure ──────────
{
  const area = (over = {}) =>
    resolvePlotArea({
      plotType: 'fixed', subplots: [], pointRadiusM: null,
      sampleSizeValue: null, sampleSizeUnit: null, ...over,
    });

  // Precedence: subplots beat radius beat sample size.
  const sub = area({ subplots: [{ width_m: 5, length_m: 5 }, { width_m: 5, length_m: 5 }],
                     pointRadiusM: 10, sampleSizeValue: 1, sampleSizeUnit: 'ha' });
  ok('subplot sum wins', sub.ok && sub.source === 'subplots');
  eq('subplot area summed', sub.areaM2, 50);

  // A partial sum UNDER-reports the area, which inflates every per-ha figure.
  // Refusing is the only safe answer.
  const partial = area({ subplots: [{ width_m: 5, length_m: 5 }, { width_m: 5, length_m: null }] });
  eq('incomplete subplot dims refused', partial.ok, false);
  eq('…with the reason', partial.reason, 'subplot-dims-missing');

  // Subplots that record NO geometry are not a partial sum and carry no
  // under-reporting risk, so the plot-level size is still usable.
  const noDims = area({
    subplots: [{ width_m: null, length_m: null }, { width_m: null, length_m: null }],
    sampleSizeValue: 100, sampleSizeUnit: 'm2',
  });
  ok('dimensionless subplots fall through', noDims.ok && noDims.source === 'sample-size');
  eq('…to the recorded area', noDims.areaM2, 100);

  const pc = area({ plotType: 'point_count', pointRadiusM: 10 });
  ok('point count uses pi r squared', pc.ok && Math.abs(pc.areaM2 - Math.PI * 100) < 1e-9);
  eq('zero radius refused', area({ plotType: 'point_count', pointRadiusM: 0 }).reason, 'zero-radius');

  eq('hectares converted', area({ sampleSizeValue: 0.5, sampleSizeUnit: 'ha' }).areaM2, 5000);
  eq('CJK unit accepted', area({ sampleSizeValue: 100, sampleSizeUnit: '平方公尺' }).areaM2, 100);
  eq('full-width and spacing tolerated', area({ sampleSizeValue: 2, sampleSizeUnit: ' M² ' }).areaM2, 2);
  eq('are accepted', area({ sampleSizeValue: 3, sampleSizeUnit: '公畝' }).areaM2, 300);

  // The refusals that matter. "10 m" for a 10x10 plot is a LENGTH; reading it
  // as 10 m² understates the area 100-fold and inflates every density to match.
  eq('bare metres refused', area({ sampleSizeValue: 10, sampleSizeUnit: 'm' }).reason, 'unrecognised-unit');
  eq('bare cm refused', area({ sampleSizeValue: 10, sampleSizeUnit: 'cm' }).reason, 'unrecognised-unit');
  eq('lone a refused', area({ sampleSizeValue: 10, sampleSizeUnit: 'a' }).reason, 'unrecognised-unit');
  eq('missing size refused', area({ sampleSizeUnit: 'ha' }).reason, 'no-sample-size');
  eq('non-positive refused', area({ sampleSizeValue: 0, sampleSizeUnit: 'ha' }).reason, 'non-positive');
  eq('unit parser rejects length', parseAreaUnit('m'), null);
}

// ── stand structure: density, basal area, size classes ────────────────────
{
  const dbh = (id, stems) =>
    sp(id, { organism_quantity: JSON.stringify(stems), organism_quantity_type: 'DBH (cm)' });

  // 4 stems of 10 / 20 / 20 / 30 cm in 100 m².
  //   basal area = pi(5^2 + 10^2 + 10^2 + 15^2) = 450 pi cm^2 = 0.14137167 m^2
  //   400 stems/ha, 14.1372 m^2/ha, QMD = sqrt(1800/4) = sqrt(450) = 21.2132 cm
  const d = standDensity([dbh('a', [10, 20]), dbh('b', [20, 30])], 100);
  eq('stems counted from the array', d.stems, 4);
  eq('stems per hectare', Number(d.stemsPerHa.toFixed(4)), 400);
  eq('basal area m2', Number(d.basalAreaM2.toFixed(6)), Number((450 * Math.PI / 10000).toFixed(6)));
  eq('basal area per hectare', Number(d.basalAreaM2PerHa.toFixed(4)), 14.1372);
  eq('quadratic mean diameter', Number(d.quadraticMeanDbhCm.toFixed(4)), 21.2132);
  eq('no stems, no figures', standDensity([sp('x', { organism_quantity: '3', organism_quantity_type: 'Braun-Blanquet Scale' })], 100), null);

  const dist = dbhDistribution([dbh('a', [10, 20]), dbh('b', [20, 30])]);
  eq('bin width kept at 5', dist.binWidthCm, 5);
  // Classes run [1,5) [5,10) [10,15) [15,20) [20,25) [25,30) [30,35). The
  // first begins at the specification's 1 cm recording threshold, not at 0 —
  // a guaranteed-empty 0–5 class reads as "no small stems" when it is only an
  // artefact of where the axis started.
  eq('first class starts at the recording threshold', dist.bins[0].lowCm, 1);
  eq('bins reach the largest stem', dist.bins.length, 7);
  eq('stems binned', dist.bins.map((b) => b.stems), [0, 0, 1, 0, 2, 0, 1]);
  eq('total stems preserved', dist.stems, 4);
  eq('every stem lands in a class',
     dist.bins.reduce((n, b) => n + b.stems, 0), dist.stems);
  const wide = dbhDistribution([dbh('a', [5, 200])], { binWidthCm: 5, maxBins: 12 });
  ok('bin width widens rather than emitting slivers', wide.binWidthCm > 5);
  ok('and stays within the cap', wide.bins.length <= 12);
}

// ── importance value, with graceful component degradation ─────────────────
{
  const dbhIn = (id, sub, stems) =>
    sp(id, { subplot_id: sub, organism_quantity: JSON.stringify(stems),
             organism_quantity_type: 'DBH (cm)' });
  // a: 2 stems of 10 in subplot 1, 1 of 20 in subplot 2  -> 3 stems, 150pi
  // b: 1 stem of 30 in subplot 1                          -> 1 stem, 225pi
  const recs = [dbhIn('a', 1, [10, 10]), dbhIn('a', 2, [20]), dbhIn('b', 1, [30])];
  const occ = relativeFrequency(recs, [1, 2]);
  const ivi = importanceValue(recs, occ);

  eq('all three components derivable from DBH', ivi.components, ['density', 'dominance', 'frequency']);
  eq('dominance is basal area', ivi.dominanceBasis, 'basal-area');
  const a = ivi.rows.find((r) => r.key.startsWith('a'));
  const b = ivi.rows.find((r) => r.key.startsWith('b'));
  eq('relative density a', Number(a.relDensity.toFixed(4)), 75);
  eq('relative density b', Number(b.relDensity.toFixed(4)), 25);
  eq('relative dominance a', Number(a.relDominance.toFixed(4)), 40);
  eq('relative dominance b', Number(b.relDominance.toFixed(4)), 60);
  // occupancy a = 2/2 = 1, b = 1/2 = 0.5; relative frequency renormalises to
  // shares of the summed frequency (1.5), which is the IVI sense.
  eq('occupancy is reported unchanged', Number(a.occupancy.toFixed(4)), 1);
  eq('relative frequency a', Number(a.relFrequency.toFixed(4)), 66.6667);
  eq('relative frequency b', Number(b.relFrequency.toFixed(4)), 33.3333);
  // Each component sums to 100, so three components sum to 300.
  const total = ivi.rows.reduce((s, r) => s + r.sum, 0);
  eq('IVI totals 300 across species', Number(total.toFixed(6)), 300);
  eq('normalised divides by the component count', Number(a.normalised.toFixed(4)),
     Number((a.sum / 3).toFixed(4)));
  eq('rows sorted by IVI', ivi.rows[0].key, a.key);

  // Every component individually sums to 100 — the assertion that proves this
  // is IVI's relative frequency and not occupancy.
  const sumOf = (f) => Number(ivi.rows.reduce((s, r) => s + (f(r) ?? 0), 0).toFixed(6));
  eq('relative frequency sums to 100', sumOf((r) => r.relFrequency), 100);
  eq('relative density sums to 100', sumOf((r) => r.relDensity), 100);
  eq('relative dominance sums to 100', sumOf((r) => r.relDominance), 100);

  // Cover data has no stems: two components only, and the basis must be named
  // because relative cover is NOT basal area.
  const bbIn = (id, sub, code) =>
    sp(id, { subplot_id: sub, organism_quantity: code,
             organism_quantity_type: 'Braun-Blanquet Scale' });
  const cover = [bbIn('a', 1, '4'), bbIn('a', 2, '3'), bbIn('b', 1, '2')];
  const iviCover = importanceValue(cover, relativeFrequency(cover, [1, 2]));
  eq('cover gives two components', iviCover.components, ['dominance', 'frequency']);
  eq('and says dominance is cover', iviCover.dominanceBasis, 'cover');
  ok('density is omitted with a reason',
     iviCover.omitted.some((o) => o.component === 'density' && o.reason === 'no-stems'));
  ok('two-component sums stay within 200', iviCover.rows.every((r) => r.sum <= 200 + 1e-9));
  eq('normalised divides by two', Number(iviCover.rows[0].normalised.toFixed(4)),
     Number((iviCover.rows[0].sum / 2).toFixed(4)));

  // A single sampling unit cannot yield a frequency component.
  const one = importanceValue(recs, relativeFrequency(recs, [1]));
  ok('one unit drops frequency', !one.components.includes('frequency'));
  ok('with the reason recorded',
     one.omitted.some((o) => o.component === 'frequency' && o.reason === 'need-2-units'));

  eq('empty occupancy renormalises to empty', iviRelativeFrequency(new Map()).size, 0);
}

// ── the seven Phase-1 defects, each pinned ────────────────────────────────
{
  const counted = (id, n, extra = {}) =>
    sp(id, { organism_quantity: String(n), organism_quantity_type: 'individuals', ...extra });
  const bb = (id, code, extra = {}) =>
    sp(id, { organism_quantity: code, organism_quantity_type: 'Braun-Blanquet Scale', ...extra });

  // 1. The mixed-unit caveat must travel WITH the dominants chart. A reader
  //    looking at those bars alone could not previously tell that a Br.-Bq.
  //    midpoint had been weighed against an individual count.
  const mixedRep = buildPlotReport(
    { plot, projectName: '', layers: [], subplots: [],
      species: [counted('a', 10), bb('b', '4')], trackSegments: [] },
    t,
  );
  const dom = mixedRep.sections.find((s) => s.id === 'dominants');
  ok('dominants chart carries a basis note', !!dom.chart.note);
  ok('mixed basis is called out on the chart', dom.chart.note.includes('plotStats.lossyNote'));

  // 2. Max abundance went through a bare Number(), so BB codes and DBH arrays
  //    became NaN and printed as an empty cell that read as "no data".
  const bbProject = buildProjectReport(
    { project: { id: 1, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [{ plot: plotA, species: [bb('a', '4')], subplotIds: [] }],
      counts: { session: 0, plot: 1, collection: 0 }, siteCount: 0 },
    t,
  );
  const spSec = bbProject.sections.find((s) => s.id === 'species');
  eq('BB max abundance is the cover midpoint, not blank', spSec.table.rows[0][4], '63');
  ok('max-abundance column states its basis', (spSec.note ?? '').includes('report.maxAbundanceBasis'));

  const dbhProject = buildProjectReport(
    { project: { id: 1, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [{ plot: plotA,
        species: [sp('a', { organism_quantity: '[10,20]', organism_quantity_type: 'DBH (cm)' })],
        subplotIds: [] }],
      counts: { session: 0, plot: 1, collection: 0 }, siteCount: 0 },
    t,
  );
  const dbhCell = Number(dbhProject.sections.find((s) => s.id === 'species').table.rows[0][4]);
  // π(5² + 10²) = 125π ≈ 392.699 cm² of basal area
  ok('DBH max abundance is basal area', Math.abs(dbhCell - Math.PI * 125) < 0.5);

  // 3. Chao1 and Chao2 answer different questions; one chart must not mix them.
  const mixedEstimators = buildProjectReport(
    { project: { id: 1, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [
        { plot: plotA, species: [counted('a', 1), counted('b', 1)], subplotIds: [] },
        { plot: plotB, species: [bb('c', '3')], subplotIds: [] },
      ],
      counts: { session: 0, plot: 2, collection: 0 }, siteCount: 0 },
    t,
  );
  const eff = mixedEstimators.sections.find((s) => s.id === 'effort');
  ok('no estimate when plots disagree', eff.chart.rows.every((r) => r.value2 == null));
  ok('and the reason is stated', (eff.chart.note ?? '').includes('effortMixedEstimators'));

  const bothChao1 = buildProjectReport(
    { project: { id: 1, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [
        { plot: plotA, species: [counted('a', 1), counted('b', 1)], subplotIds: [] },
        { plot: plotB, species: [counted('c', 1), counted('d', 2)], subplotIds: [] },
      ],
      counts: { session: 0, plot: 2, collection: 0 }, siteCount: 0 },
    t,
  );
  const eff1 = bothChao1.sections.find((s) => s.id === 'effort');
  ok('estimator is named in the legend', eff1.chart.seriesLabels[1].includes('Chao1'));
  ok('and every bar has one', eff1.chart.rows.every((r) => r.value2 != null));

  // 5. A counted checklist qualifies for Chao1; the section was omitted entirely.
  const sessRep2 = buildSessionReport(
    { session: { id: 1, name: 'S', started_at: 1, ended_at: null, recorded_by: null,
                 gps_mode: null, notes: null },
      projectName: '', species: [counted('a', 1), counted('b', 1), counted('c', 5)] },
    t,
  );
  ok('checklist gets a sampling-effort section', sessRep2.sections.some((s) => s.id === 'effort'));

  // 6. The vertical profile was upside down: layerProfile returns E1→E6
  //    ascending and all three renderers draw row 0 at the top.
  const layered = buildPlotReport(
    { plot, projectName: '',
      layers: [
        { layer_index: 1, cover_pct: 30, height_cm: 20, height_unit: 'cm', method: 'BB' },
        { layer_index: 4, cover_pct: 70, height_cm: 1200, height_unit: 'm', method: 'BB' },
      ],
      subplots: [], species, trackSegments: [] },
    t,
  );
  const lay = layered.sections.find((s) => s.id === 'layers');
  // These heights make it a profile; the chart still reads top-down and the
  // table still reads bottom-up. The two orders are deliberately opposite.
  eq('tallest layer is drawn first', lay.chart.bands[0].label, 'layer.E4');
  eq('table still reads bottom-up', lay.table.rows[0][0], 'layer.E1');
}

// ── chart kinds and the CJK-font guard ────────────────────────────────────
//
// Two invariants no amount of number-checking would catch:
//   1. every chart a builder produces is a kind all three renderers draw. A
//      chart with an unhandled kind does not crash — it silently vanishes,
//      which is how the missing <w:r> wrapper shipped once already.
//   2. no SVG text node anywhere. The app bundles no fonts, so CJK inside an
//      SVG <text> is tofu. Asserted structurally rather than left to review,
//      because the tempting shortcut for any new chart is to put the labels
//      inside the SVG where the geometry already is.
{
  const RENDERABLE = new Set(['bar', 'column', 'line', 'profile']);
  // Built here rather than reused from the blocks above, which scope theirs.
  const projRep = buildProjectReport(
    {
      project: { id: 9, name: 'P', abstract: null, location_description: null, notes: null },
      plots: [
        { plot: plotA, species: speciesA, subplotIds: [11, 12] },
        { plot: plotB, species: speciesB, subplotIds: [21, 22] },
      ],
      counts: { session: 0, plot: 2, collection: 0 },
      siteCount: 0,
    },
    t,
  );
  const sessRep = buildSessionReport(
    {
      session: {
        id: 9, name: 'S', started_at: Date.UTC(2026, 0, 1), ended_at: null,
        recorded_by: null, gps_mode: null, notes: null,
      },
      projectName: '',
      species: speciesA,
    },
    t,
  );
  for (const [name, rep] of [['plot', report], ['project', projRep], ['session', sessRep]]) {
    for (const sec of rep.sections) {
      if (!sec.chart) continue;
      ok(`${name}/${sec.id}: chart declares a kind`, typeof sec.chart.kind === 'string');
      ok(`${name}/${sec.id}: kind '${sec.chart.kind}' is renderable`, RENDERABLE.has(sec.chart.kind));
    }
  }

  const themed = buildReportHtml(report, 'zh-TW');
  // Inline SVG is permitted (a line chart needs it); SVG TEXT never is.
  for (const m of themed.matchAll(/<svg[\s\S]*?<\/svg>/g)) {
    ok('no <text> inside exported SVG', !/<text|<tspan/i.test(m[0]));
  }
  // One accent across all three renderers. These HAD drifted: the HTML used
  // #047857 while the app and Word drew #059669.
  ok('html accent comes from reportTheme', themed.includes(withHash(CHART_PRIMARY)));
  ok('html accent-soft comes from reportTheme', themed.includes(withHash(CHART_SECONDARY)));

  // Source scan: no chart component may import a text primitive from
  // react-native-svg. Same technique as check-i18n / check-bottom-dock.
  const chartsDir = new URL('../src/components/report/charts/', import.meta.url);
  for (const file of readdirSync(chartsDir)) {
    if (!/\.tsx?$/.test(file)) continue;
    const src = readFileSync(new URL(file, chartsDir), 'utf8');
    // `[^;]` keeps the match inside ONE import statement — a looser pattern
    // spans from the first import in the file and picks up `Text` from
    // 'react-native', which is legitimate and lives in every chart.
    const m = src.match(/import([^;]*?)from 'react-native-svg'/);
    ok(`${file}: no Text/TSpan from react-native-svg`, !m || !/\b(Text|TSpan|TextPath)\b/.test(m[1]));
  }
}

// ── DOCX package ───────────────────────────────────────────────────────────
{
  // The same plot report the assertions above already pinned, so anything this
  // block finds is a packaging fault and not a modelling one.
  const zip = unzipSync(buildReportDocx(report));
  const names = Object.keys(zip);
  const text = (n) => strFromU8(zip[n]);

  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
  ]) {
    ok(`docx has ${required}`, names.includes(required));
  }

  const doc = text('word/document.xml');
  const rels = text('word/_rels/document.xml.rels');
  const types = text('[Content_Types].xml');

  // The plot fixture produces charts, so the whole chart apparatus must exist.
  const chartParts = names.filter((n) => /^word\/charts\/chart\d+\.xml$/.test(n));
  ok('docx carries chart parts', chartParts.length >= 2);

  // 1. Every relationship resolves to a part that is actually in the zip.
  const relEntries = [...rels.matchAll(/<Relationship Id="([^"]+)" Type="([^"]+)" Target="([^"]+)"\/>/g)];
  eq('one relationship per chart', relEntries.length, chartParts.length);
  for (const [, id, type, target] of relEntries) {
    eq(
      `rel ${id} is a chart relationship`,
      type,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
    );
    ok(`rel ${id} target exists`, names.includes(`word/${target}`));
    // 2. …and is actually referenced by the document.
    ok(`rel ${id} used by document.xml`, doc.includes(`r:id="${id}"`));
  }
  // 3. …and nothing in the document points at a relationship that is missing.
  for (const m of doc.matchAll(/r:id="([^"]+)"/g)) {
    ok(`document r:id ${m[1]} declared`, rels.includes(`Id="${m[1]}"`));
  }

  // 4. Content types: every part whose extension is not xml/rels needs an
  //    Override, or the consumer does not know what it is holding.
  for (const n of names) {
    if (n.endsWith('.xml') || n.endsWith('.rels')) continue;
    ok(`content type declared for ${n}`, types.includes(`PartName="/${n}"`));
  }
  ok(
    'chart content type declared',
    types.includes('application/vnd.openxmlformats-officedocument.drawingml.chart+xml'),
  );
  ok(
    'embedded workbook content type declared',
    types.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  );

  // 5. The drawing must be inside a run. It is not a corruption if it is not —
  //    Word and LibreOffice both just DROP the chart silently, which is how
  //    this shipped broken the first time.
  ok('drawing wrapped in a run', doc.includes('<w:r><w:drawing>'));
  ok('no drawing directly under a paragraph', !doc.includes('</w:pPr><w:drawing>'));

  // 6. The two table traps from docxLabels.ts, still live here.
  ok('no empty table cell', !/<w:tc>(?:(?!<w:p).)*?<\/w:tc>/s.test(doc));
  ok('body does not end with a table', !doc.includes('</w:tbl><w:sectPr'));

  // 7. Chart part internals: schema order and the externalData wiring.
  for (const part of chartParts) {
    const xml = text(part);
    const n = part.match(/chart(\d+)\.xml/)[1];
    // CT_ChartSpace sequence: … chart, spPr?, txPr?, externalData?
    const iChart = xml.indexOf('</c:chart>');
    const iTxPr = xml.indexOf('<c:txPr>');
    const iExt = xml.indexOf('<c:externalData');
    ok(`${part}: txPr after chart`, iChart >= 0 && iTxPr > iChart);
    ok(`${part}: externalData after txPr`, iExt > iTxPr);
    // The chart's own rels part, and the id it names.
    const relPart = `word/charts/_rels/chart${n}.xml.rels`;
    ok(`${part}: has rels`, names.includes(relPart));
    const chartRels = text(relPart);
    const extId = xml.match(/<c:externalData r:id="([^"]+)"/)[1];
    ok(`${part}: externalData id declared`, chartRels.includes(`Id="${extId}"`));
    ok(
      `${part}: data is an embedded package relationship`,
      chartRels.includes('http://schemas.openxmlformats.org/officeDocument/2006/relationships/package'),
    );
    ok(`${part}: workbook exists`, names.includes(`word/embeddings/chartData${n}.xlsx`));
    for (const tag of ['c:chartSpace', 'c:chart', 'c:plotArea', 'c:barChart', 'c:ser']) {
      const open = (xml.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
      const close = (xml.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      eq(`${part}: <${tag}> balanced`, open, close);
    }
    // Hostile text must be escaped, never raw.
    ok(`${part}: no raw ampersand`, !/&(?!(amp|lt|gt|quot|#\d+);)/.test(xml));
  }

  // 8. The numbers in the chart caches are the model's numbers. Same guarantee
  //    the HTML block gives, one renderer over.
  const dominants = report.sections.find((s) => s.id === 'dominants').chart;
  // The chart part's title is `title (unit)`, so match on the prefix.
  const domXml = chartParts.map(text).find((x) => x.includes(`<a:t>${dominants.title}`));
  ok('dominants chart present in package', !!domXml);
  const cached = [...domXml.matchAll(/<c:numCache>[\s\S]*?<\/c:numCache>/g)]
    .flatMap((m) => [...m[0].matchAll(/<c:v>([^<]+)<\/c:v>/g)].map((v) => Number(v[1])));
  eq(
    'chart cache equals the model rows',
    cached,
    dominants.rows.map((r) => r.value),
  );

  // 9. The embedded workbook is a real OPC package with the same values —
  //    this is what Word opens for "Edit Data".
  const wb = unzipSync(zip[`word/embeddings/chartData1.xlsx`]);
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
  ]) {
    ok(`workbook has ${required}`, Object.keys(wb).includes(required));
  }
  const sheet = strFromU8(wb['xl/worksheets/sheet1.xml']);
  // chartData1 belongs to the FIRST chart in document order, whatever kind it
  // is — the layer figure is a profile, which Word receives as bars carrying
  // the same cover values.
  const firstChart = report.sections.find((s) => s.chart).chart;
  const expected =
    firstChart.kind === 'profile'
      ? firstChart.bands.map((b) => b.value)
      : firstChart.rows.map((r) => r.value);
  eq(
    'workbook values equal the chart values',
    [...sheet.matchAll(/<v>([^<]+)<\/v>/g)].map((m) => Number(m[1])),
    expected,
  );

  // 10. Hostile text reaches three places in a chart — the category cache, the
  //     series name and the workbook cell — and all three are raw XML.
  const nasty = {
    ...report,
    title: 'A & B <script>',
    sections: [
      {
        id: 'x',
        heading: 'H & H',
        chart: {
          kind: 'bar',
          title: 'T & <b>',
          seriesLabels: ['S1 & "a"', 'S2 <b>'],
          rows: [{ label: 'L & <i>', value: 1, value2: 2 }],
        },
      },
    ],
  };
  const nastyZip = unzipSync(buildReportDocx(nasty));
  for (const [name, bytes] of Object.entries(nastyZip)) {
    if (!name.endsWith('.xml')) continue;
    const xml = strFromU8(bytes);
    ok(`${name}: ampersands escaped`, !/&(?!(amp|lt|gt|quot|#\d+);)/.test(xml));
    ok(`${name}: no injected element`, !xml.includes('<script>') && !xml.includes('<b>'));
  }
  const nastySheet = strFromU8(
    unzipSync(nastyZip['word/embeddings/chartData1.xlsx'])['xl/worksheets/sheet1.xml'],
  );
  ok('workbook escapes hostile labels', nastySheet.includes('L &amp; &lt;i&gt;'));
}

if (failures > 0) {
  console.error(`check-report: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-report: all assertions passed');
