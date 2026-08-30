/**
 * iNaturalist API client — the app's FIRST network dependency.
 *
 * Everything else in this codebase reads local SQLite, so there was no existing
 * vocabulary for "pending / failed / offline". The contract here is therefore
 * deliberately narrow: one function, it either resolves with species or throws
 * an `ApiError` whose `kind` the UI can turn into a sentence. No retries, no
 * background refresh, no cache — a field survey app must never look like it is
 * working when it is not.
 *
 * Endpoint: GET /observations/species_counts, which aggregates observations in
 * an area into distinct leaf taxa. Chosen over GBIF's occurrence facets because
 * one request returns the NAME and full ancestry; GBIF facets return numeric
 * keys that would need a second lookup each.
 *
 * `include_ancestors=true` is load-bearing: without it the taxon object carries
 * only `ancestor_ids` (numbers) and `iconic_taxon_name`, and `sciMatch` needs
 * real kingdom/family strings to separate the 72 cross-kingdom genus homonyms
 * in the bundled checklist.
 */

import { ApiError, getJson, qs, sleep } from './apiFetch';

const API = 'https://api.inaturalist.org/v1';

const PAGE_SIZE = 200;

/** Spacing between pages. iNaturalist asks consumers to stay near 60 requests
 *  per minute; this stays far under while adding ~1 s to a 500-species fetch. */
const PAGE_DELAY_MS = 350;

/** Hard ceiling on species fetched in one query. Kept equal to GBIF's so
 *  switching source does not silently change how much comes back; see the note
 *  on `GBIF_MAX_SPECIES` for why the number is about what a list can usefully
 *  hold rather than what the API can return. Costs 5 paged requests here. */
export const MAX_SPECIES = 1000;

export type BBox = {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
};

/** iNat's coarse top-level groupings, used as the taxon filter. These are
 *  iNat's own vocabulary — not our `taxonGroup` — so they are passed through
 *  verbatim rather than translated. `gbif.ts` maps the same list onto GBIF
 *  backbone keys so one set of chips drives both sources. */
export const ICONIC_TAXA = [
  'Plantae',
  'Fungi',
  'Aves',
  'Mammalia',
  'Reptilia',
  'Amphibia',
  'Actinopterygii',
  'Insecta',
  'Arachnida',
  'Mollusca',
] as const;

export type IconicTaxon = (typeof ICONIC_TAXA)[number];

export type INatSpecies = {
  /** iNaturalist taxon id. */
  key: number;
  /** Canonical name, no author — iNat's `taxon.name` is already in this form. */
  name: string;
  rank: string;
  /** iNat's preferred common name for the requested locale; often English. */
  commonName: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  /** How many observations in the queried area back this taxon. */
  observationCount: number;
};

export type INatQueryResult = {
  species: INatSpecies[];
  /** total_results reported by iNat, which may exceed what we fetched. */
  total: number;
  /** True when the MAX_SPECIES ceiling cut the list short. */
  truncated: boolean;
};

export type INatFilters = {
  /** `quality_grade=research`: identified to species level and community-agreed.
   *  Off means casual observations count too. */
  researchGradeOnly?: boolean;
  /** Empty / omitted means every group. */
  iconicTaxa?: IconicTaxon[];
  /** Minimum observations for a taxon to be included. */
  minObservations?: number;
};

type AncestryRank = 'kingdom' | 'phylum' | 'class' | 'order' | 'family' | 'genus';

type RawTaxon = {
  id?: number;
  name?: string;
  rank?: string;
  preferred_common_name?: string;
  ancestors?: { rank?: string; name?: string }[];
};

function ancestryOf(taxon: RawTaxon): Record<AncestryRank, string> {
  const out = { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' };
  for (const a of taxon.ancestors ?? []) {
    const r = a.rank as AncestryRank | undefined;
    if (r && r in out && a.name) out[r] = a.name;
  }
  // The leaf itself is often one of these ranks — species_counts returns the
  // finest identified taxon, which for a coarse identification IS the genus or
  // family. Its own name never appears in its ancestors list.
  const own = taxon.rank as AncestryRank | undefined;
  if (own && own in out && taxon.name) out[own] = taxon.name;
  return out;
}

function toSpecies(entry: Record<string, unknown>): INatSpecies | null {
  const taxon = entry.taxon as RawTaxon | undefined;
  if (!taxon?.name || typeof taxon.id !== 'number') return null;
  return {
    key: taxon.id,
    name: taxon.name,
    rank: taxon.rank ?? '',
    commonName: taxon.preferred_common_name ?? '',
    ...ancestryOf(taxon),
    observationCount: Number(entry.count ?? 0),
  };
}

/**
 * Every distinct taxon observed inside a bounding box.
 *
 * NOTE the shape is a RECTANGLE. iNat's spatial parameters are swlat/swlng +
 * nelat/nelng or a radius — there is no polygon. A drawn polygon must therefore
 * be reduced to its bounding box (and the UI has to say so), or go to GBIF,
 * whose `geometry=` does take WKT.
 */
export async function fetchSpeciesInBBox(
  bbox: BBox,
  filters: INatFilters = {},
  signal?: AbortSignal,
): Promise<INatQueryResult> {
  const base: Record<string, string> = {
    swlat: String(bbox.swLat),
    swlng: String(bbox.swLng),
    nelat: String(bbox.neLat),
    nelng: String(bbox.neLng),
    include_ancestors: 'true',
    per_page: String(PAGE_SIZE),
  };
  if (filters.researchGradeOnly) base.quality_grade = 'research';
  if (filters.iconicTaxa?.length) base.iconic_taxa = filters.iconicTaxa.join(',');

  const species: INatSpecies[] = [];
  let total = 0;
  const seen = new Set<number>();

  for (let page = 1; ; page++) {
    const json = await getJson(
      'inat',
      `${API}/observations/species_counts?${qs({ ...base, page: String(page) })}`,
      signal,
    );

    total = Number(json.total_results ?? 0);
    const results = (json.results ?? []) as Record<string, unknown>[];
    if (results.length === 0) break;

    for (const entry of results) {
      const s = toSpecies(entry);
      if (!s || seen.has(s.key)) continue;
      if (filters.minObservations && s.observationCount < filters.minObservations) continue;
      seen.add(s.key);
      species.push(s);
    }

    if (species.length >= MAX_SPECIES) break;
    if (page * PAGE_SIZE >= total) break;
    if (signal?.aborted) throw new ApiError('inat', 'aborted', 'aborted');
    await sleep(PAGE_DELAY_MS);
  }

  const truncated = species.length > MAX_SPECIES || species.length < total;
  return { species: species.slice(0, MAX_SPECIES), total, truncated };
}
