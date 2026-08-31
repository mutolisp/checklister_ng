import { getUserDb, withTransaction } from './init';
import { resolveProjectIdByName } from './projects';
import { createSite, deleteSiteIfUnreferenced, getSite, type ImportedSite } from './sites';
import { defaultSurveyorString } from './surveyors';
import { generateUuid } from './uuid';

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
  const res = db.executeSync(`SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`);
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
  return ((res.rows ?? []) as unknown) as SessionWithStats[];
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

export function endSession(id: number, updates: Partial<Pick<Session, 'name' | 'project_id' | 'notes'>> = {}): void {
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
  // ON DELETE CASCADE 在這個 app 是失效的：PRAGMA foreign_keys 從未在連線開啟時
  // 設定，而 op-sqlite 沒有定義 SQLITE_DEFAULT_FOREIGN_KEYS，所以 SQLite 走預設的
  // OFF。子列必須自己刪，否則會變成看不見卻仍佔用編號的孤兒列。
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
         organism_quantity, organism_quantity_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
