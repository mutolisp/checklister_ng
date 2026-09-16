/**
 * 調查記錄的兩種畫法 —— the rounded list row and the 2-up grid card.
 *
 * Shared by the records tab (`app/(tabs)/index.tsx`) and the project detail
 * screen (`app/project/[id].tsx`) so the two never drift apart; the project
 * screen previously carried its own thinner copy of the row.
 *
 * Both draw the SAME `RecordItem`, and both honour `card_density`. The card is
 * not a reduced row — it drops the subtitle and the full diversity line and
 * keeps only what survives at half width: title, time, 種數, and where it
 * belongs.
 *
 * `RowDiversityLine` reads one record's species off the DB, so it is deferred
 * off the mount frame and memoised per record (see the cache note below). The
 * card view shows roughly twice as many records per screen as the list, which
 * is why the card asks for the richness ONLY — same cache entry either way, so
 * switching layout never re-reads what has already been computed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { listPlotSpecies, listSessionRecords, type RecordItem, type RecordKind } from '~/db';
import { isoDateTime } from '~/lib/datetime';
import { computeDiversity } from '~/lib/diversity';
import { useSettings } from '~/stores/settings';

/**
 * Per-row S / H′ / J′ cache.
 *
 * Module-level and cleared by the screens' `reload()`, so a record edited
 * elsewhere recomputes on the next focus rather than showing a stale richness.
 */
const rowDivCache = new Map<string, { s: number; h: number | null; j: number | null } | null>();

export function clearRecordDiversityCache(): void {
  rowDivCache.clear();
}

export function KindIcon({
  kind,
  active,
  size = 'md',
}: {
  kind: RecordKind;
  active: boolean;
  /** `sm` is the card footer / list trailing badge; `md` the leading tile. */
  size?: 'sm' | 'md';
}) {
  const tint = active ? '#10b981' : '#94a3b8';
  const bg = active ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-gray-100 dark:bg-gray-800';
  const iconName =
    kind === 'session' ? 'list' : kind === 'collection' ? 'leaf-outline' : 'grid-outline';
  const box = size === 'sm' ? 'h-7 w-7' : 'h-10 w-10';
  return (
    <View className={`items-center justify-center rounded-lg ${box} ${bg}`}>
      <Ionicons name={iconName as never} size={size === 'sm' ? 15 : 20} color={tint} />
    </View>
  );
}

export function SelectCheckbox({ checked }: { checked: boolean }) {
  return (
    <View
      className={`h-6 w-6 items-center justify-center rounded-full ${checked ? 'bg-blue-500' : 'border-2 border-gray-300 dark:border-gray-600'}`}
    >
      {checked ? <Ionicons name="checkmark" size={14} color="white" /> : null}
    </View>
  );
}

/** 加星號 toggle. `onToggle` omitted ⇒ the star is shown but inert (read-only
 *  surfaces); pass it wherever the user may actually star. */
export function StarButton({
  starred,
  onToggle,
  size = 22,
}: {
  starred: boolean;
  onToggle?: () => void;
  size?: number;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onToggle}
      disabled={!onToggle}
      // Generous hit area: the icon is small and sits next to the row's own
      // press target, so a near miss must not open the record.
      hitSlop={10}
      accessibilityRole="button"
      accessibilityState={{ selected: starred }}
      accessibilityLabel={t(starred ? 'records.unstar' : 'records.star')}
      className="active:opacity-60"
    >
      <Ionicons
        name={starred ? 'star' : 'star-outline'}
        size={size}
        color={starred ? '#f59e0b' : '#d1d5db'}
      />
    </Pressable>
  );
}

/**
 * S / H′ / Pielou J′ for one record, or just the richness in `richness` mode.
 *
 * Renders nothing until the numbers are in, and nothing at all for 採集 (a
 * specimen series is not a sample whose evenness means anything) or for an
 * empty record.
 */
export function RowDiversityLine({
  kind,
  id,
  variant = 'full',
}: {
  kind: RecordKind;
  id: number;
  variant?: 'full' | 'richness';
}) {
  const { t } = useTranslation();
  const key = `${kind}-${id}`;
  const [val, setVal] = useState(() => rowDivCache.get(key) ?? null);

  useEffect(() => {
    const cached = rowDivCache.get(key);
    if (cached !== undefined) {
      setVal(cached);
      return;
    }
    if (kind === 'collection') {
      rowDivCache.set(key, null);
      setVal(null);
      return;
    }
    // Off the mount frame: this is one DB read per record and the records tab
    // is perf-tuned to keep reload() off the critical path.
    const timer = setTimeout(() => {
      let v: { s: number; h: number | null; j: number | null } | null = null;
      try {
        const rows = kind === 'plot' ? listPlotSpecies(id) : listSessionRecords(id);
        const d = computeDiversity(
          rows.map((r) => ({
            taxon_id: r.taxon_id,
            used_scientific_name: r.used_scientific_name,
            organism_quantity: r.organism_quantity,
            organism_quantity_type: r.organism_quantity_type,
          })),
        );
        if (d.richness > 0) v = { s: d.richness, h: d.shannonH, j: d.pielouJ };
      } catch {
        /* row stays without the line */
      }
      rowDivCache.set(key, v);
      setVal(v);
    }, 0);
    return () => clearTimeout(timer);
  }, [key, kind, id]);

  if (!val) return null;
  if (variant === 'richness') {
    return (
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('plotStats.sppCount', { count: val.s })}
      </Text>
    );
  }
  return (
    <Text
      className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400"
      style={{ fontVariant: ['tabular-nums'] }}
    >
      {`S:${val.s}`}
      {val.h != null ? `, H′:${val.h.toFixed(2)}` : ''}
      {val.j != null ? `, Pielou J′:${val.j.toFixed(2)}` : ''}
    </Text>
  );
}

function StatusBadges({ item }: { item: RecordItem }) {
  const { t } = useTranslation();
  return (
    <>
      {item.active ? (
        <View className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 dark:bg-emerald-900/60">
          <Text className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            {item.kind === 'session' ? t('records.recording') : t('records.inProgress')}
          </Text>
        </View>
      ) : null}
      {item.notReady ? (
        <View className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/60">
          <Text className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
            {t('records.notReady')}
          </Text>
        </View>
      ) : null}
    </>
  );
}

type CommonProps = {
  item: RecordItem;
  /** Hide the project name — the group header above already says it. */
  showProject: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  /** Omit to make the star inert (e.g. a screen with no write path). */
  onToggleStar?: () => void;
};

/**
 * One record per row.
 *
 * The caller owns the rounded container and the outer margin — they have to
 * sit OUTSIDE `SwipeRowActions`, or the revealed 刪除 panel keeps square
 * corners and runs to the screen edge while the card in front of it is inset.
 */
export function RecordListRow({
  item,
  showProject,
  onPress,
  onLongPress,
  selectMode = false,
  selected = false,
  onToggleStar,
}: CommonProps) {
  const compact = useSettings((s) => s.card_density) === 'compact';
  // An auto-named session IS its own start time; printing both is just the
  // same string twice.
  const titleIsTime = Boolean(
    item.kind === 'session' &&
    item.session &&
    item.session.name === isoDateTime(item.session.started_at),
  );
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`flex-row items-center px-3 ${compact ? 'py-2' : 'py-3'} active:bg-gray-50 dark:active:bg-gray-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-white dark:bg-gray-900'}`}
    >
      <View className="mr-2.5">
        {selectMode ? (
          <SelectCheckbox checked={selected} />
        ) : (
          <StarButton starred={item.starred} onToggle={onToggleStar} />
        )}
      </View>
      <View className="flex-1">
        <View className="flex-row items-center">
          <View
            className={`mr-2 h-2 w-2 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
          />
          <Text
            className={`flex-shrink font-medium text-gray-900 dark:text-gray-100 ${compact ? 'text-sm' : 'text-base'}`}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <StatusBadges item={item} />
        </View>
        <Text
          className={`text-xs text-gray-500 dark:text-gray-400 ${compact ? '' : 'mt-0.5'}`}
          numberOfLines={1}
        >
          {showProject ? item.subtitlePlain : item.subtitle}
        </Text>
        <RowDiversityLine kind={item.kind} id={item.id} />
        {item.startedAt > 0 && !titleIsTime && !compact ? (
          <Text className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
            {isoDateTime(item.startedAt)}
          </Text>
        ) : null}
      </View>
      {selectMode ? null : (
        <>
          <View className="ml-2">
            <KindIcon kind={item.kind} active={item.active} size="sm" />
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9ca3af" style={{ marginLeft: 4 }} />
        </>
      )}
    </Pressable>
  );
}

/**
 * One record as a card, meant for a 2-up grid.
 *
 * Half a screen wide leaves room for four things, so the subtitle ("4 筆 ·
 * 定點計數法") and the full diversity line are dropped in favour of the two
 * numbers people scan for — when, and how many species.
 *
 * The caller gives it its width (`flex-1` inside a row); the card owns its own
 * rounded border so the grid needs no extra wrapper.
 */
export function RecordGridCard({
  item,
  showProject,
  onPress,
  onLongPress,
  selectMode = false,
  selected = false,
  onToggleStar,
}: CommonProps) {
  const compact = useSettings((s) => s.card_density) === 'compact';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`flex-1 rounded-2xl border ${compact ? 'p-2.5' : 'p-3'} active:opacity-80 ${
        selected
          ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/40'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
      }`}
    >
      <View className="mb-1 flex-row items-start">
        <View className="flex-1 pr-1">
          <Text
            className={`font-medium text-gray-900 dark:text-gray-100 ${compact ? 'text-sm' : 'text-base'}`}
            numberOfLines={2}
          >
            {item.title}
          </Text>
        </View>
        {selectMode ? (
          <SelectCheckbox checked={selected} />
        ) : (
          <StarButton starred={item.starred} onToggle={onToggleStar} size={18} />
        )}
      </View>

      {item.active || item.notReady ? (
        // −ml-2 cancels StatusBadges' own leading gap, which exists for the
        // row layout where a title sits to its left.
        <View className="-ml-2 mb-1 flex-row flex-wrap items-center">
          <StatusBadges item={item} />
        </View>
      ) : null}

      {compact ? null : (
        <Text className="text-[11px] text-gray-400 dark:text-gray-500" numberOfLines={1}>
          {item.startedAt > 0 ? isoDateTime(item.startedAt) : ''}
        </Text>
      )}

      <View className="mt-1.5 min-h-5">
        <RowDiversityLine kind={item.kind} id={item.id} variant="richness" />
      </View>

      <View className="mt-2 flex-row items-center">
        <KindIcon kind={item.kind} active={item.active} size="sm" />
        <Text
          className="ml-2 flex-1 text-xs font-medium text-blue-700 dark:text-blue-300"
          numberOfLines={1}
        >
          {showProject ? item.subtitlePlain : item.projectName}
        </Text>
      </View>
    </Pressable>
  );
}
