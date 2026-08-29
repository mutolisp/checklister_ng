/**
 * Resolve a batch of taxon_ids to their accepted-name fields.
 *
 * Extracted so a new record kind doesn't need a third copy of the query.
 * `listSessionRecords` (records.ts) and `listPlotSpecies` (plots.ts) still carry
 * their own inlined copies — they predate this helper and are left untouched on
 * purpose; folding them in is a safe follow-up, not part of this change.
 */
import { getTaicolDb } from './init';
import {
  getEnabledRegions,
  isJpTaxonId,
  regionOfTaxonId,
  crossRegionVernacular,
  composeVernacular,
} from './regions';

export type TaxonFields = {
  simple_name: string;
  name_author: string;
  common_name_c: string;
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
};

const TAXON_COLS = `taxon_id, simple_name, name_author, common_name_c,
  family, family_c, rank, is_endemic, alien_type, is_hybrid,
  kingdom, kingdom_c, phylum, phylum_c, class, class_c, "order", order_c, genus, genus_c,
  redlist, iucn, cites, protected`;

export const EMPTY_TAXON_FIELDS: TaxonFields = {
  simple_name: '', name_author: '', common_name_c: '', family: '', family_c: '', rank: '',
  is_endemic: '', alien_type: '', redlist: '', iucn: '', cites: '', protected: '', is_hybrid: '',
  kingdom: '', kingdom_c: '', phylum: '', phylum_c: '', class: '', class_c: '',
  order: '', order_c: '', genus: '', genus_c: '',
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
  fillFrom('taicol_names', ids.filter((id) => !isJpTaxonId(id)));
  fillFrom('ylist_names', ids.filter(isJpTaxonId));

  const regions = getEnabledRegions();
  const cross = regions.includes('JP') ? crossRegionVernacular(ids, regions) : null;

  const str = (t: Record<string, unknown>, k: string) => (t[k] as string) ?? '';
  for (const id of ids) {
    const t = raw.get(id) ?? {};
    const ownCname = str(t, 'common_name_c');
    out.set(id, {
      simple_name: str(t, 'simple_name'),
      name_author: str(t, 'name_author'),
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
    });
  }
  return out;
}
