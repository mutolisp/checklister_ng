import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, LayoutAnimation, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isoDateTime } from '~/lib/datetime';
import { ExportPreferenceSheet } from '~/components/ExportPreferenceSheet';
import { SwipeRowActions } from '~/components/SwipeRowActions';
import {
  deleteCollectionTrip,
  deletePlotSurvey,
  deleteSession,
  listRecordsSummary,
  takenRecordNames,
  taxonIdsOfRecord,
  type ProjectGroup,
  type RecordItem,
  type RecordKind,
} from '~/db';
import {
  bundleCollection,
  bundleMany,
  bundlePlot,
  bundleSession,
  type BundleItem,
} from '~/lib/bundleExport';
import { confirmExportContent } from '~/components/AnalysisExportOptions';
import { ExportProgressOverlay } from '~/components/ExportProgressOverlay';
import {
  DuplicateRecordModal,
  type DuplicateRequest,
} from '~/components/DuplicateRecordModal';
import { duplicateRecordAndOpen, importRecordPromptAndOpen, showCreateChooser } from '~/lib/recordCreate';
import { nextRecordName } from '~/lib/recordName';
import { pickFavoriteFolder } from '~/lib/pickFavoriteFolder';
import { useFavorites } from '~/stores/favorites';
import { estimateBundleSize } from '~/lib/exportSize';
import { bundleProject } from '~/lib/projectExport';
import { useExportShare } from '~/lib/useExportShare';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { selectionKey, useRecordSelection } from '~/stores/recordSelection';
import { useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';

type Filter = 'all' | RecordKind;
type ViewMode = 'flat' | 'byProject';

const formatTime = isoDateTime;

function KindIcon({ kind, active }: { kind: RecordKind; active: boolean }) {
  const tint = active ? '#10b981' : '#94a3b8';
  const bg = active ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-gray-100 dark:bg-gray-800';
  const iconName =
    kind === 'session' ? 'list' : kind === 'collection' ? 'leaf-outline' : 'grid-outline';
  return (
    <View className={`mr-3 h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
      <Ionicons name={iconName as never} size={20} color={tint} />
    </View>
  );
}

function SelectCheckbox({ checked }: { checked: boolean }) {
  return (
    <View
      className={`mr-3 h-6 w-6 items-center justify-center rounded-full ${checked ? 'bg-blue-500' : 'border-2 border-gray-300 dark:border-gray-600'}`}
    >
      {checked ? <Ionicons name="checkmark" size={14} color="white" /> : null}
    </View>
  );
}

function RecordRow({
  item,
  showProject,
  onPress,
  onLongPress,
  selectMode,
  selected,
}: {
  item: RecordItem;
  showProject: boolean;
  onPress: () => void;
  onLongPress: () => void;
  selectMode: boolean;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const compact = useSettings((s) => s.card_density) === 'compact';
  const showTimestamp = Boolean(
    item.kind === 'session' &&
      item.session &&
      item.session.name === formatTime(item.session.started_at),
  );
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 ${compact ? 'py-2' : 'py-3'} active:bg-gray-50 dark:active:bg-gray-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-white dark:bg-gray-900'}`}
    >
      {selectMode ? <SelectCheckbox checked={selected} /> : <KindIcon kind={item.kind} active={item.active} />}
      <View className="flex-1">
        <View className="flex-row items-center">
          <View
            className={`mr-2 h-2 w-2 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
          />
          <Text className="flex-shrink text-base font-medium text-gray-900 dark:text-gray-100" numberOfLines={1}>
            {showTimestamp ? formatTime(item.session!.started_at) : item.title}
          </Text>
          {item.active ? (
            <View className="ml-2 rounded bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.5">
              <Text className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                {item.kind === 'session' ? t('records.recording') : t('records.inProgress')}
              </Text>
            </View>
          ) : null}
          {item.notReady ? (
            <View className="ml-2 rounded bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5">
              <Text className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{t('records.notReady')}</Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {showProject ? item.subtitlePlain : item.subtitle}
        </Text>
        {/* Third line dropped when the title IS the timestamp (auto-named
            sessions printed the same time twice) and in compact density. */}
        {item.startedAt > 0 && !showTimestamp && !compact ? (
          <Text className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{formatTime(item.startedAt)}</Text>
        ) : null}
      </View>
      {selectMode ? null : <Ionicons name="chevron-forward" size={18} color="#9ca3af" />}
    </Pressable>
  );
}

function ProjectHeader({
  group,
  collapsed,
  onToggle,
  onToggleAll,
  onExport,
  selectMode = false,
  groupSelected = false,
  onToggleSelect,
}: {
  group: ProjectGroup;
  collapsed: boolean;
  onToggle: () => void;
  /** Long-press: collapse / expand every group. */
  onToggleAll: () => void;
  onExport?: () => void;
  /** Multi-select mode: tap selects / deselects the whole group instead of
   *  collapsing (collapse stays available outside select mode). */
  selectMode?: boolean;
  groupSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  const countOf = (k: RecordKind) => group.items.filter((x) => x.kind === k).length;
  const parts = (
    [
      ['session', 'records.sessionCount'],
      ['plot', 'records.plotCount'],
      ['collection', 'records.collectionCount'],
    ] as const
  )
    .map(([kind, key]) => {
      const count = countOf(kind);
      return count > 0 ? t(key, { count }) : null;
    })
    .filter((x): x is string => x !== null);
  return (
    <Pressable
      onPress={selectMode ? onToggleSelect : onToggle}
      onLongPress={selectMode ? undefined : onToggleAll}
      delayLongPress={350}
      className="border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 active:bg-gray-200 dark:active:bg-gray-700"
    >
      <View className="flex-row items-center">
        {selectMode ? (
          <View className="mr-1">
            <SelectCheckbox checked={groupSelected} />
          </View>
        ) : (
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={14}
            color="#6b7280"
            style={{ marginRight: 4 }}
          />
        )}
        <Ionicons name="folder-outline" size={14} color="#4b5563" />
        <Text className="ml-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">{group.projectName}</Text>
        <Text className="ml-2 flex-1 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
        {onExport ? (
          <Pressable
            onPress={onExport}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.export')}
            className="ml-2 p-1.5 active:opacity-60"
          >
            <Ionicons name="share-outline" size={16} color="#2563eb" />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

type FlatRow =
  | { kind: 'header'; group: ProjectGroup; key: string }
  | { kind: 'row'; item: RecordItem; key: string };

function buildFlatRows(groups: ProjectGroup[], collapsedIds: Set<number>): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const g of groups) {
    rows.push({ kind: 'header', group: g, key: `h-${g.projectId}` });
    if (collapsedIds.has(g.projectId)) continue;
    for (const item of g.items) {
      rows.push({ kind: 'row', item, key: `${item.kind}-${item.id}` });
    }
  }
  return rows;
}

export default function RecordsListScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const filterLabel: Record<Filter, string> = {
    all: t('records.filterAll'),
    session: t('nav.session'),
    plot: t('nav.plot'),
    collection: t('nav.collection'),
  };
  const refreshActive = useActiveSession((s) => s.refresh);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
  const toast = useToast((s) => s.show);
  const [filter, setFilter] = useState<Filter>('all');
  // 預設以專案分組（使用者要求 2026-09-07）；切回時間軸不持久化。
  const [viewMode, setViewMode] = useState<ViewMode>('byProject');
  // 收合的專案 id（byProject 檢視），持久化到 settings（比照 taxonomy_expanded）。
  const collapsedList = useSettings((s) => s.records_collapsed);
  const setSetting = useSettings((s) => s.set);
  const collapsedIds = useMemo(() => new Set(collapsedList), [collapsedList]);
  const [items, setItems] = useState<RecordItem[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [counts, setCounts] = useState<Record<Filter, number>>({
    all: 0,
    session: 0,
    plot: 0,
    collection: 0,
  });
  const [prefOpen, setPrefOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<{ item: RecordItem; request: DuplicateRequest } | null>(null);
  const {
    busy: exportBusy,
    progress: exportProgress,
    onProgress,
    shareBundle,
    confirmIfLarge,
  } = useExportShare();

  const selectMode = useRecordSelection((s) => s.active);
  const selected = useRecordSelection((s) => s.selected);
  const selectEnter = useRecordSelection((s) => s.enter);
  const selectToggle = useRecordSelection((s) => s.toggle);
  const selectSetMany = useRecordSelection((s) => s.setMany);
  const selectClear = useRecordSelection((s) => s.clear);
  const geoFormats = useSettings((s) => s.export_geo_formats);
  const includePhotos = useSettings((s) => s.export_include_photos);
  const includeDocx = useSettings((s) => s.export_include_docx);
  const levels = useSettings((s) => s.export_levels);
  const conservationFields = useSettings((s) => s.export_conservation_fields);
  const matrixValue = useSettings((s) => s.export_matrix_value);
  const analysisFormats = useSettings((s) => s.export_analysis_formats);
  const matrixByLayer = useSettings((s) => s.export_matrix_by_layer);
  const swipeHintShown = useSettings((s) => s.records_swipe_hint_shown);
  const settingsLoaded = useSettings((s) => s.loaded);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => {
    // One table walk: counts (always over ALL records so the chips stay in
    // sync after any delete / create), the filtered list and the grouping all
    // come from listRecordsSummary — this used to be three identical walks.
    const summary = listRecordsSummary(filter);
    setCounts(summary.counts);
    setItems(summary.items);
    setGroups(summary.groups);
    refreshActive();
    refreshActivePlot();
  }, [filter, refreshActive, refreshActivePlot]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Re-fetch when an active session / plot changes status (e.g. StaleWatcher
  // alerts fire "結束" while the user is staring at the records tab — without
  // this the row keeps showing「進行中」until the user manually switches
  // screens). Subscribe to the id alone so a no-op refresh (same object
  // shape) doesn't trigger reload. `reload` is read through a ref (not a dep):
  // with it in the deps this effect also re-fired on mount and on every
  // filter change, doubling the reload useFocusEffect already performs.
  const activeSessionId = useActiveSession((s) => s.session?.id ?? null);
  const activePlotId = useActivePlot((s) => s.plot?.id ?? null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const activeIdsSeen = useRef(false);
  useEffect(() => {
    if (!activeIdsSeen.current) {
      activeIdsSeen.current = true;
      return;
    }
    reloadRef.current();
  }, [activeSessionId, activePlotId]);

  const handleOpen = (item: RecordItem) => {
    if (item.kind === 'session') router.push(`/session/${item.id}` as Href);
    else if (item.kind === 'collection') router.push(`/collection/${item.id}` as Href);
    else router.push(`/plot/${item.id}` as Href);
  };

  const handleRowTap = (item: RecordItem) => {
    if (selectMode) {
      selectToggle(selectionKey(item.kind, item.id));
      return;
    }
    handleOpen(item);
  };

  // Select-mode tap on a group header: whole group in / out.
  const handleToggleSelectGroup = (group: ProjectGroup) => {
    const keys = group.items.map((it) => selectionKey(it.kind, it.id));
    const allSelected = keys.every((k) => selected.has(k));
    selectSetMany(keys, !allSelected);
  };

  const handleRowLongPress = (item: RecordItem) => {
    if (selectMode) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    selectEnter(selectionKey(item.kind, item.id));
  };


  const handleExportOne = async (item: RecordItem) => {
    const bundleItem: BundleItem = { kind: item.kind, id: item.id };
    const est = await estimateBundleSize([bundleItem], { includePhotos });
    const proceed = await confirmIfLarge(est.totalBytes);
    if (!proceed) return;

    const bundleOpts = { geoFormats, includePhotos, includeDocx, levels, conservationFields, onProgress };
    await shareBundle(() => {
      if (item.kind === 'session') return bundleSession(item.id, bundleOpts);
      if (item.kind === 'collection') return bundleCollection(item.id, bundleOpts);
      return bundlePlot(item.id, bundleOpts);
    });
  };

  // 專案分組標頭的匯出：整個專案打包（records/ + 分析資料表），與
  // /projects 的 swipe 匯出同一套（沿用持久化偏好，不開選項 sheet）。
  const handleExportProject = async (group: ProjectGroup) => {
    if (exportBusy) return;
    const okGo = await confirmExportContent(t, {
      analysisFormats,
      matrixValue,
      matrixByLayer,
      includePhotos,
      includeDocx,
      geoFormats,
    });
    if (!okGo) return;
    const est = await estimateBundleSize(
      group.items.map((it) => ({ kind: it.kind, id: it.id })),
      { includePhotos },
    );
    if (!(await confirmIfLarge(est.totalBytes))) return;
    await shareBundle(() =>
      bundleProject(group.projectId, {
        geoFormats,
        includePhotos,
        includeDocx,
        levels,
        conservationFields,
        matrixValue,
        analysisFormats,
        matrixByLayer,
        onProgress,
      }),
    );
  };

  const handleExportSelection = async () => {
    if (selected.size === 0) {
      toast(t('records.noneSelected'));
      return;
    }
    const bundleItems: BundleItem[] = [];
    // Resolve back to RecordItem so we can carry kind. We have items + groups —
    // walk the latest `items` array (covers both view modes since `items` is
    // always populated by reload).
    const byKey = new Map(items.map((it) => [selectionKey(it.kind, it.id), it]));
    for (const k of selected) {
      const it = byKey.get(k);
      if (it) bundleItems.push({ kind: it.kind, id: it.id });
    }
    if (bundleItems.length === 0) {
      toast(t('records.noExportable'));
      return;
    }
    const est = await estimateBundleSize(bundleItems, { includePhotos });
    const proceed = await confirmIfLarge(est.totalBytes);
    if (!proceed) return;

    await shareBundle(() =>
      bundleMany(bundleItems, { geoFormats, includePhotos, includeDocx, levels, conservationFields, onProgress }),
    );
    selectClear();
  };


  const nounOf = (kind: RecordKind): string =>
    t(kind === 'session' ? 'nav.session' : kind === 'plot' ? 'nav.plot' : 'nav.collection');

  const handleDuplicate = (item: RecordItem) => {
    // Names of the SAME kind only: a 名錄 and a 樣區 may legitimately share one.
    const taken = takenRecordNames(item.kind);
    setDuplicating({
      item,
      request: {
        suggested: nextRecordName(item.title, taken),
        taken,
        noun: nounOf(item.kind),
        // plotid is an identifier, not prose.
        autoCapitalize: item.kind === 'plot' ? 'none' : 'sentences',
        // 採集號屬於實體標本，不能預先配發 —— 見 duplicateCollectionTrip。
        speciesDisabled: item.kind === 'collection',
      },
    });
  };

  const handleDuplicateConfirm = async (opts: Parameters<typeof duplicateRecordAndOpen>[1]) => {
    const pending = duplicating;
    setDuplicating(null);
    if (!pending) return;
    // duplicateRecordAndOpen may present the "end the active record?" sheet.
    // Presenting a system sheet in the same tick as dismissing our own Modal
    // is the documented iOS crash/no-op case — let the dismissal land first.
    await new Promise((r) => setTimeout(r, 450));
    const id = await duplicateRecordAndOpen(pending.item, opts);
    if (id === null) return;
    reload();
    toast(t('records.duplicated', { name: opts.name }));
  };

  const handleSaveSelectionToFavorites = async () => {
    if (selected.size === 0) {
      toast(t('records.noneSelected'));
      return;
    }
    const byKey = new Map(items.map((it) => [selectionKey(it.kind, it.id), it]));
    const picked = [...selected].map((k) => byKey.get(k)).filter((it): it is RecordItem => !!it);
    if (picked.length === 0) return;

    const folderId = await pickFavoriteFolder(picked[0].title);
    if (folderId === null) return;

    // Counts are reported over the DISTINCT species of the whole selection —
    // summing per-record results would count a species shared by three records
    // as "1 added, 2 skipped", which reads like a partial failure.
    const distinct = new Set(picked.flatMap((it) => taxonIdsOfRecord(it.kind, it.id)));
    let added = 0;
    let unresolved = 0;
    for (const it of picked) {
      const r = useFavorites.getState().importFromRecord(it.kind, it.id, folderId);
      added += r.added;
      unresolved += r.unresolved;
    }
    selectClear();
    toast(
      t('favorites.importDone', {
        added,
        skipped: Math.max(0, distinct.size - added - unresolved),
        unresolved,
      }),
    );
  };

  const handleDelete = (item: RecordItem) => {
    const noun = nounOf(item.kind);
    Alert.alert(
      t('records.deleteTitle', { noun }),
      t('records.deleteMsg', { title: item.title, count: item.recordCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            if (item.kind === 'session') deleteSession(item.id);
            else if (item.kind === 'collection') deleteCollectionTrip(item.id);
            else deletePlotSurvey(item.id);
            reload();
          },
        },
      ],
    );
  };

  const toggleCollapsed = (projectId: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSetting(
      'records_collapsed',
      collapsedIds.has(projectId)
        ? collapsedList.filter((id) => id !== projectId)
        : [...collapsedList, projectId],
    );
  };

  // 長按分組標頭：全部收合／全部展開（比照分類樹的 collapseAll）。只動當前
  // 檢視看得到的分組——其他 filter 下的收合狀態原樣保留。
  const toggleCollapseAll = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const visibleIds = groups.map((g) => g.projectId);
    const allCollapsed = visibleIds.every((id) => collapsedIds.has(id));
    setSetting(
      'records_collapsed',
      allCollapsed
        ? collapsedList.filter((id) => !visibleIds.includes(id))
        : [...new Set([...collapsedList, ...visibleIds])],
    );
  };

  const flatRowsForGrouped = viewMode === 'byProject' ? buildFlatRows(groups, collapsedIds) : [];
  const isEmpty = viewMode === 'flat' ? items.length === 0 : groups.length === 0;

  // C7: pull-to-refresh. reload() is synchronous (op-sqlite executeSync), so
  // hold the spinner a beat — an instantly vanishing spinner reads as broken.
  const handleRefresh = () => {
    setRefreshing(true);
    requestAnimationFrame(() => {
      reload();
      setTimeout(() => setRefreshing(false), 300);
    });
  };

  // C4: one-shot swipe-actions teaser on the first visible record row. The
  // flag flips AFTER the animation window so the prop doesn't change (and
  // cancel the timers) mid-teaser.
  const firstRecordKey =
    viewMode === 'flat'
      ? items.length > 0
        ? selectionKey(items[0].kind, items[0].id)
        : null
      : (() => {
          const row = flatRowsForGrouped.find((r) => r.kind === 'row');
          return row && row.kind === 'row' ? selectionKey(row.item.kind, row.item.id) : null;
        })();
  const teaserKey = settingsLoaded && !swipeHintShown && !selectMode ? firstRecordKey : null;
  useEffect(() => {
    if (teaserKey == null) return;
    const done = setTimeout(() => setSetting('records_swipe_hint_shown', true), 2200);
    return () => clearTimeout(done);
  }, [teaserKey, setSetting]);

  const renderRow = (item: RecordItem, showProject: boolean) => {
    const key = selectionKey(item.kind, item.id);
    return (
      <SwipeRowActions
        disabled={selectMode}
        teaser={key === teaserKey}
        actions={[
          {
            label: t('records.duplicate'),
            icon: 'copy-outline',
            color: 'emerald',
            onPress: () => handleDuplicate(item),
          },
          {
            label: t('common.export'),
            icon: 'share-outline',
            color: 'blue',
            onPress: () => handleExportOne(item),
          },
          {
            label: t('common.delete'),
            icon: 'trash',
            color: 'red',
            onPress: () => handleDelete(item),
          },
        ]}
      >
        <RecordRow
          item={item}
          showProject={showProject}
          onPress={() => handleRowTap(item)}
          onLongPress={() => handleRowLongPress(item)}
          selectMode={selectMode}
          selected={selected.has(key)}
        />
      </SwipeRowActions>
    );
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <ExportProgressOverlay progress={exportProgress} />
      <View className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4">
        {selectMode ? (
          <View className="flex-row items-center justify-between">
            <Pressable onPress={selectClear} hitSlop={8}>
              <Text className="text-base font-medium text-blue-600 dark:text-blue-400">{t('common.cancel')}</Text>
            </Pressable>
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('records.selectedCount', { count: selected.size })}
            </Text>
            <View className="flex-row items-center gap-4">
            <Pressable
              onPress={handleSaveSelectionToFavorites}
              disabled={selected.size === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('records.favorites')}
            >
              <Ionicons
                name="star-outline"
                size={20}
                color={selected.size === 0 ? '#9ca3af' : '#d97706'}
              />
            </Pressable>
            <Pressable
              onPress={handleExportSelection}
              disabled={selected.size === 0 || exportBusy}
              hitSlop={8}
            >
              <Text
                className={`text-base font-medium ${selected.size === 0 || exportBusy ? 'text-gray-400 dark:text-gray-600' : 'text-blue-600 dark:text-blue-400'}`}
              >
                {t('common.export')}
              </Text>
            </Pressable>
            </View>
          </View>
        ) : (
          <View className="flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('tab.records')}</Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => router.push('/favorites')}
                hitSlop={8}
                className="flex-row items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 active:bg-amber-100 dark:active:bg-amber-900/60"
              >
                <Ionicons name="star" size={14} color="#d97706" />
                <Text className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t('records.favorites')}</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await importRecordPromptAndOpen();
                  reload();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('record.kindImport')}
                className="rounded-full bg-gray-100 dark:bg-gray-800 p-1.5 active:bg-gray-200 dark:active:bg-gray-700"
              >
                <Ionicons name="download-outline" size={16} color="#4b5563" />
              </Pressable>
              <Pressable
                onPress={() => setPrefOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('exportPref.title')}
                className="rounded-full bg-gray-100 dark:bg-gray-800 p-1.5 active:bg-gray-200 dark:active:bg-gray-700"
              >
                <Ionicons name="settings-outline" size={16} color="#4b5563" />
              </Pressable>
              {/* Segmented control instead of a state-labelled chip: the old
                  chip showed the CURRENT mode, which reads as "tap to get
                  this" — ambiguous both ways. */}
              <View className="flex-row rounded-full bg-gray-100 dark:bg-gray-800 p-0.5">
                {(
                  [
                    ['byProject', t('records.byProject')],
                    ['flat', t('records.timeline')],
                  ] as Array<[ViewMode, string]>
                ).map(([mode, label]) => {
                  const on = viewMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => setViewMode(mode)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      className={`rounded-full px-2.5 py-1 ${on ? 'bg-blue-500' : ''}`}
                    >
                      <Text className={`text-xs font-medium ${on ? 'text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}
        {selectMode ? null : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="mt-3 flex-row gap-2 pr-4"
            >
              {(['all', 'session', 'plot', 'collection'] as Filter[]).map((f) => {
                const on = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    className={`items-center rounded-lg px-4 py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                  >
                    <Text className={`text-sm font-medium ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {filterLabel[f]} ({counts[f]})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>

      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-6">
          <Ionicons name="add-circle-outline" size={56} color="#cbd5e1" />
          <Text className="mt-3 text-base font-medium text-gray-700 dark:text-gray-300">
            {filter === 'all' ? t('records.empty') : t('records.emptyFiltered', { kind: filterLabel[filter] })}
          </Text>
          <Text className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">{t('records.emptyHint')}</Text>
          <Pressable
            onPress={() => showCreateChooser()}
            className="mt-5 flex-row items-center rounded-lg bg-emerald-500 px-5 py-2.5 active:bg-emerald-600"
          >
            <Ionicons name="add" size={18} color="white" />
            <Text className="ml-1 text-sm font-medium text-white">{t('records.emptyCreate')}</Text>
          </Pressable>
        </View>
      ) : viewMode === 'flat' ? (
        <FlatList
          data={items}
          keyExtractor={(x) => `${x.kind}-${x.id}`}
          renderItem={({ item }) => renderRow(item, false)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      ) : (
        <FlatList
          data={flatRowsForGrouped}
          keyExtractor={(row) => row.key}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item: row }) => {
            if (row.kind === 'header')
              return (
                <ProjectHeader
                  group={row.group}
                  collapsed={collapsedIds.has(row.group.projectId)}
                  onToggle={() => toggleCollapsed(row.group.projectId)}
                  onToggleAll={toggleCollapseAll}
                  onExport={selectMode ? undefined : () => handleExportProject(row.group)}
                  selectMode={selectMode}
                  groupSelected={row.group.items.every((it) =>
                    selected.has(selectionKey(it.kind, it.id)),
                  )}
                  onToggleSelect={() => handleToggleSelectGroup(row.group)}
                />
              );
            return renderRow(row.item, true);
          }}
        />
      )}

      <ExportPreferenceSheet visible={prefOpen} onClose={() => setPrefOpen(false)} />
      <DuplicateRecordModal
        request={duplicating?.request ?? null}
        onCancel={() => setDuplicating(null)}
        onConfirm={handleDuplicateConfirm}
      />
    </View>
  );
}
