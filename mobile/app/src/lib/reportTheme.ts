/**
 * Chart colours, in one place because the three renderers had already drifted:
 * the in-app chart and the DOCX chart drew bars in #059669 while the exported
 * HTML used #047857 for the same series. Nobody noticed because you have to
 * put the screen and the printed page side by side to see it — which is
 * exactly the class of divergence "one model, three renderers" exists to stop.
 *
 * Hex WITHOUT the leading '#': DrawingML's `<a:srgbClr val="…">` takes the
 * bare six digits, and the other two renderers can prepend a '#' more safely
 * than OOXML can strip one.
 *
 * Pure module — no imports, so `check:report` can assert that what the HTML
 * contains is what this file exports.
 */

/** Primary series, then secondary (the paler "estimated" companion). */
export const CHART_PRIMARY = '059669';
export const CHART_SECONDARY = 'A7F3D0';

/** Series palette for multi-series charts, primary first. */
export const CHART_COLORS: string[] = [
  CHART_PRIMARY,
  CHART_SECONDARY,
  '0F766E',
  '65A30D',
  'CA8A04',
];

/** Track (unfilled remainder) behind a bar, light and dark. */
export const CHART_TRACK = 'E5E7EB';
export const CHART_TRACK_DARK = '374151';

export const withHash = (hex: string): string => `#${hex}`;

/** Series colour by index, wrapping rather than running out. */
export function seriesColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}
