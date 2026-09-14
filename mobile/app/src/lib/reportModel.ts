/**
 * The report model: one structure, rendered three ways (in-app view, HTML,
 * DOCX). Every number a reader sees comes from here, so the screen and the
 * two documents can never disagree.
 *
 * Pure module — no DB / expo / `~/i18n` imports (`scripts/check-report.mjs`
 * runs it under Node). Localisation is INJECTED as `t`, which is what makes
 * "export the report in a language other than the UI's" a one-line change at
 * the call site (`i18n.getFixedT(lang)`).
 *
 * Structure types live in `reportTypes.ts`, value formatting in
 * `reportFormat.ts` and the shared section builders in `reportSections.ts`;
 * this file is the three `build*Report` assemblers and their input types.
 */
import {
  betaSimilarity,
  chao1,
  chao2,
  computeDiversity,
  relativeFrequency,
  speciesKey,
  type Chao1Result,
  type Chao2Result,
} from './diversity';
import {
  conservationTally,
  groundCoverBudget,
  layerProfile,
  pointCountEffort,
  taxonComposition,
  transectEffort,
  type LayerInput,
  type LayerProfileRow,
  type ReportRecord,
} from './reportStats';
import { aggregateCell } from './vegMatrix';
import { groupRecords, taxonGroupLabelKey, taxonGroupOf } from './taxonGroup';
import {
  dbhClassSection,
  iviSection,
  standSection,
} from './reportStructureSections';
import type { TrackSegment } from './track';
import {
  COVER_LABEL_KEY,
  abundanceText,
  alienLabel,
  scientificName,
  durationText,
  int,
  isoDateTime,
  num,
  pct,
  speciesLabel,
} from './reportFormat';
import {
  compositionSection,
  conservationSection,
  conservationSpeciesSection,
  dataQualitySection,
  diversitySection,
  dominantsSection,
  effortSection,
  methodsSection,
  perTaxonGroup,
  rankAbundanceSection,
  rarefactionSection,
  unitDiversitySection,
} from './reportSections';
import type {
  KeyVal,
  Report,
  ReportSection,
  ReportTable,
  Translate,
} from './reportTypes';

/**
 * Re-exported so every existing import of these names keeps working. Type-only,
 * so it is erased at compile time and creates no cycle.
 */
export type {
  KeyVal,
  Report,
  ReportChart,
  ReportChartRow,
  ReportSection,
  ReportTable,
  Translate,
} from './reportTypes';


// ── inputs ──────────────────────────────────────────────────────────────────

export type PlotReportPlot = {
  id: number;
  plotid: string;
  plot_type: string;
  status: string;
  start_ts: number | null;
  stop_ts: number | null;
  decimal_latitude: number | null;
  decimal_longitude: number | null;
  coord_uncertainty_m: number | null;
  sample_size_value: number | null;
  sample_size_unit: string | null;
  sampling_protocol: string | null;
  point_radius_m: number | null;
  recorded_by: string | null;
  locality: string | null;
  field_note: string | null;
  elevation_m: number | null;
  slope_deg: number | null;
  aspect_deg: number | null;
  terrain_position: string | null;
  total_cover_pct: number | null;
  rock_cover_pct: number | null;
  gravel_cover_pct: number | null;
  bareland_cover_pct: number | null;
  litter_cover_pct: number | null;
  vascular_cover_pct: number | null;
  bryophyte_cover_pct: number | null;
  lichen_cover_pct: number | null;
};

export type PlotReportInput = {
  plot: PlotReportPlot;
  projectName: string;
  layers: LayerInput[];
  subplots: Array<{ id: number; label: string; width_m: number | null; length_m: number | null }>;
  species: ReportRecord[];
  trackSegments: TrackSegment[];
};

/**
 * The vertical structure figure.
 *
 * When the strata carry heights this is a true PROFILE: each band occupies its
 * real metre span, so a 15 m canopy sits three times as high as a 5 m shrub
 * layer instead of one evenly-spaced category above it. Bands run from the top
 * of the layer below to this layer's own height, and are ordered highest-first
 * — the reading order of a profile.
 *
 * A layer with no height cannot be placed on a metre axis, so it is left out
 * of the bands (it stays in the table) and the caption counts the omissions.
 * When NO layer has a height there is no axis to draw on, and the figure falls
 * back to the plain cover bars. The degradation is decided HERE, in the model,
 * so all three renderers degrade together.
 */
function layerChart(profile: LayerProfileRow[], t: Translate): ReportSection['chart'] {
  const label = (l: LayerProfileRow) => t(`layer.${l.layer}`, { defaultValue: l.layer });
  const withHeight = profile.filter((l) => l.heightCm != null);

  if (withHeight.length > 0) {
    const bands: Array<{ label: string; y0: number; y1: number; value: number; note?: string }> = [];
    let floor = 0;
    for (const l of profile) {
      if (l.heightCm == null) continue;
      const top = l.heightCm / 100;
      bands.push({
        label: label(l),
        y0: floor,
        y1: Math.max(top, floor),
        value: l.coverPct ?? 0,
        note: `${num(top, 1)} m`,
      });
      floor = Math.max(top, floor);
    }
    const missing = profile.length - withHeight.length;
    return {
      kind: 'profile',
      title: t('report.chartProfile'),
      unit: '%',
      max: 100,
      // Highest band first.
      bands: bands.reverse(),
      valueAxisTitle: t('plotValue.coverPct'),
      heightAxisTitle: t('report.axisHeightM'),
      note: missing > 0 ? t('report.profileMissingHeight', { count: missing }) : undefined,
      degradedNote: t('report.profileDegraded'),
    };
  }

  return {
    kind: 'bar',
    title: t('report.chartLayers'),
    unit: '%',
    max: 100,
    // Reversed for the CHART only: `layerProfile` returns E1→E6 ascending,
    // which is right for the table but upside down for a structure figure,
    // where every renderer draws row 0 at the top.
    rows: [...profile].reverse().map((l) => ({
      label: label(l),
      value: l.coverPct ?? 0,
    })),
    note: t('report.profileNoHeights'),
  };
}

// ── plot report ─────────────────────────────────────────────────────────────

export function buildPlotReport(input: PlotReportInput, t: Translate): Report {
  const { plot, layers, subplots, species, trackSegments } = input;
  const subplotIds = subplots.map((s) => s.id);
  const sections: ReportSection[] = [];

  // 1. Basics
  const meta: KeyVal[] = [
    { key: t('report.metaProject'), value: input.projectName || '–' },
    { key: t('report.metaPlotType'), value: t(`record.kindPlot`) + ` / ${plot.plot_type}` },
    { key: t('report.metaStart'), value: isoDateTime(plot.start_ts) },
    { key: t('report.metaEnd'), value: isoDateTime(plot.stop_ts) },
    { key: t('report.metaDuration'), value: durationText(plot.start_ts, plot.stop_ts, t) },
    { key: t('plot.recordedBy'), value: plot.recorded_by || '–' },
    { key: t('plot.locality'), value: plot.locality || '–' },
  ];
  if (plot.decimal_latitude != null && plot.decimal_longitude != null) {
    meta.push({
      key: t('report.metaCoord'),
      value: `${plot.decimal_latitude.toFixed(6)}, ${plot.decimal_longitude.toFixed(6)}`,
    });
    meta.push({
      key: t('report.metaAccuracy'),
      // A hand-placed point stores no accuracy; say so rather than printing a
      // blank that reads like missing data.
      value:
        plot.coord_uncertainty_m != null
          ? `±${plot.coord_uncertainty_m.toFixed(1)} m`
          : t('plot.manualCoord'),
    });
  }
  if (plot.sample_size_value != null) {
    meta.push({
      key: t('report.metaSampleSize'),
      value: `${plot.sample_size_value} ${plot.sample_size_unit ?? ''}`.trim(),
    });
  }
  if (plot.sampling_protocol) {
    meta.push({ key: t('report.metaProtocol'), value: plot.sampling_protocol });
  }
  sections.push({
    id: 'basics',
    heading: t('report.secBasics'),
    meta,
    paras: plot.field_note ? [plot.field_note] : undefined,
  });

  // 2. Environment
  const budget = groundCoverBudget(plot);
  const envRows: string[][] = [];
  if (plot.elevation_m != null) envRows.push([t('plot.elevation'), `${int(plot.elevation_m)} m`]);
  if (plot.slope_deg != null) envRows.push([t('plot.slope'), `${num(plot.slope_deg, 1)}°`]);
  if (plot.aspect_deg != null) envRows.push([t('plot.aspect'), `${num(plot.aspect_deg, 0)}°`]);
  if (plot.terrain_position) envRows.push([t('plot.terrainPosition'), plot.terrain_position]);
  for (const r of budget.rows) envRows.push([t(COVER_LABEL_KEY[r.key] ?? r.key), `${num(r.pct, 1)}%`]);
  if (budget.totalCoverPct != null) {
    envRows.push([t('plot.totalCover'), `${num(budget.totalCoverPct, 1)}%`]);
  }
  if (envRows.length > 0) {
    sections.push({
      id: 'environment',
      heading: t('report.secEnvironment'),
      table: {
        columns: [t('report.colFactor'), t('report.colValue')],
        rows: envRows,
        align: ['left', 'right'],
      },
      note: budget.surfaceOver100
        ? t('report.coverOver100', { total: num(budget.surfaceTotal, 1) })
        : undefined,
    });
  }

  // 3. Layer profile (stratified plots only)
  const profile = layerProfile(layers, species);
  if (profile.length > 0) {
    sections.push({
      id: 'layers',
      heading: t('report.secLayers'),
      chart: layerChart(profile, t),
      table: {
        columns: [
          t('report.colLayer'),
          t('plotValue.coverPct'),
          t('report.colHeight'),
          t('report.colMethod'),
          t('plotStats.richness'),
        ],
        rows: profile.map((l) => [
          t(`layer.${l.layer}`, { defaultValue: l.layer }),
          l.coverPct != null ? `${num(l.coverPct, 1)}%` : '–',
          l.heightCm != null
            ? l.heightUnit === 'm'
              ? `${num(l.heightCm / 100, 1)} m`
              : `${int(l.heightCm)} cm`
            : '–',
          l.method || '–',
          int(l.richness),
        ]),
        align: ['left', 'right', 'right', 'left', 'right'],
      },
    });
  }

  // 4. Species list
  if (species.length > 0) {
    const bySpecies = new Map<string, ReportRecord[]>();
    for (const r of species) {
      const k = speciesKey(r);
      const arr = bySpecies.get(k);
      if (arr) arr.push(r);
      else bySpecies.set(k, [r]);
    }
    const rows = [...bySpecies.values()]
      .map((recs) => {
        const r = recs[0];
        const layersOf = [...new Set(recs.map((x) => x.layer).filter(Boolean))].join(', ');
        const qty = recs
          .map((x) => abundanceText(x.organism_quantity, x.organism_quantity_type, t))
          .filter((q): q is string => !!q)
          .join(', ');
        const marks: string[] = [];
        if (r.is_endemic === 'true') marks.push(t('species.endemicShort'));
        if (r.redlist) marks.push(r.redlist);
        if (r.cites) marks.push(`CITES ${r.cites}`);
        return [
          scientificName(r),
          r.common_name_c || '',
          r.family_c ? `${r.family_c} ${r.family ?? ''}`.trim() : (r.family ?? ''),
          layersOf,
          qty,
          marks.join(' '),
        ];
      })
      .sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
    sections.push({
      id: 'species',
      heading: t('report.secSpecies'),
      paras: [t('report.speciesSummary', { count: rows.length })],
      table: {
        columns: [
          t('report.colScientific'),
          t('report.colCommon'),
          t('rank.family'),
          t('report.colLayer'),
          t('report.colAbundance'),
          t('report.colMarks'),
        ],
        rows,
      },
    });
  }

  // 5–8. Diversity, dominants, effort, composition
  // Everything from here to the effort estimate is an INDEX, and an index is
  // only comparable within a taxon group — so a mixed plot gets one set per
  // group rather than one meaningless pooled set.
  sections.push(...perTaxonGroup(species, t, (recs) => diversitySection(recs, t)));
  sections.push(...perTaxonGroup(species, t, (recs) => dominantsSection(recs, subplotIds, t)));
  sections.push(...perTaxonGroup(species, t, (recs) => rankAbundanceSection(recs, t)));
  // Stand structure sits between the dominance summary and the effort
  // estimate: it is the same question (what is here, and how much) measured
  // on an area basis rather than a relative one.
  const areaInput = {
    plotType: plot.plot_type,
    subplots: input.subplots,
    pointRadiusM: plot.point_radius_m,
    sampleSizeValue: plot.sample_size_value,
    sampleSizeUnit: plot.sample_size_unit,
  };
  sections.push(...perTaxonGroup(species, t, (recs) => standSection(recs, areaInput, t)));
  sections.push(...perTaxonGroup(species, t, (recs) => dbhClassSection(recs, t)));
  sections.push(
    ...perTaxonGroup(species, t, (recs) =>
      iviSection(recs, relativeFrequency(recs, subplotIds), areaInput, t),
    ),
  );
  sections.push(
    ...perTaxonGroup(species, t, (recs) =>
      effortSection(chao1(recs), chao2(recs, subplotIds), t),
    ),
  );
  sections.push(...perTaxonGroup(species, t, (recs) => rarefactionSection(recs, subplotIds, t)));
  const comp = compositionSection(species, t);
  if (comp) sections.push(comp);
  const cons = conservationSection(species, t);
  if (cons) sections.push(cons);
  const consSp = conservationSpeciesSection(species, t);
  if (consSp) sections.push(consSp);

  // 9. Subplot summary
  if (subplots.length > 0) {
    const rows = subplots.map((sp) => {
      const recs = species.filter((r) => r.subplot_id === sp.id);
      const d = computeDiversity(recs);
      const area = sp.width_m != null && sp.length_m != null ? sp.width_m * sp.length_m : null;
      return [
        sp.label,
        area != null ? `${num(area, 1)} m²` : '–',
        int(d.richness),
        num(d.shannonH),
        num(d.simpson1mD),
      ];
    });
    sections.push({
      id: 'subplots',
      heading: t('report.secSubplots'),
      table: {
        columns: [
          t('report.colSubplot'),
          t('report.colArea'),
          t('plotStats.richness'),
          t('plotStats.shannon'),
          t('plotStats.simpson'),
        ],
        rows,
        align: ['left', 'right', 'right', 'right', 'right'],
      },
    });
  }

  // 10. Method-specific effort
  if (plot.plot_type === 'transect') {
    const e = transectEffort(trackSegments, species);
    sections.push({
      id: 'transect',
      heading: t('report.secTransect'),
      table: {
        columns: [t('report.colIndex'), t('report.colValue')],
        rows: [
          [t('report.trackLength'), `${num(e.lengthM, 0)} m`],
          [t('plotStats.richness'), int(e.richness)],
          [t('report.speciesPerKm'), e.speciesPerKm != null ? num(e.speciesPerKm, 1) : '–'],
        ],
        align: ['left', 'right'],
      },
      note: e.speciesPerKm == null ? t('report.trackTooShort') : undefined,
    });
  } else if (plot.plot_type === 'point_count') {
    const e = pointCountEffort(plot.point_radius_m, species);
    const rows: string[][] = [
      [t('plot.radius'), e.radiusM != null ? `${num(e.radiusM, 1)} m` : '–'],
      [t('report.plotArea'), e.areaM2 != null ? `${num(e.areaM2, 1)} m²` : '–'],
      [t('plotStats.richness'), int(e.richness)],
    ];
    if (e.individuals != null) rows.push([t('report.individuals'), int(e.individuals)]);
    if (e.densityPerHa != null) rows.push([t('report.densityPerHa'), num(e.densityPerHa, 1)]);
    for (const d of e.detection) {
      rows.push([t(`attr.detection.${d.code}`, { defaultValue: d.code }), int(d.count)]);
    }
    sections.push({
      id: 'pointCount',
      heading: t('report.secPointCount'),
      table: { columns: [t('report.colIndex'), t('report.colValue')], rows, align: ['left', 'right'] },
    });
  }

  // The reader's caveat page: what the indices above rest on. Last before
  // the methods, because it is what qualifies everything preceding it.
  const dq = dataQualitySection(species, { hasSubplots: subplotIds.length > 0, hasLayers: layers.length > 0 }, t);
  if (dq) sections.push(dq);
  sections.push(methodsSection(t, sections.map((x) => x.id)));

  return {
    kind: 'plot',
    title: t('report.plotTitle', { plotid: plot.plotid }),
    subtitle: input.projectName || undefined,
    generatedAt: isoDateTime(Date.now()),
    sections,
  };
}

// ── project report ──────────────────────────────────────────────────────────

export type ProjectReportInput = {
  project: {
    id: number;
    name: string;
    abstract: string | null;
    location_description: string | null;
    notes: string | null;
  };
  /** One entry per plot; `subplotIds` drives that plot's own Chao2. */
  plots: Array<{
    plot: PlotReportPlot;
    species: ReportRecord[];
    subplotIds: number[];
  }>;
  counts: { session: number; plot: number; collection: number };
  siteCount: number;
};

/** Pairwise similarity is only tabulated for a manageable number of plots —
 *  a 30×30 matrix is unreadable on paper and useless on a phone. */
const MAX_MATRIX_PLOTS = 10;

export function buildProjectReport(input: ProjectReportInput, t: Translate): Report {
  const { project, plots, counts } = input;
  const sections: ReportSection[] = [];
  // Analysis stays plots-only, the same scope rule the project export follows.
  const allSpecies = plots.flatMap((p) => p.species);

  // 1. Project metadata
  sections.push({
    id: 'basics',
    heading: t('report.secBasics'),
    meta: [
      { key: t('report.metaProject'), value: project.name },
      { key: t('report.metaLocation'), value: project.location_description || '–' },
    ],
    paras: [project.abstract, project.notes].filter((x): x is string => !!x),
  });

  // 2. Survey overview
  const starts = plots.map((p) => p.plot.start_ts).filter((x): x is number => !!x);
  const typeCount = new Map<string, number>();
  for (const p of plots) typeCount.set(p.plot.plot_type, (typeCount.get(p.plot.plot_type) ?? 0) + 1);
  const overviewRows: string[][] = [
    [t('record.kindPlot'), int(counts.plot)],
    [t('record.kindSession'), int(counts.session)],
    [t('record.kindCollection'), int(counts.collection)],
    [t('nav.sites'), int(input.siteCount)],
  ];
  for (const [type, n] of typeCount) overviewRows.push([`  ${type}`, int(n)]);
  if (starts.length > 0) {
    overviewRows.push([
      t('report.metaPeriod'),
      `${isoDateTime(Math.min(...starts)).slice(0, 10)} – ${isoDateTime(Math.max(...starts)).slice(0, 10)}`,
    ]);
  }
  sections.push({
    id: 'overview',
    heading: t('report.secOverview'),
    table: {
      columns: [t('report.colItem'), t('report.colValue')],
      rows: overviewRows,
      align: ['left', 'right'],
    },
  });

  if (plots.length > 0) {
    // 3. Per-plot summary
    const perPlot = plots.map((p) => {
      const d = computeDiversity(p.species);
      const c1 = chao1(p.species);
      const c2 = chao2(p.species, p.subplotIds);
      const completeness = c1.applicable
        ? c1.completeness
        : c2.applicable
          ? c2.completeness
          : null;
      const topKey = d.dominants[0]?.key;
      const topRec = topKey ? p.species.find((r) => speciesKey(r) === topKey) : undefined;
      return { p, d, c1, c2, completeness, top: topRec ? speciesLabel(topRec) : '–' };
    });
    sections.push({
      id: 'plots',
      heading: t('report.secPlots'),
      table: {
        columns: [
          t('report.colPlot'),
          t('report.metaStart'),
          t('plotStats.richness'),
          t('plotStats.shannon'),
          t('plotStats.evenness'),
          t('report.colDominant'),
          t('report.colBasis'),
        ],
        rows: perPlot.map((x) => [
          x.p.plot.plotid,
          isoDateTime(x.p.plot.start_ts).slice(0, 10),
          int(x.d.richness),
          num(x.d.shannonH),
          num(x.d.pielouJ),
          x.top,
          t(`plotStats.basisShort.${x.d.basis}`, { defaultValue: x.d.basis }),
        ]),
      },
      // Indices computed on different bases do not belong in one column of a
      // comparison table without saying so.
      note: perPlot.some((x) => x.d.lossy)
        ? t('plotStats.lossyNote')
        : perPlot.some((x) => x.d.basis !== perPlot[0].d.basis)
          ? t('report.plotsMixedBasis')
          : undefined,
    });

    // Per-plot α-diversity, split by taxon group for the same reason the plot
    // report splits: a table that puts a bird H′ and a plant H′ in one column
    // invites a comparison that does not mean anything.
    const projGroups = groupRecords(allSpecies);
    if (projGroups.length <= 1) {
      const perPlotDiv = unitDiversitySection(
        plots.map((p) => ({ label: p.plot.plotid, records: p.species })),
        t,
      );
      if (perPlotDiv) sections.push(perPlotDiv);
    } else {
      for (const g of projGroups) {
        const label = t(taxonGroupLabelKey(g.key));
        const units = plots
          .map((p) => ({
            label: p.plot.plotid,
            records: p.species.filter((r) => taxonGroupOf(r) === g.key),
          }))
          .filter((u) => u.records.length > 0);
        const sec = unitDiversitySection(units, t, `unitDiversity:${g.key}`);
        if (!sec) continue;
        sections.push({
          ...sec,
          heading: t('report.sectionForGroup', { heading: sec.heading, group: label }),
          note: [t('report.groupSplitNote', { group: label }), sec.note ?? '']
            .filter(Boolean)
            .join(' '),
        });
      }
    }

    // 4. Sampling effort — observed vs estimated, per plot, plus cross-plot Chao2
    const crossRecords = plots.flatMap((p) =>
      p.species.map((r) => ({ ...r, subplot_id: p.plot.id })),
    );
    const cross = chao2(
      crossRecords,
      plots.map((p) => p.plot.id),
    );
    // One estimator for the whole chart, or none at all. Chao1 and Chao2 answer
    // different questions and are not comparable bar-to-bar; the previous
    // version took whichever applied per plot, so a single chart could mix
    // them silently.
    const allChao1 = perPlot.every((x) => x.c1.applicable);
    const allChao2 = !allChao1 && perPlot.every((x) => x.c2.applicable);
    const estimator = allChao1 ? 'Chao1' : allChao2 ? 'Chao2' : null;
    const estimateFor = (x: (typeof perPlot)[number]): number | undefined =>
      allChao1 && x.c1.applicable
        ? x.c1.estimate
        : allChao2 && x.c2.applicable
          ? x.c2.estimate
          : undefined;
    sections.push({
      id: 'effort',
      heading: t('report.secEffort'),
      chart: {
        kind: 'bar',
        title: t('report.chartEffort'),
        unit: t('report.unitSpecies'),
        seriesLabels: estimator
          ? [t('report.seriesObserved'), `${t('report.seriesEstimated')} (${estimator})`]
          : [t('report.seriesObserved')],
        note: estimator ? undefined : t('report.effortMixedEstimators'),
        rows: perPlot.map((x) => ({
          label: x.p.plot.plotid,
          value: x.d.richness,
          value2: estimateFor(x),
          note: x.completeness != null ? pct(x.completeness, 0) : undefined,
        })),
      },
      table: cross.applicable
        ? {
            columns: [t('report.colIndex'), t('report.colValue')],
            rows: [
              [t('report.crossChao2'), num(cross.estimate, 1)],
              [t('plotStats.completeness', { pct: '' }).trim(), pct(cross.completeness, 0)],
              ['q1 / q2', `${cross.q1} / ${cross.q2}`],
              [t('report.samplingUnits'), int(cross.unitCount)],
            ],
            align: ['left', 'right'],
          }
        : undefined,
      note: cross.applicable ? t('report.crossChao2Note') : t('plotStats.crossNeedTwo'),
    });

    // 5. Project species list: in how many plots, and the highest abundance
    const byKey = new Map<string, { rec: ReportRecord; plots: Set<number>; maxQty: number }>();
    for (const p of plots) {
      for (const r of p.species) {
        const k = speciesKey(r);
        // Through `aggregateCell`, not `Number()`: a Br.-Bq. code and a DBH
        // stem array are not numbers, and the bare parse turned both into NaN
        // and then into an empty cell that read as "no data".
        const q = aggregateCell([r], 'cover').num;
        const cur = byKey.get(k);
        if (cur) {
          cur.plots.add(p.plot.id);
          if (q != null && Number.isFinite(q)) cur.maxQty = Math.max(cur.maxQty, q);
        } else {
          byKey.set(k, {
            rec: r,
            plots: new Set([p.plot.id]),
            maxQty: q != null && Number.isFinite(q) ? q : 0,
          });
        }
      }
    }
    const speciesRows = [...byKey.values()]
      .sort((a, b) => b.plots.size - a.plots.size || speciesLabel(a.rec).localeCompare(speciesLabel(b.rec)))
      .map((v) => [
        scientificName(v.rec),
        v.rec.common_name_c || '',
        v.rec.family_c ? `${v.rec.family_c} ${v.rec.family ?? ''}`.trim() : (v.rec.family ?? ''),
        `${v.plots.size} / ${plots.length}`,
        v.maxQty > 0 ? String(v.maxQty) : '',
      ]);
    sections.push({
      id: 'species',
      heading: t('report.secSpecies'),
      paras: [
        t('report.projectSpeciesSummary', {
          species: t('report.nSpeciesRecorded', { count: speciesRows.length }),
          plots: t('report.nPlotsAcross', { count: plots.length }),
        }),
      ],
      table: {
        columns: [
          t('report.colScientific'),
          t('report.colCommon'),
          t('rank.family'),
          t('report.colPlotFreq'),
          t('report.colMaxAbundance'),
        ],
        rows: speciesRows,
        align: ['left', 'left', 'left', 'right', 'right'],
      },
      // The column holds numericised values whose meaning depends on the
      // basis (cover %, individuals, basal area). Across a mixed project they
      // are not one another's units, so say which — or that there is no single
      // answer.
      note: (() => {
        const basis = computeDiversity(allSpecies).basis;
        return basis === 'mixed'
          ? t('report.maxAbundanceMixed')
          : t('report.maxAbundanceBasis', {
              basis: t(`plotStats.basisShort.${basis}`, { defaultValue: basis }),
            });
      })(),
    });

    // 6. Compositional similarity
    if (plots.length === 2) {
      const b = betaSimilarity(plots[0].species, plots[1].species);
      sections.push({
        id: 'similarity',
        heading: t('report.secSimilarity'),
        table: {
          columns: [t('report.colIndex'), t('report.colValue')],
          rows: [
            ['Sørensen', num(b.sorensen)],
            ['Jaccard', num(b.jaccard)],
            [t('plotStats.betaShared', { c: '' }).trim(), int(b.shared)],
            [plots[0].plot.plotid, int(b.onlyA)],
            [plots[1].plot.plotid, int(b.onlyB)],
          ],
          align: ['left', 'right'],
        },
        note: t('report.similarityNote'),
      });
    } else if (plots.length > 2) {
      const used = plots.slice(0, MAX_MATRIX_PLOTS);
      sections.push({
        id: 'similarity',
        heading: t('report.secSimilarity'),
        table: {
          columns: ['', ...used.map((p) => p.plot.plotid)],
          rows: used.map((a) => [
            a.plot.plotid,
            ...used.map((b) =>
              a === b ? '–' : num(betaSimilarity(a.species, b.species).sorensen),
            ),
          ]),
          align: ['left', ...used.map(() => 'right' as const)],
        },
        note:
          plots.length > MAX_MATRIX_PLOTS
            ? `${t('report.similarityNote')} ${t('report.matrixTruncated', { shown: used.length, total: plots.length })}`
            : t('report.similarityNote'),
      });
    }

    const comp = compositionSection(allSpecies, t);
    if (comp) sections.push(comp);
    const cons = conservationSection(allSpecies, t);
    if (cons) sections.push(cons);
    const consSp = conservationSpeciesSection(allSpecies, t);
    if (consSp) sections.push(consSp);
  }

  // The reader's caveat page: what the indices above rest on. Last before
  // the methods, because it is what qualifies everything preceding it.
  const dq = dataQualitySection(allSpecies, {}, t);
  if (dq) sections.push(dq);
  sections.push(methodsSection(t, sections.map((x) => x.id)));

  return {
    kind: 'project',
    title: t('report.projectTitle', { name: project.name }),
    generatedAt: isoDateTime(Date.now()),
    sections,
  };
}

// ── session (checklist) report ──────────────────────────────────────────────

export type SessionReportInput = {
  session: {
    id: number;
    name: string;
    started_at: number;
    ended_at: number | null;
    recorded_by: string | null;
    gps_mode: string | null;
    notes: string | null;
  };
  projectName: string;
  species: ReportRecord[];
};

export function buildSessionReport(input: SessionReportInput, t: Translate): Report {
  const { session, species } = input;
  const sections: ReportSection[] = [];

  sections.push({
    id: 'basics',
    heading: t('report.secBasics'),
    meta: [
      { key: t('report.metaProject'), value: input.projectName || '–' },
      { key: t('report.metaStart'), value: isoDateTime(session.started_at) },
      { key: t('report.metaEnd'), value: isoDateTime(session.ended_at) },
      { key: t('report.metaDuration'), value: durationText(session.started_at, session.ended_at, t) },
      { key: t('plot.recordedBy'), value: session.recorded_by || '–' },
    ],
    paras: session.notes ? [session.notes] : undefined,
  });

  if (species.length > 0) {
    const bySpecies = new Map<string, ReportRecord>();
    for (const r of species) if (!bySpecies.has(speciesKey(r))) bySpecies.set(speciesKey(r), r);
    const rows = [...bySpecies.values()]
      .map((r) => {
        const marks: string[] = [];
        if (r.is_endemic === 'true') marks.push(t('species.endemicShort'));
        if (r.redlist) marks.push(r.redlist);
        if (r.cites) marks.push(`CITES ${r.cites}`);
        return [
          scientificName(r),
          r.common_name_c || '',
          r.family_c ? `${r.family_c} ${r.family ?? ''}`.trim() : (r.family ?? ''),
          abundanceText(r.organism_quantity, r.organism_quantity_type, t),
          marks.join(' '),
        ];
      })
      .sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
    sections.push({
      id: 'species',
      heading: t('report.secSpecies'),
      paras: [t('report.speciesSummary', { count: rows.length })],
      table: {
        columns: [
          t('report.colScientific'),
          t('report.colCommon'),
          t('rank.family'),
          t('report.colAbundance'),
          t('report.colMarks'),
        ],
        rows,
      },
    });

    // Checklists usually carry no abundance; the diversity block appears only
    // when they actually do, rather than printing a table of dashes.
    const d = computeDiversity(species);
    if (d.shannonH != null) {
      sections.push(...perTaxonGroup(species, t, (recs) => diversitySection(recs, t)));
      sections.push(...perTaxonGroup(species, t, (recs) => dominantsSection(recs, [], t)));
    }
    // A checklist has no subplots, so Chao2 never applies — but Chao1 only
    // needs individual counts, which is exactly what a counted checklist is.
    // The section was previously omitted entirely.
    sections.push(
      ...perTaxonGroup(species, t, (recs) => effortSection(chao1(recs), chao2(recs, []), t)),
    );
    const comp = compositionSection(species, t);
    if (comp) sections.push(comp);
    const cons = conservationSection(species, t);
    if (cons) sections.push(cons);
    const consSp = conservationSpeciesSection(species, t);
    if (consSp) sections.push(consSp);
  }

  // The reader's caveat page: what the indices above rest on. Last before
  // the methods, because it is what qualifies everything preceding it.
  const dq = dataQualitySection(species, {}, t);
  if (dq) sections.push(dq);
  sections.push(methodsSection(t, sections.map((x) => x.id)));

  return {
    kind: 'session',
    title: t('report.sessionTitle', { name: session.name }),
    subtitle: input.projectName || undefined,
    generatedAt: isoDateTime(Date.now()),
    sections,
  };
}
