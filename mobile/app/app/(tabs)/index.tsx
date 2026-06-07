import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { ExportPreferenceSheet } from '~/components/ExportPreferenceSheet';
import { SwipeRowActions } from '~/components/SwipeRowActions';
import {
  deletePlotSurvey,
  deleteSession,
  listRecords,
  listRecordsByProject,
  type ProjectGroup,
  type RecordItem,
  type RecordKind,
} from '~/db';
import {
  bundleMany,
  bundlePlot,
  bundleSession,
  type BundleItem,
  type ExportProgress,
} from '~/lib/bundleExport';
import { ExportProgressOverlay } from '~/components/ExportProgressOverlay';
import { estimateBundleSize, formatBytes } from '~/lib/exportSize';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { selectionKey, useRecordSelection } from '~/stores/recordSelection';
import { useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';

type Filter = 'all' | RecordKind;
type ViewMode = 'flat' | 'byProject';

const FILTER_LABEL: Record<Filter, string> = {
  all: '全部',
  session: '名錄',
  plot: '樣區',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function KindIcon({ kind, active }: { kind: RecordKind; active: boolean }) {
  const tint = active ? '#10b981' : '#94a3b8';
  const bg = active ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-gray-100 dark:bg-gray-800';
  const iconName = kind === 'session' ? 'list' : 'grid-outline';
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
      className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800 ${selected ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-white dark:bg-gray-900'}`}
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
                {item.kind === 'session' ? '記錄中' : '進行中'}
              </Text>
            </View>
          ) : null}
          {item.notReady ? (
            <View className="ml-2 rounded bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5">
              <Text className="text-[11px] font-medium text-amber-700 dark:text-amber-300">資訊未補齊</Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {showProject ? item.subtitle.replace(` · ${item.projectName}`, '') : item.subtitle}
        </Text>
        {item.startedAt > 0 ? (
          <Text className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{formatTime(item.startedAt)}</Text>
        ) : null}
      </View>
      {selectMode ? null : <Ionicons name="chevron-forward" size={18} color="#9ca3af" />}
    </Pressable>
  );
}

function ProjectHeader({ group }: { group: ProjectGroup }) {
  const sessionCount = group.items.filter((x) => x.kind === 'session').length;
  const plotCount = group.items.filter((x) => x.kind === 'plot').length;
  return (
    <View className="border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2">
      <View className="flex-row items-center">
        <Ionicons name="folder-outline" size={14} color="#4b5563" />
        <Text className="ml-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">{group.projectName}</Text>
        <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400">
          {sessionCount > 0 ? `名錄 ${sessionCount}` : ''}
          {sessionCount > 0 && plotCount > 0 ? ' · ' : ''}
          {plotCount > 0 ? `樣區 ${plotCount}` : ''}
        </Text>
      </View>
    </View>
  );
}

type FlatRow =
  | { kind: 'header'; group: ProjectGroup; key: string }
  | { kind: 'row'; item: RecordItem; key: string };

function buildFlatRows(groups: ProjectGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const g of groups) {
    rows.push({ kind: 'header', group: g, key: `h-${g.projectId}` });
    for (const item of g.items) {
      rows.push({ kind: 'row', item, key: `${item.kind}-${item.id}` });
    }
  }
  return rows;
}

export default function RecordsListScreen() {
  const router = useRouter();
  const refreshActive = useActiveSession((s) => s.refresh);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
  const toast = useToast((s) => s.show);
  const [filter, setFilter] = useState<Filter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [items, setItems] = useState<RecordItem[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [counts, setCounts] = useState({ all: 0, session: 0, plot: 0 });
  const [prefOpen, setPrefOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);

  const selectMode = useRecordSelection((s) => s.active);
  const selected = useRecordSelection((s) => s.selected);
  const selectEnter = useRecordSelection((s) => s.enter);
  const selectToggle = useRecordSelection((s) => s.toggle);
  const selectClear = useRecordSelection((s) => s.clear);
  const geoFormats = useSettings((s) => s.export_geo_formats);
  const includePhotos = useSettings((s) => s.export_include_photos);
  const includeDocx = useSettings((s) => s.export_include_docx);
  const levels = useSettings((s) => s.export_levels);
  const conservationFields = useSettings((s) => s.export_conservation_fields);

  const reload = useCallback(() => {
    // Always recompute the top-bar stats from a full listRecords('all') query
    // so the counters stay in sync with DB state after any delete / create.
    const all = listRecords('all');
    setCounts({
      all: all.length,
      session: all.filter((x) => x.kind === 'session').length,
      plot: all.filter((x) => x.kind === 'plot').length,
    });
    setItems(listRecords(filter));
    setGroups(listRecordsByProject(filter));
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
  // shape) doesn't trigger reload.
  const activeSessionId = useActiveSession((s) => s.session?.id ?? null);
  const activePlotId = useActivePlot((s) => s.plot?.id ?? null);
  useEffect(() => {
    reload();
  }, [activeSessionId, activePlotId, reload]);

  const handleOpen = (item: RecordItem) => {
    if (item.kind === 'session') router.push(`/session/${item.id}` as Href);
    else router.push(`/plot/${item.id}` as Href);
  };

  const handleRowTap = (item: RecordItem) => {
    if (selectMode) {
      selectToggle(selectionKey(item.kind, item.id));
      return;
    }
    handleOpen(item);
  };

  const handleRowLongPress = (item: RecordItem) => {
    if (selectMode) return;
    selectEnter(selectionKey(item.kind, item.id));
  };

  const shareBundle = async (
    bundleFn: () => Promise<{ uri: string; filename: string; mimeType: string }>,
  ) => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportProgress({ label: '準備中…' });
    try {
      const file = await bundleFn();
      // Dismiss the progress Modal AND wait for it to finish animating out.
      // iOS can't present the native share sheet on top of a Modal that is
      // still on screen / mid-dismiss, so the sheet would silently never show.
      setExportProgress(null);
      await new Promise((r) => setTimeout(r, 450));
      const ok = await Sharing.isAvailableAsync();
      if (!ok) {
        Alert.alert('分享不可用', `已產生檔案：${file.uri}`);
      } else {
        await Sharing.shareAsync(file.uri, {
          mimeType: file.mimeType,
          dialogTitle: file.filename,
        });
      }
      toast(`匯出完成：${file.filename}`);
    } catch (e) {
      Alert.alert('匯出失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setExportProgress(null);
      setExportBusy(false);
    }
  };

  const handleExportOne = async (item: RecordItem) => {
    const bundleItem: BundleItem = { kind: item.kind, id: item.id };
    const est = await estimateBundleSize([bundleItem], { includePhotos });
    const proceed = await confirmIfLarge(est.totalBytes);
    if (!proceed) return;

    const onProgress = (p: ExportProgress) => setExportProgress(p);
    await shareBundle(() =>
      item.kind === 'session'
        ? bundleSession(item.id, { geoFormats, includePhotos, includeDocx, levels, conservationFields, onProgress })
        : bundlePlot(item.id, { geoFormats, includePhotos, includeDocx, levels, conservationFields, onProgress }),
    );
  };

  const handleExportSelection = async () => {
    if (selected.size === 0) {
      toast('沒有選取任何記錄');
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
      toast('沒有可匯出的記錄');
      return;
    }
    const est = await estimateBundleSize(bundleItems, { includePhotos });
    const proceed = await confirmIfLarge(est.totalBytes);
    if (!proceed) return;

    const onProgress = (p: ExportProgress) => setExportProgress(p);
    await shareBundle(() =>
      bundleMany(bundleItems, { geoFormats, includePhotos, includeDocx, levels, conservationFields, onProgress }),
    );
    selectClear();
  };

  function confirmIfLarge(bytes: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (bytes < 100 * 1024 * 1024) {
        resolve(true);
        return;
      }
      if (bytes >= 500 * 1024 * 1024) {
        Alert.alert(
          '匯出檔案非常大',
          `預估約 ${formatBytes(bytes)}。打包可能需要幾分鐘，且裝置可能需要較多記憶體。建議：先到偏好設定關閉「包含照片」或分批匯出。是否仍要繼續？`,
          [
            { text: '取消', style: 'cancel', onPress: () => resolve(false) },
            { text: '仍要匯出', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
        return;
      }
      Alert.alert(
        '匯出檔案較大',
        `預估約 ${formatBytes(bytes)}。是否繼續？`,
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
          { text: '繼續', onPress: () => resolve(true) },
        ],
      );
    });
  }

  const handleDelete = (item: RecordItem) => {
    const noun = item.kind === 'session' ? '名錄' : '樣區';
    Alert.alert(
      `刪除${noun}？`,
      `「${item.title}」與其下 ${item.recordCount} 筆紀錄將全部移除，無法復原。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: () => {
            if (item.kind === 'session') deleteSession(item.id);
            else deletePlotSurvey(item.id);
            reload();
          },
        },
      ],
    );
  };

  const flatRowsForGrouped = viewMode === 'byProject' ? buildFlatRows(groups) : [];
  const isEmpty = viewMode === 'flat' ? items.length === 0 : groups.length === 0;

  const renderRow = (item: RecordItem, showProject: boolean) => {
    const key = selectionKey(item.kind, item.id);
    return (
      <SwipeRowActions
        disabled={selectMode}
        actions={[
          {
            label: '匯出',
            icon: 'share-outline',
            color: 'blue',
            onPress: () => handleExportOne(item),
          },
          {
            label: '刪除',
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
              <Text className="text-base font-medium text-blue-600 dark:text-blue-400">取消</Text>
            </Pressable>
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              已選 {selected.size}
            </Text>
            <Pressable
              onPress={handleExportSelection}
              disabled={selected.size === 0 || exportBusy}
              hitSlop={8}
            >
              <Text
                className={`text-base font-medium ${selected.size === 0 || exportBusy ? 'text-gray-400 dark:text-gray-600' : 'text-blue-600 dark:text-blue-400'}`}
              >
                匯出
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">記錄</Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => router.push('/favorites')}
                hitSlop={8}
                className="flex-row items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 active:bg-amber-100 dark:active:bg-amber-900/60"
              >
                <Ionicons name="star" size={14} color="#d97706" />
                <Text className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-300">常用名錄</Text>
              </Pressable>
              <Pressable
                onPress={() => setPrefOpen(true)}
                hitSlop={8}
                className="rounded-full bg-gray-100 dark:bg-gray-800 p-1.5 active:bg-gray-200 dark:active:bg-gray-700"
              >
                <Ionicons name="settings-outline" size={16} color="#4b5563" />
              </Pressable>
              <Pressable
                onPress={() => setViewMode((m) => (m === 'flat' ? 'byProject' : 'flat'))}
                className="flex-row items-center rounded-full bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 active:bg-blue-100 dark:active:bg-blue-900/60"
              >
                <Ionicons
                  name={viewMode === 'byProject' ? 'folder' : 'folder-outline'}
                  size={14}
                  color="#2563eb"
                />
                <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                  {viewMode === 'byProject' ? '按專案' : '時間軸'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        {selectMode ? null : (
          <>
            <Text className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {counts.all} 筆 · 名錄 {counts.session} / 樣區 {counts.plot}
            </Text>
            <View className="mt-3 flex-row gap-2">
              {(['all', 'session', 'plot'] as Filter[]).map((f) => {
                const on = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    className={`flex-1 items-center rounded-lg py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                  >
                    <Text className={`text-sm font-medium ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {FILTER_LABEL[f]} ({counts[f]})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </View>

      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-6">
          <Ionicons name="add-circle-outline" size={56} color="#cbd5e1" />
          <Text className="mt-3 text-base font-medium text-gray-700 dark:text-gray-300">
            {filter === 'all' ? '還沒有任何記錄' : `沒有${FILTER_LABEL[filter]}記錄`}
          </Text>
          <Text className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">按下方 + 開始新記錄</Text>
        </View>
      ) : viewMode === 'flat' ? (
        <FlatList
          data={items}
          keyExtractor={(x) => `${x.kind}-${x.id}`}
          renderItem={({ item }) => renderRow(item, false)}
        />
      ) : (
        <FlatList
          data={flatRowsForGrouped}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) => {
            if (row.kind === 'header') return <ProjectHeader group={row.group} />;
            return renderRow(row.item, true);
          }}
        />
      )}

      <ExportPreferenceSheet visible={prefOpen} onClose={() => setPrefOpen(false)} />
    </View>
  );
}
