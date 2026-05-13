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

type Props = {
  plot: PlotSurvey;
  onUpdated: () => void;
};

export function TransectTrackControl({ plot, onUpdated }: Props) {
  const persistedSegments = parseTrackSegments(plot.track_geojson);
  const finalized = plot.track_finalized === 1;
  const plotDone = plot.status === 'done';

  const recordingPlotId = useTrackRecorder((s) => s.recordingPlotId);
  const livePoints = useTrackRecorder((s) => s.livePoints);
  const recording = recordingPlotId === plot.id;

  const [previewOpen, setPreviewOpen] = useState(false);

  const handleStart = async () => {
    if (plotDone || finalized) return;
    // Block double-recording if some other plot is already capturing.
    if (recordingPlotId != null && recordingPlotId !== plot.id) {
      Alert.alert('已有樣區正在記錄', '請先停止或暫停其他樣區的軌跡');
      return;
    }
    try {
      await startRecording(plot);
      // Refresh upstream so plot.start_ts (just stamped by startRecording)
      // reaches plotCanAcceptSpecies and unblocks the species tab.
      onUpdated();
    } catch (e) {
      Alert.alert('無法啟動軌跡', e instanceof Error ? e.message : String(e));
    }
  };

  const handlePause = () => {
    pauseRecording();
    onUpdated();
  };

  const handleStop = () => {
    Alert.alert('停止並儲存軌跡？', '停止後將無法再 append 新點，但仍可繼續記錄物種。', [
      { text: '取消', style: 'cancel' },
      {
        text: '停止',
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
    <View className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium text-gray-600">
          穿越線軌跡 <Text className="text-red-500">*</Text>
        </Text>
        {recording ? (
          <View className="flex-row items-center">
            <View className="mr-1.5 h-2 w-2 rounded-full bg-red-500" />
            <Text className="text-xs font-medium text-red-600">記錄中</Text>
          </View>
        ) : finalized ? (
          <Text className="text-xs font-medium text-gray-500">已停止</Text>
        ) : totalSegments > 0 ? (
          <Text className="text-xs font-medium text-amber-600">已暫停</Text>
        ) : null}
      </View>

      {totalPoints > 0 ? (
        <Text className="mt-1 text-sm text-gray-900">
          {totalSegments} 段 · {totalPoints} 點 · {lengthStr}
        </Text>
      ) : (
        <Text className="mt-1 text-xs text-gray-400">尚未開始記錄軌跡（物種輸入需此資料）</Text>
      )}

      <View className="mt-3 flex-row gap-2">
        {finalized ? null : recording ? (
          <>
            <ControlButton icon="pause" label="暫停" tone="amber" onPress={handlePause} />
            <ControlButton icon="stop" label="停止並儲存" tone="red" onPress={handleStop} />
          </>
        ) : (
          <>
            <ControlButton
              icon="play"
              label={totalSegments > 0 ? '繼續' : '開始記錄'}
              tone="emerald"
              onPress={handleStart}
              disabled={plotDone}
            />
            {totalSegments > 0 ? (
              <ControlButton icon="stop" label="停止並儲存" tone="red" onPress={handleStop} />
            ) : null}
          </>
        )}

        {totalPoints > 0 ? (
          <ControlButton
            icon="map-outline"
            label="預覽"
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
          : 'bg-gray-200 active:bg-gray-300';
  const textColor = tone === 'gray' ? 'text-gray-800' : 'text-white';
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
