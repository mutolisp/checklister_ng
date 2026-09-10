/**
 * Project-level export: one zip carrying every record of a project (reusing
 * the per-record entry builders unchanged, under records/), plus the
 * cross-plot analysis tables (vegan matrices + wide env), JUICE import files,
 * a Darwin Core Archive (Event core + Occurrence + Humboldt extension), the
 * project's sites and a README documenting all of it.
 *
 * Analysis scope is deliberately plots-only (user decision); sessions and
 * collection trips still ship in records/ and in the DwC-A.
 */
import yaml from 'js-yaml';
import { strToU8 } from 'fflate';
import {
  getProject,
  getPlotLayers,
  getSubplotLayers,
  listCollectionTrips,
  listPlotSpecies,
  listPlotSurveys,
  listSessionRecords,
  listSessions,
  listSitesByProject,
  listSpecimens,
  listSubplots,
  type CollectionTripWithStats,
  type PlotSurvey,
  type SessionWithStats,
} from '~/db';
import {
  buildCollectionEntries,
  buildPlotEntries,
  buildSessionEntries,
  countPhotosPlotWithEnv,
  countPhotosSession,
  finalizeZip,
  sanitizeFilename,
  type BuiltZipEntry,
  type BundleOptions,
  type ExportFile,
} from './bundleExport';
import { localIso, multiToPipe } from './bundleYaml';
import {
  buildCoverScaleCsv,
  buildEnvWide,
  buildMatrix,
  buildMatrixByLayer,
  buildReleveIndex,
  buildReleves,
  buildSpeciesCols,
  buildSpeciesIndex,
  buildSpeciesLong,
  coverScaleRows,
  tableToCsv,
  type MatrixValueMode,
  type Releve,
  type RelevePlotInput,
  type SpeciesCol,
} from './vegMatrix';
import { buildJuiceHeader, buildJuiceSpeciesList, buildJuiceTable } from './juiceExport';
import { buildDwcArchive, type DwcRow } from './dwcArchive';
import { collectProjectReportInput } from './reportData';
import { buildProjectReport, type Translate } from './reportModel';
import { buildReportHtml } from './reportHtml';
import { buildReportDocx } from './reportDocx';
import i18n from '~/i18n';
import { sitesToGeoJSON, sitesToGPX, sitesToKML } from './geoExporters';
import type { AnalysisFormat, ReportFormat } from '~/stores/settings';

export type ProjectExportOptions = BundleOptions & {
  matrixValue: MatrixValueMode;
  analysisFormats: AnalysisFormat[];
  /** Also emit the per-layer matrix (species_matrix_by_layer.csv). */
  matrixByLayer: boolean;
  /** Also emit the research report under report/. */
  includeReport: boolean;
  reportFormat: ReportFormat;
};

export async function bundleProject(
  projectId: number,
  opts: ProjectExportOptions,
): Promise<ExportFile> {
  const project = getProject(projectId);
  if (!project) throw new Error(`專案 ${projectId} 不存在`);

  const sessions = listSessions().filter((s) => s.project_id === projectId);
  const plots = listPlotSurveys().filter((p) => p.project_id === projectId);
  const trips = listCollectionTrips().filter((c) => c.project_id === projectId);
  const sites = listSitesByProject(projectId);
  if (sessions.length + plots.length + trips.length + sites.length === 0) {
    throw new Error(`「${project.name}」內沒有任何記錄，無法匯出`);
  }

  // Whole-bundle photo total so the progress bar covers the full batch.
  let totalPhotos = 0;
  if (opts.includePhotos) {
    for (const s of sessions) totalPhotos += countPhotosSession(listSessionRecords(s.id));
    for (const p of plots) totalPhotos += countPhotosPlotWithEnv(p.id);
    for (const c of trips) totalPhotos += countPhotosSession(listSpecimens(c.id));
  }
  const ctx = { done: 0, total: totalPhotos, onProgress: opts.onProgress };
  opts.onProgress?.({ label: '準備中…' });

  const entries: BuiltZipEntry[] = [];
  const recordMeta: Array<Record<string, unknown>> = [];
  const totalRecords = sessions.length + plots.length + trips.length;
  let recordIdx = 0;

  const addRecord = async (
    kind: 'session' | 'plot' | 'collection',
    id: number,
    uuid: string | undefined,
    build: () => Promise<{ entries: BuiltZipEntry[]; folderName: string }>,
  ) => {
    recordIdx += 1;
    opts.onProgress?.({ label: `處理記錄 ${recordIdx}/${totalRecords}`, done: recordIdx - 1, total: totalRecords });
    try {
      const { entries: built, folderName } = await build();
      entries.push(...built.map((e) => ({ ...e, name: `records/${e.name}` })));
      recordMeta.push({ kind, id, uuid, folder: `records/${folderName}` });
    } catch (e) {
      // A record that fails (e.g. empty session) is noted, not fatal.
      recordMeta.push({ kind, id, uuid, error: e instanceof Error ? e.message : String(e) });
    }
  };

  for (const p of plots) await addRecord('plot', p.id, p.uuid, () => buildPlotEntries(p.id, opts, ctx));
  for (const s of sessions) await addRecord('session', s.id, s.uuid, () => buildSessionEntries(s.id, opts, ctx));
  for (const c of trips) await addRecord('collection', c.id, c.uuid, () => buildCollectionEntries(c.id, opts, ctx));

  // ── Analysis tables (plots only) ─────────────────────────────────────────
  const readmeNotes: string[] = [];
  let releves: Releve[] = [];
  let cols: SpeciesCol[] = [];
  let lossyTaxa: string[] = [];
  const wantVegan = opts.analysisFormats.includes('vegan');
  const wantJuice = opts.analysisFormats.includes('juice');
  const wantDwca = opts.analysisFormats.includes('dwca');
  const safeName = sanitizeFilename(project.name);

  if (plots.length > 0 && (wantVegan || wantJuice)) {
    opts.onProgress?.({ label: '產生分析資料表…' });
    const inputs: RelevePlotInput[] = plots.map((plot) => ({
      plot,
      projectName: project.name,
      layers: plot.plot_type === 'fixed' ? getPlotLayers(plot.id) : [],
      subplots: listSubplots(plot.id).map((sp) => ({ ...sp, layers: getSubplotLayers(sp.id) })),
      species: listPlotSpecies(plot.id),
    }));
    const built = buildReleves(inputs);
    releves = built.releves;
    readmeNotes.push(...built.warnings);
    cols = buildSpeciesCols(releves);

    const empty = releves.filter((r) => r.records.length === 0);
    if (empty.length > 0) {
      readmeNotes.push(
        `空樣區（矩陣中為全 0 列，vegan::vegdist 會產生 NaN）：${empty.map((r) => r.id).join('、')}`,
      );
    }

    if (wantVegan) {
      const mode = opts.matrixValue;
      const put = (name: string, text: string) =>
        entries.push({ name: `analysis/${name}`, bytes: strToU8(text) });
      put('releve_index.csv', tableToCsv(buildReleveIndex(releves)));
      put('species_index.csv', tableToCsv(buildSpeciesIndex(cols)));
      put('species_long.csv', tableToCsv(buildSpeciesLong(releves, cols, mode)));
      put('species_matrix.csv', tableToCsv(buildMatrix(releves, cols, mode)));
      if (opts.matrixByLayer) {
        put('species_matrix_by_layer.csv', tableToCsv(buildMatrixByLayer(releves, cols, mode)));
      }
      put('env.csv', tableToCsv(buildEnvWide(releves)));
      put('cover_scale.csv', buildCoverScaleCsv());
    }

    if (wantJuice) {
      const table = buildJuiceTable(releves, cols, `${project.name} (checklister-ng)`);
      lossyTaxa = table.lossyTaxa;
      entries.push({ name: `juice/${safeName}_table.csv`, bytes: strToU8(table.text) });
      entries.push({ name: `juice/${safeName}_header.csv`, bytes: strToU8(buildJuiceHeader(releves)) });
      entries.push({ name: `juice/${safeName}_species.csv`, bytes: strToU8(buildJuiceSpeciesList(cols)) });
    }
  }

  // ── Darwin Core Archive (all three record kinds) ─────────────────────────
  if (wantDwca && totalRecords > 0) {
    opts.onProgress?.({ label: '產生 Darwin Core Archive…' });
    const dwca = buildProjectDwca(project.name, project.abstract ?? '', plots, sessions, trips);
    entries.push({
      name: `dwca/${safeName}_dwca.zip`,
      bytes: dwca,
      // Already a deflate stream — store, don't re-compress.
      zipOpts: { level: 0 },
    });
  }

  // ── Sites ────────────────────────────────────────────────────────────────
  if (sites.length > 0) {
    for (const fmt of opts.geoFormats) {
      const text =
        fmt === 'geojson' ? sitesToGeoJSON(sites) : fmt === 'kml' ? sitesToKML(sites) : sitesToGPX(sites);
      entries.push({ name: `sites/sites.${fmt}`, bytes: strToU8(text) });
    }
  }

  // ── project.yml / README.md / manifest.json ──────────────────────────────
  const now = new Date();
  const stats = {
    sessions: sessions.length,
    plots: plots.length,
    collections: trips.length,
    sites: sites.length,
    releves: releves.length,
    taxa: cols.length,
  };
  const projectYml = {
    app: 'checklister-ng-mobile',
    type: 'project',
    schema_version: 1,
    created_at: localIso(now.getTime()),
    project: {
      name: project.name,
      abstract: project.abstract ?? '',
      location_description: project.location_description ?? '',
      notes: project.notes ?? '',
    },
    stats,
    records: recordMeta,
  };
  entries.push({ name: 'project.yml', bytes: strToU8(yaml.dump(projectYml, { lineWidth: -1, noRefs: true })) });

  // ── research report ──────────────────────────────────────────────────────
  // Written in the CURRENT UI language, not the zh-TW every other export is
  // fixed to. The report is prose and statistics commentary; a French user
  // handed a Chinese narrative has nothing. That exception is the report's
  // alone — record files, DwC terms and the checklist Markdown are unchanged.
  if (opts.includeReport) {
    opts.onProgress?.({ label: '產生研究報表…' });
    try {
      const input = collectProjectReportInput(projectId);
      if (input) {
        const lang = i18n.language;
        const report = buildProjectReport(input, i18n.getFixedT(lang) as unknown as Translate);
        if (opts.reportFormat === 'html' || opts.reportFormat === 'both') {
          entries.push({ name: 'report/report.html', bytes: strToU8(buildReportHtml(report, lang)) });
        }
        if (opts.reportFormat === 'docx' || opts.reportFormat === 'both') {
          entries.push({ name: 'report/report.docx', bytes: buildReportDocx(report) });
        }
        readmeNotes.push(`研究報表語言：${lang}（報表以目前介面語言產生，其餘匯出內容維持既有慣例）`);
      }
    } catch (e) {
      // A report that fails must not cost the user the rest of the bundle.
      readmeNotes.push(`研究報表產生失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  entries.push({
    name: 'README.md',
    bytes: strToU8(buildReadme(project.name, stats, opts, readmeNotes, lossyTaxa)),
  });
  entries.push({
    name: 'manifest.json',
    bytes: strToU8(
      JSON.stringify(
        {
          app: 'checklister-ng-mobile',
          schema_version: 1,
          type: 'project',
          created_at: now.toISOString(),
          project_name: project.name,
          stats,
          matrix_value: opts.matrixValue,
          analysis_formats: opts.analysisFormats,
          include_report: opts.includeReport,
          report_format: opts.includeReport ? opts.reportFormat : null,
          geoFormats: opts.geoFormats,
          includePhotos: opts.includePhotos,
          records: recordMeta,
        },
        null,
        2,
      ),
    ),
  });

  opts.onProgress?.({ label: '壓縮中…' });
  await new Promise((r) => setTimeout(r, 0));
  const ymdStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return finalizeZip(entries, `${safeName}_${ymdStr}`);
}

// ── DwC-A assembly ──────────────────────────────────────────────────────────

function eventDateOf(start: number | null, end: number | null): string {
  if (start == null) return '';
  const s = localIso(start);
  return end != null ? `${s}/${localIso(end)}` : s;
}

function buildProjectDwca(
  title: string,
  abstract: string,
  plots: PlotSurvey[],
  sessions: SessionWithStats[],
  trips: CollectionTripWithStats[],
): Uint8Array {
  const events: DwcRow[] = [];
  const occurrences: DwcRow[] = [];
  const humboldt: DwcRow[] = [];
  const usedIds = new Set<string>();
  const creators = new Set<string>();

  // DwC eventIDs must be unique; plotid / session names carry no such
  // guarantee in the schema, so collide → suffix _2, _3…
  const uniqueEventId = (base: string): string => {
    let id = base || 'event';
    for (let n = 2; usedIds.has(id); n++) id = `${base}_${n}`;
    usedIds.add(id);
    return id;
  };

  for (const p of plots) {
    const eventID = uniqueEventId(p.plotid);
    if (p.recorded_by) creators.add(p.recorded_by);
    events.push({
      eventID,
      eventDate: eventDateOf(p.start_ts, p.stop_ts),
      samplingProtocol: p.sampling_protocol,
      sampleSizeValue: p.sample_size_value,
      sampleSizeUnit: p.sample_size_unit,
      locality: p.locality,
      decimalLatitude: p.decimal_latitude,
      decimalLongitude: p.decimal_longitude,
      coordinateUncertaintyInMeters: p.coord_uncertainty_m,
      minimumElevationInMeters: p.elevation_m,
      recordedBy: p.recorded_by,
      eventRemarks: p.field_note,
    });
    const subplots = listSubplots(p.id);
    const subplotEventById = new Map<number, string>();
    for (const sp of subplots) {
      const childId = uniqueEventId(`${eventID}-${sp.label}`);
      subplotEventById.set(sp.id, childId);
      events.push({
        eventID: childId,
        parentEventID: eventID,
        eventDate: eventDateOf(p.start_ts, p.stop_ts),
        sampleSizeValue: sp.width_m != null && sp.length_m != null ? sp.width_m * sp.length_m : null,
        sampleSizeUnit: sp.width_m != null && sp.length_m != null ? 'm²' : null,
        recordedBy: p.recorded_by,
      });
    }
    const durationMin =
      p.start_ts != null && p.stop_ts != null
        ? Math.round((p.stop_ts - p.start_ts) / 60000)
        : null;
    humboldt.push({
      coreEventID: eventID,
      siteCount: subplots.length > 0 ? subplots.length : null,
      siteNestingDescription:
        subplots.length > 0 ? `${subplots.length} subplots (${subplots.map((s) => s.label).join(', ')})` : null,
      totalAreaSampledValue: p.sample_size_value,
      totalAreaSampledUnit: p.sample_size_unit,
      eventDurationValue: durationMin,
      eventDurationUnit: durationMin != null ? 'minutes' : null,
      protocolNames: p.sampling_protocol,
      samplingPerformedBy: p.recorded_by,
      isAbundanceReported: true,
      isVegetationCoverReported: p.plot_type === 'fixed',
      isAbsenceReported: false,
    });
    for (const r of listPlotSpecies(p.id)) {
      occurrences.push({
        coreEventID: (r.subplot_id != null ? subplotEventById.get(r.subplot_id) : null) ?? eventID,
        occurrenceID: r.occurrence_id,
        basisOfRecord: 'HumanObservation',
        taxonID: r.taxon_id,
        scientificName: r.used_scientific_name || r.simple_name,
        scientificNameAuthorship: r.name_author,
        vernacularName: r.common_name_c,
        family: r.family,
        kingdom: r.kingdom,
        organismQuantity: r.organism_quantity,
        organismQuantityType: r.organism_quantity_type,
        sex: multiToPipe(r.sex),
        lifeStage: r.life_stage,
        reproductiveCondition: multiToPipe(r.reproductive_condition),
        eventDate: r.observed_at != null ? localIso(r.observed_at) : '',
        decimalLatitude: r.lat,
        decimalLongitude: r.lng,
        coordinateUncertaintyInMeters: r.accuracy,
        occurrenceRemarks: r.notes,
      });
    }
  }

  for (const s of sessions) {
    const eventID = uniqueEventId(s.name);
    if (s.recorded_by) creators.add(s.recorded_by);
    events.push({
      eventID,
      eventDate: eventDateOf(s.started_at, s.ended_at),
      decimalLatitude: s.start_lat,
      decimalLongitude: s.start_lng,
      recordedBy: s.recorded_by,
      eventRemarks: s.notes,
    });
    const durationMin =
      s.ended_at != null ? Math.round((s.ended_at - s.started_at) / 60000) : null;
    humboldt.push({
      coreEventID: eventID,
      eventDurationValue: durationMin,
      eventDurationUnit: durationMin != null ? 'minutes' : null,
      samplingPerformedBy: s.recorded_by,
      isAbundanceReported: false,
      isVegetationCoverReported: false,
      isAbsenceReported: false,
    });
    for (const r of listSessionRecords(s.id)) {
      occurrences.push({
        coreEventID: eventID,
        occurrenceID: r.occurrence_id,
        basisOfRecord: 'HumanObservation',
        taxonID: r.taxon_id,
        scientificName: r.used_scientific_name || r.simple_name,
        scientificNameAuthorship: r.name_author,
        vernacularName: r.common_name_c,
        family: r.family,
        kingdom: r.kingdom,
        organismQuantity: r.organism_quantity,
        organismQuantityType: r.organism_quantity_type,
        sex: multiToPipe(r.sex),
        lifeStage: r.life_stage,
        reproductiveCondition: multiToPipe(r.reproductive_condition),
        eventDate: localIso(r.observed_at),
        decimalLatitude: r.lat,
        decimalLongitude: r.lng,
        coordinateUncertaintyInMeters: r.accuracy,
        occurrenceRemarks: r.notes,
      });
    }
  }

  for (const c of trips) {
    const eventID = uniqueEventId(c.name);
    if (c.recorded_by) creators.add(c.recorded_by);
    events.push({
      eventID,
      eventDate: eventDateOf(c.started_at, c.ended_at),
      locality: c.locality,
      recordedBy: c.recorded_by,
      eventRemarks: c.notes,
    });
    for (const sp of listSpecimens(c.id)) {
      occurrences.push({
        coreEventID: eventID,
        occurrenceID: sp.occurrence_id,
        basisOfRecord: 'PreservedSpecimen',
        taxonID: sp.taxon_id,
        scientificName: sp.used_scientific_name || sp.simple_name,
        scientificNameAuthorship: sp.name_author,
        vernacularName: sp.common_name_c,
        family: sp.family,
        kingdom: sp.kingdom,
        sex: multiToPipe(sp.sex),
        lifeStage: sp.life_stage,
        reproductiveCondition: multiToPipe(sp.reproductive_condition),
        eventDate: sp.collected_at != null ? localIso(sp.collected_at) : '',
        decimalLatitude: sp.lat,
        decimalLongitude: sp.lng,
        coordinateUncertaintyInMeters: sp.accuracy,
        occurrenceRemarks: sp.notes,
      });
    }
  }

  const now = new Date();
  return buildDwcArchive({
    meta: {
      title,
      abstract,
      creator: [...creators].join(', '),
      pubDate: now.toISOString().slice(0, 10),
      packageId: `checklister-ng-${sanitizeFilename(title)}-${now.toISOString().slice(0, 10)}`,
    },
    events,
    occurrences,
    humboldt,
  });
}

// ── README ──────────────────────────────────────────────────────────────────

function buildReadme(
  projectName: string,
  stats: Record<string, number>,
  opts: ProjectExportOptions,
  notes: string[],
  lossyTaxa: string[],
): string {
  const scale = coverScaleRows()
    .map((r) => `| ${r.bbCode} | ${r.coverPct} | ${r.ordinal} | ${r.coverProvenance} |`)
    .join('\n');
  const modeLabel =
    opts.matrixValue === 'bb'
      ? 'Braun-Blanquet 原始碼（矩陣含非數值儲存格，需自行轉換）'
      : opts.matrixValue === 'ordinal'
        ? 'ordinal transform（1–9）'
        : '覆蓋度整數百分比（JUICE/Turboveg 慣例）';
  const lines = [
    `# ${projectName} — 專案匯出`,
    '',
    `統計：名錄 ${stats.sessions}、樣區 ${stats.plots}（樣方 ${stats.releves}）、採集 ${stats.collections}、地理樣區 ${stats.sites}、物種欄 ${stats.taxa}`,
    '',
    '## 內容結構',
    '',
    '- `records/` — 逐筆記錄的完整匯出（yml / csv / md / geo / 照片），與單筆匯出格式相同，可個別重新匯入 app',
    '- `analysis/` — 跨樣區分析資料表（樣方 × 物種矩陣、環境表；**只涵蓋樣區**，名錄與採集不進矩陣）',
    '- `juice/` — JUICE 匯入檔（分號分隔）',
    '- `dwca/` — Darwin Core Archive（Event core + Occurrence + Humboldt extension，GBIF 發布用）',
    '- `sites/` — 專案的地理樣區幾何',
    '',
    '## analysis/（R vegan）',
    '',
    '樣方（relevé）定義：有小區的樣區以小區為一列（`plotid-S1`），未分小區以樣區為一列；',
    '切分後仍未歸屬小區的記錄另立母樣區列。同 plotid 重複調查時列名加日期後綴。',
    `矩陣數值表示法：${modeLabel}。`,
    '',
    '```r',
    'comm <- read.csv("analysis/species_matrix.csv", row.names = 1, check.names = FALSE)',
    'env  <- read.csv("analysis/env.csv", row.names = 1, check.names = FALSE)',
    'stopifnot(identical(rownames(comm), rownames(env)))',
    'library(vegan)',
    'vegdist(comm)          # Bray-Curtis 距離',
    'decostand(comm, "hellinger")',
    '```',
    '',
    '- `species_matrix.csv` — 合併版：同一物種跨層取最大值。**注意**：同一樣區不同層使用不同計量（如喬木層 DBH、草本層 BB）時，合併值單位混雜，請改用 `species_long.csv` 自訂合併規則',
    ...(opts.matrixByLayer ? ['- `species_matrix_by_layer.csv` — 分層版：欄名 `物種@E4`'] : []),
    '- `species_long.csv` — 無損長表（每筆記錄一列，含原值 quantity/quantityType 與轉換值 value）',
    '- `env.csv` — 環境表（列＝樣方、欄＝變數），與矩陣同列序',
    '- `releve_index.csv` — 樣方整數編號 ↔ 樣方 ID ↔ 樣區 UUID 對照',
    '- `species_index.csv` — 物種欄名 ↔ taxonID ↔ 學名/俗名/科',
    '- `cover_scale.csv` — 本次匯出使用的 Braun-Blanquet 換算表（含出處）',
    '- 檔案為 UTF-8 **無 BOM**（R 友善）；Excel 開啟請用「資料 → 從文字/CSV」並選 UTF-8',
    '- DBH 記錄之數值化 = 斷面積合計（cm²，多莖加總）；個體數跨層/跨筆合併採加總，覆蓋度採最大值',
    '',
    '## Braun-Blanquet 換算表',
    '',
    '| BB 碼 | 覆蓋度 % | ordinal | 出處 |',
    '|---|---|---|---|',
    scale,
    '',
    'ordinal 出處：van der Maarel (2007) J Veg Sci 18:767 摘要（extended BB scale r,+,1,2m,2a,2b,3,4,5 → OTV 1–9）；',
    '本 app 尺度無 2m/2a/2b，plain 2 → 5 為本軟體之文件化約定。',
    '',
    '## juice/（JUICE 匯入步驟）',
    '',
    `1. \`File → Import → Table → from Spreadsheet file\`，選 \`juice/*_table.csv\`，分隔符 **Semicolon**，第 2 欄為層次（層次 = 樣區分層 E1–E6 → 1–6）`,
    '2. `File → Import → Header Data`，套用 `juice/*_header.csv`（首欄 Relevé number 與表格對應；date 為 YYYYMMDD）',
    '3. 表中 `.` = 未出現；Braun-Blanquet 碼與百分比 JUICE 皆可讀',
    ...(lossyTaxa.length > 0
      ? [
          '',
          `**注意**：下列物種含非覆蓋度資料（個體數/胸徑/自訂計量），JUICE 表中一律以最小正值 \`1\`（=1%）標記為出現，數量請查 \`analysis/species_long.csv\`：${lossyTaxa.join('、')}`,
        ]
      : []),
    '',
    '## dwca/',
    '',
    '`*_dwca.zip` 為完整 Darwin Core Archive（TAB 分隔 + meta.xml + eml.xml），可直接上傳 GBIF IPT 或以',
    'GBIF data validator 檢驗。Event 階層：樣區為母事件、小區為子事件（parentEventID）；名錄與採集各自成事件。',
    '葉候（leafPhenology）與偵測方式等非標準 DwC 欄位不在 archive 內，完整欄位見 `records/`。',
    '',
    ...(notes.length > 0 ? ['## 匯出注意事項', '', ...notes.map((n) => `- ${n}`), ''] : []),
  ];
  return lines.join('\n');
}
