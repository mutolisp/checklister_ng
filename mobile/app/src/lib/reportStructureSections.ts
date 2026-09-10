/**
 * Stand-structure report sections: per-hectare density, diameter classes and
 * the Importance Value Index.
 *
 * These are the sections that finally consume the DBH data. Each one is
 * omitted when its inputs cannot support it, and says why — a report that
 * prints "0 stems/ha" because it could not work out the plot area is worse
 * than one that prints nothing and names the missing field.
 *
 * Pure module.
 */
import { int, num, pct } from './reportFormat';
import { resolvePlotArea, type PlotAreaInput, type PlotAreaResult } from './plotArea';
import {
  dbhDistribution,
  importanceValue,
  speciesStandRows,
  standDensity,
  type IviResult,
} from './standStructure';
import { speciesLabel } from './reportFormat';
import type { ReportRecord } from './reportStats';
import type { ReportSection, Translate } from './reportTypes';

/** How the area was obtained, or why it could not be. Printed under every
 *  per-hectare figure so a reader can judge what the denominator was. */
function areaNote(area: PlotAreaResult, t: Translate): string {
  return area.ok
    ? t(`report.areaSource.${area.source}`)
    : t(`report.areaUnknown.${area.reason}`, { unit: area.rawUnit ?? '' });
}

/**
 * Stems and basal area per hectare. Two independent ways to come up empty —
 * no usable area, or no stem data — and they need different explanations.
 */
export function standSection(
  records: ReportRecord[],
  areaInput: PlotAreaInput,
  t: Translate,
): ReportSection | null {
  const area = resolvePlotArea(areaInput);
  if (!area.ok) {
    // Only worth a section at all if there IS stem data being withheld.
    const wouldHave = standDensity(records, 1);
    if (!wouldHave) return null;
    return {
      id: 'stand',
      heading: t('report.secStand'),
      note: areaNote(area, t),
    };
  }
  const d = standDensity(records, area.areaM2);
  if (!d) return null;
  // Without DBH the "stems" are individual counts: density is still
  // meaningful, but basal area and quadratic mean diameter are not measured
  // at all and printing them as 0 would read as a finding.
  const rows: string[][] = [[t('report.plotAreaM2'), num(d.areaM2, 1)]];
  if (d.hasDbh) {
    rows.push([t('report.stems'), int(d.stems)]);
    rows.push([t('report.stemsPerHa'), num(d.stemsPerHa, 1)]);
    rows.push([t('report.basalAreaM2PerHa'), num(d.basalAreaM2PerHa, 4)]);
    if (d.quadraticMeanDbhCm != null) {
      rows.push([t('report.quadraticMeanDbh'), num(d.quadraticMeanDbhCm, 2)]);
    }
  } else {
    rows.push([t('report.individuals'), int(d.stems)]);
    rows.push([t('report.individualsPerHa'), num(d.stemsPerHa, 1)]);
  }
  return {
    id: 'stand',
    heading: t('report.secStand'),
    table: { columns: [t('report.colIndex'), t('report.colValue')], rows, align: ['left', 'right'] },
    note: areaNote(area, t),
  };
}

/**
 * Diameter-class distribution. A vertical column chart because the classes are
 * ordered and the SHAPE carries the meaning — a reverse-J says the stand is
 * regenerating, a bell says even-aged, and no summary statistic shows either.
 */
export function dbhClassSection(records: ReportRecord[], t: Translate): ReportSection | null {
  const dist = dbhDistribution(records);
  if (!dist) return null;
  return {
    id: 'dbhClasses',
    heading: t('report.secDbhClasses'),
    chart: {
      kind: 'column',
      title: t('report.chartDbhClasses'),
      unit: t('report.unitStems'),
      categoryAxisTitle: t('report.axisDbhCm'),
      valueAxisTitle: t('report.unitStems'),
      rows: dist.bins.map((b) => ({
        label: `${b.lowCm}–${b.highCm}`,
        value: b.stems,
      })),
    },
    table: {
      columns: [t('report.colDbhClass'), t('report.unitStems'), t('report.colShare')],
      rows: dist.bins.map((b) => [
        `${b.lowCm}–${b.highCm}`,
        int(b.stems),
        pct(dist.stems > 0 ? b.stems / dist.stems : null, 1),
      ]),
      align: ['left', 'right', 'right'],
    },
    note: t('report.dbhClassNote', {
      width: dist.binWidthCm,
      min: num(dist.minCm, 1),
      max: num(dist.maxCm, 1),
      qmd: num(dist.quadraticMeanDbhCm, 2),
    }),
  };
}

/** Component labels, so the caption can name exactly what was summed. */
function componentList(ivi: IviResult, t: Translate): string {
  return ivi.components.map((c) => t(`report.iviComponent.${c}`)).join(' + ');
}

/**
 * Importance Value Index, with only the components the data supports.
 *
 * The component count is printed in the caption and the scale is stated,
 * because a two-component sum runs 0–200 and comparing it against a
 * three-component 0–300 is meaningless. `normalised` is given alongside so
 * plots with different component counts remain comparable.
 */
export function iviSection(
  records: ReportRecord[],
  occupancy: Map<string, number>,
  areaInput: PlotAreaInput,
  t: Translate,
): ReportSection | null {
  const ivi = importanceValue(records, occupancy);
  if (ivi.components.length === 0 || ivi.rows.length === 0) return null;

  const byKey = new Map<string, ReportRecord>();
  for (const r of records) {
    const k = `${r.taxon_id}|${r.used_scientific_name ?? ''}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }
  const area = resolvePlotArea(areaInput);
  const stand = area.ok ? speciesStandRows(records, area.areaM2) : null;
  const label = (k: string) => (byKey.has(k) ? speciesLabel(byKey.get(k)!) : k);

  // 「植物生態評估技術規範」範例 2.11 tabulates a woody plot as
  //   species | density (stems/ha) by dbh class 1–3, 3–10, >10, all
  //           | basal area (m²/ha) | IV100
  // sorted by importance value and closed with a Sum row. When the stand
  // figures are available the table follows that layout, because an EIA table
  // is read against other EIA tables and the columns have to line up.
  if (stand) {
    const cols = [
      t('report.colSpecies'),
      '1-3', '3-10', '>10', t('report.dbhClassAll'),
      t('report.colBasalAreaHa'),
      t('report.colIv100'),
    ];
    const rows = ivi.rows.map((r) => {
      const st = stand.get(r.key);
      return [
        label(r.key),
        ...(st ? st.densityPerHa.map((v) => num(v, 0)) : ['–', '–', '–', '–']),
        st ? num(st.basalAreaM2PerHa, 2) : '–',
        num(r.normalised, 2),
      ];
    });
    // The Sum row is part of the specification's layout: it is what lets a
    // reader confirm the density columns add up and that IV totals 100.
    const totals = [0, 0, 0, 0];
    let baTotal = 0;
    for (const st of stand.values()) {
      st.densityPerHa.forEach((v, i) => (totals[i] += v));
      baTotal += st.basalAreaM2PerHa;
    }
    rows.push([
      t('report.sumRow'),
      ...totals.map((v) => num(v, 0)),
      num(baTotal, 2),
      num(ivi.rows.reduce((sum, r) => sum + r.normalised, 0), 2),
    ]);
    return {
      id: 'ivi',
      heading: t('report.secIvi'),
      chart: iviChart(ivi, label, t),
      table: {
        columns: cols,
        rows,
        align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
        totalRows: 1,
      },
      note: iviNote(ivi, t),
    };
  }

  // No usable area: fall back to the component breakdown, which needs no
  // denominator. The IV scale is unchanged — only the density columns are lost.
  const cols = [t('report.colSpecies')];
  const align: Array<'left' | 'right'> = ['left'];
  if (ivi.components.includes('density')) {
    cols.push(t('report.iviRelDensity'));
    align.push('right');
  }
  if (ivi.components.includes('dominance')) {
    cols.push(t('report.iviRelDominance'));
    align.push('right');
  }
  if (ivi.components.includes('frequency')) {
    cols.push(t('report.iviRelFrequency'));
    align.push('right');
  }
  cols.push(t('report.colIv100'));
  align.push('right');

  const top = ivi.rows.slice(0, 30);
  return {
    id: 'ivi',
    heading: t('report.secIvi'),
    chart: iviChart(ivi, label, t),
    table: {
      columns: cols,
      rows: top.map((r) => {
        const row = [label(r.key)];
        if (ivi.components.includes('density')) row.push(num(r.relDensity, 1));
        if (ivi.components.includes('dominance')) row.push(num(r.relDominance, 1));
        if (ivi.components.includes('frequency')) row.push(num(r.relFrequency, 1));
        row.push(num(r.normalised, 2));
        return row;
      }),
      align,
    },
    note: iviNote(ivi, t),
  };
}

/**
 * The chart plots IV on the specification's 0–100 scale, not the 0–300 sum:
 * 「植物生態評估技術規範」defines IV＝(相對密度＋相對優勢度＋相對頻度)×100/3,
 * and its 範例 2.11 closes with a Sum row of exactly 100. A two-component IV
 * is divided by two on the same reasoning, so the axis stays comparable.
 */
function iviChart(
  ivi: IviResult,
  label: (k: string) => string,
  t: Translate,
): ReportSection['chart'] {
  return {
    kind: 'bar',
    title: t('report.chartIvi'),
    unit: t('report.colIv100'),
    max: 100,
    rows: ivi.rows.slice(0, 10).map((r) => ({ label: label(r.key), value: r.normalised })),
    note: iviNote(ivi, t),
  };
}

function iviNote(ivi: IviResult, t: Translate): string {
  return [
    t('report.iviComponents', {
      n: ivi.components.length,
      list: componentList(ivi, t),
    }),
    ivi.dominanceBasis ? t(`report.iviDominance.${ivi.dominanceBasis}`) : '',
    ...ivi.omitted.map((o) =>
      t('report.iviOmitted', {
        component: t(`report.iviComponent.${o.component}`),
        reason: t(`report.iviReason.${o.reason}`),
      }),
    ),
  ]
    .filter(Boolean)
    .join(' ');
}
