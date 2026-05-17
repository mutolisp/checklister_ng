import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { SinicaLayerSheet } from '~/components/SinicaLayerSheet';
import { SaveSiteModal } from '~/components/SaveSiteModal';
import { GeoImportModal } from '~/components/GeoImportModal';
import {
  createSite,
  deleteSite,
  geometryBounds,
  geometryToPrimitives,
  listSessionRecords,
  listSites,
  parseGeometry,
  updateSession,
  type RecordWithTaxon,
  type SiteWithProject,
} from '~/db';
import { useActiveSession } from '~/stores/activeSession';
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

  // Drawing UI only produces simple types; Multi* arrive via import (KML/GPX).
  const [drawMode, setDrawMode] = useState<'Point' | 'LineString' | 'Polygon' | null>(null);
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);
  const [saveSiteOpen, setSaveSiteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sites, setSites] = useState<SiteWithProject[]>([]);
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

  useFocusEffect(
    useCallback(() => {
      reloadSites();
      if (activeSession) {
        setActiveRecords(listSessionRecords(activeSession.id));
      } else {
        setActiveRecords([]);
      }
    }, [reloadSites, activeSession]),
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
    });
  }, [currentBasemap, sinicaLayer, sinicaOpacity, setSetting]);

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
      title: '繪製樣區',
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
      toast(`已綁定樣區到記錄`);
      router.replace(`/session/${handoff}`);
    } else {
      toast(`已儲存樣區：${data.name}`);
    }
  };

  const handleSiteTap = (site: SiteWithProject) => {
    Alert.alert(
      site.name,
      `${DRAW_LABEL[site.geometry_type]} · ${site.project_name}${site.notes ? `\n\n${site.notes}` : ''}`,
      [
        { text: '關閉', style: 'cancel' },
        {
          text: '跳到此樣區',
          onPress: () => {
            const region = geometryBounds(parseGeometry(site));
            mapRef.current?.animateToRegion(region, 400);
          },
        },
        {
          text: '刪除',
          style: 'destructive',
          onPress: () => {
            Alert.alert('刪除樣區？', `「${site.name}」會被移除`, [
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
          },
        },
      ],
    );
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
        {sinicaLayer ? (
          <UrlTile
            urlTemplate={SINICA_TILE_URL.replace('{LAYER}', sinicaLayer)}
            opacity={sinicaOpacity}
            zIndex={1}
            maximumZ={19}
          />
        ) : null}

        {/* Active session GPS overlay: start point + track + per-record points */}
        {activeSession && activeSession.start_lat !== null && activeSession.start_lng !== null ? (
          <Marker
            key="session-start"
            coordinate={{ latitude: activeSession.start_lat, longitude: activeSession.start_lng }}
            title="記錄起點"
            description={activeSession.name}
            pinColor="#10b981"
            zIndex={3}
          />
        ) : null}
        {activeSession && activeSession.track_geojson ? (() => {
          try {
            const g = JSON.parse(activeSession.track_geojson);
            if (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
              return (
                <Polyline
                  key="session-track"
                  coordinates={g.coordinates.map(([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }))}
                  strokeColor="#10b981"
                  strokeWidth={4}
                  zIndex={2}
                />
              );
            }
          } catch {
            // ignore malformed
          }
          return null;
        })() : null}
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

        {/* In-progress drawing — markers are draggable; tap a marker to remove it */}
        {drawMode && drawPoints.length > 0
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
        {drawMode === 'LineString' && drawPoints.length >= 2 ? (
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
      {!searchOpen && !drawMode ? (
        <View className="absolute right-3 items-end" style={{ top: insets.top + 8 }}>
          <FabButton
            icon={toolsOpen ? 'close' : 'apps'}
            onPress={() => setToolsOpen((v) => !v)}
            accent={!toolsOpen && !!sinicaLayer}
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
                label={sinicaLayer ? '圖層 (已疊圖)' : '圖層'}
                onPress={handleOpenLayers}
                accent={!!sinicaLayer}
              />
              <FabRow icon="create-outline" label="繪製樣區" onPress={handlePickDrawMode} />
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
                為記錄 #{handoffSessionId.current} 建立樣區，完成後自動指派
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <SinicaLayerSheet
        visible={layersSheetOpen}
        selectedId={sinicaLayer}
        opacity={sinicaOpacity}
        onClose={() => setLayersSheetOpen(false)}
        onSelect={(id) => {
          setSinicaLayer(id);
          if (id) toast('已疊圖');
        }}
        onOpacityChange={setSinicaOpacity}
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
          if (n > 0) toast(`已匯入 ${n} 個樣區`);
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
