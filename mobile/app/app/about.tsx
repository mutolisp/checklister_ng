import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? 'm0.3.0';

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: '關於' }} />
      <ScrollView>
        <View className="items-center bg-white px-4 py-8">
          <Text className="text-3xl font-bold text-gray-900">Checklister</Text>
          <Text className="mt-1 text-sm text-gray-500">v{version} · 次世代名錄產生器</Text>
        </View>

        <Section title="Author">
          <Text className="text-sm text-gray-700">Cheng-Tao Lin (林 政道)</Text>
          <Text className="mt-1 text-xs text-gray-600">
            {'Lab of Vegetation Ecology and Spatial Information\nSchool of Forestry and Resource Conservation, NTU\n國立臺灣大學森林環境暨資源學系 植群生態與空間資訊研究室'}
          </Text>
          <Pressable
            onPress={() => Linking.openURL('https://www.mutolisp.tw')}
            className="mt-2 active:opacity-70"
          >
            <Text className="text-sm text-blue-600">https://www.mutolisp.tw</Text>
          </Pressable>
        </Section>
        <Section title="資料來源">
          <Text className="text-sm text-gray-700">
            臺灣物種名錄 TaiCOL（242k 筆，包含維管束植物、鳥類、昆蟲、真菌等）
          </Text>
          <Pressable onPress={() => Linking.openURL('https://taicol.tw')} className="mt-2 active:opacity-70">
            <Text className="text-sm text-blue-600">https://taicol.tw</Text>
          </Pressable>
        </Section>

        <Section title="開發">
          <Text className="text-sm text-gray-700">桌面版：</Text>
          <Pressable onPress={() => Linking.openURL('https://github.com/')} className="mt-1 active:opacity-70">
            <Text className="text-sm text-blue-600">checklister-ng</Text>
          </Pressable>
        </Section>

        <Section title="授權">
          <Text className="text-sm text-gray-700">本 app 為開源專案。物種資料採用 TaiCOL 授權條款。</Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-4 border-b border-gray-100 bg-white px-4 py-3">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</Text>
      {children}
    </View>
  );
}
