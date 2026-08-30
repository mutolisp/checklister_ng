import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { AreaSpeciesModal } from '~/components/AreaSpeciesModal';
import type { BBox } from '~/lib/inat';
import wellknown from 'wellknown';
import { useFavorites } from '~/stores/favorites';
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
  setFavoriteFolderArea,
  updateSession,
  usesTrack,
  writePlotTrack,
  type PlotSurveyWithMeta,
  type RecordWithTaxon,
  type SessionWithStats,
  type SiteWithProject,
} from '~/db';
import { useActiveSession } from '~/stores/activeSession';
import { isRecordingTarget } from '~/lib/trackRecorder';
import { useSettings, type MapBasemap } from '~/stores/settings';
import { useToast } from '~/stores/toast';

const BASEMAP_OPTIONS: Array<{
  value: MapBasemap;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  mapType: MapType;
}> = [
  { value: 'standard', labelKey: 'map.basemapStandard', icon: 'map-outline', mapType: 'standard' },
  { value: 'satellite', labelKey: 'map.basemapSatellite', icon: 'globe-outline', mapType: 'satellite' },
  { value: 'hybrid', labelKey: 'map.basemapHybrid', icon: 'layers-outline', mapType: 'hybrid' },
  { value: 'terrain', labelKey: 'map.basemapTerrain', icon: 'trail-sign-outline', mapType: 'terrain' },
];

const SINICA_TILE_URL = 'https://gis.sinica.edu.tw/tileserver/file-exists.php?img={LAYER}-png-{z}-{x}-{y}';
// NLSC WMTS RESTful — note the WMTS tile order is z/y/x (TileMatrix/Row/Col).
const NLSC_TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/{LAYER}/default/GoogleMapsCompatible/{z}/{y}/{x}';

const DRAW_LABEL: Record<string, string> = {
  Point: 'sites.typePoint',
  LineString: 'sites.typeLineString',
  Polygon: 'sites.typePolygon',
  MultiPoint: 'sites.typeMultiPoint',
  MultiLineString: 'sites.typeMultiLineString',
  MultiPolygon: 'sites.typeMultiPolygon',
};

const SITE_COLOR = '#2563eb';
const SITE_FILL = 'rgba(37, 99, 235, 0.18)';
const DRAW_COLOR = '#dc2626';

/** Species-query overlay, kept visually distinct from the red site-drawing
 *  colour so it is obvious the queried shape is not the shape being drawn. */
const AREA_COLOR = '#059669';
const AREA_FILL = 'rgba(5,150,105,0.12)';

/** Axis-aligned bounds of the drawn points.
 *
 *  iNaturalist has no polygon parameter — only swlat/swlng + nelat/nelng or a
 *  radius — so a hand-drawn shape is queried as its bounding box. The map draws
 *  that box (see AREA_COLOR) and the modal says so in words, because silently
 *  querying a larger area than the user outlined would make the resulting
 *  species list quietly wrong. */
/**
 * Smallest span a query area may have, in degrees (~110 m).
 *
 * Tapping the same spot twice gives a box of zero width and height. That is not
 * a small query, it is a broken one: GBIF rejects it (`Too few distinct points
 * in geometry component`) and iNaturalist returns nothing at all. Widening it
 * to something a survey could plausibly mean is better than either.
 */
const MIN_SPAN_DEG = 0.001;

function bboxOf(pts: LatLng[]): BBox {
  const lats = pts.map((p) => p.latitude);
  const lngs = pts.map((p) => p.longitude);
  const span = (lo: number, hi: number): [number, number] => {
    if (hi - lo >= MIN_SPAN_DEG) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - MIN_SPAN_DEG / 2, mid + MIN_SPAN_DEG / 2];
  };
  const [swLat, neLat] = span(Math.min(...lats), Math.max(...lats));
  const [swLng, neLng] = span(Math.min(...lngs), Math.max(...lngs));
  return { swLat, swLng, neLat, neLng };
}

/**
 * The shape to query, as a closed GeoJSON Polygon that is ALWAYS valid.
 *
 * Two taps mean "this rectangle" — the toolbar says two points is enough,
 * because iNaturalist only ever uses the bounding box. Sending those two taps
 * to GBIF as a polygon produces a zero-area sliver, which it rejects with
 * `Too few distinct points in geometry component`. A ring that crosses itself
 * is rejected too (`Self-intersection at or near point …`).
 *
 * Both cases fall back to the bounding box rather than refusing. Refusing was
 * the first attempt and it dead-ends the user: they tap Done, get a toast, and
 * are left in drawing mode with no way forward except undoing vertex by vertex.
 * The bounding box is a valid answer, it is already drawn on the map, and
 * `simplified` lets the caller say plainly that it was used.
 */
function polygonOf(pts: LatLng[]): {
  polygon: { type: 'Polygon'; coordinates: [number, number][][] };
  simplified: boolean;
} {
  const distinct: [number, number][] = [];
  for (const p of pts) {
    const c: [number, number] = [p.longitude, p.latitude];
    if (!distinct.some((d) => d[0] === c[0] && d[1] === c[1])) distinct.push(c);
  }
  const boxRing = () =>
    bboxCorners(bboxOf(pts)).map((p) => [p.longitude, p.latitude] as [number, number]);
  const close = (r: [number, number][]) => {
    const first = r[0];
    const last = r[r.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) r.push(first);
    return r;
  };

  if (distinct.length < 3) {
    return { polygon: { type: 'Polygon', coordinates: [close(boxRing())] }, simplified: true };
  }
  const drawn = close([...distinct]);
  if (ringSelfIntersects(drawn)) {
    return { polygon: { type: 'Polygon', coordinates: [close(boxRing())] }, simplified: true };
  }
  return { polygon: { type: 'Polygon', coordinates: [drawn] }, simplified: false };
}

/** Do two segments properly cross? Shared endpoints do not count. */
function segmentsCross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Does the closed ring cross itself?
 *
 * GBIF rejects a self-intersecting polygon outright (`Self-intersection at or
 * near point …`), and tapping out a shape that crosses itself is easy to do by
 * accident. Checking here means the user is told while they can still fix it,
 * instead of after a failed request. O(n²) is fine: these rings are tapped by
 * hand, so n is small.
 */
function ringSelfIntersects(ring: [number, number][]): boolean {
  const n = ring.length - 1; // last point repeats the first
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

/**
 * The visible map area as a bounding box.
 *
 * `Region` is a centre plus full-width deltas, so each edge is half a delta
 * from the centre. This is the "search what I'm looking at" path: no drawing,
 * and the result is a rectangle, which both sources accept as-is.
 */
function bboxOfRegion(r: Region): BBox {
  return {
    swLat: r.latitude - r.latitudeDelta / 2,
    swLng: r.longitude - r.longitudeDelta / 2,
    neLat: r.latitude + r.latitudeDelta / 2,
    neLng: r.longitude + r.longitudeDelta / 2,
  };
}

/** bbox → the four corners react-native-maps needs to draw it. */
function bboxCorners(b: BBox): LatLng[] {
  return [
    { latitude: b.swLat, longitude: b.swLng },
    { latitude: b.swLat, longitude: b.neLng },
    { latitude: b.neLat, longitude: b.neLng },
    { latitude: b.neLat, longitude: b.swLng },
  ];
}
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
  fixed: 'map.plotFixed',
  transect: 'map.plotTransect',
  point_count: 'map.plotPointCount',
};

function basemapToMapType(b: MapBasemap): MapType {
  return BASEMAP_OPTIONS.find((o) => o.value === b)?.mapType ?? 'standard';
}

function basemapMeta(b: MapBasemap): (typeof BASEMAP_OPTIONS)[number] {
  return BASEMAP_OPTIONS.find((o) => o.value === b) ?? BASEMAP_OPTIONS[0];
}

export default function MapScreen() {
  const { t } = useTranslation();
  const initial = useSettings((s) => s.map_view);
  const setSetting = useSettings((s) => s.set);
  const settingsLoaded = useSettings((s) => s.loaded);
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const router = useRouter();
  const params = useLocalSearchParams<{ draw?: string; session?: string; favoriteArea?: string }>();
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
  /** What the current drawing is FOR. 'site' saves a 地理樣區; 'species' queries
   *  iNaturalist for what has been observed inside it. Same gesture, two
   *  terminuses — the alternative was a second drawing implementation. */
  const [drawPurpose, setDrawPurpose] = useState<'site' | 'species' | 'favoriteArea'>('site');
  /** Which 常用名錄's area is being redrawn, when handed off from favourites. */
  const favoriteAreaId = useRef<number | null>(null);
  const [areaOpen, setAreaOpen] = useState(false);
  const [areaQuery, setAreaQuery] = useState<{
    bbox: BBox;
    wkt: string;
    geojson: string;
    /** True when the drawn ring could not be used as-is (fewer than three
     *  distinct vertices, or self-intersecting) and the bounding box was
     *  substituted. The modal says so rather than letting the user believe
     *  their outline was queried. */
    simplified: boolean;
  } | null>(null);
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
    const favParam = params.favoriteArea;
    if (typeof favParam === 'string') {
      const fid = parseInt(favParam, 10);
      if (!Number.isNaN(fid)) {
        favoriteAreaId.current = fid;
        setDrawPurpose('favoriteArea');
        toast(t('areaSpecies.drawAreaHint'));
      }
    }
    setDrawMode(drawParam);
    setDrawPoints([]);
    // Clear params to prevent re-trigger
    router.setParams({ draw: undefined, session: undefined, favoriteArea: undefined });
  }, [params.draw, params.session, params.favoriteArea, router, toast, t]);

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
        Alert.alert(t('gps.permTitle'), t('gps.permMsg'));
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
      Alert.alert(t('gps.posFailTitle'), e instanceof Error ? e.message : String(e));
    }
  };

  const handlePickBasemap = async () => {
    setToolsOpen(false);
    const idx = await showActionSheet({
      title: t('map.pickBasemap'),
      options: BASEMAP_OPTIONS.map((o) => ({ label: t(o.labelKey) })),
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
      title: t('map.drawSite'),
      options: [{ label: t('sites.typePoint') }, { label: t('sites.typeLineString') }, { label: t('sites.typePolygon') }],
    });
    if (idx === 0) startDraw('Point');
    else if (idx === 1) startDraw('LineString');
    else if (idx === 2) startDraw('Polygon');
  };

  const startDraw = (
    mode: 'Point' | 'LineString' | 'Polygon',
    purpose: 'site' | 'species' = 'site',
  ) => {
    setDrawMode(mode);
    setDrawPurpose(purpose);
    setDrawPoints([]);
    toast(
      purpose === 'species'
        ? t('areaSpecies.drawHint')
        : mode === 'Point'
          ? t('map.drawTapPoint')
          : mode === 'LineString'
            ? t('map.drawTapLine')
            : t('map.drawTapPolygon'),
    );
  };

  /** Query the area currently on screen, with no drawing step at all. */
  const searchVisibleArea = () => {
    setToolsOpen(false);
    const bbox = bboxOfRegion(lastRegion.current);
    const poly = {
      type: 'Polygon' as const,
      coordinates: [
        bboxCorners(bbox)
          .map((p) => [p.longitude, p.latitude] as [number, number])
          .concat([[bbox.swLng, bbox.swLat]]),
      ],
    };
    setAreaQuery({
      bbox,
      wkt: wellknown.stringify(poly as never),
      geojson: JSON.stringify(poly),
      // A rectangle is the shape the user asked for, not a fallback.
      simplified: false,
    });
    setAreaOpen(true);
  };

  const cancelDraw = () => {
    setDrawMode(null);
    setDrawPurpose('site');
    setDrawPoints([]);
    handoffSessionId.current = null;
    favoriteAreaId.current = null;
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
    if (drawPurpose === 'favoriteArea') {
      const fid = favoriteAreaId.current;
      if (fid == null) return;
      if (drawPoints.length < 2) {
        toast(t('areaSpecies.need2'));
        return;
      }
      const { polygon, simplified } = polygonOf(drawPoints);
      // Source is cleared: the area no longer matches whatever query built the
      // list, and claiming it came from iNaturalist/GBIF would be wrong.
      setFavoriteFolderArea(fid, JSON.stringify(polygon), '');
      useFavorites.getState().refresh();
      cancelDraw();
      // No "go to" action on this one: router.back() lands the user on the
      // favourites screen already, and the action would push a duplicate.
      toast(simplified ? t('areaSpecies.areaSavedBox') : t('areaSpecies.areaSaved'));
      router.back();
      return;
    }
    if (drawPurpose === 'species') {
      // Two taps already define a rectangle, so this needs a lower floor than a
      // site polygon.
      if (drawPoints.length < 2) {
        toast(t('areaSpecies.need2'));
        return;
      }
      const { polygon, simplified } = polygonOf(drawPoints);
      setAreaQuery({
        bbox: bboxOf(drawPoints),
        // GBIF takes the drawn shape itself; iNaturalist only takes the box.
        wkt: wellknown.stringify(polygon as never),
        geojson: JSON.stringify(polygon),
        simplified,
      });
      setAreaOpen(true);
      return;
    }
    if (drawMode === 'LineString' && drawPoints.length < 2) {
      toast(t('map.lineNeed2'));
      return;
    }
    if (drawMode === 'Polygon' && drawPoints.length < 3) {
      toast(t('map.polyNeed3'));
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
      toast(t('map.boundSite'));
      router.replace(`/session/${handoff}`);
    } else {
      toast(t('map.savedSite', { name: data.name }));
    }
  };

  const handleSiteTap = async (site: SiteWithProject) => {
    const idx = await showActionSheet({
      title: site.name,
      message: `${t(DRAW_LABEL[site.geometry_type])} · ${site.project_name}${site.notes ? `\n\n${site.notes}` : ''}`,
      cancelLabel: t('common.close'),
      options: [
        { label: t('map.jumpToSite') },
        { label: t('common.delete'), destructive: true },
      ],
    });
    if (idx === 0) {
      const region = geometryBounds(parseGeometry(site));
      mapRef.current?.animateToRegion(region, 400);
    } else if (idx === 1) {
      // 2-button confirm — Alert.alert is fine here.
      Alert.alert(t('sites.deleteTitle'), t('sites.deleteMsg', { name: site.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deleteSite(site.id);
            reloadSites();
            toast(t('sites.deleted'));
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
      title: plot.plotid || t('map.plotMenuTitle', { id: plot.id }),
      message:
        t('map.plotSubtitle', { type: PLOT_TYPE_LABEL[plot.plot_type] ? t(PLOT_TYPE_LABEL[plot.plot_type]) : plot.plot_type, count: plot.species_count, project: plot.project_name }) +
        (plot.status === 'active' ? `\n\n${t('map.inProgress')}` : ''),
      cancelLabel: t('common.close'),
      options: [{ label: t('map.jumpBack') }, { label: t('map.jumpToLoc') }, { label: t('map.editLoc') }],
    });
    if (idx === 0) {
      router.push(`/plot/${plot.id}`);
    } else if (idx === 1) {
      const region = plotRegion(plot);
      if (region) mapRef.current?.animateToRegion(region, 400);
      else toast(t('map.noRecordCoord'));
    } else if (idx === 2) {
      enterPlotEdit(plot);
    }
  };

  const enterPlotEdit = async (plot: PlotSurveyWithMeta) => {
    if (usesTrack(plot)) {
      // Block editing a transect that's actively recording — trackRecorder
      // flushes writePlotTrack every few points and would clobber the edit.
      if (isRecordingTarget({ kind: 'plot', id: plot.id })) {
        Alert.alert(t('map.transectRecording'), t('map.transectRecordingMsg'));
        return;
      }
      const segs = parseTrackSegments(plot.track_geojson);
      if (segs.length === 0) {
        Alert.alert(t('map.noTrack'), t('map.noTrackMsg'));
        return;
      }
      // Pick a segment when the track has more than one (pause/resume splits).
      let segIdx = 0;
      if (segs.length > 1) {
        segIdx = await showActionSheet({
          title: t('map.pickSegTitle'),
          cancelLabel: t('common.cancel'),
          options: segs.map((s, i) => ({ label: t('map.segLabel', { n: i + 1, count: s.length }) })),
        });
        if (segIdx < 0 || segIdx >= segs.length) return; // cancelled
      }
      if (segs[segIdx].length > TRACK_EDIT_WARN_POINTS) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('map.manyPointsTitle'),
            t('map.manyPointsMsg', { count: segs[segIdx].length }),
            [
              { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('common.continue'), onPress: () => resolve(true) },
            ],
          );
        });
        if (!proceed) return;
      }
      setEditPlot(plot);
      setEditMode('track');
      setEditSegmentIndex(segIdx);
      setDrawPoints(segs[segIdx].map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
      toast(t('map.dragVertexHint'));
      return;
    }
    if (plot.decimal_latitude === null || plot.decimal_longitude === null) {
      Alert.alert(t('map.noPlotCoord'), t('map.noPlotCoordMsg'));
      return;
    }
    setEditPlot(plot);
    setEditMode('point');
    setDrawPoints([{ latitude: plot.decimal_latitude, longitude: plot.decimal_longitude }]);
    toast(t('map.dragMarkerHint'));
  };

  const cancelPlotEdit = () => {
    setEditPlot(null);
    setEditMode(null);
    setDrawPoints([]);
  };

  const savePlotEdit = () => {
    if (!editPlot || !editMode) return;
    const label = editPlot.plotid || t('map.plotMenuTitle', { id: editPlot.id });

    if (editMode === 'track') {
      if (drawPoints.length < 2) {
        toast(t('map.trackNeed2'));
        return;
      }
      Alert.alert(t('map.saveTrackTitle'), t('map.saveTrackMsg', { label }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.save'),
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
            toast(t('map.trackUpdated'));
          },
        },
      ]);
      return;
    }

    // editMode === 'point'
    if (drawPoints.length === 0) return;
    const pt = drawPoints[0];
    Alert.alert(t('map.savePosTitle'), t('map.savePosMsg', { label }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.save'),
        onPress: () => {
          updatePlotSurvey(editPlot.id, {
            decimal_latitude: pt.latitude,
            decimal_longitude: pt.longitude,
          });
          cancelPlotEdit();
          reloadPlots();
          toast(t('map.posUpdated'));
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
      title: s.name || t('map.sessionMarkerTitle', { id: s.id }),
      message:
        t('map.sessionSubtitle', { count: s.record_count, project: s.project_name }) +
        (isActive ? `\n\n${t('map.inProgress')}` : ''),
      cancelLabel: t('common.close'),
      options: [{ label: t('map.jumpBack') }, { label: t('map.jumpToLoc') }],
    });
    if (idx === 0) {
      router.push(`/session/${s.id}`);
    } else if (idx === 1) {
      const region = sessionRegion(s);
      if (region) mapRef.current?.animateToRegion(region, 400);
      else toast(t('map.noRecordCoord'));
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
        toast(t('map.notFound', { q }));
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
      toast(t('map.searchFailed', { error: e instanceof Error ? e.message : String(e) }));
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
                title={session.name || t('map.sessionMarkerTitle', { id: session.id })}
                description={t('map.sessionDesc', { count: session.record_count })}
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
              title={plot.plotid || t('map.plotMenuTitle', { id: plot.id })}
              description={t('map.plotDesc', { type: PLOT_TYPE_LABEL[plot.plot_type] ? t(PLOT_TYPE_LABEL[plot.plot_type]) : plot.plot_type, count: plot.species_count })}
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
                  Alert.alert(t('map.editPointTitle'), t('map.pointN', { n: i + 1 }), [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('map.deletePoint'),
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
        {drawMode === 'Polygon' && drawPurpose === 'site' && drawPoints.length >= 3 ? (
          <Polygon
            coordinates={drawPoints}
            strokeColor={DRAW_COLOR}
            fillColor={DRAW_FILL}
            strokeWidth={2}
          />
        ) : null}
        {/* Species query: draw BOTH shapes, because the two sources use
            different ones — the filled box is what iNaturalist is asked about,
            the outline is what GBIF is asked about. Showing only one of them
            would misrepresent whichever source the user then picks. */}
        {drawPurpose === 'species' && drawPoints.length >= 2 ? (
          <Polygon
            coordinates={bboxCorners(bboxOf(drawPoints))}
            strokeColor={AREA_COLOR}
            fillColor={AREA_FILL}
            strokeWidth={1}
          />
        ) : null}
        {(drawPurpose === 'species' || drawPurpose === 'favoriteArea') && drawPoints.length >= 3 ? (
          <Polygon
            coordinates={drawPoints}
            strokeColor={AREA_COLOR}
            fillColor="transparent"
            strokeWidth={3}
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
          <Text className="mt-3 text-sm text-gray-700 dark:text-gray-300">{t('map.loadingMap')}</Text>
          <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('map.firstLoadHint')}</Text>
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
              placeholder={t('map.searchPlaceholder')}
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
                label={t(basemapMeta(currentBasemap).labelKey)}
                onPress={handlePickBasemap}
              />
              <FabRow icon="locate" label={t('map.locate')} onPress={handleLocateMe} accent />
              <FabRow
                icon="albums-outline"
                label={sinicaLayer || nlscLayer ? t('map.layersOverlaid') : t('map.layers')}
                onPress={handleOpenLayers}
                accent={!!sinicaLayer || !!nlscLayer}
              />
              <FabRow icon="create-outline" label={t('map.drawSite')} onPress={handlePickDrawMode} />
              <FabRow
                icon="scan-outline"
                label={t('areaSpecies.fabVisible')}
                onPress={searchVisibleArea}
              />
              <FabRow
                icon="leaf-outline"
                label={t('areaSpecies.fab')}
                onPress={() => {
                  setToolsOpen(false);
                  startDraw('Polygon', 'species');
                }}
              />
              <FabRow
                icon="cloud-upload-outline"
                label={t('map.import')}
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
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
            </Pressable>
            <Text className="flex-1 text-center text-xs text-gray-700 dark:text-gray-300">
              {t('map.drawingLabel', { type: t(DRAW_LABEL[drawMode]), count: drawPoints.length })}
            </Text>
            {drawPoints.length > 0 ? (
              <Pressable onPress={undoLastPoint} hitSlop={8} className="px-2">
                <Ionicons name="arrow-undo" size={16} color="#6b7280" />
              </Pressable>
            ) : null}
            {drawMode !== 'Point' ? (
              <Pressable onPress={finishDraw} hitSlop={8} className="ml-1 rounded-full bg-blue-500 px-3 py-1 active:bg-blue-600">
                <Text className="text-xs font-semibold text-white">{t('common.done')}</Text>
              </Pressable>
            ) : null}
          </View>
          {handoffSessionId.current !== null ? (
            <View className="mt-2 rounded-full bg-emerald-500 px-3 py-1.5 shadow-md">
              <Text className="text-center text-xs font-medium text-white">
                {t('map.handoffHint', { id: handoffSessionId.current })}
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
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
            </Pressable>
            <Text className="flex-1 text-center text-xs text-gray-700 dark:text-gray-300">
              {editMode === 'track' ? t('map.editTrackHint') : t('map.editPosHint')}
            </Text>
            <Pressable
              onPress={savePlotEdit}
              hitSlop={8}
              className="ml-1 rounded-full bg-blue-500 px-3 py-1 active:bg-blue-600"
            >
              <Text className="text-xs font-semibold text-white">{t('common.save')}</Text>
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
            label: t('map.nlsc'),
            layers: NLSC_LAYERS,
            selectedId: nlscLayer,
            opacity: nlscOpacity,
            onSelect: (id) => {
              setNlscLayer(id);
              if (id) toast(t('map.overlaid'));
            },
            onOpacityChange: setNlscOpacity,
          },
          {
            key: 'sinica',
            label: t('map.sinica'),
            layers: SINICA_LAYERS,
            selectedId: sinicaLayer,
            opacity: sinicaOpacity,
            onSelect: (id) => {
              setSinicaLayer(id);
              if (id) toast(t('map.overlaid'));
            },
            onOpacityChange: setSinicaOpacity,
          },
        ]}
      />

      {drawMode && drawPurpose === 'site' ? (
        <SaveSiteModal
          visible={saveSiteOpen}
          geometryType={drawMode}
          vertexCount={drawPoints.length}
          onCancel={() => setSaveSiteOpen(false)}
          onConfirm={handleSaveSite}
        />
      ) : null}

      <AreaSpeciesModal
        visible={areaOpen}
        bbox={areaQuery?.bbox ?? null}
        wkt={areaQuery?.wkt ?? null}
        simplified={areaQuery?.simplified ?? false}
        areaGeoJson={areaQuery?.geojson ?? null}
        onClose={() => {
          setAreaOpen(false);
          setAreaQuery(null);
        }}
        onImported={(name, added) => {
          setAreaOpen(false);
          setAreaQuery(null);
          cancelDraw();
          toast(t('areaSpecies.imported', { name, count: added }), {
            action: {
              label: t('favorites.goToFavorites'),
              onPress: () => router.push('/favorites'),
            },
          });
        }}
      />

      <GeoImportModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onCommitted={(n) => {
          reloadSites();
          if (n > 0) toast(t('map.imported', { count: n }));
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
