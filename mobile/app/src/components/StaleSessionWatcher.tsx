import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { endSession, latestSessionActivityAt } from '~/db';
import { useActiveSession } from '~/stores/activeSession';
import { isRecordingTarget, pauseRecording } from '~/lib/trackRecorder';

const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Once per app launch, if the active session has been idle for >12h, prompt
 * the user to either continue or end it. Mount this once near the top of the
 * tab tree where useRouter is available.
 *
 * Baseline = MAX(started_at, resumed_at, latest_record_observed_at). Without
 * the resumed_at + activity floors, reopening a 3-day-old session to add one
 * taxon would immediately re-fire "已開了 72 小時" — annoying noise.
 */
export function StaleSessionWatcher() {
  const session = useActiveSession((s) => s.session);
  const refresh = useActiveSession((s) => s.refresh);
  const router = useRouter();
  const promptedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!session) return;
    if (promptedFor.current === session.id) return;
    const lastActivity = latestSessionActivityAt(session.id);
    const baseline = Math.max(
      session.started_at,
      session.resumed_at ?? 0,
      lastActivity ?? 0,
    );
    const ageMs = Date.now() - baseline;
    if (ageMs < STALE_THRESHOLD_MS) return;

    promptedFor.current = session.id;

    const baseDate = new Date(baseline);
    const dateStr = `${baseDate.getFullYear()}-${pad(baseDate.getMonth() + 1)}-${pad(baseDate.getDate())} ${pad(baseDate.getHours())}:${pad(baseDate.getMinutes())}`;
    const hours = Math.round(ageMs / (60 * 60 * 1000));

    Alert.alert(
      '記錄已閒置一段時間',
      `「${session.name}」上次活動是 ${dateStr}，已過 ${hours} 小時。要繼續記錄還是結束？`,
      [
        {
          text: '繼續記錄',
          onPress: () => router.push(`/session/${session.id}`),
        },
        {
          text: '結束',
          style: 'destructive',
          onPress: () => {
            if (isRecordingTarget({ kind: 'session', id: session.id })) pauseRecording();
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
