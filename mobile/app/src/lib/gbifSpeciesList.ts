/**
 * GBIF SPECIES_LIST download — the pure half.
 *
 * Predicate/request-body builders and the TSV parser for the country-checklist
 * "region pack" feature. Everything here must stay runnable under plain Node
 * (no expo / i18n / DB imports) so `scripts/check-gbif-specieslist.mjs` can
 * assert on it — same contract as bundleYaml.ts / vegMatrix.ts.
 *
 * Column set verified against the machine-readable format description at
 * https://api.gbif.org/v1/occurrence/download/describe/speciesList
 * (2026-09-07): taxonKey, scientificName, acceptedTaxonKey,
 * acceptedScientificName, numberOfOccurrences, taxonRank, taxonomicStatus,
 * kingdom..species (+ *Key each), iucnRedListCategory. The parser is
 * header-driven anyway, so a column GBIF adds or reorders later cannot shift
 * our fields silently.
 *
 * Verified against a real Iceland download (0005345-260903145123482,
 * 2026-09-08): `taxonKey` is NOT numeric — the current backbone issues
 * ChecklistBank-style uppercase alphanumeric ids ('5XCJ3'), plus 'BOLD.xxx'
 * barcode bins and a few legacy numeric keys. The file also carries rows far
 * above species rank (FAMILY/ORDER/…/KINGDOM, from occurrences identified no
 * further) — those are filtered here by PACK_RANKS.
 */
import { splitScientificName } from './gbif';

/** One row of a parsed SPECIES_LIST file, ready for pack_taxa. */
export type SpeciesListRow = {
  /** GBIF backbone usageKey — becomes local taxon_id 'g' + taxonKey. */
  taxonKey: string;
  /** Canonical name, authorship stripped. */
  simpleName: string;
  author: string;
  rank: string;
  taxonomicStatus: string;
  /** 'g' + acceptedTaxonKey when the row is a synonym; null when accepted. */
  acceptedTaxonId: string | null;
  acceptedScientificName: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  occurrenceCount: number;
  iucnCategory: string;
};

/**
 * Occurrence-search predicate for one country pack.
 *
 * `taxonKeys` are GBIF backbone keys from `gbifGroupKeys()` (already verified
 * against /species/{key}); empty means every kingdom, so the TAXON_KEY clause
 * is omitted entirely. OCCURRENCE_STATUS=PRESENT keeps absence records out —
 * an absence record would otherwise put a species *on* the checklist of a
 * country it was recorded absent from.
 */
export function buildSpeciesListPredicate(countryCode: string, taxonKeys: number[]): object {
  const clauses: object[] = [
    { type: 'equals', key: 'COUNTRY', value: countryCode },
    { type: 'equals', key: 'OCCURRENCE_STATUS', value: 'PRESENT' },
  ];
  if (taxonKeys.length === 1) {
    clauses.push({ type: 'equals', key: 'TAXON_KEY', value: String(taxonKeys[0]) });
  } else if (taxonKeys.length > 1) {
    clauses.push({ type: 'in', key: 'TAXON_KEY', values: taxonKeys.map(String) });
  }
  return { type: 'and', predicates: clauses };
}

/**
 * Body for POST /v1/occurrence/download/request.
 *
 * With `notifyEmail`, GBIF itself emails the user when the file is ready —
 * the one completion channel that works while the app is backgrounded (iOS
 * suspends JS, so the in-app poller cannot fire then).
 */
export function buildDownloadRequestBody(
  countryCode: string,
  taxonKeys: number[],
  notifyEmail?: string,
): object {
  const email = notifyEmail?.trim();
  return {
    format: 'SPECIES_LIST',
    sendNotification: !!email,
    ...(email ? { notificationAddresses: [email] } : {}),
    predicate: buildSpeciesListPredicate(countryCode, taxonKeys),
  };
}

/**
 * Parse a SPECIES_LIST TSV (the single file inside the download zip).
 *
 * Header-driven: columns are located by name, never by position. Rows missing
 * a taxonKey or a scientific name are counted as skipped, not fatal — one
 * malformed line in a 250k-line file must not lose the pack. Duplicate
 * taxonKeys keep the row with the higher occurrence count (the download is
 * distinct-by-species already; duplicates would only appear if GBIF changes
 * the grouping, and UNIQUE(pack_id, taxon_id) would reject them at insert).
 */
/** Shape of every key form seen in real downloads: digits (legacy numeric),
 *  uppercase ChecklistBank ids, 'BOLD.xxx' bins. Anything else is malformed. */
const KEY_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Ranks a pack imports — mirror of gbif.ts's ADDABLE_RANKS (what the GBIF
 * name-lookup lets a user add). Higher ranks (family+) and UNRANKED rows
 * (BOLD barcode bins) would only pollute species search.
 */
export const PACK_RANKS = new Set([
  'genus',
  'species',
  'subspecies',
  'variety',
  'subvariety',
  'form',
  'subform',
]);

export function parseSpeciesListTsv(
  text: string,
): { rows: SpeciesListRow[]; skipped: number; skippedRank: number } {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !lines[0].trim()) return { rows: [], skipped: 0, skippedRank: 0 };
  const header = lines[0].split('\t').map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iTaxonKey = col('taxonKey');
  const iSci = col('scientificName');
  if (iTaxonKey < 0 || iSci < 0) {
    throw new Error(`SPECIES_LIST header missing taxonKey/scientificName: ${header.join(',')}`);
  }
  const iAccKey = col('acceptedTaxonKey');
  const iAccSci = col('acceptedScientificName');
  const iCount = col('numberOfOccurrences');
  const iRank = col('taxonRank');
  const iStatus = col('taxonomicStatus');
  const iKingdom = col('kingdom');
  const iPhylum = col('phylum');
  const iClass = col('class');
  const iOrder = col('order');
  const iFamily = col('family');
  const iGenus = col('genus');
  const iIucn = col('iucnRedListCategory');

  const byKey = new Map<string, SpeciesListRow>();
  let skipped = 0;
  let skippedRank = 0;
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const f = line.split('\t');
    const get = (i: number) => (i >= 0 && i < f.length ? f[i].trim() : '');
    const taxonKey = get(iTaxonKey);
    const sci = get(iSci);
    if (!KEY_RE.test(taxonKey) || !sci) {
      skipped++;
      continue;
    }
    const rank = get(iRank).toLowerCase();
    if (!PACK_RANKS.has(rank)) {
      skippedRank++;
      continue;
    }
    const { name, author } = splitScientificName(sci);
    const accKey = get(iAccKey);
    const count = Number(get(iCount));
    const row: SpeciesListRow = {
      taxonKey,
      simpleName: name,
      author,
      rank,
      taxonomicStatus: get(iStatus).toLowerCase(),
      acceptedTaxonId: KEY_RE.test(accKey) && accKey !== taxonKey ? `g${accKey}` : null,
      acceptedScientificName: get(iAccSci),
      kingdom: get(iKingdom),
      phylum: get(iPhylum),
      class: get(iClass),
      order: get(iOrder),
      family: get(iFamily),
      genus: get(iGenus),
      occurrenceCount: Number.isFinite(count) ? count : 0,
      iucnCategory: normalizeIucn(get(iIucn)),
    };
    const prev = byKey.get(taxonKey);
    if (!prev || row.occurrenceCount > prev.occurrenceCount) byKey.set(taxonKey, row);
  }
  return { rows: [...byKey.values()], skipped, skippedRank };
}

/**
 * GBIF ships IUCN as either the code ("VU") or the phrase
 * ("VULNERABLE"); the app's conservation UI keys on the code.
 */
function normalizeIucn(v: string): string {
  const up = v.trim().toUpperCase();
  if (!up) return '';
  const phrases: Record<string, string> = {
    EXTINCT: 'EX',
    EXTINCT_IN_THE_WILD: 'EW',
    CRITICALLY_ENDANGERED: 'CR',
    ENDANGERED: 'EN',
    VULNERABLE: 'VU',
    NEAR_THREATENED: 'NT',
    LEAST_CONCERN: 'LC',
    DATA_DEFICIENT: 'DD',
    NOT_EVALUATED: 'NE',
    NOT_APPLICABLE: '',
  };
  if (up in phrases) return phrases[up];
  return /^[A-Z]{2}$/.test(up) ? up : '';
}
