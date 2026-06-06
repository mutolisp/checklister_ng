import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

type MenuItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  disabled?: boolean;
  href?: string;
};

const ITEMS: MenuItem[] = [
  { icon: 'folder-outline', label: '專案管理', description: '專案及其下的名錄 / 樣區', href: '/projects' },
  { icon: 'pin-outline', label: '地理樣區', description: '地圖上的點位 / 路線 / 範圍', href: '/sites' },
  { icon: 'archive-outline', label: '備份', description: '資料 / 照片備份與回復', href: '/backup' },
  { icon: 'settings-outline', label: '偏好設定', href: '/settings' },
  { icon: 'cloud-download-outline', label: '資料更新', description: 'Phase 2', disabled: true },
  { icon: 'information-circle-outline', label: '關於', href: '/about' },
];

export default function MenuScreen() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-gray-50 dark:bg-gray-950">
      <View className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-6">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">選單</Text>
      </View>
      <View className="mt-2 bg-white dark:bg-gray-900">
        {ITEMS.map((item, idx) => (
          <Pressable
            key={item.label}
            onPress={() => item.href && router.push(item.href as never)}
            disabled={item.disabled}
            className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-4 ${item.disabled ? 'opacity-40' : 'active:bg-gray-100 dark:active:bg-gray-700'} ${idx === ITEMS.length - 1 ? 'border-b-0' : ''}`}
          >
            <Ionicons name={item.icon} size={24} color="#4b5563" />
            <View className="ml-3 flex-1">
              <Text className="text-base text-gray-900 dark:text-gray-100">{item.label}</Text>
              {item.description ? <Text className="text-xs text-gray-500 dark:text-gray-400">{item.description}</Text> : null}
            </View>
            {!item.disabled ? <Ionicons name="chevron-forward" size={18} color="#9ca3af" /> : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
