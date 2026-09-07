/**
 * Fixture check for the SPECIES_LIST pure module (src/lib/gbifSpeciesList.ts).
 *
 * The parts that break silently: a header-order change shifting fields, a
 * synonym row losing its accepted key, a malformed line killing a 250k-line
 * import, a predicate that quietly drops the taxon filter. All pure, so all
 * checked here with no network — same contract as check-gbif-parse.mjs.
 *
 * Run: npm run check:gbiflist
 */
import {
  buildDownloadRequestBody,
  buildSpeciesListPredicate,
  parseSpeciesListTsv,
} from '../src/lib/gbifSpeciesList.ts';

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

// ── Predicate builder ──────────────────────────────────────────────────────
{
  const p = buildSpeciesListPredicate('LI', []);
  eq('predicate country', p.predicates[0], { type: 'equals', key: 'COUNTRY', value: 'LI' });
  eq(
    'predicate present-only',
    p.predicates[1],
    { type: 'equals', key: 'OCCURRENCE_STATUS', value: 'PRESENT' },
  );
  ok('no TAXON_KEY clause when empty', p.predicates.length === 2);

  const one = buildSpeciesListPredicate('JP', [212]);
  eq('single taxon key uses equals', one.predicates[2], {
    type: 'equals',
    key: 'TAXON_KEY',
    value: '212',
  });
  const many = buildSpeciesListPredicate('JP', [212, 359]);
  eq('multi taxon keys use in', many.predicates[2], {
    type: 'in',
    key: 'TAXON_KEY',
    values: ['212', '359'],
  });

  const body = buildDownloadRequestBody('MC', [6]);
  eq('body format', body.format, 'SPECIES_LIST');
  eq('body sendNotification off by default', body.sendNotification, false);
  ok('no notificationAddresses without email', !('notificationAddresses' in body));
  ok('body carries predicate', body.predicate.type === 'and');

  const notified = buildDownloadRequestBody('MC', [6], 'user@example.org');
  eq('email turns notification on', notified.sendNotification, true);
  eq('email lands in notificationAddresses', notified.notificationAddresses, ['user@example.org']);
  const blank = buildDownloadRequestBody('MC', [6], '  ');
  eq('blank email stays off', blank.sendNotification, false);
}

// ── TSV parser: the 22-column header exactly as the describe endpoint lists ─
const HEADER = [
  'taxonKey',
  'scientificName',
  'acceptedTaxonKey',
  'acceptedScientificName',
  'numberOfOccurrences',
  'taxonRank',
  'taxonomicStatus',
  'kingdom',
  'kingdomKey',
  'phylum',
  'phylumKey',
  'class',
  'classKey',
  'order',
  'orderKey',
  'family',
  'familyKey',
  'genus',
  'genusKey',
  'species',
  'speciesKey',
  'iucnRedListCategory',
].join('\t');

// Keys mirror a REAL Iceland download (0005345-260903145123482): the current
// backbone issues alphanumeric ChecklistBank-style ids, not integers — the
// integer assumption once silently dropped 4,669 of 4,690 rows.
const row = (over = {}) => {
  const base = {
    taxonKey: '5XCJ3',
    scientificName: 'Psilopogon nuchalis (Gould, 1863)',
    acceptedTaxonKey: '5XCJ3',
    acceptedScientificName: 'Psilopogon nuchalis (Gould, 1863)',
    numberOfOccurrences: '1234',
    taxonRank: 'SPECIES',
    taxonomicStatus: 'ACCEPTED',
    kingdom: 'Animalia',
    kingdomKey: '1',
    phylum: 'Chordata',
    phylumKey: '44',
    class: 'Aves',
    classKey: '212',
    order: 'Piciformes',
    orderKey: '1448',
    family: 'Megalaimidae',
    familyKey: '9316',
    genus: 'Psilopogon',
    genusKey: '2492443',
    species: 'Psilopogon nuchalis',
    speciesKey: '5XCJ3',
    iucnRedListCategory: 'LC',
  };
  const merged = { ...base, ...over };
  return HEADER.split('\t')
    .map((h) => merged[h] ?? '')
    .join('\t');
};

{
  const text = [HEADER, row()].join('\n');
  const { rows, skipped } = parseSpeciesListTsv(text);
  eq('one row parsed', rows.length, 1);
  eq('no skips', skipped, 0);
  const r = rows[0];
  eq('alphanumeric taxonKey accepted', r.taxonKey, '5XCJ3');
  eq('author split', r.simpleName, 'Psilopogon nuchalis');
  eq('author kept', r.author, '(Gould, 1863)');
  eq('accepted row has null acceptedTaxonId', r.acceptedTaxonId, null);
  eq('rank lowercased', r.rank, 'species');
  eq('status lowercased', r.taxonomicStatus, 'accepted');
  eq('occurrence count numeric', r.occurrenceCount, 1234);
  eq('iucn code kept', r.iucnCategory, 'LC');
  eq('hierarchy', [r.kingdom, r.class, r.family], ['Animalia', 'Aves', 'Megalaimidae']);
}

// Synonym: acceptedTaxonKey differs → acceptedTaxonId minted with g prefix.
{
  const text = [
    HEADER,
    row({
      taxonKey: '5VH3F',
      scientificName: 'Cyanoderma ruficeps Blyth, 1847',
      acceptedTaxonKey: '9WXYZ',
      taxonomicStatus: 'SYNONYM',
    }),
  ].join('\n');
  const { rows } = parseSpeciesListTsv(text);
  eq('synonym acceptedTaxonId', rows[0].acceptedTaxonId, 'g9WXYZ');
  eq('synonym status', rows[0].taxonomicStatus, 'synonym');
}

// Legacy numeric keys must still work (22 of them in the Iceland file).
{
  const text = [HEADER, row({ taxonKey: '2492463', speciesKey: '2492463' })].join('\n');
  const { rows } = parseSpeciesListTsv(text);
  eq('legacy numeric key accepted', rows[0].taxonKey, '2492463');
}

// Rank filter: family-and-above and UNRANKED (BOLD barcode bins) stay out.
{
  const text = [
    HEADER,
    row({ taxonKey: 'A1', taxonRank: 'FAMILY', scientificName: 'Poaceae' }),
    row({ taxonKey: 'A2', taxonRank: 'KINGDOM', scientificName: 'Fungi' }),
    row({ taxonKey: 'BOLD.ABA9580', taxonRank: 'UNRANKED', scientificName: 'BOLD:ABA9580' }),
    row({ taxonKey: 'A4', taxonRank: 'GENUS', scientificName: 'Carex L.' }),
    row({ taxonKey: 'A5', taxonRank: 'SUBSPECIES' }),
  ].join('\n');
  const { rows, skippedRank } = parseSpeciesListTsv(text);
  eq('high ranks + unranked filtered', skippedRank, 3);
  eq(
    'genus and infraspecific kept',
    rows.map((r) => r.taxonKey).sort(),
    ['A4', 'A5'],
  );
}

// Header order must not matter: shuffle columns.
{
  const cols = HEADER.split('\t');
  const shuffled = [...cols].reverse();
  const values = row().split('\t');
  const byName = Object.fromEntries(cols.map((c, i) => [c, values[i]]));
  const text = [shuffled.join('\t'), shuffled.map((c) => byName[c]).join('\t')].join('\n');
  const { rows } = parseSpeciesListTsv(text);
  eq('reversed header still parses name', rows[0].simpleName, 'Psilopogon nuchalis');
  eq('reversed header still parses count', rows[0].occurrenceCount, 1234);
}

// Malformed lines are skipped, never fatal; blank tail lines are free.
// (A key with whitespace / an empty name is malformed; an unexpected word
// like 'not' is a VALID alphanumeric key now — that changed when the real
// backbone switched to non-numeric ids.)
{
  const text = [HEADER, 'bad key\tCarex L.\t', row(), '', ''].join('\n');
  const { rows, skipped } = parseSpeciesListTsv(text);
  eq('malformed line skipped', skipped, 1);
  eq('good line survives', rows.length, 1);
}

// Duplicate taxonKey keeps the higher occurrence count.
{
  const text = [
    HEADER,
    row({ numberOfOccurrences: '10' }),
    row({ numberOfOccurrences: '99' }),
  ].join('\n');
  const { rows } = parseSpeciesListTsv(text);
  eq('dedup by taxonKey', rows.length, 1);
  eq('dedup keeps max count', rows[0].occurrenceCount, 99);
}

// IUCN phrase form + junk normalize.
{
  const text = [
    HEADER,
    row({ taxonKey: 'K1', iucnRedListCategory: 'VULNERABLE' }),
    row({ taxonKey: 'K2', iucnRedListCategory: 'NOT_APPLICABLE' }),
    row({ taxonKey: 'K3', iucnRedListCategory: 'garbage' }),
  ].join('\n');
  const { rows } = parseSpeciesListTsv(text);
  const byKey = Object.fromEntries(rows.map((r) => [r.taxonKey, r.iucnCategory]));
  eq('iucn phrase → code', byKey['K1'], 'VU');
  eq('iucn NA → empty', byKey['K2'], '');
  eq('iucn junk → empty', byKey['K3'], '');
}

// Missing required header is a loud failure (a wrong file must not import as 0 species).
{
  let threw = false;
  try {
    parseSpeciesListTsv('foo\tbar\n1\t2');
  } catch {
    threw = true;
  }
  ok('wrong header throws', threw);
}

if (failures > 0) {
  console.error(`check-gbif-specieslist: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-gbif-specieslist: all assertions passed');
