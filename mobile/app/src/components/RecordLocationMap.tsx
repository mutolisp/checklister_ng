/**
 * Inline editable mini-map for a single record's coordinate. Shown under the
 * "定位此物種 / 點選 GPS" row in both the session record sheet
 * (`SpeciesDetailSheet`) and the plot species modal (`PlotSpeciesValueModal`).
 *
 * - Tap the map to place / relocate the point; drag the red marker to fine-tune.
 * - Zoom in/out buttons (animateToRegion by delta) + basemap toggle
 *   (standard / satellite / hybrid).
 * - Expand button opens the same editor full-screen for precise work.
 * - `reference` (plot centre + point-count radius) is drawn as a non-draggable
 *   blue marker + circle for context (used by the plot flow).
 *
 * `onChange` commits the new coordinate immediately (parent persists it without
 * a toast); manual placement carries no GPS accuracy, so callers pass null.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, {
  Circle,
  Marker,
  type MapPressEvent,
  type MarkerDragStartEndEvent,
  type Region,
} from 'react-native-maps';
import { useSettings, type MapBasemap } from '~/stores/settings';
import { basemapToMapType, nextBasemap, BASEMAP_LABEL_KEY } from '~/lib/basemap';

type Reference = { center?: { lat: number; lng: number } | null; radiusM?: number | null };

type Props = {
  lat: number | null;
  lng: number | null;
  /** Commit a new coordinate (placed by tap or drag). Parent persists quietly. */
  onChange: (lat: number, lng: number) => void;
  /** Optional plot context drawn as a faint reference (non-editable). */
  reference?: Reference;
};

const INLINE_HEIGHT = 184;
const ZOOM_FACTOR = 1.8;
const MIN_DELTA = 0.0006;

export function RecordLocationMap({ lat, lng, onChange, reference }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapView = useSettings((s) => s.map_view);
  const [basemap, setBasemap] = useState<MapBasemap>(
    mapView.basemap === 'terrain' ? 'standard' : mapView.basemap,
  );
  const [fullscreen, setFullscreen] = useState(false);

  const hasPoint = lat != null && lng != null;
  // Point-centred when a coordinate exists; otherwise the user's last map view
  // (clamped tighter than the all-Taiwan default so tapping to place is usable).
  const initialRegion: Region = hasPoint
    ? { latitude: lat, longitude: lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }
    : {
        latitude: mapView.latitude,
        longitude: mapView.longitude,
        latitudeDelta: Math.min(mapView.latitudeDelta, 0.08),
        longitudeDelta: Math.min(mapView.longitudeDelta, 0.08),
      };

  const cycleBasemap = () => setBasemap((b) => nextBasemap(b));

  return (
    <View className="mt-2">
      <EditableMap
        lat={lat}
        lng={lng}
        initialRegion={initialRegion}
        onChange={onChange}
        reference={reference}
        basemap={basemap}
        onCycleBasemap={cycleBasemap}
        rounded
        onExpand={() => setFullscreen(true)}
      />
      <Text className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        {hasPoint ? t('locMap.dragHint') : t('locMap.tapToPlace')}
      </Text>

      <Modal visible={fullscreen} animationType="slide" onRequestClose={() => setFullscreen(false)}>
        {/* SafeAreaView from the context lib reports 0 insets inside a Modal
            (separate view hierarchy, no provider) — apply the top inset by hand. */}
        <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text className="text-base font-semibold text-white">{t('locMap.fullscreenTitle')}</Text>
            <Pressable onPress={() => setFullscreen(false)} hitSlop={12} className="px-3 py-1.5">
              <Text className="text-base font-semibold text-blue-400">{t('common.done')}</Text>
            </Pressable>
          </View>
          <EditableMap
            lat={lat}
            lng={lng}
            initialRegion={initialRegion}
            onChange={onChange}
            reference={reference}
            basemap={basemap}
            onCycleBasemap={cycleBasemap}
          />
        </View>
      </Modal>
    </View>
  );
}

function EditableMap({
  lat,
  lng,
  initialRegion,
  onChange,
  reference,
  basemap,
  onCycleBasemap,
  rounded,
  onExpand,
}: {
  lat: number | null;
  lng: number | null;
  initialRegion: Region;
  onChange: (lat: number, lng: number) => void;
  reference?: Reference;
  basemap: MapBasemap;
  onCycleBasemap: () => void;
  rounded?: boolean;
  onExpand?: () => void;
}) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region>(initialRegion);
  // Last coordinate this map itself committed — lets us tell our own tap/drag
  // (don't recenter) apart from an external set (GPS row → recenter).
  const lastCommittedRef = useRef<string | null>(
    lat != null && lng != null ? `${lat},${lng}` : null,
  );

  const recenter = (latitude: number, longitude: number) => {
    const r = regionRef.current;
    mapRef.current?.animateToRegion(
      { latitude, longitude, latitudeDelta: r.latitudeDelta, longitudeDelta: r.longitudeDelta },
      350,
    );
  };

  // When the coordinate changes from outside (e.g. the "點選 GPS" row), follow
  // it. Skipped for our own tap/drag, whose value we stamped in `place`.
  useEffect(() => {
    if (lat == null || lng == null) return;
    const k = `${lat},${lng}`;
    if (lastCommittedRef.current === k) return;
    lastCommittedRef.current = k;
    recenter(lat, lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const zoom = (factor: number) => {
    const r = regionRef.current;
    mapRef.current?.animateToRegion(
      {
        latitude: r.latitude,
        longitude: r.longitude,
        latitudeDelta: Math.max(r.latitudeDelta * factor, MIN_DELTA),
        longitudeDelta: Math.max(r.longitudeDelta * factor, MIN_DELTA),
      },
      200,
    );
  };

  const locateMe = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('gps.permTitle'), t('gps.permMsg'));
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      recenter(pos.coords.latitude, pos.coords.longitude);
    } catch {
      /* current location unavailable — leave the view as-is */
    }
  };

  const place = (e: MapPressEvent | MarkerDragStartEndEvent) => {
    const c = e.nativeEvent.coordinate;
    lastCommittedRef.current = `${c.latitude},${c.longitude}`;
    onChange(c.latitude, c.longitude);
  };

  const hasPoint = lat != null && lng != null;

  return (
    <View
      className={
        rounded
          ? 'overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'
          : 'flex-1'
      }
      style={rounded ? { height: INLINE_HEIGHT } : undefined}
    >
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        mapType={basemapToMapType(basemap)}
        onRegionChangeComplete={(r) => {
          regionRef.current = r;
        }}
        onPress={place}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {reference?.center ? (
          <>
            {reference.radiusM ? (
              <Circle
                center={{ latitude: reference.center.lat, longitude: reference.center.lng }}
                radius={reference.radiusM}
                strokeColor="#2563eb"
                fillColor="rgba(37,99,235,0.10)"
                strokeWidth={1}
              />
            ) : null}
            <Marker
              coordinate={{ latitude: reference.center.lat, longitude: reference.center.lng }}
              pinColor="blue"
              opacity={0.55}
              tappable={false}
            />
          </>
        ) : null}
        {hasPoint ? (
          <Marker
            coordinate={{ latitude: lat, longitude: lng }}
            draggable
            onDragEnd={place}
            pinColor="red"
            anchor={{ x: 0.5, y: 1 }}
          />
        ) : null}
      </MapView>

      {/* Basemap toggle (top-left) */}
      <View className="absolute left-1.5 top-1.5">
        <Pressable
          onPress={onCycleBasemap}
          className="flex-row items-center rounded-md bg-white/90 px-2 py-1 dark:bg-gray-900/90"
          accessibilityRole="button"
        >
          <Ionicons name="layers-outline" size={13} color="#2563eb" />
          <Text className="ml-1 text-[11px] font-medium text-gray-700 dark:text-gray-200">
            {t(BASEMAP_LABEL_KEY[basemap])}
          </Text>
        </Pressable>
      </View>

      {/* Zoom + expand controls (top-right) */}
      <View className="absolute right-1.5 top-1.5 gap-1.5">
        {onExpand ? (
          <CtrlButton icon="expand-outline" onPress={onExpand} label={t('locMap.expand')} />
        ) : null}
        <CtrlButton icon="add" onPress={() => zoom(1 / ZOOM_FACTOR)} label={t('locMap.zoomIn')} />
        <CtrlButton icon="remove" onPress={() => zoom(ZOOM_FACTOR)} label={t('locMap.zoomOut')} />
        <CtrlButton icon="locate" onPress={locateMe} label={t('locMap.locateMe')} />
      </View>
    </View>
  );
}

function CtrlButton({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-8 w-8 items-center justify-center rounded-md bg-white/90 active:bg-white dark:bg-gray-900/90"
    >
      <Ionicons name={icon} size={18} color="#374151" />
    </Pressable>
  );
}
