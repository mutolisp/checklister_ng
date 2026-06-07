import { getUserDb } from './init';
import { defaultSurveyorString } from './surveyors';

export type Session = {
  id: number;
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
    `INSERT INTO sessions (name, type, project_id, started_at, gps_mode, start_lat, start_lng, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
