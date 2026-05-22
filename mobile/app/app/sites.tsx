import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { showActionSheet } from '~/components/ActionSheet';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  deleteSite,
  geometryBounds,
  listSites,
  parseGeometry,
  type SiteWithProject,
} from '~/db';
import {
  sitesToGeoJSON,
  sitesToGPX,
  sitesToKML,
  sitesToWKT,
} from '~/lib/geoExporters';
import { useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';
import { SwipeRow } from '~/components/SwipeRow';
import { BackHeaderLeft } from '~/lib/goBack';

type ExportFormat = 'geojson' | 'kml' | 'gpx' | 'wkt';

const EXPORT_LABELS: Record<ExportFormat, { label: string; ext: string; mime: string; uti: string }> = {
  geojson: { label: 'GeoJSON', ext: 'geojson', mime: 'application/geo+json', uti: 'public.json' },
  kml: { label: 'KML', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', uti: 'com.google.earth.kml' },
  gpx: { label: 'GPX', ext: 'gpx', mime: 'application/gpx+xml', uti: 'public.xml' },
  wkt: { label: 'WKT', ext: 'wkt', mime: 'text/plain', uti: 'public.plain-text' },
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, '_').slice(0, 80) || 'sites';
}

const TYPE_LABEL: Record<string, string> = {
  Point: '點位',
  LineString: '路線',
  Polygon: '範圍',
  MultiPoint: '多點',
  MultiLineString: '多段路線',
  MultiPolygon: '多範圍',
};

const TYPE_ICON: Record<string, keyof typeof import('@expo/vector-icons').Ionicons.glyphMap> = {
  Point: 'pin-outline',
  LineString: 'analytics-outline',
  Polygon: 'shapes-outline',
  MultiPoint: 'pin',
  MultiLineString: 'analytics',
  MultiPolygon: 'shapes',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SitesScreen() {
  const router = useRouter();
  const setSetting = useSettings((s) => s.set);
  const currentMapView = useSettings((s) => s.map_view);
  const toast = useToast((s) => s.show);
  const [sites, setSites] = useState<SiteWithProject[]>([]);

  const reload = useCallback(() => setSites(listSites()), []);
  useFocusEffect(useCallback(() => reload(), [reload]));

  const handleDelete = (s: SiteWithProject) => {
    Alert.alert('刪除地理樣區？', `「${s.name}」會被移除`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: () => {
          deleteSite(s.id);
          reload();
          toast('已刪除');
        },
      },
    ]);
  };

  const handleJumpTo = (s: SiteWithProject) => {
    const region = geometryBounds(parseGeometry(s));
    setSetting('map_view', { ...currentMapView, ...region });
    router.push('/(tabs)/map');
  };

  const exportSites = async (subset: SiteWithProject[], format: ExportFormat, baseName: string) => {
    if (subset.length === 0) {
      toast('沒有可匯出的地理樣區');
      return;
    }
    try {
      let text = '';
      if (format === 'geojson') text = sitesToGeoJSON(subset);
      else if (format === 'kml') text = sitesToKML(subset);
      else if (format === 'gpx') text = sitesToGPX(subset);
      else text = sitesToWKT(subset);

      const meta = EXPORT_LABELS[format];
      const filename = `${sanitizeFilename(baseName)}.${meta.ext}`;
      const file = new File(Paths.cache, filename);
      if (file.exists) file.delete();
      file.create();
      file.write(text);

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('系統 share 不可用', `已產出檔案：${file.uri}`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: meta.mime,
        dialogTitle: filename,
        UTI: meta.uti,
      });
    } catch (e) {
      Alert.alert('匯出失敗', e instanceof Error ? e.message : String(e));
    }
  };

  const askExportFormat = async (subset: SiteWithProject[], baseName: string) => {
    const formats: ExportFormat[] = ['geojson', 'kml', 'gpx', 'wkt'];
    const idx = await showActionSheet({
      title: `匯出 ${subset.length} 個地理樣區`,
      options: formats.map((f) => ({ label: EXPORT_LABELS[f].label })),
    });
    if (idx >= 0 && idx < formats.length) exportSites(subset, formats[idx], baseName);
  };

  // Group by project
  const byProject = sites.reduce<Map<string, SiteWithProject[]>>((acc, s) => {
    const list = acc.get(s.project_name) ?? [];
    list.push(s);
    acc.set(s.project_name, list);
    return acc;
  }, new Map());
  const projectGroups = [...byProject.entries()];

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: '地理樣區管理',
          headerBackTitle: '返回',
          headerLeft: BackHeaderLeft,
          headerRight: () =>
            sites.length > 0 ? (
              <Pressable onPress={() => askExportFormat(sites, 'sites')} hitSlop={8}>
                <Ionicons name="share-outline" size={22} color="#2563eb" />
              </Pressable>
            ) : null,
        }}
      />

      {sites.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Ionicons name="map-outline" size={64} color="#9ca3af" />
          <Text className="mt-4 text-lg font-medium text-gray-700 dark:text-gray-300">還沒有任何地理樣區</Text>
          <Text className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
            到「地圖」tab → 工具 ⋮ → 繪製地理樣區 開始建立
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)/map')}
            className="mt-4 rounded-full bg-blue-500 px-4 py-2 active:bg-blue-600"
          >
            <Text className="text-sm font-medium text-white">前往地圖</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={projectGroups}
          keyExtractor={([projectName]) => projectName}
          renderItem={({ item: [projectName, list] }) => (
            <View>
              <View className="flex-row items-center justify-between bg-gray-100 dark:bg-gray-800 px-4 py-2">
                <Text className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                  {projectName} · {list.length} 個地理樣區
                </Text>
                <Pressable onPress={() => askExportFormat(list, projectName)} hitSlop={6}>
                  <Ionicons name="share-outline" size={16} color="#2563eb" />
                </Pressable>
              </View>
              {list.map((s) => (
                <SwipeRow key={s.id} onDelete={() => handleDelete(s)}>
                  <Pressable
                    onPress={() => handleJumpTo(s)}
                    className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
                  >
                    <Ionicons
                      name={TYPE_ICON[s.geometry_type] ?? 'pin-outline'}
                      size={20}
                      color="#2563eb"
                      style={{ marginRight: 12 }}
                    />
                    <View className="flex-1">
                      <Text className="text-base font-medium text-gray-900 dark:text-gray-100">{s.name}</Text>
                      <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {TYPE_LABEL[s.geometry_type] ?? s.geometry_type} · {formatTime(s.updated_at)}
                      </Text>
                      {s.notes ? (
                        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                          {s.notes}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
                  </Pressable>
                </SwipeRow>
              ))}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
