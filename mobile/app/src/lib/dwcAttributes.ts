/**
 * Darwin Core species attribute enums (stored in DB as the enum value, shown
 * in UI as the Chinese label). Keep enum strings stable for export — the
 * export pipeline maps these straight to DwC terms.
 */

import i18n from '~/i18n';

// ────────── sex ──────────

export type Sex = 'female' | 'male' | 'unknown';

export function sexOptions(): Array<{ value: Sex; label: string }> {
  return [
    { value: 'female', label: i18n.t('attr.sex.female') },
    { value: 'male', label: i18n.t('attr.sex.male') },
    { value: 'unknown', label: i18n.t('attr.sex.unknown') },
  ];
}

export function sexLabel(v: string | null | undefined): string {
  return v ? i18n.t(`attr.sex.${v}`) : '';
}

// ────────── detectionType (point count / animal records) ──────────

/** How the organism was detected. Single-value. Bird point counts commonly
 *  distinguish seen / heard / flying-over. Stored as the enum value; exported
 *  to the custom DwC-style term `detectionType`. */
export type DetectionType = 'seen' | 'heard' | 'flying';

export function detectionOptions(): Array<{ value: DetectionType; label: string }> {
  return [
    { value: 'seen', label: i18n.t('attr.detection.seen') },
    { value: 'heard', label: i18n.t('attr.detection.heard') },
    { value: 'flying', label: i18n.t('attr.detection.flying') },
  ];
}

export function detectionLabel(v: string | null | undefined): string {
  return v ? i18n.t(`attr.detection.${v}`) : '';
}

// ────────── lifeStage (per class) ──────────

export type LifeStage =
  | 'egg'
  | 'larva' // 兩棲幼體 / 昆蟲幼蟲
  | 'pupa' // 昆蟲蛹
  | 'subadult' // 通用亞成體
  | 'adult' // 通用成體
  | 'subadult_bird' // 亞成鳥
  | 'adult_bird'; // 成鳥

/**
 * Returns per-class life-stage options. Always lifecycle-ordered. Unknown /
 * unlisted classes fall through to a generic {卵, 亞成體, 成體} set.
 */
export function lifeStageOptions(
  className: string | null | undefined,
): Array<{ value: LifeStage; label: string }> {
  const c = (className || '').toLowerCase();
  if (c === 'amphibia') {
    return [
      { value: 'egg', label: i18n.t('attr.stage.egg') },
      { value: 'larva', label: i18n.t('attr.stage.larva') },
      { value: 'subadult', label: i18n.t('attr.stage.subadult') },
      { value: 'adult', label: i18n.t('attr.stage.adult') },
    ];
  }
  if (c === 'aves') {
    return [
      { value: 'egg', label: i18n.t('attr.stage.egg') },
      { value: 'subadult_bird', label: i18n.t('attr.stage.subadultBird') },
      { value: 'adult_bird', label: i18n.t('attr.stage.adultBird') },
    ];
  }
  if (c === 'mammalia') {
    return [
      { value: 'subadult', label: i18n.t('attr.stage.subadult') },
      { value: 'adult', label: i18n.t('attr.stage.adult') },
    ];
  }
  if (c === 'insecta') {
    return [
      { value: 'egg', label: i18n.t('attr.stage.egg') },
      { value: 'larva', label: i18n.t('attr.stage.larvaInsect') },
      { value: 'pupa', label: i18n.t('attr.stage.pupa') },
      { value: 'adult', label: i18n.t('attr.stage.adult') },
    ];
  }
  // Reptilia, Gastropoda, Bivalvia, Arachnida, Actinopterygii, others
  return [
    { value: 'egg', label: i18n.t('attr.stage.egg') },
    { value: 'subadult', label: i18n.t('attr.stage.subadult') },
    { value: 'adult', label: i18n.t('attr.stage.adult') },
  ];
}

const STAGE_KEY: Record<string, string> = {
  egg: 'attr.stage.egg', larva: 'attr.stage.larva', pupa: 'attr.stage.pupa',
  subadult: 'attr.stage.subadult', adult: 'attr.stage.adult',
  subadult_bird: 'attr.stage.subadultBird', adult_bird: 'attr.stage.adultBird',
};

export function lifeStageLabel(v: string | null | undefined): string {
  if (!v) return '';
  return STAGE_KEY[v] ? i18n.t(STAGE_KEY[v]) : v;
}

// ────────── reproductiveCondition (植物) ──────────

export type ReproductiveCondition =
  | 'flowering'
  | 'budding_flower'
  | 'fruiting'
  | 'sporangia'
  | 'cone';

export function reproductiveOptions(): Array<{ value: ReproductiveCondition; label: string }> {
  return [
    { value: 'flowering', label: i18n.t('attr.repro.flowering') },
    { value: 'budding_flower', label: i18n.t('attr.repro.buddingFlower') },
    { value: 'fruiting', label: i18n.t('attr.repro.fruiting') },
    { value: 'sporangia', label: i18n.t('attr.repro.sporangia') },
    { value: 'cone', label: i18n.t('attr.repro.cone') },
  ];
}

const REPRO_KEY: Record<string, string> = {
  flowering: 'attr.repro.flowering', budding_flower: 'attr.repro.buddingFlower',
  fruiting: 'attr.repro.fruiting', sporangia: 'attr.repro.sporangia', cone: 'attr.repro.cone',
};
export function reproductiveLabel(v: string | null | undefined): string {
  return v && REPRO_KEY[v] ? i18n.t(REPRO_KEY[v]) : '';
}

// ────────── leaf phenology (植物) ──────────

export type LeafPhenology = 'budding_leaf' | 'shedding' | 'green' | 'colored';

export function leafPhenologyOptions(): Array<{ value: LeafPhenology; label: string }> {
  return [
    { value: 'budding_leaf', label: i18n.t('attr.leaf.buddingLeaf') },
    { value: 'shedding', label: i18n.t('attr.leaf.shedding') },
    { value: 'green', label: i18n.t('attr.leaf.green') },
    { value: 'colored', label: i18n.t('attr.leaf.colored') },
  ];
}

const LEAF_KEY: Record<string, string> = {
  budding_leaf: 'attr.leaf.buddingLeaf', shedding: 'attr.leaf.shedding',
  green: 'attr.leaf.green', colored: 'attr.leaf.colored',
};
export function leafPhenologyLabel(v: string | null | undefined): string {
  return v && LEAF_KEY[v] ? i18n.t(LEAF_KEY[v]) : '';
}

// ────────── 一次取所有屬性 ──────────

export type SpeciesAttributes = {
  sex: Sex | null;
  life_stage: LifeStage | null;
  reproductive_condition: ReproductiveCondition | null;
  leaf_phenology: LeafPhenology | null;
};

export const EMPTY_ATTRIBUTES: SpeciesAttributes = {
  sex: null,
  life_stage: null,
  reproductive_condition: null,
  leaf_phenology: null,
};

type AnyAttributes = {
  sex?: string | null;
  life_stage?: string | null;
  reproductive_condition?: string | string[] | null;
  leaf_phenology?: string | string[] | null;
};

function nonEmpty(v: string | string[] | null | undefined): boolean {
  if (!v) return false;
  if (typeof v === 'string') return v.length > 0;
  return v.length > 0;
}

/** Has any attribute been set? (used to show a hint chip on the record card) */
export function hasAttributes(a: AnyAttributes): boolean {
  return Boolean(
    a.sex || a.life_stage || nonEmpty(a.reproductive_condition) || nonEmpty(a.leaf_phenology),
  );
}

// ────────── shaping records into / out of SpeciesAttributesDraft ──────────

type DraftShaped = {
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string[];
  leaf_phenology: string[];
};

type RecordShape = {
  sex?: string | null;
  life_stage?: string | null;
  reproductive_condition?: string | null;
  leaf_phenology?: string | null;
};

/** Build a draft from raw DB record fields. */
export function attributesFromRecord(r: RecordShape): DraftShaped {
  return {
    sex: r.sex ?? null,
    life_stage: r.life_stage ?? null,
    reproductive_condition: parseMultiAttribute(r.reproductive_condition),
    leaf_phenology: parseMultiAttribute(r.leaf_phenology),
  };
}

/** Serialize a draft into DB cell values. */
export function attributesToColumns(d: DraftShaped) {
  return {
    sex: d.sex,
    life_stage: d.life_stage,
    reproductive_condition: serializeMultiAttribute(d.reproductive_condition),
    leaf_phenology: serializeMultiAttribute(d.leaf_phenology),
  };
}

export const EMPTY_DRAFT: DraftShaped = {
  sex: null,
  life_stage: null,
  reproductive_condition: [],
  leaf_phenology: [],
};

// ────────── Multi-value helpers (JSON array <-> string[]) ──────────

/**
 * Parse a DB-side string into an array of values.
 *
 *   null / ''     → []
 *   '["a","b"]'   → ['a','b']           (JSON array — current canonical form)
 *   'a|b'         → ['a','b']           (legacy `|` separator, DwC import)
 *   'flowering'   → ['flowering']        (legacy single-value plain string)
 */
export function parseMultiAttribute(s: string | null | undefined): string[] {
  if (s == null || s === '') return [];
  // JSON array form
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    } catch {
      // fall through to single-value treatment
    }
  }
  // `|`-separated legacy form (DwC convention)
  if (s.includes('|')) {
    return s.split('|').map((x) => x.trim()).filter((x) => x.length > 0);
  }
  return [s];
}

/** Serialize a string[] back to a DB cell. Returns null when empty. */
export function serializeMultiAttribute(arr: string[] | null | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return JSON.stringify(arr);
}

/** Toggle membership of `value` in `arr`. */
export function toggleMultiValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}
