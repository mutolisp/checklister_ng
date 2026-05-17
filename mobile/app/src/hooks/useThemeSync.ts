import { useEffect } from 'react';
import { useColorScheme as useRnColorScheme } from 'react-native';
import { useColorScheme as useNwColorScheme } from 'nativewind';
import { useSettings, type Theme } from '~/stores/settings';

export type EffectiveScheme = 'light' | 'dark';

/**
 * Resolve user's theme preference to a concrete 'light' | 'dark' value.
 * 'auto' delegates to the OS setting.
 */
export function resolveScheme(theme: Theme, system: 'light' | 'dark' | null | undefined): EffectiveScheme {
  if (theme === 'light' || theme === 'dark') return theme;
  return system === 'dark' ? 'dark' : 'light';
}

/**
 * Single source of truth that:
 *   1. Watches `settings.theme` + system color scheme
 *   2. Pushes the user's preference into NativeWind. For 'auto' we pass the
 *      literal `'system'` so NativeWind owns the Appearance listener and
 *      reacts to OS-level light/dark changes mid-session. For an explicit
 *      'light'/'dark' we lock NativeWind to that value.
 *   3. Returns the resolved scheme for downstream consumers
 *      (Navigation theme, StatusBar style, etc.)
 *
 * Mount once at the app root.
 */
export function useThemeSync(): EffectiveScheme {
  const theme = useSettings((s) => s.theme);
  const system = useRnColorScheme();
  const { setColorScheme } = useNwColorScheme();

  useEffect(() => {
    setColorScheme(theme === 'auto' ? 'system' : theme);
  }, [theme, setColorScheme]);

  return resolveScheme(theme, system);
}
