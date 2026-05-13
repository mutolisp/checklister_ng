/**
 * Persistent track-recording state, lifted out of any React component so it
 * survives unmounts (e.g. switching between Env/Species tabs inside a plot).
 *
 * Layout:
 *   - module-scope `watchSub` holds the actual expo-location subscription
 *   - module-scope `currentSegmentByPlot` holds the in-progress live points
 *   - zustand store exposes the bits the UI needs to render
 *
 * Why not put the subscription in the zustand store? Subscriptions are
 * opaque native handles; storing them in a state container can interact
 * weirdly with shallow equality checks. Plain module refs are simpler.
 */
import * as Location from 'expo-location';
import { create } from 'zustand';
import {
  buildTrackGeoJSON,
  parseTrackSegments,
  updatePlotSurvey,
  writePlotTrack,
  type PlotSurvey,
  type TrackSegment,
} from '~/db';

const BATCH_FLUSH_POINTS = 5;
const MIN_DISTANCE_M = 5;
const MIN_TIME_MS = 4000;

// Module-scope mutable refs
let watchSub: Location.LocationSubscription | null = null;
let currentPlotId: number | null = null;
let currentSegment: TrackSegment = [];
let priorSegmentsSnapshot: TrackSegment[] = [];

type RecorderState = {
  /** id of plot currently being recorded into, or null when idle. */
  recordingPlotId: number | null;
  /** Live points of the current (not-yet-committed) segment. */
  livePoints: TrackSegment;
};

export const useTrackRecorder = create<RecorderState>(() => ({
  recordingPlotId: null,
  livePoints: [],
}));

/** Start watching GPS and appending to a new segment on the given plot. */
export async function startRecording(plot: PlotSurvey): Promise<void> {
  if (watchSub) return; // already recording
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    throw new Error('需要定位權限');
  }

  currentPlotId = plot.id;
  currentSegment = [];
  priorSegmentsSnapshot = parseTrackSegments(plot.track_geojson);
  useTrackRecorder.setState({ recordingPlotId: plot.id, livePoints: [] });

  // Stamp start_ts immediately so species entry can begin before the first
  // GPS fix arrives (transect plotCanAcceptSpecies keys off start_ts).
  if (plot.start_ts == null) {
    updatePlotSurvey(plot.id, { start_ts: Date.now() });
  }

  watchSub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: MIN_DISTANCE_M,
      timeInterval: MIN_TIME_MS,
    },
    (pos) => {
      if (currentPlotId == null) return;
      const pt: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      currentSegment.push(pt);
      useTrackRecorder.setState({ livePoints: [...currentSegment] });

      // First GPS fix on this plot satisfies the hard-gate for species entry.
      // Transect plots have no static GPS field; co-opt the first track point.
      if (
        plot.decimal_latitude === null ||
        plot.decimal_longitude === null ||
        plot.coord_uncertainty_m === null
      ) {
        if (priorSegmentsSnapshot.length === 0 && currentSegment.length === 1) {
          updatePlotSurvey(plot.id, {
            decimal_latitude: pos.coords.latitude,
            decimal_longitude: pos.coords.longitude,
            coord_uncertainty_m: pos.coords.accuracy ?? null,
            start_ts: plot.start_ts ?? Date.now(),
          });
        }
      }

      // Persist every BATCH_FLUSH_POINTS points to avoid loss on crash.
      if (currentSegment.length % BATCH_FLUSH_POINTS === 0) {
        writePlotTrack(plot.id, [...priorSegmentsSnapshot, currentSegment.slice()]);
      }
    },
  );
}

/** Stop the watch and commit the in-progress segment back to plot.track_geojson. */
export function pauseRecording(): void {
  if (watchSub) {
    watchSub.remove();
    watchSub = null;
  }
  if (currentPlotId != null && currentSegment.length > 0) {
    const next = [...priorSegmentsSnapshot, currentSegment.slice()];
    writePlotTrack(currentPlotId, next);
    priorSegmentsSnapshot = next;
  }
  currentSegment = [];
  currentPlotId = null;
  useTrackRecorder.setState({ recordingPlotId: null, livePoints: [] });
}

/** Whether the recorder currently owns a GPS subscription. */
export function isRecording(): boolean {
  return watchSub != null;
}
