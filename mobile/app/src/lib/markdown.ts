/**
 * Markdown exporter — port of backend/api/export.py _generate_markdown.
 * Goal: byte-level compatibility with web version where feasible.
 *
 * Localisation is INJECTED as `t`, never imported: this module stays pure (no
 * DB / expo / `~/i18n`), which is what lets a caller render the checklist in a
 * language other than the UI's with `i18n.getFixedT(lang)`. Same contract the
 * report renderers already follow.
 *
 * What `t` must NOT touch: scientific names, vernacular names, DwC values, and
 * the `source` / `rank` / conservation codes that arrive from the DB. Those are
 * data. Only the surrounding prose and the group headings are translated.
 */

import type { Translate } from './reportTypes';
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

/**
 * Language-neutral keys for the vascular-plant groups.
 *
 * These used to BE the display strings — `PT_NAME_ORDER` was keyed by
 * `'蕨類植物 Monilophytes'` and `getFieldSortKey` returned the rendered label,
 * so the ordering silently depended on the text. Translating the label would
 * therefore have broken the mandated 石松→蕨→裸子→單子葉→姊妹群→真雙子葉
 * sequence without any error: every key would miss and fall to the `?? 99`
 * default. Same shape of bug as the taxonomy tree's baked-in rank labels —
 * keep the key language-neutral, translate only at render time.
 */
type PlantGroupKey =
  | 'mossesLichens'
  | 'lycophytes'
  | 'monilophytes'
  | 'gymnosperms'
  | 'monocots'
  | 'sisterEudicots'
  | 'eudicots'
  | 'angiosperms';

const PLANT_GROUP_ORDER: Record<PlantGroupKey, number> = {
  mossesLichens: 0,
  lycophytes: 1,
  monilophytes: 2,
  gymnosperms: 3,
  monocots: 4,
  sisterEudicots: 5,
  eudicots: 6,
  angiosperms: 7,
};

const PLANT_CLASS_GROUPS: Record<string, PlantGroupKey> = {
  Lycopodiopsida: 'lycophytes',
  Polypodiopsida: 'monilophytes',
  Cycadopsida: 'gymnosperms',
  Ginkgoopsida: 'gymnosperms',
  Pinopsida: 'gymnosperms',
};

/** Legacy `pt_name` values still sitting in exported/imported data, mapped onto
 *  the neutral keys so old rows keep their place in the ordering. */
const LEGACY_PT_NAMES: Record<string, PlantGroupKey> = {
  '苔蘚地衣類植物 Mosses and Lichens': 'mossesLichens',
  '石松類植物 Lycophytes': 'lycophytes',
  '蕨類植物 Monilophytes': 'monilophytes',
  '裸子植物 Gymnosperms': 'gymnosperms',
  '單子葉植物 Monocots': 'monocots',
  '真雙子葉植物姊妹群 Sister groups of Eudicots': 'sisterEudicots',
  '真雙子葉植物 Eudicots': 'eudicots',
  '被子植物 Angiosperms': 'angiosperms',
};

const MONOCOT_ORDERS = new Set([
  'Acorales', 'Alismatales', 'Arecales', 'Asparagales', 'Commelinales',
  'Dioscoreales', 'Liliales', 'Pandanales', 'Petrosaviales', 'Poales',
  'Zingiberales',
]);
const SISTER_EUDICOT_ORDERS = new Set(['Ceratophyllales']);

function resolveAngiospermGroup(order: string): PlantGroupKey {
  if (MONOCOT_ORDERS.has(order)) return 'monocots';
  if (SISTER_EUDICOT_ORDERS.has(order)) return 'sisterEudicots';
  return 'eudicots';
}

function plantGroupLabel(key: PlantGroupKey, t: Translate): string {
  return t(`checklistDoc.plantGroup.${key}`);
}

const GROUP_ORDER = [
  'Tracheophyta', 'Bryophyta',
  'Ascomycota', 'Basidiomycota',
  'Aves', 'Mammalia', 'Reptilia', 'Amphibia', 'Actinopteri',
  'Insecta', 'Arachnida', 'Malacostraca',
  'Gastropoda', 'Bivalvia',
];

/** Groups that have a translated heading. Anything else falls back to the Latin
 *  name — i18next echoes the key when it is missing, which would put
 *  `checklistDoc.group.Foo` into the document, so the membership test is the
 *  guard rather than `??`.
 *
 *  Deliberately its own namespace rather than reusing `taxonGroup.*`: those are
 *  vernacular filter labels (鳥類 / Birds) while a checklist heading names the
 *  rank (鳥綱 / Class Aves), and they do not cover Bryophyta, Gastropoda,
 *  Bivalvia, Malacostraca, Ascomycota or Basidiomycota at all. */
const GROUP_NAME_KEYS = new Set([
  'Tracheophyta', 'Bryophyta', 'Aves', 'Insecta', 'Mammalia', 'Reptilia',
  'Amphibia', 'Actinopteri', 'Arachnida', 'Gastropoda', 'Bivalvia',
  'Malacostraca', 'Ascomycota', 'Basidiomycota', 'Mollusca',
]);

function groupLabel(groupKey: string, t: Translate): string {
  return GROUP_NAME_KEYS.has(groupKey) ? t(`checklistDoc.group.${groupKey}`) : groupKey;
}

function detectGroup(item: MarkdownItem): string {
  const cls = item.class_name || '';
  const phy = item.phylum || '';
  if (cls in DEFAULT_HIERARCHIES) return cls;
  if (phy in DEFAULT_HIERARCHIES) return phy;
  if (item.pt_name) return 'Tracheophyta';
  return '_default';
}

/** The vascular-plant group an item belongs to, or null when it is not one.
 *  Shared by the display and the sort key so the two can never disagree. */
function plantGroupKeyOf(item: MarkdownItem): PlantGroupKey | null {
  const isVascular =
    item.phylum === 'Tracheophyta' || (item.pt_name || '').includes('Tracheophyta');
  if (isVascular) {
    const cls = item.class_name || '';
    if (PLANT_CLASS_GROUPS[cls]) return PLANT_CLASS_GROUPS[cls];
    if (cls === 'Magnoliopsida') return resolveAngiospermGroup(item.order || '');
  }
  const pt = item.pt_name || '';
  if (pt && !pt.startsWith('Tracheophyta')) return LEGACY_PT_NAMES[pt] ?? null;
  return null;
}

function getFieldDisplay(item: MarkdownItem, field: string, t: Translate): string {
  switch (field) {
    case 'family': {
      const fc = item.family_cname || item.family_c || '';
      const fl = item.family || '';
      return fc ? `${fc} (${fl})` : fl;
    }
    case 'pt_name': {
      const key = plantGroupKeyOf(item);
      if (key) return plantGroupLabel(key, t);
      const pt = item.pt_name || '';
      if (pt && !pt.startsWith('Tracheophyta')) return pt;
      return item.class_name || '';
    }
    case 'class_name': {
      const cls = item.class_name || '';
      const clsC = item.class_c || '';
      if (item.phylum === 'Tracheophyta' && PLANT_CLASS_GROUPS[cls]) {
        return plantGroupLabel(PLANT_CLASS_GROUPS[cls], t);
      }
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
  // Language-neutral on purpose — this key drives PLANT_GROUP_ORDER, and a
  // translated one would miss every entry and collapse the mandated ordering.
  if (field === 'pt_name') {
    const key = plantGroupKeyOf(item);
    if (key) return key;
    // Mirrors getFieldDisplay's fallbacks exactly, so grouping and heading can
    // never disagree about which bucket a row belongs to.
    const pt = item.pt_name || '';
    if (pt && !pt.startsWith('Tracheophyta')) return pt;
    return item.class_name || '';
  }
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
  t: Translate,
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
        // `item.protected` is the DB code (I / II / III / 1) and stays verbatim;
        // only the word in front of it is translated.
        const p = item.protected;
        statusParts.push(
          p === '1' ? t('checklistDoc.culturalHeritageRare') : `${t('species.protected')}:${p}`,
        );
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
    ? (a: string, b: string) =>
        (PLANT_GROUP_ORDER[a as PlantGroupKey] ?? 99) -
        (PLANT_GROUP_ORDER[b as PlantGroupKey] ?? 99)
    : (a: string, b: string) => a.localeCompare(b);
  const sortedKeys = [...grouped.keys()].sort(sortFn);

  for (const key of sortedKeys) {
    const groupItems = grouped.get(key)!;
    const display = getFieldDisplay(groupItems[0], field, t);
    const speciesCount = groupItems.filter((it) =>
      ['Species', 'Subspecies', 'Variety', 'Form', ''].includes(it.rank || 'Species'),
    ).length;

    if (depth === 0 && !isLastGroupLevel) {
      const heading = singleGroup ? `## ${display}` : `### ${display}`;
      lines.push('', heading, '');
      renderGroup(lines, groupItems, levels, depth + 1, state, singleGroup, conservationFields, t);
    } else if (isLastGroupLevel || (depth > 0 && depth === levels.length - 1)) {
      lines.push('', `**${state.counter}. ${display}** (${speciesCount})`, '');
      state.counter += 1;
      renderGroup(lines, groupItems, levels, depth + 1, state, singleGroup, conservationFields, t);
    } else {
      const hashes = '#'.repeat(Math.min(depth + 2, 4));
      lines.push('', `${hashes} ${display}`, '');
      renderGroup(lines, groupItems, levels, depth + 1, state, singleGroup, conservationFields, t);
    }
  }
}

/** DB `source` value → label key. The Chinese literals are stored data, not
 *  display text, so they stay as the lookup and only the label is translated. */
const SOURCE_LABEL_KEYS: Record<string, string> = {
  原生: 'alien.native',
  歸化: 'alien.naturalized',
  栽培: 'alien.cultivated',
  圈養: 'alien.captive',
};

export function generateMarkdown(
  checklist: MarkdownItem[],
  t: Translate,
  metadata: MarkdownMetadata = {},
  options: MarkdownOptions = {},
): string {
  // Separators differ by script: 、／； in CJK, ", " / "; " elsewhere.
  const listSep = t('checklistDoc.listSep');
  const statSep = t('checklistDoc.statSep');
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
  const title = metadata.project
    ? t('checklistDoc.titleWithProject', { project: metadata.project })
    : t('checklistDoc.title');
  lines.push(`# ${title}`);
  if (metadata.site) lines.push(`**${t('checklistDoc.site')}** ${metadata.site}`);
  lines.push('');
  // Each count renders through its own plural key: one string cannot pluralise
  // two numbers, and "1 families" is exactly what that costs.
  lines.push(
    t('checklistDoc.summary', {
      families: t('checklistDoc.familyCount', { count: totalFamilies }),
      species: t('checklistDoc.speciesCount', { count: totalSpecies }),
    }),
  );

  const statParts: string[] = [];
  if (endemicCount) statParts.push(`${t('species.endemic')} ${endemicCount}`);
  for (const src of ['原生', '歸化', '栽培', '圈養']) {
    const c = sourceCounts.get(src);
    if (c) statParts.push(`${t(SOURCE_LABEL_KEYS[src])} ${c}`);
  }
  if (statParts.length > 0) {
    lines.push(t('checklistDoc.attributes', { stats: statParts.join(listSep) }));
  }

  const skipCats = new Set(['LC', 'NLC', 'NE', 'NA', '']);
  const conservationStats: string[] = [];
  if (redlistCounts.size > 0) {
    const parts = [...redlistCounts.entries()]
      .filter(([cat]) => !skipCats.has(cat))
      .sort()
      .map(([cat, cnt]) => `${cat} ${cnt}`);
    if (parts.length > 0) {
      conservationStats.push(t('checklistDoc.redlist', { parts: parts.join(listSep) }));
    }
  }
  if (iucnCounts.size > 0) {
    const parts = [...iucnCounts.entries()]
      .filter(([cat]) => !skipCats.has(cat))
      .sort()
      .map(([cat, cnt]) => `${cat} ${cnt}`);
    if (parts.length > 0) {
      conservationStats.push(t('checklistDoc.iucn', { parts: parts.join(listSep) }));
    }
  }
  if (citesCounts.size > 0) {
    const parts = [...citesCounts.entries()]
      .filter(([cat]) => cat)
      .sort()
      .map(([cat, cnt]) => `${t('checklistDoc.citesAppendix', { cat })} ${cnt}`);
    if (parts.length > 0) {
      conservationStats.push(t('checklistDoc.cites', { parts: parts.join(listSep) }));
    }
  }
  if (protectedCounts.size > 0) {
    const protMap: Record<string, string> = {
      I: t('checklistDoc.protected.I'),
      II: t('checklistDoc.protected.II'),
      III: t('checklistDoc.protected.III'),
      '1': t('checklistDoc.culturalHeritageRare'),
    };
    const parts = [...protectedCounts.entries()]
      .filter(([cat]) => cat)
      .sort()
      .map(([cat, cnt]) => `${protMap[cat] ?? cat} ${cnt}`);
    if (parts.length > 0) {
      conservationStats.push(t('checklistDoc.protectedStat', { parts: parts.join(listSep) }));
    }
  }
  if (conservationStats.length > 0) {
    lines.push(t('checklistDoc.conservation', { stats: conservationStats.join(statSep) }));
  }

  lines.push('');

  const state: RenderState = { counter: 1, spCounter: 1 };

  for (const groupKey of sortedGroups) {
    const groupItems = groups.get(groupKey)!;
    const groupName = groupLabel(groupKey, t);

    let levels = options.levelsOverride
      ? [...options.levelsOverride]
      : DEFAULT_HIERARCHIES[groupKey] ?? DEFAULT_HIERARCHIES._default;

    if (sortedGroups.length > 1) {
      // Spanish's vernacular for Aves IS "Aves"; printing "Aves Aves" would be
      // the only visible sign of it, so collapse the pair whenever they match.
      const heading = groupName === groupKey ? groupKey : `${groupName} ${groupKey}`;
      lines.push('', `## ${heading}`, '');

      const phylumGrouped = ['Tracheophyta', 'Bryophyta', 'Ascomycota', 'Basidiomycota'];
      const classGrouped = !phylumGrouped.includes(groupKey) && groupKey !== 'Mollusca';

      if (levels[0] === 'class_name' && classGrouped && groupKey in DEFAULT_HIERARCHIES) {
        levels = levels.slice(1);
      } else if (levels[0] === 'phylum' && phylumGrouped.includes(groupKey)) {
        levels = levels.slice(1);
      }
    }

    renderGroup(
      lines, groupItems, levels, 0, state, sortedGroups.length === 1, conservationFields, t,
    );
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
