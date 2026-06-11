/**
 * Prompts the user when an active plot has gone idle for ≥ 30 minutes.
 *
 * "Idle" = no species record in plot_species_records for that plot in the
 * trailing 30 min window. Plots that haven't received a single record yet
 * use plot.start_ts as the baseline.
 *
 * Trigger surfaces:
 *   - Every minute via setInterval (foreground only)
 *   - When the app comes back to "active" via AppState
 *
 * The watcher does not auto-stop tracks or plots; it only nudges the user.
 */
import { useEffect, useRef } from 'react';
import i18n from '~/i18n';
import { AppState, type AppStateStatus } from 'react-native';
import { showActionSheet } from './ActionSheet';
import { useRouter, type Href } from 'expo-router';
import {
  endPlotSurvey,
  latestPlotActivityAt,
  type PlotSurvey,
} from '~/db';
import { useActivePlot } from '~/stores/activePlot';
import { pauseRecording, useTrackRecorder } from '~/lib/trackRecorder';

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

export function StalePlotWatcher() {
  const plot = useActivePlot((s) => s.plot);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
  const recordingPlotId = useTrackRecorder((s) =>
    s.recordingTarget?.kind === 'plot' ? s.recordingTarget.id : null,
  );
  const router = useRouter();
  // Don't repeatedly nag the same idle session — remember which check we already prompted.
  const lastPromptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!plot) return;

    const check = () => maybeWarn(plot, recordingPlotId, lastPromptKeyRef, router, refreshActivePlot);

    // Initial fire after mount in case we already opened the app to a stale plot.
    check();

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') check();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [plot, recordingPlotId, router, refreshActivePlot]);

  return null;
}

function maybeWarn(
  plot: PlotSurvey,
  recordingPlotId: number | null,
  lastPromptKeyRef: React.MutableRefObject<string | null>,
  router: ReturnType<typeof useRouter>,
  refreshActivePlot: () => void,
) {
  // Baseline = MAX(start_ts, resumed_at, latest_species_observed_at). Without
  // resumed_at, reopening an old plot would instantly hit IDLE_THRESHOLD_MS.
  const lastSpeciesAt = latestPlotActivityAt(plot.id);
  const candidates: number[] = [];
  if (plot.start_ts != null) candidates.push(plot.start_ts);
  if (plot.resumed_at != null) candidates.push(plot.resumed_at);
  if (lastSpeciesAt != null) candidates.push(lastSpeciesAt);
  if (candidates.length === 0) return;
  const baseline = Math.max(...candidates);

  const idleMs = Date.now() - baseline;
  if (idleMs < IDLE_THRESHOLD_MS) return;

  // De-dupe: key by plot id + baseline so we only prompt once per "stuck moment".
  const promptKey = `${plot.id}:${baseline}`;
  if (lastPromptKeyRef.current === promptKey) return;
  lastPromptKeyRef.current = promptKey;

  const minutes = Math.round(idleMs / (60 * 1000));
  const noun =
    plot.plot_type === 'transect' ? i18n.t('map.plotTransect') : plot.plot_type === 'point_count' ? i18n.t('map.plotPointCount') : i18n.t('nav.plot');
  void showActionSheet({
    title: i18n.t('watcher.plotIdle', { noun, minutes }),
    message: i18n.t('watcher.plotIdleMsg', { plotid: plot.plotid, minutes }),
    cancelLabel: i18n.t('watcher.keepRecording'),
    options: [
      { label: i18n.t('session.end'), destructive: true },
      { label: i18n.t('watcher.goToPlot') },
    ],
  }).then((idx) => {
    if (idx === 0) {
      // If a track is being recorded for this plot, stop it cleanly first.
      if (recordingPlotId === plot.id) pauseRecording();
      endPlotSurvey(plot.id);
      refreshActivePlot();
    } else if (idx === 1) {
      router.push(`/plot/${plot.id}` as Href);
    }
  });
}
