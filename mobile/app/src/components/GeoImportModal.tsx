import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createSite, listProjects, type Project } from '~/db';
import {
  detectFormat,
  parseGeoFile,
  type GeoFormat,
  type ImportedGeometry,
} from '~/lib/geoConverters';

type Props = {
  visible: boolean;
  defaultProjectId?: number;
  onClose: () => void;
  onCommitted: (count: number) => void;
};

const FORMAT_LABEL: Record<GeoFormat, string> = {
  geojson: 'GeoJSON',
  kml: 'KML',
  gpx: 'GPX',
  wkt: 'WKT',
};

export function GeoImportModal({ visible, defaultProjectId = 0, onClose, onCommitted }: Props) {
  const insets = useSafeAreaInsets();
  const [filename, setFilename] = useState('');
  const [format, setFormat] = useState<GeoFormat | null>(null);
  const [imported, setImported] = useState<ImportedGeometry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>(defaultProjectId);
  const [namePrefix, setNamePrefix] = useState('');

  const reset = () => {
    setFilename('');
    setFormat(null);
    setImported([]);
    setNamePrefix('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFile = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
      });
      if (r.canceled) return;
      const asset = r.assets[0];
      if (!asset?.uri) return;

      const file = new File(asset.uri);
      const text = await file.text();
      const detected = detectFormat(text, asset.name);
      if (!detected) {
        Alert.alert('無法辨識格式', '請使用 .geojson / .json / .kml / .gpx / .wkt');
        return;
      }
      const parsed = parseGeoFile(text, detected);
      if (parsed.length === 0) {
        Alert.alert('解析失敗', '檔案內沒有可匯入的幾何資料');
        return;
      }

      setFilename(asset.name);
      setFormat(detected);
      setImported(parsed);
      setProjects(listProjects());
      // 預設 prefix 用檔名（去副檔名）
      const base = asset.name.replace(/\.[^.]+$/, '');
      setNamePrefix(base);
    } catch (e) {
      Alert.alert('讀檔失敗', e instanceof Error ? e.message : String(e));
    }
  };

  const handleCommit = () => {
    if (imported.length === 0) return;
    let added = 0;
    for (let i = 0; i < imported.length; i++) {
      const item = imported[i];
      const name =
        item.name?.trim() ||
        (imported.length === 1 ? namePrefix : `${namePrefix} #${i + 1}`) ||
        `匯入 ${i + 1}`;
      try {
        createSite({
          project_id: projectId,
          name,
          geometry: item.geometry,
          notes: item.notes ?? null,
        });
        added++;
      } catch (e) {
        // skip invalid geometries silently; surface count
        // eslint-disable-next-line no-console
        console.warn('skip', name, e);
      }
    }
    onCommitted(added);
    if (added < imported.length) {
      Alert.alert('部分匯入', `共 ${imported.length} 筆，成功 ${added} 筆`);
    }
    handleClose();
  };

  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View
        className="flex-1 bg-white dark:bg-gray-900"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={handleClose} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">取消</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">匯入地理檔案</Text>
          <Pressable onPress={handleCommit} hitSlop={8} disabled={imported.length === 0}>
            <Text
              className={`text-base font-semibold ${imported.length === 0 ? 'text-gray-300' : 'text-blue-600 dark:text-blue-400'}`}
            >
              建立 {imported.length || ''}
            </Text>
          </Pressable>
        </View>

        <ScrollView className="flex-1">
          {imported.length === 0 ? (
            <View className="items-center px-6 py-12">
              <Ionicons name="cloud-upload-outline" size={56} color="#9ca3af" />
              <Text className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
                支援 GeoJSON / KML / GPX / WKT 檔案。
                {'\n'}MultiPoint / MultiLineString / MultiPolygon 自動保留結構。
              </Text>
              <Pressable
                onPress={handlePickFile}
                className="mt-6 flex-row items-center rounded-full bg-blue-500 px-4 py-2 active:bg-blue-600"
              >
                <Ionicons name="folder-open-outline" size={16} color="white" />
                <Text className="ml-1 text-sm font-medium text-white">選擇檔案</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View className="border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3">
                <Text className="text-sm text-blue-900 dark:text-blue-100">
                  <Text className="font-bold">{filename}</Text>
                  {format ? `（${FORMAT_LABEL[format]}）` : ''}
                </Text>
                <Text className="mt-1 text-xs text-blue-800">
                  共 {imported.length} 個幾何，將建立 {imported.length} 個樣區
                </Text>
              </View>

              <Field label="名稱前綴">
                <TextInput
                  value={namePrefix}
                  onChangeText={setNamePrefix}
                  className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                  placeholder="例：浸水營"
                  placeholderTextColor="#9ca3af"
                />
                <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  原始檔內已有名稱會優先使用；多筆幾何會加 #1, #2 ...
                </Text>
              </Field>

              <Field label="專案">
                <View className="flex-row flex-wrap gap-2">
                  {projects.map((p) => {
                    const active = p.id === projectId;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setProjectId(p.id)}
                        className={`rounded-full border px-3 py-1.5 ${active ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
                      >
                        <Text
                          className={`text-xs ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'} ${p.id === 0 ? 'italic' : ''}`}
                        >
                          {p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              <View className="px-4 py-3">
                <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  幾何預覽
                </Text>
                {imported.slice(0, 20).map((item, i) => (
                  <View key={i} className="border-b border-gray-100 dark:border-gray-800 py-2">
                    <Text className="text-sm text-gray-900 dark:text-gray-100">
                      {item.name || `${namePrefix || '匯入'} #${i + 1}`}
                    </Text>
                    <Text className="text-xs text-gray-500 dark:text-gray-400">{item.geometry.type}</Text>
                  </View>
                ))}
                {imported.length > 20 ? (
                  <Text className="mt-2 text-xs italic text-gray-500 dark:text-gray-400">
                    （另有 {imported.length - 20} 筆未列出）
                  </Text>
                ) : null}
              </View>

              <View className="px-4 py-3">
                <Pressable
                  onPress={handlePickFile}
                  className="flex-row items-center self-start rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1.5 active:bg-gray-200 dark:active:bg-gray-700"
                >
                  <Ionicons name="folder-open-outline" size={14} color="#374151" />
                  <Text className="ml-1 text-xs font-medium text-gray-700 dark:text-gray-300">換另一個檔案</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>

        {currentProject ? (
          <View className="border-t border-gray-100 dark:border-gray-800 px-4 py-2">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              目標專案：<Text className="font-medium text-gray-700 dark:text-gray-300">{currentProject.name}</Text>
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
      <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</Text>
      {children}
    </View>
  );
}
