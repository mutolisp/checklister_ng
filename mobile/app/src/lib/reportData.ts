/**
 * DB → report-model assembly. The impure half of the report pipeline: it does
 * the querying and hands plain data to the pure builders in `reportModel.ts`,
 * which is what lets those be unit-checked under Node.
 */
import {
  getPlotLayers,
  getPlotSurvey,
  getProject,
  getSession,
  getSubplotLayers,
  listPlotSpecies,
  listPlotSurveys,
  listRecordsSummary,
  listSessionRecords,
  listSitesByProject,
  listSubplots,
  parseTrackSegments,
} from '~/db';
import type {
  PlotReportInput,
  ProjectReportInput,
  SessionReportInput,
} from './reportModel';

/**
 * Everything a plot report needs, in one pass. Mirrors the assembly
 * `projectExport.ts` already does for relevés, so a report and the exported
 * matrices are built from the same reads.
 */
export function collectPlotReportInput(plotId: number): PlotReportInput | null {
  const plot = getPlotSurvey(plotId);
  if (!plot) return null;
  const project = getProject(plot.project_id);
  const subplots = listSubplots(plot.id);
  return {
    plot,
    projectName: project?.name ?? '',
    layers: getPlotLayers(plot.id).map((l) => ({
      layer_index: l.layer_index,
      cover_pct: l.cover_pct,
      height_cm: l.height_cm,
      height_unit: l.height_unit,
      method: l.method,
    })),
    subplots: subplots.map((s) => ({
      id: s.id,
      label: s.label,
      width_m: s.width_m,
      length_m: s.length_m,
    })),
    species: listPlotSpecies(plot.id),
    trackSegments: parseTrackSegments(plot.track_geojson),
  };
}

/** Subplot-layer detail, kept separate because only some reports need it. */
export function collectSubplotLayers(subplotId: number) {
  return getSubplotLayers(subplotId);
}

/**
 * Project report input. Analysis is plots-only — the same scope rule
 * `projectExport.ts` states — so sessions and collections contribute counts
 * but no statistics.
 */
export function collectProjectReportInput(projectId: number): ProjectReportInput | null {
  const project = getProject(projectId);
  if (!project) return null;
  const plots = listPlotSurveys().filter((p) => p.project_id === projectId);
  const summary = listRecordsSummary('all');
  const mine = summary.items.filter((it) => it.projectId === projectId);
  return {
    project: {
      id: project.id,
      name: project.name,
      abstract: project.abstract,
      location_description: project.location_description,
      notes: project.notes,
    },
    plots: plots.map((plot) => ({
      plot,
      species: listPlotSpecies(plot.id),
      subplotIds: listSubplots(plot.id).map((s) => s.id),
    })),
    counts: {
      session: mine.filter((it) => it.kind === 'session').length,
      plot: mine.filter((it) => it.kind === 'plot').length,
      collection: mine.filter((it) => it.kind === 'collection').length,
    },
    siteCount: listSitesByProject(projectId).length,
  };
}

export function collectSessionReportInput(sessionId: number): SessionReportInput | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const project = getProject(session.project_id);
  return {
    session: {
      id: session.id,
      name: session.name,
      started_at: session.started_at,
      ended_at: session.ended_at,
      recorded_by: session.recorded_by,
      gps_mode: session.gps_mode,
      notes: session.notes,
    },
    projectName: project?.name ?? '',
    species: listSessionRecords(session.id),
  };
}
