import { getUserDb } from './init';

/** A common surveyor (DwC recordedBy). `is_default` ones auto-fill new records. */
export type Surveyor = {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
  created_at: number;
};

export function listSurveyors(): Surveyor[] {
  const res = getUserDb().executeSync(
    `SELECT id, name, is_default, sort_order, created_at
       FROM surveyors ORDER BY sort_order ASC, name ASC;`,
  );
  return ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as number,
    name: (row.name as string) ?? '',
    is_default: row.is_default === 1,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: (row.created_at as number) ?? 0,
  }));
}

/** Add a surveyor (no-op if the name already exists). Returns the row id. */
export function addSurveyor(name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return 0;
  const db = getUserDb();
  db.executeSync(`INSERT OR IGNORE INTO surveyors (name, created_at) VALUES (?, ?);`, [
    trimmed,
    Date.now(),
  ]);
  const res = db.executeSync(`SELECT id FROM surveyors WHERE name = ? LIMIT 1;`, [trimmed]);
  return ((res.rows?.[0]?.id as number) ?? 0) || 0;
}

export function renameSurveyor(id: number, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  getUserDb().executeSync(`UPDATE surveyors SET name = ? WHERE id = ?;`, [trimmed, id]);
}

export function removeSurveyor(id: number): void {
  getUserDb().executeSync(`DELETE FROM surveyors WHERE id = ?;`, [id]);
}

export function setSurveyorDefault(id: number, on: boolean): void {
  getUserDb().executeSync(`UPDATE surveyors SET is_default = ? WHERE id = ?;`, [on ? 1 : 0, id]);
}

/** Persist a new ordering: `sort_order` = position in `ids` (drag-to-reorder). */
export function reorderSurveyors(ids: number[]): void {
  const db = getUserDb();
  ids.forEach((id, i) => {
    db.executeSync(`UPDATE surveyors SET sort_order = ? WHERE id = ?;`, [i, id]);
  });
}

export function getDefaultSurveyorNames(): string[] {
  const res = getUserDb().executeSync(
    `SELECT name FROM surveyors WHERE is_default = 1 ORDER BY sort_order ASC, name ASC;`,
  );
  return ((res.rows ?? []) as Array<Record<string, unknown>>).map((r) => (r.name as string) ?? '');
}

/** Comma-joined default surveyor names for auto-filling recorded_by on create.
 *  Returns null when no default is set (so the column stays NULL). */
export function defaultSurveyorString(): string | null {
  const names = getDefaultSurveyorNames();
  return names.length ? names.join(', ') : null;
}
