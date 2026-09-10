/**
 * Report structure types — the contract between the model and its three
 * renderers (in-app view, HTML, DOCX).
 *
 * Types only, no values, no imports: the renderers depend on THIS file, never
 * on `reportModel.ts`. That is what keeps "one model, three renderers" a
 * mechanical property rather than an aspiration — a renderer cannot reach a
 * builder even by accident.
 *
 * `ReportChart` is a discriminated union on `kind`. It replaced a single flat
 * bar shape once the report needed histograms, curves and a vertical profile.
 * The union is deliberately small: four kinds over two data shapes
 * (categorical rows, xy series) plus the profile. `kind` is REQUIRED — an
 * optional discriminant with a default defeats narrowing, and the whole point
 * is that each renderer's switch fails to compile when a kind is unhandled.
 */

/** Minimal i18next-compatible translator. */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

export type KeyVal = { key: string; value: string };

export type ReportTable = {
  columns: string[];
  rows: string[][];
  /** Per-column alignment; numeric columns should be 'right'. */
  align?: Array<'left' | 'right'>;
  /**
   * How many TRAILING rows are totals rather than observations (the Sum row
   * the stand table closes with). Declared by the model so the in-app sort can
   * pin them to the bottom: sorting a total into the middle of the data would
   * be nonsense, and the view has no other way to recognise one.
   */
  totalRows?: number;
};

export type ChartBase = {
  title: string;
  unit?: string;
  /**
   * Caption under the chart. This is what lets a caveat — a mixed-unit
   * warning, a count of points dropped by a log axis — attach to the CHART
   * rather than only to the section, which is why a reader of the dominants
   * chart alone could previously not tell the units were incommensurable.
   */
  note?: string;
  /** Legend labels, one per series. */
  seriesLabels?: string[];
};

export type ReportChartRow = {
  label: string;
  value: number;
  /** Second series (e.g. a Chao estimate behind observed richness). */
  value2?: number;
  /** Short trailing annotation shown next to the bar. */
  note?: string;
};

/**
 * `bar` is horizontal (labels read naturally, long species names fit);
 * `column` is vertical and is for ORDERED numeric bins — a DBH size-class
 * histogram, where left-to-right order carries the meaning.
 */
export type CategoricalChart = ChartBase & {
  kind: 'bar' | 'column';
  rows: ReportChartRow[];
  /** Axis maximum. Defaults to the largest value present. */
  max?: number;
  valueAxisTitle?: string;
  categoryAxisTitle?: string;
};

export type AxisSpec = {
  title?: string;
  /** 'log10' is for rank-abundance plots, where the shape IS the information. */
  scale?: 'linear' | 'log10';
  min?: number;
  max?: number;
};

export type ChartSeriesXY = {
  label: string;
  points: Array<{ x: number; y: number }>;
  /** Confidence band; same length as `points` when present. */
  band?: Array<{ lo: number; hi: number }>;
  style?: 'line' | 'marker' | 'lineMarker';
};

/** Rank-abundance curves and species-accumulation curves. */
export type XYChart = ChartBase & {
  kind: 'line';
  series: ChartSeriesXY[];
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  /** Tick labels for an ordinal x (species names along a rank axis). */
  xTickLabels?: string[];
};

/**
 * Vertical vegetation profile: bands placed on a real metre axis, so a 15 m
 * canopy sits three times as high as a 5 m shrub layer instead of being one
 * evenly-spaced category above it.
 *
 * `bands` is ordered HIGHEST FIRST — the reading order of a profile.
 */
export type ProfileChart = ChartBase & {
  kind: 'profile';
  bands: Array<{ label: string; y0: number; y1: number; value: number; note?: string }>;
  /** Value-axis maximum; cover profiles pass 100. */
  max?: number;
  valueAxisTitle?: string;
  heightAxisTitle?: string;
  /**
   * Caption a renderer must add when it CANNOT draw the metric axis and falls
   * back to evenly-spaced bars (DrawingML can encode a band's position or its
   * cover, not both). Supplied by the model so the wording stays translatable
   * and no renderer needs a translator.
   */
  degradedNote?: string;
};

export type ReportChart = CategoricalChart | XYChart | ProfileChart;

export type ReportSection = {
  /** Stable identifier — used by anchors, tests and renderer switches. */
  id: string;
  heading: string;
  paras?: string[];
  meta?: KeyVal[];
  table?: ReportTable;
  chart?: ReportChart;
  /** Caveat printed in smaller type under the section. */
  note?: string;
};

export type Report = {
  kind: 'plot' | 'project' | 'session';
  title: string;
  subtitle?: string;
  /** ISO 8601, local time — the app never uses locale-formatted dates. */
  generatedAt: string;
  sections: ReportSection[];
};
