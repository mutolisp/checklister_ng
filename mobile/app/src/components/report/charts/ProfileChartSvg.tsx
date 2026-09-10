/**
 * Vertical vegetation profile — `kind: 'profile'`.
 *
 * Each stratum is drawn at its real height on a metre axis, so the SPACING
 * between bands carries information: a 15 m canopy sits three times as high as
 * a 5 m shrub layer instead of one evenly-spaced category above it. That is
 * the whole reason this is not a bar chart.
 *
 * Absolutely-positioned `<View>`s rather than SVG: the bands are plain
 * rectangles, and every label is CJK text the app has no bundled font for.
 */
import { Text, View } from 'react-native';
import { useThemeColors } from '~/hooks/useThemeColors';
import { CHART_PRIMARY, CHART_TRACK, CHART_TRACK_DARK, withHash } from '~/lib/reportTheme';
import type { ProfileChart } from '~/lib/reportTypes';
import { RichCell } from '../RichCell';

const PLOT_H = 200;

export function ProfileChartSvg({ chart }: { chart: ProfileChart }) {
  const { scheme } = useThemeColors();
  const axis = scheme === 'dark' ? withHash(CHART_TRACK_DARK) : withHash(CHART_TRACK);
  if (chart.bands.length === 0) return null;

  const top = Math.max(...chart.bands.map((b) => b.y1), 0.1);
  const max = chart.max ?? 100;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <View className="mt-2">
      <Text className="text-xs font-semibold text-gray-700 dark:text-gray-300">
        {chart.title}
        {chart.unit ? <Text className="font-normal text-gray-500"> ({chart.unit})</Text> : null}
      </Text>

      <View className="mt-1 flex-row">
        <View style={{ height: PLOT_H }} className="mr-1 justify-between">
          <Text className="text-[10px] text-gray-500 dark:text-gray-400">{fmt(top)}</Text>
          <Text className="text-[10px] text-gray-500 dark:text-gray-400">0</Text>
        </View>
        <View
          style={{ height: PLOT_H, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: axis }}
          className="flex-1"
        >
          {chart.bands.map((b, i) => {
            const bottom = (b.y0 / top) * PLOT_H;
            const height = Math.max(2, ((b.y1 - b.y0) / top) * PLOT_H);
            const width = `${Math.max(0, Math.min(100, (b.value / max) * 100))}%` as const;
            return (
              <View
                key={`${b.label}-${i}`}
                style={{ position: 'absolute', left: 0, right: 0, bottom, height }}
                className="flex-row items-center"
              >
                <View
                  style={{ width, height: '70%', backgroundColor: withHash(CHART_PRIMARY) }}
                  className="rounded-r-sm"
                />
                <RichCell
                  text={b.note ? `${b.label} ${b.note}` : b.label}
                  numberOfLines={1}
                  className="ml-1 flex-shrink text-[10px] text-gray-700 dark:text-gray-300"
                />
              </View>
            );
          })}
        </View>
      </View>

      {chart.heightAxisTitle ? (
        <Text className="ml-6 mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
          {chart.heightAxisTitle}
        </Text>
      ) : null}
      {chart.note ? (
        <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{chart.note}</Text>
      ) : null}
    </View>
  );
}
