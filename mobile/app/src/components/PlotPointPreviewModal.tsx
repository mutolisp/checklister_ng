/**
 * Full-screen map popup previewing one plot-species record's coordinate in the
 * context of its plot: the focused observation point, plus (when present) the
 * plot centre, the transect track, and the point-count radius circle.
 *
 * Modelled on TrackPreviewModal (react-native-maps inside a sibling Modal).
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Circle, Marker, Polyline, type Region } from 'react-native-maps';
import type { TrackSegment } from '~/db';

type LL = { lat: number; lng: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** The observation point to highlight. */
  focus: LL;
  /** Plot centre (decimal_latitude/longitude); null if unset. */
  center?: LL | null;
  /** Transect track segments. */
  segments?: TrackSegment[];
  /** Point-count circle radius in metres; drawn around `center`. */
  radiusM?: number | null;
};

export function PlotPointPreviewModal({
  visible,
  onClose,
  title,
  focus,
  center,
  segments = [],
  radiusM,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const region = useMemo<Region>(() => {
    let minLat = focus.lat,
      maxLat = focus.lat,
      minLng = focus.lng,
      maxLng = focus.lng;
    const add = (lat: number, lng: number) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    };
    if (center) add(center.lat, center.lng);
    for (const seg of segments) for (const [lng, lat] of seg) add(lat, lng);
    // Pad bounds by the point-count radius so the whole circle is visible.
    if (center && radiusM) {
      const dLat = radiusM / 111_000;
      const dLng = radiusM / (111_000 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.1));
      add(center.lat - dLat, center.lng - dLng);
      add(center.lat + dLat, center.lng + dLng);
    }
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.002),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.002),
    };
  }, [focus, center, segments, radiusM]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable onPress={onClose} hitSlop={16} className="p-2">
            <Ionicons name="close" size={28} color="white" />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="text-base font-semibold text-white" numberOfLines={1}>
              {title}
            </Text>
            <Text className="text-xs text-gray-300">
              {focus.lat.toFixed(5)}, {focus.lng.toFixed(5)}
            </Text>
          </View>
          <View style={{ width: 44 }} />
        </View>
        <View className="flex-1">
          <MapView style={{ flex: 1 }} initialRegion={region} showsUserLocation>
            {segments.map((seg, i) =>
              seg.length >= 2 ? (
                <Polyline
                  key={`seg-${i}`}
                  coordinates={seg.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
                  strokeColor="#f97316"
                  strokeWidth={4}
                />
              ) : null,
            )}
            {center && radiusM ? (
              <Circle
                center={{ latitude: center.lat, longitude: center.lng }}
                radius={radiusM}
                strokeColor="#2563eb"
                fillColor="rgba(37,99,235,0.12)"
                strokeWidth={2}
              />
            ) : null}
            {center ? (
              <Marker
                coordinate={{ latitude: center.lat, longitude: center.lng }}
                pinColor="blue"
                title={t('plotPoint.center')}
              />
            ) : null}
            <Marker
              coordinate={{ latitude: focus.lat, longitude: focus.lng }}
              pinColor="red"
              title={title}
            />
          </MapView>
        </View>
      </View>
    </Modal>
  );
}
