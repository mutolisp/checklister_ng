/**
 * 樣區即時多樣性摺疊卡 — species richness / Shannon / Simpson plus the
 * sampling-effort estimators (Chao1 for count data, Chao2 across subplots,
 * Good–Turing coverage). Sits at the top of the plot species tab and updates
 * live as records are added.
 *
 * All math lives in src/lib/diversity.ts (pure, checked by check:diversity);
 * this component only formats and explains applicability. Honest-boundary
 * rule: an estimator that does not apply to the plot's data says WHY instead
 * of showing a wrong number.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import {
  chao1,
  chao2,
  computeDiversity,
  relativeFrequency,
  speciesKey,
  type DiversityRecord,
} from '~/lib/diversity';
import { ScientificName } from './ScientificName';
import { useSettings } from '~/stores/settings';

/** Records as the species tab holds them — the name fields ride along so the
 *  dominance list can print a species instead of a key. */
type NamedRecord = DiversityRecord & {
  simple_name?: string;
  common_name_c?: string;
  kingdom?: string;
};

type Props = {
  /** Every species record of the plot (all layers / all subplots). */
  allRecords: NamedRecord[];
  /** Records scoped to the active subplot (= allRecords when no subplots). */
  subplotRecords: NamedRecord[];
  subplotMode: boolean;
  subplotIds: number[];
  activeSubplotLabel: string | null;
};

const fmt = (v: number | null, digits = 2): string => (v == null ? '–' : v.toFixed(digits));
const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function PlotDiversityCard({
  allRecords,
  subplotRecords,
  subplotMode,
  subplotIds,
  activeSubplotLabel,
}: Props) {
  const { t } = useTranslation();
  const expanded = useSettings((s) => s.plot_stats_expanded);
  const setSetting = useSettings((s) => s.set);

  const whole = useMemo(() => computeDiversity(allRecords), [allRecords]);
  const c1 = useMemo(() => chao1(allRecords), [allRecords]);
  const c2 = useMemo(() => chao2(allRecords, subplotIds), [allRecords, subplotIds]);
  const sub = useMemo(
    () => (subplotMode ? computeDiversity(subplotRecords) : null),
    [subplotMode, subplotRecords],
  );
  // key → display name, built from the same records the maths ran on.
  const labels = useMemo(() => {
    const m = new Map<string, { cname: string; sci: string; kingdom: string }>();
    for (const r of allRecords) {
      const k = speciesKey(r);
      if (!m.has(k)) {
        m.set(k, {
          cname: r.common_name_c ?? '',
          sci: r.used_scientific_name || r.simple_name || r.taxon_id,
          kingdom: r.kingdom ?? '',
        });
      }
    }
    return m;
  }, [allRecords]);
  const freq = useMemo(
    () => relativeFrequency(allRecords, subplotIds),
    [allRecords, subplotIds],
  );

  if (whole.richness === 0) return null;

  // The best available effort figure for the collapsed one-liner: Chao
  // completeness when either estimator applies, else Chao1's coverage never
  // exists without Chao1 — so nothing.
  const completeness = c1.applicable ? c1.completeness : c2.applicable ? c2.completeness : null;

  return (
    <View className="border-b border-gray-100 dark:border-gray-800 bg-emerald-50/60 dark:bg-emerald-950/20">
      <Pressable
        onPress={() => setSetting('plot_stats_expanded', !expanded)}
        className="flex-row items-center px-4 py-2 active:bg-emerald-100/60 dark:active:bg-emerald-900/30"
        accessibilityLabel={t('plotStats.title')}
      >
        <Ionicons name="stats-chart-outline" size={14} color="#059669" />
        <Text className="ml-2 flex-1 text-xs text-emerald-900 dark:text-emerald-200" numberOfLines={1}>
          {`S ${whole.richness} · H′ ${fmt(whole.shannonH)}`}
          {completeness != null ? ` · ${t('plotStats.completenessShort', { pct: pct(completeness) })}` : ''}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#059669" />
      </Pressable>

      {expanded ? (
        <View className="px-4 pb-3">
          <Text className="text-[11px] font-semibold uppercase text-emerald-800 dark:text-emerald-300">
            {t('plotStats.wholePlot')}
          </Text>
          <Row label={t('plotStats.richness')} value={String(whole.richness)} />
          <Row
            label={t('plotStats.shannon')}
            value={fmt(whole.shannonH)}
            extra={whole.shannonDiversity != null ? t('plotStats.effective', { n: fmt(whole.shannonDiversity, 1) }) : undefined}
          />
          <Row
            label={t('plotStats.simpson')}
            value={fmt(whole.simpson1mD)}
            extra={whole.invSimpson != null ? t('plotStats.effective', { n: fmt(whole.invSimpson, 1) }) : undefined}
          />
          {whole.pielouJ != null ? (
            <Row label={t('plotStats.evenness')} value={fmt(whole.pielouJ)} />
          ) : null}
          {whole.bergerParker != null ? (
            <Row
              label={t('plotStats.bergerParker')}
              value={fmt(whole.bergerParker)}
              extra={t('plotStats.hillInf', { n: fmt(1 / whole.bergerParker, 1) })}
            />
          ) : null}

          {whole.dominants.length > 0 ? (
            <>
              <Text className="mt-2 text-[11px] font-semibold uppercase text-emerald-800 dark:text-emerald-300">
                {t('plotStats.dominantSpecies')}
              </Text>
              {whole.dominants.slice(0, 3).map((d, i) => {
                const label = labels.get(d.key);
                const f = freq.get(d.key);
                return (
                  <View key={d.key} className="mt-1 flex-row items-baseline">
                    <Text className="w-4 text-[11px] text-gray-500 dark:text-gray-400">{i + 1}.</Text>
                    <View className="flex-1">
                      <Text className="text-xs text-gray-900 dark:text-gray-100" numberOfLines={1}>
                        {label?.cname ? `${label.cname} ` : ''}
                        <ScientificName name={label?.sci ?? d.key} kingdom={label?.kingdom} />
                      </Text>
                    </View>
                    <Text
                      className="ml-2 text-xs font-medium text-gray-900 dark:text-gray-100"
                      style={{ fontVariant: ['tabular-nums'] }}
                    >
                      {pct(d.share)}
                    </Text>
                    {f != null ? (
                      <Text className="ml-2 text-[11px] text-gray-500 dark:text-gray-400" style={{ fontVariant: ['tabular-nums'] }}>
                        {t('plotStats.freqShort', { pct: pct(f) })}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              <Text className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                {freq.size > 0 ? t('plotStats.dominantNoteFreq') : t('plotStats.dominantNote')}
              </Text>
            </>
          ) : null}

          {c1.applicable ? (
            <>
              <Row
                label={`Chao1${c1.biasCorrected ? t('plotStats.biasCorrected') : ''}`}
                value={t('plotStats.estimateGte', { n: fmt(c1.estimate, 1) })}
                extra={t('plotStats.completeness', { pct: pct(c1.completeness) })}
              />
              <Row label={t('plotStats.coverage')} value={pct(c1.coverage)} />
            </>
          ) : c2.applicable ? (
            <Row
              label={`Chao2${c2.biasCorrected ? t('plotStats.biasCorrected') : ''}`}
              value={t('plotStats.estimateGte', { n: fmt(c2.estimate, 1) })}
              extra={t('plotStats.completeness', { pct: pct(c2.completeness) })}
            />
          ) : (
            <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {subplotIds.length >= 2 || subplotMode
                ? t('plotStats.chaoNone')
                : t('plotStats.chaoNeedsData')}
            </Text>
          )}

          {sub ? (
            <>
              <Text className="mt-2 text-[11px] font-semibold uppercase text-emerald-800 dark:text-emerald-300">
                {t('plotStats.currentSubplot', { label: activeSubplotLabel ?? '' })}
              </Text>
              <Row label={t('plotStats.richness')} value={String(sub.richness)} />
              <Row label={t('plotStats.shannon')} value={fmt(sub.shannonH)} />
              <Row label={t('plotStats.simpson')} value={fmt(sub.simpson1mD)} />
              {sub.pielouJ != null ? (
                <Row label={t('plotStats.evenness')} value={fmt(sub.pielouJ)} />
              ) : null}
            </>
          ) : null}

          <Text className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
            {t(`plotStats.basis.${whole.basis}`)}
            {whole.lossy ? ` ${t('plotStats.lossyNote')}` : ''} {t('plotStats.lowerBoundNote')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Row({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <View className="mt-1 flex-row items-baseline">
      <Text className="w-28 text-xs text-gray-600 dark:text-gray-400">{label}</Text>
      <Text className="text-xs font-medium text-gray-900 dark:text-gray-100" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      {extra ? (
        <Text className="ml-2 text-[11px] text-gray-500 dark:text-gray-400">{extra}</Text>
      ) : null}
    </View>
  );
}
