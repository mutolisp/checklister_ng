/**
 * Parsing check for the GBIF name lookup (src/lib/gbif.ts `searchNames`).
 *
 * The response shape is the part that breaks silently: a vernacular name in
 * the wrong language, a family sneaking into a species picker, a synonym that
 * loses its accepted name. All of that is pure parsing, so it is checked here
 * against fixtures rather than by tapping through the app with a signal.
 *
 * No network at all: `searchNames` is split into `nameSearchUrl` (request) and
 * `parseNameSearch` (response), and only the pure halves are exercised.
 *
 * Run: npm run check:gbif
 */
import { nameSearchUrl, parseNameSearch } from '../src/lib/gbif.ts';

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

let body = {};
const stub = (b) => { body = b; };
const searchNames = async (q) => (q.trim() ? parseNameSearch(body) : []);

console.log('check:gbif');

// ── A species with a Chinese vernacular name among several languages ──
stub({
  results: [
    {
      key: 5231190,
      scientificName: 'Passer montanus (Linnaeus, 1758)',
      canonicalName: 'Passer montanus',
      authorship: '(Linnaeus, 1758)',
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves',
      order: 'Passeriformes', family: 'Passeridae', genus: 'Passer',
      vernacularNames: [
        { vernacularName: 'Eurasian Tree Sparrow', language: 'eng' },
        { vernacularName: '麻雀', language: 'zho' },
      ],
    },
  ],
});
{
  const [c] = await searchNames('Passer montanus');
  eq('usageKey', c.usageKey, 5231190);
  eq('canonicalName', c.canonicalName, 'Passer montanus');
  eq('author', c.author, '(Linnaeus, 1758)');
  eq('rank', c.rank, 'SPECIES');
  eq('vernacular prefers Chinese', c.vernacularName, '麻雀');
  eq('family', c.family, 'Passeridae');
  const url = nameSearchUrl('Passer montanus');
  if (!url.includes('datasetKey=')) fail('query is not restricted to the backbone dataset');
  if (!url.includes('q=Passer%20montanus')) fail(`query not encoded into the URL: ${url}`);
}

// ── English fallback, then first-listed, then none ──
stub({
  results: [
    { key: 1, scientificName: 'Aus bus', rank: 'SPECIES',
      vernacularNames: [{ vernacularName: 'Some Bird', language: 'eng' },
                        { vernacularName: 'Cierto', language: 'spa' }] },
    { key: 2, scientificName: 'Cus dus', rank: 'SPECIES',
      vernacularNames: [{ vernacularName: 'Solo Español', language: 'spa' }] },
    { key: 3, scientificName: 'Eus fus', rank: 'SPECIES', vernacularNames: [] },
  ],
});
{
  const r = await searchNames('x');
  eq('english fallback', r[0].vernacularName, 'Some Bird');
  eq('first listed when no zh/en', r[1].vernacularName, 'Solo Español');
  eq('no vernacular at all', r[2].vernacularName, '');
}

// ── Rank filter: families/orders must not reach a species picker ──
stub({
  results: [
    { key: 10, scientificName: 'Fagaceae', rank: 'FAMILY' },
    { key: 11, scientificName: 'Fagales', rank: 'ORDER' },
    { key: 12, scientificName: 'Ficus', rank: 'GENUS' },
    { key: 13, scientificName: 'Ficus caulocarpa (Miq.) Miq.', rank: 'SPECIES' },
    { key: 14, scientificName: 'Ficus formosana var. shimadae', rank: 'VARIETY' },
  ],
});
{
  const r = await searchNames('Fic');
  eq('ranks kept', r.map((c) => c.rank), ['GENUS', 'SPECIES', 'VARIETY']);
  // The author must split off the canonical name — sciMatch compares against
  // TaiCOL's author-free simple_name.
  eq('canonical split', r[1].canonicalName, 'Ficus caulocarpa');
  eq('author split', r[1].author, '(Miq.) Miq.');
}

// ── Synonyms carry their accepted name (that is what gets matched locally) ──
stub({
  results: [
    { key: 20, scientificName: 'Ficus retusa L.', canonicalName: 'Ficus retusa',
      rank: 'SPECIES', taxonomicStatus: 'SYNONYM', accepted: 'Ficus microcarpa L.f.' },
  ],
});
{
  const [c] = await searchNames('Ficus retusa');
  eq('status', c.status, 'SYNONYM');
  eq('acceptedName', c.acceptedName, 'Ficus microcarpa L.f.');
}

// ── Degenerate bodies must not throw ──
stub({});
eq('no results key', (await searchNames('x')).length, 0);
stub({ results: [{ scientificName: 'No key here', rank: 'SPECIES' }] });
eq('row without a key is dropped', (await searchNames('x')).length, 0);
stub({ results: [{ key: 7, scientificName: 'Dup', rank: 'SPECIES' },
                 { key: 7, scientificName: 'Dup', rank: 'SPECIES' }] });
eq('duplicate keys collapse', (await searchNames('x')).length, 1);
eq('empty query never calls out', (await searchNames('   ')).length, 0);

if (failures > 0) {
  console.error(`\n✗ gbif parse: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ gbif parse: 俗名語言優先序 / rank 過濾 / 異名接受名 / 畸形回應 都正確');
