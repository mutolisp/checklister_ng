import { getUserDb, withTransaction } from './init';
import { existingProjectId, resolveProjectIdByName } from './projects';
import { createSite, deleteSiteIfUnreferenced, getSite, type ImportedSite } from './sites';
import { defaultSurveyorString } from './surveyors';
import { generateUuid } from './uuid';
import type { DuplicateRecordOptions } from './duplicate';
import { latest, mergeOrder, unionSurveyors, unionTracks, type MergeRecordOptions } from './merge';
import type { ChecklistRecord } from './records';
import i18n from '~/i18n';

export type Session = {
  id: number;
  /** Stable identity across export/import (plots have had one since v5).
   *  Backfilled for pre-v27 rows by the migration. */
  uuid: string;
  name: string;
  type: 'checklist' | 'abundance';
  project_id: number;
  /** Optional reference to a pre-defined site (plot/transect/point). NULL for ad-hoc sessions. */
  site_id: number | null;
  started_at: number;
  ended_at: number | null;
  /** Most recent time the session was reopened (status: done → active). Used
   *  by `StaleSessionWatcher` so reopening an old session doesn't immediately
   *  re-fire the "已開了 N 小時" alert. */
  resumed_at: number | null;
  gps_mode: 'off' | 'single_point' | 'full_track' | null;
  start_lat: number | null;
  start_lng: number | null;
  track_geojson: string | null;
  notes: string | null;
  /** DwC recordedBy — comma-separated surveyor names. NULL = unset. */
  recorded_by: string | null;
  /** 加星號（v34）：0 / 1. Sorts the record above its peers in the list.
   *  Device-local organisation, deliberately not exported. */
  starred: number;
};

export type SessionWithStats = Session & {
  record_count: number;
  project_name: string;
};

function defaultSessionName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function getActiveSession(): Session | null {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  );
  const rows = (res.rows ?? []) as unknown as Session[];
  return rows[0] ?? null;
}

export function getSession(id: number): Session | null {
  const db = getUserDb();
  const res = db.executeSync(`SELECT * FROM sessions WHERE id = ?`, [id]);
  const rows = (res.rows ?? []) as unknown as Session[];
  return rows[0] ?? null;
}

export function listSessions(): SessionWithStats[] {
  const db = getUserDb();
  const res = db.executeSync(`
    SELECT s.*,
           p.name AS project_name,
           (SELECT COUNT(*) FROM checklist_records r WHERE r.session_id = s.id) AS record_count
    FROM sessions s
    JOIN projects p ON p.id = s.project_id
    ORDER BY s.started_at DESC
  `);
  return (res.rows ?? []) as unknown as SessionWithStats[];
}

export type CreateSessionInput = {
  name?: string;
  type?: 'checklist' | 'abundance';
  project_id?: number;
  gps_mode?: 'off' | 'single_point' | 'full_track';
  start_lat?: number;
  start_lng?: number;
  /** DwC recordedBy. Omit to auto-fill from default surveyors; pass null to
   *  force empty. */
  recorded_by?: string | null;
};

/**
 * Force-end every still-open session. Safety net to guarantee at most one
 * active session at any moment, even if some entry point bypassed the
 * upstream prompt in `recordCreate.ensureNoConflictingActive`.
 */
export function endAllActiveSessions(): void {
  const db = getUserDb();
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [Date.now()]);
}

export function createSession(input: CreateSessionInput = {}): number {
  const db = getUserDb();
  const now = Date.now();
  // Belt + suspenders: enforce single-active across BOTH kinds before we open
  // another. UI gate (recordCreate.ts) is the primary check, but reopen / fab
  // paths in session/[id] + plots tab bypass it, so the DB layer must close
  // any active session AND any active plot here.
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [now]);
  db.executeSync(
    `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active'`,
    [now, now],
  );
  const res = db.executeSync(
    `INSERT INTO sessions (uuid, name, type, project_id, started_at, gps_mode, start_lat, start_lng, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateUuid(),
      input.name ?? defaultSessionName(),
      input.type ?? 'checklist',
      input.project_id ?? 0,
      now,
      input.gps_mode ?? null,
      input.start_lat ?? null,
      input.start_lng ?? null,
      // Omitted → auto-fill from default surveyors; explicit null → stays empty.
      input.recorded_by !== undefined ? input.recorded_by : defaultSurveyorString(),
    ],
  );
  return res.insertId ?? 0;
}

export function endSession(
  id: number,
  updates: Partial<Pick<Session, 'name' | 'project_id' | 'notes'>> = {},
): void {
  const db = getUserDb();
  const fields: string[] = ['ended_at = ?'];
  const params: (string | number | null)[] = [Date.now()];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    params.push(v as string | number | null);
  }
  params.push(id);
  db.executeSync(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, params);
}

export function updateSession(id: number, updates: Partial<Session>): void {
  const db = getUserDb();
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'id') continue;
    fields.push(`${k} = ?`);
    params.push(v as string | number | null);
  }
  if (fields.length === 0) return;
  params.push(id);
  db.executeSync(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, params);
}

export function deleteSession(id: number): void {
  const db = getUserDb();
  // 子列在 schema 裡都宣告了 ON DELETE CASCADE，而 FK 強制已於 initDb() 末尾開啟
  // （src/db/init.ts，per-connection、整個 session 有效），所以那些 cascade 現在確實
  // 會觸發，以下手動刪除在正常路徑上是冗餘的。保留是刻意的 belt-and-braces：delete
  // helper 不該依賴呼叫當下的 PRAGMA 狀態，漏刪的下場是看不見卻仍佔用編號的孤兒列。
  db.executeSync(`DELETE FROM checklist_records WHERE session_id = ?`, [id]);
  db.executeSync(`DELETE FROM sessions WHERE id = ?`, [id]);
}

/** Re-open an ended session. Force-ends any other active session AND any
 *  active plot first to keep the single-active invariant DB-side (this is
 *  the safety net; UI's `recordCreate.ts` is the primary gate but the
 *  session/[id] "繼續編輯" button bypasses it). Stamps `resumed_at` so the
 *  stale-watcher uses NOW as its baseline rather than the original
 *  `started_at` (which could be days/weeks old). */
export function reopenSession(id: number): void {
  const db = getUserDb();
  const now = Date.now();
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL AND id != ?`, [now, id]);
  db.executeSync(
    `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active'`,
    [now, now],
  );
  db.executeSync(`UPDATE sessions SET ended_at = NULL, resumed_at = ? WHERE id = ?`, [now, id]);
}

// ── Session round-trip import (v27+) ───────────────────────────────────────
// Restore a checklist session from an exported yml. Mirrors `importPlotSurvey`
// (src/db/plots.ts): `uuid` is the stable key, and the imported record must
// never claim the single-active slot. reproductive_condition / leaf_phenology
// arrive pre-serialized to the DB JSON-array format (sessionImport.ts).

export type ImportedSessionRecord = {
  occurrence_id?: string | null;
  taxon_id: string;
  /** Scientific name / family as exported. Not stored — used only to
   *  re-resolve `taxon_id` when this device's checklist doesn't have it. */
  name?: string | null;
  family?: string | null;
  observed_at?: number | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  organism_quantity?: string | null;
  organism_quantity_type?: string | null;
  sex?: string | null;
  life_stage?: string | null;
  reproductive_condition?: string | null;
  leaf_phenology?: string | null;
  /** Photo filenames inside the zip's `photos/` belonging to this record. */
  photo_files?: string[];
  /** The name this record was filed under, when not the accepted one (v28). */
  used_name_id?: number | null;
  used_scientific_name?: string | null;
};

export type ImportedSession = {
  uuid: string;
  name: string;
  type: 'checklist' | 'abundance';
  project_name?: string | null;
  started_at: number;
  ended_at?: number | null;
  recorded_by?: string | null;
  notes?: string | null;
  start_lat?: number | null;
  start_lng?: number | null;
  gps_mode?: 'off' | 'single_point' | 'full_track' | null;
  track_geojson?: string | null;
  site?: ImportedSite | null;
  records: ImportedSessionRecord[];
};

export function getSessionByUuid(uuid: string): Session | null {
  const res = getUserDb().executeSync(`SELECT * FROM sessions WHERE uuid = ? LIMIT 1`, [uuid]);
  return ((res.rows ?? []) as unknown as Session[])[0] ?? null;
}

export function importSession(
  data: ImportedSession,
  opts: { newUuid: boolean; photoUriByName?: Map<string, string> },
): { sessionId: number; name: string } {
  // Same reasoning as importPlotSurvey: overwrite deletes the previous copy
  // first, so the whole thing has to be atomic.
  return withTransaction(() => importSessionTx(data, opts));
}

function importSessionTx(
  data: ImportedSession,
  opts: { newUuid: boolean; photoUriByName?: Map<string, string> },
): { sessionId: number; name: string } {
  const db = getUserDb();
  const now = Date.now();
  const uuid = opts.newUuid ? generateUuid() : data.uuid;
  const photoPaths = (files: string[] | undefined): string | null => {
    const uris = (files ?? [])
      .map((f) => opts.photoUriByName?.get(f) ?? null)
      .filter((u): u is string => u !== null);
    return uris.length > 0 ? JSON.stringify(uris) : null;
  };

  // Overwrite mode: drop the previous copy by hand (FK cascades are off).
  let prevSiteId: number | null = null;
  if (!opts.newUuid) {
    const prev = getSessionByUuid(uuid);
    if (prev) {
      // deleteSession drops checklist_records but not the bound site.
      if (prev.site_id !== null) prevSiteId = prev.site_id;
      const owned = getSite(prev.site_id ?? -1);
      if (owned && owned.session_id === prev.id) {
        // A site created FOR this session; nothing else can reference it once
        // the session is gone.
        db.executeSync(`UPDATE sites SET session_id = NULL WHERE id = ?`, [owned.id]);
      }
      deleteSession(prev.id);
    }
  }

  const projectId = resolveProjectIdByName(data.project_name, { create: true });

  // Sessions have no `status`: being active IS `ended_at IS NULL`. An imported
  // record must never take the single-active slot (and must not end the user's
  // in-progress one either, so this deliberately skips endAllActiveSessions).
  const lastObserved = data.records.reduce(
    (max, r) => (r.observed_at != null && r.observed_at > max ? r.observed_at : max),
    0,
  );
  const endedAt = data.ended_at ?? (Math.max(data.started_at, lastObserved) || now);

  const res = db.executeSync(
    `INSERT INTO sessions (
       uuid, name, type, project_id, started_at, ended_at, gps_mode,
       start_lat, start_lng, track_geojson, notes, recorded_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid,
      data.name,
      data.type,
      projectId,
      data.started_at,
      endedAt,
      data.gps_mode ?? null,
      data.start_lat ?? null,
      data.start_lng ?? null,
      data.track_geojson ?? null,
      data.notes ?? null,
      data.recorded_by ?? null,
    ],
  );
  const sessionId = res.insertId ?? 0;
  if (sessionId === 0) throw new Error('importSession: insert failed');

  for (const r of data.records) {
    db.executeSync(
      `INSERT INTO checklist_records (
         session_id, taxon_id, occurrence_id, observed_at, notes, photo_paths,
         lat, lng, accuracy, sex, life_stage, reproductive_condition, leaf_phenology,
         organism_quantity, organism_quantity_type, used_name_id, used_scientific_name,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        r.taxon_id,
        // 另存新檔＝新的 occurrence，比照 importPlotSurvey 重新配號。
        opts.newUuid ? generateUuid() : (r.occurrence_id ?? generateUuid()),
        r.observed_at ?? data.started_at,
        r.notes ?? null,
        photoPaths(r.photo_files),
        r.lat ?? null,
        r.lng ?? null,
        r.accuracy ?? null,
        r.sex ?? null,
        r.life_stage ?? null,
        r.reproductive_condition ?? null,
        r.leaf_phenology ?? null,
        r.organism_quantity ?? null,
        r.organism_quantity_type ?? null,
        r.used_name_id ?? null,
        r.used_scientific_name ?? null,
        Date.now(),
      ],
    );
  }

  if (data.site) {
    const siteId = createSite({
      project_id: projectId,
      session_id: sessionId,
      name: data.site.name,
      geometry: data.site.geometry,
      notes: data.site.notes,
    });
    db.executeSync(`UPDATE sessions SET site_id = ? WHERE id = ?`, [siteId, sessionId]);
  }
  if (prevSiteId !== null) deleteSiteIfUnreferenced(prevSiteId);

  return { sessionId, name: data.name };
}

// ── 複製名錄 ────────────────────────────────────────────────────────────────

/**
 * Copy a checklist session as the next visit.
 *
 * Same contract as `duplicatePlotSurvey`: setup travels, observations do not.
 * The start GPS fix, the recorded track and the bound site all describe one
 * outing and are always left out.
 */
export function duplicateSession(id: number, opts: DuplicateRecordOptions): number | null {
  return withTransaction(() => duplicateSessionTx(id, opts));
}

function duplicateSessionTx(id: number, opts: DuplicateRecordOptions): number | null {
  const source = getSession(id);
  if (!source) return null;
  const name = opts.name.trim();
  if (!name) return null;
  const db = getUserDb();
  const now = Date.now();

  if (opts.activate) {
    // Mirrors createSession: at most one open record across both kinds.
    db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [now]);
    db.executeSync(
      `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE status = 'active'`,
      [now, now],
    );
  }

  const res = db.executeSync(
    `INSERT INTO sessions (uuid, name, type, project_id, recorded_by, gps_mode, notes, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateUuid(),
      name,
      source.type,
      // FKs are enforced at runtime; a project deleted since the last cold
      // start would make this INSERT throw.
      existingProjectId(source.project_id),
      source.recorded_by,
      // 記錄方式（關閉／單點／軌跡）是設定而非觀測值，一律跟著走。
      source.gps_mode,
      opts.includeEnv ? source.notes : null,
      now,
      opts.activate ? null : now,
    ],
  );
  const newId = res.insertId ?? 0;
  if (newId === 0) return null;

  if (opts.includeSpecies) {
    // Straight from the table: the copy needs taxon ids only, not the taxon
    // join `listSessionRecords` does. DISTINCT because the list is the point.
    const rows = db.executeSync(
      `SELECT taxon_id, used_name_id, used_scientific_name FROM checklist_records
        WHERE session_id = ? AND taxon_id IS NOT NULL AND taxon_id != ''
        GROUP BY taxon_id, used_scientific_name ORDER BY MIN(id)`,
      [id],
    );
    for (const r of (rows.rows ?? []) as Array<{
      taxon_id?: string;
      used_name_id?: number | null;
      used_scientific_name?: string | null;
    }>) {
      if (!r.taxon_id) continue;
      db.executeSync(
        `INSERT INTO checklist_records
           (session_id, taxon_id, occurrence_id, observed_at, used_name_id, used_scientific_name,
            updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          r.taxon_id,
          generateUuid(),
          now,
          r.used_name_id ?? null,
          r.used_scientific_name ?? null,
          now,
        ],
      );
    }
  }

  return newId;
}

// ── 合併名錄 (merge) ────────────────────────────────────────────────────────
// See src/db/merge.ts for what the merged record inherits and why.

/**
 * Fold two or more sessions into a new one. Returns the new id, or null when
 * fewer than two of the ids still exist (the whole thing rolls back).
 */
export function mergeSessions(ids: number[], opts: MergeRecordOptions): number | null {
  return withTransaction(() => mergeSessionsTx(ids, opts));
}

function mergeSessionsTx(ids: number[], opts: MergeRecordOptions): number | null {
  const name = opts.name.trim();
  if (!name) return null;
  const order = mergeOrder(ids, opts.primaryId);
  const sources = order.map((id) => getSession(id)).filter((s): s is Session => s !== null);
  if (sources.length < 2) return null;

  const primary = sources[0];
  const db = getUserDb();
  const now = Date.now();

  const startedAt = Math.min(...sources.map((s) => s.started_at));
  // A still-open source ends here: the merged record is always finished.
  const endedAt = latest(
    ...sources.map((s) => s.ended_at ?? now),
    ...sources.map((s) => s.started_at),
    startedAt,
  );

  const provenance = i18n.t('records.mergeProvenance', {
    sources: sources.map((s) => s.name).join('、'),
  });
  const notes = primary.notes ? `${primary.notes}\n${provenance}` : provenance;

  const res = db.executeSync(
    `INSERT INTO sessions
       (uuid, name, type, project_id, site_id, recorded_by, gps_mode,
        start_lat, start_lng, track_geojson, notes, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateUuid(),
      name,
      primary.type,
      existingProjectId(primary.project_id),
      // The site is one physical place; it belongs to the primary or to
      // nothing, never to an average of the sources.
      primary.site_id,
      unionSurveyors(sources.map((s) => s.recorded_by)),
      primary.gps_mode,
      primary.start_lat,
      primary.start_lng,
      unionTracks(sources.map((s) => s.track_geojson)),
      notes,
      startedAt,
      endedAt,
    ],
  );
  const newId = res.insertId ?? 0;
  if (newId === 0) return null;

  const seen = new Set<string>();
  let maxObserved = 0;
  for (const src of sources) {
    const rows = (db.executeSync(
      `SELECT * FROM checklist_records WHERE session_id = ? ORDER BY id`,
      [src.id],
    ).rows ?? []) as unknown as ChecklistRecord[];
    for (const r of rows) {
      if (!r.taxon_id) continue;
      // The adopted name is part of the identity: one taxon filed under two
      // names is two records, not a duplicate (same rule as duplicateSession).
      const key = `${r.taxon_id}|${r.used_scientific_name ?? ''}`;
      if (opts.dedupe) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      if (r.observed_at > maxObserved) maxObserved = r.observed_at;
      db.executeSync(
        `INSERT INTO checklist_records
           (session_id, taxon_id, occurrence_id, observed_at, updated_at, notes, photo_paths,
            lat, lng, accuracy, degree_of_establishment, sex, life_stage,
            reproductive_condition, leaf_phenology, organism_quantity,
            organism_quantity_type, used_name_id, used_scientific_name, audio_paths)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          r.taxon_id,
          // A new occurrence: occurrenceID is globally unique, and keeping the
          // old one would collide with the source row whenever it is kept.
          generateUuid(),
          r.observed_at,
          now,
          r.notes,
          // The same file URIs — nothing deletes photos when a record goes, so
          // the merged rows keep working even if the sources are removed.
          r.photo_paths,
          r.lat,
          r.lng,
          r.accuracy,
          r.degree_of_establishment,
          r.sex,
          r.life_stage,
          r.reproductive_condition,
          r.leaf_phenology,
          r.organism_quantity,
          r.organism_quantity_type,
          r.used_name_id,
          r.used_scientific_name,
          r.audio_paths,
        ],
      );
      // iNaturalist columns are deliberately NOT carried over: two rows
      // claiming the same observation id would make the next sync overwrite
      // one with the other.
    }
  }

  if (maxObserved > endedAt) {
    db.executeSync(`UPDATE sessions SET ended_at = ? WHERE id = ?`, [maxObserved, newId]);
  }

  if (!opts.keepSources) {
    for (const s of sources) deleteSession(s.id);
  }
  return newId;
}
