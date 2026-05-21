/**
 * Modal sheet for tweaking export preferences:
 *   - which geo file formats to pack (geojson / gpx / kml, multi-select)
 *   - whether to include photos
 *
 * Persisted to settings, so the next swipe-export uses the same choices.
 */
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '~/stores/settings';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type GeoFormat = 'geojson' | 'gpx' | 'kml';

const GEO_OPTIONS: Array<{ value: GeoFormat; label: string; hint: string }> = [
  { value: 'kml', label: 'KML', hint: 'Google Earth / Google Maps' },
  { value: 'gpx', label: 'GPX', hint: 'Strava / Garmin / GPS device' },
  { value: 'geojson', label: 'GeoJSON', hint: 'QGIS / GIS / mapping tools' },
];

export function ExportPreferenceSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const formats = useSettings((s) => s.export_geo_formats);
  const includePhotos = useSettings((s) => s.export_include_photos);
  const setSetting = useSettings((s) => s.set);

  const toggleFormat = (f: GeoFormat) => {
    const next = formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f];
    // Don't let the user disable everything — keep at least one format.
    if (next.length === 0) return;
    setSetting('export_geo_formats', next);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="px-4">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>

            <View className="flex-row items-center justify-between pt-3 pb-2">
              <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">匯出偏好</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>

            <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              地理檔案格式
            </Text>
            <Text className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              至少選一種；勾選的格式都會包進 zip。
            </Text>
            <View className="mb-4">
              {GEO_OPTIONS.map((opt) => {
                const on = formats.includes(opt.value);
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => toggleFormat(opt.value)}
                    className="flex-row items-center border-b border-gray-100 dark:border-gray-800 py-3 active:bg-gray-50 dark:active:bg-gray-800"
                  >
                    <View
                      className={`mr-3 h-6 w-6 items-center justify-center rounded ${on ? 'bg-blue-500' : 'border border-gray-300 dark:border-gray-700'}`}
                    >
                      {on ? <Ionicons name="checkmark" size={16} color="white" /> : null}
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{opt.label}</Text>
                      <Text className="text-xs text-gray-500 dark:text-gray-400">{opt.hint}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              照片
            </Text>
            <View className="mb-4 flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 py-3">
              <View className="flex-1 pr-3">
                <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">包含照片</Text>
                <Text className="text-xs text-gray-500 dark:text-gray-400">
                  關閉可大幅減小檔案大小；資料量大時建議先關閉。
                </Text>
              </View>
              <Switch
                value={includePhotos}
                onValueChange={(v) => setSetting('export_include_photos', v)}
              />
            </View>

            <View style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <Pressable
                onPress={onClose}
                className="flex-row items-center justify-center rounded-lg bg-blue-500 px-4 py-3 active:bg-blue-600"
              >
                <Text className="text-sm font-medium text-white">完成</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
