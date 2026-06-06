import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';
import { SystemBars } from 'react-native-edge-to-edge';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import '../global.css';

import { ActionSheetHost } from '~/components/ActionSheet';
import { ActiveSessionBar } from '~/components/ActiveSessionBar';
import { DBProvider } from '~/components/DBProvider';
import { FontScaleProvider } from '~/components/FontScaleProvider';
import { StalePlotWatcher } from '~/components/StalePlotWatcher';
import { StaleSessionWatcher } from '~/components/StaleSessionWatcher';
import { TextPromptHost } from '~/components/TextPromptModal';
import { ToastHost } from '~/components/ToastHost';
import { useThemeSync } from '~/hooks/useThemeSync';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';

// Keep the native splash visible until DBProvider signals ready (see below).
// Done at module-evaluation time so the splash doesn't auto-hide between
// "JS bundle finishes parsing" and "DB init finishes".
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden / already prevented; ignore.
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <DBProvider>
            <ThemedShell />
          </DBProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Inner shell that consumes the user's theme setting. Mounted *inside*
 * <DBProvider> so `useThemeSync` can read `settings.theme` from the user DB
 * (the store loads after DB init). Until the store has loaded, `theme`
 * defaults to 'auto' → follows the OS, which matches what a first-time user
 * expects.
 */
function ThemedShell() {
  const scheme = useThemeSync();
  const isDark = scheme === 'dark';
  const session = useActiveSession((s) => s.session);
  const plot = useActivePlot((s) => s.plot);
  const hasActive = Boolean(session || plot);

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <FontScaleProvider>
        <View style={{ flex: 1 }}>
          {/* Persistent top chrome — visible across ALL stack screens
              (tabs / session detail / plot detail / 檢索表 runner / etc.)
              so the 「記錄中」 indicator never disappears mid-task. When
              no record is active a safe-area spacer fills the notch so
              tab content / stack headers don't sit under the status bar. */}
          {hasActive ? <ActiveSessionBar /> : <TopSafeAreaSpacer />}
          {/* Stale watchers run app-wide, not just on tabs, so a 13h
              session left unattended in 檢索表 runner still gets nagged. */}
          <StaleSessionWatcher />
          <StalePlotWatcher />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="session/[id]" options={{ title: '名錄', headerBackTitle: '返回' }} />
            <Stack.Screen name="plot/[id]" options={{ title: '樣區', headerBackTitle: '返回' }} />
            <Stack.Screen name="key/[id]" options={{ title: '檢索表', headerBackTitle: '返回' }} />
            <Stack.Screen name="projects" options={{ title: '專案管理', headerBackTitle: '返回' }} />
            <Stack.Screen name="sites" options={{ title: '樣區管理', headerBackTitle: '返回' }} />
            <Stack.Screen name="settings" options={{ title: '偏好設定', headerBackTitle: '返回' }} />
            <Stack.Screen name="about" options={{ title: '關於', headerBackTitle: '返回' }} />
            <Stack.Screen name="favorites" options={{ title: '常用名錄', headerBackTitle: '返回' }} />
            <Stack.Screen name="backup" options={{ title: '備份', headerBackTitle: '返回' }} />
          </Stack>
        </View>
        <ToastHost />
        <TextPromptHost />
        <ActionSheetHost />
      </FontScaleProvider>
      {/* Active record → green ActiveSessionBar covers status bar → need
          'light' icons. Otherwise follow theme. Edge-to-edge mode makes
          both status AND nav bars transparent overlays, so we use
          `<SystemBars>` (from react-native-edge-to-edge) which controls
          icon colour on BOTH bars at once. */}
      <SystemBars style={hasActive ? 'light' : isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

function TopSafeAreaSpacer() {
  const insets = useSafeAreaInsets();
  return <View style={{ height: insets.top }} className="bg-white dark:bg-gray-900" />;
}
