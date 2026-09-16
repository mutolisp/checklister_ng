import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SystemBars } from 'react-native-edge-to-edge';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PortalHost } from '@rn-primitives/portal';
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
import { GbifLookupHost } from '~/components/GbifLookupHost';
import { InatTokenHost } from '~/components/InatTokenHost';
import { TextPromptHost } from '~/components/TextPromptModal';
import { ToastHost } from '~/components/ToastHost';
import { useThemeSync } from '~/hooks/useThemeSync';
import { useI18nSync } from '~/hooks/useI18nSync';
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
  useI18nSync();
  const { t } = useTranslation();
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
          {/* `minimal` shows the chevron alone. The word cost most of the header's
                width in the longer languages and repeated what the glyph
                already says; screens with a custom `headerLeft` carry the
                label on the button's accessibility label instead. */}
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="session/[id]" options={{ title: t('nav.session') }} />
            <Stack.Screen name="plot/[id]" options={{ title: t('nav.plot') }} />
            <Stack.Screen name="key/[id]" options={{ title: t('nav.key') }} />
            <Stack.Screen name="projects" options={{ title: t('nav.projects') }} />
            <Stack.Screen name="sites" options={{ title: t('nav.sites') }} />
            {/* Titles reuse the keys the rows already carry, so the header is
                right before the screen mounts (no flash) and exportPref.title's
                existing es-419 override keeps working. */}
            <Stack.Screen name="settings/language" options={{ title: t('settings.language') }} />
            <Stack.Screen name="settings/collection" options={{ title: t('settings.sectionCollection') }} />
            <Stack.Screen name="settings/export" options={{ title: t('exportPref.title') }} />
            <Stack.Screen name="surveyors" options={{ title: t('nav.surveyors') }} />
            <Stack.Screen name="about" options={{ title: t('nav.about') }} />
            <Stack.Screen name="favorites" options={{ title: t('nav.favorites') }} />
            <Stack.Screen name="backup" options={{ title: t('nav.backup') }} />
            <Stack.Screen name="regionpacks" options={{ title: t('nav.regionPacks') }} />
            <Stack.Screen name="inaturalist" options={{ title: t('nav.inaturalist') }} />
            <Stack.Screen name="inat-upload" options={{ title: t('nav.inatUpload') }} />
            <Stack.Screen name="report/[kind]/[id]" options={{ title: t('report.navTitle') }} />
          </Stack>
        </View>
        {/* Select popovers render here, NOT via React.createPortal: the portal
            stores the element globally and renders it at THIS position, so the
            popover inherits context from here — which is why it must stay
            inside <FontScaleProvider> (it needs the --ts-* vars) while sitting
            outside the <View> that holds <Stack> (so it paints above every
            screen, its native header, and the ActiveSessionBar). Before
            <ToastHost> so a toast fired with a popover open still wins. */}
        <PortalHost />
        <ToastHost />
        <TextPromptHost />
        <GbifLookupHost />
        <InatTokenHost />
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
