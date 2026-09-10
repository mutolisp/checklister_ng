/**
 * Vertical column chart — `kind: 'column'`, for ORDERED numeric bins.
 *
 * Diameter classes are the reason this exists: the shape of the distribution
 * is the finding (a reverse-J means the stand is regenerating), and a shape is
 * only readable when the classes run left to right in order.
 *
 * Same font discipline as the horizontal chart: bars are `react-native-svg`,
 * every label is an RN `<Text>` outside the SVG, because the app bundles no
 * fonts and CJK inside an SVG `<Text>` renders as tofu.
 */
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useThemeColors } from '~/hooks/useThemeColors';
import { CHART_PRIMARY, CHART_TRACK, CHART_TRACK_DARK, withHash } from '~/lib/reportTheme';
import type { CategoricalChart } from '~/lib/reportTypes';
import { RichCell } from '../RichCell';

const PLOT_H = 120;
const FILL = withHash(CHART_PRIMARY);

export function ColumnChartSvg({ chart }: { chart: CategoricalChart }) {
  const { scheme } = useThemeColors();
  const baseline = scheme === 'dark' ? withHash(CHART_TRACK_DARK) : withHash(CHART_TRACK);
  if (chart.rows.length === 0) return null;
  const max = chart.max ?? Math.max(...chart.rows.map((r) => r.value), 1);

  return (
    <View className="mt-2">
      <Text className="text-xs font-semibold text-gray-700 dark:text-gray-300">
        {chart.title}
        {chart.unit ? <Text className="font-normal text-gray-500"> ({chart.unit})</Text> : null}
      </Text>

      <View className="mt-2 flex-row items-end" style={{ height: PLOT_H + 4 }}>
        {chart.rows.map((row, i) => {
          const frac = max > 0 && Number.isFinite(row.value) ? row.value / max : 0;
          const h = Math.max(0, Math.min(1, frac)) * PLOT_H;
          return (
            <View key={`${row.label}-${i}`} className="flex-1 items-center justify-end px-px">
              <Svg width="100%" height={PLOT_H + 1} accessibilityLabel={`${row.label} ${row.value}`}>
                {/* Baseline, so empty classes still read as a class rather
                    than as a gap in the axis. */}
                <Rect x={0} y={PLOT_H} width="100%" height={1} fill={baseline} />
                <Rect x={0} y={PLOT_H - h} width="100%" height={h} rx={2} fill={FILL} />
              </Svg>
            </View>
          );
        })}
      </View>

      {/* Values and class labels, in RN text under their column. */}
      <View className="flex-row">
        {chart.rows.map((row, i) => (
          <View key={`lbl-${row.label}-${i}`} className="flex-1 items-center px-px">
            <Text
              className="text-[10px] text-gray-900 dark:text-gray-100"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {Number.isInteger(row.value) ? row.value : row.value.toFixed(1)}
            </Text>
            <RichCell
              text={row.label}
              numberOfLines={2}
              className="text-center text-[9px] text-gray-500 dark:text-gray-400"
            />
          </View>
        ))}
      </View>

      {chart.categoryAxisTitle ? (
        <Text className="mt-0.5 text-center text-[10px] text-gray-500 dark:text-gray-400">
          {chart.categoryAxisTitle}
        </Text>
      ) : null}
      {chart.note ? (
        <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{chart.note}</Text>
      ) : null}
    </View>
  );
}
