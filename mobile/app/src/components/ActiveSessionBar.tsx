/**
 * Top bar shown while a checklist session or plot survey is in progress.
 *
 * Filename kept as ActiveSessionBar for backward compat; the bar now covers
 * both record kinds and picks whichever started most recently when both are
 * active simultaneously.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';

export function ActiveSessionBar() {
  const router = useRouter();
  const session = useActiveSession((s) => s.session);
  const plot = useActivePlot((s) => s.plot);
  const insets = useSafeAreaInsets();

  if (!session && !plot) return null;

  // Pick the most recently started record to display in the bar. Both may be
  // active at the same time; we surface whichever was last touched.
  const sessionTs = session?.started_at ?? 0;
  const plotTs = plot?.start_ts ?? plot?.created_at ?? 0;
  const showPlot = plot && plotTs >= sessionTs;

  const label = showPlot ? `樣區記錄中：${plot!.plotid}` : `記錄中：${session!.name}`;
  const href: Href = showPlot ? (`/plot/${plot!.id}` as Href) : (`/session/${session!.id}` as Href);

  return (
    <Pressable
      onPress={() => router.push(href)}
      className="bg-emerald-600 active:bg-emerald-700"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center px-4 py-2">
        <View className="mr-2 h-2 w-2 rounded-full bg-white" />
        <Ionicons
          name={showPlot ? 'grid' : 'list'}
          size={14}
          color="white"
          style={{ marginRight: 6 }}
        />
        <Text className="flex-1 text-sm font-medium text-white" numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="white" />
      </View>
    </Pressable>
  );
}
