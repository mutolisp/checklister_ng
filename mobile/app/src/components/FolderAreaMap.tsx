/**
 * The map area a 常用名錄 was built from, shown at the top of that list.
 *
 * A list of species is hard to trust without knowing where it came from —
 * "why these species?" is otherwise unanswerable a week later. The area is
 * already stored (migration v25), so this makes it visible, and lets the user
 * correct it when the drawn shape was not quite what they meant.
 *
 * Controls match `RecordLocationMap` (zoom / locate / basemap / expand) and
 * come from the same module, so the two mini-maps behave identically. Editing
 * the shape is NOT done here: drawing already works on the map screen, and it
 * is the only place with the vertex handles for it.
 */
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polygon, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { geometryBounds, type GeoJSONGeometry } from '~/db';
import { basemapToMapType, nextBasemap } from '~/lib/basemap';
import { useSettings, type MapBasemap } from '~/stores/settings';
import {
  BasemapToggle,
  CtrlButton,
  ZOOM_FACTOR,
  locateMe,
  zoomBy,
} from './MapControls';

const INLINE_HEIGHT = 160;

type Props = {
  /** GeoJSON of the stored area; empty for a hand-made list. */
  areaGeoJson: string;
  /** 'inat' | 'gbif' | '' — which service produced the list. */
  source: string;
  onEdit: () => void;
};

type Coord = { latitude: number; longitude: number };

/** Every ring of the polygon(s), as react-native-maps coordinates. */
function ringsOf(g: GeoJSONGeometry): Coord[][] {
  const toRing = (ring: number[][]) =>
    ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  if (g.type === 'Polygon') return (g.coordinates as number[][][]).map(toRing);
  if (g.type === 'MultiPolygon')
    return (g.coordinates as number[][][][]).flatMap((poly) => poly.map(toRing));
  return [];
}

export function FolderAreaMap({ areaGeoJson, source, onEdit }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const storedBasemap = useSettings((s) => s.map_view.basemap);
  const [basemap, setBasemap] = useState<MapBasemap>(
    storedBasemap === 'terrain' ? 'standard' : storedBasemap,
  );
  const [fullscreen, setFullscreen] = useState(false);

  const parsed = useMemo(() => {
    if (!areaGeoJson) return null;
    try {
      return JSON.parse(areaGeoJson) as GeoJSONGeometry;
    } catch {
      // A malformed area must not take the whole list down with it.
      return null;
    }
  }, [areaGeoJson]);

  const rings = useMemo(() => (parsed ? ringsOf(parsed) : []), [parsed]);
  const region = useMemo(() => (parsed ? geometryBounds(parsed) : null), [parsed]);

  if (!parsed || !region || rings.length === 0) {
    return (
      <Pressable
        onPress={onEdit}
        className="mx-4 mb-2 mt-3 flex-row items-center justify-center rounded-xl border border-dashed border-gray-300 py-3 active:bg-gray-100 dark:border-gray-700 dark:active:bg-gray-800"
      >
        <Ionicons name="map-outline" size={16} color="#6b7280" />
        <Text className="ml-2 text-sm text-gray-600 dark:text-gray-400">
          {t('favorites.setArea')}
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="mx-4 mb-2 mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <AreaMap
        rings={rings}
        region={region}
        basemap={basemap}
        onCycleBasemap={() => setBasemap((b) => nextBasemap(b))}
        height={INLINE_HEIGHT}
        onExpand={() => setFullscreen(true)}
      />
      <View className="flex-row items-center justify-between bg-white px-3 py-2 dark:bg-gray-900">
        <Text className="text-xs text-gray-500 dark:text-gray-400">
          {source ? t('favorites.areaFrom', { source: source.toUpperCase() }) : t('favorites.area')}
        </Text>
        <Pressable onPress={onEdit} hitSlop={8} className="flex-row items-center active:opacity-70">
          <Ionicons name="create-outline" size={14} color="#2563eb" />
          <Text className="ml-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            {t('favorites.editArea')}
          </Text>
        </Pressable>
      </View>

      <Modal visible={fullscreen} animationType="slide" onRequestClose={() => setFullscreen(false)}>
        {/* SafeAreaView reports 0 insets inside a Modal (separate view
            hierarchy, no provider) — apply the top inset by hand. */}
        <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text className="text-base font-semibold text-white">{t('favorites.area')}</Text>
            <Pressable onPress={() => setFullscreen(false)} hitSlop={12} className="px-3 py-1.5">
              <Text className="text-base font-semibold text-blue-400">{t('common.done')}</Text>
            </Pressable>
          </View>
          {/* Mounted only while open. A MapView that is not on screen still
              holds MapKit resources, and this component lives inside a
              scrolling list where several can exist at once. */}
          {fullscreen ? (
            <AreaMap
              rings={rings}
              region={region}
              basemap={basemap}
              onCycleBasemap={() => setBasemap((b) => nextBasemap(b))}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function AreaMap({
  rings,
  region,
  basemap,
  onCycleBasemap,
  height,
  onExpand,
}: {
  rings: Coord[][];
  region: Region;
  basemap: MapBasemap;
  onCycleBasemap: () => void;
  /** Fixed height inline; fills its parent when omitted (fullscreen). */
  height?: number;
  onExpand?: () => void;
}) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region>(region);

  return (
    <View style={height != null ? { height } : { flex: 1 }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={region}
        mapType={basemapToMapType(basemap)}
        onRegionChangeComplete={(r) => {
          regionRef.current = r;
        }}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {rings.map((coords, i) => (
          <Polygon
            key={i}
            coordinates={coords}
            strokeColor="#059669"
            fillColor="rgba(5,150,105,0.12)"
            strokeWidth={2}
          />
        ))}
      </MapView>

      <View className="absolute left-1.5 top-1.5">
        <BasemapToggle basemap={basemap} onPress={onCycleBasemap} />
      </View>

      <View className="absolute right-1.5 top-1.5 gap-1.5">
        {onExpand ? (
          <CtrlButton icon="expand-outline" onPress={onExpand} label={t('locMap.expand')} />
        ) : null}
        <CtrlButton
          icon="add"
          onPress={() => zoomBy(mapRef, regionRef, 1 / ZOOM_FACTOR)}
          label={t('locMap.zoomIn')}
        />
        <CtrlButton
          icon="remove"
          onPress={() => zoomBy(mapRef, regionRef, ZOOM_FACTOR)}
          label={t('locMap.zoomOut')}
        />
        <CtrlButton
          icon="locate"
          onPress={() =>
            locateMe(mapRef, regionRef, () => Alert.alert(t('gps.permTitle'), t('gps.permMsg')))
          }
          label={t('locMap.locateMe')}
        />
        <CtrlButton
          icon="scan-outline"
          onPress={() => mapRef.current?.animateToRegion(region, 300)}
          label={t('favorites.fitArea')}
        />
      </View>
    </View>
  );
}
