import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SwipeRow } from '~/components/SwipeRow';
import {
  deletePlotSurvey,
  deleteSession,
  listRecords,
  listRecordsByProject,
  type ProjectGroup,
  type RecordItem,
  type RecordKind,
} from '~/db';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';

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
  const bg = active ? 'bg-emerald-50' : 'bg-gray-100';
  const iconName = kind === 'session' ? 'list' : 'grid-outline';
  return (
    <View className={`mr-3 h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
      <Ionicons name={iconName as never} size={20} color={tint} />
    </View>
  );
}

function RecordRow({
  item,
  showProject,
  onPress,
  onLongPress,
}: {
  item: RecordItem;
  showProject: boolean;
  onPress: () => void;
  onLongPress: () => void;
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
      className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3 active:bg-gray-50"
    >
      <KindIcon kind={item.kind} active={item.active} />
      <View className="flex-1">
        <View className="flex-row items-center">
          <View
            className={`mr-2 h-2 w-2 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-gray-300'}`}
          />
          <Text className="flex-shrink text-base font-medium text-gray-900" numberOfLines={1}>
            {showTimestamp ? formatTime(item.session!.started_at) : item.title}
          </Text>
          {item.active ? (
            <View className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5">
              <Text className="text-[11px] font-medium text-emerald-700">
                {item.kind === 'session' ? '記錄中' : '進行中'}
              </Text>
            </View>
          ) : null}
          {item.notReady ? (
            <View className="ml-2 rounded bg-amber-100 px-1.5 py-0.5">
              <Text className="text-[11px] font-medium text-amber-700">資訊未補齊</Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
          {showProject ? item.subtitle.replace(` · ${item.projectName}`, '') : item.subtitle}
        </Text>
        {item.startedAt > 0 ? (
          <Text className="mt-0.5 text-[11px] text-gray-400">{formatTime(item.startedAt)}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </Pressable>
  );
}

function ProjectHeader({ group }: { group: ProjectGroup }) {
  const sessionCount = group.items.filter((x) => x.kind === 'session').length;
  const plotCount = group.items.filter((x) => x.kind === 'plot').length;
  return (
    <View className="border-b border-gray-200 bg-gray-100 px-4 py-2">
      <View className="flex-row items-center">
        <Ionicons name="folder-outline" size={14} color="#4b5563" />
        <Text className="ml-1.5 text-sm font-semibold text-gray-800">{group.projectName}</Text>
        <Text className="ml-2 text-xs text-gray-500">
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
  const [filter, setFilter] = useState<Filter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [items, setItems] = useState<RecordItem[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [counts, setCounts] = useState({ all: 0, session: 0, plot: 0 });

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

  const handleOpen = (item: RecordItem) => {
    if (item.kind === 'session') router.push(`/session/${item.id}` as Href);
    else router.push(`/plot/${item.id}` as Href);
  };

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

  return (
    <View className="flex-1 bg-gray-50">
      <View className="border-b border-gray-200 bg-white px-4 py-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">記錄</Text>
          <Pressable
            onPress={() => setViewMode((m) => (m === 'flat' ? 'byProject' : 'flat'))}
            className="flex-row items-center rounded-full bg-blue-50 px-3 py-1.5 active:bg-blue-100"
          >
            <Ionicons
              name={viewMode === 'byProject' ? 'folder' : 'folder-outline'}
              size={14}
              color="#2563eb"
            />
            <Text className="ml-1 text-xs font-medium text-blue-700">
              {viewMode === 'byProject' ? '按專案' : '時間軸'}
            </Text>
          </Pressable>
        </View>
        <Text className="mt-1 text-sm text-gray-500">
          {counts.all} 筆 · 名錄 {counts.session} / 樣區 {counts.plot}
        </Text>
        <View className="mt-3 flex-row gap-2">
          {(['all', 'session', 'plot'] as Filter[]).map((f) => {
            const on = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                className={`flex-1 items-center rounded-lg py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100'}`}
              >
                <Text className={`text-sm font-medium ${on ? 'text-white' : 'text-gray-700'}`}>
                  {FILTER_LABEL[f]} ({counts[f]})
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-6">
          <Ionicons name="add-circle-outline" size={56} color="#cbd5e1" />
          <Text className="mt-3 text-base font-medium text-gray-700">
            {filter === 'all' ? '還沒有任何記錄' : `沒有${FILTER_LABEL[filter]}記錄`}
          </Text>
          <Text className="mt-2 text-center text-sm text-gray-500">按下方 + 開始新記錄</Text>
        </View>
      ) : viewMode === 'flat' ? (
        <FlatList
          data={items}
          keyExtractor={(x) => `${x.kind}-${x.id}`}
          renderItem={({ item }) => (
            <SwipeRow onDelete={() => handleDelete(item)}>
              <RecordRow
                item={item}
                showProject={false}
                onPress={() => handleOpen(item)}
                onLongPress={() => handleOpen(item)}
              />
            </SwipeRow>
          )}
        />
      ) : (
        <FlatList
          data={flatRowsForGrouped}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) => {
            if (row.kind === 'header') return <ProjectHeader group={row.group} />;
            return (
              <SwipeRow onDelete={() => handleDelete(row.item)}>
                <RecordRow
                  item={row.item}
                  showProject
                  onPress={() => handleOpen(row.item)}
                  onLongPress={() => handleOpen(row.item)}
                />
              </SwipeRow>
            );
          }}
        />
      )}
    </View>
  );
}
