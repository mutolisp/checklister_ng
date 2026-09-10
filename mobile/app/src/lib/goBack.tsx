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
import { Pressable } from 'react-native';

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
  // Chevron only. The word "back" cost a third of the header's width in the
  // longer European languages and said nothing the glyph does not; it lives on
  // as the accessibility label, which is where a screen reader looks for it.
  // The square box is what centres the glyph — Ionicons' chevron carries an
  // asymmetric bearing, so padding alone leaves it visibly off-centre.
  return (
    <Pressable
      onPress={goBackOrHome}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={i18n.t('nav.back')}
      className="-ml-1 h-9 w-9 items-center justify-center active:opacity-60"
    >
      <Ionicons name="chevron-back" size={26} color="#2563eb" />
    </Pressable>
  );
}
