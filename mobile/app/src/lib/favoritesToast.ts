/**
 * "Added to 常用名錄" toasts, with a way to actually get there.
 *
 * The four places that add a species to a list are all deep inside other
 * screens (taxonomy tree, session detail, plot species tab, map import), and a
 * bare confirmation leaves the user to navigate to the list by hand — several
 * taps away from where they are. The toast already supports an action, so it
 * carries the link.
 *
 * Uses the imperative `router` and `i18n.t` rather than hooks, because two of
 * the call sites are inside action-sheet callbacks that are not components
 * (same reason `recordCreate.ts` does it this way).
 */
import { router } from 'expo-router';
import i18n from '~/i18n';
import { useToast } from '~/stores/toast';

/** Toast that a species was added, with a link to the favourites screen. */
export function toastFavoriteAdded(message?: string): void {
  useToast.getState().show(message ?? i18n.t('favorites.added'), {
    action: {
      label: i18n.t('favorites.goToFavorites'),
      onPress: () => router.push('/favorites'),
    },
  });
}
