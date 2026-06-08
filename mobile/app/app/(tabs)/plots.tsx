import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createPlotSurvey,
  deletePlotSurvey,
  listPlotSurveys,
  plotCanAcceptSpecies,
  type PlotSurvey,
} from '~/db';
import { promptText } from '~/components/TextPromptModal';
import { pauseIfNot } from '~/lib/trackRecorder';

function formatTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlotsListScreen() {
  const router = useRouter();
  const [plots, setPlots] = useState<PlotSurvey[]>([]);

  const reload = useCallback(() => {
    setPlots(listPlotSurveys());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleNew = async () => {
    const raw = await promptText({
      title: '新樣區',
      message: '輸入 plotid（例：PLOT_2026_001）',
      placeholder: 'PLOT_2026_001',
      autoCapitalize: 'none',
    });
    const plotid = raw?.trim();
    if (!plotid) return;
    // createPlotSurvey force-ends any active record DB-side; stop any GPS watch
    // first so it can't keep writing to the record we're about to end.
    pauseIfNot(null);
    const id = createPlotSurvey({ plotid });
    router.push(`/plot/${id}` as Href);
  };

  const handleLongPress = (plot: PlotSurvey) => {
    Alert.alert(plot.plotid, undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: () => {
          deletePlotSurvey(plot.id);
          reload();
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <View className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">樣區調查</Text>
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          植群調查：環境資料 + 物種垂直分層豐度
        </Text>
      </View>
      {plots.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="grid-outline" size={56} color="#cbd5e1" />
          <Text className="mt-3 text-center text-gray-500 dark:text-gray-400">
            尚無樣區資料{'\n'}點右下角 + 開始新樣區
          </Text>
        </View>
      ) : (
        <FlatList
          data={plots}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => (
            <PlotRow
              plot={item}
              onPress={() => router.push(`/plot/${item.id}` as Href)}
              onLongPress={() => handleLongPress(item)}
            />
          )}
        />
      )}
      <Pressable
        onPress={handleNew}
        className="absolute bottom-8 right-6 h-14 w-14 items-center justify-center rounded-full bg-emerald-500 shadow-lg active:bg-emerald-600"
      >
        <Ionicons name="add" size={32} color="white" />
      </Pressable>
    </SafeAreaView>
  );
}

function PlotRow({
  plot,
  onPress,
  onLongPress,
}: {
  plot: PlotSurvey;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const isActive = plot.status === 'active';
  const ready = plotCanAcceptSpecies(plot);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <View className="flex-1">
        <View className="flex-row items-center">
          <View
            className={`mr-2 h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
          />
          <Text className="font-medium text-gray-900 dark:text-gray-100">{plot.plotid}</Text>
          {isActive ? (
            <View className="ml-2 rounded bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5">
              <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">記錄中</Text>
            </View>
          ) : null}
          {!ready ? (
            <View className="ml-2 rounded bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5">
              <Text className="text-xs font-medium text-amber-700 dark:text-amber-300">資訊未補齊</Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {plot.sampling_protocol ?? '未設 protocol'}
          {plot.sample_size_value
            ? ` · ${plot.sample_size_value} ${plot.sample_size_unit ?? ''}`
            : ''}
        </Text>
        {plot.start_ts ? (
          <Text className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{formatTime(plot.start_ts)}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </Pressable>
  );
}
