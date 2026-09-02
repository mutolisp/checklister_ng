/**
 * GBIF client. Complements `inat.ts` in two ways iNaturalist cannot:
 *
 *   1. TRUE POLYGONS. iNaturalist's spatial parameters are a rectangle or a
 *      radius, so a drawn shape has to be reduced to its bounding box. GBIF's
 *      `geometry=` takes WKT, so the shape the user drew is the shape queried.
 *   2. An authoritative name service (`/species/match`) for names no bundled
 *      checklist knows.
 *
 * How the species list is obtained, and why it is not the obvious way:
 * `facet=speciesKey` returns bare numeric keys, and turning 300 of them into
 * names costs 300 calls to `/species/{key}` — measured at 13-27 s even with 16
 * concurrent requests on a desktop connection, which is not a thing to do on a
 * phone in the field. `facet=scientificName` returns the names directly, so ONE
 * request per taxonomic group replaces hundreds: 1277 names for Yangmingshan in
 * ~1 s.
 *
 * The catch is that a facet carries no other field, so kingdom would be
 * unknown — and `sciMatch` needs it to separate cross-kingdom homonyms. Hence
 * the loop: one faceted request PER GROUP, which makes each result's group (and
 * therefore its kingdom) known by construction rather than by a second lookup.
 */
import { ApiError, getJson, qs, sleep } from './apiFetch';
import type { IconicTaxon } from './inat';

const API = 'https://api.gbif.org/v1';

/** GBIF Backbone Taxonomy. Restricting name search to it keeps results on the
 *  one taxonomy the rest of this app already speaks (`matchName` resolves
 *  against the same backbone). */
const BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

/** Name search runs in front of a waiting user, so it must fail fast — the
 *  20 s default plus connectivity.ts's 6 s probe is 26 s of nothing. */
const NAME_SEARCH_TIMEOUT_MS = 8000;

/**
 * How many group requests run at once.
 *
 * Sequential was ~10 s for the eight kingdoms of a busy area; running a few in
 * parallel brings that to about a third. Two, not more: GBIF was measured
 * answering a burst of faceted queries with HTTP 429 ("Too many API requests
 * have been detected from your client"), so this is a real ceiling rather than
 * a courtesy. `apiFetch` still backs off and retries if one slips through.
 */
const GROUP_CONCURRENCY = 2;

/** Breathing room between one worker's successive requests. */
const GROUP_DELAY_MS = 300;

/**
 * Ceiling on species from one GBIF query.
 *
 * Deliberately NOT `inat.ts`'s MAX_SPECIES. The two have different costs:
 * iNaturalist pages 200 at a time, so its ceiling is really a request budget,
 * while GBIF returns a whole group in ONE faceted request — measured at 5000
 * names in 2.25 s, with no 1000-facet cap on `scientificName` (that cap applies
 * to `speciesKey`). So the limit here is not what the API can give: it is what
 * a 常用名錄 can usefully hold. A single drawn area over Yangmingshan already
 * has more than 5000 species in GBIF, and a list that long is not something
 * anyone reads. The two constants stay equal so switching source does not
 * silently change how much you get.
 */
export const GBIF_MAX_SPECIES = 1000;

/**
 * GBIF backbone keys, every one verified against `/species/{key}` and
 * `/species/match` rather than recalled.
 *
 * `key: null` means the group has NO usable backbone concept and cannot be
 * filtered on directly:
 *   - Reptilia resolves to HIGHERRANK → Chordata (the backbone splits it into
 *     Squamata / Testudines / Crocodylia, none of which match by name either).
 *   - Actinopterygii returns matchType NONE.
 * Selecting either therefore widens the query to its kingdom; `gbifGroupKeys`
 * handles that so the caller never sees a silently-dropped filter.
 */
export const GBIF_GROUPS: Record<IconicTaxon, { key: number | null; kingdom: string }> = {
  Plantae: { key: 6, kingdom: 'Plantae' },
  Fungi: { key: 5, kingdom: 'Fungi' },
  Aves: { key: 212, kingdom: 'Animalia' },
  Mammalia: { key: 359, kingdom: 'Animalia' },
  Reptilia: { key: null, kingdom: 'Animalia' },
  Amphibia: { key: 131, kingdom: 'Animalia' },
  Actinopterygii: { key: null, kingdom: 'Animalia' },
  Insecta: { key: 216, kingdom: 'Animalia' },
  Arachnida: { key: 367, kingdom: 'Animalia' },
  Mollusca: { key: 52, kingdom: 'Animalia' },
};

/** Verified: `/species/1..8` return exactly these. Key 0 is `incertae sedis`. */
const KINGDOMS: { key: number; name: string }[] = [
  { key: 1, name: 'Animalia' },
  { key: 2, name: 'Archaea' },
  { key: 3, name: 'Bacteria' },
  { key: 4, name: 'Chromista' },
  { key: 5, name: 'Fungi' },
  { key: 6, name: 'Plantae' },
  { key: 7, name: 'Protozoa' },
  { key: 8, name: 'Viruses' },
];

const ANIMALIA = { key: 1, name: 'Animalia' };

/**
 * The (key, kingdom) pairs to fetch for a group selection.
 *
 * Nothing selected means every kingdom. A selected group with no backbone key
 * widens to Animalia, which then makes every other animal key redundant — they
 * are dropped so the same species is not fetched twice under two keys.
 */
export function gbifGroupKeys(groups: IconicTaxon[]): { key: number; name: string }[] {
  if (groups.length === 0) return KINGDOMS;
  const picked = groups.map((g) => GBIF_GROUPS[g]);
  const needsWholeAnimalia = picked.some((p) => p.key === null);
  const out: { key: number; name: string }[] = [];
  if (needsWholeAnimalia) out.push(ANIMALIA);
  for (const p of picked) {
    if (p.key === null) continue;
    if (needsWholeAnimalia && p.kingdom === 'Animalia') continue;
    if (!out.some((o) => o.key === p.key)) out.push({ key: p.key, name: p.kingdom });
  }
  return out;
}

export type GbifSpecies = {
  /** Canonical name, author removed. */
  name: string;
  author: string;
  kingdom: string;
  occurrenceCount: number;
};

export type GbifQueryResult = {
  species: GbifSpecies[];
  total: number;
  truncated: boolean;
};

/** A token that ends the canonical part and begins the authorship. */
const AUTHOR_START = /^[([]|^[A-Z]|^\d/;

/** Rank connectors that belong to the canonical name, not the author. */
const RANK_TOKENS = new Set([
  'var.', 'subsp.', 'ssp.', 'f.', 'fo.', 'forma', 'cv.', '×', 'x',
  'sect.', 'ser.', 'subvar.', 'nothosubsp.',
]);

/**
 * Split `Psilopogon nuchalis (Gould, 1863)` into its canonical name and its
 * authorship.
 *
 * GBIF's occurrence facets return `scientificName`, which always carries the
 * author, and `sciMatch` compares against TaiCOL's author-free `simple_name`.
 * Verified against GBIF's own `canonicalName` on 750 real names (Taiwan birds,
 * Taiwan plants and fungi, Borneo): 750/750 exact.
 */
export function splitScientificName(sci: string): { name: string; author: string } {
  const toks = (sci ?? '').trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return { name: '', author: '' };
  const canonical = [toks[0]];
  let i = 1;
  for (; i < toks.length; i++) {
    const tok = toks[i];
    if (RANK_TOKENS.has(tok)) {
      canonical.push(tok);
      continue;
    }
    if (AUTHOR_START.test(tok)) break;
    canonical.push(tok);
  }
  return { name: canonical.join(' '), author: toks.slice(i).join(' ') };
}

export type GbifFilters = {
  /** Empty means every kingdom. */
  groups?: IconicTaxon[];
  /** Ceiling on species returned, applied after merging every group. */
  maxSpecies: number;
};

/**
 * Every distinct species recorded inside a WKT polygon.
 *
 * `geometry=` was verified to accept WKT POLYGON and to be winding-order
 * agnostic (the same rectangle clockwise and counter-clockwise returned an
 * identical count of 350,844), so the ring does not have to be re-wound.
 */
export async function fetchSpeciesInPolygon(
  wkt: string,
  filters: GbifFilters,
  signal?: AbortSignal,
  onProgress?: (done: number, of: number) => void,
): Promise<GbifQueryResult> {
  const groups = gbifGroupKeys(filters.groups ?? []);
  const merged: GbifSpecies[] = [];
  const seen = new Set<string>();
  let total = 0;
  let anyCapped = false;
  let done = 0;

  const fetchGroup = async (g: { key: number; name: string }) => {
    if (signal?.aborted) throw new ApiError('gbif', 'aborted', 'aborted');
    const json = await getJson(
      'gbif',
      `${API}/occurrence/search?${qs({
        geometry: wkt,
        taxonKey: String(g.key),
        facet: 'scientificName',
        facetLimit: String(filters.maxSpecies),
        limit: '0',
      })}`,
      signal,
    );

    const facets = (json.facets ?? []) as { counts?: { name?: string; count?: number }[] }[];
    const counts = facets[0]?.counts ?? [];
    if (counts.length >= filters.maxSpecies) anyCapped = true;
    for (const c of counts) {
      const { name, author } = splitScientificName(c.name ?? '');
      // A facet value can be a bare higher taxon ("Lepidoptera", "Geometridae")
      // when the occurrence was never identified further. Those are real
      // records but not species, and minting an external taxon for a family is
      // not useful, so they are dropped rather than carried through.
      if (!name || !name.includes(' ')) continue;
      const dedupeKey = `${name}|${g.name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push({ name, author, kingdom: g.name, occurrenceCount: Number(c.count ?? 0) });
    }
    total += Number(json.count ?? 0);
    done++;
    onProgress?.(done, groups.length);
  };

  // A small worker pool rather than one request at a time. Each worker takes
  // the next group, so a kingdom that answers quickly does not hold up the rest.
  const queue = [...groups];
  const worker = async () => {
    for (;;) {
      const g = queue.shift();
      if (!g) return;
      await fetchGroup(g);
      if (queue.length > 0) await sleep(GROUP_DELAY_MS);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(GROUP_CONCURRENCY, queue.length) }, () => worker()),
  );

  // Most-recorded first: when the cap bites, the species the user is most
  // likely to encounter are the ones that survive.
  merged.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  return {
    species: merged.slice(0, filters.maxSpecies),
    total,
    truncated: anyCapped || merged.length > filters.maxSpecies,
  };
}

export type GbifNameMatch = {
  usageKey: number;
  canonicalName: string;
  author: string;
  rank: string;
  /** ACCEPTED / SYNONYM / DOUBTFUL. */
  status: string;
  /** EXACT / FUZZY / HIGHERRANK / NONE. */
  matchType: string;
  confidence: number;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  /** The accepted name when the queried name is a synonym. */
  acceptedName: string;
};

/**
 * Resolve one name against the GBIF backbone.
 *
 * Two uses, both for names the bundled checklists missed: it yields the
 * ACCEPTED name (which the local checklist may well know, turning an unmatched
 * name into a matched one), and a stable `usageKey` to mint a 'g…' id from.
 *
 * One request per name, so callers must treat it as expensive and bounded —
 * never a per-keystroke or whole-list operation without the user asking.
 * Returns null for matchType NONE and for HIGHERRANK, which only tells us the
 * name resolved to something coarser than what was asked.
 */
export async function matchName(name: string, signal?: AbortSignal): Promise<GbifNameMatch | null> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  const json = await getJson('gbif', `${API}/species/match?${qs({ name: trimmed })}`, signal);
  const matchType = String(json.matchType ?? 'NONE');
  if (matchType === 'NONE' || matchType === 'HIGHERRANK') return null;
  const key = Number(json.usageKey ?? 0);
  if (!key) return null;
  const str = (k: string) => String(json[k] ?? '');
  return {
    usageKey: key,
    canonicalName: str('canonicalName'),
    author: str('authorship').trim(),
    rank: str('rank'),
    status: str('status') || str('taxonomicStatus'),
    matchType,
    confidence: Number(json.confidence ?? 0),
    kingdom: str('kingdom'),
    phylum: str('phylum'),
    class: str('class'),
    order: str('order'),
    family: str('family'),
    genus: str('genus'),
    acceptedName: str('accepted'),
  };
}

// ── Name lookup for the search box ─────────────────────────────────────────

/**
 * Ranks a user may add as a record.
 *
 * `/species/search` happily returns families and orders for a short query, and
 * unlike `matchName` there is no `matchType: HIGHERRANK` to filter on — the
 * hit IS an exact match, it just happens to be a family. Genus is kept (a
 * "Ficus sp." observation is a real field record); anything coarser is not
 * something to file an occurrence under.
 */
const ADDABLE_RANKS = new Set([
  'GENUS', 'SPECIES', 'SUBSPECIES', 'VARIETY', 'SUBVARIETY', 'FORM', 'SUBFORM',
]);

/** Chinese first — this is a Taiwanese checklist app — then English, then
 *  whatever GBIF listed first. ISO 639-3 'zho' is what GBIF actually emits. */
const VERNACULAR_LANGS = ['zho', 'zh', 'zh-hant', 'zh-hans', 'cmn'];

export type GbifNameCandidate = {
  usageKey: number;
  canonicalName: string;
  author: string;
  rank: string;
  /** ACCEPTED / SYNONYM / DOUBTFUL … */
  status: string;
  /** The accepted name when this row is a synonym; '' otherwise. */
  acceptedName: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  /** GBIF's vernacular name, Chinese preferred; '' when it has none. */
  vernacularName: string;
};

function pickVernacular(json: Record<string, unknown>): string {
  const list = Array.isArray(json.vernacularNames) ? json.vernacularNames : [];
  const rows = list as Array<{ vernacularName?: string; language?: string }>;
  const named = rows.filter((v) => (v?.vernacularName ?? '').trim());
  for (const lang of VERNACULAR_LANGS) {
    const hit = named.find((v) => (v.language ?? '').toLowerCase() === lang);
    if (hit) return String(hit.vernacularName).trim();
  }
  const en = named.find((v) => (v.language ?? '').toLowerCase().startsWith('en'));
  if (en) return String(en.vernacularName).trim();
  return named[0]?.vernacularName?.trim() ?? '';
}

/**
 * Search the GBIF backbone by name, for the "not in the local checklist"
 * fallback in the search box.
 *
 * Separate from `matchName`, which resolves ONE name to its single best match
 * — right for batch correction, wrong for a person who needs to see what the
 * options are and pick.
 *
 * Timeout is deliberately far below the 20 s default: this runs while someone
 * is standing in a forest waiting on the screen, and `classifyFailure` adds a
 * further probe on top before it can even say "you're offline".
 */
export function nameSearchUrl(q: string): string {
  return `${API}/species/search?${qs({
    q: q.trim(),
    datasetKey: BACKBONE_DATASET_KEY,
    limit: '30',
  })}`;
}

/**
 * The response → candidates half, kept separate from the request so it can be
 * checked against fixtures without a network (scripts/check-gbif-parse.mjs).
 */
export function parseNameSearch(json: Record<string, unknown>): GbifNameCandidate[] {
  const results = Array.isArray(json.results) ? (json.results as Record<string, unknown>[]) : [];
  const out: GbifNameCandidate[] = [];
  const seen = new Set<number>();
  for (const r of results) {
    const rank = String(r.rank ?? '').toUpperCase();
    if (!ADDABLE_RANKS.has(rank)) continue;
    const key = Number(r.key ?? r.nubKey ?? 0);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const str = (k: string) => String(r[k] ?? '');
    // `canonicalName` is absent on some rows; scientificName carries the
    // author, so fall back through the same splitter the area path uses.
    const split = splitScientificName(str('scientificName'));
    out.push({
      usageKey: key,
      canonicalName: str('canonicalName') || split.name,
      author: str('authorship').trim() || split.author,
      rank,
      status: str('taxonomicStatus') || str('status'),
      acceptedName: str('accepted'),
      kingdom: str('kingdom'),
      phylum: str('phylum'),
      class: str('class'),
      order: str('order'),
      family: str('family'),
      genus: str('genus'),
      vernacularName: pickVernacular(r),
    });
    if (out.length >= 20) break;
  }
  return out;
}

export async function searchNames(q: string, signal?: AbortSignal): Promise<GbifNameCandidate[]> {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return [];
  const json = await getJson('gbif', nameSearchUrl(trimmed), signal, NAME_SEARCH_TIMEOUT_MS);
  return parseNameSearch(json);
}

// ── One taxon in full, for a deliberately adopted name ─────────────────────

export type GbifTaxonDetail = {
  usageKey: number;
  /** ACCEPTED / SYNONYM / DOUBTFUL … as GBIF sees it. */
  taxonomicStatus: string;
  /** The accepted name GBIF would redirect to, '' when this IS the accepted one. */
  acceptedName: string;
  acceptedKey: number | null;
  /** The full parent chain, coarsest first, as `rank:name` pairs joined by ' | '.
   *  Ranks between family and genus (subfamily, tribe…) have no column anywhere
   *  in this app, so the chain is kept as one serialized string rather than
   *  forcing six new columns through every table and export. */
  higherClassification: string;
};

/**
 * Fetch one taxon's status and full parent chain.
 *
 * Two requests, and that is fine here: the file-level rule against per-key
 * fetching is about resolving 300 facet keys in a batch, not about the single
 * name a user has deliberately chosen to adopt. Same short timeout as the name
 * search — someone is waiting on it.
 */
export async function fetchTaxonDetail(
  usageKey: number,
  signal?: AbortSignal,
): Promise<GbifTaxonDetail> {
  const detail = await getJson(
    'gbif',
    `${API}/species/${usageKey}`,
    signal,
    NAME_SEARCH_TIMEOUT_MS,
  );
  let chain = '';
  try {
    const parents = await getJson(
      'gbif',
      `${API}/species/${usageKey}/parents`,
      signal,
      NAME_SEARCH_TIMEOUT_MS,
    );
    chain = parseParents(parents);
  } catch {
    // The chain is enrichment, not identity — a name is still adoptable
    // without it, and failing the whole adoption over it would be wrong.
  }
  const str = (k: string) => String(detail[k] ?? '');
  const acceptedKey = Number(detail.acceptedKey ?? 0);
  return {
    usageKey,
    taxonomicStatus: str('taxonomicStatus') || str('status'),
    acceptedName: str('accepted'),
    acceptedKey: acceptedKey || null,
    higherClassification: chain,
  };
}

/** `/species/{key}/parents` returns an ordered array, coarsest first. */
export function parseParents(json: unknown): string {
  if (!Array.isArray(json)) return '';
  return (json as Array<Record<string, unknown>>)
    .map((p) => {
      const rank = String(p.rank ?? '').toLowerCase();
      const name = String(p.canonicalName ?? p.scientificName ?? '').trim();
      return name ? (rank ? `${rank}:${name}` : name) : '';
    })
    .filter(Boolean)
    .join(' | ');
}
