/**
 * DrawingML chart parts for a WordprocessingML package — a real Word chart,
 * vector and editable, not a picture of one.
 *
 * A chart costs four things in the package, not one:
 *   word/charts/chart{n}.xml            the chart itself
 *   word/charts/_rels/chart{n}.xml.rels its link to the data
 *   word/embeddings/chartData{n}.xlsx   the data, as a nested OPC package
 *   plus a relationship + content-type entry for each of the above
 *
 * The embedded workbook is not optional. ECMA-376 Part 1, Chart part:
 * "For Word and presentation documents … the data for a chart is not stored
 * in the Chart part directly. Instead, it shall be stored in an embedded
 * SpreadsheetML package targeted by an Embedded Package part." The caches in
 * the chart XML are what actually render; the workbook is what "Edit Data"
 * opens. Ship only caches and Word shows the chart but cannot edit it.
 *
 * EVERY element sequence below is transcribed from the official transitional
 * schema (ECMA-376 Part 4, `dml-chart.xsd`), because CT_* types here are
 * xsd:sequence, not xsd:all — a child in the wrong position makes Word offer
 * to "repair" the file, exactly like the `tblLayout`/`tblBorders` trap already
 * documented in `docxLabels.ts`. The orders used:
 *   CT_ChartSpace  … chart, spPr?, txPr?, externalData?, …
 *   CT_Chart       title?, autoTitleDeleted?, …, plotArea, legend?, plotVisOnly?, dispBlanksAs?
 *   CT_PlotArea    layout?, <chart group>, <axes>, dTable?, spPr?
 *   CT_BarChart    barDir, grouping?, varyColors?, ser*, dLbls?, gapWidth?, overlap?, serLines*, axId, axId
 *   CT_BarSer      idx, order, tx?, spPr?, invertIfNegative?, …, cat?, val?, shape?
 *   EG_AxShared    axId, scaling, delete?, axPos, majorGridlines?, minorGridlines?,
 *                  title?, numFmt?, majorTickMark?, minorTickMark?, tickLblPos?,
 *                  spPr?, txPr?, crossAx, (crosses|crossesAt)?
 *   CT_Title       tx?, layout?, overlay?, spPr?, txPr?
 *   CT_Legend      legendPos?, legendEntry*, layout?, overlay?, spPr?, txPr?
 *   CT_Inline      extent, effectExtent?, docPr, cNvGraphicFramePr?, a:graphic
 *
 * Pure module — string and byte building only, so `check:report` can unzip and
 * inspect the output under Node.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import { xmlEscape } from './docx';

const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Verified relationship type / content type strings (ECMA-376 Part 1). */
export const CHART_REL_TYPE = `${R_NS}/chart`;
export const CHART_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
/** The Embedded Package part's relationship. Its content type is declared as
 *  spreadsheetml.sheet — the generic `…-officedocument.package` type is what
 *  the standard names, but Word writes an Override with the sheet type for
 *  `word/embeddings/*.xlsx`, and matching Word is what keeps Word happy. */
export const PACKAGE_REL_TYPE = `${R_NS}/package`;
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 1 cm in English Metric Units. Word measures drawings in EMU. */
export const EMU_PER_CM = 360000;

export type ChartSeries = {
  name: string;
  values: number[];
  /** Bar fill, `RRGGBB` (no leading #). */
  color: string;
};

export type ChartInput = {
  title: string;
  categories: string[];
  series: ChartSeries[];
  /** Show the legend. Pointless for a single series. */
  legend: boolean;
  /**
   * 'bar' = horizontal (categories down the left), 'col' = vertical.
   * Vertical is for ORDERED numeric bins, where left-to-right order is the
   * information — see the orientation note in `buildChartXml`.
   */
  direction?: 'bar' | 'col';
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
};

const AX_CAT = 111111111;
const AX_VAL = 222222222;

/** Latin/CJK pair matching `docx.ts`'s RFONTS: chart text is CJK as often as
 *  the body is, and a chart that falls back to a default face looks broken
 *  next to the document around it. */
const CHART_TX_PR =
  '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900">' +
  '<a:latin typeface="Times New Roman"/><a:ea typeface="標楷體"/>' +
  '</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';

/**
 * Axis title. `EG_AxShared` is a sequence, and `title` sits AFTER
 * `majorGridlines` and BEFORE `numFmt` — there was no existing example in this
 * file to copy, so the position is transcribed from `dml-chart.xsd`.
 */
function axisTitle(text: string | undefined): string {
  if (!text) return '';
  return (
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:pPr><a:defRPr sz="900"><a:latin typeface="Times New Roman"/>` +
    `<a:ea typeface="標楷體"/></a:defRPr></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="900"/><a:t>${xmlEscape(text)}</a:t></a:r>` +
    `</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  );
}

/** Spreadsheet column letter. Only ever A–C here (categories + 2 series). */
function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

/** `<c:pt>` list for a cache. Blank/NaN points are omitted rather than sent as
 *  0 — `dispBlanksAs="gap"` then leaves a gap instead of asserting a zero. */
function cachePoints(values: Array<string | number>): string {
  return values
    .map((v, i) =>
      typeof v === 'number' && !Number.isFinite(v)
        ? ''
        : `<c:pt idx="${i}"><c:v>${xmlEscape(String(v))}</c:v></c:pt>`,
    )
    .join('');
}

function seriesXml(s: ChartSeries, idx: number, categories: string[]): string {
  const n = categories.length;
  const col = colLetter(idx + 1);
  const catRef =
    `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>` +
    `<c:strCache><c:ptCount val="${n}"/>${cachePoints(categories)}</c:strCache>` +
    `</c:strRef></c:cat>`;
  const valRef =
    `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f>` +
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>` +
    `${cachePoints(s.values)}</c:numCache></c:numRef></c:val>`;
  return (
    `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>` +
    `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(s.name)}</c:v></c:pt>` +
    `</c:strCache></c:strRef></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>` +
    `<a:ln><a:noFill/></a:ln></c:spPr>` +
    `<c:invertIfNegative val="0"/>${catRef}${valRef}</c:ser>`
  );
}

/**
 * `barDir="bar"` is a HORIZONTAL bar chart — same reading direction as the
 * on-screen and HTML renderers, and the only one where long species names fit.
 *
 * `orientation="maxMin"` on the category axis is what puts the FIRST category
 * at the top; the default plots category 1 at the bottom, which silently
 * reverses every ranked chart in the report.
 *
 * Two series are drawn CLUSTERED, not overlaid as on screen. The overlay there
 * is a z-order trick that reads as "observed within estimated"; in Word, with a
 * legend and gridlines present, side-by-side bars are the conventional reading
 * and do not depend on draw order.
 */
export function buildChartXml(input: ChartInput): string {
  const direction = input.direction ?? 'bar';
  const vertical = direction === 'col';
  const title =
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:pPr><a:defRPr sz="1000" b="1"><a:latin typeface="Times New Roman"/>` +
    `<a:ea typeface="標楷體"/></a:defRPr></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="1000" b="1"/><a:t>${xmlEscape(input.title)}</a:t></a:r>` +
    `</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

  const bars =
    `<c:barChart><c:barDir val="${direction}"/><c:grouping val="clustered"/>` +
    `<c:varyColors val="0"/>` +
    input.series.map((s, i) => seriesXml(s, i, input.categories)).join('') +
    `<c:gapWidth val="${vertical ? 20 : 60}"/><c:overlap val="${vertical ? 0 : -10}"/>` +
    `<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:barChart>`;

  // `maxMin` on the category axis is what puts category 1 at the TOP of a
  // horizontal bar chart — without it every ranked chart is silently
  // reversed. A vertical chart must NOT inherit it: for ordered numeric bins
  // it reverses the histogram left-to-right and yields a plausible-looking
  // figure that is simply wrong.
  const catAx =
    `<c:catAx><c:axId val="${AX_CAT}"/>` +
    `<c:scaling><c:orientation val="${vertical ? 'minMax' : 'maxMin'}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${vertical ? 'b' : 'l'}"/>` +
    axisTitle(input.categoryAxisTitle) +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/><c:crossAx val="${AX_VAL}"/></c:catAx>`;

  const valAx =
    `<c:valAx><c:axId val="${AX_VAL}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${vertical ? 'l' : 'b'}"/><c:majorGridlines/>` +
    axisTitle(input.valueAxisTitle) +
    `<c:numFmt formatCode="General" sourceLinked="1"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/><c:crossAx val="${AX_CAT}"/></c:valAx>`;

  const legend = input.legend
    ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">` +
    `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<c:chart>${title}<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>${bars}${catAx}${valAx}</c:plotArea>` +
    `${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `${CHART_TX_PR}` +
    `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>` +
    `</c:chartSpace>`
  );
}

/** The chart part's only relationship: its embedded workbook, always rId1 —
 *  which is what `<c:externalData r:id="rId1">` above points at. */
export function buildChartRels(target: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${PACKAGE_REL_TYPE}" Target="${target}"/>` +
    `</Relationships>`
  );
}

/** Inline (in-line-with-text) graphic frame. `docPr/@id` must be unique across
 *  the document and `@name` is required, so both are caller-supplied. */
export function buildChartDrawing(opts: {
  relId: string;
  docPrId: number;
  name: string;
  cxEmu: number;
  cyEmu: number;
}): string {
  const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${WP_NS}">` +
    `<wp:extent cx="${Math.round(opts.cxEmu)}" cy="${Math.round(opts.cyEmu)}"/>` +
    `<wp:docPr id="${opts.docPrId}" name="${xmlEscape(opts.name)}"/>` +
    `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${C_NS}">` +
    `<c:chart xmlns:c="${C_NS}" xmlns:r="${R_NS}" r:id="${opts.relId}"/>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

// ── line charts ─────────────────────────────────────────────────────────────

export type LineSeries = {
  name: string;
  /** null leaves a gap (`dispBlanksAs="gap"`), which is how a log axis drops
   *  a non-positive point without inventing a value for it. */
  values: Array<number | null>;
  color: string;
  /** Per-point DISTANCES from the value, not bounds: `hi − y` and `y − lo`. */
  errPlus?: number[];
  errMinus?: number[];
  dashed?: boolean;
};

export type LineChartInput = {
  title: string;
  categories: string[];
  series: LineSeries[];
  legend: boolean;
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
  /** Log base for the VALUE axis. `ST_LogBase` restricts this to 2–1000. */
  logBase?: number;
};

/**
 * Custom error bars. `CT_ErrBars` = errDir, errBarType, errValType, noEndCap?,
 * plus?, minus?, val?, spPr? — and the whole element sits BEFORE `c:cat` and
 * `c:val` inside `CT_LineSer`, which is the opposite of the intuitive
 * "data first" order.
 */
function errBarsXml(plus: number[], minus: number[], col: string, n: number): string {
  const cache = (vals: number[], letter: string) =>
    `<c:numRef><c:f>Sheet1!$${letter}$2:$${letter}$${n + 1}</c:f>` +
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>` +
    `${cachePoints(vals)}</c:numCache></c:numRef>`;
  const plusCol = col;
  const minusCol = String.fromCharCode(col.charCodeAt(0) + 1);
  return (
    `<c:errBars><c:errDir val="y"/><c:errBarType val="both"/>` +
    `<c:errValType val="cust"/><c:noEndCap val="0"/>` +
    `<c:plus>${cache(plus, plusCol)}</c:plus>` +
    `<c:minus>${cache(minus, minusCol)}</c:minus>` +
    `</c:errBars>`
  );
}

function lineSeriesXml(
  s: LineSeries,
  idx: number,
  categories: string[],
  errCol: string | null,
): string {
  const n = categories.length;
  const col = colLetter(idx + 1);
  const dash = s.dashed ? '<a:prstDash val="dash"/>' : '';
  const catRef =
    `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>` +
    `<c:strCache><c:ptCount val="${n}"/>${cachePoints(categories)}</c:strCache>` +
    `</c:strRef></c:cat>`;
  const valRef =
    `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f>` +
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>` +
    `${cachePoints(s.values.map((v) => (v == null ? NaN : v)))}</c:numCache></c:numRef></c:val>`;
  const err =
    s.errPlus && s.errMinus && errCol
      ? errBarsXml(s.errPlus, s.errMinus, errCol, n)
      : '';
  return (
    `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>` +
    `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlEscape(s.name)}</c:v></c:pt>` +
    `</c:strCache></c:strRef></c:tx>` +
    `<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>` +
    `${dash}</a:ln></c:spPr>` +
    // Series-level marker is CT_Marker and belongs here; the chart-level
    // `c:marker` further down is a CT_Boolean with a different meaning.
    `<c:marker><c:symbol val="none"/></c:marker>` +
    `${err}${catRef}${valRef}<c:smooth val="0"/></c:ser>`
  );
}

/**
 * A line chart — species-accumulation curves and rank-abundance plots.
 *
 * Sequence traps, all transcribed from `dml-chart.xsd` and each capable of
 * producing a file Word offers to repair:
 *   - `CT_LineChart` = grouping, varyColors?, ser*, dLbls?, dropLines?,
 *     hiLowLines?, upDownBars?, marker?, smooth?, axId, axId
 *   - the chart-level `c:marker` is a CT_Boolean and sits AFTER every `c:ser`
 *     but BEFORE the `c:axId` pair — same tag name as the CT_Marker inside a
 *     series, different type, different place
 *   - `ST_Grouping` for lines has NO `clustered` member (unlike
 *     `ST_BarGrouping`), so the value is `standard`
 *   - `CT_Scaling` = logBase?, orientation?, max?, min? — `logBase` comes
 *     FIRST, so appending it to an existing `<c:scaling>` is wrong
 */
export function buildLineChartXml(input: LineChartInput): string {
  const title =
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:pPr><a:defRPr sz="1000" b="1"><a:latin typeface="Times New Roman"/>` +
    `<a:ea typeface="標楷體"/></a:defRPr></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="1000" b="1"/><a:t>${xmlEscape(input.title)}</a:t></a:r>` +
    `</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

  // Error-bar columns start after the value columns in the workbook.
  let nextErrCol = input.series.length + 1;
  const sers = input.series
    .map((s, i) => {
      const needsErr = !!(s.errPlus && s.errMinus);
      const col = needsErr ? colLetter(nextErrCol) : null;
      if (needsErr) nextErrCol += 2;
      return lineSeriesXml(s, i, input.categories, col);
    })
    .join('');

  const lines =
    `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>` +
    sers +
    `<c:marker val="1"/>` +
    `<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:lineChart>`;

  const catAx =
    `<c:catAx><c:axId val="${AX_CAT}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="b"/>` +
    axisTitle(input.categoryAxisTitle) +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/><c:crossAx val="${AX_VAL}"/></c:catAx>`;

  const scaling = input.logBase
    ? `<c:scaling><c:logBase val="${input.logBase}"/><c:orientation val="minMax"/></c:scaling>`
    : `<c:scaling><c:orientation val="minMax"/></c:scaling>`;
  const valAx =
    `<c:valAx><c:axId val="${AX_VAL}"/>${scaling}` +
    `<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>` +
    axisTitle(input.valueAxisTitle) +
    `<c:numFmt formatCode="General" sourceLinked="1"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/><c:crossAx val="${AX_CAT}"/></c:valAx>`;

  const legend = input.legend
    ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">` +
    `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>` +
    `<c:chart>${title}<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>${lines}${catAx}${valAx}</c:plotArea>` +
    `${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `${CHART_TX_PR}` +
    `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>` +
    `</c:chartSpace>`
  );
}

/** The workbook behind a line chart: categories, one column per series, then
 *  the plus/minus columns any error bars refer to. */
export function buildLineChartWorkbook(input: LineChartInput): Uint8Array {
  const cols: ChartSeries[] = input.series.map((s) => ({
    name: s.name,
    values: s.values.map((v) => (v == null ? NaN : v)),
    color: s.color,
  }));
  for (const s of input.series) {
    if (!s.errPlus || !s.errMinus) continue;
    cols.push({ name: `${s.name} +`, values: s.errPlus, color: s.color });
    cols.push({ name: `${s.name} -`, values: s.errMinus, color: s.color });
  }
  return buildChartWorkbook({
    title: input.title,
    categories: input.categories,
    series: cols,
    legend: false,
  });
}

// ── the embedded workbook ───────────────────────────────────────────────────

const SML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Strings go in as `inlineStr`, which keeps the package to five parts — a
 *  sharedStrings part would buy nothing for a table this size. */
function cellXml(ref: string, value: string | number): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}"/>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

/**
 * The workbook behind the chart: one sheet, categories in column A and one
 * column per series, matching the `Sheet1!$A$2:$A$n` formulas in the caches.
 * A nested OPC package inside the .docx zip — the app already ships nested
 * zips for Darwin Core archives, so `zipSync` inside `zipSync` is established
 * ground here.
 */
export function buildChartWorkbook(input: ChartInput): Uint8Array {
  const nCols = input.series.length + 1;
  const nRows = input.categories.length + 1;
  const rows: string[] = [];

  const header = ['', ...input.series.map((s) => s.name)];
  rows.push(
    `<row r="1">${header.map((h, c) => cellXml(`${colLetter(c)}1`, h)).join('')}</row>`,
  );
  input.categories.forEach((cat, i) => {
    const r = i + 2;
    const cells = [
      cellXml(`A${r}`, cat),
      ...input.series.map((s, c) => cellXml(`${colLetter(c + 1)}${r}`, s.values[i] ?? NaN)),
    ];
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  });

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="${SML_NS}" xmlns:r="${R_NS}">` +
    `<dimension ref="A1:${colLetter(nCols - 1)}${nRows}"/>` +
    `<sheetData>${rows.join('')}</sheetData></worksheet>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="${SML_NS}" xmlns:r="${R_NS}">` +
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;

  const zippable: Zippable = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(wbRels),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return zipSync(zippable, { level: 6 });
}
