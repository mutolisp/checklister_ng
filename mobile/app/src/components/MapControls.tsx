/**
 * The control cluster shared by every inline mini-map: zoom, locate, basemap
 * toggle.
 *
 * Extracted from `RecordLocationMap`, which had the only copy. The folder-area
 * map needs the same affordances, and the permission handling in `locateMe` in
 * particular is not something to have two versions of.
 *
 * `regionRef` rather than state on purpose: these buttons act on whatever the
 * map is showing right now, and re-rendering the map on every pan to keep a
 * state variable current would be wasteful and would fight `animateToRegion`.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';
import type MapView from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { BASEMAP_LABEL_KEY } from '~/lib/basemap';
import type { MapBasemap } from '~/stores/settings';

/** One zoom step. */
export const ZOOM_FACTOR = 1.8;
/** Floor on the region deltas, so zooming in cannot collapse the view. */
export const MIN_DELTA = 0.0006;

type MapRef = React.RefObject<MapView | null>;
type RegionRef = React.MutableRefObject<Region>;

export function animateTo(map: MapRef, region: Region, patch: Partial<Region>, ms = 300): void {
  map.current?.animateToRegion({ ...region, ...patch }, ms);
}

export function zoomBy(map: MapRef, regionRef: RegionRef, factor: number): void {
  const r = regionRef.current;
  animateTo(
    map,
    r,
    {
      latitudeDelta: Math.max(r.latitudeDelta * factor, MIN_DELTA),
      longitudeDelta: Math.max(r.longitudeDelta * factor, MIN_DELTA),
    },
    200,
  );
}

export function centerOn(map: MapRef, regionRef: RegionRef, lat: number, lng: number): void {
  animateTo(map, regionRef.current, { latitude: lat, longitude: lng }, 350);
}

/**
 * Centre on the device's position. Keeps the current zoom — jumping to a fixed
 * zoom loses the scale the user chose.
 */
export async function locateMe(
  map: MapRef,
  regionRef: RegionRef,
  onDenied: () => void,
): Promise<void> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    onDenied();
    return;
  }
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    centerOn(map, regionRef, pos.coords.latitude, pos.coords.longitude);
  } catch {
    /* current location unavailable — leave the view as-is */
  }
}

export function CtrlButton({
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

/** Cycles standard → satellite → hybrid; the label names the CURRENT one. */
export function BasemapToggle({ basemap, onPress }: { basemap: MapBasemap; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-md bg-white/90 px-2 py-1 dark:bg-gray-900/90"
      accessibilityRole="button"
    >
      <Ionicons name="layers-outline" size={13} color="#2563eb" />
      <Text className="ml-1 text-[11px] font-medium text-gray-700 dark:text-gray-200">
        {t(BASEMAP_LABEL_KEY[basemap])}
      </Text>
    </Pressable>
  );
}
