/**
 * Report value formatting. Deliberately locale-independent — ISO dates and
 * plain decimals — which is the app's house rule for anything that lands in a
 * file: a report exported in French must still sort and parse like every other
 * export.
 *
 * Extracted from `reportModel.ts` so the section builders can share it without
 * importing the builders. Pure module.
 */
import { kindForType, parseDbhArray } from './dwcAbundanceCore';
import { scientificNameMd } from './scientificNameSegments';
import type { Translate } from './reportTypes';
import type { ReportRecord } from './reportStats';

/** Missing values are an en dash everywhere, never a blank cell — a blank
 *  reads as "zero" or "forgot to fill in"; the dash reads as "no data". */
export const DASH = '–';

export const num = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v) ? DASH : v.toFixed(digits);

export const int = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? DASH : String(Math.round(v));

export const pct = (v: number | null | undefined, digits = 1): string =>
  v == null || !Number.isFinite(v) ? DASH : `${(v * 100).toFixed(digits)}%`;

export function isoDateTime(ms: number | null | undefined): string {
  if (!ms) return DASH;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function durationText(
  startMs: number | null,
  stopMs: number | null,
  t: Translate,
): string {
  if (!startMs || !stopMs || stopMs <= startMs) return DASH;
  const mins = Math.round((stopMs - startMs) / 60000);
  return t('report.minutes', { n: mins });
}

/**
 * Species display name: vernacular + scientific, whichever exist.
 *
 * The scientific part carries `*italic*` markers following the app's single
 * definition in `scientificNameSegments.ts` — genus/species/infraspecific
 * epithets italic, rank tokens and authors upright, family and above upright
 * throughout. The vernacular name is never italic.
 *
 * Renderers that can style part of a string honour the markers; the DOCX
 * chart mapper strips them, because a DrawingML category label is a single
 * plain `<c:v>` and cannot carry mixed formatting.
 */
export function speciesLabel(r: ReportRecord): string {
  const sci = scientificName(r);
  return r.common_name_c ? `${r.common_name_c} ${sci}` : sci;
}

/** The scientific name alone, with italic markers. */
export function scientificName(r: ReportRecord): string {
  const raw = r.used_scientific_name || r.simple_name || r.taxon_id;
  return scientificNameMd(raw, { kingdom: r.kingdom, rank: r.rank });
}

/** Ground-cover field → the label key the plot editor already uses, so the
 *  report and the entry form never call the same number two things. */
export const COVER_LABEL_KEY: Record<string, string> = {
  rock_cover_pct: 'plot.rockCover',
  gravel_cover_pct: 'plot.gravelCover',
  bareland_cover_pct: 'plot.bareCover',
  litter_cover_pct: 'plot.litterCover',
  vascular_cover_pct: 'plot.vascularCover',
  bryophyte_cover_pct: 'plot.bryophyteCover',
  lichen_cover_pct: 'plot.lichenCover',
};

/**
 * Alien status label. Mirrors `mapAlienType` in src/db/search.ts: invasive is
 * folded into naturalized, and 'cultured' splits by kingdom (captive for
 * animals, cultivated for plants). Reimplemented rather than imported because
 * that module pulls in the DB and `~/i18n`.
 */
export function alienLabel(
  code: string,
  kingdom: string | undefined,
  t: Translate,
): string {
  if (code === 'cultured') return t(kingdom === 'Animalia' ? 'alien.captive' : 'alien.cultivated');
  if (code === 'native') return t('alien.native');
  if (code === 'naturalized' || code === 'invasive') return t('alien.naturalized');
  return code;
}

/**
 * Abundance as a reader can use it, with its unit.
 *
 * The species tables used to print `organism_quantity` verbatim, which for a
 * DBH record is the raw JSON array — `[12,18,25,31,44]` — and for a
 * Braun-Blanquet record a bare `4` indistinguishable from a count of four.
 * Neither states its unit, and the DBH form is not something a reader should
 * have to decode.
 */
export function abundanceText(
  quantity: string | null | undefined,
  type: string | null | undefined,
  t: Translate,
): string {
  if (quantity == null || quantity === '') return '';
  switch (kindForType(type)) {
    case 'DBH': {
      const stems = parseDbhArray(quantity).filter((d) => d > 0);
      if (stems.length === 0) return '';
      const lo = Math.min(...stems);
      const hi = Math.max(...stems);
      return t('report.abundanceDbh', {
        count: stems.length,
        range: lo === hi ? num(lo, 1) : `${num(lo, 1)}–${num(hi, 1)}`,
      });
    }
    case 'BB':
      return `Br.-Bq. ${quantity}`;
    case 'percent':
      return `${quantity}%`;
    case 'count':
      return t('report.abundanceCount', { count: quantity });
    default:
      // A user-defined type: show the value and name the unit, since nothing
      // else in the report can tell the reader what it measures.
      return type ? `${quantity} ${type}` : String(quantity);
  }
}
