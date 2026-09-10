/**
 * Report → .docx bytes, the third renderer over the same model as the on-screen
 * view and the HTML file.
 *
 * Charts here are REAL Word charts (DrawingML), not pictures and not shaded
 * cells: vector at any zoom, restyleable, and "Edit Data" opens the numbers.
 * The parts that costs are built in `ooxmlChart.ts`; this file places them and
 * keeps the bookkeeping straight — one chart part, one embedded workbook, one
 * relationship and two content-type entries per chart, all allocated from the
 * same counter so they cannot drift apart.
 *
 * Two traps inherited from `docxLabels.ts`, both still live here:
 *   - a `<w:tc>` with no block-level child is the classic "unreadable content"
 *     prompt, so every cell gets a paragraph even when empty;
 *   - `<w:body>` must not end with a table, hence the trailing paragraph.
 *
 * Pure module (fflate + string building only) so `check:report` can unzip and
 * assert on the result under Node.
 */
import { strToU8 } from 'fflate';
import {
  A4_SECT_PR,
  buildDocx,
  parseRuns,
  runXml,
  xmlEscape,
  type DocxExtras,
} from './docx';
import {
  CHART_CONTENT_TYPE,
  CHART_REL_TYPE,
  EMU_PER_CM,
  XLSX_CONTENT_TYPE,
  buildChartDrawing,
  buildChartRels,
  buildChartWorkbook,
  buildChartXml,
  buildLineChartWorkbook,
  buildLineChartXml,
  type ChartInput,
  type LineChartInput,
} from './ooxmlChart';
import { CHART_PRIMARY, CHART_SECONDARY, seriesColor } from './reportTheme';
import { stripNameMd } from './scientificNameSegments';
import type {
  CategoricalChart,
  ProfileChart,
  XYChart,
  Report,
  ReportChart,
  ReportSection,
  ReportTable,
} from './reportTypes';

/** A4 with 2 cm margins leaves 17 cm of text width (see `A4_SECT_PR`). */
const CONTENT_W_CM = 17;
const CONTENT_W_TWIPS = 9639;

const FILL_1 = CHART_PRIMARY;
const FILL_2 = CHART_SECONDARY;

// Half-point font sizes, one step below the checklist export's: a report is
// denser than a species list and 12 pt body would run to twice the pages.
const SZ_TITLE = 30;
const SZ_SUB = 20;
const SZ_HEADING = 24;
const SZ_BODY = 20;
const SZ_SMALL = 16;

function para(runs: string, opts: { after?: number; before?: number } = {}): string {
  const spacing = `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 60}"/>`;
  return `<w:p><w:pPr>${spacing}</w:pPr>${runs}</w:p>`;
}

function textPara(
  text: string,
  size: number,
  opts: { bold?: boolean; after?: number; before?: number; color?: string } = {},
): string {
  if (!text) return '';
  const props =
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="標楷體"/>' +
    (opts.bold ? '<w:b/>' : '') +
    (opts.color ? `<w:color w:val="${opts.color}"/>` : '') +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  const run = `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  return para(run, opts);
}

// ── tables ──────────────────────────────────────────────────────────────────

const BORDER_SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
const TBL_BORDERS =
  '<w:tblBorders>' +
  BORDER_SIDES.map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('') +
  '</w:tblBorders>';

/** `CT_TblPrBase` is a sequence: tblW → … → tblBorders → shd → tblLayout →
 *  tblCellMar. Same ordering trap as the label sheet. */
const TBL_PR =
  `<w:tblPr><w:tblW w:w="${CONTENT_W_TWIPS}" w:type="dxa"/>${TBL_BORDERS}` +
  '<w:tblLayout w:type="fixed"/>' +
  '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>' +
  '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>';

/**
 * Column widths: the first column carries names and takes the slack, the rest
 * share what is left evenly. Fixed layout is deliberate — Word's auto-fit would
 * size columns to content and make every table in the report a different shape.
 */
function columnWidths(table: ReportTable): number[] {
  const n = table.columns.length;
  if (n === 1) return [CONTENT_W_TWIPS];
  const rest = Math.floor((CONTENT_W_TWIPS * 0.62) / (n - 1));
  const first = CONTENT_W_TWIPS - rest * (n - 1);
  return [first, ...Array<number>(n - 1).fill(rest)];
}

function cell(inner: string, width: number, shaded: boolean): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (shaded ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>' : '') +
    '<w:vAlign w:val="center"/></w:tcPr>' +
    // Never an empty cell: no block-level child is the classic corrupt-file
    // prompt.
    `${inner || '<w:p/>'}</w:tc>`
  );
}

/** `headless` drops the header row — used for the key/value metadata blocks,
 *  where a shaded row of empty column titles is worse than no header at all. */
function tableXml(table: ReportTable, headless = false): string {
  const widths = columnWidths(table);
  const jc = (i: number) =>
    table.align?.[i] === 'right' ? '<w:jc w:val="right"/>' : '';

  const headCells = table.columns
    .map((c, i) => {
      const runs =
        `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="標楷體"/>` +
        `<w:b/><w:sz w:val="${SZ_SMALL}"/><w:szCs w:val="${SZ_SMALL}"/></w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(c)}</w:t></w:r>`;
      const p = `<w:p><w:pPr><w:spacing w:after="0"/>${jc(i)}</w:pPr>${runs}</w:p>`;
      return cell(p, widths[i], true);
    })
    .join('');
  // tblHeader repeats the header row when a long table breaks across pages.
  const head = headless ? '' : `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headCells}</w:tr>`;

  const body = table.rows
    .map((r) => {
      const cells = r
        .map((v, i) => {
          // Cell text arrives carrying `*italic*` markers from the model, so it
          // goes through the same run parser the Markdown export uses — genus
          // and epithet stay italic here exactly as they do everywhere else.
          const runs = parseRuns(v, false)
            .map((run) => runXml(run, SZ_SMALL))
            .join('');
          const p = `<w:p><w:pPr><w:spacing w:after="0"/>${jc(i)}</w:pPr>${runs || '<w:r/>'}</w:p>`;
          return cell(p, widths[i] ?? widths[widths.length - 1], false);
        })
        .join('');
      return `<w:tr>${cells}</w:tr>`;
    })
    .join('');

  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  return `<w:tbl>${TBL_PR}${grid}${head}${body}</w:tbl>`;
}

// ── charts ──────────────────────────────────────────────────────────────────

/**
 * The report model's chart primitive → a chart part's input.
 *
 * `note` is dropped: it is a per-bar annotation with no equivalent in a Word
 * chart, and it always restates something the surrounding table already says.
 */
function chartInput(chart: CategoricalChart): ChartInput {
  const hasSecond = chart.rows.some((r) => r.value2 != null);
  const title = chart.unit ? `${chart.title} (${chart.unit})` : chart.title;
  const labels = chart.seriesLabels;
  const series = [
    {
      name: labels?.[0] ?? chart.title,
      values: chart.rows.map((r) => r.value),
      color: FILL_1,
    },
  ];
  if (hasSecond) {
    series.push({
      name: labels?.[1] ?? '',
      values: chart.rows.map((r) => (r.value2 == null ? NaN : r.value2)),
      color: FILL_2,
    });
  }
  return {
    title,
    // A DrawingML category label is a single plain `<c:v>` — it cannot carry
    // mixed formatting, so the italic markers a species label brings are
    // stripped rather than printed as literal asterisks. Table cells, which
    // go through `parseRuns`, keep their italics.
    categories: chart.rows.map((r) => stripNameMd(r.label)),
    series,
    legend: hasSecond,
    direction: chart.kind === 'column' ? 'col' : 'bar',
    categoryAxisTitle: chart.categoryAxisTitle,
    valueAxisTitle: chart.valueAxisTitle,
  };
}

/** Height grows with the bar count so twenty species do not get squeezed into
 *  the same box as three, then stops at 18 cm — beyond that Word pushes the
 *  whole frame onto its own page. */
function chartHeightCm(rows: number, series: number, vertical = false): number {
  // A column chart's height is the value axis, not the category count, so it
  // stays a fixed readable box instead of growing with the number of bins.
  if (vertical) return 8;
  const perBar = series > 1 ? 0.75 : 0.5;
  return Math.min(18, Math.max(4.5, 2.2 + rows * perBar));
}

// ── document ────────────────────────────────────────────────────────────────

type ChartAlloc = {
  extras: Required<Pick<DocxExtras, 'parts' | 'documentRels' | 'overrides' | 'defaults'>>;
  next: number;
  docPrId: number;
};

/** Allocate the four package additions one chart needs, and return the drawing
 *  that points at them. Everything is keyed off the same `n`, which is the only
 *  way part names, relationship ids and content types stay in step. */
/**
 * An XY chart's x values are evenly spaced ordinals (sample sizes, ranks), so
 * a CATEGORY axis is correct and `c:lineChart` can reuse the same cat/val
 * refs the bar path uses. `c:scatterChart` would need a separate xVal/yVal
 * builder for no gain.
 */
function lineChartInput(chart: XYChart, t: (k: string) => string): LineChartInput {
  const cats = chart.series[0]?.points.map((p) => String(p.x)) ?? [];
  const series: LineChartInput['series'] = [];
  chart.series.forEach((s, i) => {
    const hasBand = !!s.band && s.band.length === s.points.length;
    series.push({
      name: s.label,
      values: s.points.map((p) => (Number.isFinite(p.y) ? p.y : null)),
      color: seriesColor(i),
      // A shaded ribbon is not a DrawingML feature; the interval travels as
      // error bars, which is the standard way a Word chart shows one.
      errPlus: hasBand ? s.band!.map((b, j) => Math.max(0, b.hi - s.points[j].y)) : undefined,
      errMinus: hasBand ? s.band!.map((b, j) => Math.max(0, s.points[j].y - b.lo)) : undefined,
    });
  });
  return {
    title: chart.unit ? `${chart.title} (${chart.unit})` : chart.title,
    categories: cats,
    series,
    legend: chart.series.length > 1,
    categoryAxisTitle: chart.xAxis.title,
    valueAxisTitle: chart.yAxis.title,
    logBase: chart.yAxis.scale === 'log10' ? 10 : undefined,
  };
}

function addChart(alloc: ChartAlloc, chart: ReportChart): string {
  if (chart.kind === 'line') return addLineChart(alloc, chart);
  if (chart.kind === 'profile') return addChart(alloc, profileAsBars(chart));
  if (chart.kind !== 'bar' && chart.kind !== 'column') return '';
  const n = alloc.next++;
  const input = chartInput(chart);
  const chartPart = `word/charts/chart${n}.xml`;
  const dataPart = `word/embeddings/chartData${n}.xlsx`;
  const relId = `rIdChart${n}`;

  alloc.extras.parts[chartPart] = strToU8(buildChartXml(input));
  alloc.extras.parts[`word/charts/_rels/chart${n}.xml.rels`] = strToU8(
    // Relative to word/charts/, so up one level then into embeddings/.
    buildChartRels(`../embeddings/chartData${n}.xlsx`),
  );
  alloc.extras.parts[dataPart] = buildChartWorkbook(input);
  alloc.extras.documentRels.push({
    id: relId,
    type: CHART_REL_TYPE,
    target: `charts/chart${n}.xml`,
  });
  alloc.extras.overrides.push({ partName: `/${chartPart}`, contentType: CHART_CONTENT_TYPE });
  alloc.extras.overrides.push({ partName: `/${dataPart}`, contentType: XLSX_CONTENT_TYPE });

  const heightCm = chartHeightCm(input.categories.length, input.series.length, chart.kind === 'column');
  // `<w:drawing>` lives in EG_RunInnerContent, so it must be wrapped in a
  // `<w:r>`; a paragraph cannot hold one directly. Getting this wrong does not
  // corrupt the file — the drawing is silently dropped and the chart simply
  // never appears, which is why it is worth a comment.
  return `<w:p><w:pPr><w:spacing w:before="80" w:after="120"/></w:pPr><w:r>${buildChartDrawing({
    relId,
    docPrId: alloc.docPrId++,
    name: chart.title,
    cxEmu: CONTENT_W_CM * EMU_PER_CM,
    cyEmu: heightCm * EMU_PER_CM,
  })}</w:r></w:p>${chartNoteXml(chart.note)}`;
}

/**
 * A profile has to encode two things at once: WHERE a band sits on a metre
 * axis, and HOW MUCH cover it has. A DrawingML bar chart can encode one — its
 * categories are evenly spaced, so it cannot place a band at 12.4 m, and the
 * stacked-bar trick that could would spend the bar's length on height instead
 * of cover. So Word gets the cover bars with each band's height range folded
 * into its label, and the caption says where the metric profile lives.
 *
 * The degradation is stated rather than silent: an evenly-spaced Word figure
 * that looks like a profile but is not one would mislead.
 */
function profileAsBars(chart: ProfileChart): CategoricalChart {
  return {
    kind: 'bar',
    title: chart.title,
    unit: chart.unit,
    max: chart.max,
    valueAxisTitle: chart.valueAxisTitle,
    rows: chart.bands.map((b) => ({
      label: `${b.label} (${fmtM(b.y0)}–${fmtM(b.y1)} m)`,
      value: b.value,
    })),
    note: [chart.note, chart.degradedNote].filter(Boolean).join(' '),
  };
}

const fmtM = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Same package bookkeeping as `addChart`, with the line builders. */
function addLineChart(alloc: ChartAlloc, chart: XYChart): string {
  const n = alloc.next++;
  const input = lineChartInput(chart, (k) => k);
  const chartPart = `word/charts/chart${n}.xml`;
  const dataPart = `word/embeddings/chartData${n}.xlsx`;
  const relId = `rIdChart${n}`;

  alloc.extras.parts[chartPart] = strToU8(buildLineChartXml(input));
  alloc.extras.parts[`word/charts/_rels/chart${n}.xml.rels`] = strToU8(
    buildChartRels(`../embeddings/chartData${n}.xlsx`),
  );
  alloc.extras.parts[dataPart] = buildLineChartWorkbook(input);
  alloc.extras.documentRels.push({
    id: relId,
    type: CHART_REL_TYPE,
    target: `charts/chart${n}.xml`,
  });
  alloc.extras.overrides.push({ partName: `/${chartPart}`, contentType: CHART_CONTENT_TYPE });
  alloc.extras.overrides.push({ partName: `/${dataPart}`, contentType: XLSX_CONTENT_TYPE });

  return `<w:p><w:pPr><w:spacing w:before="80" w:after="120"/></w:pPr><w:r>${buildChartDrawing({
    relId,
    docPrId: alloc.docPrId++,
    name: chart.title,
    cxEmu: CONTENT_W_CM * EMU_PER_CM,
    cyEmu: 8 * EMU_PER_CM,
  })}</w:r></w:p>${chartNoteXml(chart.note)}`;
}

/** A chart's own caption. HTML and the in-app view already render it; without
 *  this the Word export silently dropped every chart-level caveat — including
 *  the mixed-unit warning that exists precisely so a reader of the chart alone
 *  is not misled. */
function chartNoteXml(note: string | undefined): string {
  return note ? textPara(note, SZ_SMALL, { after: 80, color: '6B7280' }) : '';
}

function sectionXml(section: ReportSection, alloc: ChartAlloc): string {
  const parts: string[] = [
    textPara(section.heading, SZ_HEADING, { bold: true, before: 240, after: 80, color: '065F46' }),
  ];
  for (const p of section.paras ?? []) parts.push(textPara(p, SZ_BODY, { after: 40 }));

  // Key/value metadata is a two-column table rather than "key: value" lines:
  // the values line up, which is the whole point of a data block.
  if (section.meta && section.meta.length > 0) {
    parts.push(
      tableXml(
        { columns: ['', ''], rows: section.meta.map((m) => [m.key, m.value]) },
        true,
      ),
    );
    parts.push('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>');
  }

  if (section.chart) parts.push(addChart(alloc, section.chart));
  if (section.table) {
    parts.push(tableXml(section.table));
    parts.push('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>');
  }
  if (section.note) parts.push(textPara(section.note, SZ_SMALL, { after: 40, color: '6B7280' }));
  return parts.join('');
}

export function buildReportDocx(report: Report): Uint8Array {
  const alloc: ChartAlloc = {
    extras: { parts: {}, documentRels: [], overrides: [], defaults: [] },
    next: 1,
    docPrId: 1,
  };

  const head = [
    textPara(report.title, SZ_TITLE, { bold: true, after: 40 }),
    report.subtitle ? textPara(report.subtitle, SZ_SUB, { after: 20, color: '4B5563' }) : '',
    textPara(report.generatedAt, SZ_SMALL, { after: 120, color: '6B7280' }),
  ].join('');

  const body = report.sections.map((s) => sectionXml(s, alloc)).join('');

  // The body must not end with a table — a report whose last section is a
  // table (conservation, methods) would otherwise produce exactly that.
  const trailer = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';

  // No `Default Extension="xlsx"`: every embedded workbook gets an explicit
  // Override, which OPC resolves ahead of any Default, so adding one would be
  // a second declaration of the same fact.
  return buildDocx(head + body + trailer, A4_SECT_PR, {
    parts: alloc.extras.parts,
    documentRels: alloc.extras.documentRels,
    overrides: alloc.extras.overrides,
  });
}
