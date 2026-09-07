/**
 * Project-export analysis-table check (see scripts/check-roundtrip.mjs for
 * the pattern: pure modules + fixtures, no device).
 *
 * Guards the failure modes that would corrupt an analysis SILENTLY:
 *  - matrix / env row misalignment (vegan joins by position),
 *  - relevé id collisions (resurveyed plotid, subplot shrink leftovers),
 *  - records dropped from the matrix (subplot_id NULL on a split plot),
 *  - aggregation rules (count=sum, BB/percent=max, DBH=stem union),
 *  - env terms missing from the wide pivot,
 *  - JUICE table shape (cell counts, ';;' header, numeric layers),
 *  - DwC-A meta.xml field order drifting from the txt column order.
 *
 * Run: npm run check:vegmatrix
 */
import {
  BB_COVER_PCT,
  BB_ORDINAL,
  aggregateCell,
  buildEnvWide,
  buildMatrix,
  buildMatrixByLayer,
  buildReleveIndex,
  buildReleves,
  buildSpeciesCols,
  buildSpeciesLong,
  coverScaleRows,
  tableToCsv,
} from '../src/lib/vegMatrix.ts';
import { buildJuiceHeader, buildJuiceTable } from '../src/lib/juiceExport.ts';
import {
  DWCA_INTERNALS,
  EVENT_COLS,
  HUMBOLDT_COLS,
  OCCURRENCE_COLS,
} from '../src/lib/dwcArchive.ts';
import { buildPlotEnvRows } from '../src/lib/bundleYaml.ts';

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};
const eq = (label, got, want) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fail(`${label}: got ${a}, expected ${b}`);
};
const ok = (label, cond) => {
  if (!cond) fail(label);
};

// ── Fixtures ────────────────────────────────────────────────────────────────

let plotSeq = 0;
function makePlot(over = {}) {
  plotSeq += 1;
  return {
    id: plotSeq,
    uuid: `uuid-${plotSeq}`,
    plotid: `P${plotSeq}`,
    plot_type: 'fixed',
    track_geojson: null,
    track_finalized: 0,
    project_id: 1,
    site_id: null,
    start_ts: Date.UTC(2026, 0, plotSeq, 4), // distinct days
    stop_ts: null,
    resumed_at: null,
    status: 'done',
    decimal_longitude: 121.5,
    decimal_latitude: 23.5,
    coord_uncertainty_m: 5,
    point_radius_m: null,
    sample_size_value: 100,
    sample_size_unit: 'm²',
    sampling_protocol: 'quadrat',
    total_cover_pct: 90,
    recorded_by: 'tester',
    locality: '測試地',
    field_note: null,
    elevation_m: 1200,
    slope_deg: 20,
    aspect_deg: 90,
    terrain_position: null,
    rock_cover_pct: null,
    gravel_cover_pct: null,
    bareland_cover_pct: null,
    vascular_cover_pct: null,
    bryophyte_cover_pct: null,
    lichen_cover_pct: null,
    litter_cover_pct: 10,
    layer_count: 4,
    env_photos_json: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

let recSeq = 0;
function makeRec(over = {}) {
  recSeq += 1;
  return {
    id: recSeq,
    plot_survey_id: 0,
    taxon_id: `t${recSeq}`,
    occurrence_id: `occ-${recSeq}`,
    subplot_id: null,
    layer: 'E1',
    bb_value: null,
    percent: null,
    dbh_values_json: null,
    notes: null,
    photo_paths: null,
    observed_at: Date.UTC(2026, 0, 1, 5),
    created_at: 0,
    sex: null,
    life_stage: null,
    reproductive_condition: null,
    leaf_phenology: null,
    organism_quantity: '1',
    organism_quantity_type: 'Braun-Blanquet Scale',
    lat: null,
    lng: null,
    accuracy: null,
    detection_type: null,
    used_name_id: null,
    used_scientific_name: null,
    simple_name: `Species ${recSeq}`,
    name_author: 'L.',
    common_name_c: `種${recSeq}`,
    family: 'Testaceae',
    family_c: '測試科',
    rank: 'species',
    is_endemic: '',
    alien_type: '',
    is_hybrid: '',
    kingdom: 'Plantae',
    kingdom_c: '植物界',
    class: '',
    class_c: '',
    phylum: 'Tracheophyta',
    phylum_c: '',
    order: '',
    order_c: '',
    genus: '',
    genus_c: '',
    redlist: '',
    iucn: '',
    cites: '',
    protected: '',
    ...over,
  };
}

const layers4 = (plotId) =>
  [1, 2, 3, 4].map((i, k) => ({
    id: plotId * 10 + i,
    plot_survey_id: plotId,
    layer_index: i,
    cover_pct: 20 * (k + 1),
    height_cm: 100 * (k + 1),
    method: i === 4 ? 'DBH' : 'BB',
    height_unit: i === 4 ? 'm' : 'cm',
  }));

// Plot A: plain fixed plot, two taxa (BB + DBH).
const plotA = makePlot({ plotid: 'A' });
const inputA = {
  plot: plotA,
  projectName: 'proj',
  layers: layers4(plotA.id),
  subplots: [],
  species: [
    makeRec({ taxon_id: 'tA', simple_name: 'Alpha alpha', layer: 'E1', organism_quantity: '2', organism_quantity_type: 'Braun-Blanquet Scale' }),
    makeRec({ taxon_id: 'tB', simple_name: 'Beta beta', layer: 'E4', organism_quantity: '[10,20]', organism_quantity_type: 'DBH (cm)' }),
  ],
};

// Plot B: split into S1/S2, PLUS two direct records (subplot_id NULL — the
// setSubplotCount-shrink / recorded-before-split state) → parent relevé.
const plotB = makePlot({ plotid: 'B' });
const subB1 = { id: 901, plot_survey_id: plotB.id, idx: 1, label: 'S1', width_m: 5, length_m: 5, created_at: 0, layers: [{ id: 1, subplot_id: 901, layer_index: 1, cover_pct: 55, height_cm: 40 }] };
const subB2 = { id: 902, plot_survey_id: plotB.id, idx: 2, label: 'S2', width_m: 5, length_m: 5, created_at: 0, layers: [] };
const inputB = {
  plot: plotB,
  projectName: 'proj',
  layers: layers4(plotB.id),
  subplots: [subB1, subB2],
  species: [
    makeRec({ taxon_id: 'tA', simple_name: 'Alpha alpha', subplot_id: 901, layer: 'E1', organism_quantity: '3', organism_quantity_type: 'Braun-Blanquet Scale' }),
    makeRec({ taxon_id: 'tC', simple_name: 'Gamma gamma', subplot_id: 902, layer: 'E2', organism_quantity: '40', organism_quantity_type: '% cover' }),
    // direct records: same taxon twice with counts → must SUM in one cell
    makeRec({ taxon_id: 'tD', simple_name: 'Delta delta', subplot_id: null, layer: 'T', organism_quantity: '3', organism_quantity_type: 'individuals' }),
    makeRec({ taxon_id: 'tD', simple_name: 'Delta delta', subplot_id: null, layer: 'T', organism_quantity: '4', organism_quantity_type: 'individuals' }),
  ],
};

// Plot C + D: SAME plotid 'C' (resurvey — plotid is not UNIQUE in the schema).
const plotC1 = makePlot({ plotid: 'C', start_ts: Date.UTC(2025, 4, 1, 4) });
const plotC2 = makePlot({ plotid: 'C', start_ts: Date.UTC(2026, 4, 1, 4) });
const mkC = (plot) => ({
  plot,
  projectName: 'proj',
  layers: layers4(plot.id),
  subplots: [],
  species: [makeRec({ taxon_id: 'tA', simple_name: 'Alpha alpha', layer: 'E1', organism_quantity: '+', organism_quantity_type: 'Braun-Blanquet Scale' })],
});

// Plot E: transect, empty (no species) → all-zero row must survive.
const plotE = makePlot({ plotid: 'E', plot_type: 'transect', layer_count: 4 });
const inputE = { plot: plotE, projectName: 'proj', layers: [], subplots: [], species: [] };

const { releves, warnings } = buildReleves([inputA, inputB, mkC(plotC1), mkC(plotC2), inputE]);

// ── 1. relevé numbering & ids ───────────────────────────────────────────────
console.log('check:vegmatrix');
eq('releve count (A, B-parent, B-S1, B-S2, C, C_dated, E)', releves.length, 7);
eq('releveNr sequence', releves.map((r) => r.nr), [1, 2, 3, 4, 5, 6, 7]);
ok('releveIds unique', new Set(releves.map((r) => r.id)).size === releves.length);
ok('resurvey id got a suffix', releves.some((r) => /^C_\d{8}$/.test(r.id) || /^C_\d{8}_\d+$/.test(r.id)));
ok('split plot parent relevé exists (subplot_id NULL records kept)',
  releves.some((r) => r.id === 'B' && r.records.length === 2));
ok('warnings mention the un-assigned records', warnings.some((w) => w.includes('未歸屬小區')));

// ── 2. aggregation rules ────────────────────────────────────────────────────
const bb = aggregateCell(
  [
    { organism_quantity: '2', organism_quantity_type: 'Braun-Blanquet Scale' },
    { organism_quantity: '+', organism_quantity_type: 'Braun-Blanquet Scale' },
  ],
  'cover',
);
eq('BB aggregation takes the higher code', bb.bbCode, '2');
eq('BB cover value', bb.num, BB_COVER_PCT['2']);
const cnt = aggregateCell(
  [
    { organism_quantity: '3', organism_quantity_type: 'individuals' },
    { organism_quantity: '4', organism_quantity_type: 'individuals' },
  ],
  'cover',
);
eq('counts SUM', cnt.num, 7);
const pct = aggregateCell(
  [
    { organism_quantity: '10', organism_quantity_type: '% cover' },
    { organism_quantity: '40', organism_quantity_type: '% cover' },
  ],
  'cover',
);
eq('percent takes max', pct.num, 40);
const dbh = aggregateCell(
  [
    { organism_quantity: '[10]', organism_quantity_type: 'DBH (cm)' },
    { organism_quantity: '[20]', organism_quantity_type: 'DBH (cm)' },
  ],
  'cover',
);
const ba = Math.PI * 25 + Math.PI * 100;
ok('DBH stems union → basal area sum', Math.abs(dbh.num - ba) < 1e-6);

// ── 3. matrix / env alignment ───────────────────────────────────────────────
const cols = buildSpeciesCols(releves);
const merged = buildMatrix(releves, cols, 'cover');
const layered = buildMatrixByLayer(releves, cols, 'cover');
const env = buildEnvWide(releves);
eq('matrix rows == relevé count', merged.rows.length, releves.length);
eq('layered rows == relevé count', layered.rows.length, releves.length);
eq('env rows == relevé count', env.rows.length, releves.length);
eq('row order aligned (merged vs env)', merged.rows.map((r) => r[0]), env.rows.map((r) => r[0]));
eq('row order aligned (layered vs env)', layered.rows.map((r) => r[0]), env.rows.map((r) => r[0]));
ok('empty transect relevé kept as all-zero row',
  merged.rows.some((r) => r[0] === 'E' && r.slice(1).every((v) => v === '0')));
// count aggregation visible in the merged matrix (tD col on parent B row)
const tdCol = merged.header.indexOf(cols.find((c) => c.taxonId === 'tD').name);
const bRow = merged.rows.find((r) => r[0] === 'B');
eq('summed count lands in matrix', bRow[tdCol], '7');

// ── 4. env pivot covers every buildPlotEnvRows term ────────────────────────
const tallTerms = new Set(buildPlotEnvRows(plotA, 'proj', layers4(plotA.id)).map((r) => r.term));
for (const term of tallTerms) {
  ok(`env.csv column: ${term}`, env.header.includes(term));
}
ok('subplot columns present', env.header.includes('subplotLabel') && env.header.includes('subplotWidthM'));
// subplot layer override actually applied
const s1Row = env.rows.find((r) => r[0] === 'B-S1');
const e1CoverIdx = env.header.indexOf('e1CoverPct');
eq('subplot e1 cover overrides plot value', s1Row[e1CoverIdx], '55');

// ── 5. conversion tables vs cover_scale rows ────────────────────────────────
for (const row of coverScaleRows()) {
  eq(`cover_scale ${row.bbCode} cover`, row.coverPct, BB_COVER_PCT[row.bbCode]);
  eq(`cover_scale ${row.bbCode} ordinal`, row.ordinal, BB_ORDINAL[row.bbCode]);
}
eq('BB code sets identical', Object.keys(BB_COVER_PCT).sort(), Object.keys(BB_ORDINAL).sort());

// ── 6. JUICE table shape ────────────────────────────────────────────────────
const juice = buildJuiceTable(releves, cols, 'proj (checklister-ng)');
const jLines = juice.text.split('\n');
eq('JUICE line 2', jLines[1], `Number of relevés: ${releves.length}`);
eq('JUICE line 3 blank', jLines[2], '');
ok('JUICE header starts with ;; (layer column present)', jLines[3].startsWith(';;'));
eq('JUICE header relevé numbers', jLines[3].slice(2), releves.map((r) => r.nr).join(';'));
for (const line of jLines.slice(4)) {
  const cells = line.split(';');
  eq(`JUICE row cell count (${cells[0]})`, cells.length, 2 + releves.length);
  ok(`JUICE layer numeric or empty (${cells[0]}: "${cells[1]}")`, /^[1-9]?$/.test(cells[1]));
}
ok('lossy taxa reported (count/DBH → presence 1)', juice.lossyTaxa.length >= 2);
const jHeader = buildJuiceHeader(releves).split('\n');
eq('JUICE header rows == relevés', jHeader.length - 1, releves.length);
ok('JUICE header date is YYYYMMDD', /^\d{8}$/.test(jHeader[1].split(';')[2]));

// ── 7. DwC-A meta.xml field order matches the txt column order ─────────────
const metaXml = DWCA_INTERNALS.buildMetaXml();
function metaFields(sectionRe) {
  const section = metaXml.match(sectionRe)[0];
  return [...section.matchAll(/<field index="(\d+)" term="([^"]+)"\/>/g)].map((m) => ({
    index: Number(m[1]),
    local: m[2].split('/').pop(),
  }));
}
const coreFields = metaFields(/<core[\s\S]*?<\/core>/);
eq('core field terms in EVENT_COLS order', coreFields.map((f) => f.local), EVENT_COLS.map((c) => c.term.split('/').pop()));
eq('core field indices', coreFields.map((f) => f.index), EVENT_COLS.map((_, i) => i));
const extSections = [...metaXml.matchAll(/<extension[\s\S]*?<\/extension>/g)].map((m) => m[0]);
const occFields = [...extSections[0].matchAll(/<field index="(\d+)" term="([^"]+)"\/>/g)];
eq('occurrence field count', occFields.length, OCCURRENCE_COLS.length);
eq('occurrence indices start at 1 (coreid=0)', Number(occFields[0][1]), 1);
eq('occurrence terms in order', occFields.map((m) => m[2].split('/').pop()), OCCURRENCE_COLS.map((c) => c.term.split('/').pop()));
const humFields = [...extSections[1].matchAll(/<field index="(\d+)" term="([^"]+)"\/>/g)];
eq('humboldt terms in order', humFields.map((m) => m[2].split('/').pop()), HUMBOLDT_COLS.map((c) => c.term.split('/').pop()));
ok('humboldt rowType is eco Event', extSections[1].includes('rowType="http://rs.tdwg.org/eco/terms/Event"'));
// txt header matches the same spec arrays
const evtTxt = DWCA_INTERNALS.txtFile(EVENT_COLS, [], false).split('\n')[0].split('\t');
eq('event.txt header', evtTxt, EVENT_COLS.map((c) => c.key));
const occTxt = DWCA_INTERNALS.txtFile(OCCURRENCE_COLS, [], true).split('\n')[0].split('\t');
eq('occurrence.txt header (coreid first)', occTxt, ['coreEventID', ...OCCURRENCE_COLS.map((c) => c.key)]);

// ── 8. csv sanity: no BOM, aligned column counts ───────────────────────────
for (const [name, table] of [
  ['species_matrix', merged],
  ['species_matrix_by_layer', layered],
  ['env', env],
  ['releve_index', buildReleveIndex(releves)],
  ['species_long', buildSpeciesLong(releves, cols, 'cover')],
]) {
  const csv = tableToCsv(table);
  ok(`${name}.csv has no BOM`, !csv.startsWith('﻿'));
  for (const row of table.rows) {
    if (row.length !== table.header.length) {
      fail(`${name}.csv ragged row (${row.length} vs ${table.header.length})`);
      break;
    }
  }
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ vegmatrix: relevés / aggregation / matrices / JUICE / DwC-A all consistent');
