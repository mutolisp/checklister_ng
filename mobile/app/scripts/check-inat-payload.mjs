/**
 * Fixture check for the iNaturalist pure modules (src/lib/inatPayload.ts,
 * src/lib/inatJwt.ts). No network, no Expo — same contract as
 * check-gbif-parse.mjs. Run: npm run check:inat
 */
import {
  annotationsFor,
  buildDescription,
  syncFingerprint,
  buildObservationPayload,
  centreAndRadius,
  estimateRequests,
  formatObservedOnString,
  inatIdFromLocalTaxonId,
  normaliseSciName,
  parseTags,
  photoMimeType,
  photoUuidFor,
  pickTaxonMatch,
} from '../src/lib/inatPayload.ts';
import { decodeJwtPayload, jwtExpiryMs, jwtUsable, parseTokenText } from '../src/lib/inatJwt.ts';

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
const ok = (label, cond) => {
  if (!cond) fail(label);
};

// ── observed_on_string ─────────────────────────────────────────────────────
{
  const t = Date.UTC(2026, 8, 15, 6, 3, 7); // 2026-09-15T06:03:07Z
  eq('taipei offset', formatObservedOnString(t, 480), '2026-09-15T14:03:07+08:00');
  eq('new york offset', formatObservedOnString(t, -300), '2026-09-15T01:03:07-05:00');
  eq('utc', formatObservedOnString(t, 0), '2026-09-15T06:03:07+00:00');
  // 23:30Z on the 14th is 07:30 on the 15th in Taipei — date must roll.
  eq('midnight rollover', formatObservedOnString(Date.UTC(2026, 8, 14, 23, 30, 0), 480), '2026-09-15T07:30:00+08:00');
  eq('half-hour zone', formatObservedOnString(t, 330), '2026-09-15T11:33:07+05:30');
}

// ── description ────────────────────────────────────────────────────────────
{
  eq('empty', buildDescription(null, []), '');
  eq('notes only', buildDescription('  路邊  ', []), '路邊');
  eq('attrs only', buildDescription('', [{ label: '性別', value: '雌' }]), '性別: 雌');
  eq(
    'notes + attrs',
    buildDescription('路邊', [
      { label: '性別', value: '雌' },
      { label: '', value: 'x' },
      { label: '生活史', value: ' ' },
      { label: '豐度', value: '3 株' },
    ]),
    '路邊\n\n性別: 雌\n豐度: 3 株',
  );
}

// ── tags ───────────────────────────────────────────────────────────────────
{
  eq('parseTags', parseTags(' a, b、c\n a ,, '), ['a', 'b', 'c']);
  eq('parseTags empty', parseTags(''), []);
}

// ── local id → iNat id ─────────────────────────────────────────────────────
{
  eq('gi id', inatIdFromLocalTaxonId('gi12345'), 12345);
  eq('gbif id is not inat', inatIdFromLocalTaxonId('g12345'), null);
  eq('manual', inatIdFromLocalTaxonId('gmabc'), null);
  eq('taicol', inatIdFromLocalTaxonId('t123'), null);
}

// ── payload ────────────────────────────────────────────────────────────────
{
  const base = {
    occurrenceId: '4b0c2b6e-1c7e-4b1e-9d1e-0c1c2b3a4d5e',
    scientificName: 'Ficus formosana var. shimadae',
    localTaxonId: 't1',
    kingdom: 'Plantae',
    observedAtMs: Date.UTC(2026, 8, 15, 6, 3, 7),
    tzOffsetMin: 480,
    location: { lat: 25.03, lng: 121.56, accuracyM: 12.4, source: 'record' },
    notes: 'note',
    attributes: [{ label: 'a', value: 'b' }],
  };
  const p = buildObservationPayload(base, 55, { tags: ['x', 'y'], geoprivacy: 'obscured' });
  eq('payload', p, {
    uuid: base.occurrenceId,
    species_guess: 'Ficus formosana var. shimadae',
    observed_on_string: '2026-09-15T14:03:07+08:00',
    geoprivacy: 'obscured',
    taxon_id: 55,
    latitude: 25.03,
    longitude: 121.56,
    positional_accuracy: 12,
    description: 'note\n\na: b',
    tag_list: 'x,y',
  });
  const p2 = buildObservationPayload(
    { ...base, location: null, notes: null, attributes: [] },
    null,
    { tags: [], geoprivacy: 'open' },
  );
  eq('payload without location/taxon/notes/tags', p2, {
    uuid: base.occurrenceId,
    species_guess: 'Ficus formosana var. shimadae',
    observed_on_string: '2026-09-15T14:03:07+08:00',
    geoprivacy: 'open',
  });
  const p3 = buildObservationPayload(
    { ...base, location: { lat: 1, lng: 2, accuracyM: null, source: 'session' } },
    null,
    { tags: [], geoprivacy: 'open' },
  );
  ok('no accuracy when null', p3.latitude === 1 && !('positional_accuracy' in p3));
  const p4 = buildObservationPayload(
    { ...base, location: { lat: 1, lng: 2, accuracyM: 0, source: 'site' } },
    null,
    { tags: [], geoprivacy: 'open' },
  );
  ok('no accuracy when 0', !('positional_accuracy' in p4));
  const p5 = buildObservationPayload({ ...base, placeGuess: ' 陽明山 ' }, null, { tags: [], geoprivacy: 'open' });
  eq('place_guess trimmed', p5.place_guess, '陽明山');
  ok('no place_guess when blank', !('place_guess' in buildObservationPayload({ ...base, placeGuess: '  ' }, null, { tags: [], geoprivacy: 'open' })));
}

// ── photo uuid ─────────────────────────────────────────────────────────────
{
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const a = photoUuidFor('occ-1', 0);
  ok('uuid format', re.test(a));
  eq('deterministic', photoUuidFor('occ-1', 0), a);
  ok('index differs', photoUuidFor('occ-1', 1) !== a);
  ok('occurrence differs', photoUuidFor('occ-2', 0) !== a);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(photoUuidFor(`occ-${i % 40}`, i));
  eq('no collisions in 2000', seen.size, 2000);
}

// ── name normalisation + matching ──────────────────────────────────────────
{
  eq('var. dropped', normaliseSciName('Ficus formosana var. shimadae'), 'ficus formosana shimadae');
  eq('subsp dropped', normaliseSciName('Pinus taiwanensis subsp. taiwanensis'), 'pinus taiwanensis taiwanensis');
  eq('ssp no dot', normaliseSciName('Pinus taiwanensis ssp taiwanensis'), 'pinus taiwanensis taiwanensis');
  eq('f. dropped', normaliseSciName('Rosa multiflora f. cathayensis'), 'rosa multiflora cathayensis');
  eq('hybrid sign', normaliseSciName('Prunus × yedoensis'), 'prunus yedoensis');
  eq('hybrid x', normaliseSciName('Prunus x yedoensis'), 'prunus yedoensis');
  eq('sensu', normaliseSciName('Abies kawakamii s.l.'), 'abies kawakamii');
  eq('subgenus parens', normaliseSciName('Acer (Palmata) palmatum'), 'acer palmatum');
  eq('formosana stays', normaliseSciName('Ficus formosana'), 'ficus formosana');

  const hits = [
    { id: 1, name: 'Ficus formosana', rank: 'species', is_active: true, iconic_taxon_name: 'Plantae' },
    { id: 2, name: 'Ficus formosana shimadae', rank: 'variety', is_active: true, iconic_taxon_name: 'Plantae' },
    { id: 3, name: 'Ficus formosana shimadae', rank: 'variety', is_active: false, iconic_taxon_name: 'Plantae' },
  ];
  eq('exact wins over normalised', pickTaxonMatch(hits, 'Ficus formosana', 'Plantae'), 1);
  eq('normalised infraspecific', pickTaxonMatch(hits, 'Ficus formosana var. shimadae', 'Plantae'), 2);
  eq('inactive ignored when active exists', pickTaxonMatch(hits.slice(1), 'Ficus formosana var. shimadae', 'Plantae'), 2);
  eq('inactive used when alone', pickTaxonMatch([hits[2]], 'Ficus formosana var. shimadae', 'Plantae'), 3);
  eq('no match', pickTaxonMatch(hits, 'Ficus septica', 'Plantae'), null);

  const homonym = [
    { id: 10, name: 'Acmella', rank: 'genus', is_active: true, iconic_taxon_name: 'Plantae' },
    { id: 11, name: 'Acmella', rank: 'genus', is_active: true, iconic_taxon_name: 'Insecta' },
  ];
  eq('cross-kingdom homonym → plant', pickTaxonMatch(homonym, 'Acmella', 'Plantae'), 10);
  eq('cross-kingdom homonym → animal', pickTaxonMatch(homonym, 'Acmella', 'Animalia'), 11);
  eq('homonym without kingdom → ambiguous', pickTaxonMatch(homonym, 'Acmella', ''), null);
  const twoPlants = [
    { id: 20, name: 'Selaginella japonica', is_active: true, iconic_taxon_name: 'Plantae' },
    { id: 21, name: 'Selaginella japonica', is_active: true, iconic_taxon_name: 'Plantae' },
  ];
  eq('same-kingdom ambiguity → null', pickTaxonMatch(twoPlants, 'Selaginella japonica', 'Plantae'), null);
  eq('missing iconic does not contradict', pickTaxonMatch([{ id: 30, name: 'Ficus', is_active: true }, { id: 31, name: 'Ficus', is_active: true, iconic_taxon_name: 'Insecta' }], 'Ficus', 'Plantae'), 30);
}

// ── geometry ───────────────────────────────────────────────────────────────
{
  eq('empty', centreAndRadius([]), null);
  eq('single point', centreAndRadius([[121.5, 25.0]]), { lat: 25, lng: 121.5, accuracyM: 0 });
  // 0.01° square at the equator: half side = 0.005° ≈ 556.6 m → half-diagonal ≈ 787 m
  const sq = centreAndRadius([
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
    [0, 0.01],
  ]);
  eq('square centre', [sq.lat, sq.lng], [0.005, 0.005]);
  ok('square radius ≈ 787 m', Math.abs(sq.accuracyM - 787) <= 1);
  // 1 km north-south line at lat 25: half = 500 m
  const line = centreAndRadius([
    [121.5, 25.0],
    [121.5, 25.0 + 1000 / 111320],
  ]);
  ok('line radius ≈ 500 m', Math.abs(line.accuracyM - 500) <= 1);
}

// ── annotations ────────────────────────────────────────────────────────────
{
  eq(
    'flowering + fruiting + green leaves',
    annotationsFor({ kingdom: 'Plantae', reproductive: ['flowering', 'fruiting'], leaf: ['green'] }),
    [
      { attribute: 12, value: 13 },
      { attribute: 12, value: 14 },
      { attribute: 36, value: 38 },
    ],
  );
  eq('flower buds / leaf buds / colored', annotationsFor({ kingdom: 'Plantae', reproductive: ['buddingFlower'], leaf: ['buddingLeaf', 'colored'] }), [
    { attribute: 12, value: 15 },
    { attribute: 36, value: 37 },
    { attribute: 36, value: 39 },
  ]);
  eq('unmapped values dropped', annotationsFor({ kingdom: 'Plantae', reproductive: ['sporangia', 'cone'], leaf: ['shedding'] }), []);
  eq('animals get nothing', annotationsFor({ kingdom: 'Animalia', reproductive: ['flowering'], leaf: ['green'] }), []);
  eq('empty', annotationsFor({ kingdom: 'Plantae', reproductive: [], leaf: [] }), []);
  eq('deduped', annotationsFor({ kingdom: 'Plantae', reproductive: ['flowering', 'flowering'], leaf: [] }), [{ attribute: 12, value: 13 }]);

  const animal = (extra) => annotationsFor({ kingdom: 'Animalia', reproductive: [], leaf: [], ...extra });
  eq('sex female', animal({ sex: 'female' }), [{ attribute: 9, value: 10 }]);
  eq('sex male + adult bird', animal({ sex: 'male', lifeStage: 'adult_bird', class: 'Aves' }), [
    { attribute: 9, value: 11 },
    { attribute: 1, value: 2 },
  ]);
  eq('sex unknown → cannot be determined', animal({ sex: 'unknown' }), [{ attribute: 9, value: 20 }]);
  eq('sex on a plant is allowed', annotationsFor({ kingdom: 'Plantae', sex: 'female', reproductive: [], leaf: [] }), [{ attribute: 9, value: 10 }]);
  eq('sex on fungi dropped', annotationsFor({ kingdom: 'Fungi', sex: 'female', reproductive: [], leaf: [] }), []);
  eq('sex on earthworm dropped', animal({ sex: 'male', class: 'Clitellata' }), []);
  eq('juvenile bird', animal({ lifeStage: 'subadult_bird', class: 'Aves' }), [{ attribute: 1, value: 8 }]);
  eq('juvenile insect dropped (Pterygota)', animal({ lifeStage: 'subadult', class: 'Insecta', order: 'Coleoptera' }), []);
  eq('egg (bird)', animal({ lifeStage: 'egg', class: 'Aves' }), [{ attribute: 1, value: 7 }]);
  eq('egg on mammal dropped', animal({ lifeStage: 'egg', class: 'Mammalia' }), []);
  eq('larva → Larva for beetle', animal({ lifeStage: 'larva', class: 'Insecta', order: 'Coleoptera' }), [{ attribute: 1, value: 6 }]);
  eq('larva → Nymph for grasshopper', animal({ lifeStage: 'larva', class: 'Insecta', order: 'Orthoptera' }), [{ attribute: 1, value: 5 }]);
  eq('larva → Nymph for dragonfly', animal({ lifeStage: 'larva', class: 'Insecta', order: 'Odonata' }), [{ attribute: 1, value: 5 }]);
  eq('larva → Larva for frog', animal({ lifeStage: 'larva', class: 'Amphibia', order: 'Anura' }), [{ attribute: 1, value: 6 }]);
  eq('larva on a fish dropped', animal({ lifeStage: 'larva', class: 'Actinopterygii', order: 'Cypriniformes' }), []);
  eq('pupa for moth', animal({ lifeStage: 'pupa', class: 'Insecta', order: 'Lepidoptera' }), [{ attribute: 1, value: 4 }]);
  eq('pupa for true bug dropped', animal({ lifeStage: 'pupa', class: 'Insecta', order: 'Hemiptera' }), []);
  eq('life stage on a plant dropped', annotationsFor({ kingdom: 'Plantae', lifeStage: 'adult', reproductive: [], leaf: [] }), []);
  eq('unknown stage value dropped', animal({ lifeStage: 'teneral' }), []);
}

// ── sync fingerprint ───────────────────────────────────────────────────────
{
  const payload = { uuid: 'u', species_guess: 'Ficus', observed_on_string: 't', geoprivacy: 'open', latitude: 1, longitude: 2, description: 'd' };
  const a = syncFingerprint({ payload, annotations: [{ attribute: 12, value: 13 }], mediaCount: 2 });
  ok('hex', /^[0-9a-f]{16}$/.test(a));
  eq('stable', syncFingerprint({ payload: { ...payload }, annotations: [{ attribute: 12, value: 13 }], mediaCount: 2 }), a);
  ok('geoprivacy/tags/uuid ignored', syncFingerprint({ payload: { ...payload, uuid: 'x', geoprivacy: 'private', tag_list: 'a' }, annotations: [{ attribute: 12, value: 13 }], mediaCount: 2 }) === a);
  ok('coordinate change detected', syncFingerprint({ payload: { ...payload, latitude: 1.1 }, annotations: [{ attribute: 12, value: 13 }], mediaCount: 2 }) !== a);
  ok('annotation change detected', syncFingerprint({ payload, annotations: [], mediaCount: 2 }) !== a);
  ok('media change detected', syncFingerprint({ payload, annotations: [{ attribute: 12, value: 13 }], mediaCount: 3 }) !== a);
  ok('annotation order irrelevant', syncFingerprint({ payload, annotations: [{ attribute: 36, value: 38 }, { attribute: 12, value: 13 }], mediaCount: 2 }) === syncFingerprint({ payload, annotations: [{ attribute: 12, value: 13 }, { attribute: 36, value: 38 }], mediaCount: 2 }));
}

// ── estimates + mime ───────────────────────────────────────────────────────
{
  eq(
    'estimateRequests',
    estimateRequests([
      { photos: 2, audio: 1, needsTaxon: true, mediaDone: 0, hasObservation: false },
      { photos: 2, audio: 0, needsTaxon: false, mediaDone: 1, hasObservation: true },
      { photos: 1, audio: 0, needsTaxon: false, mediaDone: 5, hasObservation: true },
      { photos: 0, audio: 1, needsTaxon: false, mediaDone: 0, hasObservation: false, annotations: 2 },
    ]),
    1 + 1 + 3 + 1 + 0 + (1 + 1 + 2),
  );
  eq('mime heic', photoMimeType('HEIC'), 'image/heic');
  eq('mime default', photoMimeType('jpg'), 'image/jpeg');
  eq('mime unknown', photoMimeType(''), 'image/jpeg');
}

// ── JWT ────────────────────────────────────────────────────────────────────
{
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = 1_800_000_000_000; // fixed clock
  const fresh = `${b64u({ alg: 'HS512' })}.${b64u({ user_id: 42, exp: Math.floor(now / 1000) + 3600 })}.sig-abc_123`;
  const stale = `${b64u({ alg: 'HS512' })}.${b64u({ user_id: 42, exp: Math.floor(now / 1000) - 10 })}.sig`;
  const soon = `${b64u({ alg: 'HS512' })}.${b64u({ user_id: 42, exp: Math.floor(now / 1000) + 60 })}.sig`;
  eq('decode payload', decodeJwtPayload(fresh), { user_id: 42, exp: Math.floor(now / 1000) + 3600 });
  eq('expiry ms', jwtExpiryMs(fresh), (Math.floor(now / 1000) + 3600) * 1000);
  ok('fresh usable', jwtUsable(fresh, now));
  ok('stale unusable', !jwtUsable(stale, now));
  ok('inside margin unusable', !jwtUsable(soon, now));
  ok('inside margin usable with zero margin', jwtUsable(soon, now, 0));
  eq('garbage', decodeJwtPayload('not.a.jwt!'), null);
  eq('two parts', decodeJwtPayload('a.b'), null);
  eq('bad json', decodeJwtPayload('a.' + Buffer.from('nope').toString('base64url') + '.c'), null);

  eq('paste json', parseTokenText(`{"api_token":"${fresh}"}`, now), fresh);
  eq('paste json with whitespace', parseTokenText(`\n  { "api_token" : "${fresh}" }\n`, now), fresh);
  eq('paste bare', parseTokenText(`  ${fresh} `, now), fresh);
  eq('paste inside text', parseTokenText(`copied: {"api_token":"${fresh}"} end`, now), fresh);
  eq('paste stale rejected', parseTokenText(`{"api_token":"${stale}"}`, now), null);
  eq('paste noise rejected', parseTokenText('hello world', now), null);
  eq('paste empty', parseTokenText('', now), null);
}

if (failures > 0) {
  console.error(`\ncheck-inat-payload: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-inat-payload: ok');
