/**
 * Unified "records" list combining `sessions` (checklist), `plot_surveys` (樣區)
 * and `collection_trips` (採集).
 *
 * The Records tab displays every kind of field-data entity in one list.
 * Keeping a dedicated helper avoids spreading kind-switching across the UI.
 */
import { getUserDb } from './init';
import i18n from '~/i18n';
import { listPlotSurveys, plotCanAcceptSpecies, type PlotSurvey } from './plots';
import { listProjects } from './projects';
import { listSessions, type SessionWithStats } from './sessions';
import { listCollectionTrips, type CollectionTripWithStats } from './collections';

export type RecordKind = 'session' | 'plot' | 'collection';

/** Records-tab filter: a single kind, or every kind. */
export type RecordFilter = 'all' | RecordKind;

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
  /** Collection-only: backing CollectionTripWithStats. */
  trip?: CollectionTripWithStats;
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
    subtitle: i18n.t('recordsList.sessionSubtitle', { count: s.record_count, project: s.project_name }),
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
  const protocol = p.sampling_protocol || i18n.t('plots.noProtocol');
  const projectName = projectNameById.get(p.project_id) ?? i18n.t('plot.uncategorized');
  return {
    kind: 'plot',
    id: p.id,
    title: p.plotid,
    subtitle: i18n.t('recordsList.plotSubtitle', { count: n, protocol, size: sizeStr }),
    active: p.status === 'active',
    startedAt: p.start_ts ?? p.created_at,
    recordCount: n,
    projectId: p.project_id,
    projectName,
    notReady: !plotCanAcceptSpecies(p),
    plot: p,
  };
}

function tripToItem(c: CollectionTripWithStats): RecordItem {
  return {
    kind: 'collection',
    id: c.id,
    title: c.name,
    subtitle: i18n.t('recordsList.collectionSubtitle', {
      count: c.specimen_count,
      project: c.project_name,
    }),
    active: c.status === 'active',
    startedAt: c.started_at,
    recordCount: c.specimen_count,
    projectId: c.project_id,
    projectName: c.project_name,
    trip: c,
  };
}

export function listRecords(filter: RecordFilter = 'all'): RecordItem[] {
  const projects = listProjects();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const items: RecordItem[] = [];
  if (filter === 'all' || filter === 'session') {
    items.push(...listSessions().map(sessionToItem));
  }
  if (filter === 'all' || filter === 'plot') {
    items.push(...listPlotSurveys().map((p) => plotToItem(p, projectNameById)));
  }
  if (filter === 'all' || filter === 'collection') {
    items.push(...listCollectionTrips().map(tripToItem));
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
export function listRecordsByProject(filter: RecordFilter = 'all'): ProjectGroup[] {
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

/** Column holding the parent id, per record kind. */
/**
 * Every existing name of one record kind, for the duplicate dialog's
 * collision check.
 *
 * Queried straight from the tables rather than through `listRecords`:
 * `listSessions` INNER JOINs projects, so a session whose project was deleted
 * is missing from it — and a name missing from this set is a collision the
 * dialog would fail to warn about.
 */
export function takenRecordNames(kind: RecordKind): Set<string> {
  const db = getUserDb();
  const sql =
    kind === 'plot'
      ? `SELECT plotid AS name FROM plot_surveys`
      : kind === 'session'
        ? `SELECT name FROM sessions`
        : `SELECT name FROM collection_trips`;
  const rows = (db.executeSync(sql).rows ?? []) as { name?: string }[];
  return new Set(rows.map((r) => (r.name ?? '').trim()).filter(Boolean));
}

const RECORD_SPECIES_SOURCE: Record<RecordKind, { table: string; fk: string }> = {
  session: { table: 'checklist_records', fk: 'session_id' },
  plot: { table: 'plot_species_records', fk: 'plot_survey_id' },
  collection: { table: 'collection_specimens', fk: 'trip_id' },
};

/**
 * Distinct taxon_ids recorded under one record, in insertion order.
 *
 * Deliberately does NOT go through listSessionRecords / listPlotSpecies /
 * listSpecimens — those resolve every row against twnamelist.db to build
 * display fields, which is wasted work when the caller only needs ids (the
 * favourites import re-resolves each id once via searchByTaxonId anyway).
 */
export function taxonIdsOfRecord(kind: RecordKind, id: number): string[] {
  const { table, fk } = RECORD_SPECIES_SOURCE[kind];
  const res = getUserDb().executeSync(
    // GROUP BY (not DISTINCT) so ORDER BY MIN(id) is a legal aggregate —
    // `SELECT DISTINCT … ORDER BY MIN(id)` throws "misuse of aggregate".
    `SELECT taxon_id FROM ${table}
       WHERE ${fk} = ? AND taxon_id IS NOT NULL AND taxon_id != ''
       GROUP BY taxon_id ORDER BY MIN(id);`,
    [id],
  );
  return ((res.rows ?? []) as { taxon_id?: string }[])
    .map((row) => String(row.taxon_id ?? ''))
    .filter(Boolean);
}
