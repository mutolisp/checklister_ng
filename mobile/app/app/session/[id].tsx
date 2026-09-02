import { Ionicons } from '@expo/vector-icons';
import type { AdoptionInput } from '~/db';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { BackHeaderLeft, goBackOrHome } from '~/lib/goBack';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isoDateTime } from '~/lib/datetime';
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
  parseTrackSegments,
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
import { SurveyorAssignSheet } from '~/components/SurveyorAssignSheet';
import { SiteAssignSheet } from '~/components/SiteAssignSheet';
import { BatchImportModal } from '~/components/BatchImportModal';
import { SwipeRow } from '~/components/SwipeRow';
import { useSettings, type RecordSort, type SortDirection } from '~/stores/settings';
import { useToast } from '~/stores/toast';
import { useActiveSession } from '~/stores/activeSession';
import { useActivePlot } from '~/stores/activePlot';
import { useFavorites } from '~/stores/favorites';
import { toastFavoriteAdded } from '~/lib/favoritesToast';
import {
  isRecordingTarget,
  pauseIfNot,
  pauseRecording,
  startRecording,
  useTrackRecorder,
} from '~/lib/trackRecorder';

function sortRecords(
  rs: RecordWithTaxon[],
  order: RecordSort,
  direction: SortDirection,
): RecordWithTaxon[] {
  const cmp = (a: string, b: string) => a.localeCompare(b);
  const arr = [...rs];
  const sorted = (() => {
    switch (order) {
      case 'cname':
        return arr.sort((a, b) =>
          cmp(a.common_name_c || a.simple_name, b.common_name_c || b.simple_name),
        );
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
  })();
  return direction === 'desc' ? sorted.reverse() : sorted;
}

const HIGH_LEVEL_GROUPS: Array<{ key: string; field: 'kingdom' | 'phylum' | 'class' | 'order'; value: string }> = [
  { key: 'plantae', field: 'kingdom', value: 'Plantae' },
  { key: 'aves', field: 'class', value: 'Aves' },
  { key: 'mammalia', field: 'class', value: 'Mammalia' },
  { key: 'reptilia', field: 'class', value: 'Reptilia' },
  { key: 'amphibia', field: 'class', value: 'Amphibia' },
  { key: 'insecta', field: 'class', value: 'Insecta' },
  { key: 'fish', field: 'class', value: 'Actinopterygii' },
  { key: 'fungi', field: 'kingdom', value: 'Fungi' },
];

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id as string, 10);
  const router = useRouter();
  const { t } = useTranslation();
  const sortLabel: Record<RecordSort, string> = {
    observed: t('session.sortObserved'),
    cname: t('session.sortCname'),
    name: t('session.sortName'),
    family: t('session.sortFamily'),
  };
  const toast = useToast((s) => s.show);
  const refreshActive = useActiveSession((s) => s.refresh);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
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
  const [surveyorSheetOpen, setSurveyorSheetOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [searchPreview, setSearchPreview] = useState<SearchResult | null>(null);
  // Track recording lives in the module-level recorder (src/lib/trackRecorder.ts)
  // so it survives leaving this screen for the map/species tabs. Read live
  // state from the store instead of component refs.
  const recordingTarget = useTrackRecorder((s) => s.recordingTarget);
  const livePoints = useTrackRecorder((s) => s.livePoints);
  const tracking = recordingTarget?.kind === 'session' && recordingTarget.id === sessionId;
  const persistedSegs = useMemo(
    () => parseTrackSegments(session?.track_geojson ?? null),
    [session?.track_geojson],
  );
  const trackCount =
    persistedSegs.reduce((n, s) => n + s.length, 0) + (tracking ? livePoints.length : 0);
  const sortOrder = useSettings((s) => s.last_record_sort);
  const sortDir = useSettings((s) => s.last_record_sort_dir);
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
    return sortRecords(result, sortOrder, sortDir);
  }, [records, filterKey, sortOrder, sortDir]);

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

  const handleAdd = (result: SearchResult, adopted?: AdoptionInput | null) => {
    if (!result.taxon_id) {
      toast(t('session.noTaxonId'));
      return;
    }
    if (isTaxonInSession(sessionId, result.taxon_id)) {
      toast(t('session.alreadyExists', { name: result.cname || result.name }));
      return;
    }
    const recordId = addRecord({ session_id: sessionId, taxon_id: result.taxon_id, adopted });
    reload();
    toast(t('session.added', { name: result.cname || result.name }), {
      action: {
        label: t('common.undo'),
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
    toast(t('session.removed', { name: record.common_name_c || record.simple_name }), {
      action: {
        label: t('common.undo'),
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
      goBackOrHome();
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
          ? t('session.photoSavedLinked')
          : newUris.length === 1
            ? t('session.photoAdded')
            : t('session.photosAdded', { count: newUris.length }),
      );
    } catch (e) {
      Alert.alert(t('session.photoFailTitle'), e instanceof Error ? e.message : String(e));
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
    toast(t('session.photoRemoved'));
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
    toast(t('session.projectUpdated'));
  };

  // ── GPS ───────────────────────────────────────────────────────

  const ensureForegroundPermission = async (): Promise<boolean> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('gps.permTitle'), t('gps.permMsg'));
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
      toast(t('gps.posRecorded'));
    } catch (e) {
      Alert.alert(t('gps.posFailTitle'), e instanceof Error ? e.message : String(e));
    }
  };

  const handleStartTrack = async () => {
    if (!session) return;
    // Single recorder: block if another record is already recording. The
    // recorder owns permission prompting (throws '需要定位權限').
    if (recordingTarget && !(recordingTarget.kind === 'session' && recordingTarget.id === session.id)) {
      Alert.alert(t('gps.trackBusyTitle'), t('gps.trackBusyMsg'));
      return;
    }
    try {
      // Resume (if a track already exists) is handled inside the recorder,
      // which loads prior segments and appends a new one.
      await startRecording({ kind: 'session', id: session.id });
      toast(t('gps.trackStarted'));
    } catch (e) {
      Alert.alert(t('gps.trackStartFail'), e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopTrack = useCallback(() => {
    if (isRecordingTarget({ kind: 'session', id: sessionId })) {
      pauseRecording(); // commits the in-progress segment
    }
    reload();
    toast(t('gps.trackSaved'));
  }, [sessionId, reload, toast]);

  const handleClearGps = () => {
    if (!session) return;
    Alert.alert(t('gps.clearTitle'), t('gps.clearMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.clear'),
        style: 'destructive',
        onPress: () => {
          // Tear down the watch first so it can't re-write the row after we
          // null it out below.
          if (tracking) pauseRecording();
          updateSession(session.id, {
            site_id: null,
            start_lat: null,
            start_lng: null,
            track_geojson: null,
            gps_mode: null,
          });
          reload();
          toast(t('gps.cleared'));
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
      const stamp = isoDateTime(Date.now());
      const newSiteId = createSite({
        project_id: session.project_id,
        session_id: session.id,
        name: `${session.name} · ${stamp}`,
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
      updateSession(session.id, { site_id: newSiteId, start_lat: lat, start_lng: lng });
      reload();
      toast(t('session.pointSiteCreated'));
    } catch (e) {
      Alert.alert(t('gps.posFailTitle'), e instanceof Error ? e.message : String(e));
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
        label: hasSite ? t('session.assignSiteCurrent', { name: site?.name ?? '' }) : t('session.assignOrCreateSite'),
        action: () => setSiteSheetOpen(true),
      },
      {
        label: t('session.createPointSiteFromGps'),
        action: handleCreatePointSiteFromGps,
      },
      {
        label: hasPoint ? t('session.relocateStart') : t('session.locateNoSite'),
        action: handleDropPoint,
      },
      tracking
        ? { label: t('session.stopTrack', { count: trackCount }), action: handleStopTrack }
        : { label: trackHasData ? t('session.resumeTrack') : t('session.startTrack'), action: handleStartTrack },
    ];
    if (hasAnySpatial) {
      options.push({ label: t('session.clearSpatial'), action: handleClearGps, destructive: true });
    }

    const idx = await showActionSheet({
      title: t('session.spatialMenuTitle'),
      options: options.map((o) => ({ label: o.label, destructive: o.destructive })),
    });
    if (idx >= 0 && idx < options.length) options[idx].action();
  };

  const handleAssignSite = (siteId: number | null) => {
    if (!session) return;
    updateSession(session.id, { site_id: siteId });
    setSiteSheetOpen(false);
    reload();
    toast(siteId === null ? t('session.siteUnassigned') : t('session.siteAssigned'));
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
      // Reopen force-ends any other active record DB-side; stop a GPS watch
      // that belongs to something other than this session so it can't keep
      // writing to a now-ended record.
      pauseIfNot({ kind: 'session', id: session.id });
      reopenSession(session.id);
      // Reopen force-ends any active plot DB-side too, so refresh both stores
      // — otherwise activePlot store keeps the stale plot reference and the
      // ActiveSessionBar / StalePlotWatcher misbehave until the next nav.
      refreshActive();
      refreshActivePlot();
      reload();
      toast(t('session.reopened'));
    };
    if (otherActive && otherActive.id !== session.id) {
      Alert.alert(
        t('session.otherActiveTitle'),
        t('session.otherActiveMsg', { name: otherActive.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('session.endOldAndReopen'),
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
      title: t('session.sortTitle'),
      options: orders.map((o) => ({
        label:
          o === sortOrder
            ? t('session.sortActiveHint', { label: sortLabel[o] })
            : sortLabel[o],
      })),
    });
    if (idx < 0 || idx >= orders.length) return;
    const picked = orders[idx];
    if (picked === sortOrder) {
      // Tap the active sort again → flip direction.
      setSetting('last_record_sort_dir', sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSetting('last_record_sort', picked);
      // Reset direction to that sort's natural default — observed goes
      // newest-first; everything else goes A→Z.
      setSetting('last_record_sort_dir', picked === 'observed' ? 'desc' : 'asc');
    }
  };

  const handleToggleSortDir = () => {
    setSetting('last_record_sort_dir', sortDir === 'asc' ? 'desc' : 'asc');
  };

  const handleLongPressRecord = async (record: RecordWithTaxon) => {
    const fav = useFavorites.getState().ids.has(record.taxon_id);
    const idx = await showActionSheet({
      title: record.common_name_c || record.simple_name,
      options: [
        { label: t('session.editNotes') },
        { label: fav ? t('favorites.remove') : t('favorites.add') },
        { label: t('session.viewDetails') },
        { label: t('session.removeFromList'), destructive: true },
      ],
    });
    if (idx === 0) setNotesEditing(record);
    else if (idx === 1) {
      if (fav) {
        useFavorites.getState().remove(record.taxon_id);
        toast(t('favorites.removed'));
      } else {
        if (useFavorites.getState().addById(record.taxon_id)) toastFavoriteAdded();
        else toast(t('favorites.addFail'));
      }
    } else if (idx === 2) setActiveRecord(record);
    else if (idx === 3) handleSwipeRemove(record);
  };

  if (!session) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <Stack.Screen options={{ title: t('nav.session'), headerLeft: BackHeaderLeft }} />
        <Text className="text-gray-500 dark:text-gray-400">{t('common.loading')}</Text>
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
          // Override the default chevron back so a fresh deep-link / replace
          // entry doesn't strand the user with a dead button.
          headerLeft: BackHeaderLeft,
          headerRight: isActive
            ? () => (
                <Pressable onPress={handleEnd} hitSlop={8}>
                  <Text className="text-base font-medium text-red-600 dark:text-red-400">{t('session.end')}</Text>
                </Pressable>
              )
            : () => (
                <Pressable onPress={handleReopen} hitSlop={8} className="flex-row items-center">
                  <Ionicons name="refresh" size={16} color="#2563eb" />
                  <Text className="ml-1 text-base font-medium text-blue-600 dark:text-blue-400">{t('session.continueEdit')}</Text>
                </Pressable>
              ),
        }}
      />
      <View className="flex-1">
        {/* Row 1 — identity: project · spatial · surveyor (full width so the
            long surveyor name has room and no longer squeezes the controls). */}
        <View className="flex-row items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2">
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
            className="shrink flex-row items-center active:opacity-70"
          >
            {(() => {
              // Priority: tracking > site assigned > start point > empty
              if (tracking) {
                return (
                  <>
                    <Ionicons name="radio" size={14} color="#dc2626" />
                    <Text className="ml-1 text-xs font-medium text-red-600 dark:text-red-400" numberOfLines={1}>
                      {t('session.trackBadge', { count: trackCount })}
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
                      {t('session.located')}
                    </Text>
                  </>
                );
              }
              return (
                <>
                  <Ionicons name="pin-outline" size={14} color="#9ca3af" />
                  <Text className="ml-1 text-xs italic text-gray-500 dark:text-gray-400">{t('session.spatial')}</Text>
                </>
              );
            })()}
          </Pressable>
          <Pressable
            onPress={() => setSurveyorSheetOpen(true)}
            hitSlop={6}
            className="flex-1 flex-row items-center active:opacity-70"
          >
            <Ionicons
              name="people-outline"
              size={14}
              color={session.recorded_by ? '#2563eb' : '#9ca3af'}
            />
            <Text
              className={`ml-1 flex-1 text-xs ${session.recorded_by ? 'font-medium text-blue-700 dark:text-blue-300' : 'italic text-gray-500 dark:text-gray-400'}`}
              numberOfLines={1}
            >
              {session.recorded_by || t('session.surveyor')}
            </Text>
          </Pressable>
        </View>
        {/* Row 2 — filter chips (scrollable) + sort + batch import. */}
        <View className="flex-row items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center' }}
          >
            <Chip
              label={`${t('records.filterAll')} ${records.length}`}
              active={filterKey === null}
              onPress={() => setFilterKey(null)}
            />
            {HIGH_LEVEL_GROUPS.map((g) => {
              const count = groupCounts.get(g.key) ?? 0;
              if (count === 0) return null;
              return (
                <Chip
                  key={g.key}
                  label={`${t('group.' + g.key)} ${count}`}
                  active={filterKey === g.key}
                  onPress={() => setFilterKey(g.key)}
                />
              );
            })}
          </ScrollView>
          <View className="flex-row items-center gap-3 pl-2 pr-3">
            <Pressable onPress={handlePickSort} hitSlop={8} className="flex-row items-center active:opacity-70">
              <Ionicons name="swap-vertical" size={18} color="#6b7280" />
              <Text className="ml-0.5 text-xs text-gray-600 dark:text-gray-400">{sortLabel[sortOrder]}</Text>
            </Pressable>
            <Pressable onPress={handleToggleSortDir} hitSlop={6} className="active:opacity-50">
              <Ionicons name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'} size={14} color="#6b7280" />
            </Pressable>
            {isActive ? (
              <Pressable onPress={() => setBatchImportOpen(true)} hitSlop={8} className="active:opacity-70">
                <Ionicons name="cloud-upload-outline" size={18} color="#2563eb" />
              </Pressable>
            ) : null}
          </View>
        </View>
        {filtered.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="search-outline" size={56} color="#9ca3af" />
            <Text className="mt-3 text-base text-gray-700 dark:text-gray-300">
              {records.length === 0 ? t('session.emptyHint') : t('session.emptyGroup')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(r) => `${r.id}`}
            renderItem={({ item }) => (
              <SwipeRow onDelete={() => handleSwipeRemove(item)} label={t('common.remove')}>
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
        onSaveLocation={(lat, lng, accuracy) => {
          if (!activeRecord) return;
          updateRecordLocation(activeRecord.id, lat, lng, accuracy);
          setActiveRecord({ ...activeRecord, lat, lng, accuracy });
          reload();
          toast(lat === null ? t('session.coordCleared') : t('session.coordRecorded'));
        }}
        onChangeLocation={(lat, lng) => {
          // Inline map edit: persist quietly (no toast), accuracy cleared since
          // a manually-placed point has no GPS-measured accuracy.
          if (!activeRecord) return;
          updateRecordLocation(activeRecord.id, lat, lng, null);
          setActiveRecord({ ...activeRecord, lat, lng, accuracy: null });
          reload();
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
        title={notesEditing?.common_name_c || notesEditing?.simple_name || t('session.notes')}
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
            goBackOrHome();
          }}
        />
      ) : null}

      <ProjectAssignSheet
        visible={projectSheetOpen}
        currentProjectId={session.project_id}
        onCancel={() => setProjectSheetOpen(false)}
        onAssign={handleAssignProject}
      />

      <SurveyorAssignSheet
        visible={surveyorSheetOpen}
        current={session.recorded_by ?? ''}
        onCancel={() => setSurveyorSheetOpen(false)}
        onAssign={(v) => {
          updateSession(session.id, { recorded_by: v || null });
          reload();
          setSurveyorSheetOpen(false);
        }}
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
        target={{ kind: 'session', sessionId: session.id }}
        onClose={() => setBatchImportOpen(false)}
        onCommitted={(added) => {
          reload();
          if (added > 0) toast(t('session.imported', { count: added }));
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
