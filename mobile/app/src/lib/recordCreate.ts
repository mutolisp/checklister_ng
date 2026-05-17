/**
 * Helpers shared by the central FAB and any contextual entry that needs to
 * create a new "record" (session or plot) and navigate to its detail screen.
 *
 * Enforces single-active-record semantics: at any time at most one session
 * OR one plot may be active. Attempting to start another while a different
 * kind is active prompts the user to finish / resume the active one first.
 */
import { Alert } from 'react-native';
import { router, type Href } from 'expo-router';
import {
  createPlotSurvey,
  endPlotSurvey,
  endSession,
  type PlotType,
} from '~/db';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { pauseRecording as pauseTrackRecording, useTrackRecorder } from '~/lib/trackRecorder';
import { promptText } from '~/components/TextPromptModal';
import { showActionSheet } from '~/components/ActionSheet';

type NewRecordKind = 'session' | 'plot';

type ActiveConflict = {
  kind: NewRecordKind;
  label: string;
  href: Href;
  end: () => void;
};

/**
 * Read both active stores and return a description of the active record (if
 * any) that conflicts with starting a new one. Plot takes precedence when
 * both somehow coexist (it's the heavier-weight record).
 */
function findActiveConflict(): ActiveConflict | null {
  const plot = useActivePlot.getState().plot;
  if (plot) {
    return {
      kind: 'plot',
      label: plot.plotid || '樣區',
      href: `/plot/${plot.id}` as Href,
      end: () => {
        const recording = useTrackRecorder.getState().recordingPlotId;
        if (recording === plot.id) pauseTrackRecording();
        endPlotSurvey(plot.id);
        useActivePlot.getState().refresh();
      },
    };
  }
  const session = useActiveSession.getState().session;
  if (session) {
    return {
      kind: 'session',
      label: session.name,
      href: `/session/${session.id}` as Href,
      end: () => {
        endSession(session.id);
        useActiveSession.getState().refresh();
      },
    };
  }
  return null;
}

const NOUN: Record<NewRecordKind, string> = { session: '名錄', plot: '樣區' };

/**
 * Three-button Alert offering: cancel / open existing / end + start new.
 * Resolves true only when the user picks "end + start new" (the only branch
 * that frees up the active slot).
 */
function showConflictAlert(conflict: ActiveConflict, wanted: NewRecordKind): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      `已有${NOUN[conflict.kind]}記錄中`,
      `「${conflict.label}」正在進行。要先結束它，再開始新的${NOUN[wanted]}嗎？`,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        {
          text: `前往${NOUN[conflict.kind]}`,
          onPress: () => {
            router.push(conflict.href);
            resolve(false);
          },
        },
        {
          text: `結束並開始新${NOUN[wanted]}`,
          style: 'destructive',
          onPress: () => {
            conflict.end();
            resolve(true);
          },
        },
      ],
    );
  });
}

/**
 * Returns true once it's safe to create a new record of `wanted` kind:
 * either nothing is active, or the user chose to end the conflicting one.
 * Returns false if the user cancelled or chose to resume the active record.
 */
async function ensureNoConflictingActive(wanted: NewRecordKind): Promise<boolean> {
  // Refresh from DB before reading — another screen may have ended a record
  // without the in-memory store seeing it yet, and we don't want to falsely
  // detect a conflict (or miss a real one because the store is stale).
  useActiveSession.getState().refresh();
  useActivePlot.getState().refresh();

  const conflict = findActiveConflict();
  if (!conflict) return true;
  return showConflictAlert(conflict, wanted);
}

/**
 * Start (or resume) the user's checklist session and navigate to it.
 * Prompts (cancel / go to existing / end + new) when any record is already
 * active.
 */
export async function startSessionAndOpen(): Promise<void> {
  const ok = await ensureNoConflictingActive('session');
  if (!ok) return;
  const store = useActiveSession.getState();
  const target = store.session ?? store.start();
  router.push(`/session/${target.id}` as Href);
}

async function promptPlotid(plotType: PlotType): Promise<void> {
  const title = plotType === 'transect' ? '新穿越線' : '新植群樣區';
  const example = plotType === 'transect' ? 'TRANSECT_2026_001' : 'PLOT_2026_001';
  const raw = await promptText({
    title,
    message: `輸入 plotid（例：${example}）`,
    placeholder: example,
    autoCapitalize: 'none',
  });
  const plotid = raw?.trim();
  if (!plotid) return;
  const id = createPlotSurvey({
    plotid,
    plot_type: plotType,
    sampling_protocol: plotType === 'transect' ? '穿越線調查法' : null,
  });
  useActivePlot.getState().refresh();
  router.push(`/plot/${id}` as Href);
}

/**
 * Show a type chooser (固定樣區 / 穿越線), then prompt for plotid and create.
 * Guards against a conflicting active record first.
 */
export async function createPlotPromptAndOpen(): Promise<void> {
  const ok = await ensureNoConflictingActive('plot');
  if (!ok) return;
  const idx = await showActionSheet({
    title: '樣區類型',
    options: [
      { label: '固定樣區（4 層植群）' },
      { label: '穿越線（單層、含軌跡）' },
    ],
  });
  if (idx === 0) promptPlotid('fixed');
  else if (idx === 1) promptPlotid('transect');
}
