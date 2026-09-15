/**
 * Inline editable mini-map for a single record's coordinate. Shown under the
 * "定位此物種 / 點選 GPS" row in both the session record sheet
 * (`SpeciesDetailSheet`) and the plot species modal (`PlotSpeciesValueModal`).
 *
 * - Tap the map to place / relocate the point; drag the red marker to fine-tune.
 *   On the INLINE map, relocating an existing coordinate asks first and then
 *   offers an undo — see `guardedCommit`. The fullscreen editor does neither:
 *   you got there by deliberately tapping 「全螢幕」 to do precise work.
 * - Zoom in/out buttons (animateToRegion by delta) + basemap toggle
 *   (standard / satellite / hybrid).
 * - Expand button opens the same editor full-screen for precise work.
 * - `reference` (plot centre + point-count radius) is drawn as a non-draggable
 *   blue marker + circle for context (used by the plot flow).
 *
 * `onChange` commits the new coordinate immediately (parent persists it without
 * a toast); manual placement carries no GPS accuracy, hence the `null` third
 * argument. Undo passes the previous accuracy back so restoring a GPS-measured
 * fix returns its uncertainty too, not just its latitude and longitude.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, {
  Circle,
  Marker,
  type MapPressEvent,
  type MarkerDragStartEndEvent,
  type Region,
} from 'react-native-maps';
import { useSettings, type MapBasemap } from '~/stores/settings';
import { basemapToMapType, nextBasemap } from '~/lib/basemap';
import {
  BasemapToggle,
  CtrlButton,
  ZOOM_FACTOR,
  centerOn,
  locateMe,
  zoomBy,
} from './MapControls';
import { formatLatLng, parseLatLng } from '~/lib/coords';

type Reference = { center?: { lat: number; lng: number } | null; radiusM?: number | null };

type Props = {
  lat: number | null;
  lng: number | null;
  /** Current GPS uncertainty in metres; null when the point was placed by hand.
   *  Needed so an undo can put the measured value back, and so the confirm can
   *  say what is about to be lost. */
  accuracy?: number | null;
  /** Commit a new coordinate (placed by tap or drag). Parent persists quietly.
   *  `accuracy` is null for a hand-placed point and carries the previous
   *  measured value when an undo restores one. */
  onChange: (lat: number, lng: number, accuracy: number | null) => void;
  /** Optional plot context drawn as a faint reference (non-editable). */
  reference?: Reference;
};

const INLINE_HEIGHT = 184;

export function RecordLocationMap({ lat, lng, accuracy = null, onChange, reference }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapView = useSettings((s) => s.map_view);
  const undoSeconds = useSettings((s) => s.undo_duration);
  const [basemap, setBasemap] = useState<MapBasemap>(
    mapView.basemap === 'terrain' ? 'standard' : mapView.basemap,
  );
  const [fullscreen, setFullscreen] = useState(false);
  /**
   * Typed-coordinate entry, rendered INLINE rather than through `promptText`.
   *
   * `promptText` is a Modal hosted at the navigation root. Opening it from
   * inside another Modal — which is where this map lives in the specimen,
   * species and plot-species sheets — makes iOS dismiss that sheet to present
   * it: you tapped "enter coordinates" on a specimen and were thrown back to
   * the trip list. An inline row is in the same view tree as everything else
   * here, so there is no second Modal and nothing to dismiss.
   */
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryText, setEntryText] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);

  /**
   * The coordinate the user just committed, shown immediately.
   *
   * Placing a point is direct manipulation: it must appear at once, not after a
   * round trip through the parent's persist-and-refetch. That round trip is
   * usually fine for a tap, but a typed coordinate commits while the prompt's
   * Modal is still dismissing, and the parent's re-render did not reach the
   * screen until it was left and re-entered — the point simply did not show up.
   *
   * Props win the moment they change: whatever the parent settles on is the
   * truth, this only covers the gap.
   */
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const propKey = `${lat},${lng}`;
  const lastPropKey = useRef(propKey);
  useEffect(() => {
    if (lastPropKey.current === propKey) return;
    lastPropKey.current = propKey;
    setPending(null);
  }, [propKey]);

  const commit = (nextLat: number, nextLng: number, nextAccuracy: number | null = null) => {
    setPending({ lat: nextLat, lng: nextLng });
    onChange(nextLat, nextLng, nextAccuracy);
  };

  /**
   * The coordinate a confirmed move replaced, offered back as an inline undo.
   *
   * Inline, not a toast, for the same reason the coordinate entry above is
   * inline: `ToastHost` is an absolutely-positioned View at the navigation
   * root, and three of this component's four call sites (the session, specimen
   * and plot-species sheets) are RN Modals, which iOS presents in their own
   * window — a root-level banner renders behind them. The undo would have been
   * invisible exactly where the risk lives.
   */
  const [undoPoint, setUndoPoint] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const offerUndo = (prev: { lat: number; lng: number; accuracy: number | null }) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoPoint(prev);
    undoTimer.current = setTimeout(() => setUndoPoint(null), undoSeconds * 1000);
  };

  /**
   * Tap/drag on the INLINE map, where the finger is often just scrolling the
   * sheet. Placing the first point is free — there is nothing to lose. Moving
   * an existing one is destructive and silent (the parent persists with no
   * toast), and a GPS fix overwritten by hand loses its measured uncertainty as
   * well as its position, which no later edit can recover. So that case
   * confirms first, then leaves an undo behind.
   *
   * `Alert` rather than an inline confirm: it is a native UIAlertController, so
   * unlike an RN Modal it does present above the sheets this map lives in.
   */
  const guardedCommit = (nextLat: number, nextLng: number) => {
    if (lat == null || lng == null) {
      commit(nextLat, nextLng);
      return;
    }
    const prev = { lat, lng, accuracy };
    Alert.alert(
      t('locMap.moveConfirmTitle'),
      accuracy != null
        ? t('locMap.moveConfirmGps', { m: Math.round(accuracy) })
        : t('locMap.moveConfirmManual'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('locMap.move'),
          onPress: () => {
            commit(nextLat, nextLng);
            offerUndo(prev);
          },
        },
      ],
    );
  };

  const undoMove = () => {
    if (!undoPoint) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    commit(undoPoint.lat, undoPoint.lng, undoPoint.accuracy);
    setUndoPoint(null);
  };

  const shownLat = pending?.lat ?? lat;
  const shownLng = pending?.lng ?? lng;

  const openEntry = () => {
    setEntryText(shownLat != null && shownLng != null ? formatLatLng(shownLat, shownLng) : '');
    setEntryError(null);
    setEntryOpen(true);
  };

  const submitEntry = () => {
    const parsed = parseLatLng(entryText);
    if (!parsed.ok) {
      // Inline, not an Alert: the message belongs next to the field the user is
      // still editing, and it says which of the two rules was broken.
      setEntryError(parsed.reason === 'range' ? t('locMap.enterRange') : t('locMap.enterFormat'));
      return;
    }
    setEntryOpen(false);
    setEntryError(null);
    commit(parsed.lat, parsed.lng);
  };

  const hasPoint = shownLat != null && shownLng != null;
  // Point-centred when a coordinate exists; otherwise the user's last map view
  // (clamped tighter than the all-Taiwan default so tapping to place is usable).
  const initialRegion: Region = hasPoint
    ? { latitude: shownLat, longitude: shownLng, latitudeDelta: 0.006, longitudeDelta: 0.006 }
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
        lat={shownLat}
        lng={shownLng}
        initialRegion={initialRegion}
        onChange={guardedCommit}
        reference={reference}
        basemap={basemap}
        onCycleBasemap={cycleBasemap}
        onType={openEntry}
        rounded
        onExpand={() => setFullscreen(true)}
      />
      {entryOpen ? (
        <View className="mt-2 rounded-lg border border-gray-300 p-2 dark:border-gray-600">
          <Text className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
            {t('locMap.enterMsg')}
          </Text>
          <TextInput
            value={entryText}
            onChangeText={(v) => {
              setEntryText(v);
              setEntryError(null);
            }}
            placeholder="25.123456, 121.654321"
            placeholderTextColor="#9ca3af"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitEntry}
            className="rounded-md bg-gray-100 px-2 py-1.5 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          />
          {entryError ? (
            <Text className="mt-1 text-[11px] text-red-600 dark:text-red-400">{entryError}</Text>
          ) : null}
          <View className="mt-2 flex-row justify-end gap-4">
            <Pressable onPress={() => setEntryOpen(false)} hitSlop={8}>
              <Text className="text-sm text-gray-500 dark:text-gray-400">{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={submitEntry} hitSlop={8}>
              <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {t('common.ok')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          {hasPoint ? t('locMap.dragHint') : t('locMap.tapToPlace')}
        </Text>
      )}

      {undoPoint ? (
        <View className="mt-2 flex-row items-center rounded-lg bg-gray-900 px-3 py-2 dark:bg-gray-800">
          <Text className="flex-1 text-xs text-white">{t('locMap.moved')}</Text>
          <Pressable onPress={undoMove} hitSlop={8}>
            <Text className="text-xs font-semibold text-blue-300">{t('locMap.undo')}</Text>
          </Pressable>
        </View>
      ) : null}

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
          {/* Mounted only while open — a hidden MapView still holds MapKit
              resources, and this component is now used on the plot screen too,
              where several maps can be alive at once. */}
          {entryOpen ? (
            <View className="border-b border-gray-800 px-4 pb-3">
              <TextInput
                value={entryText}
                onChangeText={(v) => {
                  setEntryText(v);
                  setEntryError(null);
                }}
                placeholder="25.123456, 121.654321"
                placeholderTextColor="#6b7280"
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submitEntry}
                className="rounded-md bg-gray-800 px-3 py-2 text-base text-white"
              />
              {entryError ? (
                <Text className="mt-1 text-xs text-red-400">{entryError}</Text>
              ) : null}
              <View className="mt-2 flex-row justify-end gap-4">
                <Pressable onPress={() => setEntryOpen(false)} hitSlop={8}>
                  <Text className="text-sm text-gray-400">{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={submitEntry} hitSlop={8}>
                  <Text className="text-sm font-medium text-blue-400">{t('common.ok')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {fullscreen ? (
            <EditableMap
              lat={shownLat}
              lng={shownLng}
              initialRegion={initialRegion}
              onChange={commit}
              reference={reference}
              basemap={basemap}
              onCycleBasemap={cycleBasemap}
              onType={openEntry}
            />
          ) : null}
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
  onType,
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
  onType: () => void;
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

  const recenter = (latitude: number, longitude: number) =>
    centerOn(mapRef, regionRef, latitude, longitude);

  // When the coordinate changes from outside (e.g. the "點選 GPS" row), follow
  // it. Skipped for our own tap/drag, whose value we stamped in `place`.
  useEffect(() => {
    if (lat == null || lng == null) return;
    const k = `${lat},${lng}`;
    if (lastCommittedRef.current === k) return;
    lastCommittedRef.current = k;
    recenter(lat, lng);
  }, [lat, lng]);

  const zoom = (factor: number) => zoomBy(mapRef, regionRef, factor);

  const handleLocate = () =>
    locateMe(mapRef, regionRef, () => Alert.alert(t('gps.permTitle'), t('gps.permMsg')));

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
        <BasemapToggle basemap={basemap} onPress={onCycleBasemap} />
      </View>

      {/* Zoom + expand controls (top-right) */}
      <View className="absolute right-1.5 top-1.5 gap-1.5">
        {onExpand ? (
          <CtrlButton icon="expand-outline" onPress={onExpand} label={t('locMap.expand')} />
        ) : null}
        <CtrlButton icon="add" onPress={() => zoom(1 / ZOOM_FACTOR)} label={t('locMap.zoomIn')} />
        <CtrlButton icon="remove" onPress={() => zoom(ZOOM_FACTOR)} label={t('locMap.zoomOut')} />
        <CtrlButton icon="locate" onPress={handleLocate} label={t('locMap.locateMe')} />
        <CtrlButton icon="keypad-outline" onPress={onType} label={t('locMap.enterTitle')} />
      </View>
    </View>
  );
}
