/**
 * Export → import round-trip check for 名錄 / 樣區 ymls.
 *
 * The app has no test runner, and the one failure this feature must never have
 * is silent: a field gets added to a record, the exporter writes it, and the
 * importer quietly drops it (or the reverse). So this drives the two halves
 * against each other, with no device involved:
 *
 *     DB-shaped fixture → buildPlotYamlDoc → yaml.dump → parsePlotYaml → compare
 *
 * It also asserts COVERAGE: every column of the fixture must either appear in
 * the yml or be listed in NOT_RESTORABLE below with a reason. Adding a column
 * to plot_surveys / sessions and forgetting the exporter fails this check.
 *
 * Run: npm run check:roundtrip
 */
import yaml from 'js-yaml';
import { strToU8, zipSync } from 'fflate';
import { buildPlotYamlDoc, buildSessionYamlDoc, recordToYamlItem } from '../src/lib/bundleYaml.ts';
import { parsePlotYaml } from '../src/lib/plotImport.ts';
import { parseSessionYaml } from '../src/lib/sessionImport.ts';
import {
  readRecordImportFromBytes,
  readRecordYamlTextFromBytes,
} from '../src/lib/recordImportZip.ts';

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

// ── Columns that deliberately do not round-trip ───────────────────────────
const NOT_RESTORABLE = {
  id: 'device-local row id',
  project_id: 'exported by name (`project`), re-resolved on import',
  site_id: 'exported as the `site:` block + site.* sidecars',
  status: "imported records are always 'done' (single-active invariant)",
  resumed_at: 'reopen bookkeeping, meaningless for a fresh import',
  created_at: 'set to import time',
  updated_at: 'set to import time',
  env_photos_json: 'exported as `env_photo_files` (filenames, not device URIs)',
  e0_cover_pct: 'legacy pre-v12 column, superseded by plot_survey_layers',
  e0_height_cm: 'legacy', e1_cover_pct: 'legacy', e1_height_cm: 'legacy',
  e2_cover_pct: 'legacy', e2_height_cm: 'legacy', e3_cover_pct: 'legacy',
  e3_height_cm: 'legacy', e0_method: 'legacy', e1_method: 'legacy',
  e2_method: 'legacy', e3_method: 'legacy',
  // Record-level columns that travel under a different key
  session_id: 'structural — the record lives inside its session in the yml',
  plot_survey_id: 'structural — the record lives inside its plot in the yml',
  subplot_id: 'exported as the subplot LABEL (ids are per-device)',
  observed_at: 'exported as eventDate (ISO)',
  photo_paths: 'exported as photo_files / associatedMedia (filenames in the zip)',
  used_scientific_name: 'IS the exported scientificName; recovered from it on import',
  bb_value: 'legacy pre-v9 abundance, superseded by organism_quantity',
  percent: 'legacy pre-v9 abundance',
  dbh_values_json: 'legacy pre-v9 abundance',
  // sessions
  uuid: 'exported as event.eventUUID',
  name: 'exported as event.eventID',
  type: 'exported as event.eventType',
  started_at: 'exported as event.startedAt (ISO)',
  ended_at: 'exported as event.endedAt (ISO)',
  gps_mode: 'exported as event.gpsMode',
  start_lat: 'exported as event.decimalLatitude',
  start_lng: 'exported as event.decimalLongitude',
  track_geojson: 'exported as event.trackGeoJSON (plot: plot.track_geojson)',
  notes: 'exported as event.eventRemarks',
  recorded_by: 'exported as event.recordedBy',
};

/**
 * Fields a record row carries only because `resolveTaxa` joined them on at read
 * time. They are re-derived from `taxon_id` on import, so they are not the
 * exporter's job — but they must be listed, or they drown the real signal.
 */
const DERIVED_FROM_TAXON = new Set([
  'simple_name', 'name_author', 'common_name_c', 'alternative_name_c',
  'family', 'family_c', 'rank', 'is_endemic', 'alien_type', 'is_hybrid',
  'kingdom', 'kingdom_c', 'phylum', 'phylum_c', 'class', 'class_c',
  'order', 'order_c', 'genus', 'genus_c',
  'redlist', 'iucn', 'cites', 'protected',
  'is_terrestrial', 'is_freshwater', 'is_brackish', 'is_marine', 'is_fossil',
  // Derived by applyAdoptedName from the two stored columns + the checklist.
  'used_status', 'used_stale', 'used_accepted_name',
]);

function checkCoverage(label, row, ymlKeys) {
  for (const k of Object.keys(row)) {
    if (ymlKeys.has(k)) continue;
    if (k in NOT_RESTORABLE) continue;
    if (DERIVED_FROM_TAXON.has(k)) continue;
    fail(`${label}: column "${k}" is in neither the yml nor NOT_RESTORABLE`);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────
const SITE = {
  name: '福山樣區',
  notes: '林道終點',
  geometry: { type: 'Polygon', coordinates: [[[121.5, 24.7], [121.6, 24.7], [121.6, 24.8], [121.5, 24.7]]] },
};
const TRACK = JSON.stringify({ type: 'MultiLineString', coordinates: [[[121.5, 24.7], [121.51, 24.71]]] });

const plotRow = {
  id: 7, uuid: 'plot-uuid-1', plotid: 'PLOT_2026_001', plot_type: 'fixed',
  track_geojson: TRACK, track_finalized: 1, project_id: 3, site_id: 2,
  start_ts: 1756500000000, stop_ts: 1756510000000, resumed_at: null, status: 'done',
  decimal_longitude: 121.5, decimal_latitude: 24.7, coord_uncertainty_m: 5,
  point_radius_m: 25, sample_size_value: 400, sample_size_unit: 'm2',
  sampling_protocol: '方形樣區', total_cover_pct: 85, recorded_by: '林政道',
  locality: '福山植物園', field_note: '雨後', elevation_m: 620, slope_deg: 12,
  aspect_deg: 210, terrain_position: '中坡', rock_cover_pct: 5, gravel_cover_pct: 2,
  bareland_cover_pct: 1, vascular_cover_pct: 80, bryophyte_cover_pct: 10,
  lichen_cover_pct: 1, litter_cover_pct: 30, layer_count: 3,
  env_photos_json: '["ph://env1"]',
  e0_cover_pct: null, e0_height_cm: null, e1_cover_pct: null, e1_height_cm: null,
  e2_cover_pct: null, e2_height_cm: null, e3_cover_pct: null, e3_height_cm: null,
  e0_method: 'BB', e1_method: 'BB', e2_method: 'BB', e3_method: 'DBH',
  created_at: 1, updated_at: 2,
};

const plotSpecies = [
  {
    id: 1, plot_survey_id: 7, taxon_id: 't0301', occurrence_id: 'occ-1', subplot_id: 11,
    layer: 'E2', bb_value: null, percent: null, dbh_values_json: null, notes: '幼樹',
    photo_paths: '["ph://a","ph://b"]', observed_at: 1756500100000, created_at: 1,
    sex: 'unknown', life_stage: 'adult', reproductive_condition: '["flowering","fruiting"]',
    leaf_phenology: '["evergreen"]', organism_quantity: '3', organism_quantity_type: 'individuals',
    lat: 24.71, lng: 121.51, accuracy: 4, detection_type: 'seen',
    used_name_id: 165943, used_scientific_name: 'Lycopodium tamariscinum',
    used_status: 'not-accepted', used_stale: false, used_accepted_name: 'Selaginella tamariscina',
    simple_name: 'Lycopodium tamariscinum', name_author: '(P.Beauv.) Desv.', common_name_c: '小西氏石櫟',
    family: 'Fagaceae', family_c: '殼斗科', rank: 'species', is_endemic: 'true',
    alien_type: '', is_hybrid: 'false', kingdom: 'Plantae', kingdom_c: '植物界',
    class: 'Magnoliopsida', class_c: '', phylum: 'Tracheophyta', phylum_c: '',
    order: 'Fagales', order_c: '', genus: 'Lithocarpus', genus_c: '',
    redlist: 'NT', iucn: '', cites: '', protected: '',
  },
  {
    id: 2, plot_survey_id: 7, taxon_id: 't0301', occurrence_id: 'occ-2', subplot_id: null,
    layer: 'E1', bb_value: null, percent: null, dbh_values_json: null, notes: null,
    photo_paths: '["ph://c"]', observed_at: 1756500200000, created_at: 1,
    sex: null, life_stage: null, reproductive_condition: null, leaf_phenology: null,
    organism_quantity: '2', organism_quantity_type: 'individuals',
    lat: null, lng: null, accuracy: null, detection_type: null,
    used_name_id: null, used_scientific_name: null,
    used_status: '', used_stale: false, used_accepted_name: '',
    simple_name: 'Lithocarpus konishii', name_author: 'Hayata', common_name_c: '小西氏石櫟',
    family: 'Fagaceae', family_c: '殼斗科', rank: 'species', is_endemic: 'true',
    alien_type: '', is_hybrid: 'false', kingdom: 'Plantae', kingdom_c: '植物界',
    class: 'Magnoliopsida', class_c: '', phylum: 'Tracheophyta', phylum_c: '',
    order: 'Fagales', order_c: '', genus: 'Lithocarpus', genus_c: '',
    redlist: 'NT', iucn: '', cites: '', protected: '',
  },
];

console.log('check:roundtrip');

// ── 1. Plot ───────────────────────────────────────────────────────────────
{
  const doc = buildPlotYamlDoc({
    plot: plotRow,
    projectName: '森林動態樣區',
    species: plotSpecies,
    layers: [
      { id: 1, plot_survey_id: 7, layer_index: 1, cover_pct: 60, height_cm: 1500, height_unit: 'm', method: 'DBH' },
      { id: 2, plot_survey_id: 7, layer_index: 2, cover_pct: 30, height_cm: 200, height_unit: 'cm', method: 'BB' },
    ],
    subplots: [
      {
        id: 11, plot_survey_id: 7, idx: 1, label: 'S1', width_m: 10, length_m: 10, created_at: 1,
        layers: [{ id: 1, subplot_id: 11, layer_index: 1, cover_pct: 55, height_cm: 1400 }],
      },
    ],
    subplotLabelById: new Map([[11, 'S1']]),
    site: SITE,
    photoNames: new Map([
      ['occ-1', ['t0301_小西氏石櫟_1.jpg', 't0301_小西氏石櫟_2.jpg']],
      ['occ-2', ['t0301_小西氏石櫟_3.jpg']],
    ]),
    envPhotoNames: ['PLOT_2026_001_20260830_env-1.jpg'],
  });

  const back = parsePlotYaml(yaml.dump(doc, { lineWidth: -1, noRefs: true }));

  eq('plot.uuid', back.uuid, plotRow.uuid);
  eq('plot.plotid', back.plotid, plotRow.plotid);
  eq('plot.plot_type', back.plot_type, plotRow.plot_type);
  eq('plot.project', back.project_name, '森林動態樣區');
  eq('plot.layer_count', back.layer_count, plotRow.layer_count);
  eq('plot.track_geojson', back.track_geojson, TRACK);
  eq('plot.track_finalized', back.track_finalized, 1);
  eq('plot.env_photo_files', back.env_photo_files, ['PLOT_2026_001_20260830_env-1.jpg']);
  eq('plot.site', back.site, SITE);
  for (const k of ['start_ts', 'stop_ts', 'recorded_by', 'locality', 'field_note',
    'sampling_protocol', 'sample_size_value', 'sample_size_unit', 'coord_uncertainty_m',
    'point_radius_m',
    'elevation_m', 'slope_deg', 'aspect_deg', 'terrain_position', 'total_cover_pct',
    'rock_cover_pct', 'gravel_cover_pct', 'bareland_cover_pct', 'vascular_cover_pct',
    'bryophyte_cover_pct', 'lichen_cover_pct', 'litter_cover_pct']) {
    eq(`plot.${k}`, back[k], plotRow[k]);
  }
  eq('plot.decimal_latitude', back.decimal_latitude, plotRow.decimal_latitude);
  eq('plot.decimal_longitude', back.decimal_longitude, plotRow.decimal_longitude);

  eq('layers', back.layers, [
    { layer_index: 1, cover_pct: 60, height_cm: 1500, height_unit: 'm', method: 'DBH' },
    { layer_index: 2, cover_pct: 30, height_cm: 200, height_unit: 'cm', method: 'BB' },
  ]);
  eq('subplots', back.subplots, [
    { idx: 1, label: 'S1', width_m: 10, length_m: 10,
      layers: [{ layer_index: 1, cover_pct: 55, height_cm: 1400 }] },
  ]);

  const s0 = back.species[0];
  eq('species[0].occurrence_id', s0.occurrence_id, 'occ-1');
  eq('species[0].taxon_id', s0.taxon_id, 't0301');
  eq('species[0].subplot', s0.subplot, 'S1');
  eq('species[0].layer', s0.layer, 'E2');
  eq('species[0].quantity', [s0.organism_quantity, s0.organism_quantity_type], ['3', 'individuals']);
  eq('species[0].notes', s0.notes, '幼樹');
  eq('species[0].sex', s0.sex, 'unknown');
  eq('species[0].life_stage', s0.life_stage, 'adult');
  eq('species[0].reproductive_condition', s0.reproductive_condition, '["flowering","fruiting"]');
  eq('species[0].leaf_phenology', s0.leaf_phenology, '["evergreen"]');
  eq('species[0].detection_type', s0.detection_type, 'seen');
  eq('species[0].gps', [s0.lat, s0.lng, s0.accuracy], [24.71, 121.51, 4]);
  eq('species[0].observed_at', s0.observed_at, 1756500100000);
  eq('species[0].photo_files', s0.photo_files, ['t0301_小西氏石櫟_1.jpg', 't0301_小西氏石櫟_2.jpg']);
  eq('species[0].name', s0.name, 'Lycopodium tamariscinum');
  eq('species[1].photo_files', back.species[1].photo_files, ['t0301_小西氏石櫟_3.jpg']);
  // The recorder's own determination must survive export → import; reverting
  // it to the accepted name would silently rewrite what they identified.
  eq('species[0].used_name_id', s0.used_name_id, 165943);
  eq('species[0].used_scientific_name', s0.used_scientific_name, 'Lycopodium tamariscinum');
  eq('species[1] has no adoption', back.species[1].used_name_id, null);

  const ymlKeys = new Set(Object.keys(doc.plot));
  ymlKeys.add('layers').add('subplots').add('species');
  checkCoverage('plot_surveys', plotRow, ymlKeys);
  // Record-level columns were never covered — adding one to the table and
  // forgetting the exporter used to pass this check silently.
  checkCoverage('plot_species_records', plotSpecies[0], new Set(Object.keys(doc.species[0])));
}

// ── 2. Session ────────────────────────────────────────────────────────────
{
  const sessionRow = {
    id: 4, uuid: 'session-uuid-1', name: '2026-08-30 09:12', type: 'abundance',
    project_id: 3, site_id: 2, started_at: 1756500000000, ended_at: 1756510000000,
    resumed_at: null, gps_mode: 'full_track', start_lat: 24.7, start_lng: 121.5,
    track_geojson: TRACK, notes: '晴，午後雷陣雨', recorded_by: '林政道,王小明',
  };
  const records = [
    {
      id: 1, session_id: 4, taxon_id: 't0455', occurrence_id: 'socc-1',
      observed_at: 1756500300000, notes: '路邊', photo_paths: '["ph://x"]',
      lat: 24.72, lng: 121.52, accuracy: 8, sex: 'female', life_stage: 'adult',
      reproductive_condition: '["flowering"]', leaf_phenology: '["deciduous"]',
      organism_quantity: '5', organism_quantity_type: 'individuals',
      used_name_id: 166665, used_scientific_name: 'Lycopodium circinale',
      used_status: 'misapplied', used_stale: false, used_accepted_name: 'Ficus caulocarpa',
      simple_name: 'Lycopodium circinale', name_author: 'L.', common_name_c: '大葉雀榕',
      family: 'Moraceae', family_c: '桑科', rank: 'species', is_endemic: 'false',
      alien_type: '', is_hybrid: 'false', kingdom: 'Plantae', kingdom_c: '植物界',
      class: 'Magnoliopsida', class_c: '', phylum: 'Tracheophyta', phylum_c: '',
      order: 'Rosales', order_c: '', genus: 'Ficus', genus_c: '',
      redlist: 'LC', iucn: '', cites: '', protected: '',
    },
  ];

  const doc = buildSessionYamlDoc({
    session: sessionRow,
    projectName: '森林動態樣區',
    records,
    site: SITE,
    photoNames: new Map([['socc-1', ['t0455_大葉雀榕_1.jpg']]]),
  });

  const back = parseSessionYaml(yaml.dump(doc, { lineWidth: -1, noRefs: true }));

  eq('session.uuid', back.uuid, sessionRow.uuid);
  eq('session.name', back.name, sessionRow.name);
  eq('session.type', back.type, 'abundance');
  eq('session.project', back.project_name, '森林動態樣區');
  eq('session.started_at', back.started_at, sessionRow.started_at);
  eq('session.ended_at', back.ended_at, sessionRow.ended_at);
  eq('session.recorded_by', back.recorded_by, sessionRow.recorded_by);
  eq('session.notes', back.notes, sessionRow.notes);
  eq('session.start_lat', back.start_lat, sessionRow.start_lat);
  eq('session.start_lng', back.start_lng, sessionRow.start_lng);
  eq('session.gps_mode', back.gps_mode, 'full_track');
  eq('session.track_geojson', back.track_geojson, TRACK);
  eq('session.site', back.site, SITE);

  const r0 = back.records[0];
  eq('record.occurrence_id', r0.occurrence_id, 'socc-1');
  eq('record.taxon_id', r0.taxon_id, 't0455');
  eq('record.observed_at', r0.observed_at, 1756500300000);
  eq('record.notes', r0.notes, '路邊');
  eq('record.gps', [r0.lat, r0.lng, r0.accuracy], [24.72, 121.52, 8]);
  eq('record.quantity', [r0.organism_quantity, r0.organism_quantity_type], ['5', 'individuals']);
  eq('record.sex', r0.sex, 'female');
  eq('record.life_stage', r0.life_stage, 'adult');
  eq('record.reproductive_condition', r0.reproductive_condition, '["flowering"]');
  eq('record.leaf_phenology', r0.leaf_phenology, '["deciduous"]');
  eq('record.photo_files', r0.photo_files, ['t0455_大葉雀榕_1.jpg']);
  eq('record.name', r0.name, 'Lycopodium circinale');
  eq('record.used_name_id', r0.used_name_id, 166665);
  eq('record.used_scientific_name', r0.used_scientific_name, 'Lycopodium circinale');

  const ymlKeys = new Set(Object.keys(doc.event));
  ymlKeys.add('checklist').add('project').add('site');
  checkCoverage('sessions', sessionRow, ymlKeys);
  // Against the pre-DwC item: the doc's keys are DwC terms, and matching column
  // names against those would compare two different vocabularies.
  checkCoverage('checklist_records', records[0], new Set(Object.keys(recordToYamlItem(records[0]))));
}

// ── 3. Backward compatibility: a pre-v27 yml must still import ───────────
{
  const legacy = `plot:
  uuid: old-uuid
  plotid: OLD_PLOT
  plot_type: fixed
  project: 舊計畫
  layer_count: 4
species:
  - taxon_id: t0301
    layer: E0
    observed_at: 1700000000000
`;
  const back = parsePlotYaml(legacy);
  eq('legacy.uuid', back.uuid, 'old-uuid');
  eq('legacy.site', back.site, null);
  eq('legacy.env_photo_files', back.env_photo_files, []);
  eq('legacy.track_finalized', back.track_finalized, null);
  eq('legacy.species[0].photo_files', back.species[0].photo_files, []);
  // E0 is not a valid layer any more; importPlotSurvey coerces it, the parser
  // just passes it through.
  eq('legacy.species[0].layer', back.species[0].layer, 'E0');

  const legacySession = `event:
  eventID: 舊名錄
  eventDate: 2026-01-02T08:00:00+08:00
  startedAt: 2026-01-02T08:00:00+08:00
checklist:
  - taxonID: t0455
    scientificName: Ficus caulocarpa
    vernacularName: 大葉雀榕
    eventDate: 2026-01-02T08:30:00+08:00
`;
  const s = parseSessionYaml(legacySession);
  eq('legacySession.uuid', s.uuid, '');
  eq('legacySession.type', s.type, 'checklist');
  eq('legacySession.started_at', s.started_at, Date.parse('2026-01-02T08:00:00+08:00'));
  eq('legacySession.records[0].observed_at', s.records[0].observed_at, Date.parse('2026-01-02T08:30:00+08:00'));
  eq('legacySession.site', s.site, null);
}

// ── 4. The export zip itself ─────────────────────────────────────────────
// A user picking the .zip an export produced is the normal case, and reading
// it as text is what failed on device ("the text encoding of its contents
// can't be determined"). Build a zip the way finalizeZip does and read it back.
{
  const BASE = '名錄_森林動態樣區';
  const sessionYml = yaml.dump(
    buildSessionYamlDoc({
      session: {
        id: 1, uuid: 'zip-session-uuid', name: '名錄', type: 'checklist', project_id: 0,
        site_id: null, started_at: 1756500000000, ended_at: 1756503600000, resumed_at: null,
        gps_mode: null, start_lat: null, start_lng: null, track_geojson: null,
        notes: null, recorded_by: null,
      },
      projectName: '森林動態樣區',
      records: [{
        id: 1, session_id: 1, taxon_id: 't0455', occurrence_id: 'z-occ-1',
        observed_at: 1756500300000, notes: null, photo_paths: '["ph://x"]',
        lat: null, lng: null, accuracy: null, sex: null, life_stage: null,
        reproductive_condition: null, leaf_phenology: null,
        organism_quantity: null, organism_quantity_type: null,
        simple_name: 'Ficus caulocarpa', name_author: '(Miq.) Miq.', common_name_c: '大葉雀榕',
        family: 'Moraceae', family_c: '桑科', rank: 'species', is_endemic: 'false',
        alien_type: '', is_hybrid: 'false', kingdom: 'Plantae', kingdom_c: '植物界',
        class: 'Magnoliopsida', class_c: '', phylum: 'Tracheophyta', phylum_c: '',
        order: 'Rosales', order_c: '', genus: 'Ficus', genus_c: '',
        redlist: 'LC', iucn: '', cites: '', protected: '',
      }],
      site: null,
      photoNames: new Map([['z-occ-1', ['t0455_大葉雀榕_1.jpg']]]),
    }),
    { lineWidth: -1, noRefs: true },
  );

  const zip = zipSync({
    [`${BASE}/${BASE}.yml`]: strToU8(sessionYml),
    [`${BASE}/名錄_sp.csv`]: strToU8('taxonID\nt0455\n'),
    [`${BASE}/${BASE}.md`]: strToU8('# 名錄\n'),
    [`${BASE}/photos/t0455_大葉雀榕_1.jpg`]: new Uint8Array([1, 2, 3]),
    [`${BASE}/manifest.json`]: strToU8(JSON.stringify({ app: 'checklister-ng-mobile', kind: 'session' })),
  });

  const read = readRecordImportFromBytes(zip);
  eq('zip.kind', read.kind, 'session');
  eq('zip.session.uuid', read.session.uuid, 'zip-session-uuid');
  eq('zip.session.records', read.session.records.length, 1);
  eq('zip.photos', read.photos.map((p) => p.name), ['t0455_大葉雀榕_1.jpg']);
  // The batch species importer takes this path.
  if (!readRecordYamlTextFromBytes(zip).includes('t0455')) fail('zip → yml text lost the checklist');
  // A bare .yml must still work through the same entry point.
  eq('bare yml kind', readRecordImportFromBytes(strToU8(sessionYml)).kind, 'session');

  // Track fallback: yml with no track + a track.gpx sidecar.
  const plotYml = yaml.dump({
    plot: { uuid: 'gpx-plot', plotid: 'GPX_PLOT', plot_type: 'transect', project: '', layer_count: 1 },
    species: [],
  }, { lineWidth: -1, noRefs: true });
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>' +
    '<trkpt lat="24.7" lon="121.5"></trkpt><trkpt lat="24.71" lon="121.51"></trkpt>' +
    '</trkseg></trk></gpx>';
  const gpxZip = zipSync({
    'P/P.yml': strToU8(plotYml),
    'P/track.gpx': strToU8(gpx),
    'P/manifest.json': strToU8(JSON.stringify({ kind: 'plot' })),
  });
  const gpxRead = readRecordImportFromBytes(gpxZip);
  eq('gpx fallback track', gpxRead.plot.track_geojson,
    JSON.stringify({ type: 'MultiLineString', coordinates: [[[121.5, 24.7], [121.51, 24.71]]] }));

  // Refusals: a multi-record bundle and a 採集 export.
  const bundle = zipSync({
    'bundle_manifest.json': strToU8('{}'),
    'A/A.yml': strToU8(sessionYml),
  });
  try {
    readRecordImportFromBytes(bundle);
    fail('multi-record bundle was accepted');
  } catch (e) {
    eq('bundle refusal', e.code, 'unsupportedBundle');
  }
  const collection = zipSync({
    'C/C.yml': strToU8('trip: {}\n'),
    'C/manifest.json': strToU8(JSON.stringify({ kind: 'collection' })),
  });
  try {
    readRecordImportFromBytes(collection);
    fail('collection export was accepted');
  } catch (e) {
    eq('collection refusal', e.code, 'unsupportedCollection');
  }
}

if (failures > 0) {
  console.error(`\n✗ round-trip: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ round-trip: 名錄 / 樣區 yml survive export → import with no field lost');
