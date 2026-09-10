/**
 * Report → a single self-contained HTML file.
 *
 * Self-contained is the requirement that shapes everything here: no external
 * CSS, no fonts, no images, no scripts. The file is shared out of the app and
 * opened in whatever browser the recipient has, possibly offline, and printed
 * to PDF from there.
 *
 * Charts are CSS `<div>` bars, NOT inline SVG. The app bundles no font files,
 * so text inside an SVG cannot be relied on to render CJK; keeping every
 * label in ordinary HTML text hands font selection to the browser. Bars need
 * no axes, so SVG would have bought nothing anyway.
 *
 * Pure module — no DB / expo / `~/i18n` imports (`check:report` runs it under
 * Node). The document language is whatever `t` was fixed to by the caller.
 */
import { CHART_PRIMARY, CHART_SECONDARY, withHash } from './reportTheme';
import { seriesColor } from './reportTheme';
import type {
  CategoricalChart,
  ProfileChart,
  XYChart,
  Report,
  ReportChart,
  ReportSection,
  ReportTable,
} from './reportTypes';

/**
 * Escape, then turn `*italic*` into `<i>`. Cell text carries italic markers
 * for the epithets of a scientific name (see `scientificNameSegments.ts`);
 * escaping first means the markup this emits is the only markup that can
 * reach the page.
 */
function escItalic(s: string): string {
  return esc(s).replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

/** Escape for HTML text and double-quoted attributes. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
:root{--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:${withHash(CHART_PRIMARY)};--accent-soft:${withHash(CHART_SECONDARY)};--bg:#ffffff}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--ink);
  font:14px/1.6 system-ui,-apple-system,"Segoe UI","Noto Sans",\
"PingFang TC","Hiragino Sans","Noto Sans CJK TC","Microsoft JhengHei",sans-serif}
.wrap{max-width:900px;margin:0 auto}
h1{font-size:22px;margin:0 0 2px}
.sub{color:var(--muted);margin:0}
.gen{color:var(--muted);font-size:12px;margin:4px 0 0}
section{margin-top:28px;page-break-inside:avoid;break-inside:avoid}
h2{font-size:16px;color:var(--accent);border-bottom:1px solid var(--line);
  padding-bottom:4px;margin:0 0 8px}
p{margin:6px 0}
.note{color:var(--muted);font-size:12px;margin-top:8px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:8px 0}
dt{color:var(--muted);font-size:13px}
dd{margin:0;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.chart{margin:10px 0}
.chart .ctitle{font-size:13px;font-weight:600;margin-bottom:6px}
.chart .unit{font-weight:400;color:var(--muted)}
.legend{display:flex;gap:12px;font-size:12px;color:var(--muted);margin-bottom:6px}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px}
.row{margin-bottom:8px}
.rowhead{display:flex;align-items:baseline;gap:8px;font-size:12px}
.rowhead .lbl{flex:1;min-width:0;overflow-wrap:anywhere}
.rowhead .val{font-variant-numeric:tabular-nums;font-weight:600}
.rowhead .rnote{color:var(--muted)}
.track{position:relative;height:9px;background:var(--line);border-radius:3px;overflow:hidden}
.track .b2{position:absolute;inset:0 auto 0 0;background:var(--accent-soft)}
.track .b1{position:absolute;inset:0 auto 0 0;background:var(--accent)}
.cols{display:flex;align-items:flex-end;gap:6px;min-height:150px;overflow-x:auto;padding-top:4px}
.col{flex:1 1 0;min-width:34px;display:flex;flex-direction:column;align-items:center;gap:2px}
.colbar{width:100%;height:120px;display:flex;align-items:flex-end;background:linear-gradient(var(--line),var(--line)) bottom/100% 1px no-repeat}
.colbar i{display:block;width:100%;background:var(--accent);border-radius:2px 2px 0 0}
.colval{font-size:11px;font-variant-numeric:tabular-nums}
.collbl{font-size:10px;color:var(--muted);text-align:center;overflow-wrap:anywhere}
.axt{font-size:11px;color:var(--muted);text-align:center;margin-top:2px}
.xy{display:flex;align-items:stretch;gap:4px}
.ylab{writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;color:var(--muted);
  align-self:center}
.plot{position:relative;flex:1;height:240px;border-left:1px solid var(--line);
  border-bottom:1px solid var(--line)}
.plot svg{width:100%;height:100%;display:block}
.ymax,.ymin{position:absolute;left:-4px;transform:translateX(-100%);font-size:10px;
  color:var(--muted);font-variant-numeric:tabular-nums}
.ymax{top:-4px}.ymin{bottom:-6px}
.xaxis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:2px}
.profile{position:relative;flex:1;height:220px;border-left:1px solid var(--line);
  border-bottom:1px solid var(--line)}
.pband{position:absolute;left:0;right:0;display:flex;align-items:center;gap:6px}
.pfill{height:70%;background:var(--accent);border-radius:0 2px 2px 0;min-width:1px}
.plabel{font-size:11px;white-space:nowrap}
@media print{
  @page{margin:14mm}
  body{padding:0}
  h2{color:#000}
  .track{border:1px solid #999}
  .track .b1{background:#000}
  .colbar i{background:#000}
  .track .b2{background:#bbb}
}
`.trim();

/** Dispatch on kind. A kind with no renderer yet returns '' — and
 *  `check:report` asserts no fixture report ever contains one. */
function chartHtml(chart: ReportChart): string {
  switch (chart.kind) {
    case 'bar':
      return categoricalHtml(chart);
    case 'column':
      return columnHtml(chart);
    case 'line':
      return lineHtml(chart);
    case 'profile':
      return profileHtml(chart);
    default:
      return '';
  }
}

function categoricalHtml(chart: CategoricalChart): string {
  const max =
    chart.max ?? Math.max(...chart.rows.map((r) => Math.max(r.value, r.value2 ?? 0)), 1);
  const pct = (v: number): string => {
    if (!Number.isFinite(v) || max <= 0) return '0';
    return Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2);
  };
  const fmt = (v: number): string =>
    !Number.isFinite(v) ? '–' : Number.isInteger(v) ? String(v) : v.toFixed(1);

  const legendSwatch = [`var(--accent)`, `var(--accent-soft)`];
  const legend = chart.seriesLabels?.length
    ? `<div class="legend">` +
      chart.seriesLabels
        .map(
          (label, i) =>
            `<span><i style="background:${legendSwatch[i] ?? 'var(--accent)'}"></i>${esc(label)}</span>`,
        )
        .join('') +
      `</div>`
    : '';

  const rows = chart.rows
    .map((r) => {
      // The second series is the longer, paler bar behind the first, so the
      // uncovered remainder reads as "still missing".
      const back = r.value2 != null ? Math.max(r.value, r.value2) : null;
      return (
        `<div class="row">` +
        `<div class="rowhead"><span class="lbl">${escItalic(r.label)}</span>` +
        `<span class="val">${fmt(r.value)}${r.value2 != null ? ` / ${fmt(r.value2)}` : ''}</span>` +
        (r.note ? `<span class="rnote">${esc(r.note)}</span>` : '') +
        `</div>` +
        `<div class="track">` +
        (back != null ? `<div class="b2" style="width:${pct(back)}%"></div>` : '') +
        `<div class="b1" style="width:${pct(r.value)}%"></div>` +
        `</div></div>`
      );
    })
    .join('');

  return (
    `<div class="chart"><div class="ctitle">${esc(chart.title)}` +
    (chart.unit ? ` <span class="unit">(${esc(chart.unit)})</span>` : '') +
    `</div>${legend}${rows}` +
    (chart.note ? `<p class="note">${esc(chart.note)}</p>` : '') +
    `</div>`
  );
}

/**
 * Vertical columns for ordered numeric bins. CSS again rather than SVG: the
 * class labels are CJK as often as not, and the app ships no fonts.
 */
function columnHtml(chart: CategoricalChart): string {
  const max = chart.max ?? Math.max(...chart.rows.map((r) => r.value), 1);
  const h = (v: number): string =>
    !Number.isFinite(v) || max <= 0 ? '0' : Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2);
  const cols = chart.rows
    .map(
      (r) =>
        `<div class="col"><div class="colbar"><i style="height:${h(r.value)}%"></i></div>` +
        `<div class="colval">${Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</div>` +
        `<div class="collbl">${escItalic(r.label)}</div></div>`,
    )
    .join('');
  return (
    `<div class="chart"><div class="ctitle">${esc(chart.title)}` +
    (chart.unit ? ` <span class="unit">(${esc(chart.unit)})</span>` : '') +
    `</div><div class="cols">${cols}</div>` +
    (chart.categoryAxisTitle ? `<div class="axt">${esc(chart.categoryAxisTitle)}</div>` : '') +
    (chart.note ? `<p class="note">${esc(chart.note)}</p>` : '') +
    `</div>`
  );
}

/**
 * Line charts are the one place this file emits SVG, and it emits GEOMETRY
 * ONLY — every label stays HTML text positioned around the plot. The app ships
 * no font files, so a `<text>` node inside SVG renders CJK as tofu; that is
 * why the bar charts are CSS divs, and the rule does not relax just because a
 * polyline needs real coordinates.
 */
function lineHtml(chart: XYChart): string {
  const W = 640;
  const H = 260;
  const PAD = { l: 8, r: 8, t: 8, b: 8 };
  const pts = chart.series.flatMap((s) => s.points);
  if (pts.length === 0) return '';
  const xs = pts.map((p) => p.x);
  const bandLo = chart.series.flatMap((s) => s.band?.map((b) => b.lo) ?? []);
  const bandHi = chart.series.flatMap((s) => s.band?.map((b) => b.hi) ?? []);
  const ys = [...pts.map((p) => p.y), ...bandLo, ...bandHi].filter((v) => Number.isFinite(v));
  const xMin = chart.xAxis.min ?? Math.min(...xs);
  const xMax = chart.xAxis.max ?? Math.max(...xs);
  const log = chart.yAxis.scale === 'log10';
  const tf = (v: number) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  const yMin = tf(chart.yAxis.min ?? (log ? Math.min(...ys.filter((v) => v > 0)) : 0));
  const yMax = tf(chart.yAxis.max ?? Math.max(...ys));
  const sx = (x: number) =>
    PAD.l + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
  const sy = (y: number) =>
    H - PAD.b - ((tf(y) - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

  const body = chart.series
    .map((s, i) => {
      const col = `#${seriesColor(i)}`;
      const valid = s.points.filter((p) => Number.isFinite(p.y) && (!log || p.y > 0));
      const line = valid.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
      let band = '';
      if (s.band && s.band.length === s.points.length) {
        const up = s.points
          .map((p, j) => `${sx(p.x).toFixed(1)},${sy(s.band![j].hi).toFixed(1)}`)
          .join(' ');
        const down = [...s.points]
          .map((p, j) => ({ p, j }))
          .reverse()
          .map(({ p, j }) => `${sx(p.x).toFixed(1)},${sy(s.band![j].lo).toFixed(1)}`)
          .join(' ');
        band = `<polygon points="${up} ${down}" fill="${col}" fill-opacity="0.15"/>`;
      }
      return `${band}<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2"/>`;
    })
    .join('');

  const tick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const yTop = chart.yAxis.max ?? Math.max(...ys);
  const legend =
    chart.series.length > 1
      ? `<div class="legend">` +
        chart.series
          .map((s, i) => `<span><i style="background:#${seriesColor(i)}"></i>${esc(s.label)}</span>`)
          .join('') +
        `</div>`
      : '';
  return (
    `<div class="chart"><div class="ctitle">${esc(chart.title)}` +
    (chart.unit ? ` <span class="unit">(${esc(chart.unit)})</span>` : '') +
    `</div>${legend}` +
    `<div class="xy">` +
    `<div class="ylab">${chart.yAxis.title ? esc(chart.yAxis.title) : ''}</div>` +
    `<div class="plot">` +
    `<div class="ymax">${tick(yTop)}</div><div class="ymin">${tick(chart.yAxis.min ?? 0)}</div>` +
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${body}</svg>` +
    `</div></div>` +
    `<div class="xaxis"><span>${tick(xMin)}</span>` +
    (chart.xAxis.title ? `<span>${esc(chart.xAxis.title)}</span>` : '<span></span>') +
    `<span>${tick(xMax)}</span></div>` +
    (chart.note ? `<p class="note">${esc(chart.note)}</p>` : '') +
    `</div>`
  );
}

/**
 * Vertical profile: each stratum drawn at its real height on a metre axis, so
 * the spacing between bands carries information. CSS boxes, not SVG — the
 * labels are CJK and the app ships no fonts.
 */
function profileHtml(chart: ProfileChart): string {
  if (chart.bands.length === 0) return '';
  const top = Math.max(...chart.bands.map((b) => b.y1), 0.1);
  const max = chart.max ?? 100;
  const pctOf = (v: number) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2);
  const bands = chart.bands
    .map((b) => {
      const bottom = (b.y0 / top) * 100;
      const height = Math.max(0.5, ((b.y1 - b.y0) / top) * 100);
      return (
        `<div class="pband" style="bottom:${bottom.toFixed(2)}%;height:${height.toFixed(2)}%">` +
        `<div class="pfill" style="width:${pctOf(b.value)}%"></div>` +
        `<div class="plabel">${escItalic(b.label)}` +
        (b.note ? ` <span class="unit">${esc(b.note)}</span>` : '') +
        `</div></div>`
      );
    })
    .join('');
  return (
    `<div class="chart"><div class="ctitle">${esc(chart.title)}` +
    (chart.unit ? ` <span class="unit">(${esc(chart.unit)})</span>` : '') +
    `</div>` +
    `<div class="xy"><div class="ylab">${
      chart.heightAxisTitle ? esc(chart.heightAxisTitle) : ''
    }</div>` +
    `<div class="profile"><div class="ymax">${fmtHeight(top)}</div>` +
    `<div class="ymin">0</div>${bands}</div></div>` +
    (chart.valueAxisTitle
      ? `<div class="axt">${esc(chart.valueAxisTitle)}</div>`
      : '') +
    (chart.note ? `<p class="note">${esc(chart.note)}</p>` : '') +
    `</div>`
  );
}

const fmtHeight = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function tableHtml(table: ReportTable): string {
  const cls = (i: number) => (table.align?.[i] === 'right' ? ' class="num"' : '');
  const head = table.columns.map((c, i) => `<th${cls(i)}>${esc(c)}</th>`).join('');
  const body = table.rows
    .map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${escItalic(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function sectionHtml(s: ReportSection): string {
  const parts: string[] = [`<h2>${esc(s.heading)}</h2>`];
  if (s.paras) parts.push(...s.paras.map((p) => `<p>${esc(p)}</p>`));
  if (s.meta && s.meta.length > 0) {
    parts.push(
      `<dl>${s.meta
        .map((m) => `<dt>${esc(m.key)}</dt><dd>${esc(m.value)}</dd>`)
        .join('')}</dl>`,
    );
  }
  if (s.chart) parts.push(chartHtml(s.chart));
  if (s.table) parts.push(tableHtml(s.table));
  if (s.note) parts.push(`<p class="note">${esc(s.note)}</p>`);
  return `<section id="${esc(s.id)}">${parts.join('')}</section>`;
}

/**
 * @param lang BCP-47 tag for `<html lang>` — affects hyphenation and the
 *             browser's font choice for CJK, so pass the language the report
 *             was actually generated in.
 */
export function buildReportHtml(report: Report, lang = 'zh-TW'): string {
  return (
    `<!doctype html>\n<html lang="${esc(lang)}">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<title>${esc(report.title)}</title>\n` +
    `<style>${CSS}</style>\n</head>\n<body>\n<div class="wrap">\n` +
    `<h1>${esc(report.title)}</h1>` +
    (report.subtitle ? `<p class="sub">${esc(report.subtitle)}</p>` : '') +
    `<p class="gen">${esc(report.generatedAt)}</p>\n` +
    report.sections.map(sectionHtml).join('\n') +
    `\n</div>\n</body>\n</html>\n`
  );
}
