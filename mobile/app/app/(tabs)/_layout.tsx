import { Tabs } from 'expo-router';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { HapticTab } from '@/components/haptic-tab';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useSettings } from '~/stores/settings';
import { showActionSheet } from '~/components/ActionSheet';
import { createPlotPromptAndOpen, startSessionAndOpen } from '~/lib/recordCreate';

async function showCreateChooser(): Promise<void> {
  const idx = await showActionSheet({
    title: '建立新記錄',
    options: [{ label: '快速名錄' }, { label: '樣區調查' }],
  });
  if (idx === 0) startSessionAndOpen();
  else if (idx === 1) createPlotPromptAndOpen();
}

async function showLongPressMenu(): Promise<void> {
  const updateDefault = (v: 'session' | 'plot' | 'ask') =>
    useSettings.getState().set('record_type_default', v);
  const idx = await showActionSheet({
    title: '建立記錄',
    message: '選擇一個動作；下方三項是改變 + 鍵的預設行為。',
    options: [
      { label: '快速名錄' },
      { label: '樣區調查' },
      { label: '預設：每次詢問' },
      { label: '預設：快速名錄' },
      { label: '預設：樣區調查' },
    ],
  });
  if (idx === 0) startSessionAndOpen();
  else if (idx === 1) createPlotPromptAndOpen();
  else if (idx === 2) updateDefault('ask');
  else if (idx === 3) updateDefault('session');
  else if (idx === 4) updateDefault('plot');
}

function PlusButton() {
  const recordTypeDefault = useSettings((s) => s.record_type_default);

  const onPress = () => {
    if (recordTypeDefault === 'session') startSessionAndOpen();
    else if (recordTypeDefault === 'plot') createPlotPromptAndOpen();
    else showCreateChooser();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={showLongPressMenu}
      delayLongPress={350}
      className="absolute -top-4 left-1/2 -ml-7 h-14 w-14 items-center justify-center rounded-full bg-blue-500 shadow-lg active:bg-blue-600"
    >
      <Ionicons name="add" size={32} color="white" />
    </Pressable>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const tint = Colors[colorScheme ?? 'light'].tint;

  // ActiveSessionBar + status-bar + safe-area spacer + StaleWatchers were
  // lifted to app/_layout.tsx so they persist across stack screens (檢索表
  // runner, session/plot detail, etc.). Tabs-only chrome stays here.
  return (
    <View className="flex-1">
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: tint,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: { height: Platform.OS === 'ios' ? 88 : 64 },
        }}
      >
        <Tabs.Screen
          name="menu"
          options={{
            title: '選單',
            tabBarIcon: ({ color }) => <Ionicons name="menu" size={26} color={color} />,
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: '地圖',
            tabBarIcon: ({ color }) => <Ionicons name="map-outline" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="plus"
          options={{
            title: '',
            tabBarButton: () => <PlusButton />,
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: '記錄',
            tabBarIcon: ({ color }) => <Ionicons name="list" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="taxonomy"
          options={{
            title: '物種',
            tabBarIcon: ({ color }) => <Ionicons name="leaf-outline" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="plots"
          options={{
            href: null,
          }}
        />
      </Tabs>
    </View>
  );
}
