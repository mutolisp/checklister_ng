import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { initDb } from '~/db';
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
    const t0 = Date.now();
    (async () => {
      try {
        const tInit = Date.now();
        await initDb((step) => {
          if (cancelled) return;
          setProgress(step);
          // eslint-disable-next-line no-console
          console.log(`[startup] ${step}  +${Date.now() - t0}ms`);
        });
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.log(`[startup] initDb done  +${Date.now() - tInit}ms`);

        setProgress('載入偏好設定...');
        const tSettings = Date.now();
        loadSettings();
        // eslint-disable-next-line no-console
        console.log(`[startup] loadSettings  +${Date.now() - tSettings}ms`);

        setProgress('載入當前記錄...');
        const tActive = Date.now();
        refreshActiveSession();
        refreshActivePlot();
        // eslint-disable-next-line no-console
        console.log(`[startup] refreshActive  +${Date.now() - tActive}ms`);

        // eslint-disable-next-line no-console
        console.log(`[startup] TOTAL JS init  +${Date.now() - t0}ms`);
        setReady(true);
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
      <View className="flex-1 items-center justify-center bg-red-50 px-6">
        <Text className="text-lg font-bold text-red-700">資料庫初始化失敗</Text>
        <Text className="mt-2 text-center text-sm text-red-600">{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-sm text-gray-700">{progress}</Text>
      </View>
    );
  }

  return <>{children}</>;
}
