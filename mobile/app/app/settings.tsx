import { Stack, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useSettings,
  type Theme,
  type CardDensity,
  type FontScale,
  type RecordTypeDefault,
} from '~/stores/settings';
import { clearAllUserData, clearSearchHistory } from '~/db';
import { useToast } from '~/stores/toast';
import { useActiveSession } from '~/stores/activeSession';

export default function SettingsScreen() {
  const settings = useSettings();
  const toast = useToast((s) => s.show);
  const router = useRouter();
  const refreshActiveSession = useActiveSession((s) => s.refresh);
  const reloadSettings = useSettings((s) => s.load);

  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: 'auto', label: '跟隨系統' },
    { value: 'light', label: '淺色' },
    { value: 'dark', label: '深色' },
  ];

  const undoOptions = [5, 8, 10];
  const densityOptions: Array<{ value: CardDensity; label: string }> = [
    { value: 'compact', label: '緊湊' },
    { value: 'comfortable', label: '寬鬆' },
  ];
  const fontScaleOptions: Array<{ value: FontScale; label: string }> = [
    { value: 'small', label: '小' },
    { value: 'normal', label: '預設' },
    { value: 'large', label: '大' },
    { value: 'xlarge', label: '特大' },
  ];
  const recordTypeOptions: Array<{ value: RecordTypeDefault; label: string }> = [
    { value: 'ask', label: '每次詢問' },
    { value: 'session', label: '快速名錄' },
    { value: 'plot', label: '樣區調查' },
  ];

  const handleClearHistory = () => {
    Alert.alert('清除查詢歷史？', '已記錄的搜尋字串會全部移除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          clearSearchHistory();
          toast('已清除查詢歷史');
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: '偏好設定' }} />
      <ScrollView>
        <Section title="外觀">
          <RowSelect
            label="主題"
            value={settings.theme}
            options={themeOptions}
            onChange={(v) => settings.set('theme', v)}
          />
          <RowSelect
            label="物種卡片密度"
            value={settings.card_density}
            options={densityOptions}
            onChange={(v) => settings.set('card_density', v)}
          />
          <RowSelect
            label="字體大小"
            value={settings.font_scale}
            options={fontScaleOptions}
            onChange={(v) => settings.set('font_scale', v)}
          />
        </Section>
        <Section title="互動">
          <RowSelect
            label="Undo 時長"
            value={settings.undo_duration}
            options={undoOptions.map((s) => ({ value: s, label: `${s} 秒` }))}
            onChange={(v) => settings.set('undo_duration', v)}
          />
          <RowSelect
            label="＋ 預設建立"
            value={settings.record_type_default}
            options={recordTypeOptions}
            onChange={(v) => settings.set('record_type_default', v)}
          />
        </Section>
        <Section title="AI 辨識">
          <RowSelect
            label="GPS 過濾"
            value={settings.ai_geomodel_filter ? 'on' : 'off'}
            options={[
              { value: 'on', label: '開啟（建議）' },
              { value: 'off', label: '關閉' },
            ]}
            onChange={(v) => settings.set('ai_geomodel_filter', v === 'on')}
          />
        </Section>
        <Section title="資料">
          <Pressable
            onPress={handleClearHistory}
            className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">清除查詢歷史</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Alert.alert(
                '清除所有資料？',
                '所有記錄、專案、設定都會刪除。TaiCOL 物種資料保留。',
                [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '確定清除',
                    style: 'destructive',
                    onPress: () => {
                      Alert.alert('再次確認', '此動作無法復原。', [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '清除',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await clearAllUserData();
                              reloadSettings();
                              refreshActiveSession();
                              toast('已清除所有資料');
                              router.replace('/');
                            } catch (e) {
                              toast(`清除失敗：${e instanceof Error ? e.message : String(e)}`);
                            }
                          },
                        },
                      ]);
                    },
                  },
                ],
              );
            }}
            className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text className="text-base text-red-600 dark:text-red-400">清除所有資料</Text>
            <Text className="text-xs text-gray-500 dark:text-gray-400">不可復原，需二次確認</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</Text>
      {children}
    </View>
  );
}

function RowSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <View className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <Text className="text-sm text-gray-700 dark:text-gray-300">{label}</Text>
      <View className="mt-2 flex-row gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => onChange(opt.value)}
              className={`rounded-full border px-3 py-1.5 ${active ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
            >
              <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
