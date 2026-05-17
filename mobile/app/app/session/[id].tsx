import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { KeyboardStickyView } from '~/components/KeyboardAvoidingView';
import { showActionSheet } from '~/components/ActionSheet';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  addRecord,
  deleteRecord,
  deleteSession,
  endSession,
  getActiveSession,
  getProject,
  getSession,
  getSite,
  isTaxonInSession,
  listSessionRecords,
  reopenSession,
  updateRecordAttributes,
  updateRecordLocation,
  updateRecordNotes,
  updateRecordPhotos,
  parsePhotoPaths,
  updateSession,
  type Project,
  type RecordWithTaxon,
  type Session,
  type Site,
  type SearchResult,
} from '~/db';
import { SearchBox } from '~/components/SearchBox';
import { SpeciesCard } from '~/components/SpeciesCard';
import { SpeciesDetailSheet } from '~/components/SpeciesDetailSheet';
import { LookupResultSheet } from '~/components/LookupResultSheet';
import { NotesEditModal } from '~/components/NotesEditModal';
import { EndSessionModal } from '~/components/EndSessionModal';
import { ProjectAssignSheet } from '~/components/ProjectAssignSheet';
import { SiteAssignSheet } from '~/components/SiteAssignSheet';
import { BatchImportModal } from '~/components/BatchImportModal';
import { SwipeRow } from '~/components/SwipeRow';
import { useSettings, type RecordSort } from '~/stores/settings';
import { useToast } from '~/stores/toast';
import { useActiveSession } from '~/stores/activeSession';

const SORT_LABEL: Record<RecordSort, string> = {
  observed: '加入順序',
  cname: '俗名',
  name: '學名',
  family: '科',
};

function sortRecords(rs: RecordWithTaxon[], order: RecordSort): RecordWithTaxon[] {
  const cmp = (a: string, b: string) => a.localeCompare(b);
  const arr = [...rs];
  switch (order) {
    case 'cname':
      return arr.sort((a, b) => cmp(a.common_name_c || a.simple_name, b.common_name_c || b.simple_name));
    case 'name':
      return arr.sort((a, b) => cmp(a.simple_name, b.simple_name));
    case 'family':
      return arr.sort((a, b) => {
        const f = cmp(a.family || '', b.family || '');
        if (f !== 0) return f;
        return cmp(a.simple_name, b.simple_name);
      });
    case 'observed':
    default:
      return arr.sort((a, b) => a.observed_at - b.observed_at);
  }
}

const HIGH_LEVEL_GROUPS: Array<{ key: string; label: string; field: 'kingdom' | 'phylum' | 'class' | 'order'; value: string }> = [
  { key: 'plantae', label: '植物', field: 'kingdom', value: 'Plantae' },
  { key: 'aves', label: '鳥類', field: 'class', value: 'Aves' },
  { key: 'mammalia', label: '哺乳', field: 'class', value: 'Mammalia' },
  { key: 'reptilia', label: '爬蟲', field: 'class', value: 'Reptilia' },
  { key: 'amphibia', label: '兩棲', field: 'class', value: 'Amphibia' },
  { key: 'insecta', label: '昆蟲', field: 'class', value: 'Insecta' },
  { key: 'fish', label: '魚類', field: 'class', value: 'Actinopterygii' },
  { key: 'fungi', label: '真菌', field: 'kingdom', value: 'Fungi' },
];

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id as string, 10);
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const refreshActive = useActiveSession((s) => s.refresh);
  // KSV offset compensation: the outer <SafeAreaView edges={['bottom']}>
  // pulls the container bottom up by safe-area-bottom (~34px home indicator
  // on iPhone). Without re-adding this as `opened` offset, the search box
  // floats that gap above the keyboard top. Same family of bug as the tabs'
  // tabBarHeight gap fix in taxonomy.tsx / KeyListView / SpeciesSearchPanel.
  const insets = useSafeAreaInsets();

  const [session, setSession] = useState<Session | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [records, setRecords] = useState<RecordWithTaxon[]>([]);
  const [filterKey, setFilterKey] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<RecordWithTaxon | null>(null);
  const [notesEditing, setNotesEditing] = useState<RecordWithTaxon | null>(null);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [siteSheetOpen, setSiteSheetOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [searchPreview, setSearchPreview] = useState<SearchResult | null>(null);
  const [tracking, setTracking] = useState(false);
  const [trackCount, setTrackCount] = useState(0);
  const trackSubRef = useRef<Location.LocationSubscription | null>(null);
  const trackPointsRef = useRef<[number, number][]>([]);
  const sortOrder = useSettings((s) => s.last_record_sort);
  const setSetting = useSettings((s) => s.set);

  const reload = useCallback(() => {
    const s = getSession(sessionId);
    setSession(s);
    setProject(s ? getProject(s.project_id) : null);
    setSite(s && s.site_id !== null ? getSite(s.site_id) : null);
    setRecords(listSessionRecords(sessionId));
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      reload();
      refreshActive();
    }, [reload, refreshActive]),
  );

  const filtered = useMemo(() => {
    let result = records;
    if (filterKey) {
      const group = HIGH_LEVEL_GROUPS.find((g) => g.key === filterKey);
      if (group) result = records.filter((r) => r[group.field] === group.value);
    }
    return sortRecords(result, sortOrder);
  }, [records, filterKey, sortOrder]);

  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of HIGH_LEVEL_GROUPS) map.set(g.key, 0);
    for (const r of records) {
      for (const g of HIGH_LEVEL_GROUPS) {
        if (r[g.field] === g.value) map.set(g.key, (map.get(g.key) ?? 0) + 1);
      }
    }
    return map;
  }, [records]);

  const handleAdd = (result: SearchResult) => {
    if (!result.taxon_id) {
      toast('此物種無 taxon_id，無法加入');
      return;
    }
    if (isTaxonInSession(sessionId, result.taxon_id)) {
      toast(`已存在：${result.cname || result.name}`);
      return;
    }
    const recordId = addRecord({ session_id: sessionId, taxon_id: result.taxon_id });
    reload();
    toast(`已加入：${result.cname || result.name}`, {
      action: {
        label: 'UNDO',
        onPress: () => {
          deleteRecord(recordId);
          reload();
        },
      },
    });
  };

  const handleSwipeRemove = (record: RecordWithTaxon) => {
    deleteRecord(record.id);
    reload();
    toast(`已移除：${record.common_name_c || record.simple_name}`, {
      action: {
        label: 'UNDO',
        onPress: () => {
          if (record.taxon_id) {
            addRecord({ session_id: sessionId, taxon_id: record.taxon_id, notes: record.notes });
            reload();
          }
        },
      },
    });
  };

  const handleEnd = () => setEndModalOpen(true);

  const handleEndConfirm = (data: { name: string; project_id: number; notes: string }) => {
    if (session) {
      endSession(session.id, data);
      refreshActive();
      setEndModalOpen(false);
      router.back();
    }
  };

  const handleSaveActiveNotes = (newNotes: string) => {
    if (!activeRecord) return;
    updateRecordNotes(activeRecord.id, newNotes || null);
    setActiveRecord({ ...activeRecord, notes: newNotes || null });
    reload();
  };

  const handleAddPhoto = async (mode: 'camera' | 'library') => {
    if (!activeRecord) return;
    try {
      const { captureAndSavePhoto, pickPhotos, buildContext } = await import(
        '~/lib/photoCapture'
      );
      const ctx = buildContext(activeRecord);
      let newUris: string[] = [];
      if (mode === 'camera') {
        const uri = await captureAndSavePhoto(ctx);
        if (uri) newUris = [uri];
      } else {
        newUris = await pickPhotos();
      }
      if (newUris.length === 0) return;
      const existing = parsePhotoPaths(activeRecord.photo_paths);
      const next = [...existing, ...newUris];
      updateRecordPhotos(activeRecord.id, next);
      setActiveRecord({ ...activeRecord, photo_paths: JSON.stringify(next) });
      reload();
      toast(
        mode === 'camera'
          ? '已存入相簿並關聯'
          : newUris.length === 1
            ? '已加入照片'
            : `已加入 ${newUris.length} 張照片`,
      );
    } catch (e) {
      Alert.alert('無法加入照片', e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemovePhoto = (uri: string) => {
    if (!activeRecord) return;
    const existing = parsePhotoPaths(activeRecord.photo_paths);
    const next = existing.filter((u) => u !== uri);
    updateRecordPhotos(activeRecord.id, next);
    setActiveRecord({
      ...activeRecord,
      photo_paths: next.length > 0 ? JSON.stringify(next) : null,
    });
    reload();
    toast('已移除照片');
  };

  const handleSaveLongPressNotes = (newNotes: string) => {
    if (!notesEditing) return;
    updateRecordNotes(notesEditing.id, newNotes || null);
    if (activeRecord?.id === notesEditing.id) {
      setActiveRecord({ ...notesEditing, notes: newNotes || null });
    }
    setNotesEditing(null);
    reload();
  };

  const handleAssignProject = (projectId: number) => {
    if (!session) return;
    updateSession(session.id, { project_id: projectId });
    setProjectSheetOpen(false);
    reload();
    toast('已更新專案');
  };

  // ── GPS ───────────────────────────────────────────────────────

  const ensureForegroundPermission = async (): Promise<boolean> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        '需要定位權限',
        '請至 設定 → Checklister → 位置 開啟「使用 App 期間」',
      );
      return false;
    }
    return true;
  };

  const handleDropPoint = async () => {
    if (!session) return;
    const ok = await ensureForegroundPermission();
    if (!ok) return;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      updateSession(session.id, {
        start_lat: pos.coords.latitude,
        start_lng: pos.coords.longitude,
      });
      reload();
      toast('已記錄目前位置');
    } catch (e) {
      Alert.alert('無法取得位置', e instanceof Error ? e.message : String(e));
    }
  };

  const buildTrackGeoJSON = (pts: [number, number][]): string => {
    if (pts.length === 0) return '';
    return JSON.stringify({ type: 'LineString', coordinates: pts });
  };

  const parseTrackGeoJSON = (s: string | null): [number, number][] => {
    if (!s) return [];
    try {
      const g = JSON.parse(s);
      if (g?.type === 'LineString' && Array.isArray(g.coordinates)) return g.coordinates;
    } catch {
      // ignore
    }
    return [];
  };

  const persistTrack = useCallback(
    (sessionId: number) => {
      updateSession(sessionId, {
        track_geojson: buildTrackGeoJSON(trackPointsRef.current),
        gps_mode: 'full_track',
      });
    },
    [],
  );

  const handleStartTrack = async () => {
    if (!session) return;
    const ok = await ensureForegroundPermission();
    if (!ok) return;
    // Resume from existing track if present.
    trackPointsRef.current = parseTrackGeoJSON(session.track_geojson);
    setTrackCount(trackPointsRef.current.length);
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 5, // meters
          timeInterval: 4000,
        },
        (loc) => {
          const next: [number, number] = [loc.coords.longitude, loc.coords.latitude];
          trackPointsRef.current.push(next);
          setTrackCount(trackPointsRef.current.length);
          // Persist every ~5 points to limit DB writes.
          if (trackPointsRef.current.length % 5 === 0) {
            persistTrack(session.id);
          }
        },
      );
      trackSubRef.current = sub;
      setTracking(true);
      toast('開始軌跡錄製');
    } catch (e) {
      Alert.alert('無法啟動軌跡', e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopTrack = useCallback(() => {
    if (trackSubRef.current) {
      trackSubRef.current.remove();
      trackSubRef.current = null;
    }
    setTracking(false);
    if (session) {
      persistTrack(session.id);
      reload();
      toast(`軌跡已存檔（${trackPointsRef.current.length} 點）`);
    }
  }, [session, persistTrack, reload, toast]);

  // Stop tracking when this screen unmounts to avoid leak.
  useEffect(() => {
    return () => {
      if (trackSubRef.current) {
        trackSubRef.current.remove();
        trackSubRef.current = null;
      }
    };
  }, []);

  const handleClearGps = () => {
    if (!session) return;
    Alert.alert('清除此記錄的空間資料？', '樣區指派、起點與軌跡都會被移除（樣區本身不會刪除）', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          if (tracking) handleStopTrack();
          trackPointsRef.current = [];
          setTrackCount(0);
          updateSession(session.id, {
            site_id: null,
            start_lat: null,
            start_lng: null,
            track_geojson: null,
            gps_mode: null,
          });
          reload();
          toast('已清除空間資料');
        },
      },
    ]);
  };

  /** Create a Point site from current GPS and assign to this session. */
  const handleCreatePointSiteFromGps = async () => {
    if (!session) return;
    const ok = await ensureForegroundPermission();
    if (!ok) return;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const { createSite } = await import('~/db');
      const stamp = new Date().toLocaleString('zh-TW', { hour12: false }).slice(0, 16);
      const newSiteId = createSite({
        project_id: session.project_id,
        session_id: session.id,
        name: `${session.name} · ${stamp}`,
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
      updateSession(session.id, { site_id: newSiteId, start_lat: lat, start_lng: lng });
      reload();
      toast('已建立 Point 樣區並指派');
    } catch (e) {
      Alert.alert('無法取得位置', e instanceof Error ? e.message : String(e));
    }
  };

  const handleSpatialMenu = async () => {
    if (!session) return;
    const trackHasData = trackCount > 0 || (session.track_geojson ?? '').length > 0;
    const hasPoint = session.start_lat !== null && session.start_lng !== null;
    const hasSite = session.site_id !== null;
    const hasAnySpatial = hasPoint || hasSite || trackHasData;

    const options: Array<{ label: string; action: () => void; destructive?: boolean }> = [
      {
        label: hasSite ? `指定樣區（目前：${site?.name ?? ''}）` : '指定 / 新建樣區',
        action: () => setSiteSheetOpen(true),
      },
      {
        label: '從當前位置建立 Point 樣區',
        action: handleCreatePointSiteFromGps,
      },
      {
        label: hasPoint ? '重新定位起點' : '定位當前位置（不建樣區）',
        action: handleDropPoint,
      },
      tracking
        ? { label: `停止軌跡錄製（${trackCount} 點）`, action: handleStopTrack }
        : { label: trackHasData ? '繼續軌跡錄製' : '開始軌跡錄製', action: handleStartTrack },
    ];
    if (hasAnySpatial) {
      options.push({ label: '清除空間資料', action: handleClearGps, destructive: true });
    }

    const idx = await showActionSheet({
      title: '空間資料（樣區 / 起點 / 軌跡）',
      options: options.map((o) => ({ label: o.label, destructive: o.destructive })),
    });
    if (idx >= 0 && idx < options.length) options[idx].action();
  };

  const handleAssignSite = (siteId: number | null) => {
    if (!session) return;
    updateSession(session.id, { site_id: siteId });
    setSiteSheetOpen(false);
    reload();
    toast(siteId === null ? '已移除樣區指派' : '已指定樣區');
  };

  const handleCreateSiteForSession = (drawType: 'Point' | 'LineString' | 'Polygon') => {
    setSiteSheetOpen(false);
    if (!session) return;
    // Hand off to map tab in drawing mode, scoped to current session.
    router.push(`/(tabs)/map?draw=${drawType}&session=${session.id}`);
  };

  const handleReopen = () => {
    if (!session) return;
    const otherActive = getActiveSession();
    const proceed = () => {
      reopenSession(session.id);
      refreshActive();
      reload();
      toast('已重新啟用');
    };
    if (otherActive && otherActive.id !== session.id) {
      Alert.alert(
        '已有另一筆記錄正在進行',
        `「${otherActive.name}」目前進行中。要先結束它再啟用此記錄嗎？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '結束舊的並啟用',
            style: 'destructive',
            onPress: () => {
              endSession(otherActive.id);
              proceed();
            },
          },
        ],
      );
    } else {
      proceed();
    }
  };

  const handlePickSort = async () => {
    const orders: RecordSort[] = ['observed', 'cname', 'name', 'family'];
    const idx = await showActionSheet({
      title: '排序方式',
      options: orders.map((o) => ({ label: SORT_LABEL[o] })),
    });
    if (idx >= 0 && idx < orders.length) setSetting('last_record_sort', orders[idx]);
  };

  const handleLongPressRecord = async (record: RecordWithTaxon) => {
    const idx = await showActionSheet({
      title: record.common_name_c || record.simple_name,
      options: [
        { label: '編輯備註' },
        { label: '看詳細資訊' },
        { label: '從名錄移除', destructive: true },
      ],
    });
    if (idx === 0) setNotesEditing(record);
    else if (idx === 1) setActiveRecord(record);
    else if (idx === 2) handleSwipeRemove(record);
  };

  if (!session) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <Text className="text-gray-500 dark:text-gray-400">載入中...</Text>
      </View>
    );
  }

  const isActive = session.ended_at === null;
  const headerTitle = project && project.id !== 0 ? project.name : session.name;

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: headerTitle,
          headerRight: isActive
            ? () => (
                <Pressable onPress={handleEnd} hitSlop={8}>
                  <Text className="text-base font-medium text-red-600 dark:text-red-400">結束</Text>
                </Pressable>
              )
            : () => (
                <Pressable onPress={handleReopen} hitSlop={8} className="flex-row items-center">
                  <Ionicons name="refresh" size={16} color="#2563eb" />
                  <Text className="ml-1 text-base font-medium text-blue-600 dark:text-blue-400">繼續編輯</Text>
                </Pressable>
              ),
        }}
      />
      <View className="flex-1">
        <View className="flex-row items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2">
          {/* Left: project (icon) + spatial chip (text + state color) */}
          <View className="flex-1 flex-row items-center gap-3">
            <Pressable
              onPress={() => setProjectSheetOpen(true)}
              hitSlop={8}
              className="active:opacity-70"
            >
              <Ionicons
                name={project && project.id !== 0 ? 'folder' : 'folder-open-outline'}
                size={18}
                color={project && project.id !== 0 ? '#2563eb' : '#9ca3af'}
              />
            </Pressable>
            <Pressable
              onPress={isActive ? handleSpatialMenu : () => setSiteSheetOpen(true)}
              hitSlop={6}
              className="flex-1 flex-row items-center active:opacity-70"
            >
              {(() => {
                // Priority: tracking > site assigned > start point > empty
                if (tracking) {
                  return (
                    <>
                      <Ionicons name="radio" size={14} color="#dc2626" />
                      <Text className="ml-1 text-xs font-medium text-red-600 dark:text-red-400" numberOfLines={1}>
                        軌跡 {trackCount}
                      </Text>
                    </>
                  );
                }
                if (site) {
                  return (
                    <>
                      <Ionicons name="pin" size={14} color="#2563eb" />
                      <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300" numberOfLines={1}>
                        {site.name}
                      </Text>
                    </>
                  );
                }
                if (session.start_lat !== null) {
                  return (
                    <>
                      <Ionicons name="location" size={14} color="#2563eb" />
                      <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300" numberOfLines={1}>
                        已定位
                      </Text>
                    </>
                  );
                }
                return (
                  <>
                    <Ionicons name="pin-outline" size={14} color="#9ca3af" />
                    <Text className="ml-1 text-xs italic text-gray-500 dark:text-gray-400">空間</Text>
                  </>
                );
              })()}
            </Pressable>
          </View>
          {/* Right: count + sort icon + batch icon */}
          <View className="flex-row items-center gap-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {records.length}
              {filtered.length !== records.length ? `/${filtered.length}` : ''}
            </Text>
            <Pressable onPress={handlePickSort} hitSlop={8} className="active:opacity-70">
              <Ionicons name="swap-vertical" size={18} color="#6b7280" />
            </Pressable>
            {isActive ? (
              <Pressable
                onPress={() => setBatchImportOpen(true)}
                hitSlop={8}
                className="active:opacity-70"
              >
                <Ionicons name="cloud-upload-outline" size={18} color="#2563eb" />
              </Pressable>
            ) : null}
          </View>
        </View>
        <View className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center' }}
          >
            <Chip
              label={`全部 ${records.length}`}
              active={filterKey === null}
              onPress={() => setFilterKey(null)}
            />
            {HIGH_LEVEL_GROUPS.map((g) => {
              const count = groupCounts.get(g.key) ?? 0;
              if (count === 0) return null;
              return (
                <Chip
                  key={g.key}
                  label={`${g.label} ${count}`}
                  active={filterKey === g.key}
                  onPress={() => setFilterKey(g.key)}
                />
              );
            })}
          </ScrollView>
        </View>
        {filtered.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="search-outline" size={56} color="#9ca3af" />
            <Text className="mt-3 text-base text-gray-700 dark:text-gray-300">
              {records.length === 0 ? '按下方搜尋框找物種加入名錄' : '此分類群無記錄'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(r) => `${r.id}`}
            renderItem={({ item }) => (
              <SwipeRow onDelete={() => handleSwipeRemove(item)} label="移除">
                <SpeciesCard
                  record={item}
                  onPress={() => setActiveRecord(item)}
                  onLongPress={() => handleLongPressRecord(item)}
                />
              </SwipeRow>
            )}
          />
        )}
      </View>
      {isActive ? (
        // Sticks above the keyboard regardless of accessory-bar height
        // changes (e.g. iOS predictive suggestions). Sibling to the content
        // View, not a child, so kbd-driven translation doesn't push the
        // records list around.
        <KeyboardStickyView offset={{ opened: insets.bottom }}>
          <SearchBox
            onSelect={handleAdd}
            onLongPressResult={async (r) => {
              // iOS UIKit won't present a Modal while keyboard / Chinese IME
              // composition is still active. Dismiss first, wait one frame,
              // then mount LookupResultSheet.
              Keyboard.dismiss();
              if (Platform.OS === 'ios') await new Promise((res) => setTimeout(res, 150));
              setSearchPreview(r);
            }}
          />
        </KeyboardStickyView>
      ) : null}

      <SpeciesDetailSheet
        record={activeRecord}
        onClose={() => setActiveRecord(null)}
        onRemove={() => {
          if (activeRecord) {
            deleteRecord(activeRecord.id);
            reload();
          }
        }}
        onSaveNotes={handleSaveActiveNotes}
        onSaveLocation={(lat, lng) => {
          if (!activeRecord) return;
          updateRecordLocation(activeRecord.id, lat, lng);
          setActiveRecord({ ...activeRecord, lat, lng });
          reload();
          toast(lat === null ? '已清除座標' : '已記錄此物種座標');
        }}
        onAddPhoto={handleAddPhoto}
        onRemovePhoto={handleRemovePhoto}
        onSaveAttributes={(next) => {
          if (!activeRecord) return;
          // SpeciesAttributesDraft holds arrays in-memory; serialize before
          // writing to the TEXT column.
          const persisted = {
            sex: next.sex,
            life_stage: next.life_stage,
            reproductive_condition:
              next.reproductive_condition.length > 0
                ? JSON.stringify(next.reproductive_condition)
                : null,
            leaf_phenology:
              next.leaf_phenology.length > 0
                ? JSON.stringify(next.leaf_phenology)
                : null,
          };
          updateRecordAttributes(activeRecord.id, persisted);
          setActiveRecord({ ...activeRecord, ...persisted });
          reload();
        }}
      />

      {/* Long-press → 編輯備註 走獨立 modal（不在 detail sheet 開時）*/}
      <NotesEditModal
        visible={notesEditing !== null && !activeRecord}
        initialValue={notesEditing?.notes ?? ''}
        title={notesEditing?.common_name_c || notesEditing?.simple_name || '備註'}
        onCancel={() => setNotesEditing(null)}
        onSave={handleSaveLongPressNotes}
      />

      {endModalOpen ? (
        <EndSessionModal
          visible={endModalOpen}
          session={session}
          recordCount={records.length}
          onCancel={() => setEndModalOpen(false)}
          onConfirm={handleEndConfirm}
          onDeleteEmpty={() => {
            deleteSession(session.id);
            refreshActive();
            setEndModalOpen(false);
            router.back();
          }}
        />
      ) : null}

      <ProjectAssignSheet
        visible={projectSheetOpen}
        currentProjectId={session.project_id}
        onCancel={() => setProjectSheetOpen(false)}
        onAssign={handleAssignProject}
      />

      <SiteAssignSheet
        visible={siteSheetOpen}
        currentSiteId={session.site_id}
        preferredProjectId={session.project_id}
        onCancel={() => setSiteSheetOpen(false)}
        onAssign={handleAssignSite}
        onCreateNew={handleCreateSiteForSession}
      />

      <BatchImportModal
        visible={batchImportOpen}
        sessionId={session.id}
        onClose={() => setBatchImportOpen(false)}
        onCommitted={(added) => {
          reload();
          if (added > 0) toast(`已匯入 ${added} 筆`);
        }}
      />

      <LookupResultSheet
        result={searchPreview}
        onClose={() => setSearchPreview(null)}
        onAddToSession={() => {
          if (searchPreview) handleAdd(searchPreview);
        }}
      />
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`mr-2 rounded-full border px-3 py-1.5 ${active ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
    >
      <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>{label}</Text>
    </Pressable>
  );
}
