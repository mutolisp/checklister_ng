import { useEffect } from 'react';
import { useSettings } from '~/stores/settings';
import i18n, { resolveLanguage } from '~/i18n';

/**
 * Watches `settings.language` ('system' → device locale) and pushes the
 * resolved language into i18next. Changing it calls `i18n.changeLanguage`,
 * which re-renders every `useTranslation` consumer — the whole UI switches
 * language live, no restart (mirrors `useThemeSync`). Mount once at app root.
 */
export function useI18nSync(): void {
  const language = useSettings((s) => s.language);
  useEffect(() => {
    const next = resolveLanguage(language);
    if (i18n.language !== next) i18n.changeLanguage(next);
  }, [language]);
}
