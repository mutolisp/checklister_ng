import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listSessions, type SessionWithStats } from '~/db';
import { exportCsv, exportMarkdown, exportYaml } from '~/lib/exporters';

type Format = 'yaml' | 'csv' | 'markdown';

const UTI: Record<Format, string> = {
  yaml: 'public.yaml',
  csv: 'public.comma-separated-values-text',
  markdown: 'net.daringfireball.markdown',
};

export default function ExportScreen() {
  const [sessions, setSessions] = useState<SessionWithStats[]>([]);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => setSessions(listSessions()), []));

  const handleExport = async (sessionId: number, format: Format) => {
    if (busy) return;
    try {
      setBusy(true);
      const file = format === 'yaml'
        ? await exportYaml(sessionId)
        : format === 'csv'
          ? await exportCsv(sessionId)
          : await exportMarkdown(sessionId);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('系統 share 不可用', `已產出檔案：${file.uri}`);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: file.mimeType,
        dialogTitle: file.filename,
        UTI: UTI[format],
      });
    } catch (e) {
      Alert.alert('匯出失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: '匯出名錄' }} />
      <View className="border-b border-gray-200 bg-white px-4 py-3">
        <Text className="text-sm text-gray-700">
          選擇要匯出的 session：YAML 與桌面版相容、CSV 為 Darwin Core 標準、Markdown 含分類階層 + 統計
        </Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(s) => String(s.id)}
        ListEmptyComponent={
          <View className="px-4 py-12">
            <Text className="text-center text-sm text-gray-500">尚無記錄</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="border-b border-gray-100 bg-white px-4 py-3">
            <Text className="font-medium text-gray-900">{item.name}</Text>
            <Text className="text-xs text-gray-500">
              {item.record_count} 筆 · {item.project_name} · {item.ended_at === null ? '記錄中' : '已結束'}
            </Text>
            <View className="mt-2 flex-row gap-2">
              <ExportBtn label="YAML" icon="document-text-outline" color="bg-blue-500" disabled={item.record_count === 0 || busy} onPress={() => handleExport(item.id, 'yaml')} />
              <ExportBtn label="CSV" icon="grid-outline" color="bg-emerald-600" disabled={item.record_count === 0 || busy} onPress={() => handleExport(item.id, 'csv')} />
              <ExportBtn label="Markdown" icon="document-outline" color="bg-purple-600" disabled={item.record_count === 0 || busy} onPress={() => handleExport(item.id, 'markdown')} />
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function ExportBtn({
  label,
  icon,
  color,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center rounded-lg px-3 py-2 ${disabled ? 'bg-gray-200' : `${color} active:opacity-80`}`}
    >
      <Ionicons name={icon} size={16} color="white" />
      <Text className="ml-1 text-xs font-medium text-white">{label}</Text>
    </Pressable>
  );
}
