/**
 * Shared chrome for every 偏好設定 detail page (匯出設定 / 標本採集 / 語言 /
 * 調查者 / 區域名錄 / iNaturalist).
 *
 * Deliberately no built-in scroller: regionpacks renders a FlatList, surveyors
 * a DraggableFlatList, inaturalist a padded ScrollView. A `scroll` prop three
 * of six screens would set to `false` is magic that buys nothing — each screen
 * brings its own, and this wrapper stays byte-equivalent to what they had.
 *
 * `headerLeft` is unconditional: these are deep-linkable routes, and the native
 * back button is a no-op with no history (that is what `BackHeaderLeft` is for).
 * The trade is losing iOS's long-press back-history menu; surveyors.tsx already
 * made it.
 */
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeaderLeft } from '~/lib/goBack';

type Props = {
  /** Omit to keep the title registered in app/_layout.tsx. */
  title?: string;
  headerRight?: () => ReactNode;
  children: ReactNode;
};

export function SettingsPage({ title, headerRight, children }: Props) {
  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          ...(title ? { title } : {}),
          headerLeft: BackHeaderLeft,
          ...(headerRight ? { headerRight } : {}),
        }}
      />
      {children}
    </SafeAreaView>
  );
}
