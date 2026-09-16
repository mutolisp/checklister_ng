/**
 * Navigation-back with a guaranteed fallback.
 *
 * `router.back()` is a no-op when there is no history (e.g. the screen was
 * reached via `router.replace`, or via a deep link / state restore). The
 * native header's default back button has the same problem — it just sits
 * there doing nothing. This helper falls back to the home tab so the user is
 * never stuck.
 */
import i18n from '~/i18n';
import { router } from 'expo-router';
import { HeaderIconButton } from '~/components/HeaderIconButton';

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
  // The button's square box is what centres the glyph — Ionicons' chevron
  // carries an asymmetric bearing, so padding alone leaves it off-centre.
  return (
    <HeaderIconButton
      icon="chevron-back"
      onPress={goBackOrHome}
      label={i18n.t('nav.back')}
      edge="left"
    />
  );
}
