/**
 * 採用名稱 — let the recorder decide which name a record is filed under.
 *
 * TaiCOL's `taxon_id` is a taxon *concept*; each name hanging off it is a row
 * with its own `name_id`, marked accepted / not-accepted / misapplied. About
 * 27.7% of concepts carry at least one synonym. Calling a name "not accepted"
 * is a taxonomic opinion, and a recorder may hold a different one — so when a
 * search resolves through a synonym, the app must ask rather than silently
 * substitute the accepted name.
 *
 * Three answers, in increasing order of divergence:
 *   1. use the accepted name          — today's behaviour, the default
 *   2. use MY name, same concept      — nomenclatural disagreement only; the
 *                                       record keeps the local taxon_id so
 *                                       statistics and exports never split
 *   3. use MY name, own concept       — a genuinely different circumscription;
 *                                       mints an external taxon from GBIF, and
 *                                       the two do NOT aggregate together
 *
 * A misapplied name applied across two concepts (`taxon_id_all`) gets a fourth:
 * file it under the other local concept, which needs no network at all.
 */
import { getTaicolDb, searchByTaxonId, type SearchResult } from '~/db';
import type { AdoptionInput } from '~/db';
import { showActionSheet } from '~/components/ActionSheet';
import { lookupGbifName } from '~/components/GbifLookupHost';
import i18n from '~/i18n';

export type AdoptionChoice =
  /** File under the accepted name — nothing changes. */
  | { kind: 'accepted' }
  /** Same concept, the user's name. */
  | { kind: 'adopt'; adopted: AdoptionInput }
  /** A different concept entirely; `result` is already resolved/minted. */
  | { kind: 'other'; result: SearchResult };

/** The other concepts a (usually misapplied) name has been applied to. */
export function otherConceptsFor(nameId: number, currentTaxonId: string): string[] {
  const res = getTaicolDb().executeSync(
    `SELECT taxon_id_all FROM taicol_names WHERE name_id = ?`,
    [nameId],
  );
  const raw = ((res.rows ?? [])[0] as { taxon_id_all?: string } | undefined)?.taxon_id_all ?? '';
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && t !== currentTaxonId);
}

/**
 * Ask which name to file under. Returns null when the user backed out.
 *
 * Only offered when the search actually resolved through another name — with
 * no `matched_as` there is no disagreement to resolve.
 */
export async function chooseNameUsage(result: SearchResult): Promise<AdoptionChoice | null> {
  const m = result.matched_as;
  if (!m) return { kind: 'accepted' };

  const others = m.name_id ? otherConceptsFor(m.name_id, result.taxon_id) : [];
  const misapplied = m.status === 'misapplied';

  // Order matters, and it differs by status:
  //
  //   not-accepted (synonym) — the two names denote the SAME organism, so
  //     "my name, same taxon" is the natural answer and comes first.
  //
  //   misapplied — the name properly belongs to a DIFFERENT taxon; the local
  //     checklist is only recording that Taiwanese authors have used it for
  //     this one. Someone typing it usually means the real species (e.g.
  //     Digitaria bicornis, misapplied here for D. heterantha, is a legitimate
  //     species in its own right). So the independent-taxon option leads, and
  //     "same taxon" is spelled out as the claim it actually is — that you
  //     consider the local usage correct.
  const order: Array<'accepted' | 'sameTaxon' | 'ownTaxon'> = misapplied
    ? ['accepted', 'ownTaxon', 'sameTaxon']
    : ['accepted', 'sameTaxon', 'ownTaxon'];

  const labelFor = (kind: string) =>
    kind === 'accepted'
      ? i18n.t('adoptName.useAccepted', { name: result.name })
      : kind === 'sameTaxon'
        ? i18n.t(misapplied ? 'adoptName.useMineSameTaxonMisapplied' : 'adoptName.useMineSameTaxon', {
            name: m.name,
            accepted: result.name,
          })
        : i18n.t('adoptName.useMineOwnTaxon', { name: m.name });

  const options = [
    ...order.map((k) => ({ label: labelFor(k) })),
    ...others.map(() => ({ label: i18n.t('adoptName.useOtherConcept') })),
  ];

  const idx = await showActionSheet({
    title: i18n.t('adoptName.title'),
    message: i18n.t(misapplied ? 'adoptName.messageMisapplied' : 'adoptName.message', {
      typed: m.name,
      accepted: result.name,
    }),
    cancelLabel: i18n.t('common.cancel'),
    options,
  });
  if (idx < 0) return null;

  const chosen = order[idx];
  if (chosen === 'accepted') return { kind: 'accepted' };
  if (chosen === 'sameTaxon') {
    return {
      kind: 'adopt',
      // name_id may be absent (a Japanese alias has no row of its own); the
      // string alone is still a complete record of what the user chose.
      adopted: { name_id: m.name_id ?? null, scientific_name: m.name },
    };
  }
  if (chosen === 'ownTaxon') {
    const picked = await lookupGbifName(m.name);
    return picked ? { kind: 'other', result: picked.result } : null;
  }
  const other = others[idx - order.length];
  if (other) {
    const hit = searchByTaxonId(other);
    return hit ? { kind: 'other', result: hit } : null;
  }
  return null;
}

/** Fold a choice into the (result, adoption) pair the add paths take. */
export function applyChoice(
  original: SearchResult,
  choice: AdoptionChoice,
): { result: SearchResult; adopted: AdoptionInput | null } {
  if (choice.kind === 'adopt') return { result: original, adopted: choice.adopted };
  if (choice.kind === 'other') return { result: choice.result, adopted: null };
  return { result: original, adopted: null };
}
