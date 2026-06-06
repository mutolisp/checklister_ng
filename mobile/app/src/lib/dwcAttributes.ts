/**
 * Darwin Core species attribute enums (stored in DB as the enum value, shown
 * in UI as the Chinese label). Keep enum strings stable for export — the
 * export pipeline maps these straight to DwC terms.
 */

// ────────── sex ──────────

export type Sex = 'female' | 'male' | 'unknown';

export const SEX_OPTIONS: Array<{ value: Sex; label: string }> = [
  { value: 'female', label: '雌' },
  { value: 'male', label: '雄' },
  { value: 'unknown', label: '無法判斷' },
];

export function sexLabel(v: string | null | undefined): string {
  return SEX_OPTIONS.find((o) => o.value === v)?.label ?? '';
}

// ────────── detectionType (point count / animal records) ──────────

/** How the organism was detected. Single-value. Bird point counts commonly
 *  distinguish seen / heard / flying-over. Stored as the enum value; exported
 *  to the custom DwC-style term `detectionType`. */
export type DetectionType = 'seen' | 'heard' | 'flying';

export const DETECTION_OPTIONS: Array<{ value: DetectionType; label: string }> = [
  { value: 'seen', label: '看到' },
  { value: 'heard', label: '聽到' },
  { value: 'flying', label: '飛過' },
];

export function detectionLabel(v: string | null | undefined): string {
  return DETECTION_OPTIONS.find((o) => o.value === v)?.label ?? '';
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

const STAGE_LABEL: Record<LifeStage, string> = {
  egg: '卵',
  larva: '幼體',
  pupa: '蛹',
  subadult: '亞成體',
  adult: '成體',
  subadult_bird: '亞成鳥',
  adult_bird: '成鳥',
};

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
      { value: 'egg', label: '卵' },
      { value: 'larva', label: '幼體' },
      { value: 'subadult', label: '亞成體' },
      { value: 'adult', label: '成體' },
    ];
  }
  if (c === 'aves') {
    return [
      { value: 'egg', label: '卵' },
      { value: 'subadult_bird', label: '亞成鳥' },
      { value: 'adult_bird', label: '成鳥' },
    ];
  }
  if (c === 'mammalia') {
    return [
      { value: 'subadult', label: '亞成體' },
      { value: 'adult', label: '成體' },
    ];
  }
  if (c === 'insecta') {
    return [
      { value: 'egg', label: '卵' },
      { value: 'larva', label: '幼蟲' },
      { value: 'pupa', label: '蛹' },
      { value: 'adult', label: '成體' },
    ];
  }
  // Reptilia, Gastropoda, Bivalvia, Arachnida, Actinopterygii, others
  return [
    { value: 'egg', label: '卵' },
    { value: 'subadult', label: '亞成體' },
    { value: 'adult', label: '成體' },
  ];
}

export function lifeStageLabel(v: string | null | undefined): string {
  if (!v) return '';
  return STAGE_LABEL[v as LifeStage] ?? v;
}

// ────────── reproductiveCondition (植物) ──────────

export type ReproductiveCondition =
  | 'flowering'
  | 'budding_flower'
  | 'fruiting'
  | 'sporangia'
  | 'cone';

export const REPRODUCTIVE_OPTIONS: Array<{ value: ReproductiveCondition; label: string }> = [
  { value: 'flowering', label: '開花' },
  { value: 'budding_flower', label: '花芽' },
  { value: 'fruiting', label: '結果或種子' },
  { value: 'sporangia', label: '結孢子囊穗/堆' },
  { value: 'cone', label: '結毬果' },
];

export function reproductiveLabel(v: string | null | undefined): string {
  return REPRODUCTIVE_OPTIONS.find((o) => o.value === v)?.label ?? '';
}

// ────────── leaf phenology (植物) ──────────

export type LeafPhenology = 'budding_leaf' | 'shedding' | 'green' | 'colored';

export const LEAF_PHENOLOGY_OPTIONS: Array<{ value: LeafPhenology; label: string }> = [
  { value: 'budding_leaf', label: '開展中的葉芽' },
  { value: 'shedding', label: '落葉' },
  { value: 'green', label: '綠葉' },
  { value: 'colored', label: '有色葉' },
];

export function leafPhenologyLabel(v: string | null | undefined): string {
  return LEAF_PHENOLOGY_OPTIONS.find((o) => o.value === v)?.label ?? '';
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
