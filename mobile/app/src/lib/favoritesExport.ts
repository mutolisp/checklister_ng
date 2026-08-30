/**
 * Export one 常用名錄 as a document or a spreadsheet.
 *
 * Reuses the checklist pipeline rather than growing a parallel one:
 * `taxonToMarkdownItem` → `generateMarkdown` → `markdownToDocx` is exactly what
 * a session export does, so a favourites list comes out looking like every
 * other checklist this app produces.
 *
 * A favourites row stores only enough to render the list offline, so the taxon
 * is re-resolved here to get conservation status, higher taxonomy and the rest
 * — the same `resolveTaxa` every record list already goes through.
 */
import { convertToDwc } from './dwcMapper';
import { markdownToDocx } from './docx';
import { generateMarkdown } from './markdown';
import { mapAlienToSource, taxonToMarkdownItem } from './bundleExport';
import { resolveTaxa, EMPTY_TAXON_FIELDS, type FavoriteItem, type TaxonFields } from '~/db';

export type FavoritesExportFormat = 'docx' | 'csv';

type Resolved = { taxon_id: string; fields: TaxonFields };

function resolve(items: FavoriteItem[]): Resolved[] {
  const taxa = resolveTaxa(items.map((i) => i.taxon_id));
  return items.map((i) => ({
    taxon_id: i.taxon_id,
    fields: taxa.get(i.taxon_id) ?? EMPTY_TAXON_FIELDS,
  }));
}

/** Taxonomic order, matching what the record exports put in their CSV. */
function taxonSort(a: Resolved, b: Resolved): number {
  const keys: (keyof TaxonFields)[] = [
    'kingdom',
    'phylum',
    'class',
    'order',
    'family',
    'genus',
    'simple_name',
  ];
  for (const k of keys) {
    const d = (a.fields[k] || '').localeCompare(b.fields[k] || '');
    if (d !== 0) return d;
  }
  return 0;
}

export function buildFavoritesDocx(folderName: string, items: FavoriteItem[]): Uint8Array {
  const md = generateMarkdown(
    resolve(items).map((r) => taxonToMarkdownItem(r.taxon_id, r.fields)),
    { project: folderName },
  );
  return markdownToDocx(md);
}

/**
 * DwC CSV, one row per species.
 *
 * Columns are the union of every row's keys, so a list where only some species
 * carry a CITES appendix still gets the column. UTF-8 BOM because Excel on
 * Windows reads a BOM-less UTF-8 CSV as the local codepage and mangles every
 * Chinese name.
 */
export function buildFavoritesCsv(items: FavoriteItem[]): string {
  const rows = resolve(items)
    .sort(taxonSort)
    .map(({ taxon_id, fields: f }) =>
      convertToDwc({
        taxon_id,
        name: f.simple_name,
        fullname: f.name_author ? `${f.simple_name} ${f.name_author}` : f.simple_name,
        cname: f.common_name_c,
        family: f.family,
        family_c: f.family_c,
        kingdom: f.kingdom,
        phylum: f.phylum,
        class_name: f.class,
        order: f.order,
        genus: f.genus,
        rank: f.rank,
        endemic: f.is_endemic === 'true' ? 1 : 0,
        is_hybrid: f.is_hybrid,
        // `source`, not the raw `alien_type`: dwcMapper maps it to
        // establishmentMeans, and the record exports emit the same readable
        // 原生／歸化／栽培／圈養 value. A raw enum column would be the one
        // non-DwC field in an otherwise DwC file.
        source: mapAlienToSource(f.alien_type, f.kingdom),
        redlist: f.redlist,
        iucn_category: f.iucn,
        cites: f.cites,
        protected: f.protected,
      }),
    );

  const keys: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}
