/**
 * 跨樣區取樣努力量 — Chao2 with WHOLE PLOTS as the incidence sampling units.
 *
 * Companion to the in-plot card (PlotDiversityCard, subplots as units): this
 * one answers "how complete is the species pool of the AREA these plots
 * sample?" — the classic sample-based use (vegan `specpool`, plots as sites).
 * The user multi-selects which plots define the scope, because units must be
 * comparable samples of the same assemblage (same area / vegetation type /
 * protocol); that judgement is ecological, not something the app can infer.
 *
 * Math lives in src/lib/diversity.ts (chao2, verified formulas — see its
 * header); here each plot's records are relabelled with the PLOT id as the
 * unit key before being fed in.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { listPlotSpecies } from '~/db';
import { betaSimilarity, chao2, type BetaSimilarity, type Chao2Result, type DiversityRecord } from '~/lib/diversity';

type PlotRef = { id: number; title: string };

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function CrossPlotChao2Card({ plots }: { plots: PlotRef[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  // Per-plot records with the plot id as the incidence unit. Loaded once per
  // plot set (sync SQLite, a handful of plots) and reused across toggles.
  const perPlot = useMemo(
    () =>
      plots.map((p) => {
        let records: DiversityRecord[] = [];
        try {
          records = listPlotSpecies(p.id).map((r) => ({
            taxon_id: r.taxon_id,
            used_scientific_name: r.used_scientific_name,
            organism_quantity: r.organism_quantity,
            organism_quantity_type: r.organism_quantity_type,
            subplot_id: p.id,
          }));
        } catch {
          // A failed load only drops this plot from the calculation.
        }
        const speciesCount = new Set(
          records.map((r) => `${r.taxon_id}|${r.used_scientific_name ?? ''}`),
        ).size;
        return { plot: p, records, speciesCount };
      }),
    [plots],
  );

  const selected = perPlot.filter((pp) => !deselected.has(pp.plot.id));
  const result = useMemo(() => {
    const ids = selected.map((pp) => pp.plot.id);
    return chao2(
      selected.flatMap((pp) => pp.records),
      ids,
    );
  }, [selected]);

  if (plots.length < 2) return null;

  const toggle = (id: number) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View className="border-b border-gray-100 dark:border-gray-800 bg-sky-50/60 dark:bg-sky-950/20">
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        className="flex-row items-center px-4 py-2.5 active:bg-sky-100/60 dark:active:bg-sky-900/30"
        accessibilityLabel={t('plotStats.crossTitle')}
      >
        <Ionicons name="analytics-outline" size={14} color="#0284c7" />
        <Text className="ml-2 flex-1 text-xs font-medium text-sky-900 dark:text-sky-200" numberOfLines={1}>
          {t('plotStats.crossTitle')}
          {result.applicable
            ? ` · ${t('plotStats.completenessShort', { pct: pct(result.completeness) })}`
            : ''}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#0284c7" />
      </Pressable>

      {expanded ? (
        <View className="px-4 pb-3">
          <Text className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('plotStats.crossHint')}
          </Text>

          <View className="mt-2">
            {perPlot.map(({ plot, speciesCount }) => {
              const on = !deselected.has(plot.id);
              return (
                <Pressable
                  key={plot.id}
                  onPress={() => toggle(plot.id)}
                  className="flex-row items-center py-1.5"
                  accessibilityLabel={plot.title}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={on ? '#0284c7' : '#9ca3af'}
                  />
                  <Text className="ml-2 flex-1 text-sm text-gray-900 dark:text-gray-100" numberOfLines={1}>
                    {plot.title}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400">
                    {t('plotStats.sppCount', { n: speciesCount })}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selected.length === 2 ? (
            <BetaSimilarityBlock
              beta={betaSimilarity(selected[0].records, selected[1].records)}
              nameA={selected[0].plot.title}
              nameB={selected[1].plot.title}
            />
          ) : null}
          {result.applicable ? (
            <Chao2ResultBlock result={result} />
          ) : (
            <Text className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {selected.length < 2 ? t('plotStats.crossNeedTwo') : t('plotStats.crossEmpty')}
            </Text>
          )}

          <Text className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
            {t('plotStats.lowerBoundNote')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The shared cross-plot Chao2 result rows — used by the project card, the
 *  records-tab multi-select sheet, and anything else that shows the same
 *  numbers. One rendering, no drift. */
export function Chao2ResultBlock({ result }: { result: Extract<Chao2Result, { applicable: true }> }) {
  const { t } = useTranslation();
  return (
    <View className="mt-2 rounded-lg bg-white dark:bg-gray-900 px-3 py-2">
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100" style={{ fontVariant: ['tabular-nums'] }}>
        {t('plotStats.crossResult', {
          n: result.unitCount,
          sObs: result.sObs,
          est: result.estimate.toFixed(1),
        })}
        {result.biasCorrected ? t('plotStats.biasCorrected') : ''}
      </Text>
      <Text className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
        {t('plotStats.completeness', { pct: pct(result.completeness) })} ·{' '}
        {t('plotStats.crossQ', { q1: result.q1, q2: result.q2 })}
      </Text>
    </View>
  );
}

/** Pairwise β similarity rows (only defined for exactly two plots) — shared by
 *  the project card and the records-tab multi-select sheet. */
export function BetaSimilarityBlock({
  beta,
  nameA,
  nameB,
}: {
  beta: BetaSimilarity;
  nameA: string;
  nameB: string;
}) {
  const { t } = useTranslation();
  return (
    <View className="mt-2 rounded-lg bg-white dark:bg-gray-900 px-3 py-2">
      <Text className="text-xs font-semibold text-gray-700 dark:text-gray-300" numberOfLines={1}>
        {t('plotStats.betaTitle', { a: nameA, b: nameB })}
      </Text>
      <Text className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100" style={{ fontVariant: ['tabular-nums'] }}>
        {`Sørensen ${beta.sorensen.toFixed(2)} · Jaccard ${beta.jaccard.toFixed(2)}`}
      </Text>
      <Text className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
        {t('plotStats.betaShared', { c: beta.shared })} ·{' '}
        {t('plotStats.betaOnly', { a: beta.onlyA, b: beta.onlyB })}
      </Text>
    </View>
  );
}
