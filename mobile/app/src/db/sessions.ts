import { getUserDb } from './init';

export type Session = {
  id: number;
  name: string;
  type: 'checklist' | 'abundance';
  project_id: number;
  /** Optional reference to a pre-defined site (plot/transect/point). NULL for ad-hoc sessions. */
  site_id: number | null;
  started_at: number;
  ended_at: number | null;
  gps_mode: 'off' | 'single_point' | 'full_track' | null;
  start_lat: number | null;
  start_lng: number | null;
  track_geojson: string | null;
  notes: string | null;
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
  // Belt + suspenders: enforce single active before we open another.
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`, [Date.now()]);
  const now = Date.now();
  const res = db.executeSync(
    `INSERT INTO sessions (name, type, project_id, started_at, gps_mode, start_lat, start_lng)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name ?? defaultSessionName(),
      input.type ?? 'checklist',
      input.project_id ?? 0,
      now,
      input.gps_mode ?? null,
      input.start_lat ?? null,
      input.start_lng ?? null,
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

/** Re-open an ended session. Force-ends any other active session first
 *  to keep the single-active invariant DB-side. */
export function reopenSession(id: number): void {
  const db = getUserDb();
  db.executeSync(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL AND id != ?`, [Date.now(), id]);
  db.executeSync(`UPDATE sessions SET ended_at = NULL WHERE id = ?`, [id]);
}
