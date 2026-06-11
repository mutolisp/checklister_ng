import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NativeModules } from 'react-native';
import type { Language } from '~/stores/settings';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';

/** Languages with a locale file shipped. Add 'ja' / 'ko' here when their
 *  locale JSON lands — `resolveLanguage` + the settings picker pick them up. */
export const SUPPORTED_LANGUAGES = ['en', 'zh-TW'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_LANGUAGES);

/** Raw device locale tag (e.g. 'zh-Hant-TW', 'zh_TW', 'en-US'). Reads React
 *  Native's *core* locale modules — always compiled into the RN binary, so no
 *  optional native module to be missing (unlike expo-localization), and unlike
 *  Hermes `Intl.resolvedOptions().locale` which returns a fixed 'en-US' on some
 *  Hermes builds. Probes both modules rather than branching on Platform.OS:
 *  Android exposes I18nManager.localeIdentifier, iOS exposes SettingsManager. */
function deviceLocaleTag(): string {
  try {
    const { SettingsManager, I18nManager } = NativeModules as {
      SettingsManager?: { settings?: { AppleLocale?: string; AppleLanguages?: string[] } };
      I18nManager?: { localeIdentifier?: string };
    };
    return (
      I18nManager?.localeIdentifier ||
      SettingsManager?.settings?.AppleLocale ||
      SettingsManager?.settings?.AppleLanguages?.[0] ||
      ''
    );
  } catch {
    return '';
  }
}

/** Best supported language for the device locale, else null. */
function matchDeviceLocale(): SupportedLanguage | null {
  const locale = deviceLocaleTag().toLowerCase();
  if (locale.startsWith('zh')) return 'zh-TW';
  if (locale.startsWith('en')) return 'en';
  // 'ja' / 'ko' resolve here once their locale files exist.
  return null;
}

/** Resolve a stored `language` setting to a concrete supported language.
 *  'system' (or an unsupported value) → device locale → 'zh-TW' (the app's
 *  native language and every existing user's language, so detection failure
 *  degrades to no visible change rather than an English flip). */
export function resolveLanguage(setting: Language): SupportedLanguage {
  if (setting !== 'system' && SUPPORTED.has(setting)) return setting as SupportedLanguage;
  return matchDeviceLocale() ?? 'zh-TW';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-TW': { translation: zhTW },
  },
  // Initial guess from the device locale so a system-language user doesn't see
  // a zh-TW flash before `useI18nSync` applies the stored preference on mount.
  lng: matchDeviceLocale() ?? 'zh-TW',
  // zh-TW is the authoritative, always-complete source; any missing key in
  // another language degrades to Chinese rather than a raw key.
  fallbackLng: 'zh-TW',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
