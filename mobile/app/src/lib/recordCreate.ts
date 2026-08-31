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
  getSessionByUuid,
  importPlotSurvey,
  importSession,
  listPlotSpecies,
  listSessionRecords,
  parseEnvPhotos,
  searchByTaxonId,
  type PlotType,
} from '~/db';
import { parsePhotoUris } from '~/lib/bundleExport';
import { matchScientificName } from '~/lib/sciMatch';
import { importPhotosToLibrary } from '~/lib/photoCapture';
import { ImportError, type ImportErrorCode } from '~/lib/importError';
import { readRecordImport, type ReadRecordImport } from '~/lib/recordImport';
import { useToast } from '~/stores/toast';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { isRecordingTarget, pauseRecording as pauseTrackRecording } from '~/lib/trackRecorder';
import { promptText } from '~/components/TextPromptModal';
import { showActionSheet } from '~/components/ActionSheet';
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
 * Pick an exported `.yml` / `.zip` and restore it as a real record.
 *
 * The KIND comes from the file, never from the menu the user came through: a
 * 名錄 export lands as a session, a 樣區 export as a plot survey. Neither ever
 * becomes the active record (plots land status='done', sessions with a
 * non-NULL ended_at), so importing never disturbs work in progress.
 */
export async function importRecordPromptAndOpen(): Promise<void> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (picked.canceled || !picked.assets?.[0]) return;

  let payload: ReadRecordImport;
  try {
    payload = await readRecordImport(picked.assets[0].uri);
  } catch (e) {
    Alert.alert(i18n.t('recordCreate.importFailTitle'), importErrorMessage(e));
    return;
  }

  try {
    if (payload.kind === 'plot') await finishPlotImport(payload);
    else await finishSessionImport(payload);
  } catch (e) {
    Alert.alert(i18n.t('recordCreate.importFailTitle'), importErrorMessage(e));
  }
}

/** Kept for the 樣區 menu entry; it now accepts either kind of export file. */
export const importPlotPromptAndOpen = importRecordPromptAndOpen;

/** ImportError code → localized message. Exported so every import entry
 *  (including the batch species importer) reports the same way. */
export function importErrorMessage(e: unknown): string {
  if (e instanceof ImportError) {
    const key: Record<ImportErrorCode, string> = {
      noYmlInZip: 'plotImport.noYmlInZip',
      invalidYml: 'plotImport.invalidYml',
      missingFields: 'plotImport.missingFields',
      unsupportedCollection: 'recordImport.unsupportedCollection',
      unsupportedBundle: 'recordImport.unsupportedBundle',
      unknownKind: 'recordImport.unknownKind',
    };
    return i18n.t(key[e.code]);
  }
  return e instanceof Error ? e.message : String(e);
}

type ImportableRecord = { taxon_id: string; name?: string | null; family?: string | null };

/**
 * Re-point records whose `taxon_id` this device's checklist doesn't know.
 *
 * A record exported from a device on a newer TaiCOL (or a different bundle)
 * can carry an id that resolves to nothing here — the row would import but
 * render blank. The yml also carries the scientific name, so try that before
 * giving up; anything still unresolved is imported as-is and reported.
 */
function remapUnknownTaxa(records: ImportableRecord[]): { remapped: number; unresolved: number } {
  let remapped = 0;
  let unresolved = 0;
  for (const r of records) {
    if (!r.taxon_id || searchByTaxonId(r.taxon_id)) continue;
    const name = r.name?.trim();
    const hit = name ? matchScientificName({ name, family: r.family ?? undefined }) : null;
    if (hit?.kind === 'matched') {
      r.taxon_id = hit.taxon_id;
      remapped += 1;
    } else {
      unresolved += 1;
    }
  }
  return { remapped, unresolved };
}

/** uuid clash → overwrite / save-as-new / cancel. null = cancelled. */
async function askOverwrite(titleKey: string, msgKey: string, label: string): Promise<boolean | null> {
  const choice = await showActionSheet({
    title: i18n.t(titleKey),
    message: i18n.t(msgKey, { plotid: label, name: label }),
    cancelLabel: i18n.t('common.cancel'),
    options: [
      { label: i18n.t('recordCreate.overwrite'), destructive: true },
      { label: i18n.t('recordCreate.saveAsNew') },
    ],
  });
  if (choice === 0) return false; // overwrite → keep the uuid
  if (choice === 1) return true; // save as new → mint a uuid
  return null;
}

/**
 * Photos, when overwriting a record that already has some.
 *
 * Photos.app assets cannot be overwritten in place — importing again always
 * creates NEW assets. So the honest choice is: keep the ones already in the
 * library (and re-link them), or import the zip's copies and leave the old
 * ones in the album. Anything else would silently duplicate the user's photos.
 *
 * Returns a `zip filename → device URI` map, or null to import the zip's
 * bytes as fresh assets.
 */
async function askPhotoReuse(
  prevUrisByOccurrence: Map<string, string[]>,
  filesByOccurrence: Map<string, string[]>,
  photoCount: number,
): Promise<Map<string, string> | null> {
  const existing = [...prevUrisByOccurrence.values()].reduce((n, u) => n + u.length, 0);
  if (existing === 0 || photoCount === 0) return null;

  const choice = await showActionSheet({
    title: i18n.t('recordImport.photoConflictTitle'),
    message: i18n.t('recordImport.photoConflictMsg', { existing, incoming: photoCount }),
    cancelLabel: i18n.t('common.cancel'),
    options: [
      { label: i18n.t('recordImport.photoKeepExisting') },
      { label: i18n.t('recordImport.photoReimport') },
    ],
  });
  // Only an explicit "import again" creates new assets; cancelling falls back
  // to the non-destructive branch (relink what's already in the library).
  if (choice === 1) return null;

  // Positional: the export wrote one filename per existing asset, in order.
  const map = new Map<string, string>();
  for (const [occ, files] of filesByOccurrence) {
    const prev = prevUrisByOccurrence.get(occ) ?? [];
    files.forEach((f, i) => {
      if (prev[i]) map.set(f, prev[i]);
    });
  }
  return map;
}

/** Writing N assets into Photos.app takes a visible moment; say so, and keep
 *  the count moving so a 100-photo record doesn't look frozen. */
async function importPhotos(photos: { name: string; bytes: Uint8Array }[]) {
  const toast = useToast.getState();
  toast.show(i18n.t('recordImport.photoProgress', { done: 0, total: photos.length }), {
    durationMs: 60000,
  });
  const written = await importPhotosToLibrary(photos, (done, total) => {
    if (done === total || done % 5 === 0) {
      toast.show(i18n.t('recordImport.photoProgress', { done, total }), { durationMs: 60000 });
    }
  });
  toast.dismiss();
  return written;
}

function summarize(
  added: number,
  taxa: { remapped: number; unresolved: number },
  skippedPhotos: number,
): void {
  const parts = [i18n.t('recordImport.doneRecords', { count: added })];
  if (taxa.remapped > 0) parts.push(i18n.t('recordImport.doneRemapped', { count: taxa.remapped }));
  if (taxa.unresolved > 0) parts.push(i18n.t('recordImport.doneUnresolved', { count: taxa.unresolved }));
  if (skippedPhotos > 0) parts.push(i18n.t('recordImport.donePhotosSkipped', { count: skippedPhotos }));
  Alert.alert(i18n.t('recordImport.doneTitle'), parts.join('\n'));
}

async function finishPlotImport(payload: Extract<ReadRecordImport, { kind: 'plot' }>): Promise<void> {
  const data = payload.plot;
  let newUuid = false;
  let prevPhotos = new Map<string, string[]>();
  let prevEnvPhotos: string[] = [];

  const prev = getPlotSurveyByUuid(data.uuid);
  if (prev) {
    const answer = await askOverwrite(
      'recordCreate.plotExistsTitle',
      'recordCreate.plotExistsMsg',
      data.plotid,
    );
    if (answer === null) return;
    newUuid = answer;
    if (!newUuid) {
      prevPhotos = new Map(
        listPlotSpecies(prev.id).map((r) => [r.occurrence_id, parsePhotoUris(r.photo_paths)]),
      );
      prevEnvPhotos = parseEnvPhotos(prev.env_photos_json);
    }
  }

  const filesByOccurrence = new Map(
    data.species
      .filter((s) => s.occurrence_id && (s.photo_files?.length ?? 0) > 0)
      .map((s) => [s.occurrence_id as string, s.photo_files as string[]]),
  );
  let photoUriByName = await askPhotoReuse(prevPhotos, filesByOccurrence, payload.photos.length);
  let skippedPhotos = 0;
  if (photoUriByName) {
    // Keeping existing assets: env photos re-link positionally too.
    (data.env_photo_files ?? []).forEach((f, i) => {
      if (prevEnvPhotos[i]) photoUriByName!.set(f, prevEnvPhotos[i]);
    });
  } else if (payload.photos.length > 0) {
    const written = await importPhotos(payload.photos);
    photoUriByName = written.uriByName;
    skippedPhotos = written.skipped;
  }

  const taxa = remapUnknownTaxa(data.species);
  const { plotId } = importPlotSurvey(data, {
    newUuid,
    photoUriByName: photoUriByName ?? undefined,
  });
  // Imported plot is status='done'; refresh stores so lists pick it up.
  useActivePlot.getState().refresh();
  summarize(data.species.length, taxa, skippedPhotos);
  router.push(`/plot/${plotId}` as Href);
}

async function finishSessionImport(
  payload: Extract<ReadRecordImport, { kind: 'session' }>,
): Promise<void> {
  const data = payload.session;
  // Pre-v27 exports carry no uuid — nothing to match against, so they always
  // come in as a new record.
  let newUuid = !data.uuid;
  let prevPhotos = new Map<string, string[]>();

  const prev = data.uuid ? getSessionByUuid(data.uuid) : null;
  if (prev) {
    const answer = await askOverwrite(
      'recordImport.sessionExistsTitle',
      'recordImport.sessionExistsMsg',
      data.name,
    );
    if (answer === null) return;
    newUuid = answer;
    if (!newUuid) {
      prevPhotos = new Map(
        listSessionRecords(prev.id).map((r) => [r.occurrence_id, parsePhotoUris(r.photo_paths)]),
      );
    }
  }

  const filesByOccurrence = new Map(
    data.records
      .filter((r) => r.occurrence_id && (r.photo_files?.length ?? 0) > 0)
      .map((r) => [r.occurrence_id as string, r.photo_files as string[]]),
  );
  let photoUriByName = await askPhotoReuse(prevPhotos, filesByOccurrence, payload.photos.length);
  let skippedPhotos = 0;
  if (!photoUriByName && payload.photos.length > 0) {
    const written = await importPhotos(payload.photos);
    photoUriByName = written.uriByName;
    skippedPhotos = written.skipped;
  }

  const taxa = remapUnknownTaxa(data.records);
  const { sessionId } = importSession(data, {
    newUuid,
    photoUriByName: photoUriByName ?? undefined,
  });
  useActiveSession.getState().refresh();
  summarize(data.records.length, taxa, skippedPhotos);
  router.push(`/session/${sessionId}` as Href);
}
