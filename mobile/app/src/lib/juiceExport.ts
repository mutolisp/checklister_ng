/**
 * JUICE import files — the semicolon "spreadsheet format" table (JUICE manual
 * §1.4.4), a semicolon header-data table (imported via File → Import → Header
 * Data), and a species list (§1.4.3, `id,abbrev,name`).
 *
 * Pure module (Node-runnable, see scripts/check-vegmatrix.mjs).
 *
 * Format facts used here, all from the JUICE v6 manual / Berg (2019):
 *  - table: line 1 title, line 2 "Number of relevés: N", blank line, then
 *    `;;nr;nr;…` header and `species;layer;v;v;…` rows; absence = '.';
 *    cover values may be Braun-Blanquet codes or percentages; the layer
 *    column is optional but when present must be a NUMBER 1–9;
 *    the table must not contain header data.
 *  - header data joins on a unique integer relevé number (1–999999).
 *  - JUICE stores cover internally as integer percentages 0–100.
 */
import type { PlotSpeciesRecordWithTaxon } from '~/db';
import {
  aggregateCell,
  colKeyOf,
  type Releve,
  type SpeciesCol,
} from './vegMatrix';
import { kindForType } from './dwcAbundanceCore';

/** JUICE semicolon cells: no quoting exists, so strip the delimiter. */
function juiceCell(v: string): string {
  return v.replace(/[;\r\n]+/g, ' ').trim();
}

/** Layer key 'E1'..'E6' → JUICE numeric layer 1..6 (must be 1-9). */
function juiceLayer(layer: string | null): string {
  return layer && /^E[1-6]$/.test(layer) ? layer.slice(1) : '';
}

/** Raw JUICE cell for one (relevé, species[, layer]) group:
 *  all-BB → highest code verbatim; all-percent → max as integer (≤100);
 *  anything else (counts, DBH, custom, mixed) → '1' (minimal positive cover,
 *  presence marker) — reported through `lossyTaxa` for the README. */
function juiceValue(
  records: PlotSpeciesRecordWithTaxon[],
): { cell: string; lossy: boolean } {
  const kinds = new Set(records.map((r) => kindForType(r.organism_quantity_type)));
  if (kinds.size === 1 && kinds.has('BB')) {
    const agg = aggregateCell(records, 'cover');
    if (agg.bbCode != null) return { cell: agg.bbCode, lossy: agg.lossy };
    return { cell: '1', lossy: true };
  }
  if (kinds.size === 1 && kinds.has('percent')) {
    let best: number | null = null;
    let lossy = false;
    for (const r of records) {
      const n = Number(r.organism_quantity);
      if (r.organism_quantity != null && Number.isFinite(n)) {
        if (best == null || n > best) best = n;
      } else lossy = true;
    }
    if (best == null) return { cell: '1', lossy: true };
    return { cell: String(Math.min(100, Math.max(0, Math.round(best)))), lossy };
  }
  return { cell: '1', lossy: true };
}

export function buildJuiceTable(
  releves: Releve[],
  cols: SpeciesCol[],
  title: string,
): { text: string; lossyTaxa: string[] } {
  const colByKey = new Map(cols.map((c) => [c.key, c]));
  // Layer column only exists when some record actually carries a layer.
  const hasLayers = releves.some((rel) => rel.records.some((r) => r.layer && r.layer !== 'T'));

  // Species rows: one per (species, layer) actually observed.
  type RowKey = { key: string; layer: string | null; name: string };
  const rowKeys: RowKey[] = [];
  const seen = new Set<string>();
  for (const rel of releves) {
    for (const r of rel.records) {
      const key = colKeyOf(r);
      const layer = hasLayers && r.layer && r.layer !== 'T' ? r.layer : null;
      const lk = `${key}#${layer ?? ''}`;
      if (seen.has(lk)) continue;
      seen.add(lk);
      rowKeys.push({ key, layer, name: colByKey.get(key)?.name ?? key });
    }
  }
  rowKeys.sort((a, b) => a.name.localeCompare(b.name) || (a.layer ?? '').localeCompare(b.layer ?? ''));

  // Pre-group each relevé's records by (key, layer).
  const groups = releves.map((rel) => {
    const m = new Map<string, PlotSpeciesRecordWithTaxon[]>();
    for (const r of rel.records) {
      const layer = hasLayers && r.layer && r.layer !== 'T' ? r.layer : null;
      const lk = `${colKeyOf(r)}#${layer ?? ''}`;
      (m.get(lk) ?? m.set(lk, []).get(lk)!).push(r);
    }
    return m;
  });

  const lossy = new Set<string>();
  const lines: string[] = [];
  lines.push(juiceCell(title) || 'Checklister-NG export');
  lines.push(`Number of relevés: ${releves.length}`);
  lines.push('');
  // Two leading empty cells (species + layer) with a layer column, one without.
  lines.push(`${hasLayers ? ';;' : ';'}${releves.map((r) => String(r.nr)).join(';')}`);
  for (const rk of rowKeys) {
    const cells = groups.map((g) => {
      const recs = g.get(`${rk.key}#${rk.layer ?? ''}`);
      if (!recs) return '.';
      const v = juiceValue(recs);
      if (v.lossy) lossy.add(rk.name);
      return v.cell;
    });
    const layerPart = hasLayers ? `;${juiceLayer(rk.layer)}` : '';
    lines.push(`${juiceCell(rk.name)}${layerPart};${cells.join(';')}`);
  }
  return { text: lines.join('\n'), lossyTaxa: [...lossy].sort() };
}

/** Header data table (semicolon). First column is the joining relevé number;
 *  `date` is YYYYMMDD (Berg 2019); remaining columns are the env-term union
 *  in the same order as analysis/env.csv. */
export function buildJuiceHeader(releves: Releve[]): string {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const rel of releves) {
    for (const { term } of rel.envRows) {
      if (!seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
    }
  }
  const lines = [`Relevé number;releveId;date;${terms.map(juiceCell).join(';')}`];
  for (const rel of releves) {
    const byTerm = new Map(rel.envRows.map((r) => [r.term, r.value]));
    const date = rel.startDate ? rel.startDate.replace(/-/g, '') : '';
    lines.push(
      `${rel.nr};${juiceCell(rel.id)};${date};${terms
        .map((tm) => juiceCell(byTerm.get(tm) ?? ''))
        .join(';')}`,
    );
  }
  return lines.join('\n');
}

/** Species list, 3-column CSV form of manual §1.4.3: `id,abbrev,name`.
 *  Abbreviation: 4 letters of the genus + 3 of the epithet, uppercase
 *  (Turboveg's 7-character convention), digit-suffixed on collision. */
export function buildJuiceSpeciesList(cols: SpeciesCol[]): string {
  const used = new Set<string>();
  const lines = cols.map((c, i) => {
    const parts = c.scientificName.split(/\s+/);
    const genus = (parts[0] ?? '').replace(/[^A-Za-z]/g, '');
    const epithet = (parts[1] ?? '').replace(/[^A-Za-z]/g, '');
    let abbrev = `${genus.slice(0, 4)}${epithet.slice(0, 3)}`.toUpperCase() || `TAX${i + 1}`;
    if (used.has(abbrev)) {
      for (let n = 2; ; n++) {
        const candidate = `${abbrev.slice(0, 7 - String(n).length)}${n}`;
        if (!used.has(candidate)) {
          abbrev = candidate;
          break;
        }
      }
    }
    used.add(abbrev);
    const name = c.name.replace(/[,\r\n]+/g, ' ');
    return `${i + 1},${abbrev},${name}`;
  });
  return lines.join('\n');
}
