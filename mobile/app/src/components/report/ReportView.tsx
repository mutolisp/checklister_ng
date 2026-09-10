/**
 * Renders a `Report` on screen. One of three renderers over the same model
 * (the others produce HTML and DOCX), so this file formats and lays out but
 * never computes — every number arrives already decided.
 */
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Report, ReportSection, ReportTable } from '~/lib/reportTypes';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { compareCells, type SortState } from '~/lib/reportSort';
import { RichCell } from './RichCell';
import { ReportChartView } from './charts';

export function ReportView({ report }: { report: Report }) {
  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950" contentContainerClassName="pb-12">
      <View className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-4">
        <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">{report.title}</Text>
        {report.subtitle ? (
          <Text className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{report.subtitle}</Text>
        ) : null}
        <Text className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          {report.generatedAt}
        </Text>
      </View>

      {report.sections.map((s) => (
        <SectionView key={s.id} section={s} />
      ))}
    </ScrollView>
  );
}

function SectionView({ section }: { section: ReportSection }) {
  return (
    <View className="mt-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <Text className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
        {section.heading}
      </Text>

      {section.paras?.map((p, i) => (
        <Text key={i} className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          {p}
        </Text>
      ))}

      {section.meta ? (
        <View className="mt-2">
          {section.meta.map((m) => (
            <View key={m.key} className="mt-0.5 flex-row items-baseline">
              <Text className="w-28 text-xs text-gray-500 dark:text-gray-400">{m.key}</Text>
              <Text className="flex-1 text-xs text-gray-900 dark:text-gray-100">{m.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {section.chart ? <ReportChartView chart={section.chart} /> : null}

      {section.table ? <TableView table={section.table} /> : null}

      {section.note ? (
        <Text className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">{section.note}</Text>
      ) : null}
    </View>
  );
}

/**
 * Wide tables (the species list is seven columns) scroll horizontally rather
 * than wrapping into an unreadable stack — the page itself must never scroll
 * sideways.
 *
 * Two things stay put while you scroll, because without them a wide table on a
 * phone is unreadable:
 *   - the FIRST COLUMN, which carries the plot or species name. Scroll right
 *     without it and the numbers lose their subject.
 *   - the HEADER ROW, for tables long enough to need their own vertical
 *     scroll. Scroll down without it and the columns lose their meaning.
 *
 * Row heights are fixed rather than measured, which is what lets the frozen
 * column and the scrolling columns stay in lockstep with no measurement pass:
 * the two halves are separate view trees, so anything height-dependent would
 * drift. Cells clamp to two lines for the same reason.
 */
const ROW_H = 30;
/** An expanded row's height. Fixed rather than measured for the same reason
 *  the collapsed height is: the frozen column and the scrolling columns are
 *  separate view trees, so anything content-dependent drifts apart. */
const ROW_H_OPEN = 30 * 3;
const HEAD_H = 28;
/** Beyond this many rows the body gets its own vertical scroll so the header
 *  can be pinned above it. Shorter tables stay inline — nesting a scroll view
 *  inside the page scroll is worth it only when it buys something. */
const LONG_TABLE_ROWS = 12;
const BODY_MAX_H = 12 * ROW_H;

function TableView({ table }: { table: ReportTable }) {
  const { t } = useTranslation();
  const alignOf = (i: number) => (table.align?.[i] === 'right' ? 'text-right' : 'text-left');
  const wide = table.columns.length > 3;
  const long = table.rows.length > LONG_TABLE_ROWS;
  const [sort, setSort] = useState<SortState>(null);
  // Long names are clamped to two lines so the grid stays readable, which
  // means a name can be cut off — and a cut-off scientific name tells the
  // reader nothing. Tapping a row opens it to full height.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggleRow = (i: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const totals = table.totalRows ?? 0;
  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const body = totals > 0 ? table.rows.slice(0, -totals) : table.rows;
    const tail = totals > 0 ? table.rows.slice(-totals) : [];
    const sorted = [...body].sort((a, b) =>
      compareCells(a[sort.col] ?? '', b[sort.col] ?? '', sort.dir),
    );
    return [...sorted, ...tail];
  }, [table.rows, sort, totals]);

  // First tap sorts descending: on a report table the interesting end is
  // almost always the largest value (top importance, most stems), so
  // descending is one tap rather than two.
  const toggle = (col: number) =>
    setSort((cur) =>
      cur?.col === col ? (cur.dir === 'desc' ? { col, dir: 'asc' } : null) : { col, dir: 'desc' },
    );
  // The frozen column is driven FROM the scrolling body, never the other way,
  // so there is no feedback loop to guard against.
  const frozenRef = useRef<ScrollView>(null);

  const headCell = (c: string, i: number, w?: number) => {
    const active = sort?.col === i;
    return (
      <Pressable
        key={c + i}
        onPress={() => toggle(i)}
        accessibilityRole="button"
        accessibilityLabel={c}
        accessibilityHint={t('report.sortHint')}
        className={`flex-row items-center px-1 ${
          table.align?.[i] === 'right' ? 'justify-end' : 'justify-start'
        }`}
        style={w != null ? { width: w } : { flex: 1 }}
      >
        <Text
          numberOfLines={2}
          className={`shrink text-[11px] font-semibold ${alignOf(i)} ${
            active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          {c}
        </Text>
        {active ? (
          <Ionicons
            name={sort.dir === 'desc' ? 'arrow-down' : 'arrow-up'}
            size={10}
            color="#2563eb"
            style={{ marginLeft: 2 }}
          />
        ) : null}
      </Pressable>
    );
  };

  const bodyCell = (v: string, i: number, w?: number, expanded = false) => (
    <RichCell
      key={i}
      text={v}
      numberOfLines={expanded ? 8 : 2}
      className={`px-1 text-xs text-gray-800 dark:text-gray-200 ${alignOf(i)}`}
      style={w != null ? { width: w } : { flex: 1 }}
    />
  );

  if (!wide) {
    return (
      <View className="mt-2">
        <View className="flex-row border-b border-gray-200 dark:border-gray-700 py-1">
          {table.columns.map((c, i) => headCell(c, i))}
        </View>
        {rows.map((r, ri) => (
          <Pressable
            key={ri}
            onPress={() => toggleRow(ri)}
            accessibilityRole="button"
            accessibilityHint={t('report.expandHint')}
            className="flex-row border-b border-gray-50 dark:border-gray-800/60 py-1"
          >
            {r.map((cell, ci) => bodyCell(cell, ci, undefined, open.has(ri)))}
          </Pressable>
        ))}
      </View>
    );
  }

  const frozenW = colWidth(0, table);
  const restCols = table.columns.slice(1);
  // Both halves compute the height the same way from the same state, which is
  // what keeps them in lockstep when a row is opened.
  const rowStyle = (ri: number) => ({
    height: open.has(ri) ? ROW_H_OPEN : ROW_H,
    alignItems: 'center' as const,
  });

  return (
    <View className="mt-2 flex-row">
      {/* Frozen first column: header cell in the corner, body scrolled to
          match the right-hand side. */}
      <View style={{ width: frozenW }} className="border-r border-gray-200 dark:border-gray-700">
        <View
          style={{ height: HEAD_H }}
          className="flex-row items-center border-b border-gray-200 dark:border-gray-700"
        >
          {headCell(table.columns[0], 0, frozenW)}
        </View>
        <ScrollView
          ref={frozenRef}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          style={long ? { maxHeight: BODY_MAX_H } : undefined}
        >
          {rows.map((r, ri) => (
            <Pressable
              key={ri}
              onPress={() => toggleRow(ri)}
              accessibilityRole="button"
              accessibilityHint={t('report.expandHint')}
              style={rowStyle(ri)}
              className="flex-row border-b border-gray-50 dark:border-gray-800/60"
            >
              {bodyCell(r[0], 0, frozenW, open.has(ri))}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View
            style={{ height: HEAD_H }}
            className="flex-row items-center border-b border-gray-200 dark:border-gray-700"
          >
            {restCols.map((c, i) => headCell(c, i + 1, colWidth(i + 1, table)))}
          </View>
          <ScrollView
            scrollEnabled={long}
            onScroll={(e) =>
              frozenRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false })
            }
            scrollEventThrottle={16}
            style={long ? { maxHeight: BODY_MAX_H } : undefined}
          >
            {rows.map((r, ri) => (
              <Pressable
                key={ri}
                onPress={() => toggleRow(ri)}
                accessibilityRole="button"
                accessibilityHint={t('report.expandHint')}
                style={rowStyle(ri)}
                className="flex-row border-b border-gray-50 dark:border-gray-800/60"
              >
                {r
                  .slice(1)
                  .map((cell, ci) =>
                    bodyCell(cell, ci + 1, colWidth(ci + 1, table), open.has(ri)),
                  )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

/** Fixed widths for the wide (horizontally scrolled) case: the first column
 *  carries names and gets the room; the rest are short values. */
function colWidth(i: number, table: ReportTable): number {
  if (i === 0) return 150;
  return table.align?.[i] === 'right' ? 70 : 90;
}
