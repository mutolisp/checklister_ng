/**
 * Line chart — `kind: 'line'`, for species-accumulation curves (with their
 * confidence band) and rank-abundance plots (with a log value axis).
 *
 * Geometry is `react-native-svg`; every label is an RN `<Text>` positioned
 * around the plot, never inside the SVG. The app bundles no font files, so a
 * CJK label inside an SVG `<Text>` renders as tofu — the same rule the bar and
 * column charts follow, and it does not relax just because a polyline needs
 * real coordinates.
 */
import React, { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { useThemeColors } from '~/hooks/useThemeColors';
import { CHART_TRACK, CHART_TRACK_DARK, seriesColor, withHash } from '~/lib/reportTheme';
import type { XYChart } from '~/lib/reportTypes';

const PLOT_H = 180;

export function LineChartSvg({ chart }: { chart: XYChart }) {
  const { scheme } = useThemeColors();
  const axis = scheme === 'dark' ? withHash(CHART_TRACK_DARK) : withHash(CHART_TRACK);
  // Width comes from layout rather than a guess, so the curve fills whatever
  // the section gives it on any screen.
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const pts = chart.series.flatMap((s) => s.points);
  if (pts.length === 0) return null;

  const log = chart.yAxis.scale === 'log10';
  const tf = (v: number) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  const xs = pts.map((p) => p.x);
  const bandVals = chart.series.flatMap((s) => s.band?.flatMap((b) => [b.lo, b.hi]) ?? []);
  const ys = [...pts.map((p) => p.y), ...bandVals].filter((v) => Number.isFinite(v));
  const xMin = chart.xAxis.min ?? Math.min(...xs);
  const xMax = chart.xAxis.max ?? Math.max(...xs);
  const yLo = chart.yAxis.min ?? (log ? Math.min(...ys.filter((v) => v > 0)) : 0);
  const yHi = chart.yAxis.max ?? Math.max(...ys);
  const sx = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * Math.max(1, w);
  const sy = (y: number) =>
    PLOT_H - ((tf(y) - tf(yLo)) / (tf(yHi) - tf(yLo) || 1)) * PLOT_H;

  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <View className="mt-2">
      <Text className="text-xs font-semibold text-gray-700 dark:text-gray-300">
        {chart.title}
        {chart.unit ? <Text className="font-normal text-gray-500"> ({chart.unit})</Text> : null}
      </Text>

      {chart.series.length > 1 ? (
        <View className="mt-1 flex-row flex-wrap items-center gap-3">
          {chart.series.map((s, i) => (
            <View key={s.label} className="flex-row items-center">
              <View
                className="mr-1 h-0.5 w-3"
                style={{ backgroundColor: withHash(seriesColor(i)) }}
              />
              <Text className="text-[11px] text-gray-500 dark:text-gray-400">{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-1 flex-row">
        {/* y-axis labels live outside the SVG. */}
        <View style={{ height: PLOT_H }} className="mr-1 justify-between">
          <Text className="text-[10px] text-gray-500 dark:text-gray-400">{fmt(yHi)}</Text>
          <Text className="text-[10px] text-gray-500 dark:text-gray-400">{fmt(yLo)}</Text>
        </View>
        <View
          onLayout={onLayout}
          style={{
            height: PLOT_H,
            borderLeftWidth: 1,
            borderBottomWidth: 1,
            borderColor: axis,
          }}
          className="flex-1"
          // The axis rules follow the theme, so their colour is a runtime
          // value rather than a Tailwind class.
        >
          {w > 0 ? (
            <Svg width="100%" height={PLOT_H}>
              {chart.series.map((s, i) => {
                const col = withHash(seriesColor(i));
                const valid = s.points.filter(
                  (p) => Number.isFinite(p.y) && (!log || p.y > 0),
                );
                const line = valid.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
                const band =
                  s.band && s.band.length === s.points.length
                    ? s.points.map((p, j) => `${sx(p.x)},${sy(s.band![j].hi)}`).join(' ') +
                      ' ' +
                      [...s.points]
                        .map((p, j) => ({ p, j }))
                        .reverse()
                        .map(({ p, j }) => `${sx(p.x)},${sy(s.band![j].lo)}`)
                        .join(' ')
                    : null;
                return (
                  <React.Fragment key={s.label}>
                    {band ? <Polygon points={band} fill={col} fillOpacity={0.15} /> : null}
                    <Polyline points={line} fill="none" stroke={col} strokeWidth={2} />
                  </React.Fragment>
                );
              })}
            </Svg>
          ) : null}
        </View>
      </View>

      <View className="ml-6 mt-0.5 flex-row justify-between">
        <Text className="text-[10px] text-gray-500 dark:text-gray-400">{fmt(xMin)}</Text>
        {chart.xAxis.title ? (
          <Text className="text-[10px] text-gray-500 dark:text-gray-400">{chart.xAxis.title}</Text>
        ) : null}
        <Text className="text-[10px] text-gray-500 dark:text-gray-400">{fmt(xMax)}</Text>
      </View>

      {chart.note ? (
        <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{chart.note}</Text>
      ) : null}
    </View>
  );
}
