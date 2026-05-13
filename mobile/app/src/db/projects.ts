import { getUserDb } from './init';

export type Project = {
  id: number;
  name: string;
  abstract: string | null;
  location_description: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export function listProjects(): Project[] {
  const db = getUserDb();
  const res = db.executeSync(`SELECT * FROM projects ORDER BY id ASC`);
  return ((res.rows ?? []) as unknown) as Project[];
}

export type ProjectWithCounts = Project & {
  session_count: number;
  plot_count: number;
};

export function listProjectsWithCounts(): ProjectWithCounts[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT p.*,
            (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) AS session_count,
            (SELECT COUNT(*) FROM plot_surveys ps WHERE ps.project_id = p.id) AS plot_count
       FROM projects p
   ORDER BY p.id ASC`,
  );
  return ((res.rows ?? []) as unknown) as ProjectWithCounts[];
}

export function getProject(id: number): Project | null {
  const db = getUserDb();
  const res = db.executeSync(`SELECT * FROM projects WHERE id = ?`, [id]);
  const rows = (res.rows ?? []) as unknown as Project[];
  return rows[0] ?? null;
}

export type ProjectInput = Omit<Project, 'id' | 'created_at' | 'updated_at'>;

export function createProject(input: ProjectInput): number {
  const db = getUserDb();
  const now = Date.now();
  const res = db.executeSync(
    `INSERT INTO projects (name, abstract, location_description, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.name, input.abstract, input.location_description, input.notes, now, now],
  );
  return res.insertId ?? 0;
}

export function updateProject(id: number, input: Partial<ProjectInput>): void {
  const db = getUserDb();
  const fields: string[] = [];
  const params: (string | null)[] = [];
  for (const [k, v] of Object.entries(input)) {
    fields.push(`${k} = ?`);
    params.push(v as string | null);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  const finalParams = [...params, Date.now(), id] as (string | number | null)[];
  db.executeSync(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, finalParams);
}

export function deleteProject(id: number): void {
  if (id === 0) throw new Error('Cannot delete the default 未分類 project');
  const db = getUserDb();
  db.executeSync(`UPDATE sessions SET project_id = 0 WHERE project_id = ?`, [id]);
  db.executeSync(`UPDATE plot_surveys SET project_id = 0 WHERE project_id = ?`, [id]);
  db.executeSync(`DELETE FROM projects WHERE id = ?`, [id]);
}
