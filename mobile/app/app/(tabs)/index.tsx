import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, LayoutAnimation, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isoDateTime } from '~/lib/datetime';
import { SwipeRowActions } from '~/components/SwipeRowActions';
import {
  deleteCollectionTrip,
  deletePlotSurvey,
  deleteSession,
  listPlotSpecies,
  listRecordsSummary,
  listSessionRecords,
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
import { showActionSheet } from '~/components/ActionSheet';
import { pickExportLanguage } from '~/lib/pickExportLanguage';
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
import { betaSimilarity, chao2, computeDiversity, type Chao2Result, type DiversityRecord } from '~/lib/diversity';
import { BetaSimilarityBlock, Chao2ResultBlock } from '~/components/CrossPlotChao2Card';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
      // Compact must be VISIBLY compact — an 8px padding delta alone reads as
      // "the setting does nothing". Tighter padding + smaller title + no
      // third line ≈ one-third shorter rows.
      className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 ${compact ? 'py-1.5' : 'py-3'} active:bg-gray-50 dark:active:bg-gray-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-white dark:bg-gray-900'}`}
    >
      {selectMode ? <SelectCheckbox checked={selected} /> : <KindIcon kind={item.kind} active={item.active} />}
      <View className="flex-1">
        <View className="flex-row items-center">
          <View
            className={`mr-2 h-2 w-2 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
          />
          <Text className={`flex-shrink font-medium text-gray-900 dark:text-gray-100 ${compact ? 'text-sm' : 'text-base'}`} numberOfLines={1}>
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
        <Text className={`text-xs text-gray-500 dark:text-gray-400 ${compact ? '' : 'mt-0.5'}`} numberOfLines={1}>
          {showProject ? item.subtitlePlain : item.subtitle}
        </Text>
        <RowDiversityLine kind={item.kind} id={item.id} />
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

/** Cross-plot Chao2 with the given plots as incidence units — the shared
 *  computation for the header chip and the multi-select sheet. */
function loadPlotUnitRecords(plotId: number): DiversityRecord[] {
  try {
    return listPlotSpecies(plotId).map((r) => ({
      taxon_id: r.taxon_id,
      used_scientific_name: r.used_scientific_name,
      organism_quantity: r.organism_quantity,
      organism_quantity_type: r.organism_quantity_type,
      subplot_id: plotId,
    }));
  } catch {
    return [];
  }
}

function crossPlotChao2(plotIds: number[]): Chao2Result {
  return chao2(plotIds.flatMap(loadPlotUnitRecords), plotIds);
}

/** Header-chip completeness cache. Computation is deferred off the reload
 *  critical path (records-tab reload is perf-tuned); reload() clears this so
 *  new records show on the next pass. null = computed, not applicable. */
const chao2ChipCache = new Map<string, number | null>();
export function clearChao2ChipCache(): void {
  chao2ChipCache.clear();
}

function ProjectChao2Chip({ projectId, plotIds }: { projectId: number; plotIds: number[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  const key = `${projectId}:${plotIds.join('.')}`;
  const [completeness, setCompleteness] = useState<number | null>(() =>
    chao2ChipCache.get(key) ?? null,
  );
  useEffect(() => {
    if (plotIds.length < 2) {
      setCompleteness(null);
      return;
    }
    if (chao2ChipCache.has(key)) {
      setCompleteness(chao2ChipCache.get(key) ?? null);
      return;
    }
    // Deliberately off the mount frame: N plots × listPlotSpecies must not
    // slow the list's first paint.
    const timer = setTimeout(() => {
      const res = crossPlotChao2(plotIds);
      const v = res.applicable ? res.completeness : null;
      chao2ChipCache.set(key, v);
      setCompleteness(v);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (completeness == null) return null;
  return (
    <Pressable
      onPress={() => router.push(`/project/${projectId}` as Href)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t('plotStats.crossTitle')}
      className="ml-2 rounded-full bg-sky-100 dark:bg-sky-900/50 px-2 py-0.5 active:opacity-60"
    >
      <Text className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
        {t('plotStats.chipLabel', { pct: `${Math.round(completeness * 100)}%` })}
      </Text>
    </Pressable>
  );
}

/** Per-row S/H′/J′ cache; cleared with the chip cache on reload. */
const rowDivCache = new Map<string, { s: number; h: number | null; j: number | null } | null>();

/** Tiny `S 34 · H′ 2.41` line for plot / session rows. Computed off the
 *  mount frame and cached — same perf contract as the header chip. H′ is
 *  omitted when the records carry no usable abundance. */
function RowDiversityLine({ kind, id }: { kind: RecordKind; id: number }) {
  const key = `${kind}-${id}`;
  const [val, setVal] = useState<
    { s: number; h: number | null; j: number | null } | null | undefined
  >(() => rowDivCache.get(key));
  useEffect(() => {
    if (rowDivCache.has(key)) {
      setVal(rowDivCache.get(key));
      return;
    }
    if (kind === 'collection') {
      rowDivCache.set(key, null);
      setVal(null);
      return;
    }
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
        // row stays without the line
      }
      rowDivCache.set(key, v);
      setVal(v);
    }, 0);
    return () => clearTimeout(timer);
  }, [key, kind, id]);
  if (!val) return null;
  return (
    <Text className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400" style={{ fontVariant: ['tabular-nums'] }}>
      {`S:${val.s}`}
      {val.h != null ? `, H′:${val.h.toFixed(2)}` : ''}
      {val.j != null ? `, Pielou J′:${val.j.toFixed(2)}` : ''}
    </Text>
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
        {!selectMode ? (
          <ProjectChao2Chip
            projectId={group.projectId}
            plotIds={group.items.filter((x) => x.kind === 'plot').map((x) => x.id)}
          />
        ) : null}
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
  const sheetInsets = useSafeAreaInsets();
  const filterLabel: Record<Filter, string> = {
    all: t('records.filterAll'),
    session: t('nav.session'),
    plot: t('nav.plot'),
    collection: t('nav.collection'),
  };
  const viewLabel: Record<ViewMode, string> = {
    byProject: t('records.byProject'),
    flat: t('records.timeline'),
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
  const includeReport = useSettings((s) => s.export_include_report);
  const reportFormat = useSettings((s) => s.export_report_format);
  const swipeHintShown = useSettings((s) => s.records_swipe_hint_shown);
  const settingsLoaded = useSettings((s) => s.loaded);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => {
    chao2ChipCache.clear();
    rowDivCache.clear();
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

    const lang = await pickExportLanguage(t, 'export.language');
    if (!lang) return;

    const bundleOpts = { geoFormats, includePhotos, includeDocx, levels, conservationFields, lang, onProgress };
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
      includeReport,
      reportFormat,
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
    const lang = await pickExportLanguage(t, 'export.language');
    if (!lang) return;
    await shareBundle(() =>
      bundleProject(group.projectId, {
        geoFormats,
        includePhotos,
        includeDocx,
        levels,
        conservationFields,
        lang,
        matrixValue,
        analysisFormats,
        matrixByLayer,
        includeReport,
        reportFormat,
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

    const lang = await pickExportLanguage(t, 'export.language');
    if (!lang) return;

    await shareBundle(() =>
      bundleMany(bundleItems, {
        geoFormats, includePhotos, includeDocx, levels, conservationFields, lang, onProgress,
      }),
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
        added: t('favorites.nImported', { count: added }),
        skipped: t('favorites.nDuplicate', {
          count: Math.max(0, distinct.size - added - unresolved),
        }),
        unresolved: t('favorites.nUnresolvedNames', { count: unresolved }),
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
  // ── 跨樣區 Chao2（multi-select → ad-hoc scope, may span projects) ──
  const selectedPlotIds = useMemo(
    () =>
      [...selected]
        .filter((k) => k.startsWith('plot-'))
        .map((k) => Number(k.slice('plot-'.length)))
        .filter((n) => Number.isFinite(n)),
    [selected],
  );
  const [chao2Sheet, setChao2Sheet] = useState<Array<{ id: number; title: string }> | null>(null);
  const chao2SheetData = useMemo(() => {
    if (!chao2Sheet) return null;
    const perPlot = chao2Sheet.map((p) => ({ ...p, records: loadPlotUnitRecords(p.id) }));
    return {
      result: chao2(
        perPlot.flatMap((p) => p.records),
        perPlot.map((p) => p.id),
      ),
      beta:
        perPlot.length === 2
          ? {
              value: betaSimilarity(perPlot[0].records, perPlot[1].records),
              nameA: perPlot[0].title,
              nameB: perPlot[1].title,
            }
          : null,
      count: perPlot.length,
    };
  }, [chao2Sheet]);

  const pickFilter = async () => {
    const opts: Filter[] = ['all', 'session', 'plot', 'collection'];
    const idx = await showActionSheet({
      title: t('records.filterTitle'),
      options: opts.map((f) => ({ label: `${filterLabel[f]} (${counts[f]})` })),
    });
    if (idx >= 0) setFilter(opts[idx]);
  };

  const pickView = async () => {
    const opts: ViewMode[] = ['byProject', 'flat'];
    const idx = await showActionSheet({
      title: t('records.viewTitle'),
      options: opts.map((m) => ({ label: viewLabel[m] })),
    });
    if (idx >= 0) setViewMode(opts[idx]);
  };

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
            label: t('records.uploadInat'),
            icon: 'cloud-upload-outline',
            color: 'inat',
            onPress: () => router.push(`/inat-upload?kind=${item.kind}&id=${item.id}` as Href),
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
              onPress={() =>
                setChao2Sheet(
                  selectedPlotIds.map((id) => ({
                    id,
                    title:
                      items.find((it) => it.kind === 'plot' && it.id === id)?.title ?? String(id),
                  })),
                )
              }
              disabled={selectedPlotIds.length < 2}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('plotStats.crossTitle')}
            >
              <Ionicons
                name="analytics-outline"
                size={20}
                color={selectedPlotIds.length < 2 ? '#9ca3af' : '#0284c7'}
              />
            </Pressable>
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
          <View className="flex-row items-center">
            <Text
              numberOfLines={1}
              className="flex-shrink text-2xl font-bold text-gray-900 dark:text-gray-100"
            >
              {t('tab.records')}
            </Text>
            {/* Filter / view live on the title row. The chips are icon-only so
                their width no longer tracks the UI language — that is what
                stopped them colliding with the favourites pill. The scroller
                stays as insurance for the parts that DO grow (fr title
                "Enregistrements" + "Favoris"); the action cluster is
                deliberately outside it, since primary actions must never
                scroll out of reach. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="ml-3 flex-1"
              contentContainerClassName="flex-row items-center gap-2 pr-2"
              keyboardShouldPersistTaps="handled"
            >
              <DropdownChip
                icon="funnel-outline"
                a11yLabel={`${t('records.filterTitle')}: ${filterLabel[filter]} (${counts[filter]})`}
                active={filter !== 'all'}
                onPress={pickFilter}
              />
              <DropdownChip
                icon={viewMode === 'byProject' ? 'folder-outline' : 'time-outline'}
                a11yLabel={`${t('records.viewTitle')}: ${viewLabel[viewMode]}`}
                onPress={pickView}
              />
            </ScrollView>
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
                className="h-7 w-7 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700"
              >
                <Ionicons name="download-outline" size={16} color="#4b5563" />
              </Pressable>
            </View>
          </View>
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

      {/* 跨樣區 Chao2 sheet — ad-hoc scope from the multi-select. No text
          input, so a floating bottom sheet is fine (the full-screen rule is
          for keyboard-bearing modals). */}
      <Modal
        visible={chao2Sheet != null}
        transparent
        animationType="slide"
        onRequestClose={() => setChao2Sheet(null)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setChao2Sheet(null)} />
        <View
          className="rounded-t-2xl bg-white dark:bg-gray-900 px-4 pt-4"
          style={{ paddingBottom: Math.max(sheetInsets.bottom, 16) }}
        >
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('plotStats.crossTitle')}
          </Text>
          <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('plotStats.selectedPlots', { count: chao2SheetData?.count ?? 0 })}
          </Text>
          <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('plotStats.crossHint')}
          </Text>
          {chao2SheetData?.beta ? (
            <BetaSimilarityBlock
              beta={chao2SheetData.beta.value}
              nameA={chao2SheetData.beta.nameA}
              nameB={chao2SheetData.beta.nameB}
            />
          ) : (
            <Text className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
              {t('plotStats.betaNeedTwo')}
            </Text>
          )}
          {chao2SheetData?.result.applicable ? (
            <Chao2ResultBlock result={chao2SheetData.result} />
          ) : (
            <Text className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t('plotStats.crossEmpty')}
            </Text>
          )}
          <Text className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
            {t('plotStats.lowerBoundNote')}
          </Text>
        </View>
      </Modal>
      <DuplicateRecordModal
        request={duplicating?.request ?? null}
        onCancel={() => setDuplicating(null)}
        onConfirm={handleDuplicateConfirm}
      />
    </View>
  );
}

/**
 * Icon-only dropdown: an icon + a chevron, opening an ActionSheet.
 *
 * The label used to ride along inside the chip, which made the header row's
 * width depend on the UI language — in longer languages it collided with the
 * favourites pill. An icon is fixed-width in every language; the current value
 * lives in `a11yLabel` for screen readers and is spelled out in the sheet the
 * chevron promises.
 */
function DropdownChip({
  icon,
  a11yLabel,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  a11yLabel: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      className={`flex-row items-center rounded-full border px-2.5 py-1.5 active:opacity-70 ${
        active
          ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40'
          : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'
      }`}
    >
      <Ionicons name={icon} size={16} color={active ? '#059669' : '#4b5563'} />
      <Ionicons
        name="chevron-down"
        size={12}
        color={active ? '#059669' : '#9ca3af'}
        style={{ marginLeft: 2 }}
      />
    </Pressable>
  );
}
