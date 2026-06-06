import yaml from 'js-yaml';
import { File, Paths } from 'expo-file-system';
import {
  getProject,
  getSession,
  getTaicolDb,
  listSessionRecords,
  type RecordWithTaxon,
} from '~/db';
import { convertToDwc } from './dwcMapper';
import { parseMultiAttribute } from './dwcAttributes';
import { generateMarkdown, type MarkdownItem } from './markdown';

/** DwC multi-value convention: pipe-separated. JSON-array DB cells are
 *  unpacked via parseMultiAttribute, then joined. Empty → null so the value
 *  drops out of the export instead of appearing as an empty string column. */
function multiToDwc(raw: string | null | undefined): string | null {
  const arr = parseMultiAttribute(raw);
  return arr.length === 0 ? null : arr.join('|');
}

type ExportItem = Record<string, unknown>;

function recordToExportItem(rec: RecordWithTaxon, extra: ExportItem = {}): ExportItem {
  const fullname = rec.name_author ? `${rec.simple_name} ${rec.name_author}` : rec.simple_name;
  const isEndemic = rec.is_endemic === 'true' ? 1 : 0;
  return {
    taxon_id: rec.taxon_id,
    name: rec.simple_name,
    fullname,
    cname: rec.common_name_c,
    family: rec.family,
    family_c: rec.family_c,
    kingdom: rec.kingdom,
    phylum: rec.phylum,
    class_name: rec.class,
    order: rec.order,
    iucn_category: rec.iucn,
    redlist: rec.redlist,
    cites: rec.cites,
    protected: rec.protected,
    endemic: isEndemic,
    is_hybrid: rec.is_hybrid,
    // DwC species attributes (single-value enums + multi-value pipe-separated).
    sex: rec.sex,
    life_stage: rec.life_stage,
    reproductive_condition: multiToDwc(rec.reproductive_condition),
    leaf_phenology: multiToDwc(rec.leaf_phenology),
    // notes + per-record GPS were previously dropped here, so the standalone
    // CSV/YAML lost user-entered remarks and coordinates. Keep them aligned
    // with the bundle exporter.
    notes: rec.notes,
    lat: rec.lat,
    lng: rec.lng,
    accuracy: rec.accuracy,
    eventDate: new Date(rec.observed_at).toISOString(),
    ...extra,
  };
}

export type ExportPayload = {
  format: 'yaml' | 'csv';
  sessionId: number;
};

export type ExportFile = {
  uri: string;
  filename: string;
  mimeType: string;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, '_').slice(0, 80) || 'checklist';
}

function buildPayload(sessionId: number): {
  items: ExportItem[];
  project: string;
  filenameBase: string;
} {
  const session = getSession(sessionId);
  if (!session) throw new Error(`記錄 ${sessionId} 不存在`);
  const records = listSessionRecords(sessionId);
  if (records.length === 0) throw new Error('記錄內無物種，無法匯出');

  const project = getProject(session.project_id);
  const items = records.map((r) => recordToExportItem(r));
  const filenameBase = sanitizeFilename(`${session.name}_${project?.name ?? ''}`);
  return { items, project: project?.name ?? '', filenameBase };
}

export async function exportYaml(sessionId: number): Promise<ExportFile> {
  const { items, project, filenameBase } = buildPayload(sessionId);
  const dwcItems = items.map(convertToDwc);
  const data: Record<string, unknown> = { checklist: dwcItems };
  if (project) data.project = project;

  const text = yaml.dump(data, { lineWidth: -1, noRefs: true });
  const file = new File(Paths.cache, `${filenameBase}.yml`);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return { uri: file.uri, filename: `${filenameBase}.yml`, mimeType: 'application/x-yaml' };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function recordToMarkdownItem(rec: RecordWithTaxon): MarkdownItem {
  const fullname = rec.name_author ? `${rec.simple_name} ${rec.name_author}` : rec.simple_name;
  return {
    taxon_id: rec.taxon_id,
    name: rec.simple_name,
    fullname,
    cname: rec.common_name_c,
    family: rec.family,
    family_c: rec.family_c,
    family_cname: rec.family_c,
    kingdom: rec.kingdom,
    phylum: rec.phylum,
    class_name: rec.class,
    order: rec.order,
    rank: rec.rank,
    endemic: rec.is_endemic === 'true' ? 1 : 0,
    source: mapAlienToSource(rec.alien_type, rec.kingdom),
    redlist: rec.redlist,
    iucn_category: rec.iucn,
    cites: rec.cites,
    protected: rec.protected,
    is_hybrid: rec.is_hybrid,
    nomenclature_name: '',
    notes: rec.notes,
  };
}

function mapAlienToSource(alienType: string, kingdom: string): string {
  if (alienType === 'cultured') return kingdom === 'Animalia' ? '圈養' : '栽培';
  if (alienType === 'native') return '原生';
  if (alienType === 'naturalized' || alienType === 'invasive') return '歸化';
  return '';
}

export async function exportMarkdown(sessionId: number): Promise<ExportFile> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`記錄 ${sessionId} 不存在`);
  const records = listSessionRecords(sessionId);
  if (records.length === 0) throw new Error('記錄內無物種，無法匯出');

  const project = getProject(session.project_id);
  const items = records.map(recordToMarkdownItem);
  const filenameBase = sanitizeFilename(`${session.name}_${project?.name ?? ''}`);

  const text = generateMarkdown(items, {
    project: project?.id !== 0 ? project?.name : '',
    site: '',
  });

  const file = new File(Paths.cache, `${filenameBase}.md`);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return { uri: file.uri, filename: `${filenameBase}.md`, mimeType: 'text/markdown' };
}

export async function exportCsv(sessionId: number): Promise<ExportFile> {
  const { items, filenameBase } = buildPayload(sessionId);
  const dwcItems = items.map(convertToDwc);

  const allKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of dwcItems) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        allKeys.push(k);
      }
    }
  }

  const lines: string[] = [];
  lines.push(allKeys.join(','));
  for (const row of dwcItems) {
    lines.push(allKeys.map((k) => csvEscape(row[k])).join(','));
  }
  const csv = '﻿' + lines.join('\n');

  const file = new File(Paths.cache, `${filenameBase}.csv`);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  return { uri: file.uri, filename: `${filenameBase}.csv`, mimeType: 'text/csv' };
}

// silence unused warning while we keep the helper for future enrichment
void getTaicolDb;
