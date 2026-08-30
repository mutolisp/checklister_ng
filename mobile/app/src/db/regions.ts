import { getTaicolDb, getUserDb } from './init';
import i18n from '~/i18n';
import type { RegionCode } from '~/stores/settings';

/**
 * Regional checklist helpers. Taiwan (TaiCOL) is the always-on base; Japan
 * (YList → `jp_names`) is an opt-in overlay. When only ['TW'] is enabled the
 * whole app behaves exactly as before this feature — every region-aware code
 * path early-returns to its original TaiCOL-only branch.
 *
 * Backend-built crosswalk (bundled in twnamelist.db, see
 * backend/services/ylist_import.py) powers the overlay:
 *   - species_xref(taxon_id, region, sci_norm, common_name_c) — same sci_norm
 *     across regions = shared species. Carries common_name_c so cross-region
 *     vernacular lookup is a pure self-join (no big-table / view join).
 *
 * taxon_id namespaces never collide: TaiCOL = 't…', YList = 'y…' — so any
 * taxon_id resolves by querying taicol_names or jp_names directly.
 */

/** Read enabled regions straight from the settings table so the DB layer stays
 *  decoupled from the React store. Always includes 'TW'. Default ['TW']. */
export function getEnabledRegions(): RegionCode[] {
  try {
    const res = getUserDb().executeSync(
      `SELECT value FROM settings WHERE key='enabled_regions' LIMIT 1`,
    );
    const raw = ((res.rows ?? [])[0] as { value?: string } | undefined)?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const f = parsed.filter((v): v is RegionCode => v === 'TW' || v === 'JP');
        if (!f.includes('TW')) f.unshift('TW');
        return f;
      }
    }
  } catch {
    // settings unavailable — fall through to default
  }
  return ['TW'];
}

export function jpEnabled(): boolean {
  return getEnabledRegions().includes('JP');
}

/** Where a taxon_id's data lives. The first character is the whole
 *  discriminator: TaiCOL 't…', Japan 'y…', external (GBIF) 'g…'. */
export type TaxonSource = 'taicol' | 'jp' | 'external';

/** taxon_id belongs to the Japan (YList / wamei) dataset. */
export function isJpTaxonId(taxonId: string | null | undefined): boolean {
  return !!taxonId && taxonId.charAt(0) === 'y';
}

/** taxon_id was minted for a species absent from both bundled checklists; its
 *  row lives in user.db's `external_taxa`, not in twnamelist.db. */
export function isExternalTaxonId(taxonId: string | null | undefined): boolean {
  return !!taxonId && taxonId.charAt(0) === 'g';
}

export function sourceOfTaxonId(taxonId: string | null | undefined): TaxonSource {
  if (isJpTaxonId(taxonId)) return 'jp';
  if (isExternalTaxonId(taxonId)) return 'external';
  return 'taicol';
}

/**
 * Region for cross-region vernacular composition.
 *
 * NOTE this is a REGION, not a source: external taxa have no region of their
 * own and deliberately report 'TW' so they simply take the no-cross-vernacular
 * path. Use `sourceOfTaxonId` to decide which table to query — asking this
 * function is what would silently send a 'g…' id to taicol_names.
 */
export function regionOfTaxonId(taxonId: string | null | undefined): RegionCode {
  return isJpTaxonId(taxonId) ? 'JP' : 'TW';
}

/** Endemic-status tag text. YList `is_endemic` means *Japan*-endemic, so a 'y…'
 *  taxon must not borrow Taiwan's wording. TaiCOL keeps its existing "特有種". */
export function endemicTagLabel(taxonId: string | null | undefined): string {
  return isJpTaxonId(taxonId) ? i18n.t('species.japanEndemic') : i18n.t('species.endemic');
}

/** Normalize a scientific name into the cross-region match key — must mirror
 *  `sci_norm()` in backend/services/ylist_import.py exactly. */
export function normalizeSci(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/×/g, 'x');
}

/**
 * For a set of taxon_ids, look up the accepted vernacular name in each enabled
 * region via the scientific-name crosswalk. Returns taxon_id → { tw?, jp? }.
 * Only meaningful when JP is enabled. Resilient to species_xref / all_names
 * being absent on older bundles (returns an empty map → no enrichment).
 */
export function crossRegionVernacular(
  taxonIds: string[],
  regions: RegionCode[],
): Map<string, { tw?: string; jp?: string }> {
  const out = new Map<string, { tw?: string; jp?: string }>();
  const ids = [...new Set(taxonIds.filter(Boolean))];
  if (ids.length === 0 || regions.length === 0) return out;
  try {
    const db = getTaicolDb();
    const idPh = ids.map(() => '?').join(',');
    const regPh = regions.map(() => '?').join(',');
    // Pure species_xref self-join — both sides hit an index (PK taxon_id /
    // idx_xref_sci_norm). Crucially does NOT touch taicol_names/jp_names or
    // any UNION view, which would materialize ~270k rows and take seconds.
    const res = db.executeSync(
      `SELECT x0.taxon_id AS orig, x1.region AS region, x1.common_name_c AS cname
         FROM species_xref x0
         JOIN species_xref x1 ON x1.sci_norm = x0.sci_norm
        WHERE x0.taxon_id IN (${idPh}) AND x1.region IN (${regPh})
          AND x1.common_name_c IS NOT NULL`,
      [...ids, ...regions],
    );
    for (const row of (res.rows ?? []) as Array<{
      orig: string;
      region: string;
      cname: string | null;
    }>) {
      if (!row.cname) continue;
      const e = out.get(row.orig) ?? {};
      if (row.region === 'TW') e.tw ??= row.cname;
      else if (row.region === 'JP') e.jp ??= row.cname;
      out.set(row.orig, e);
    }
  } catch {
    // crosswalk objects absent — degrade to no enrichment
  }
  return out;
}

/**
 * Compose the display vernacular for a row from its own name/region and the
 * cross-region lookup. Shared species → "臺灣俗名 / 和名"; single-region → that
 * region's name. Falls back to ownCname when the crosswalk had nothing.
 */
export function composeVernacular(
  ownCname: string,
  ownRegion: RegionCode,
  cross: { tw?: string; jp?: string } | undefined,
  regions: RegionCode[],
): string {
  const tw = cross?.tw ?? (ownRegion === 'TW' ? ownCname : undefined);
  const jp = cross?.jp ?? (ownRegion === 'JP' ? ownCname : undefined);
  const parts: string[] = [];
  if (regions.includes('TW') && tw) parts.push(tw);
  if (regions.includes('JP') && jp && jp !== tw) parts.push(jp);
  return parts.length > 0 ? parts.join(' / ') : ownCname;
}
