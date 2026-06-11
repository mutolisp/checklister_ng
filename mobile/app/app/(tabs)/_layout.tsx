import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { HapticTab } from '@/components/haptic-tab';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useSettings } from '~/stores/settings';
import { showActionSheet } from '~/components/ActionSheet';
import { createPlotPromptAndOpen, startSessionAndOpen } from '~/lib/recordCreate';
import { perf } from '~/lib/perf';
import i18n from '~/i18n';

async function showCreateChooser(): Promise<void> {
  const idx = await showActionSheet({
    title: i18n.t('record.createChooserTitle'),
    options: [{ label: i18n.t('record.kindSession') }, { label: i18n.t('record.kindPlot') }],
  });
  if (idx === 0) startSessionAndOpen();
  else if (idx === 1) createPlotPromptAndOpen();
}

async function showLongPressMenu(): Promise<void> {
  const updateDefault = (v: 'session' | 'plot' | 'ask') =>
    useSettings.getState().set('record_type_default', v);
  const idx = await showActionSheet({
    title: i18n.t('record.createMenuTitle'),
    message: i18n.t('record.createMenuMsg'),
    options: [
      { label: i18n.t('record.kindSession') },
      { label: i18n.t('record.kindPlot') },
      { label: i18n.t('record.defaultAsk') },
      { label: i18n.t('record.defaultSession') },
      { label: i18n.t('record.defaultPlot') },
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
      // Brand color #008F51. NativeWind 4 supports `bg-[#xxx]` arbitrary
      // hex as long as the literal appears verbatim in source so the JIT
      // scanner can pick it up. Press state darkens by ~20%.
      className="absolute -top-4 left-1/2 -ml-7 h-14 w-14 items-center justify-center rounded-full shadow-lg bg-[#008F51] active:bg-[#007241]"
    >
      <Ionicons name="add" size={32} color="white" />
    </Pressable>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const tint = Colors[colorScheme ?? 'light'].tint;
  const { t } = useTranslation();

  // ActiveSessionBar + status-bar + safe-area spacer + StaleWatchers were
  // lifted to app/_layout.tsx so they persist across stack screens (檢索表
  // runner, session/plot detail, etc.). Tabs-only chrome stays here.
  //
  // Tab bar height: NOT overridden. react-navigation 7 already computes
  // iOS = 49pt (HIG) + safe-area-bottom and Android = 56dp (Material) +
  // insets.bottom, tracking system-nav style across devices (3-button vs
  // gesture pill, notch vs non-notch). A hard-coded value here would just
  // recreate the very Android nav-bar overlap we hit earlier on Samsung
  // 3-button nav.
  return (
    <View className="flex-1">
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}
      >
        <Tabs.Screen
          name="menu"
          options={{
            title: t('tab.menu'),
            tabBarIcon: ({ color }) => <Ionicons name="menu" size={26} color={color} />,
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: t('tab.map'),
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
            title: t('tab.records'),
            tabBarIcon: ({ color }) => <Ionicons name="list" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="taxonomy"
          options={{
            title: t('tab.species'),
            tabBarIcon: ({ color }) => <Ionicons name="leaf-outline" size={24} color={color} />,
            // Eager-mount: taxonomy tree is the heaviest tab (TaxonomySearchBox
            // + segment subtree + cascade hydration of persisted expansion).
            // With default lazy=true, the first tap pays mount + first-render
            // + useEffect cost serially before the in-screen spinner can paint,
            // so the user sees a frozen tab bar for several hundred ms.
            // Mounting eagerly during app launch shifts that cost to splash
            // (where the user already expects to wait) so subsequent taps are
            // instant. The mount itself is cheap; the cascade SQL still runs
            // inside the screen's chunked-async hydration with its own spinner.
            lazy: false,
          }}
          listeners={{
            // Fires the instant the user taps the tab button — the gap between
            // this and taxonomy:focus / taxonomy:render-start tells us whether
            // the perceived lag is the native tab transition (no JS in the
            // gap) or post-focus JS work.
            tabPress: () => perf.mark('taxonomy:tab-press'),
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
