/**
 * Navigation-back with a guaranteed fallback.
 *
 * `router.back()` is a no-op when there is no history (e.g. the screen was
 * reached via `router.replace`, or via a deep link / state restore). The
 * native header's default back button has the same problem — it just sits
 * there doing nothing. This helper falls back to the home tab so the user is
 * never stuck.
 */
import { Ionicons } from '@expo/vector-icons';
import i18n from '~/i18n';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

export function goBackOrHome(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/');
}

/** Drop-in `headerLeft` for `<Stack.Screen options={{ headerLeft }} />` that
 *  always lands somewhere — falls back to home when the navigation stack has
 *  no history (e.g. screen reached via `router.replace` or a deep link). */
export function BackHeaderLeft() {
  return (
    <Pressable onPress={goBackOrHome} hitSlop={8} className="flex-row items-center">
      <Ionicons name="chevron-back" size={22} color="#2563eb" />
      <Text className="ml-0.5 text-base text-blue-600 dark:text-blue-400">{i18n.t('nav.back')}</Text>
    </Pressable>
  );
}
