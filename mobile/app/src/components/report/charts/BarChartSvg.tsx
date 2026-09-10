/**
 * Horizontal bar chart — `kind: 'bar'`, a labelled bar list. Vertical bins go
 * to `ColumnChartSvg`.
 *
 * Colours come from `reportTheme.ts`, not from literals here — the three
 * renderers had already drifted apart once.
 *
 * The bars are `react-native-svg`; the LABELS are deliberately plain RN
 * `<Text>` outside the SVG. The app bundles no font files, so CJK inside an
 * SVG `<Text>` renders as tofu on both platforms — keeping text in the RN
 * layer lets the OS supply the font, which is also why the exported HTML uses
 * CSS bars rather than SVG.
 */
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useThemeColors } from '~/hooks/useThemeColors';
import {
  CHART_PRIMARY,
  CHART_SECONDARY,
  CHART_TRACK,
  CHART_TRACK_DARK,
  withHash,
} from '~/lib/reportTheme';
import type { CategoricalChart } from '~/lib/reportTypes';
import { RichCell } from '../RichCell';

const BAR_H = 14;
const TRACK = withHash(CHART_TRACK);
const TRACK_DARK = withHash(CHART_TRACK_DARK);
const FILL = withHash(CHART_PRIMARY);
const FILL2 = withHash(CHART_SECONDARY);

export function BarChartSvg({ chart }: { chart: CategoricalChart }) {
  const { t } = useTranslation();
  // The bar track is an SVG fill, i.e. a string colour — exactly the case
  // `useThemeColors` exists for.
  const { scheme } = useThemeColors();
  const dark = scheme === 'dark';
  if (chart.rows.length === 0) return null;
  const max =
    chart.max ??
    Math.max(...chart.rows.map((r) => Math.max(r.value, r.value2 ?? 0)), 1);

  return (
    <View className="mt-2">
      <Text className="text-xs font-semibold text-gray-700 dark:text-gray-300">
        {chart.title}
        {chart.unit ? <Text className="font-normal text-gray-500"> ({chart.unit})</Text> : null}
      </Text>

      {chart.seriesLabels ? (
        <View className="mt-1 flex-row items-center gap-3">
          {chart.seriesLabels.map((label, i) => (
            <View key={label} className="flex-row items-center">
              <View
                className="mr-1 h-2 w-2 rounded-sm"
                style={{ backgroundColor: i === 0 ? FILL : FILL2 }}
              />
              <Text className="text-[11px] text-gray-500 dark:text-gray-400">{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-1.5">
        {chart.rows.map((row, i) => {
          // value2 (e.g. a Chao estimate) is drawn as the longer, paler bar
          // BEHIND value, so "how much is still missing" reads as the gap.
          const back = row.value2 != null ? Math.max(row.value, row.value2) : row.value;
          return (
            <View key={`${row.label}-${i}`} className="mb-1.5">
              <View className="flex-row items-baseline">
                <RichCell
                  text={row.label}
                  numberOfLines={1}
                  className="flex-1 pr-2 text-xs text-gray-800 dark:text-gray-200"
                />
                <Text
                  className="text-xs font-medium text-gray-900 dark:text-gray-100"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatValue(row.value)}
                  {row.value2 != null ? ` / ${formatValue(row.value2)}` : ''}
                </Text>
                {row.note ? (
                  <Text className="ml-2 text-[11px] text-gray-500 dark:text-gray-400">
                    {row.note}
                  </Text>
                ) : null}
              </View>
              {/* Width in percent so the SVG fills whatever the row is given —
                  react-native-svg accepts percentage geometry. */}
              <Svg width="100%" height={BAR_H} accessibilityLabel={`${row.label} ${row.value}`}>
                <Rect
                  x={0}
                  y={3}
                  width="100%"
                  height={BAR_H - 6}
                  rx={3}
                  fill={dark ? TRACK_DARK : TRACK}
                />
                {row.value2 != null ? (
                  <Rect
                    x={0}
                    y={3}
                    width={`${clampPct(back, max)}%`}
                    height={BAR_H - 6}
                    rx={3}
                    fill={FILL2}
                  />
                ) : null}
                <Rect
                  x={0}
                  y={3}
                  width={`${clampPct(row.value, max)}%`}
                  height={BAR_H - 6}
                  rx={3}
                  fill={FILL}
                />
              </Svg>
            </View>
          );
        })}
      </View>

      {chart.note ? (
        <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{chart.note}</Text>
      ) : null}

      {chart.max != null && chart.rows.every((r) => r.value === 0) ? (
        <Text className="text-[11px] text-gray-500 dark:text-gray-400">
          {t('report.chartNoData')}
        </Text>
      ) : null}
    </View>
  );
}

function clampPct(v: number, max: number): number {
  if (!Number.isFinite(v) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (v / max) * 100));
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
