/**
 * Helpers shared by the central FAB and any contextual entry that needs to
 * create a new "record" (session or plot) and navigate to its detail screen.
 *
 * Enforces single-active-record semantics: at any time at most one session
 * OR one plot may be active. Attempting to start another while a different
 * kind is active prompts the user to finish / resume the active one first.
 */
import { router, type Href } from 'expo-router';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  createCollectionTrip,
  createPlotSurvey,
  endPlotSurvey,
  endSession,
  getActiveCollectionTrip,
  getPlotSurveyByUuid,
  importPlotSurvey,
  type PlotType,
} from '~/db';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { isRecordingTarget, pauseRecording as pauseTrackRecording } from '~/lib/trackRecorder';
import { promptText } from '~/components/TextPromptModal';
import { showActionSheet } from '~/components/ActionSheet';
import { readPlotImport } from '~/lib/plotImport';
import i18n from '~/i18n';

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
      label: plot.plotid || i18n.t('nav.plot'),
      href: `/plot/${plot.id}` as Href,
      end: () => {
        if (isRecordingTarget({ kind: 'plot', id: plot.id })) pauseTrackRecording();
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
        if (isRecordingTarget({ kind: 'session', id: session.id })) pauseTrackRecording();
        endSession(session.id);
        useActiveSession.getState().refresh();
      },
    };
  }
  return null;
}

function nounOf(k: NewRecordKind): string {
  return i18n.t(k === 'session' ? 'nav.session' : 'nav.plot');
}

/**
 * Cross-platform action sheet offering: open existing / end + start new
 * (+ cancel). Resolves true only when the user picks "end + start new" (the
 * only branch that frees up the active slot).
 */
async function showConflictAlert(conflict: ActiveConflict, wanted: NewRecordKind): Promise<boolean> {
  const idx = await showActionSheet({
    title: i18n.t('recordCreate.conflictTitle', { noun: nounOf(conflict.kind) }),
    message: i18n.t('recordCreate.conflictMsg', { label: conflict.label, noun: nounOf(wanted) }),
    cancelLabel: i18n.t('common.cancel'),
    options: [
      { label: i18n.t('recordCreate.goTo', { noun: nounOf(conflict.kind) }) },
      { label: i18n.t('recordCreate.endAndStart', { noun: nounOf(wanted) }), destructive: true },
    ],
  });
  if (idx === 0) {
    router.push(conflict.href);
    return false;
  }
  if (idx === 1) {
    conflict.end();
    return true;
  }
  return false; // cancel
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

const PLOT_TYPE_META: Record<
  PlotType,
  { titleKey: string; example: string; protocol: string | null }
> = {
  // `protocol` is stored on the record + exported, so it stays a fixed literal
  // (not localized) to keep data consistent across UI languages.
  fixed: { titleKey: 'recordCreate.newFixed', example: 'PLOT_2026_001', protocol: null },
  transect: { titleKey: 'recordCreate.newTransect', example: 'TRANSECT_2026_001', protocol: '穿越線調查法' },
  point_count: { titleKey: 'recordCreate.newPointCount', example: 'POINT_2026_001', protocol: '定點計數法' },
};

async function promptPlotid(plotType: PlotType): Promise<void> {
  const meta = PLOT_TYPE_META[plotType];
  const raw = await promptText({
    title: i18n.t(meta.titleKey),
    message: i18n.t('recordCreate.enterPlotid', { example: meta.example }),
    placeholder: meta.example,
    autoCapitalize: 'none',
  });
  const plotid = raw?.trim();
  if (!plotid) return;
  const id = createPlotSurvey({
    plotid,
    plot_type: plotType,
    sampling_protocol: meta.protocol,
  });
  useActivePlot.getState().refresh();
  router.push(`/plot/${id}` as Href);
}

/**
 * Open the current collection trip, or start one, and navigate to it.
 *
 * Deliberately skips `ensureNoConflictingActive`: a collection trip is not part
 * of the app-wide single-active invariant, so starting one must never end an
 * in-progress checklist or plot survey (and is never blocked by one).
 */
export async function startCollectionAndOpen(): Promise<void> {
  const existing = getActiveCollectionTrip();
  const id = existing?.id ?? createCollectionTrip();
  router.push(`/collection/${id}` as Href);
}

/**
 * Show a type chooser (固定樣區 / 穿越線 / 定點計數法 / 匯入), then prompt for
 * plotid and create. Guards against a conflicting active record before creating
 * a NEW plot; import skips the guard (imported plots land as status='done' and
 * never become the active record).
 */
export async function createPlotPromptAndOpen(): Promise<void> {
  const idx = await showActionSheet({
    title: i18n.t('recordCreate.plotMenuTitle'),
    options: [
      { label: i18n.t('recordCreate.optFixed') },
      { label: i18n.t('recordCreate.optTransect') },
      { label: i18n.t('recordCreate.optPointCount') },
      { label: i18n.t('recordCreate.optImport') },
    ],
  });
  if (idx === 3) {
    await importPlotPromptAndOpen();
    return;
  }
  if (idx < 0 || idx > 2) return;
  const ok = await ensureNoConflictingActive('plot');
  if (!ok) return;
  const type: PlotType = idx === 0 ? 'fixed' : idx === 1 ? 'transect' : 'point_count';
  await promptPlotid(type);
}

/**
 * Pick an exported `.yml`/`.zip` and re-import it as a plot survey. On a uuid
 * clash, ask the user to overwrite or save as a new copy. The imported plot
 * lands as status='done' so it doesn't disturb the single-active record.
 */
export async function importPlotPromptAndOpen(): Promise<void> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (picked.canceled || !picked.assets?.[0]) return;

  let data;
  try {
    data = await readPlotImport(picked.assets[0].uri);
  } catch (e) {
    Alert.alert(i18n.t('recordCreate.importFailTitle'), e instanceof Error ? e.message : String(e));
    return;
  }

  let newUuid = false;
  if (getPlotSurveyByUuid(data.uuid)) {
    const choice = await showActionSheet({
      title: i18n.t('recordCreate.plotExistsTitle'),
      message: i18n.t('recordCreate.plotExistsMsg', { plotid: data.plotid }),
      cancelLabel: i18n.t('common.cancel'),
      options: [{ label: i18n.t('recordCreate.overwrite'), destructive: true }, { label: i18n.t('recordCreate.saveAsNew') }],
    });
    if (choice === 0) newUuid = false;
    else if (choice === 1) newUuid = true;
    else return; // cancel
  }

  try {
    const { plotId } = importPlotSurvey(data, { newUuid });
    // Imported plot is status='done'; refresh stores so lists pick it up.
    useActivePlot.getState().refresh();
    router.push(`/plot/${plotId}` as Href);
  } catch (e) {
    Alert.alert(i18n.t('recordCreate.importFailTitle'), e instanceof Error ? e.message : String(e));
  }
}
