/**
 * Turn a list of species observed in a map area into rows of a 常用名錄 folder.
 *
 * This is where the identity rule from `sciMatch` is enforced, so it stays free
 * of UI: the caller fetches (iNaturalist or GBIF), this resolves and writes.
 *
 * Three outcomes per species, and the difference matters to the user:
 *   - matched   → a bundled 't…'/'y…' id. The species behaves like any other.
 *   - ambiguous → the name maps to several local taxa. NOT auto-picked; the
 *                 user chooses, or it is skipped.
 *   - unmatched → nothing local knows it, so an external 'g…'/'gi…' taxon is
 *                 minted and cached in user.db.
 */
import {
  addFavoriteRow,
  isTaxonInFolder,
  upsertExternalTaxon,
  type ExternalTaxonSource,
} from '~/db';
import { matchScientificName, type SciCandidate, type SciMatch } from './sciMatch';
import { matchName } from './gbif';
import { sleep } from './apiFetch';
import type { INatSpecies } from './inat';
import type { GbifSpecies } from './gbif';

/**
 * One species from either source, flattened.
 *
 * The two sources supply different amounts: iNaturalist's `species_counts` with
 * `include_ancestors` gives the full hierarchy but no author, while a GBIF
 * occurrence facet gives the author but only the kingdom (a facet carries one
 * field, and the per-group loop in `gbif.ts` is what supplies even that).
 * `sciMatch` narrows on whatever is present and ignores what is blank, so both
 * shapes are usable without a per-source branch.
 */
export type AreaSpecies = {
  /** Identifier within its own source; empty when the source has none. */
  key: string;
  source: ExternalTaxonSource;
  /** Canonical name, no author. */
  name: string;
  author: string;
  rank: string;
  commonName: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  /** Observations (iNat) or occurrences (GBIF) backing this taxon in the area. */
  count: number;
};

export function fromINat(s: INatSpecies): AreaSpecies {
  return {
    key: String(s.key),
    source: 'inat',
    name: s.name,
    author: '',
    rank: s.rank,
    commonName: s.commonName,
    kingdom: s.kingdom,
    phylum: s.phylum,
    class: s.class,
    order: s.order,
    family: s.family,
    genus: s.genus,
    count: s.observationCount,
  };
}

export function fromGbif(s: GbifSpecies): AreaSpecies {
  return {
    key: '',
    source: 'gbif',
    name: s.name,
    author: s.author,
    rank: '',
    commonName: '',
    kingdom: s.kingdom,
    phylum: '',
    class: '',
    order: '',
    family: '',
    genus: '',
    count: s.occurrenceCount,
  };
}

export type AreaEntry = {
  src: AreaSpecies;
  match: SciMatch;
  /**
   * The candidate the user picked for an `ambiguous` entry. Until this is set
   * the entry is not importable — silently taking `candidates[0]` would record
   * a different organism than the one observed.
   */
  resolved?: SciCandidate;
  /** GBIF backbone key, filled in by `refineUnmatched`. */
  gbifKey?: number;
  /** What GBIF says this name's accepted name is, when it differs. */
  refined?: { name: string; family: string };
};

export type AreaSummary = {
  matched: number;
  ambiguous: number;
  unmatched: number;
};

function resolveOne(src: AreaSpecies): AreaEntry {
  return {
    src,
    match: matchScientificName({
      name: src.name,
      kingdom: src.kingdom,
      family: src.family,
      author: src.author,
    }),
  };
}

/** Resolve every fetched species against the bundled checklists. Pure: no
 *  writes, so the UI can show the breakdown before anything is committed. */
export function resolveAreaSpecies(list: AreaSpecies[]): AreaEntry[] {
  return list.map(resolveOne);
}

/** Names resolved between yields. ~150 keeps each burst near a frame's worth of
 *  work while the yields themselves stay a small fraction of the total. */
const RESOLVE_CHUNK = 150;

/**
 * The same resolution, in chunks that let the UI breathe.
 *
 * `matchScientificName` is synchronous SQLite, so resolving a whole area in one
 * pass blocks the JS thread for its entire duration: measured at 434 ms for
 * 6,576 names on a desktop, which on a phone is seconds of frozen screen — and
 * a frozen screen is indistinguishable from a crash to the person holding it.
 *
 * This is NOT the "background SQL on a setTimeout" anti-pattern this project
 * has been bitten by. That was speculative work nobody asked for, hidden behind
 * a timer at startup. This is work the user explicitly triggered, reported with
 * a progress count, and cancellable.
 */
export async function resolveAreaSpeciesChunked(
  list: AreaSpecies[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<AreaEntry[]> {
  const out: AreaEntry[] = [];
  for (let i = 0; i < list.length; i += RESOLVE_CHUNK) {
    if (signal?.aborted) return out;
    for (const src of list.slice(i, i + RESOLVE_CHUNK)) out.push(resolveOne(src));
    onProgress?.(Math.min(i + RESOLVE_CHUNK, list.length), list.length);
    // Hand the thread back so the progress count actually paints.
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

export function summarize(entries: AreaEntry[]): AreaSummary {
  const s: AreaSummary = { matched: 0, ambiguous: 0, unmatched: 0 };
  for (const e of entries) {
    if (e.match.kind === 'matched') s.matched++;
    else if (e.match.kind === 'ambiguous') s.ambiguous++;
    else s.unmatched++;
  }
  return s;
}

/**
 * How many `matchName` calls run at once.
 *
 * One request per unmatched name is the expensive part of this module, so it is
 * bounded and never implicit. Lowered from 6 after GBIF was measured returning
 * HTTP 429 for a burst — and this is the burstiest thing the app does, hundreds
 * of calls back to back.
 */
const REFINE_CONCURRENCY = 3;
/** Spacing between one worker's successive `matchName` calls. */
const REFINE_DELAY_MS = 120;

export type RefineResult = {
  entries: AreaEntry[];
  /** Names GBIF resolved to an accepted name the local checklist DOES know. */
  rescued: number;
  /** Still unmatched, but now carrying a GBIF key so they can be minted. */
  keyed: number;
  /** GBIF knew nothing either. */
  unknown: number;
};

/**
 * Ask GBIF about every unmatched name.
 *
 * Two things come back. The one that carries the weight is the second:
 *
 *   1. The ACCEPTED name, retried against the local checklist. MEASURED VALUE:
 *      zero. Across five real areas (Yangmingshan, Kenting and Kinabalu, from
 *      both sources) it rescued 0 of 211 names — because `sciMatch` already
 *      follows TaiCOL's own synonym rows, so by the time a name reaches here
 *      the local checklist genuinely does not have it under any name. Kept
 *      because it costs nothing extra on a call already being made, and it
 *      would fire when GBIF's accepted name is one TaiCOL happens to know.
 *   2. A `usageKey`. This is the reason to run it: a GBIF occurrence FACET
 *      returns only a name, so a GBIF-sourced species has no id of its own and
 *      there is nothing to mint a 'g…' taxon from without this call. Measured
 *      at 100% (211/211 names got a key).
 *
 * One request per unmatched name, so this is user-initiated, cancellable and
 * reports progress — never run implicitly over a whole list.
 */
export async function refineUnmatched(
  entries: AreaEntry[],
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<RefineResult> {
  const targets = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.match.kind === 'unmatched');
  const next = [...entries];
  let rescued = 0;
  let keyed = 0;
  let unknown = 0;
  let done = 0;

  const worker = async (queue: { e: AreaEntry; i: number }[]) => {
    for (;;) {
      const item = queue.pop();
      if (!item || signal?.aborted) return;
      try {
        const m = await matchName(item.e.src.name, signal);
        if (!m) {
          unknown++;
        } else {
          // GBIF's `accepted` is set when the queried name is a synonym; fall
          // back to its canonical form of the queried name otherwise.
          const accepted = m.acceptedName || m.canonicalName;
          const retry =
            accepted && accepted !== item.e.src.name
              ? matchScientificName({ name: accepted, kingdom: m.kingdom, family: m.family })
              : null;
          if (retry && retry.kind === 'matched') {
            next[item.i] = {
              ...item.e,
              match: retry,
              refined: { name: accepted, family: m.family },
            };
            rescued++;
          } else {
            next[item.i] = {
              ...item.e,
              gbifKey: m.usageKey,
              refined: { name: m.canonicalName, family: m.family },
              src: {
                ...item.e.src,
                // Fill in what the facet could not supply, so a minted taxon
                // carries a real hierarchy instead of blanks.
                author: item.e.src.author || m.author,
                rank: item.e.src.rank || m.rank.toLowerCase(),
                kingdom: item.e.src.kingdom || m.kingdom,
                phylum: item.e.src.phylum || m.phylum,
                class: item.e.src.class || m.class,
                order: item.e.src.order || m.order,
                family: item.e.src.family || m.family,
                genus: item.e.src.genus || m.genus,
              },
            };
            keyed++;
          }
        }
      } catch {
        // One name failing must not abandon the rest; it simply stays unmatched
        // and un-mintable, which the summary already reports.
        unknown++;
      }
      done++;
      onProgress?.(done, targets.length);
      if (queue.length > 0) await sleep(REFINE_DELAY_MS);
    }
  };

  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(REFINE_CONCURRENCY, queue.length) }, () => worker(queue)),
  );
  return { entries: next, rescued, keyed, unknown };
}

/** The taxon_id an entry would be imported under, or null if it still needs a
 *  decision. Does not write. */
function decidedTaxon(e: AreaEntry): SciCandidate | null {
  if (e.match.kind === 'matched') return e.match.candidate;
  if (e.match.kind === 'ambiguous') return e.resolved ?? null;
  return null;
}

export type ImportOptions = {
  /** Mint 'g…' taxa for names no bundled checklist knows. With this off, an
   *  unmatched species is simply skipped — which is what a user working only in
   *  Taiwan wants, since an unmatched name there is usually a data problem
   *  rather than a genuinely foreign species. */
  includeUnmatched: boolean;
};

export type ImportResult = {
  added: number;
  /** Already in this folder. */
  skipped: number;
  /** New external taxa written to user.db. Counted within `added`. */
  minted: number;
  /** Ambiguous entries the user never resolved. */
  undecided: number;
  /** Unmatched entries left out: either `includeUnmatched` was off, or the
   *  species has no id to mint from (a GBIF facet result that was never run
   *  through `refineUnmatched`). */
  omitted: number;
};

export function importAreaSpecies(
  entries: AreaEntry[],
  folderId: number,
  opts: ImportOptions,
): ImportResult {
  const out: ImportResult = { added: 0, skipped: 0, minted: 0, undecided: 0, omitted: 0 };

  for (const e of entries) {
    const decided = decidedTaxon(e);

    if (decided) {
      if (isTaxonInFolder(folderId, decided.taxon_id)) {
        out.skipped++;
        continue;
      }
      addFavoriteRow(
        {
          taxon_id: decided.taxon_id,
          simple_name: decided.simple_name,
          common_name_c: decided.common_name_c,
          family: decided.family,
          family_c: decided.family_c,
          rank: decided.rank,
          kingdom: decided.kingdom,
        },
        folderId,
      );
      out.added++;
      continue;
    }

    if (e.match.kind === 'ambiguous') {
      out.undecided++;
      continue;
    }
    if (!opts.includeUnmatched) {
      out.omitted++;
      continue;
    }

    // Prefer a GBIF backbone key: it is the authoritative identity, and it is
    // the ONLY option for a GBIF facet result, which arrives with no id at all.
    const mintFrom: { source: ExternalTaxonSource; key: string } | null =
      e.gbifKey != null
        ? { source: 'gbif', key: String(e.gbifKey) }
        : e.src.key
          ? { source: e.src.source, key: e.src.key }
          : null;
    if (!mintFrom) {
      out.omitted++;
      continue;
    }

    const s = e.src;
    const taxonId = upsertExternalTaxon({
      source: mintFrom.source,
      source_key: mintFrom.key,
      simple_name: s.name,
      name_author: s.author,
      rank: s.rank,
      kingdom: s.kingdom,
      phylum: s.phylum,
      class: s.class,
      order: s.order,
      family: s.family,
      genus: s.genus,
      common_name_c: s.commonName,
    });
    out.minted++;
    if (isTaxonInFolder(folderId, taxonId)) {
      out.skipped++;
      continue;
    }
    addFavoriteRow(
      {
        taxon_id: taxonId,
        simple_name: s.name,
        common_name_c: s.commonName,
        family: s.family,
        // GBIF and iNaturalist have no Chinese family name to give.
        family_c: '',
        rank: s.rank,
        kingdom: s.kingdom,
      },
      folderId,
    );
    out.added++;
  }

  return out;
}
