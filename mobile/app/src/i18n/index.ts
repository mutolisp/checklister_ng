import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NativeModules } from 'react-native';
import type { Language } from '~/stores/settings';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import es419 from './locales/es-419.json';

/** Languages with a locale file shipped. Every entry needs a locale JSON that
 *  is structurally identical to zh-TW (enforced by `npm run check:i18n`). */
export const SUPPORTED_LANGUAGES = [
  'en',
  'zh-TW',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'es-419',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_LANGUAGES);

/**
 * Every selectable UI language, in one place — adding a language means adding
 * a locale JSON, a `SUPPORTED_LANGUAGES` entry and a row here.
 *
 * `native` is the endonym and is what the picker shows: someone hunting for
 * their own language reads it in that language, not in whatever language the
 * UI happens to be in right now. `english` exists so the picker's search box
 * can be typed in ASCII from any UI language ("german" finds Deutsch).
 */
export const LANGUAGE_CATALOGUE: Array<{
  value: SupportedLanguage;
  native: string;
  english: string;
}> = [
  { value: 'zh-TW', native: '正體中文', english: 'Traditional Chinese' },
  { value: 'en', native: 'English', english: 'English' },
  { value: 'ja', native: '日本語', english: 'Japanese' },
  { value: 'ko', native: '한국어', english: 'Korean' },
  { value: 'de', native: 'Deutsch', english: 'German' },
  { value: 'fr', native: 'Français', english: 'French' },
  { value: 'es', native: 'Español', english: 'Spanish' },
  { value: 'es-419', native: 'Español (Latinoamérica)', english: 'Spanish (Latin America)' },
];

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

/** Spanish-speaking countries of Latin America + the CLDR region code itself,
 *  in ISO 3166-1 alpha-2. Used only to pick es-419 over es. */
const LATIN_AMERICA_ES = new Set([
  '419', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT',
  'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
]);

/** Best supported language for the device locale, else null. */
function matchDeviceLocale(): SupportedLanguage | null {
  const locale = deviceLocaleTag().toLowerCase();
  if (locale.startsWith('zh')) return 'zh-TW';
  if (locale.startsWith('en')) return 'en';
  if (locale.startsWith('ja')) return 'ja';
  // Korean device tags appear as 'ko', 'ko-KR' and the legacy 'kor'.
  if (locale.startsWith('ko')) return 'ko';
  if (locale.startsWith('de')) return 'de';
  if (locale.startsWith('fr')) return 'fr';
  if (locale.startsWith('es')) {
    // CLDR routes es-MX / es-AR / … to es-419 (Latin American Spanish) rather
    // than truncating to es, because that is the closer match. Region is read
    // off the tag; Spain, an unknown region and a bare 'es' all take the
    // base file.
    const region = locale.split(/[-_]/)[1]?.toUpperCase() ?? '';
    return LATIN_AMERICA_ES.has(region) ? 'es-419' : 'es';
  }
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
    ja: { translation: ja },
    ko: { translation: ko },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    // Override-only: just the keys whose Spain wording would read wrong in
    // Latin America. Everything else falls through to `es` (see fallbackLng).
    'es-419': { translation: es419 },
  },
  // Initial guess from the device locale so a system-language user doesn't see
  // a zh-TW flash before `useI18nSync` applies the stored preference on mount.
  lng: matchDeviceLocale() ?? 'zh-TW',
  // zh-TW is the authoritative, always-complete source; any missing key in
  // another language degrades to Chinese rather than a raw key. es-419 is the
  // one override-only file, so it resolves through es first.
  fallbackLng: { 'es-419': ['es', 'zh-TW'], default: ['zh-TW'] },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
