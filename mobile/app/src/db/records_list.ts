/**
 * Unified "records" list combining `sessions` (checklist) + `plot_surveys` (樣區).
 *
 * The Records tab displays both kinds of field-data entities in one list.
 * Keeping a dedicated helper avoids spreading kind-switching across the UI.
 */
import { getUserDb } from './init';
import { listPlotSurveys, plotCanAcceptSpecies, type PlotSurvey } from './plots';
import { listProjects } from './projects';
import { listSessions, type SessionWithStats } from './sessions';

export type RecordKind = 'session' | 'plot';

export type RecordItem = {
  kind: RecordKind;
  id: number;
  title: string;
  subtitle: string;
  active: boolean;
  /** Sort key (ms). For sessions = started_at; for plots = start_ts ?? created_at. */
  startedAt: number;
  recordCount: number;
  projectId: number;
  projectName: string;
  /** Plot-only: hard-gate not yet satisfied (plotid + lat/lng + uncertainty). */
  notReady?: boolean;
  /** Plot-only: backing PlotSurvey (so row can read protocol / size). */
  plot?: PlotSurvey;
  /** Session-only: backing SessionWithStats. */
  session?: SessionWithStats;
};

function plotRecordCount(plotSurveyId: number): number {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT COUNT(*) AS n FROM plot_species_records WHERE plot_survey_id = ?`,
    [plotSurveyId],
  );
  const row = (res.rows?.[0] ?? {}) as { n?: number };
  return Number(row.n ?? 0);
}

function sessionToItem(s: SessionWithStats): RecordItem {
  return {
    kind: 'session',
    id: s.id,
    title: s.name,
    subtitle: `${s.record_count} 筆 · ${s.project_name}`,
    active: s.ended_at === null,
    startedAt: s.started_at,
    recordCount: s.record_count,
    projectId: s.project_id,
    projectName: s.project_name,
    session: s,
  };
}

function plotToItem(p: PlotSurvey, projectNameById: Map<number, string>): RecordItem {
  const n = plotRecordCount(p.id);
  const sizeStr = p.sample_size_value
    ? ` · ${p.sample_size_value}${p.sample_size_unit ?? ''}`
    : '';
  const protocol = p.sampling_protocol || '未設 protocol';
  const projectName = projectNameById.get(p.project_id) ?? '未分類';
  return {
    kind: 'plot',
    id: p.id,
    title: p.plotid,
    subtitle: `${n} 筆 · ${protocol}${sizeStr}`,
    active: p.status === 'active',
    startedAt: p.start_ts ?? p.created_at,
    recordCount: n,
    projectId: p.project_id,
    projectName,
    notReady: !plotCanAcceptSpecies(p),
    plot: p,
  };
}

export function listRecords(filter: 'all' | 'session' | 'plot' = 'all'): RecordItem[] {
  const projects = listProjects();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const items: RecordItem[] = [];
  if (filter === 'all' || filter === 'session') {
    items.push(...listSessions().map(sessionToItem));
  }
  if (filter === 'all' || filter === 'plot') {
    items.push(...listPlotSurveys().map((p) => plotToItem(p, projectNameById)));
  }
  // Active first, then newest by startedAt desc.
  items.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.startedAt - a.startedAt;
  });
  return items;
}

export type ProjectGroup = {
  projectId: number;
  projectName: string;
  items: RecordItem[];
};

/** Items grouped by project, preserving "active first → newest first" inside
 *  each group. Groups themselves are ordered by their newest item. */
export function listRecordsByProject(filter: 'all' | 'session' | 'plot' = 'all'): ProjectGroup[] {
  const flat = listRecords(filter);
  const groups = new Map<number, ProjectGroup>();
  for (const it of flat) {
    let g = groups.get(it.projectId);
    if (!g) {
      g = { projectId: it.projectId, projectName: it.projectName, items: [] };
      groups.set(it.projectId, g);
    }
    g.items.push(it);
  }
  const result = Array.from(groups.values());
  // Sort each group's items (already sorted by listRecords, but be defensive).
  for (const g of result) {
    g.items.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.startedAt - a.startedAt;
    });
  }
  // Sort groups by newest item's startedAt desc.
  result.sort((a, b) => (b.items[0]?.startedAt ?? 0) - (a.items[0]?.startedAt ?? 0));
  return result;
}
