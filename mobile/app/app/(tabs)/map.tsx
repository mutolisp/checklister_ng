import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { showActionSheet } from '~/components/ActionSheet';
import MapView, {
  Circle,
  Marker,
  Polygon,
  Polyline,
  PROVIDER_DEFAULT,
  UrlTile,
  type LatLng,
  type MapType,
  type Region,
} from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayerSheet } from '~/components/LayerSheet';
import { SINICA_LAYERS } from '~/lib/sinicaLayers';
import { NLSC_LAYERS } from '~/lib/nlscLayers';
import { SaveSiteModal } from '~/components/SaveSiteModal';
import { GeoImportModal } from '~/components/GeoImportModal';
import {
  createSite,
  deleteSite,
  geometryBounds,
  geometryToPrimitives,
  listPlotSurveysWithMeta,
  listSessionRecords,
  listSessions,
  listSites,
  parseGeometry,
  parseTrackSegments,
  updatePlotSurvey,
  updateSession,
  usesTrack,
  writePlotTrack,
  type PlotSurveyWithMeta,
  type RecordWithTaxon,
  type SessionWithStats,
  type SiteWithProject,
} from '~/db';
import { useActiveSession } from '~/stores/activeSession';
import { useTrackRecorder } from '~/lib/trackRecorder';
import { useSettings, type MapBasemap } from '~/stores/settings';
import { useToast } from '~/stores/toast';

const BASEMAP_OPTIONS: Array<{
  value: MapBasemap;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  mapType: MapType;
}> = [
  { value: 'standard', label: '標準', icon: 'map-outline', mapType: 'standard' },
  { value: 'satellite', label: '衛星', icon: 'globe-outline', mapType: 'satellite' },
  { value: 'hybrid', label: '混合', icon: 'layers-outline', mapType: 'hybrid' },
  { value: 'terrain', label: '地形', icon: 'trail-sign-outline', mapType: 'terrain' },
];

const SINICA_TILE_URL = 'https://gis.sinica.edu.tw/tileserver/file-exists.php?img={LAYER}-png-{z}-{x}-{y}';
// NLSC WMTS RESTful — note the WMTS tile order is z/y/x (TileMatrix/Row/Col).
const NLSC_TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/{LAYER}/default/GoogleMapsCompatible/{z}/{y}/{x}';

const DRAW_LABEL: Record<string, string> = {
  Point: '點位',
  LineString: '路線',
  Polygon: '範圍',
  MultiPoint: '多點',
  MultiLineString: '多段路線',
  MultiPolygon: '多範圍',
};

const SITE_COLOR = '#2563eb';
const SITE_FILL = 'rgba(37, 99, 235, 0.18)';
const DRAW_COLOR = '#dc2626';
const DRAW_FILL = 'rgba(220, 38, 38, 0.18)';
// Plot survey overlay (distinct from site-blue / draw-red).
const PLOT_COLOR = '#7c3aed'; // violet — done plots
const PLOT_ACTIVE_COLOR = '#db2777'; // magenta — the single active plot
const PLOT_FILL = 'rgba(124, 58, 237, 0.15)'; // point_count radius circle
// Session (名錄) overlay.
const SESSION_COLOR = '#0891b2'; // cyan — done sessions
const SESSION_ACTIVE_COLOR = '#10b981'; // green — the active session

/** Soft cap above which editing a track segment warns about map jank. */
const TRACK_EDIT_WARN_POINTS = 200;

const PLOT_TYPE_LABEL: Record<string, string> = {
  fixed: '固定樣區',
  transect: '穿越線',
  point_count: '定點計數',
};

function basemapToMapType(b: MapBasemap): MapType {
  return BASEMAP_OPTIONS.find((o) => o.value === b)?.mapType ?? 'standard';
}

function basemapMeta(b: MapBasemap): (typeof BASEMAP_OPTIONS)[number] {
  return BASEMAP_OPTIONS.find((o) => o.value === b) ?? BASEMAP_OPTIONS[0];
}

export default function MapScreen() {
  const initial = useSettings((s) => s.map_view);
  const setSetting = useSettings((s) => s.set);
  const settingsLoaded = useSettings((s) => s.loaded);
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const router = useRouter();
  const params = useLocalSearchParams<{ draw?: string; session?: string }>();
  /** When set, after saving the next drawn site we bind it to this session and bounce back. */
  const handoffSessionId = useRef<number | null>(null);
  const activeSession = useActiveSession((s) => s.session);
  const [activeRecords, setActiveRecords] = useState<RecordWithTaxon[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [layersSheetOpen, setLayersSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [currentBasemap, setCurrentBasemap] = useState<MapBasemap>(initial.basemap);
  const [sinicaLayer, setSinicaLayer] = useState<string>(initial.sinica_layer);
  const [sinicaOpacity, setSinicaOpacity] = useState<number>(initial.sinica_opacity);
  const [nlscLayer, setNlscLayer] = useState<string>(initial.nlsc_layer);
  const [nlscOpacity, setNlscOpacity] = useState<number>(initial.nlsc_opacity);

  // Drawing UI only produces simple types; Multi* arrive via import (KML/GPX).
  const [drawMode, setDrawMode] = useState<'Point' | 'LineString' | 'Polygon' | null>(null);
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);
  const [saveSiteOpen, setSaveSiteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sites, setSites] = useState<SiteWithProject[]>([]);
  const [plots, setPlots] = useState<PlotSurveyWithMeta[]>([]);
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);
  // Editing an existing plot's geometry. 'point' = moving a fixed / point_count
  // marker; 'track' = dragging/deleting vertices of one transect segment.
  const [editPlot, setEditPlot] = useState<PlotSurveyWithMeta | null>(null);
  const [editMode, setEditMode] = useState<'point' | 'track' | null>(null);
  /** Which MultiLineString segment is being edited in 'track' mode. */
  const [editSegmentIndex, setEditSegmentIndex] = useState(0);
  const [mapReady, setMapReady] = useState(false);

  const mapRef = useRef<MapView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRegion = useRef<Region>({
    latitude: initial.latitude,
    longitude: initial.longitude,
    latitudeDelta: initial.latitudeDelta,
    longitudeDelta: initial.longitudeDelta,
  });

  const reloadSites = useCallback(() => setSites(listSites()), []);
  const reloadPlots = useCallback(() => setPlots(listPlotSurveysWithMeta()), []);
  const reloadSessions = useCallback(() => setSessions(listSessions()), []);

  useFocusEffect(
    useCallback(() => {
      // Don't stomp an in-progress geometry edit when the screen re-focuses.
      if (editPlot) return;
      reloadSites();
      reloadPlots();
      reloadSessions();
      if (activeSession) {
        setActiveRecords(listSessionRecords(activeSession.id));
      } else {
        setActiveRecords([]);
      }
    }, [reloadSites, reloadPlots, reloadSessions, activeSession, editPlot]),
  );

  // Safety: hide the loading overlay after a max wait if onMapReady doesn't fire (rare).
  useEffect(() => {
    const t = setTimeout(() => setMapReady(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // Handle handoff from session detail: ?draw=Polygon&session=123
  useEffect(() => {
    const drawParam = params.draw;
    const sessionParam = params.session;
    if (typeof drawParam !== 'string') return;
    if (drawParam !== 'Point' && drawParam !== 'LineString' && drawParam !== 'Polygon') return;
    if (typeof sessionParam === 'string') {
      const sid = parseInt(sessionParam, 10);
      if (!Number.isNaN(sid)) handoffSessionId.current = sid;
    }
    setDrawMode(drawParam);
    setDrawPoints([]);
    // Clear params to prevent re-trigger
    router.setParams({ draw: undefined, session: undefined });
  }, [params.draw, params.session, router]);

  useEffect(() => {
    setSetting('map_view', {
      ...lastRegion.current,
      basemap: currentBasemap,
      sinica_layer: sinicaLayer,
      sinica_opacity: sinicaOpacity,
      nlsc_layer: nlscLayer,
      nlsc_opacity: nlscOpacity,
    });
  }, [currentBasemap, sinicaLayer, sinicaOpacity, nlscLayer, nlscOpacity, setSetting]);

  // Precompute transect track projection once per plots load (not per render /
  // map pan) — JSON parse + lng/lat swap is the costly part with many plots.
  const plotRenderItems = useMemo(
    () =>
      plots.map((p) => ({
        plot: p,
        segments: usesTrack(p)
          ? parseTrackSegments(p.track_geojson).map((seg) =>
              seg.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
            )
          : [],
      })),
    [plots],
  );

  // Same precompute for session tracks (LineString or MultiLineString).
  const sessionRenderItems = useMemo(
    () =>
      sessions.map((s) => ({
        session: s,
        segments: parseTrackSegments(s.track_geojson).map((seg) =>
          seg.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
        ),
      })),
    [sessions],
  );

  if (!settingsLoaded) return <View className="flex-1 bg-gray-100 dark:bg-gray-800" />;

  const handleRegionChangeComplete = (region: Region) => {
    lastRegion.current = region;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      setSetting('map_view', {
        ...region,
        basemap: currentBasemap,
        sinica_layer: sinicaLayer,
        sinica_opacity: sinicaOpacity,
        nlsc_layer: nlscLayer,
        nlsc_opacity: nlscOpacity,
      });
    }, 600);
  };

  const handleLocateMe = async () => {
    setToolsOpen(false);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('需要定位權限', '請至 設定 → Checklister → 位置 開啟「使用 App 期間」');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion(
        {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        500,
      );
    } catch (e) {
      Alert.alert('無法取得位置', e instanceof Error ? e.message : String(e));
    }
  };

  const handlePickBasemap = async () => {
    setToolsOpen(false);
    const idx = await showActionSheet({
      title: '基底地圖',
      options: BASEMAP_OPTIONS.map((o) => ({ label: o.label })),
    });
    if (idx >= 0 && idx < BASEMAP_OPTIONS.length) setCurrentBasemap(BASEMAP_OPTIONS[idx].value);
  };

  const handleOpenLayers = () => {
    setToolsOpen(false);
    setLayersSheetOpen(true);
  };

  const handlePickDrawMode = async () => {
    setToolsOpen(false);
    const idx = await showActionSheet({
      title: '繪製地理樣區',
      options: [{ label: '點位' }, { label: '路線' }, { label: '範圍' }],
    });
    if (idx === 0) startDraw('Point');
    else if (idx === 1) startDraw('LineString');
    else if (idx === 2) startDraw('Polygon');
  };

  const startDraw = (mode: 'Point' | 'LineString' | 'Polygon') => {
    setDrawMode(mode);
    setDrawPoints([]);
    toast(
      mode === 'Point'
        ? '點選地圖定位'
        : mode === 'LineString'
          ? '依序點選地圖建立路徑（至少 2 點）'
          : '依序點選地圖建立邊界（至少 3 點）',
    );
  };

  const cancelDraw = () => {
    setDrawMode(null);
    setDrawPoints([]);
    handoffSessionId.current = null;
  };

  const handleMapPress = (e: { nativeEvent: { coordinate: LatLng } }) => {
    if (!drawMode) return;
    const coord = e.nativeEvent.coordinate;
    if (drawMode === 'Point') {
      setDrawPoints([coord]);
      setSaveSiteOpen(true);
    } else {
      setDrawPoints((prev) => [...prev, coord]);
    }
  };

  const finishDraw = () => {
    if (!drawMode) return;
    if (drawMode === 'LineString' && drawPoints.length < 2) {
      toast('路線至少需 2 個點');
      return;
    }
    if (drawMode === 'Polygon' && drawPoints.length < 3) {
      toast('範圍至少需 3 個點');
      return;
    }
    setSaveSiteOpen(true);
  };

  const undoLastPoint = () => {
    if (drawPoints.length === 0) return;
    setDrawPoints((prev) => prev.slice(0, -1));
  };

  const handleSaveSite = (data: { name: string; project_id: number; notes: string | null }) => {
    if (!drawMode || drawPoints.length === 0) return;
    let geometry;
    if (drawMode === 'Point') {
      geometry = { type: 'Point' as const, coordinates: [drawPoints[0].longitude, drawPoints[0].latitude] as [number, number] };
    } else if (drawMode === 'LineString') {
      geometry = {
        type: 'LineString' as const,
        coordinates: drawPoints.map((p) => [p.longitude, p.latitude] as [number, number]),
      };
    } else {
      // Polygon: close the ring
      const ring: [number, number][] = drawPoints.map((p) => [p.longitude, p.latitude]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      geometry = { type: 'Polygon' as const, coordinates: [ring] };
    }
    const handoff = handoffSessionId.current;
    const newSiteId = createSite({
      ...data,
      geometry,
      session_id: handoff,
    });
    cancelDraw();
    setSaveSiteOpen(false);
    reloadSites();

    if (handoff !== null) {
      // Bind site to the originating session and bounce back.
      updateSession(handoff, { site_id: newSiteId });
      handoffSessionId.current = null;
      toast(`已綁定地理樣區到記錄`);
      router.replace(`/session/${handoff}`);
    } else {
      toast(`已儲存地理樣區：${data.name}`);
    }
  };

  const handleSiteTap = async (site: SiteWithProject) => {
    const idx = await showActionSheet({
      title: site.name,
      message: `${DRAW_LABEL[site.geometry_type]} · ${site.project_name}${site.notes ? `\n\n${site.notes}` : ''}`,
      cancelLabel: '關閉',
      options: [
        { label: '跳到此地理樣區' },
        { label: '刪除', destructive: true },
      ],
    });
    if (idx === 0) {
      const region = geometryBounds(parseGeometry(site));
      mapRef.current?.animateToRegion(region, 400);
    } else if (idx === 1) {
      // 2-button confirm — Alert.alert is fine here.
      Alert.alert('刪除地理樣區？', `「${site.name}」會被移除`, [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: () => {
            deleteSite(site.id);
            reloadSites();
            toast('已刪除');
          },
        },
      ]);
    }
  };

  /** Region that fits a plot's geometry, or null if it has no coordinates. */
  const plotRegion = (plot: PlotSurveyWithMeta) => {
    if (usesTrack(plot)) {
      const segs = parseTrackSegments(plot.track_geojson);
      if (segs.length === 0) return null;
      return geometryBounds({ type: 'MultiLineString', coordinates: segs });
    }
    if (plot.decimal_latitude === null || plot.decimal_longitude === null) return null;
    return geometryBounds({
      type: 'Point',
      coordinates: [plot.decimal_longitude, plot.decimal_latitude] as [number, number],
    });
  };

  const handlePlotTap = async (plot: PlotSurveyWithMeta) => {
    const idx = await showActionSheet({
      title: plot.plotid || `樣區 #${plot.id}`,
      message:
        `${PLOT_TYPE_LABEL[plot.plot_type] ?? plot.plot_type} · 物種 ${plot.species_count} 筆 · ${plot.project_name}` +
        (plot.status === 'active' ? '\n\n（進行中）' : ''),
      cancelLabel: '關閉',
      options: [{ label: '跳回此記錄' }, { label: '跳到此位置' }, { label: '編輯位置' }],
    });
    if (idx === 0) {
      router.push(`/plot/${plot.id}`);
    } else if (idx === 1) {
      const region = plotRegion(plot);
      if (region) mapRef.current?.animateToRegion(region, 400);
      else toast('此記錄尚無座標');
    } else if (idx === 2) {
      enterPlotEdit(plot);
    }
  };

  const enterPlotEdit = async (plot: PlotSurveyWithMeta) => {
    if (usesTrack(plot)) {
      // Block editing a transect that's actively recording — trackRecorder
      // flushes writePlotTrack every few points and would clobber the edit.
      if (useTrackRecorder.getState().recordingPlotId === plot.id) {
        Alert.alert('此穿越線正在錄製中', '請先暫停軌跡錄製再編輯');
        return;
      }
      const segs = parseTrackSegments(plot.track_geojson);
      if (segs.length === 0) {
        Alert.alert('尚無軌跡', '此穿越線尚未錄製任何軌跡，無法編輯');
        return;
      }
      // Pick a segment when the track has more than one (pause/resume splits).
      let segIdx = 0;
      if (segs.length > 1) {
        segIdx = await showActionSheet({
          title: '選擇要編輯的軌跡段',
          cancelLabel: '取消',
          options: segs.map((s, i) => ({ label: `第 ${i + 1} 段（${s.length} 點）` })),
        });
        if (segIdx < 0 || segIdx >= segs.length) return; // cancelled
      }
      if (segs[segIdx].length > TRACK_EDIT_WARN_POINTS) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '軌跡點較多',
            `此段有 ${segs[segIdx].length} 個點，編輯時地圖可能較卡。仍要編輯嗎？`,
            [
              { text: '取消', style: 'cancel', onPress: () => resolve(false) },
              { text: '繼續', onPress: () => resolve(true) },
            ],
          );
        });
        if (!proceed) return;
      }
      setEditPlot(plot);
      setEditMode('track');
      setEditSegmentIndex(segIdx);
      setDrawPoints(segs[segIdx].map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
      toast('拖動頂點調整，點頂點可刪除，完成後按儲存');
      return;
    }
    if (plot.decimal_latitude === null || plot.decimal_longitude === null) {
      Alert.alert('尚無座標', '此樣區尚未取得 GPS 座標，無法編輯位置');
      return;
    }
    setEditPlot(plot);
    setEditMode('point');
    setDrawPoints([{ latitude: plot.decimal_latitude, longitude: plot.decimal_longitude }]);
    toast('拖動標記調整位置，完成後按儲存');
  };

  const cancelPlotEdit = () => {
    setEditPlot(null);
    setEditMode(null);
    setDrawPoints([]);
  };

  const savePlotEdit = () => {
    if (!editPlot || !editMode) return;
    const label = editPlot.plotid || `樣區 #${editPlot.id}`;

    if (editMode === 'track') {
      if (drawPoints.length < 2) {
        toast('軌跡段至少需 2 點');
        return;
      }
      Alert.alert('儲存軌跡變更？', `「${label}」的穿越線軌跡將被更新`, [
        { text: '取消', style: 'cancel' },
        {
          text: '儲存',
          onPress: () => {
            // Re-parse the original track, replace the edited segment, drop any
            // segment left with <2 points.
            const segs = parseTrackSegments(editPlot.track_geojson);
            segs[editSegmentIndex] = drawPoints.map((p) => [p.longitude, p.latitude]);
            writePlotTrack(
              editPlot.id,
              segs.filter((s) => s.length >= 2),
            );
            cancelPlotEdit();
            reloadPlots();
            toast('已更新軌跡');
          },
        },
      ]);
      return;
    }

    // editMode === 'point'
    if (drawPoints.length === 0) return;
    const pt = drawPoints[0];
    Alert.alert('儲存位置變更？', `「${label}」的座標將被更新`, [
      { text: '取消', style: 'cancel' },
      {
        text: '儲存',
        onPress: () => {
          updatePlotSurvey(editPlot.id, {
            decimal_latitude: pt.latitude,
            decimal_longitude: pt.longitude,
          });
          cancelPlotEdit();
          reloadPlots();
          toast('已更新樣區位置');
        },
      },
    ]);
  };

  /** Region that fits a session's geometry (track preferred, else start point). */
  const sessionRegion = (s: SessionWithStats) => {
    const segs = parseTrackSegments(s.track_geojson);
    if (segs.length > 0) return geometryBounds({ type: 'MultiLineString', coordinates: segs });
    if (s.start_lat === null || s.start_lng === null) return null;
    return geometryBounds({
      type: 'Point',
      coordinates: [s.start_lng, s.start_lat] as [number, number],
    });
  };

  const handleSessionTap = async (s: SessionWithStats) => {
    const isActive = activeSession?.id === s.id;
    const idx = await showActionSheet({
      title: s.name || `名錄 #${s.id}`,
      message:
        `名錄 · 物種 ${s.record_count} 筆 · ${s.project_name}` +
        (isActive ? '\n\n（進行中）' : ''),
      cancelLabel: '關閉',
      options: [{ label: '跳回此記錄' }, { label: '跳到此位置' }],
    });
    if (idx === 0) {
      router.push(`/session/${s.id}`);
    } else if (idx === 1) {
      const region = sessionRegion(s);
      if (region) mapRef.current?.animateToRegion(region, 400);
      else toast('此記錄尚無座標');
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    Keyboard.dismiss();
    try {
      setSearchBusy(true);
      const results = await Location.geocodeAsync(q);
      if (results.length === 0) {
        toast(`找不到「${q}」`);
        return;
      }
      const r = results[0];
      mapRef.current?.animateToRegion(
        { latitude: r.latitude, longitude: r.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 },
        500,
      );
      setSearchQuery('');
      setSearchOpen(false);
    } catch (e) {
      toast(`搜尋失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSearchBusy(false);
    }
  };

  const openSearch = () => {
    setSearchOpen(true);
    setToolsOpen(false);
    setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    Keyboard.dismiss();
  };

  return (
    <View className="flex-1 bg-gray-100 dark:bg-gray-800">
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: initial.latitude,
          longitude: initial.longitude,
          latitudeDelta: initial.latitudeDelta,
          longitudeDelta: initial.longitudeDelta,
        }}
        mapType={basemapToMapType(currentBasemap)}
        showsCompass
        showsScale
        showsUserLocation
        showsMyLocationButton={false}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleMapPress}
      >
        {nlscLayer ? (
          <UrlTile
            urlTemplate={NLSC_TILE_URL.replace('{LAYER}', nlscLayer)}
            opacity={nlscOpacity}
            zIndex={0}
            maximumZ={20}
          />
        ) : null}
        {sinicaLayer ? (
          <UrlTile
            urlTemplate={SINICA_TILE_URL.replace('{LAYER}', sinicaLayer)}
            opacity={sinicaOpacity}
            zIndex={1}
            maximumZ={19}
          />
        ) : null}

        {/* All sessions (名錄): start-point marker + track. The active session is
            colored green; its per-record species points are drawn separately
            below. Tap → info / jump to the record. */}
        {sessionRenderItems.flatMap(({ session, segments }) => {
          const isActive = activeSession?.id === session.id;
          const color = isActive ? SESSION_ACTIVE_COLOR : SESSION_COLOR;
          const els = segments
            .filter((seg) => seg.length >= 2)
            .map((seg, i) => (
              <Polyline
                key={`sess-${session.id}-${i}`}
                coordinates={seg}
                strokeColor={color}
                strokeWidth={4}
                zIndex={2}
                tappable
                onPress={() => handleSessionTap(session)}
              />
            ));
          if (session.start_lat !== null && session.start_lng !== null) {
            els.push(
              <Marker
                key={`sess-m-${session.id}`}
                coordinate={{ latitude: session.start_lat, longitude: session.start_lng }}
                title={session.name || `名錄 #${session.id}`}
                description={`名錄 · 物種 ${session.record_count} 筆`}
                pinColor={color}
                zIndex={3}
                onPress={() => handleSessionTap(session)}
              />,
            );
          }
          return els;
        })}
        {activeRecords
          .filter((r) => r.lat !== null && r.lng !== null)
          .map((r) => (
            <Marker
              key={`rec-${r.id}`}
              coordinate={{ latitude: r.lat as number, longitude: r.lng as number }}
              title={r.common_name_c || r.simple_name}
              description={r.family_c}
              pinColor="#f59e0b"
              zIndex={4}
            />
          ))}

        {/* Existing sites — Multi* geometries expand to multiple primitives */}
        {sites.flatMap((s) => {
          const primitives = geometryToPrimitives(parseGeometry(s));
          return primitives.map((prim, i) => {
            const key = `s-${s.id}-${i}`;
            if (prim.kind === 'point') {
              return (
                <Marker
                  key={key}
                  coordinate={{ latitude: prim.latitude, longitude: prim.longitude }}
                  title={s.name}
                  description={s.project_name}
                  pinColor={SITE_COLOR}
                  onPress={() => handleSiteTap(s)}
                />
              );
            }
            if (prim.kind === 'line') {
              return (
                <Polyline
                  key={key}
                  coordinates={prim.coords}
                  strokeColor={SITE_COLOR}
                  strokeWidth={3}
                  tappable
                  onPress={() => handleSiteTap(s)}
                />
              );
            }
            return (
              <Polygon
                key={key}
                coordinates={prim.coords}
                strokeColor={SITE_COLOR}
                fillColor={SITE_FILL}
                strokeWidth={2}
                tappable
                onPress={() => handleSiteTap(s)}
              />
            );
          });
        })}

        {/* Existing plot surveys — fixed/point_count markers (+ radius circle),
            transect tracks. The plot under edit is hidden here; the draggable
            marker below takes over. */}
        {plotRenderItems.flatMap(({ plot, segments }) => {
          if (editPlot && editPlot.id === plot.id) return [];
          const color = plot.status === 'active' ? PLOT_ACTIVE_COLOR : PLOT_COLOR;
          if (usesTrack(plot)) {
            return segments
              .filter((seg) => seg.length >= 2)
              .map((seg, i) => (
                <Polyline
                  key={`plot-${plot.id}-${i}`}
                  coordinates={seg}
                  strokeColor={color}
                  strokeWidth={4}
                  zIndex={5}
                  tappable
                  onPress={() => handlePlotTap(plot)}
                />
              ));
          }
          if (plot.decimal_latitude === null || plot.decimal_longitude === null) return [];
          const center = { latitude: plot.decimal_latitude, longitude: plot.decimal_longitude };
          const circle =
            plot.plot_type === 'point_count' && plot.point_radius_m && plot.point_radius_m > 0 ? (
              <Circle
                key={`plot-c-${plot.id}`}
                center={center}
                radius={plot.point_radius_m}
                strokeColor={color}
                fillColor={PLOT_FILL}
                strokeWidth={2}
                zIndex={4}
              />
            ) : null;
          return [
            circle,
            <Marker
              key={`plot-m-${plot.id}`}
              coordinate={center}
              pinColor={color}
              title={plot.plotid || `樣區 #${plot.id}`}
              description={`${PLOT_TYPE_LABEL[plot.plot_type] ?? plot.plot_type} · 物種 ${plot.species_count} 筆`}
              zIndex={5}
              onPress={() => handlePlotTap(plot)}
            />,
          ];
        })}

        {/* In-progress drawing — markers are draggable; tap a marker to remove it */}
        {(drawMode || editMode) && drawPoints.length > 0
          ? drawPoints.map((p, i) => (
              <Marker
                key={`d-${i}`}
                identifier={`d-${i}`}
                coordinate={p}
                pinColor={DRAW_COLOR}
                anchor={{ x: 0.5, y: 0.5 }}
                draggable
                onDragEnd={(e) => {
                  const next = [...drawPoints];
                  next[i] = e.nativeEvent.coordinate;
                  setDrawPoints(next);
                }}
                onPress={() => {
                  // Editing a plot's single point: drag only, never delete.
                  if (editMode === 'point') return;
                  Alert.alert('編輯點位', `第 ${i + 1} 個點`, [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '刪除此點',
                      style: 'destructive',
                      onPress: () => {
                        const next = drawPoints.filter((_, idx) => idx !== i);
                        setDrawPoints(next);
                      },
                    },
                  ]);
                }}
              />
            ))
          : null}
        {(drawMode === 'LineString' || editMode === 'track') && drawPoints.length >= 2 ? (
          <Polyline coordinates={drawPoints} strokeColor={DRAW_COLOR} strokeWidth={3} />
        ) : null}
        {drawMode === 'Polygon' && drawPoints.length >= 3 ? (
          <Polygon
            coordinates={drawPoints}
            strokeColor={DRAW_COLOR}
            fillColor={DRAW_FILL}
            strokeWidth={2}
          />
        ) : null}
      </MapView>

      {/* Loading overlay — shown until MapView fires onMapReady (or 4s fallback) */}
      {!mapReady ? (
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          className="items-center justify-center bg-gray-100 dark:bg-gray-800/85"
        >
          <ActivityIndicator size="large" color="#2563eb" />
          <Text className="mt-3 text-sm text-gray-700 dark:text-gray-300">載入地圖中...</Text>
          <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">首次開啟需數秒</Text>
        </View>
      ) : null}

      {/* Top-left: search FAB / expanded bar (visible even during drawing) */}
      <View
        className="absolute left-3"
        style={{ top: insets.top + 8, right: searchOpen ? 12 : undefined }}
      >
        {searchOpen ? (
          <View className="flex-row items-center rounded-full bg-white dark:bg-gray-900/95 px-3 py-2 shadow-md">
            <Pressable onPress={closeSearch} hitSlop={8}>
              <Ionicons name="arrow-back" size={18} color="#374151" />
            </Pressable>
            <TextInput
              ref={searchInputRef}
              className="ml-2 flex-1 text-sm text-gray-900 dark:text-gray-100"
              placeholder="搜尋地點 / 地址..."
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              autoCorrect={false}
              returnKeyType="search"
              editable={!searchBusy}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                <Ionicons name="close-circle" size={18} color="#9ca3af" />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <FabButton icon="search" onPress={openSearch} />
        )}
      </View>

      {/* Top-right: tools FAB */}
      {!searchOpen && !drawMode && !editMode ? (
        <View className="absolute right-3 items-end" style={{ top: insets.top + 8 }}>
          <FabButton
            icon={toolsOpen ? 'close' : 'apps'}
            onPress={() => setToolsOpen((v) => !v)}
            accent={!toolsOpen && (!!sinicaLayer || !!nlscLayer)}
          />

          {toolsOpen ? (
            <View className="mt-2 items-end">
              <FabRow
                icon={basemapMeta(currentBasemap).icon}
                label={basemapMeta(currentBasemap).label}
                onPress={handlePickBasemap}
              />
              <FabRow icon="locate" label="定位" onPress={handleLocateMe} accent />
              <FabRow
                icon="albums-outline"
                label={sinicaLayer || nlscLayer ? '圖層 (已疊圖)' : '圖層'}
                onPress={handleOpenLayers}
                accent={!!sinicaLayer || !!nlscLayer}
              />
              <FabRow icon="create-outline" label="繪製地理樣區" onPress={handlePickDrawMode} />
              <FabRow
                icon="cloud-upload-outline"
                label="匯入"
                onPress={() => {
                  setToolsOpen(false);
                  setImportOpen(true);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Drawing toolbar (below search FAB row) */}
      {drawMode ? (
        <View className="absolute left-3 right-3" style={{ top: insets.top + 60 }}>
          <View className="flex-row items-center rounded-full bg-white dark:bg-gray-900/95 px-3 py-2 shadow-md">
            <Pressable onPress={cancelDraw} hitSlop={8} className="px-2">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">取消</Text>
            </Pressable>
            <Text className="flex-1 text-center text-xs text-gray-700 dark:text-gray-300">
              繪製{DRAW_LABEL[drawMode]} · {drawPoints.length} 點
            </Text>
            {drawPoints.length > 0 ? (
              <Pressable onPress={undoLastPoint} hitSlop={8} className="px-2">
                <Ionicons name="arrow-undo" size={16} color="#6b7280" />
              </Pressable>
            ) : null}
            {drawMode !== 'Point' ? (
              <Pressable onPress={finishDraw} hitSlop={8} className="ml-1 rounded-full bg-blue-500 px-3 py-1 active:bg-blue-600">
                <Text className="text-xs font-semibold text-white">完成</Text>
              </Pressable>
            ) : null}
          </View>
          {handoffSessionId.current !== null ? (
            <View className="mt-2 rounded-full bg-emerald-500 px-3 py-1.5 shadow-md">
              <Text className="text-center text-xs font-medium text-white">
                為記錄 #{handoffSessionId.current} 建立地理樣區，完成後自動指派
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Edit-geometry toolbar (drag the marker, then save). */}
      {editMode ? (
        <View className="absolute left-3 right-3" style={{ top: insets.top + 60 }}>
          <View className="flex-row items-center rounded-full bg-white dark:bg-gray-900/95 px-3 py-2 shadow-md">
            <Pressable onPress={cancelPlotEdit} hitSlop={8} className="px-2">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">取消</Text>
            </Pressable>
            <Text className="flex-1 text-center text-xs text-gray-700 dark:text-gray-300">
              {editMode === 'track' ? '編輯軌跡 · 拖動/點頂點刪除' : '編輯位置 · 拖動標記'}
            </Text>
            <Pressable
              onPress={savePlotEdit}
              hitSlop={8}
              className="ml-1 rounded-full bg-blue-500 px-3 py-1 active:bg-blue-600"
            >
              <Text className="text-xs font-semibold text-white">儲存</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <LayerSheet
        visible={layersSheetOpen}
        onClose={() => setLayersSheetOpen(false)}
        sources={[
          {
            key: 'nlsc',
            label: '國土測繪中心',
            layers: NLSC_LAYERS,
            selectedId: nlscLayer,
            opacity: nlscOpacity,
            onSelect: (id) => {
              setNlscLayer(id);
              if (id) toast('已疊圖');
            },
            onOpacityChange: setNlscOpacity,
          },
          {
            key: 'sinica',
            label: '中研院',
            layers: SINICA_LAYERS,
            selectedId: sinicaLayer,
            opacity: sinicaOpacity,
            onSelect: (id) => {
              setSinicaLayer(id);
              if (id) toast('已疊圖');
            },
            onOpacityChange: setSinicaOpacity,
          },
        ]}
      />

      {drawMode ? (
        <SaveSiteModal
          visible={saveSiteOpen}
          geometryType={drawMode}
          vertexCount={drawPoints.length}
          onCancel={() => setSaveSiteOpen(false)}
          onConfirm={handleSaveSite}
        />
      ) : null}

      <GeoImportModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onCommitted={(n) => {
          reloadSites();
          if (n > 0) toast(`已匯入 ${n} 個地理樣區`);
        }}
      />
    </View>
  );
}

function FabButton({
  icon,
  onPress,
  accent = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-full bg-white dark:bg-gray-900/95 shadow-md active:bg-gray-100 dark:active:bg-gray-700"
    >
      <Ionicons name={icon} size={20} color={accent ? '#2563eb' : '#374151'} />
    </Pressable>
  );
}

function FabRow({
  icon,
  label,
  onPress,
  accent = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-2 flex-row items-center rounded-full bg-white dark:bg-gray-900/95 px-3 py-2 shadow-md active:bg-gray-100 dark:active:bg-gray-700"
    >
      <Text className={`mr-2 text-xs font-medium ${accent ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
        {label}
      </Text>
      <Ionicons name={icon} size={18} color={accent ? '#2563eb' : '#374151'} />
    </Pressable>
  );
}
