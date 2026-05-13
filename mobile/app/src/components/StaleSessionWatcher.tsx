import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { endSession } from '~/db';
import { useActiveSession } from '~/stores/activeSession';

const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Once per app launch, if the active session has been running for >12h,
 * prompt the user to either continue or end it. Mount this once near the
 * top of the tab tree where useRouter is available.
 */
export function StaleSessionWatcher() {
  const session = useActiveSession((s) => s.session);
  const refresh = useActiveSession((s) => s.refresh);
  const router = useRouter();
  const promptedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!session) return;
    if (promptedFor.current === session.id) return;
    const ageMs = Date.now() - session.started_at;
    if (ageMs < STALE_THRESHOLD_MS) return;

    promptedFor.current = session.id;

    const startedAt = new Date(session.started_at);
    const dateStr = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())} ${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())}`;
    const hours = Math.round(ageMs / (60 * 60 * 1000));

    Alert.alert(
      '上次的 session 還沒結束',
      `「${session.name}」（${dateStr}）已經開了 ${hours} 小時，要繼續記錄還是結束？`,
      [
        {
          text: '繼續記錄',
          onPress: () => router.push(`/session/${session.id}`),
        },
        {
          text: '結束',
          style: 'destructive',
          onPress: () => {
            endSession(session.id);
            refresh();
          },
        },
      ],
    );
  }, [session, router, refresh]);

  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
