import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '0.4.1';

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: '關於' }} />
      <ScrollView>
        <View className="items-center bg-white dark:bg-gray-900 px-4 py-8">
          <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">Checklister</Text>
          <Text className="mt-1 text-sm text-gray-500 dark:text-gray-400">v{version} · 次世代名錄產生器</Text>
        </View>

        <Section title="Author">
          <Text className="text-sm text-gray-700 dark:text-gray-300">Cheng-Tao Lin (林 政道)</Text>
          <Text className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {'Lab of Vegetation Ecology and Spatial Information\nSchool of Forestry and Resource Conservation, NTU\n國立臺灣大學森林環境暨資源學系 植群生態與空間資訊研究室'}
          </Text>
          <Pressable
            onPress={() => Linking.openURL('https://www.mutolisp.tw')}
            className="mt-2 active:opacity-70"
          >
            <Text className="text-sm text-blue-600 dark:text-blue-400">https://www.mutolisp.tw</Text>
          </Pressable>
        </Section>
        <Section title="Data Source">
          <Text className="text-sm text-gray-700 dark:text-gray-300">
            臺灣物種名錄 TaiCOL（251540 筆學名，96176 Taxa）v2026-04-24
          </Text>
          <Pressable onPress={() => Linking.openURL('https://taicol.tw')} className="mt-2 active:opacity-70">
            <Text className="text-sm text-blue-600 dark:text-blue-400">https://taicol.tw</Text>
          </Pressable>
          <Text className="text-sm text-gray-700 dark:text-gray-300">
            檢索表：王震哲、 楊智凱、 張和明、 林讚標、 王偉聿、 呂長澤、 洪鈴雅、 陳志雄、 陳志輝、 劉威廷、 鄭憲燦、 謝宗欣 (2022) 臺灣維管束植物野外鑑定指南。農業部林業及自然保育署宜蘭分署。
          </Text>
        </Section>

        <Section title="Development and source">
          <Text className="text-sm text-gray-700 dark:text-gray-300">Github：</Text>
          <Pressable onPress={() => Linking.openURL('https://github.com/')} className="mt-1 active:opacity-70">
            <Text className="text-sm text-blue-600 dark:text-blue-400">checklister-ng</Text>
          </Pressable>
        </Section>

        <Section title="License">
          <Text className="text-sm text-gray-700 dark:text-gray-300">本 app 為開源專案。物種資料採用 TaiCOL 授權條款。</Text>
        </Section>

        <Section title="協力單位">
          <Text className="text-sm text-gray-700 dark:text-gray-300">臺灣生物多樣性機構(TaiBIF)</Text>
          <Text className="text-sm text-gray-700 dark:text-gray-300">臺灣物種名錄(TaiCOL)</Text>
          <Text className="text-sm text-gray-700 dark:text-gray-300">臺灣生物多樣性資訊聯盟(TBIA)</Text>
          <Text className="text-sm text-gray-700 dark:text-gray-300">農業部林業及自然保育署宜蘭分署</Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</Text>
      {children}
    </View>
  );
}
