/**
 * Section builders shared by all three report kinds (plot, project,
 * checklist). Extracted from `reportModel.ts` so a section is defined once and
 * the three `build*Report` functions assemble rather than duplicate.
 *
 * Pure module. Every builder returns `null` when its inputs cannot support it,
 * which is how the report stays honest: a section is absent, or present with a
 * stated reason, but never populated with a number that does not mean what its
 * label says.
 */
import {
  computeDiversity,
  relativeFrequency,
  speciesKey,
  type Chao1Result,
  type Chao2Result,
} from './diversity';
import {
  conservationTally,
  taxonComposition,
  type ReportRecord,
} from './reportStats';
import { alienLabel, int, num, pct, speciesLabel } from './reportFormat';
import { asStemCounts, hasDbhRecords } from './standStructure';
import { groupRecords, taxonGroupLabelKey } from './taxonGroup';
import { dataQuality, type QualityIssue } from './dataQuality';
import {
  abundanceRarefaction,
  incidenceRarefaction,
  type RarefactionResult,
} from './rarefaction';
import type { ReportSection, Translate } from './reportTypes';

// ── shared section builders ─────────────────────────────────────────────────

export function diversitySection(records: ReportRecord[], t: Translate): ReportSection | null {
  const d = computeDiversity(records);
  if (d.richness === 0) return null;

  // For woody data the report gives BOTH readings. The app weights a DBH
  // species by its basal area (one large tree really does dominate a stand);
  // 「植物生態評估技術規範」specifies 木本植物以株數計算. They answer different
  // questions, so neither is silently chosen — the note says which is which.
  const dual = hasDbhRecords(records) ? computeDiversity(asStemCounts(records)) : null;

  const idx = (label: string, pick: (r: typeof d) => string): string[] =>
    dual ? [label, pick(d), pick(dual)] : [label, pick(d)];

  const rows: string[][] = [
    idx(`S ${t('plotStats.richness')}`, (r) => int(r.richness)),
    idx(`λ ${t('report.simpsonLambda')}`, (r) => num(r.simpsonD)),
    idx(`H′ ${t('plotStats.shannon')}`, (r) => num(r.shannonH)),
    idx(`N₁ ${t('report.shannonEffective')}`, (r) => num(r.shannonDiversity, 3)),
    idx(`N₂ ${t('report.invSimpson')}`, (r) => num(r.invSimpson, 3)),
    idx(`E5 ${t('report.hillE5')}`, (r) => num(r.hillE5, 3)),
    idx(t('plotStats.simpson'), (r) => num(r.simpson1mD)),
    idx(t('plotStats.evenness'), (r) => num(r.pielouJ)),
    idx(t('plotStats.bergerParker'), (r) => num(r.bergerParker)),
  ];

  return {
    id: 'diversity',
    heading: t('report.secDiversity'),
    table: {
      columns: dual
        ? [t('report.colIndex'), t('report.basisBasalArea'), t('report.basisStems')]
        : [t('report.colIndex'), t('report.colValue')],
      rows,
      align: dual ? ['left', 'right', 'right'] : ['left', 'right'],
    },
    note: [
      dual ? t('report.dualBasisNote') : t(`plotStats.basis.${d.basis}`),
      d.lossy ? t('plotStats.lossyNote') : '',
      t('report.diversityIndexSource'),
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export function dominantsSection(
  records: ReportRecord[],
  subplotIds: number[],
  t: Translate,
): ReportSection | null {
  const d = computeDiversity(records);
  if (d.dominants.length === 0) return null;
  const byKey = new Map(records.map((r) => [speciesKey(r), r]));
  const freq = relativeFrequency(records, subplotIds);
  const top = d.dominants.slice(0, 10);
  // The basis/lossy caveat has to ride on the chart, not only on the
  // diversity table further up: a reader looking at these bars alone cannot
  // otherwise tell that a Br.-Bq. midpoint and an individual count were
  // weighed against each other.
  const basisNote = `${t(`plotStats.basis.${d.basis}`)}${d.lossy ? ` ${t('plotStats.lossyNote')}` : ''}`;
  return {
    id: 'dominants',
    heading: t('report.secDominants'),
    chart: {
      kind: 'bar',
      title: t('report.chartDominants'),
      unit: '%',
      note: basisNote,
      rows: top.map((x) => ({
        label: byKey.get(x.key) ? speciesLabel(byKey.get(x.key)!) : x.key,
        value: x.share * 100,
        note: freq.has(x.key) ? t('plotStats.freqShort', { pct: pct(freq.get(x.key), 0) }) : undefined,
      })),
      max: 100,
    },
    table: {
      columns: [
        t('report.colSpecies'),
        t('report.colRelative'),
        ...(freq.size > 0 ? [t('plotStats.freqShort', { pct: '' }).trim()] : []),
      ],
      rows: top.map((x) => {
        const r = byKey.get(x.key);
        const base = [r ? speciesLabel(r) : x.key, pct(x.share)];
        return freq.size > 0 ? [...base, pct(freq.get(x.key) ?? null)] : base;
      }),
      align: freq.size > 0 ? ['left', 'right', 'right'] : ['left', 'right'],
    },
    note: freq.size > 0 ? t('plotStats.dominantNoteFreq') : t('plotStats.dominantNote'),
  };
}

export function effortSection(
  c1: Chao1Result,
  c2: Chao2Result,
  t: Translate,
): ReportSection {
  const rows: string[][] = [];
  let note = '';
  if (c1.applicable) {
    rows.push([`Chao1${c1.biasCorrected ? t('plotStats.biasCorrected') : ''}`, num(c1.estimate, 1)]);
    rows.push([t('plotStats.completeness', { pct: '' }).trim(), pct(c1.completeness, 0)]);
    rows.push([t('plotStats.coverage'), pct(c1.coverage, 0)]);
    rows.push(['f1 / f2', `${c1.f1} / ${c1.f2}`]);
    note = t('plotStats.lowerBoundNote');
  } else if (c2.applicable) {
    rows.push([`Chao2${c2.biasCorrected ? t('plotStats.biasCorrected') : ''}`, num(c2.estimate, 1)]);
    rows.push([t('plotStats.completeness', { pct: '' }).trim(), pct(c2.completeness, 0)]);
    rows.push(['q1 / q2', `${c2.q1} / ${c2.q2}`]);
    rows.push([t('report.samplingUnits'), int(c2.unitCount)]);
    note = t('plotStats.lowerBoundNote');
  } else {
    note = t('plotStats.chaoNeedsData');
  }
  return {
    id: 'effort',
    heading: t('report.secEffort'),
    table: rows.length
      ? { columns: [t('report.colIndex'), t('report.colValue')], rows, align: ['left', 'right'] }
      : undefined,
    note,
  };
}

export function compositionSection(records: ReportRecord[], t: Translate): ReportSection | null {
  const comp = taxonComposition(records, 'family');
  if (comp.length === 0) return null;
  const top = comp.slice(0, 15);
  return {
    id: 'composition',
    heading: t('report.secComposition'),
    paras: [t('report.compositionSummary', { families: comp.length })],
    chart: {
      kind: 'bar',
      title: t('report.chartComposition'),
      unit: t('report.unitSpecies'),
      rows: top.map((c) => ({
        label: c.nameLocal ? `${c.nameLocal} ${c.name}` : c.name,
        value: c.count,
      })),
    },
  };
}

export function conservationSection(records: ReportRecord[], t: Translate): ReportSection | null {
  const c = conservationTally(records);
  const rows: string[][] = [];
  if (c.endemic > 0) rows.push([t('species.endemic'), int(c.endemic)]);
  // 'native' and 'naturalized' read the same for every kingdom, so their
  // per-kingdom rows merge back together; only 'cultured' stays split
  // (captive vs cultivated).
  const alienMerged = new Map<string, number>();
  for (const a of c.alien) {
    const label = alienLabel(a.code, a.kingdom, t);
    alienMerged.set(label, (alienMerged.get(label) ?? 0) + a.count);
  }
  for (const [label, count] of alienMerged) rows.push([label, int(count)]);
  for (const r of c.redlist) rows.push([`${t('species.redlist')} ${r.code}`, int(r.count)]);
  for (const r of c.iucn) rows.push([`IUCN ${r.code}`, int(r.count)]);
  for (const r of c.cites) rows.push([`CITES ${r.code}`, int(r.count)]);
  for (const r of c.protected) rows.push([`${t('species.protected')} ${r.code}`, int(r.count)]);
  if (rows.length === 0) return null;
  return {
    id: 'conservation',
    heading: t('report.secConservation'),
    table: {
      columns: [t('report.colCategory'), t('report.colSpeciesCount')],
      rows,
      align: ['left', 'right'],
    },
    note: t('report.conservationNote'),
  };
}

/**
 * The species BEHIND the conservation tally.
 *
 * A count ("Red List VU: 3") is not usable on its own — the point of a
 * conservation section in an assessment report is which species, so the reader
 * can check them against the site. This lists every species carrying at least
 * one non-routine status, with each status in its own column.
 *
 * Ordered by threat: the highest category a species holds decides its place,
 * so CR sorts above EN above VU, and a reader can stop reading when the rows
 * stop mattering.
 */
const REDLIST_ORDER = ['EX', 'EW', 'RE', 'CR', 'EN', 'VU', 'NT', 'DD'];

function threatRank(code: string): number {
  const i = REDLIST_ORDER.indexOf(code.replace(/^N/, ''));
  return i === -1 ? REDLIST_ORDER.length : i;
}

export function conservationSpeciesSection(
  records: ReportRecord[],
  t: Translate,
): ReportSection | null {
  const seen = new Map<string, ReportRecord>();
  for (const r of records) {
    const k = speciesKey(r);
    if (!seen.has(k)) seen.set(k, r);
  }
  const safe = new Set(['LC', 'NLC', 'NE', 'NA', '']);
  const listed = [...seen.values()].filter(
    (r) =>
      !safe.has((r.redlist ?? '').trim()) ||
      !safe.has((r.iucn ?? '').trim()) ||
      (r.cites ?? '').trim() !== '' ||
      (r.protected ?? '').trim() !== '' ||
      r.is_endemic === 'true',
  );
  if (listed.length === 0) return null;

  listed.sort((a, b) => {
    const ra = Math.min(threatRank(a.redlist ?? ''), threatRank(a.iucn ?? ''));
    const rb = Math.min(threatRank(b.redlist ?? ''), threatRank(b.iucn ?? ''));
    return ra - rb || speciesLabel(a).localeCompare(speciesLabel(b));
  });

  const cell = (v: string | undefined) => {
    const s = (v ?? '').trim();
    return s === '' || safe.has(s) ? '–' : s;
  };
  return {
    id: 'conservationSpecies',
    heading: t('report.secConservationSpecies'),
    table: {
      columns: [
        t('report.colSpecies'),
        t('rank.family'),
        t('species.redlist'),
        'IUCN',
        'CITES',
        t('species.protected'),
        t('species.endemic'),
      ],
      rows: listed.map((r) => [
        speciesLabel(r),
        r.family_c ? `${r.family_c} ${r.family ?? ''}`.trim() : (r.family ?? ''),
        cell(r.redlist),
        cell(r.iucn),
        cell(r.cites),
        cell(r.protected),
        r.is_endemic === 'true' ? t('species.endemicShort') : '–',
      ]),
      align: ['left', 'left', 'left', 'left', 'left', 'left', 'left'],
    },
    note: t('report.conservationSpeciesNote'),
  };
}

/**
 * Methods, written to be pasted into a manuscript.
 *
 * Only the statistics the report ACTUALLY contains get a paragraph. A methods
 * section describing an analysis that was omitted (because the data could not
 * support it) is worse than none: it asserts work that was not done. The
 * caller passes the section ids present, group suffixes and all.
 */
export function methodsSection(t: Translate, presentIds: string[] = []): ReportSection {
  // `diversity:Aves` and `diversity` are the same statistic.
  const present = new Set(presentIds.map((id) => id.split(':')[0]));
  const has = (id: string) => present.size === 0 || present.has(id);

  const paras: string[] = [];
  if (has('diversity')) {
    paras.push(t('report.methodsShannon'), t('report.methodsSimpson'), t('report.methodsEvenness'));
    paras.push(t('report.methodsSpecIndices'));
  }
  if (has('dominants')) paras.push(t('report.methodsDominance'));
  if (has('stand')) paras.push(t('report.methodsStand'));
  if (has('dbhClasses')) paras.push(t('report.methodsDbhClasses'));
  if (has('ivi')) paras.push(t('report.methodsIvi'));
  if (has('effort')) paras.push(t('report.methodsChao'), t('report.methodsCoverage'));
  if (has('rarefaction')) paras.push(t('report.methodsRarefaction'));
  if (has('dataQuality')) paras.push(t('report.methodsDataQuality'));

  return {
    id: 'methods',
    heading: t('report.secMethods'),
    paras,
    note: t('report.methodsProvenance'),
  };
}

/**
 * Per-unit α-diversity table with a pooled row — the shape 「植物生態評估技術
 * 規範」範例 2.13 uses: 樣區 | S | λ | H′ | N₁ | N₂ | E5, one row per plot and
 * an "All" row for the pooled data.
 *
 * The pooled row is NOT the mean of the rows above it: it is the indices
 * recomputed over every record at once, which is why it can (and in the
 * specification's own example does) exceed every individual plot.
 */
export function unitDiversitySection(
  units: Array<{ label: string; records: ReportRecord[] }>,
  t: Translate,
  id = 'unitDiversity',
): ReportSection | null {
  if (units.length === 0) return null;
  const row = (label: string, recs: ReportRecord[]): string[] => {
    const d = computeDiversity(recs);
    return [
      label,
      int(d.richness),
      num(d.simpsonD, 3),
      num(d.shannonH, 3),
      num(d.shannonDiversity, 3),
      num(d.invSimpson, 3),
      num(d.hillE5, 3),
    ];
  };
  const rows = units.map((u) => row(u.label, u.records));
  if (units.length > 1) {
    rows.push(row(t('report.pooledRow'), units.flatMap((u) => u.records)));
  }
  return {
    id,
    heading: t('report.secUnitDiversity'),
    table: {
      columns: [t('report.colUnit'), `S ${t('plotStats.richness')}`, 'λ', 'H′', 'N₁', 'N₂', 'E5'],
      rows,
      align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    },
    note: [t('report.pooledNote'), t('report.diversityIndexSource')].join(' '),
  };
}

/**
 * Run an analysis section once per higher taxon group.
 *
 * Diversity indices, importance values and richness estimators are only
 * comparable within a group: birds and vascular plants are surveyed by
 * different methods, counted in different units, and drawn from different
 * species pools, so a pooled H′ is arithmetically valid and ecologically
 * meaningless. When a record set spans more than one group the section is
 * therefore emitted once per group, with the group named in the heading and a
 * distinct section id; when it spans one, the output is exactly what it was
 * before, with no suffix and no note.
 *
 * Inventory-style sections (species list, family composition, conservation
 * tallies) are NOT routed through here — those are counts, and pooling them
 * across groups is both meaningful and what a reader expects.
 */
export function perTaxonGroup(
  records: ReportRecord[],
  t: Translate,
  build: (recs: ReportRecord[]) => ReportSection | null,
): ReportSection[] {
  const groups = groupRecords(records);
  if (groups.length <= 1) {
    const only = build(records);
    return only ? [only] : [];
  }
  const out: ReportSection[] = [];
  for (const g of groups) {
    const sec = build(g.records);
    if (!sec) continue;
    const label = t(taxonGroupLabelKey(g.key));
    out.push({
      ...sec,
      id: `${sec.id}:${g.key}`,
      heading: t('report.sectionForGroup', { heading: sec.heading, group: label }),
      note: [t('report.groupSplitNote', { group: label }), sec.note ?? ''].filter(Boolean).join(' '),
    });
  }
  return out;
}

/**
 * Species-accumulation curve with a bootstrap confidence band.
 *
 * Two bases, in order of preference:
 *   - INCIDENCE across sampling units (subplots, or plots in a project), which
 *     is what a vegetation survey actually replicates;
 *   - ABUNDANCE over individuals, when the records are counts and there are no
 *     units to accumulate over.
 * When neither applies the section states why rather than drawing something
 * that looks like a curve but is not one.
 *
 * The band is Appendix G's unconditional bootstrap: it describes another
 * sample from the same assemblage, which is the question a reader asks
 * ("would more effort find more?"), not resampling within this one.
 */
export function rarefactionSection(
  records: ReportRecord[],
  unitIds: number[],
  t: Translate,
): ReportSection | null {
  let result: RarefactionResult = incidenceRarefaction(records, unitIds);
  if (!result.applicable) {
    const byIndividuals = abundanceRarefaction(records);
    if (byIndividuals.applicable) result = byIndividuals;
  }
  if (!result.applicable) {
    // Only worth saying anything when there were species to accumulate.
    if (records.length === 0) return null;
    return {
      id: 'rarefaction',
      heading: t('report.secRarefaction'),
      note: t(`report.rarefactionUnavailable.${result.reason}`),
    };
  }

  const unitKey = result.basis === 'incidence' ? 'report.axisUnits' : 'report.axisIndividuals';
  const observedAt = result.points.filter((p) => !p.extrapolated);
  const last = result.points[result.points.length - 1];
  return {
    id: 'rarefaction',
    heading: t('report.secRarefaction'),
    chart: {
      kind: 'line',
      title: t('report.chartRarefaction'),
      xAxis: { title: t(unitKey) },
      yAxis: { title: t('plotStats.richness'), min: 0 },
      series: [
        {
          label: t('report.seriesRichness'),
          points: result.points.map((p) => ({ x: p.size, y: p.richness })),
          band: result.points.map((p) => ({
            lo: p.lo ?? p.richness,
            hi: p.hi ?? p.richness,
          })),
        },
      ],
      note: t('report.rarefactionNote', { b: result.replicates }),
    },
    table: {
      columns: [t('report.colIndex'), t('report.colValue')],
      rows: [
        [t(result.basis === 'incidence' ? 'report.samplingUnits' : 'report.individuals'),
         int(result.reference)],
        [t('plotStats.richness'), int(result.observed)],
        ...(result.coverage != null
          ? [[t('report.coverageJost'), pct(result.coverage, 1)]]
          : []),
        [
          t('report.extrapolatedTo', { size: last.size }),
          `${num(last.richness, 1)} (${num(last.lo ?? last.richness, 1)}–${num(last.hi ?? last.richness, 1)})`,
        ],
      ],
      align: ['left', 'right'],
    },
    note: [
      t('report.extrapolationBound'),
      observedAt.length > 0 ? '' : '',
      t('report.rarefactionSource'),
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/** One line per issue, phrased as a fact rather than a fault. */
function issueText(i: QualityIssue, t: Translate): string {
  switch (i.code) {
    case 'no-abundance':
      return t('report.dq.noAbundance', { records: i.records, species: i.species });
    case 'genus-only':
      return t('report.dq.genusOnly', { n: i.species, examples: i.examples.join('、') });
    case 'above-genus':
      return t('report.dq.aboveGenus', { n: i.species, examples: i.examples.join('、') });
    case 'rank-unknown':
      return t('report.dq.rankUnknown', { n: i.species });
    case 'mixed-units':
      return t('report.dq.mixedUnits', { kinds: i.kinds.join(', ') });
    case 'unparseable':
      return t('report.dq.unparseable', { n: i.records, examples: i.examples.join('、') });
    case 'singletons':
      return t('report.dq.singletons', { n: i.species });
    case 'doubletons':
      return t('report.dq.doubletons', { n: i.species });
    case 'no-layer':
      return t('report.dq.noLayer', { n: i.records });
    case 'no-subplot':
      return t('report.dq.noSubplot', { n: i.records });
    default:
      return '';
  }
}

/**
 * The reader's caveat page, placed last before the methods.
 *
 * Every index earlier in the report rests on assumptions the records may not
 * satisfy, and none of that is visible from the index itself. This states it:
 * how many records carry no quantity, how many "species" are genus-level
 * placeholders, whether units are mixed, how many singletons the Chao
 * estimates are leaning on.
 *
 * Deliberately not framed as errors. A genus-level record is ordinary field
 * practice; it just inflates richness, and the reader is entitled to know by
 * how much.
 */
export function dataQualitySection(
  records: ReportRecord[],
  ctx: { hasSubplots?: boolean; hasLayers?: boolean },
  t: Translate,
): ReportSection | null {
  if (records.length === 0) return null;
  const q = dataQuality(records, ctx);
  const rows: string[][] = [
    [t('report.dq.records'), int(q.totalRecords)],
    [t('report.dq.species'), int(q.totalSpecies)],
  ];
  return {
    id: 'dataQuality',
    heading: t('report.secDataQuality'),
    table: { columns: [t('report.colItem'), t('report.colValue')], rows, align: ['left', 'right'] },
    paras: q.issues.length > 0 ? q.issues.map((i) => issueText(i, t)) : [t('report.dq.clean')],
    note: t('report.dq.note'),
  };
}

/**
 * Rank-abundance (Whittaker) plot: species ranked by abundance, plotted on a
 * LOG value axis.
 *
 * The shape is the finding. A steep straight line is a community dominated by
 * a few species; a long shallow tail is an even one. No summary statistic
 * shows that — Shannon and Simpson each collapse the whole curve to one
 * number, and two very different communities can share either.
 *
 * Refused when the basis is mixed: a Braun-Blanquet midpoint and a stem count
 * cannot be ranked against each other, and a curve drawn from both would look
 * exactly as convincing as a real one.
 */
export function rankAbundanceSection(
  records: ReportRecord[],
  t: Translate,
): ReportSection | null {
  const d = computeDiversity(records);
  if (d.dominants.length < 3) return null;
  if (d.basis === 'mixed' || d.basis === 'none') {
    return {
      id: 'rankAbundance',
      heading: t('report.secRankAbundance'),
      note: t('report.rankAbundanceMixed'),
    };
  }

  // A log axis cannot show a zero. Those species are dropped from the CURVE
  // (they carry no abundance to rank) and the caption says how many, rather
  // than the line quietly having fewer points than the plot has species.
  const positive = d.dominants.filter((x) => x.share > 0);
  const dropped = d.dominants.length - positive.length;
  const byKey = new Map(records.map((r) => [speciesKey(r), r]));

  return {
    id: 'rankAbundance',
    heading: t('report.secRankAbundance'),
    chart: {
      kind: 'line',
      title: t('report.chartRankAbundance'),
      xAxis: { title: t('report.axisRank') },
      yAxis: { title: t('report.axisRelAbundance'), scale: 'log10' },
      series: [
        {
          label: t('report.seriesRelAbundance'),
          points: positive.map((x, i) => ({ x: i + 1, y: x.share * 100 })),
          style: 'lineMarker',
        },
      ],
      note: [
        t('report.rankAbundanceNote'),
        dropped > 0 ? t('report.rankAbundanceDropped', { n: dropped }) : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
    table: {
      columns: [t('report.axisRank'), t('report.colSpecies'), t('report.colRelative')],
      rows: positive.slice(0, 20).map((x, i) => [
        String(i + 1),
        byKey.has(x.key) ? speciesLabel(byKey.get(x.key)!) : x.key,
        pct(x.share),
      ]),
      align: ['right', 'left', 'right'],
    },
    note: t(`plotStats.basis.${d.basis}`),
  };
}
