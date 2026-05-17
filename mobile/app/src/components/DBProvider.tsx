import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { initDb, prewarmFuzzyIndex, prewarmKeys, prewarmKingdoms } from '~/db';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { useSettings } from '~/stores/settings';

type Props = { children: ReactNode };

export function DBProvider({ children }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('正在啟動...');
  const refreshActiveSession = useActiveSession((s) => s.refresh);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
  const loadSettings = useSettings((s) => s.load);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Preload icon font in parallel with DB init. Without this, tab
        // labels appear before tab icons on cold start (Ionicons font is
        // lazy-loaded by @expo/vector-icons on first glyph render).
        const fontPromise = Font.loadAsync(Ionicons.font).catch(() => {
          // Non-fatal: icons fall back to boxes; labels still readable.
        });
        await initDb((step) => {
          if (!cancelled) setProgress(step);
        });
        if (cancelled) return;
        setProgress('載入偏好設定...');
        loadSettings();
        setProgress('載入當前記錄...');
        refreshActiveSession();
        refreshActivePlot();
        setProgress('載入分類群...');
        // Kingdom prewarm moved BEFORE setReady. Cost is ~200ms but the user
        // already sees splash + progress text; the cost is invisible here and
        // GUARANTEES the 物種 tab opens cached even if the user taps it the
        // moment splash hides (the previous setTimeout(0) variant lost that
        // race when the tap landed before the macrotask fired).
        try {
          prewarmKingdoms();
        } catch {
          // non-fatal: taxonomy tab falls back to lazy SQL
        }
        setProgress('載入字型...');
        await fontPromise;
        if (cancelled) return;
        setReady(true);
        // Off-critical-path warmups for things the user may or may not hit.
        // Kept in setTimeout(0) so they don't delay first paint.
        //   - fuzzy index: 62k cname index, ~200-500ms cold-load
        //   - keys list: per-key child_count subqueries scan 242k taicol_names,
        //     ~1-2s; the first KeyListView mount or KeyPopup tap would otherwise
        //     pay this synchronously.
        setTimeout(() => {
          try {
            prewarmFuzzyIndex();
          } catch {
            // non-fatal: search still works via exact path
          }
          try {
            prewarmKeys();
          } catch {
            // non-fatal: KeyListView falls back to lazy load
          }
        }, 0);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        // Native splash must always be released even on error so the user
        // can see the error screen / Stack. Ignore if already hidden.
        SplashScreen.hideAsync().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSettings, refreshActiveSession, refreshActivePlot]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-red-50 dark:bg-red-950/40 px-6">
        <Text className="text-lg font-bold text-red-700 dark:text-red-400">資料庫初始化失敗</Text>
        <Text className="mt-2 text-center text-sm text-red-600 dark:text-red-400">{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-8">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-sm text-gray-700 dark:text-gray-300">{progress}</Text>
      </View>
    );
  }

  return <>{children}</>;
}
