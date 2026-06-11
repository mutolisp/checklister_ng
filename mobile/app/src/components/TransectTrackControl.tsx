/**
 * Transect track recording control (transect plot only).
 *
 * State machine driven by plot.track_geojson + plot.track_finalized + the
 * `useTrackRecorder` store (module-level so it survives tab unmounts):
 *
 *   idle      : segments=[]      , finalized=0, recording=false
 *   recording : (any)            , finalized=0, recording=true
 *   paused    : segments.length>0, finalized=0, recording=false
 *   finalized : (any)            , finalized=1
 *
 * "暫停" stops the GPS watch and persists the current segment as a closed
 * line; "停止並儲存" does the same plus sets track_finalized=1 so the track
 * can no longer be extended. Plot itself stays active for species entry.
 */
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, Text, View } from 'react-native';
import {
  finalizePlotTrack,
  parseTrackSegments,
  trackLengthMeters,
  type PlotSurvey,
} from '~/db';
import {
  pauseRecording,
  startRecording,
  useTrackRecorder,
} from '~/lib/trackRecorder';
import { TrackPreviewModal } from './TrackPreviewModal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  plot: PlotSurvey;
  onUpdated: () => void;
};

export function TransectTrackControl({ plot, onUpdated }: Props) {
  const { t } = useTranslation();
  const persistedSegments = parseTrackSegments(plot.track_geojson);
  const finalized = plot.track_finalized === 1;
  const plotDone = plot.status === 'done';

  const recordingTarget = useTrackRecorder((s) => s.recordingTarget);
  const livePoints = useTrackRecorder((s) => s.livePoints);
  const recording = recordingTarget?.kind === 'plot' && recordingTarget.id === plot.id;

  const [previewOpen, setPreviewOpen] = useState(false);

  const handleStart = async () => {
    if (plotDone || finalized) return;
    // Block double-recording if some other record is already capturing.
    if (recordingTarget && !(recordingTarget.kind === 'plot' && recordingTarget.id === plot.id)) {
      Alert.alert(t('transect.busyTitle'), t('transect.busyMsg'));
      return;
    }
    try {
      await startRecording({ kind: 'plot', id: plot.id });
      // Refresh upstream so plot.start_ts (just stamped by startRecording)
      // reaches plotCanAcceptSpecies and unblocks the species tab.
      onUpdated();
    } catch (e) {
      Alert.alert(t('transect.startFail'), e instanceof Error ? e.message : String(e));
    }
  };

  const handlePause = () => {
    pauseRecording();
    onUpdated();
  };

  const handleStop = () => {
    Alert.alert(t('transect.stopTitle'), t('transect.stopMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('transect.stop'),
        style: 'destructive',
        onPress: () => {
          pauseRecording();
          finalizePlotTrack(plot.id);
          onUpdated();
        },
      },
    ]);
  };

  // Visual state
  const persistedPointCount = persistedSegments.reduce((n, s) => n + s.length, 0);
  const totalPoints = persistedPointCount + (recording ? livePoints.length : 0);
  const totalSegments = persistedSegments.length + (recording && livePoints.length > 0 ? 1 : 0);
  const previewSegments = recording && livePoints.length > 0
    ? [...persistedSegments, livePoints]
    : persistedSegments;
  const lengthM = trackLengthMeters(previewSegments);
  const lengthStr = lengthM > 1000 ? `${(lengthM / 1000).toFixed(2)} km` : `${lengthM.toFixed(0)} m`;

  return (
    <View className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('transect.label')} <Text className="text-red-500">*</Text>
        </Text>
        {recording ? (
          <View className="flex-row items-center">
            <View className="mr-1.5 h-2 w-2 rounded-full bg-red-500" />
            <Text className="text-xs font-medium text-red-600 dark:text-red-400">{t('records.recording')}</Text>
          </View>
        ) : finalized ? (
          <Text className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('transect.stopped')}</Text>
        ) : totalSegments > 0 ? (
          <Text className="text-xs font-medium text-amber-600">{t('transect.paused')}</Text>
        ) : null}
      </View>

      {totalPoints > 0 ? (
        <Text className="mt-1 text-sm text-gray-900 dark:text-gray-100">
          {t('transect.summary', { segments: totalSegments, points: totalPoints, length: lengthStr })}
        </Text>
      ) : (
        <Text className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('transect.notStarted')}</Text>
      )}

      <View className="mt-3 flex-row gap-2">
        {finalized ? null : recording ? (
          <>
            <ControlButton icon="pause" label={t('transect.pause')} tone="amber" onPress={handlePause} />
            <ControlButton icon="stop" label={t('transect.stopSave')} tone="red" onPress={handleStop} />
          </>
        ) : (
          <>
            <ControlButton
              icon="play"
              label={totalSegments > 0 ? t('transect.resume') : t('transect.start')}
              tone="emerald"
              onPress={handleStart}
              disabled={plotDone}
            />
            {totalSegments > 0 ? (
              <ControlButton icon="stop" label={t('transect.stopSave')} tone="red" onPress={handleStop} />
            ) : null}
          </>
        )}

        {totalPoints > 0 ? (
          <ControlButton
            icon="map-outline"
            label={t('transect.preview')}
            tone="gray"
            onPress={() => setPreviewOpen(true)}
          />
        ) : null}
      </View>

      <TrackPreviewModal
        visible={previewOpen}
        segments={previewSegments}
        title={plot.plotid}
        onClose={() => setPreviewOpen(false)}
      />
    </View>
  );
}

function ControlButton({
  icon,
  label,
  tone,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: 'emerald' | 'amber' | 'red' | 'gray';
  onPress: () => void;
  disabled?: boolean;
}) {
  const bg =
    tone === 'emerald'
      ? 'bg-emerald-500 active:bg-emerald-600'
      : tone === 'amber'
        ? 'bg-amber-500 active:bg-amber-600'
        : tone === 'red'
          ? 'bg-red-500 active:bg-red-600'
          : 'bg-gray-200 dark:bg-gray-700 active:bg-gray-300 dark:active:bg-gray-600';
  const textColor = tone === 'gray' ? 'text-gray-800 dark:text-gray-200' : 'text-white';
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      className={`flex-1 flex-row items-center justify-center rounded-md px-3 py-2 ${bg} ${disabled ? 'opacity-40' : ''}`}
    >
      <Ionicons name={icon} size={14} color={tone === 'gray' ? '#1f2937' : 'white'} />
      <Text className={`ml-1.5 text-xs font-medium ${textColor}`}>{label}</Text>
    </Pressable>
  );
}
