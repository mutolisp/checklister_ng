/**
 * Audio clips for a record, in two pieces so screens can lay them out:
 *
 *   <AudioRecordTile onAdd />   an 88×88 dashed square, the audio twin of
 *                               PhotoGrid's 「拍照」 tile (mic → red stop + timer
 *                               while recording)
 *   <AudioClipRows clips onRemove />  one row per clip: play / stop, timer,
 *                               long-press to remove
 *   <AudioClipList …>           the two stacked — what the session and
 *                               specimen sheets use
 *
 * All plain Views: the sheets that host them are Modals, and iOS will not
 * stack a Modal on a Modal. Recording: `useAudioRecorder` (expo-audio) → on
 * stop the temp file is moved to documentDirectory/audio/ and handed to
 * `onAdd`; the parent owns the DB write, exactly like PhotoGrid's `onAdd`.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';
import { rebaseAppFileUri } from '~/lib/appFiles';
import {
  beginRecordingMode,
  endRecordingMode,
  ensureMicPermission,
  persistRecording,
} from '~/lib/audioCapture';

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The square 「錄音」 tile. Same box as PhotoGrid's add tile so the two can
 *  sit side by side. */
export function AudioRecordTile({ onAdd }: { onAdd: (uri: string) => void }) {
  const { t } = useTranslation();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 500);
  const [busy, setBusy] = useState(false);

  // Sheet closed mid-recording: drop the take and put the audio session back.
  useEffect(
    () => () => {
      try {
        if (recorder.getStatus().isRecording) void recorder.stop();
      } catch {
        // already released
      }
      void endRecordingMode();
    },
    [recorder],
  );

  const toggleRecord = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (rec.isRecording) {
        await recorder.stop();
        const uri = recorder.uri;
        await endRecordingMode();
        if (uri) onAdd(await persistRecording(uri));
      } else {
        if (!(await ensureMicPermission())) {
          Alert.alert(t('species.micDenied'));
          return;
        }
        await beginRecordingMode();
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
    } catch (e) {
      await endRecordingMode();
      Alert.alert(t('species.audioFailTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={toggleRecord}
      disabled={busy}
      className={`mt-2 items-center justify-center rounded-lg border border-dashed ${
        rec.isRecording
          ? 'border-red-400 bg-red-50 dark:bg-red-900/30'
          : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 active:bg-gray-100 dark:active:bg-gray-700'
      }`}
      style={{ width: 88, height: 88 }}
    >
      <Ionicons name={rec.isRecording ? 'stop' : 'mic-outline'} size={24} color={rec.isRecording ? '#dc2626' : '#6b7280'} />
      <Text className={`mt-1 text-xs ${rec.isRecording ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
        {rec.isRecording ? mmss(rec.durationMillis / 1000) : t('species.recordAudio')}
      </Text>
    </Pressable>
  );
}

/** Recorded clips, one row each. Renders nothing when there are none. */
export function AudioClipRows({ clips, onRemove }: { clips: string[]; onRemove: (uri: string) => void }) {
  const { t } = useTranslation();
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  // A new source = a new player (the hook keys on the source), so play() on
  // change is enough; the previous instance is released by the hook.
  const player = useAudioPlayer(playingUri ? { uri: rebaseAppFileUri(playingUri) } : null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (playingUri) player.play();
  }, [player, playingUri]);

  useEffect(() => {
    if (status.didJustFinish) setPlayingUri(null);
  }, [status.didJustFinish]);

  if (clips.length === 0) return null;

  const confirmRemove = (uri: string) => {
    Alert.alert(t('species.removeAudio'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          if (playingUri === uri) setPlayingUri(null);
          onRemove(uri);
        },
      },
    ]);
  };

  return (
    <View className="mt-2">
      {clips.map((uri, i) => {
        const playing = playingUri === uri;
        return (
          <Pressable
            key={uri}
            onPress={() => setPlayingUri(playing ? null : uri)}
            onLongPress={() => confirmRemove(uri)}
            className="mb-1 flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Ionicons name={playing ? 'stop-circle' : 'play-circle-outline'} size={22} color="#2563eb" />
            <Text className="ml-2 flex-1 text-sm text-gray-700 dark:text-gray-300">
              {t('species.audioClipN', { n: i + 1 })}
            </Text>
            {playing ? (
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {mmss(status.currentTime)} / {mmss(status.duration)}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function AudioClipList({
  clips,
  onAdd,
  onRemove,
}: {
  clips: string[];
  onAdd: (uri: string) => void;
  onRemove: (uri: string) => void;
}) {
  return (
    <View>
      <AudioRecordTile onAdd={onAdd} />
      <AudioClipRows clips={clips} onRemove={onRemove} />
    </View>
  );
}
