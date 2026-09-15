/**
 * iNaturalist upload driver — module-level, like `gbifDownload.ts`'s pack
 * driver and `trackRecorder.ts`: the batch must survive the upload page being
 * left, and re-entering the page must show the SAME batch rather than start
 * a second one. The page only subscribes to `useInatUpload`.
 *
 * Per record (see migrations.ts v30 for the columns):
 *   A. taxon   gi… ids already carry the iNat id; everything else goes through
 *              one autocomplete lookup per distinct name (memoised per batch);
 *              no unambiguous match → `species_guess` only.
 *   B. create  POST observation with uuid = occurrence_id, then persist the
 *              server id BEFORE any media (a crash here re-posts the same uuid,
 *              which the server treats as an update, and we store its id).
 *   C. media   photos in photo_paths order, then audio; the `inat_media_done`
 *              cursor advances after each 2xx — that cursor is the only thing
 *              stopping a retry from re-sending sounds (v2 sounds have no uuid).
 *   D. done    inat_uploaded_at.
 * One request per second throughout (iNat asks for ≤60/min), doubling after a
 * 429. Never automatic: only the upload page's button calls `driveUpload`.
 */
import { cacheDirectory, copyAsync, deleteAsync } from 'expo-file-system/legacy';
import { create } from 'zustand';
import i18n from '~/i18n';
import { useToast } from '~/stores/toast';
import {
  flattenPoints,
  getCollectionTrip,
  getPlotSurvey,
  getSession,
  getSite,
  layerLabel,
  listPlotSpecies,
  listSessionRecords,
  listSpecimens,
  markInatMediaDone,
  markInatObservation,
  markInatUploaded,
  parseGeometry,
  type RecordKind,
} from '~/db';
import { ApiError, sleep } from './apiFetch';
import { apiErrorMessage } from './apiErrorMessage';
import { rebaseAppFileUri } from './appFiles';
import { parseAudioPaths } from './audioCapture';
import { ensurePhotosReadAccess, guessExt, parsePhotoUris, resolveAssetUri } from './bundleExport';
import { classifyFailure } from './connectivity';
import { formatQuantityBadge } from './dwcAbundance';
import {
  detectionLabel,
  leafPhenologyLabel,
  lifeStageLabel,
  parseMultiAttribute,
  reproductiveLabel,
  sexLabel,
} from './dwcAttributes';
import {
  createAnnotation,
  createObservation,
  deleteAnnotation,
  fetchObservationAnnotations,
  lookupTaxonId,
  updateObservation,
  uploadPhoto,
  uploadSound,
} from './inatApi';
import { InatAuthCancelled, InatLoginRequired, discardInatJwt, ensureInatJwt, getStoredJwt } from './inatAuth';
import { decodeJwtPayload } from './inatJwt';
import { useSettings } from '~/stores/settings';
import {
  AUDIO_MIME_TYPE,
  annotationsFor,
  buildObservationPayload,
  centreAndRadius,
  estimateRequests,
  inatIdFromLocalTaxonId,
  photoMimeType,
  photoUuidFor,
  syncFingerprint,
  type BatchOptions,
  type InatRecordInput,
  type InatAnnotation,
  type InatAttribute,
  type InatLocation,
} from './inatPayload';

const REQUEST_GAP_MS = 1000;
const RATE_LIMITED_GAP_MS = 2000;

export type UploadUnit = { kind: RecordKind; id: number };

export type EligibleRecord = {
  kind: RecordKind;
  id: number;
  occurrenceId: string;
  localTaxonId: string;
  name: string;
  cname: string;
  kingdom: string;
  observedAtMs: number;
  notes: string | null;
  placeGuess: string | null;
  photos: string[];
  audio: string[];
  location: InatLocation | null;
  attributes: InatAttribute[];
  /** Phenology → iNat controlled terms (plants only). */
  annotations: InatAnnotation[];
  /** new = never uploaded; partial = observation exists, media incomplete; done = all up. */
  status: 'new' | 'partial' | 'done';
  observationId: number | null;
  mediaDone: number;
  /** `inat_sync_hash` — what iNat last received; null before v31 / first sync. */
  syncHash: string | null;
};

export type EligibleList = {
  title: string;
  records: EligibleRecord[];
  /** Records left out because they carry neither a photo nor a clip. */
  skippedNoMedia: number;
};

// ── candidates ───────────────────────────────────────────────────────────────

function statusOf(observationId: number | null, uploadedAt: number | null): EligibleRecord['status'] {
  if (uploadedAt) return 'done';
  return observationId ? 'partial' : 'new';
}

function pair(label: string, value: string | null | undefined): InatAttribute | null {
  const v = (value ?? '').trim();
  return v && v !== '–' ? { label, value: v } : null;
}

function multi(label: string, raw: string | null, fmt: (v: string) => string): InatAttribute | null {
  const vals = parseMultiAttribute(raw).map(fmt).filter(Boolean);
  return vals.length ? { label, value: vals.join(', ') } : null;
}

function commonAttributes(r: {
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
}): InatAttribute[] {
  return [
    pair(i18n.t('attr.sexLabel'), r.sex ? sexLabel(r.sex) : null),
    pair(i18n.t('attr.lifeStageLabel'), r.life_stage ? lifeStageLabel(r.life_stage) : null),
    multi(i18n.t('attr.reproLabel'), r.reproductive_condition, reproductiveLabel),
    multi(i18n.t('attr.leafLabel'), r.leaf_phenology, leafPhenologyLabel),
  ].filter((a): a is InatAttribute => a !== null);
}

function recordAnnotations(r: {
  kingdom: string;
  class: string;
  order: string;
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
}): InatAnnotation[] {
  return annotationsFor({
    kingdom: r.kingdom,
    class: r.class,
    order: r.order,
    sex: r.sex,
    lifeStage: r.life_stage,
    reproductive: parseMultiAttribute(r.reproductive_condition),
    leaf: parseMultiAttribute(r.leaf_phenology),
  });
}

function quantityAttr(q: string | null, type: string | null): InatAttribute | null {
  return q ? pair(i18n.t('inat.attrQuantity'), formatQuantityBadge(q, type)) : null;
}

function siteLocation(siteId: number | null): InatLocation | null {
  if (!siteId) return null;
  const site = getSite(siteId);
  if (!site) return null;
  try {
    const c = centreAndRadius(flattenPoints(parseGeometry(site)));
    return c ? { lat: c.lat, lng: c.lng, accuracyM: c.accuracyM, source: 'site' } : null;
  } catch {
    return null;
  }
}

function recordLocation(lat: number | null, lng: number | null, accuracy: number | null): InatLocation | null {
  return lat != null && lng != null ? { lat, lng, accuracyM: accuracy, source: 'record' } : null;
}

/** Everything in the unit that can be uploaded, with the fallback location
 *  and the rendered description lines already attached. */
export function listEligible(unit: UploadUnit): EligibleList {
  const { title, all } = collectCandidates(unit);
  const records = all.filter((r) => r.photos.length + r.audio.length > 0);
  return { title, records, skippedNoMedia: all.length - records.length };
}

/** One record of the unit, media or not (null when it no longer exists). */
export function getCandidate(unit: UploadUnit, recordId: number): EligibleRecord | null {
  return collectCandidates(unit).all.find((r) => r.id === recordId) ?? null;
}

function collectCandidates(unit: UploadUnit): { title: string; all: EligibleRecord[] } {
  const all: EligibleRecord[] = [];
  let title = '';

  if (unit.kind === 'session') {
    const session = getSession(unit.id);
    if (!session) return { title, all };
    title = session.name;
    const fallback: InatLocation | null =
      siteLocation(session.site_id) ??
      (session.start_lat != null && session.start_lng != null
        ? { lat: session.start_lat, lng: session.start_lng, accuracyM: null, source: 'session' }
        : null);
    for (const r of listSessionRecords(unit.id)) {
      const rec: Omit<EligibleRecord, 'status'> = {
        kind: 'session',
        id: r.id,
        occurrenceId: r.occurrence_id,
        localTaxonId: r.taxon_id,
        name: r.simple_name,
        cname: r.common_name_c,
        kingdom: r.kingdom,
        observedAtMs: r.observed_at,
        notes: r.notes,
        placeGuess: null,
        photos: parsePhotoUris(r.photo_paths),
        audio: parseAudioPaths(r.audio_paths),
        location: recordLocation(r.lat, r.lng, r.accuracy) ?? fallback,
        attributes: [
          ...commonAttributes(r),
          quantityAttr(r.organism_quantity, r.organism_quantity_type),
        ].filter((a): a is InatAttribute => a !== null),
        annotations: recordAnnotations(r),
        observationId: r.inat_observation_id,
        mediaDone: r.inat_media_done,
        syncHash: r.inat_sync_hash,
      };
      all.push({ ...rec, status: statusOf(r.inat_observation_id, r.inat_uploaded_at) });
    }
  } else if (unit.kind === 'plot') {
    const plot = getPlotSurvey(unit.id);
    if (!plot) return { title, all };
    title = plot.plotid;
    const fallback: InatLocation | null =
      plot.decimal_latitude != null && plot.decimal_longitude != null
        ? {
            lat: plot.decimal_latitude,
            lng: plot.decimal_longitude,
            accuracyM: plot.coord_uncertainty_m ?? plot.point_radius_m ?? null,
            source: 'plot',
          }
        : null;
    for (const r of listPlotSpecies(unit.id)) {
      const rec: Omit<EligibleRecord, 'status'> = {
        kind: 'plot',
        id: r.id,
        occurrenceId: r.occurrence_id,
        localTaxonId: r.taxon_id,
        name: r.simple_name,
        cname: r.common_name_c,
        kingdom: r.kingdom,
        observedAtMs: r.observed_at,
        notes: r.notes,
        placeGuess: plot.locality,
        photos: parsePhotoUris(r.photo_paths),
        audio: parseAudioPaths(r.audio_paths),
        location: recordLocation(r.lat, r.lng, r.accuracy) ?? fallback,
        attributes: [
          ...commonAttributes(r),
          pair(i18n.t('plotValue.detectionLabel'), r.detection_type ? detectionLabel(r.detection_type) : null),
          quantityAttr(r.organism_quantity, r.organism_quantity_type),
          r.layer !== 'T' ? pair(i18n.t('inat.attrLayer'), layerLabel(r.layer)) : null,
        ].filter((a): a is InatAttribute => a !== null),
        annotations: recordAnnotations(r),
        observationId: r.inat_observation_id,
        mediaDone: r.inat_media_done,
        syncHash: r.inat_sync_hash,
      };
      all.push({ ...rec, status: statusOf(r.inat_observation_id, r.inat_uploaded_at) });
    }
  } else {
    const trip = getCollectionTrip(unit.id);
    if (!trip) return { title, all };
    title = trip.name;
    for (const r of listSpecimens(unit.id)) {
      const rec: Omit<EligibleRecord, 'status'> = {
        kind: 'collection',
        id: r.id,
        occurrenceId: r.occurrence_id,
        localTaxonId: r.taxon_id,
        name: r.simple_name,
        cname: r.common_name_c,
        kingdom: r.kingdom,
        observedAtMs: r.collected_at,
        notes: r.notes,
        placeGuess: r.locality ?? trip.locality,
        photos: parsePhotoUris(r.photo_paths),
        audio: parseAudioPaths(r.audio_paths),
        location: recordLocation(r.lat, r.lng, r.accuracy),
        attributes: [
          pair(i18n.t('collection.recordNumber'), r.record_number),
          ...commonAttributes(r),
        ].filter((a): a is InatAttribute => a !== null),
        annotations: recordAnnotations(r),
        observationId: r.inat_observation_id,
        mediaDone: r.inat_media_done,
        syncHash: r.inat_sync_hash,
      };
      all.push({ ...rec, status: statusOf(r.inat_observation_id, r.inat_uploaded_at) });
    }
  }
  return { title, all };
}

export function estimateBatch(records: EligibleRecord[]): { requests: number; photos: number; audio: number } {
  const requests = estimateRequests(
    records.map((r) => ({
      photos: r.photos.length,
      audio: r.audio.length,
      needsTaxon: r.observationId === null && inatIdFromLocalTaxonId(r.localTaxonId) === null,
      mediaDone: r.mediaDone,
      hasObservation: r.observationId !== null,
      annotations: r.annotations.length,
    })),
  );
  return {
    requests,
    photos: records.reduce((n, r) => n + Math.max(0, r.photos.length - Math.min(r.mediaDone, r.photos.length)), 0),
    audio: records.reduce((n, r) => n + r.audio.length, 0),
  };
}

// ── driver state ─────────────────────────────────────────────────────────────

export type UploadProgress = {
  phase: 'auth' | 'uploading';
  /** Records finished (ok or failed) / selected. */
  done: number;
  total: number;
  /** Name and id of the record being sent — the list highlights that row. */
  current: string;
  currentId: number | null;
  failed: number;
  /** Requests completed / expected — what the progress bar tracks, so a
   *  record with five photos moves the bar five times, not once. */
  requestsDone: number;
  requestsTotal: number;
};

export type UploadFailure = { id: number; name: string; message: string };

export type UploadResult = {
  unit: UploadUnit;
  ok: number;
  unresolvedTaxa: number;
  failures: UploadFailure[];
  stopped: 'completed' | 'cancelled' | 'offline' | 'auth';
};

type UploadState = {
  unit: UploadUnit | null;
  progress: UploadProgress | null;
  /** Last finished batch; cleared when a new one starts. */
  result: UploadResult | null;
};

export const useInatUpload = create<UploadState>(() => ({ unit: null, progress: null, result: null }));

let cancelled = false;

export function isUploadRunning(): boolean {
  return useInatUpload.getState().progress !== null;
}

export function cancelUpload(): void {
  cancelled = true;
}

function bumpRequests(): void {
  const p = useInatUpload.getState().progress;
  if (p) useInatUpload.setState({ progress: { ...p, requestsDone: Math.min(p.requestsTotal, p.requestsDone + 1) } });
}

/** Thrown inside the loop to end the whole batch, as opposed to one record. */
class StopBatch extends Error {
  constructor(public reason: UploadResult['stopped']) {
    super(reason);
  }
}

export function driveUpload(unit: UploadUnit, records: EligibleRecord[], batch: BatchOptions): void {
  if (isUploadRunning()) return;
  cancelled = false;
  useInatUpload.setState({
    unit,
    result: null,
    progress: {
      phase: 'auth',
      done: 0,
      total: records.length,
      current: '',
      currentId: null,
      failed: 0,
      requestsDone: 0,
      requestsTotal: estimateBatch(records).requests,
    },
  });
  void (async () => {
    const result = await runBatch(unit, records, batch);
    useInatUpload.setState({ progress: null, result });
    const toast = useToast.getState().show;
    const ok = result.ok;
    const failed = result.failures.length;
    // Literal keys and inline params so check-i18n verifies key and placeholders.
    if (result.stopped === 'completed') toast(i18n.t('inat.toastDone', { ok, failed }));
    else if (result.stopped === 'cancelled') toast(i18n.t('inat.toastCancelled', { ok, failed }));
    else if (result.stopped === 'offline') toast(i18n.t('inat.toastOffline', { ok, failed }));
    else toast(i18n.t('inat.toastAuth', { ok, failed }));
  })();
}

async function runBatch(unit: UploadUnit, records: EligibleRecord[], batch: BatchOptions): Promise<UploadResult> {
  const result: UploadResult = { unit, ok: 0, unresolvedTaxa: 0, failures: [], stopped: 'completed' };
  const setProgress = (patch: Partial<UploadProgress>) => {
    const p = useInatUpload.getState().progress;
    if (p) useInatUpload.setState({ progress: { ...p, ...patch } });
  };

  try {
    await ensureInatJwt({ interactive: true });
  } catch (e) {
    if (__DEV__ && !(e instanceof InatAuthCancelled)) console.warn('[inatUpload] auth failed', e);
    return { ...result, stopped: 'auth' };
  }
  await ensurePhotosReadAccess();

  const ctx = new BatchContext();
  for (const rec of records) {
    if (rec.status === 'done') continue;
    if (cancelled) {
      result.stopped = 'cancelled';
      break;
    }
    setProgress({ phase: 'uploading', current: rec.cname || rec.name, currentId: rec.id });
    try {
      const unresolved = await uploadOne(rec, batch, ctx);
      if (unresolved) result.unresolvedTaxa += 1;
      result.ok += 1;
    } catch (e) {
      if (e instanceof StopBatch) {
        result.stopped = e.reason;
        break;
      }
      result.failures.push({ id: rec.id, name: rec.cname || rec.name, message: await apiErrorMessage(e) });
      setProgress({ failed: result.failures.length });
    }
    setProgress({ done: result.ok + result.failures.length });
  }
  return result;
}

class BatchContext {
  gapMs = REQUEST_GAP_MS;
  taxonCache = new Map<string, number | null>();

  /**
   * One paced request. Handles the batch-level outcomes here so `uploadOne`
   * reads as the state machine: 401 → refresh the JWT once (showing the login
   * page if the session is gone); offline → stop everything; 5xx → one retry;
   * 429 → this record fails and the rest of the batch slows down.
   */
  async call<T>(fn: (jwt: string) => Promise<T>): Promise<T> {
    if (cancelled) throw new StopBatch('cancelled');
    let jwt = await this.jwt(false);
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await fn(jwt);
        bumpRequests();
        await sleep(this.gapMs);
        return out;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.kind === 'aborted') throw new StopBatch('cancelled');
        if (e.kind === 'network' || e.kind === 'timeout') {
          if ((await classifyFailure(e)) === 'offline') throw new StopBatch('offline');
          throw e;
        }
        if (e.status === 401) {
          if (attempt > 0) throw new StopBatch('auth');
          await discardInatJwt();
          jwt = await this.jwt(true);
          continue;
        }
        if (e.kind === 'rate_limit') {
          this.gapMs = RATE_LIMITED_GAP_MS;
          throw e;
        }
        if (e.status !== undefined && e.status >= 500 && attempt === 0) {
          await sleep(3000);
          continue;
        }
        throw e;
      }
    }
  }

  private async jwt(interactive: boolean): Promise<string> {
    try {
      return await ensureInatJwt({ interactive });
    } catch (e) {
      if (e instanceof InatAuthCancelled || e instanceof InatLoginRequired) throw new StopBatch('auth');
      throw e;
    }
  }
}

function recordInput(rec: EligibleRecord): InatRecordInput {
  return {
    occurrenceId: rec.occurrenceId,
    scientificName: rec.name,
    localTaxonId: rec.localTaxonId,
    kingdom: rec.kingdom,
    observedAtMs: rec.observedAtMs,
    tzOffsetMin: -new Date(rec.observedAtMs).getTimezoneOffset(),
    location: rec.location,
    placeGuess: rec.placeGuess,
    notes: rec.notes,
    attributes: rec.attributes,
  };
}

/** What iNat would receive for this record right now — compared with
 *  `inat_sync_hash` to say 「有變更」. Taxon id is left out on purpose: it is
 *  only known after a network lookup and the name is in the payload anyway. */
function fingerprintFor(rec: EligibleRecord): string {
  return syncFingerprint({
    payload: buildObservationPayload(recordInput(rec), null, { tags: [], geoprivacy: 'open' }),
    annotations: rec.annotations,
    mediaCount: rec.photos.length + rec.audio.length,
  });
}

/** True when the record differs from what iNat last received. False for
 *  never-uploaded records and for uploads made before the fingerprint
 *  existed (nothing to compare against). */
export function hasInatChanges(unit: UploadUnit, recordId: number): boolean {
  const rec = getCandidate(unit, recordId);
  if (!rec || rec.observationId === null || !rec.syncHash) return false;
  return fingerprintFor(rec) !== rec.syncHash;
}

async function resolveTaxon(rec: EligibleRecord, ctx: BatchContext): Promise<number | null> {
  const direct = inatIdFromLocalTaxonId(rec.localTaxonId);
  if (direct !== null) return direct;
  const key = `${rec.kingdom}|${rec.name}`;
  if (ctx.taxonCache.has(key)) return ctx.taxonCache.get(key) ?? null;
  const id = await ctx.call(() => lookupTaxonId(rec.name, rec.kingdom));
  ctx.taxonCache.set(key, id);
  return id;
}

/** C. media — photos first (photo_paths order), then audio; the cursor
 *  resumes and advances after every accepted item. Returns items sent. */
async function uploadMedia(rec: EligibleRecord, ctx: BatchContext, from: number): Promise<number> {
  const items: ({ type: 'photo'; uri: string; index: number } | { type: 'audio'; uri: string })[] = [
    ...rec.photos.map((uri, index) => ({ type: 'photo' as const, uri, index })),
    ...rec.audio.map((uri) => ({ type: 'audio' as const, uri })),
  ];
  let sent = 0;
  for (let k = from; k < items.length; k++) {
    const item = items[k];
    if (item.type === 'photo') {
      const local = await localPhotoFile(item.uri);
      try {
        await ctx.call((jwt) =>
          uploadPhoto(jwt, rec.occurrenceId, local.uri, photoUuidFor(rec.occurrenceId, item.index), local.mimeType),
        );
      } finally {
        if (local.temp) void deleteAsync(local.uri, { idempotent: true });
      }
    } else {
      await ctx.call((jwt) => uploadSound(jwt, rec.occurrenceId, rebaseAppFileUri(item.uri), AUDIO_MIME_TYPE));
    }
    markInatMediaDone(rec.kind, rec.id, k + 1);
    sent += 1;
  }
  return sent;
}

/** One annotation POST; a 4xx (value outside the taxon's scope, or already
 *  there) is a skip, never a failure of the record. */
async function postAnnotationSafe(ctx: BatchContext, rec: EligibleRecord, a: InatAnnotation): Promise<boolean> {
  try {
    await ctx.call((jwt) => createAnnotation(jwt, rec.occurrenceId, a.attribute, a.value));
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'http' && e.status !== undefined && e.status >= 400 && e.status < 500) {
      if (__DEV__) console.warn('[inatUpload] annotation skipped', a, e.status, e.detail);
      return false;
    }
    throw e;
  }
}

/** Returns true when the taxon could not be matched (observation still created). */
async function uploadOne(rec: EligibleRecord, batch: BatchOptions, ctx: BatchContext): Promise<boolean> {
  let unresolved = false;
  let observationId = rec.observationId;
  let mediaDone = rec.mediaDone;

  if (observationId === null) {
    // A. taxon
    const taxonId = await resolveTaxon(rec, ctx);
    if (taxonId === null) unresolved = true;
    // B. create
    const created = await ctx.call((jwt) => createObservation(jwt, buildObservationPayload(recordInput(rec), taxonId, batch)));
    observationId = created.id;
    mediaDone = 0;
    markInatObservation(rec.kind, rec.id, observationId);
  }

  // C. media
  await uploadMedia(rec, ctx, mediaDone);

  // C2. annotations — sex, life stage, phenology as iNat controlled terms.
  for (const a of rec.annotations) await postAnnotationSafe(ctx, rec, a);

  // D. done — with the fingerprint of what was just sent.
  markInatUploaded(rec.kind, rec.id, fingerprintFor(rec));
  return unresolved;
}

// ── single-record sync ───────────────────────────────────────────────────────

export type SyncResult = {
  /** Nothing differed from the last sync — no request was made. */
  noop: boolean;
  annotationsAdded: number;
  annotationsRemoved: number;
  mediaSent: number;
};

type SyncState = { runningId: number | null };
export const useInatSync = create<SyncState>(() => ({ runningId: null }));

export function isSyncRunning(): boolean {
  return useInatSync.getState().runningId !== null;
}

/**
 * Push a record's current state to its existing observation: PUT the
 * observation fields, reconcile OUR annotations against the desired set,
 * upload any media added since, then store the new fingerprint. Photos removed
 * locally are not removed remotely (no destructive sync). Throws on failure —
 * the caller turns it into a toast.
 */
export async function syncRecord(unit: UploadUnit, recordId: number): Promise<SyncResult> {
  if (isUploadRunning() || isSyncRunning()) throw new Error(i18n.t('inat.busy'));
  useInatSync.setState({ runningId: recordId });
  try {
    const rec = getCandidate(unit, recordId);
    if (!rec || rec.observationId === null) throw new Error(i18n.t('inat.syncNotUploaded'));
    const fingerprint = fingerprintFor(rec);
    if (rec.syncHash === fingerprint) return { noop: true, annotationsAdded: 0, annotationsRemoved: 0, mediaSent: 0 };

    try {
      await ensureInatJwt({ interactive: true });
    } catch (e) {
      if (e instanceof InatAuthCancelled || e instanceof InatLoginRequired) throw new Error(i18n.t('inat.syncAuth'));
      throw e;
    }
    await ensurePhotosReadAccess();
    const ctx = new BatchContext();
    try {
      // 1. observation fields (never geoprivacy / tags — those belong to iNat's UI now)
      const taxonId = await resolveTaxon(rec, ctx);
      const payload = buildObservationPayload(recordInput(rec), taxonId, {
        tags: [],
        geoprivacy: useSettings.getState().inat_geoprivacy,
      });
      const { uuid: _uuid, geoprivacy: _g, tag_list: _t, ...fields } = payload;
      await ctx.call((jwt) => updateObservation(jwt, rec.occurrenceId, fields));

      // 2. annotations: ours that are no longer wanted → delete; wanted but absent → add
      const me = decodeJwtPayload((await getStoredJwt()) ?? '')?.user_id ?? null;
      const remote = await ctx.call((jwt) => fetchObservationAnnotations(jwt, rec.occurrenceId));
      const wanted = new Set(rec.annotations.map((a) => `${a.attribute}:${a.value}`));
      const present = new Set(remote.map((a) => `${a.controlled_attribute_id}:${a.controlled_value_id}`));
      let removed = 0;
      for (const a of remote) {
        const key = `${a.controlled_attribute_id}:${a.controlled_value_id}`;
        if (wanted.has(key) || (me !== null && a.user_id !== me)) continue;
        try {
          await ctx.call((jwt) => deleteAnnotation(jwt, a.uuid));
          removed += 1;
        } catch (e) {
          if (!(e instanceof ApiError && e.kind === 'http' && e.status !== undefined && e.status >= 400 && e.status < 500)) throw e;
        }
      }
      let added = 0;
      for (const a of rec.annotations) {
        if (present.has(`${a.attribute}:${a.value}`)) continue;
        if (await postAnnotationSafe(ctx, rec, a)) added += 1;
      }

      // 3. media added since the last upload
      const mediaSent = await uploadMedia(rec, ctx, rec.mediaDone);

      markInatUploaded(rec.kind, rec.id, fingerprint);
      return { noop: false, annotationsAdded: added, annotationsRemoved: removed, mediaSent };
    } catch (e) {
      if (e instanceof StopBatch) {
        throw new Error(i18n.t(e.reason === 'offline' ? 'inat.syncOffline' : 'inat.syncAuth'));
      }
      throw e;
    }
  } finally {
    useInatSync.setState({ runningId: null });
  }
}

/**
 * `photo_paths` mixes ph:// (iOS camera), content:// (Android camera) and
 * file:// (library picks). `uploadAsync` needs a real file, so anything that
 * does not resolve to file:// is copied into the cache for the duration of
 * the request. Unreadable (limited Photos access, deleted asset) fails the
 * record loudly rather than uploading a photo-less observation.
 */
async function localPhotoFile(uri: string): Promise<{ uri: string; mimeType: string; temp: boolean }> {
  const resolved = await resolveAssetUri(uri);
  if (!resolved) throw new Error(i18n.t('inat.photoUnreadable'));
  const ext = guessExt(resolved) || guessExt(uri);
  const mimeType = photoMimeType(ext);
  if (resolved.startsWith('file:')) return { uri: resolved, mimeType, temp: false };
  if (!cacheDirectory) throw new Error(i18n.t('inat.photoUnreadable'));
  const tmp = `${cacheDirectory}inat-upload-${Date.now()}.${ext}`;
  await copyAsync({ from: resolved, to: tmp });
  return { uri: tmp, mimeType, temp: true };
}
