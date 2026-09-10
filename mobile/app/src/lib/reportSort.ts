/**
 * Sorting is a VIEW concern, deliberately: the model's row order is the one the
 * exported HTML and DOCX carry, and re-ordering here must never change what a
 * document says. So the sort lives in component state and the model is never
 * touched.
 *
 * Total rows (`table.totalRows`) are pinned to the bottom rather than sorted
 * with the data — a Sum line is not an observation, and sorting it into the
 * middle would be nonsense. The model declares them; the view does not guess.
 */
export type SortState = { col: number; dir: 'asc' | 'desc' } | null;

/** Numeric when the cell is a number, possibly with a trailing % or a
 *  thousands separator; otherwise compare as text. Missing values (the en
 *  dash, or blank) always sort last, in both directions — "no data" is not a
 *  small value. */
export function compareCells(a: string, b: string, dir: 'asc' | 'desc'): number {
  const missing = (v: string) => v === '' || v === '–' || v === '-';
  if (missing(a) && missing(b)) return 0;
  if (missing(a)) return 1;
  if (missing(b)) return -1;
  const na = Number(a.replace(/[%,\s]/g, ''));
  const nb = Number(b.replace(/[%,\s]/g, ''));
  const both = Number.isFinite(na) && Number.isFinite(nb);
  const cmp = both ? na - nb : a.localeCompare(b);
  return dir === 'asc' ? cmp : -cmp;
}
