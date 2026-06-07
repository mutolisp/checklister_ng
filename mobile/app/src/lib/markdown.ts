/**
 * Markdown exporter — port of backend/api/export.py _generate_markdown.
 * Goal: byte-level compatibility with web version where feasible.
 */

import { formatScientificNameMarkdown } from './scientificNameMarkdown';

export type MarkdownItem = {
  taxon_id: string;
  name: string;            // simple_name
  fullname: string;        // simple_name + author
  cname: string;           // common_name_c
  family: string;
  family_c: string;
  family_cname?: string;
  kingdom: string;
  kingdom_c?: string;
  phylum: string;
  phylum_c?: string;
  class_name: string;      // mapped from `class`
  class_c?: string;
  order: string;
  order_c?: string;
  genus?: string;
  genus_c?: string;
  rank: string;
  endemic: 0 | 1;
  source: string;          // 原生 / 歸化 / 栽培 / 圈養
  redlist: string;
  iucn_category: string;
  cites: string;
  protected: string;
  is_hybrid: string;
  nomenclature_name: string;
  pt_name?: string;
  /** Observer remarks, appended inline after the species line (optional). */
  notes?: string | null;
  /** Abundance badge text, appended inline (optional). */
  abundance?: string | null;
};

export type MarkdownMetadata = {
  project?: string;
  site?: string;
  footprintWKT?: string;
};

export type MarkdownOptions = {
  levelsOverride?: string[];
  conservationFields?: ConservationField[];
};

export type ConservationField = 'redlist' | 'iucn_category' | 'cites' | 'protected';

const DEFAULT_HIERARCHIES: Record<string, string[]> = {
  Tracheophyta: ['pt_name', 'family'],
  Bryophyta: ['class_name', 'family'],
  Aves: ['order', 'family'],
  Insecta: ['order', 'family'],
  Mammalia: ['order', 'family'],
  Reptilia: ['order', 'family'],
  Amphibia: ['order', 'family'],
  Actinopteri: ['order', 'family'],
  Arachnida: ['order', 'family'],
  Gastropoda: ['order', 'family'],
  Bivalvia: ['order', 'family'],
  Malacostraca: ['order', 'family'],
  Ascomycota: ['class_name', 'order', 'family'],
  Basidiomycota: ['class_name', 'order', 'family'],
  Mollusca: ['class_name', 'order', 'family'],
  _default: ['class_name', 'family'],
};

const PLANT_CLASS_NAMES: Record<string, string> = {
  Lycopodiopsida: '石松類植物 Lycophytes',
  Polypodiopsida: '蕨類植物 Monilophytes',
  Cycadopsida: '裸子植物 Gymnosperms',
  Ginkgoopsida: '裸子植物 Gymnosperms',
  Pinopsida: '裸子植物 Gymnosperms',
};

const MONOCOT_ORDERS = new Set([
  'Acorales', 'Alismatales', 'Arecales', 'Asparagales', 'Commelinales',
  'Dioscoreales', 'Liliales', 'Pandanales', 'Petrosaviales', 'Poales',
  'Zingiberales',
]);
const SISTER_EUDICOT_ORDERS = new Set(['Ceratophyllales']);

function resolveAngiospermGroup(order: string): string {
  if (MONOCOT_ORDERS.has(order)) return '單子葉植物 Monocots';
  if (SISTER_EUDICOT_ORDERS.has(order)) return '真雙子葉植物姊妹群 Sister groups of Eudicots';
  return '真雙子葉植物 Eudicots';
}

const PT_NAME_ORDER: Record<string, number> = {
  '苔蘚地衣類植物 Mosses and Lichens': 0,
  '石松類植物 Lycophytes': 1,
  '蕨類植物 Monilophytes': 2,
  '裸子植物 Gymnosperms': 3,
  '單子葉植物 Monocots': 4,
  '真雙子葉植物姊妹群 Sister groups of Eudicots': 5,
  '真雙子葉植物 Eudicots': 6,
  '被子植物 Angiosperms': 7,
};

const GROUP_ORDER = [
  'Tracheophyta', 'Bryophyta',
  'Ascomycota', 'Basidiomycota',
  'Aves', 'Mammalia', 'Reptilia', 'Amphibia', 'Actinopteri',
  'Insecta', 'Arachnida', 'Malacostraca',
  'Gastropoda', 'Bivalvia',
];

const GROUP_NAMES: Record<string, string> = {
  Tracheophyta: '維管束植物',
  Bryophyta: '苔蘚植物',
  Aves: '鳥綱',
  Insecta: '昆蟲綱',
  Mammalia: '哺乳綱',
  Reptilia: '爬行綱',
  Amphibia: '兩生綱',
  Actinopteri: '輻鰭魚綱',
  Arachnida: '蛛形綱',
  Gastropoda: '腹足綱',
  Bivalvia: '雙殼綱',
  Malacostraca: '軟甲綱',
  Ascomycota: '子囊菌門',
  Basidiomycota: '擔子菌門',
  Mollusca: '軟體動物門',
};

function detectGroup(item: MarkdownItem): string {
  const cls = item.class_name || '';
  const phy = item.phylum || '';
  if (cls in DEFAULT_HIERARCHIES) return cls;
  if (phy in DEFAULT_HIERARCHIES) return phy;
  if (item.pt_name) return 'Tracheophyta';
  return '_default';
}

function getFieldDisplay(item: MarkdownItem, field: string): string {
  switch (field) {
    case 'family': {
      const fc = item.family_cname || item.family_c || '';
      const fl = item.family || '';
      return fc ? `${fc} (${fl})` : fl;
    }
    case 'pt_name': {
      const isVascular =
        item.phylum === 'Tracheophyta' || (item.pt_name || '').includes('Tracheophyta');
      if (isVascular) {
        const cls = item.class_name || '';
        if (PLANT_CLASS_NAMES[cls]) return PLANT_CLASS_NAMES[cls];
        if (cls === 'Magnoliopsida') return resolveAngiospermGroup(item.order || '');
      }
      const pt = item.pt_name || '';
      if (pt && !pt.startsWith('Tracheophyta')) return pt;
      return item.class_name || '';
    }
    case 'class_name': {
      const cls = item.class_name || '';
      const clsC = item.class_c || '';
      if (item.phylum === 'Tracheophyta' && PLANT_CLASS_NAMES[cls]) return PLANT_CLASS_NAMES[cls];
      return clsC ? `${clsC} (${cls})` : cls;
    }
    case 'order': {
      const oc = item.order_c || '';
      const ol = item.order || '';
      return oc ? `${oc} (${ol})` : ol;
    }
    case 'genus': {
      const gc = item.genus_c || '';
      const gl = item.genus || '';
      return gc ? `${gc} (${gl})` : gl;
    }
    case 'phylum': {
      const pc = item.phylum_c || '';
      const pl = item.phylum || '';
      return pc ? `${pc} (${pl})` : pl;
    }
    case 'kingdom': {
      const kc = item.kingdom_c || '';
      const kl = item.kingdom || '';
      return kc ? `${kc} (${kl})` : kl;
    }
    default:
      return ((item as Record<string, unknown>)[field] as string) || '';
  }
}

function getFieldSortKey(item: MarkdownItem, field: string): string {
  if (field === 'family') return item.family || '';
  if (field === 'pt_name') return getFieldDisplay(item, field);
  return ((item as Record<string, unknown>)[field] as string) || '';
}

function isInfraspecific(item: MarkdownItem): boolean {
  const rank = item.rank || '';
  if (['Subspecies', 'Variety', 'Form'].includes(rank)) return true;
  const name = item.name || '';
  return [' var. ', ' subsp. ', ' f. ', ' fo. '].some((m) => name.includes(m));
}

type RenderState = { counter: number; spCounter: number };

function renderGroup(
  lines: string[],
  items: MarkdownItem[],
  levels: string[],
  depth: number,
  state: RenderState,
  singleGroup: boolean,
  conservationFields: ConservationField[],
): void {
  if (depth >= levels.length) {
    const sortedItems = [...items].sort((a, b) => (a.fullname || '').localeCompare(b.fullname || ''));

    const infraPrefixes = new Set<string>();
    for (const it of sortedItems) {
      const name = it.name || '';
      if (isInfraspecific(it)) {
        const parts = name.split(/\s+/);
        if (parts.length >= 3) infraPrefixes.add(`${parts[0]} ${parts[1]}`);
      }
    }

    for (const item of sortedItems) {
      const sciName = formatScientificNameMarkdown(
        item.fullname || '',
        item.kingdom || '',
        item.nomenclature_name || '',
      );
      const cname = item.cname || '';
      const name = item.name || '';
      const isInfra = isInfraspecific(item);
      const isSL = !isInfra && infraPrefixes.has(name);
      const nameParts = name.split(/\s+/);
      const isSS = isInfra && nameParts.length >= 3 && nameParts[1] === nameParts[nameParts.length - 1];

      const sensu = isSL ? ' *s.l.*' : isSS ? ' *s.str.*' : '';
      const parts: string[] = [`${state.spCounter}. ${sciName}${sensu}`];
      if (cname) parts.push(cname);

      if (item.endemic === 1) parts.push('#');
      if (item.source === '歸化') parts.push('*');
      else if (item.source === '圈養') parts.push('‡');
      else if (item.source === '栽培') parts.push('†');

      const statusParts: string[] = [];
      if (conservationFields.includes('redlist') && item.redlist) statusParts.push(item.redlist);
      if (conservationFields.includes('iucn_category') && item.iucn_category)
        statusParts.push(`IUCN:${item.iucn_category}`);
      if (conservationFields.includes('cites') && item.cites) statusParts.push(`CITES:${item.cites}`);
      if (conservationFields.includes('protected') && item.protected) {
        const p = item.protected;
        statusParts.push(p === '1' ? '文資法珍稀' : `保育類:${p}`);
      }
      if (statusParts.length > 0) parts.push(statusParts.join('; '));
      // Append observer remarks / abundance inline so user-entered notes are
      // visible in the human-readable checklist (CSV/YAML carry the full data).
      const extras: string[] = [];
      if (item.abundance) extras.push(item.abundance);
      if (item.notes) extras.push(item.notes);
      if (extras.length > 0) parts.push(`（${extras.join('；')}）`);
      lines.push(parts.join(' '));
      state.spCounter += 1;
    }
    return;
  }

  const field = levels[depth];
  const isLastGroupLevel = depth === levels.length - 1;

  const grouped = new Map<string, MarkdownItem[]>();
  for (const item of items) {
    const key = getFieldSortKey(item, field);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const sortFn = field === 'pt_name'
    ? (a: string, b: string) => (PT_NAME_ORDER[a] ?? 99) - (PT_NAME_ORDER[b] ?? 99)
    : (a: string, b: string) => a.localeCompare(b);
  const sortedKeys = [...grouped.keys()].sort(sortFn);

  for (const key of sortedKeys) {
    const groupItems = grouped.get(key)!;
    const display = getFieldDisplay(groupItems[0], field);
    const speciesCount = groupItems.filter((it) =>
      ['Species', 'Subspecies', 'Variety', 'Form', ''].includes(it.rank || 'Species'),
    ).length;

    if (depth === 0 && !isLastGroupLevel) {
      const heading = singleGroup ? `## ${display}` : `### ${display}`;
      lines.push('', heading, '');
      renderGroup(lines, groupItems, levels, depth + 1, state, singleGroup, conservationFields);
    } else if (isLastGroupLevel || (depth > 0 && depth === levels.length - 1)) {
      lines.push('', `**${state.counter}. ${display}** (${speciesCount})`, '');
      state.counter += 1;
      renderGroup(lines, groupItems, levels, depth + 1, state, singleGroup, conservationFields);
    } else {
      const hashes = '#'.repeat(Math.min(depth + 2, 4));
      lines.push('', `${hashes} ${display}`, '');
      renderGroup(lines, groupItems, levels, depth + 1, state, singleGroup, conservationFields);
    }
  }
}

export function generateMarkdown(
  checklist: MarkdownItem[],
  metadata: MarkdownMetadata = {},
  options: MarkdownOptions = {},
): string {
  const conservationFields = options.conservationFields ?? ['redlist'];

  const groups = new Map<string, MarkdownItem[]>();
  for (const item of checklist) {
    const g = detectGroup(item);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  const sortedGroups = [...groups.keys()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const totalSpecies = checklist.length;
  const familySet = new Set<string>();
  for (const item of checklist) familySet.add(`${item.family}|${detectGroup(item)}`);
  const totalFamilies = familySet.size;

  const endemicCount = checklist.filter((it) => it.endemic === 1).length;
  const sourceCounts = countBy(checklist, (it) => it.source);

  const redlistCounts = conservationFields.includes('redlist')
    ? countBy(checklist, (it) => it.redlist)
    : new Map<string, number>();
  const iucnCounts = conservationFields.includes('iucn_category')
    ? countBy(checklist, (it) => it.iucn_category)
    : new Map<string, number>();
  const citesCounts = conservationFields.includes('cites')
    ? countBy(checklist, (it) => it.cites)
    : new Map<string, number>();
  const protectedCounts = conservationFields.includes('protected')
    ? countBy(checklist, (it) => it.protected)
    : new Map<string, number>();

  const lines: string[] = [];
  const title = metadata.project ? `${metadata.project}物種名錄` : '物種名錄';
  lines.push(`# ${title}`);
  if (metadata.site) lines.push(`**樣區：** ${metadata.site}`);
  lines.push('');
  lines.push(
    `本名錄共有 ${totalFamilies} 科、${totalSpecies} 種。"#" 代表特有種，"*" 代表歸化種，"†" 代表栽培種，"‡" 代表圈養種。`,
  );

  const statParts: string[] = [];
  if (endemicCount) statParts.push(`特有種 ${endemicCount}`);
  for (const src of ['原生', '歸化', '栽培', '圈養']) {
    const c = sourceCounts.get(src);
    if (c) statParts.push(`${src} ${c}`);
  }
  if (statParts.length > 0) lines.push(`物種屬性：${statParts.join('、')}。`);

  const skipCats = new Set(['LC', 'NLC', 'NE', 'NA', '']);
  const conservationStats: string[] = [];
  if (redlistCounts.size > 0) {
    const parts = [...redlistCounts.entries()]
      .filter(([cat]) => !skipCats.has(cat))
      .sort()
      .map(([cat, cnt]) => `${cat} ${cnt}`);
    if (parts.length > 0) conservationStats.push(`臺灣紅皮書：${parts.join('、')}`);
  }
  if (iucnCounts.size > 0) {
    const parts = [...iucnCounts.entries()]
      .filter(([cat]) => !skipCats.has(cat))
      .sort()
      .map(([cat, cnt]) => `${cat} ${cnt}`);
    if (parts.length > 0) conservationStats.push(`IUCN：${parts.join('、')}`);
  }
  if (citesCounts.size > 0) {
    const parts = [...citesCounts.entries()]
      .filter(([cat]) => cat)
      .sort()
      .map(([cat, cnt]) => `附錄${cat} ${cnt}`);
    if (parts.length > 0) conservationStats.push(`CITES：${parts.join('、')}`);
  }
  if (protectedCounts.size > 0) {
    const protMap: Record<string, string> = {
      I: '瀕臨絕種',
      II: '珍貴稀有',
      III: '其他應予保育',
      '1': '文資法珍稀',
    };
    const parts = [...protectedCounts.entries()]
      .filter(([cat]) => cat)
      .sort()
      .map(([cat, cnt]) => `${protMap[cat] ?? cat} ${cnt}`);
    if (parts.length > 0) conservationStats.push(`保育類：${parts.join('、')}`);
  }
  if (conservationStats.length > 0) lines.push(`保育統計：${conservationStats.join('；')}。`);

  lines.push('');

  const state: RenderState = { counter: 1, spCounter: 1 };

  for (const groupKey of sortedGroups) {
    const groupItems = groups.get(groupKey)!;
    const groupName = GROUP_NAMES[groupKey] ?? groupKey;

    let levels = options.levelsOverride
      ? [...options.levelsOverride]
      : DEFAULT_HIERARCHIES[groupKey] ?? DEFAULT_HIERARCHIES._default;

    if (sortedGroups.length > 1) {
      lines.push('', `## ${groupName} ${groupKey}`, '');

      const phylumGrouped = ['Tracheophyta', 'Bryophyta', 'Ascomycota', 'Basidiomycota'];
      const classGrouped = !phylumGrouped.includes(groupKey) && groupKey !== 'Mollusca';

      if (levels[0] === 'class_name' && classGrouped && groupKey in DEFAULT_HIERARCHIES) {
        levels = levels.slice(1);
      } else if (levels[0] === 'phylum' && phylumGrouped.includes(groupKey)) {
        levels = levels.slice(1);
      }
    }

    renderGroup(lines, groupItems, levels, 0, state, sortedGroups.length === 1, conservationFields);
  }

  return lines.join('\n');
}

function countBy<T>(items: T[], pick: (it: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    const k = pick(it);
    if (!k) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
