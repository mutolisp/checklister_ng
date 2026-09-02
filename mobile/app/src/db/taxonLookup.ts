/**
 * Resolve a batch of taxon_ids to their accepted-name fields.
 *
 * Three namespaces, three lookups: TaiCOL 't…' and Japan 'y…' from
 * twnamelist.db, external 'g…' from user.db. A taxon_id that resolves nowhere
 * yields EMPTY_TAXON_FIELDS — blank, never an error — which is why an id must
 * never be persisted before it is known to be resolvable.
 *
 * The single implementation for every record kind: `listSessionRecords`
 * (records.ts), `listPlotSpecies` (plots.ts) and `listSpecimens`
 * (collections.ts) all go through this. It previously existed alongside two
 * byte-identical inlined copies, which had already drifted (records.ts selected
 * six columns the others lacked) — the field set here is their union, which is
 * harmless to callers that ignore the extras.
 */
import { getTaicolDb, getUserDb } from './init';
import {
  getEnabledRegions,
  isExternalTaxonId,
  isJpTaxonId,
  regionOfTaxonId,
  crossRegionVernacular,
  composeVernacular,
} from './regions';

export type TaxonFields = {
  simple_name: string;
  name_author: string;
  common_name_c: string;
  alternative_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  is_endemic: string;
  alien_type: string;
  redlist: string;
  iucn: string;
  cites: string;
  protected: string;
  is_hybrid: string;
  kingdom: string;
  kingdom_c: string;
  phylum: string;
  phylum_c: string;
  class: string;
  class_c: string;
  order: string;
  order_c: string;
  genus: string;
  genus_c: string;
  is_terrestrial: string;
  is_freshwater: string;
  is_brackish: string;
  is_marine: string;
  is_fossil: string;
};

const TAXON_COLS = `taxon_id, simple_name, name_author, common_name_c, alternative_name_c,
  family, family_c, rank, is_endemic, alien_type, is_hybrid,
  kingdom, kingdom_c, phylum, phylum_c, class, class_c, "order", order_c, genus, genus_c,
  redlist, iucn, cites, protected,
  is_terrestrial, is_freshwater, is_brackish, is_marine, is_fossil`;

export const EMPTY_TAXON_FIELDS: TaxonFields = {
  simple_name: '', name_author: '', common_name_c: '', alternative_name_c: '',
  family: '', family_c: '', rank: '',
  is_endemic: '', alien_type: '', redlist: '', iucn: '', cites: '', protected: '', is_hybrid: '',
  kingdom: '', kingdom_c: '', phylum: '', phylum_c: '', class: '', class_c: '',
  order: '', order_c: '', genus: '', genus_c: '',
  is_terrestrial: '', is_freshwater: '', is_brackish: '', is_marine: '', is_fossil: '',
};

/**
 * Map taxon_id → accepted-name fields. Queries each dataset's real table
 * (indexed on taxon_id), split by the 't…'/'y…' prefix — never a taicol∪ylist
 * UNION view, which materializes ~270k rows and costs seconds. When Japan is
 * enabled the cross-region vernacular is merged into `common_name_c`; with only
 * ['TW'] enabled the value is exactly what TaiCOL has.
 */
export function resolveTaxa(taxonIds: string[]): Map<string, TaxonFields> {
  const out = new Map<string, TaxonFields>();
  const ids = Array.from(new Set(taxonIds));
  if (ids.length === 0) return out;

  const taicolDb = getTaicolDb();
  const raw = new Map<string, Record<string, unknown>>();
  const fillFrom = (tbl: string, subset: string[]) => {
    if (subset.length === 0) return;
    const ph = subset.map(() => '?').join(',');
    const res = taicolDb.executeSync(
      `SELECT ${TAXON_COLS} FROM ${tbl} WHERE taxon_id IN (${ph}) AND usage_status = 'accepted'`,
      subset,
    );
    for (const row of (res.rows ?? []) as Array<Record<string, unknown>>) {
      raw.set(row.taxon_id as string, row);
    }
  };
  fillFrom('taicol_names', ids.filter((id) => !isJpTaxonId(id) && !isExternalTaxonId(id)));
  fillFrom('jp_names', ids.filter(isJpTaxonId));

  // External ('g…') taxa live in user.db, a DIFFERENT handle — there is no
  // ATTACH anywhere in this app, so they cannot be part of the query above.
  // They also carry far fewer columns (no conservation status, no *_c
  // vernaculars): whatever GBIF/iNat gave us, and empty strings elsewhere.
  const externalIds = ids.filter(isExternalTaxonId);
  if (externalIds.length > 0) {
    const ph = externalIds.map(() => '?').join(',');
    const res = getUserDb().executeSync(
      `SELECT taxon_id, simple_name, name_author, rank, common_name_c,
              kingdom, phylum, class, "order", family, genus
         FROM external_taxa WHERE taxon_id IN (${ph})`,
      externalIds,
    );
    for (const row of (res.rows ?? []) as Record<string, unknown>[]) {
      raw.set(row.taxon_id as string, row);
    }
  }

  const regions = getEnabledRegions();
  const cross = regions.includes('JP') ? crossRegionVernacular(ids, regions) : null;

  const str = (t: Record<string, unknown>, k: string) => (t[k] as string) ?? '';
  for (const id of ids) {
    const t = raw.get(id) ?? {};
    const ownCname = str(t, 'common_name_c');
    out.set(id, {
      simple_name: str(t, 'simple_name'),
      name_author: str(t, 'name_author'),
      alternative_name_c: str(t, 'alternative_name_c'),
      common_name_c: cross
        ? composeVernacular(ownCname, regionOfTaxonId(id), cross.get(id), regions)
        : ownCname,
      family: str(t, 'family'),
      family_c: str(t, 'family_c'),
      rank: str(t, 'rank'),
      is_endemic: str(t, 'is_endemic'),
      alien_type: str(t, 'alien_type'),
      redlist: str(t, 'redlist'),
      iucn: str(t, 'iucn'),
      cites: str(t, 'cites'),
      protected: str(t, 'protected'),
      is_hybrid: str(t, 'is_hybrid'),
      kingdom: str(t, 'kingdom'),
      kingdom_c: str(t, 'kingdom_c'),
      phylum: str(t, 'phylum'),
      phylum_c: str(t, 'phylum_c'),
      class: str(t, 'class'),
      class_c: str(t, 'class_c'),
      order: str(t, 'order'),
      order_c: str(t, 'order_c'),
      genus: str(t, 'genus'),
      genus_c: str(t, 'genus_c'),
      is_terrestrial: str(t, 'is_terrestrial'),
      is_freshwater: str(t, 'is_freshwater'),
      is_brackish: str(t, 'is_brackish'),
      is_marine: str(t, 'is_marine'),
      is_fossil: str(t, 'is_fossil'),
    });
  }
  return out;
}

// ── 使用者採用的名字 ─────────────────────────────────────────────────────────

/**
 * The name a record was deliberately recorded under.
 *
 * TaiCOL's `taxon_id` is a taxon *concept* and `name_id` is a *name*: 269,824
 * names hang off 96,677 concepts, and ~27.7% of concepts carry a synonym. A
 * record stores the concept (so statistics never split) plus, optionally, the
 * name its recorder chose — which may be one TaiCOL calls not-accepted or
 * misapplied, because taxonomic opinion legitimately differs.
 */
export type AdoptedName = {
  simple_name: string;
  name_author: string;
  /** Read live from the checklist, never frozen into the record: TaiCOL
   *  changes its mind (283 names changed status between the 2026-02 and
   *  2026-04 releases). '' when the id no longer resolves. */
  usage_status: string;
  /** The checklist no longer agrees with what was stored — the name_id is gone
   *  or now spells a different name. The stored string is shown instead, and
   *  the data-check screen counts these. */
  stale: boolean;
};

/** What `applyAdoptedName` adds on top of the taxon fields, for callers that
 *  need to render or export the disagreement. */
export type AdoptionStatus = {
  /** The adopted name's status in the checklist right now ('' = none adopted). */
  used_status: string;
  /** The checklist no longer confirms the stored name. */
  used_stale: boolean;
  /** The name the checklist WOULD have used. Only set when an adoption is in
   *  effect — `simple_name` has been overwritten by then, and DwC's
   *  `acceptedNameUsage` needs the name that was displaced. */
  used_accepted_name: string;
};

/**
 * What a caller passes when the user deliberately picked a non-accepted name.
 *
 * `name_id` is only ever a TaiCOL `taicol_names.name_id`. It must NOT be taken
 * from `SearchResult.id`: that field is 0 for external taxa and, for Japanese
 * names, a locally minted offset that is renumbered on every wamei re-import.
 * When the name has no stable id (a JP alias, a free-typed name) leave it null
 * and store the string alone.
 */
export type AdoptionInput = {
  name_id?: number | null;
  scientific_name: string;
};

/** A record row's stored adoption, as written by the three add paths. */
export type AdoptionFields = {
  used_name_id: number | null;
  used_scientific_name: string | null;
};

/**
 * Resolve adopted names for a batch of records.
 *
 * `name_id` is `INTEGER NOT NULL PRIMARY KEY` in `taicol_names`, i.e. the
 * rowid — this is the cheapest lookup SQLite has, no extra index needed.
 */
export function resolveAdoptedNames(rows: AdoptionFields[]): Map<number, AdoptedName> {
  const out = new Map<number, AdoptedName>();
  const ids = Array.from(
    new Set(rows.map((r) => r.used_name_id).filter((v): v is number => typeof v === 'number')),
  );
  if (ids.length === 0) return out;

  const ph = ids.map(() => '?').join(',');
  const res = getTaicolDb().executeSync(
    `SELECT name_id, simple_name, name_author, usage_status FROM taicol_names WHERE name_id IN (${ph})`,
    ids,
  );
  for (const row of (res.rows ?? []) as Array<Record<string, unknown>>) {
    const id = Number(row.name_id);
    out.set(id, {
      simple_name: (row.simple_name as string) ?? '',
      name_author: (row.name_author as string) ?? '',
      usage_status: (row.usage_status as string) ?? '',
      stale: false,
    });
  }
  return out;
}

/**
 * Overlay the adopted name onto resolved taxon fields.
 *
 * Only the name changes — hierarchy, conservation status and vernacular still
 * come from the taxon, because adopting a name is a statement about
 * nomenclature, not about where the organism sits.
 */
export function applyAdoptedName<T extends TaxonFields>(
  fields: T,
  rec: AdoptionFields,
  resolved: Map<number, AdoptedName>,
): T & AdoptionStatus {
  const stored = (rec.used_scientific_name ?? '').trim();
  if (rec.used_name_id == null && !stored) {
    return { ...fields, used_status: '', used_stale: false, used_accepted_name: '' };
  }
  const acceptedName = fields.simple_name;
  const hit = rec.used_name_id != null ? resolved.get(rec.used_name_id) : undefined;
  // The stored string wins whenever the checklist can't confirm it — showing a
  // name the user never chose would be worse than showing a stale one.
  const agrees = !!hit && (!stored || hit.simple_name === stored);
  if (agrees && hit) {
    return {
      ...fields,
      simple_name: hit.simple_name,
      name_author: hit.name_author,
      used_status: hit.usage_status,
      used_stale: false,
      used_accepted_name: acceptedName,
    };
  }
  return {
    ...fields,
    simple_name: stored || fields.simple_name,
    name_author: hit?.name_author ?? '',
    used_status: hit?.usage_status ?? '',
    used_stale: true,
    used_accepted_name: acceptedName,
  };
}
