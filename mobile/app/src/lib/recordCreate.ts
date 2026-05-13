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

/**
 * Returns true once it's safe to create a new record of `wanted` kind:
 * either nothing is active, or the user chose to end the conflicting one.
 * Returns false if the user cancelled or chose to resume the active record.
 */
async function ensureNoConflictingActive(wanted: NewRecordKind): Promise<boolean> {
  const session = useActiveSession.getState().session;
  const plot = useActivePlot.getState().plot;

  // Decide which active record (if any) blocks the new one. Same-kind conflicts
  // are handled by the existing reuse logic (sessions) or by the user
  // creating intentionally; we only intervene on cross-kind clashes plus the
  // plot→plot case (we don't allow >1 active plot either).
  const conflict: { kind: NewRecordKind; label: string; href: Href; end: () => void } | null =
    plot
      ? {
          kind: 'plot',
          label: plot.plotid || '樣區',
          href: `/plot/${plot.id}` as Href,
          end: () => {
            const recording = useTrackRecorder.getState().recordingPlotId;
            if (recording === plot.id) pauseTrackRecording();
            endPlotSurvey(plot.id);
            useActivePlot.getState().refresh();
          },
        }
      : session && wanted === 'plot'
        ? {
            kind: 'session',
            label: session.name,
            href: `/session/${session.id}` as Href,
            end: () => {
              endSession(session.id);
              useActiveSession.getState().refresh();
            },
          }
        : null;

  if (!conflict) return true;

  // For a same-kind "session" request, reuse instead of conflict.
  if (wanted === 'session' && conflict.kind === 'session') return true;

  const nounMap = { session: '名錄', plot: '樣區' };
  const conflictNoun = nounMap[conflict.kind];
  const newNoun = nounMap[wanted];

  return await new Promise<boolean>((resolve) => {
    Alert.alert(
      `已有${conflictNoun}記錄中`,
      `「${conflict.label}」正在進行。要先結束它，再開始新的${newNoun}嗎？`,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        {
          text: `前往${conflictNoun}`,
          onPress: () => {
            router.push(conflict.href);
            resolve(false);
          },
        },
        {
          text: `結束並開始新${newNoun}`,
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
 * Start (or resume) the user's checklist session and navigate to it.
 * Reuses the active session if one exists; if a plot is active instead,
 * prompts to end / continue / cancel.
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
