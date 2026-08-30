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
