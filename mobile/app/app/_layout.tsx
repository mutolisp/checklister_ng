import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import '../global.css';

import { ActionSheetHost } from '~/components/ActionSheet';
import { DBProvider } from '~/components/DBProvider';
import { FontScaleProvider } from '~/components/FontScaleProvider';
import { TextPromptHost } from '~/components/TextPromptModal';
import { ToastHost } from '~/components/ToastHost';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <DBProvider>
            <FontScaleProvider>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="session/[id]" options={{ title: '名錄', headerBackTitle: '返回' }} />
              <Stack.Screen name="plot/[id]" options={{ title: '樣區', headerBackTitle: '返回' }} />
              <Stack.Screen name="lookup" options={{ title: '物種查詢', headerBackTitle: '返回' }} />
              <Stack.Screen name="projects" options={{ title: '專案管理', headerBackTitle: '返回' }} />
              <Stack.Screen name="sites" options={{ title: '樣區管理', headerBackTitle: '返回' }} />
              <Stack.Screen name="settings" options={{ title: '偏好設定', headerBackTitle: '返回' }} />
              <Stack.Screen name="about" options={{ title: '關於', headerBackTitle: '返回' }} />
              <Stack.Screen name="export" options={{ title: '匯出', headerBackTitle: '返回' }} />
            </Stack>
            <ToastHost />
            <TextPromptHost />
            <ActionSheetHost />
            </FontScaleProvider>
          </DBProvider>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
