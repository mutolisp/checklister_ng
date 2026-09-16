import { create } from 'zustand';
import { GEOPRIVACY_VALUES, type Geoprivacy } from '~/lib/inatPayload';
import { getUserDb } from '~/db';
import type { TaxonGroup } from '~/db/types';
import type { ConservationField } from '~/lib/markdown';
import type { MatrixValueMode } from '~/lib/vegMatrix';

export type { MatrixValueMode };

export type Theme = 'light' | 'dark' | 'auto';
export type CardDensity = 'compact' | 'comfortable';

/** UI language. 'system' follows the device locale; others force that language.
 *  All four ship a locale file (see `~/i18n`), kept structurally identical to
 *  zh-TW by `npm run check:i18n`. */
export type Language =
  | 'system'
  | 'en'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'es'
  /** Latin American Spanish (CLDR es-419); overrides only the keys that
   *  would read wrong in Spain's wording. */
  | 'es-419';

/** Enabled regional checklist databases. Taiwan (TaiCOL) is the always-on base;
 *  others (Japan/YList, …) are opt-in overlays that widen search/tree/export and
 *  merge vernacular names for shared species. See `~/db/regions`. */
export type RegionCode = 'TW' | 'JP';

export type RecordSort = 'observed' | 'cname' | 'name' | 'family';
/**
 * Specimen sort inside one collection trip.
 *
 * Separate from `RecordSort` rather than an extension of it: a collection is
 * the only place with a collection NUMBER to sort by, and session/plot share
 * `last_record_sort` — adding a key they cannot honour would have them fall
 * through to a default the user did not pick.
 */
export type CollectionSort = 'collected' | 'number' | 'family' | 'name';
export type SortDirection = 'asc' | 'desc';
export type FontScale = 'small' | 'normal' | 'large' | 'xlarge';
export type MapBasemap = 'standard' | 'satellite' | 'hybrid' | 'terrain';
export type PlotTab = 'env' | 'species';
/** Which tab of the plot detail screen was last open, and for which plot.
 *  Scoped to one plot on purpose: a brand-new survey must still open on 環境,
 *  because that is the data it has none of yet. `plotId: 0` = nothing stored. */
export type PlotTabState = { plotId: number; tab: PlotTab };
export type RecordTypeDefault = 'session' | 'plot' | 'collection' | 'ask';
export type AnalysisFormat = 'vegan' | 'juice' | 'dwca';

/** File format(s) the project bundle's research report is written as. */
export type ReportFormat = 'html' | 'docx' | 'both';

export type MapViewState = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
  basemap: MapBasemap;
  /** Selected Academia Sinica (Taiwan)'s WMTS layer id, '' for none */
  sinica_layer: string;
  /** WMTS overlay opacity 0..1 */
  sinica_opacity: number;
  /** Selected NLSC (國土測繪中心) WMTS layer id, '' for none */
  nlsc_layer: string;
  /** NLSC overlay opacity 0..1 */
  nlsc_opacity: number;
};

const DEFAULT_MAP_VIEW: MapViewState = {
  // 臺灣中心略偏北
  latitude: 23.7,
  longitude: 121.0,
  latitudeDelta: 4.5,
  longitudeDelta: 4.5,
  basemap: 'standard',
  sinica_layer: '',
  sinica_opacity: 0.7,
  nlsc_layer: '',
  nlsc_opacity: 0.7,
};

export const FONT_SCALE_VALUE: Record<FontScale, number> = {
  small: 0.9,
  normal: 1.0,
  large: 1.15,
  xlarge: 1.3,
};

/** Per-key runner progress, persisted so re-entering a key resumes where
 *  the user left off (path of visited couplets + current terminal). Shape
 *  intentionally mirrors `RunnerState` in `app/key/[id].tsx`; runner casts
 *  back to its local type after JSON-roundtrip. Capped to the keys still
 *  in `key_recent_ids` (eviction in `pushRecentKey`). */
export type KeyRunnerStateLite = {
  path: number[];
  terminal:
    | null
    | { kind: 'taxon'; taxonId: string; marker: string | null; status: string | null }
    | { kind: 'unresolved'; rawId: string | null };
};

type SettingsValues = {
  theme: Theme;
  undo_duration: number;
  card_density: CardDensity;
  last_search_groups: TaxonGroup[];
  last_record_sort: RecordSort;
  collection_sort: CollectionSort;
  /** Pre-filled into a new specimen's `identified_by`, the way a trip's
   *  collector is inherited. Empty means leave it unset. */
  default_identified_by: string;
  /** GBIF username, remembered so a pack download only re-asks the password. */
  gbif_username: string;
  /** Email GBIF notifies when a pack download is ready ('' = no email). */
  gbif_notify_email: string;
  /** iNaturalist login of the linked account, for display only. The token
   *  itself lives in SecureStore (inatAuth.ts), never here. */
  inat_login: string;
  /** Default geoprivacy for iNaturalist uploads; the upload page can override per batch. */
  inat_geoprivacy: Geoprivacy;
  /** 樣區物種頁的多樣性統計卡展開狀態。 */
  plot_stats_expanded: boolean;
  /** Heading printed at the top of every herbarium label, e.g. "Flora of
   *  Taiwan". Remembered between exports. */
  collection_label_title: string;
  collection_label_family: boolean;
  /** Direction for `last_record_sort`. Observed defaults to 'desc' (latest
   *  on top); other sorts default to 'asc'. Tapping the same sort option a
   *  second time flips this. */
  last_record_sort_dir: SortDirection;
  taxonomy_expanded: string[];
  /** Collapsed project ids in the records tab's byProject view. Stale ids
   *  (deleted projects) are harmless — they just never match a group. */
  records_collapsed: number[];
  /** One-shot: the records list already played its swipe-actions teaser. */
  records_swipe_hint_shown: boolean;
  font_scale: FontScale;
  map_view: MapViewState;
  /** Last plot detail tab, so returning to a survey in progress lands where the
   *  user left it rather than back on 環境 every time. */
  plot_last_tab: PlotTabState;
  record_type_default: RecordTypeDefault;
  /** Collection number (DwC recordNumber) prefix, e.g. 'CTL-'. '' for none. */
  collection_number_prefix: string;
  /** Floor for the collection number series, so an existing career series can
   *  be resumed on a fresh install. The actual next number is
   *  max(highest stored + 1, this). */
  collection_number_start: number;
  /** Zero-pad width for the numeric part of the collection number, e.g. 4 →
   *  'CTL-0001'. 0 disables padding. Only affects numbers generated from now
   *  on — already-issued numbers are physical labels and are never rewritten. */
  collection_number_pad: number;
  /** Recently opened identification key ids (most-recent first, capped 10). */
  key_recent_ids: number[];
  /** Per-key runner state, keyed by `String(keyId)`. Only kept for keys in
   *  `key_recent_ids` — older entries are evicted by `pushRecentKey`. */
  key_runner_states: Record<string, KeyRunnerStateLite>;
  /** Whether to bias AI species identification with current GPS (geomodel
   *  filter). On = predictions skewed to species likely at this location;
   *  off = vision-only. Default on, per user request. */
  ai_geomodel_filter: boolean;
  /** Geo file formats to include in the export bundle. At least one entry is
   *  required; if the list ends up empty after restore we coerce to KML. */
  export_geo_formats: Array<'geojson' | 'gpx' | 'kml'>;
  /** Whether photos referenced by records get packed into the bundle's
   *  `photos/` folder. Off = text-only export (much smaller, faster). */
  export_include_photos: boolean;
  /** Whether to emit a Word (.docx) version of the checklist alongside .md. */
  export_include_docx: boolean;
  /** How Braun-Blanquet codes are numericised in the project export's vegan
   *  matrices ('bb' keeps the raw code; JUICE files always get raw codes). */
  export_matrix_value: MatrixValueMode;
  /** Analysis-format folders the project export produces. */
  export_analysis_formats: AnalysisFormat[];
  /** Whether the project export also emits the per-layer species matrix
   *  (species_matrix_by_layer.csv) alongside the cross-layer merged one. */
  export_matrix_by_layer: boolean;
  /** Whether the project export bundle also carries a research report. */
  export_include_report: boolean;
  /** Which file(s) that report is written as. */
  export_report_format: ReportFormat;
  /** Classification levels to group the exported checklist by. Empty = use each
   *  taxon group's default (vascular = 高階分類群 + 科, birds = 目 + 科, …).
   *  Non-empty = global override, applied in LEVEL_ORDER. */
  export_levels: string[];
  /** Conservation-status columns to include in the exported checklist. */
  export_conservation_fields: ConservationField[];
  /** Enabled regional name databases. Always contains 'TW'; 'JP' is opt-in.
   *  When only ['TW'] the app behaves byte-identically to before this feature. */
  enabled_regions: RegionCode[];
  /** UI language; 'system' follows the device locale. */
  language: Language;
};

const DEFAULTS: SettingsValues = {
  theme: 'auto',
  undo_duration: 5,
  card_density: 'comfortable',
  last_search_groups: [],
  last_record_sort: 'observed',
  // Preserves the order the list had before sorting existed.
  collection_sort: 'collected',
  default_identified_by: '',
  gbif_username: '',
  gbif_notify_email: '',
  inat_login: '',
  inat_geoprivacy: 'open',
  plot_stats_expanded: false,
  collection_label_title: '',
  collection_label_family: false,
  last_record_sort_dir: 'desc',
  taxonomy_expanded: [],
  records_collapsed: [],
  records_swipe_hint_shown: false,
  font_scale: 'normal',
  map_view: DEFAULT_MAP_VIEW,
  plot_last_tab: { plotId: 0, tab: 'env' },
  record_type_default: 'ask',
  collection_number_prefix: '',
  collection_number_start: 1,
  collection_number_pad: 4,
  key_recent_ids: [],
  key_runner_states: {},
  ai_geomodel_filter: true,
  export_geo_formats: ['kml'],
  export_include_photos: true,
  export_include_docx: true,
  export_matrix_value: 'cover',
  export_analysis_formats: ['vegan', 'juice', 'dwca'],
  export_matrix_by_layer: true,
  export_include_report: true,
  export_report_format: 'html',
  export_levels: [],
  export_conservation_fields: ['redlist'],
  enabled_regions: ['TW'],
  language: 'system',
};

type SettingsState = SettingsValues & {
  loaded: boolean;
  load: () => void;
  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
};

function readAll(): SettingsValues {
  const db = getUserDb();
  const res = db.executeSync(`SELECT key, value FROM settings`);
  const rows = (res.rows ?? []) as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  let taxonomyExpanded: string[] = DEFAULTS.taxonomy_expanded;
  const teRaw = map.get('taxonomy_expanded');
  if (teRaw) {
    try {
      const parsed = JSON.parse(teRaw);
      if (Array.isArray(parsed)) taxonomyExpanded = parsed.filter((v) => typeof v === 'string');
    } catch {
      // ignore corrupt setting
    }
  }
  let mapView: MapViewState = DEFAULTS.map_view;
  const mvRaw = map.get('map_view');
  if (mvRaw) {
    try {
      const parsed = JSON.parse(mvRaw);
      if (parsed && typeof parsed === 'object') mapView = { ...DEFAULTS.map_view, ...parsed };
    } catch {
      // ignore corrupt setting
    }
  }
  let plotLastTab: PlotTabState = DEFAULTS.plot_last_tab;
  const pltRaw = map.get('plot_last_tab');
  if (pltRaw) {
    try {
      const parsed = JSON.parse(pltRaw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.plotId === 'number' &&
        (parsed.tab === 'env' || parsed.tab === 'species')
      ) {
        plotLastTab = { plotId: parsed.plotId, tab: parsed.tab };
      }
    } catch {
      // ignore corrupt setting
    }
  }
  let keyRecentIds: number[] = DEFAULTS.key_recent_ids;
  const krRaw = map.get('key_recent_ids');
  if (krRaw) {
    try {
      const parsed = JSON.parse(krRaw);
      if (Array.isArray(parsed)) keyRecentIds = parsed.filter((v) => typeof v === 'number');
    } catch {
      // ignore corrupt setting
    }
  }
  let keyRunnerStates: Record<string, KeyRunnerStateLite> = DEFAULTS.key_runner_states;
  const krsRaw = map.get('key_runner_states');
  if (krsRaw) {
    try {
      const parsed = JSON.parse(krsRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        keyRunnerStates = parsed as Record<string, KeyRunnerStateLite>;
      }
    } catch {
      // ignore corrupt setting
    }
  }
  return {
    theme: (map.get('theme') as Theme) ?? DEFAULTS.theme,
    undo_duration: parseInt(map.get('undo_duration') ?? String(DEFAULTS.undo_duration), 10),
    card_density: (map.get('card_density') as CardDensity) ?? DEFAULTS.card_density,
    last_search_groups: parseSearchGroups(map.get('last_search_groups')),
    last_record_sort: (map.get('last_record_sort') as RecordSort) ?? DEFAULTS.last_record_sort,
    collection_sort: (map.get('collection_sort') as CollectionSort) ?? DEFAULTS.collection_sort,
    default_identified_by:
      map.get('default_identified_by') ?? DEFAULTS.default_identified_by,
    gbif_username: map.get('gbif_username') ?? DEFAULTS.gbif_username,
    gbif_notify_email: map.get('gbif_notify_email') ?? DEFAULTS.gbif_notify_email,
    inat_login: map.get('inat_login') ?? DEFAULTS.inat_login,
    inat_geoprivacy: parseGeoprivacy(map.get('inat_geoprivacy')),
    plot_stats_expanded: map.get('plot_stats_expanded') === 'true',
    collection_label_title:
      map.get('collection_label_title') ?? DEFAULTS.collection_label_title,
    collection_label_family:
      map.get('collection_label_family') == null
        ? DEFAULTS.collection_label_family
        : map.get('collection_label_family') === 'true',
    last_record_sort_dir:
      (map.get('last_record_sort_dir') as SortDirection) ?? DEFAULTS.last_record_sort_dir,
    taxonomy_expanded: taxonomyExpanded,
    records_collapsed: parseNumberArray(map.get('records_collapsed')),
    records_swipe_hint_shown: map.get('records_swipe_hint_shown') === 'true',
    font_scale: (map.get('font_scale') as FontScale) ?? DEFAULTS.font_scale,
    map_view: mapView,
    plot_last_tab: plotLastTab,
    record_type_default:
      (map.get('record_type_default') as RecordTypeDefault) ?? DEFAULTS.record_type_default,
    collection_number_prefix:
      map.get('collection_number_prefix') ?? DEFAULTS.collection_number_prefix,
    collection_number_start:
      Number(map.get('collection_number_start')) || DEFAULTS.collection_number_start,
    // 0 是合法值（不補零），所以不能用 or-fallback —— 那會把 0 換成預設的 4。
    collection_number_pad: (() => {
      const raw = map.get('collection_number_pad');
      const n = Math.floor(Number(raw));
      return raw != null && Number.isFinite(n) && n >= 0 ? n : DEFAULTS.collection_number_pad;
    })(),
    key_recent_ids: keyRecentIds,
    key_runner_states: keyRunnerStates,
    ai_geomodel_filter:
      map.get('ai_geomodel_filter') == null
        ? DEFAULTS.ai_geomodel_filter
        : map.get('ai_geomodel_filter') === 'true',
    export_geo_formats: parseGeoFormats(map.get('export_geo_formats')),
    export_include_photos:
      map.get('export_include_photos') == null
        ? DEFAULTS.export_include_photos
        : map.get('export_include_photos') === 'true',
    export_include_docx:
      map.get('export_include_docx') == null
        ? DEFAULTS.export_include_docx
        : map.get('export_include_docx') === 'true',
    export_matrix_value: parseMatrixValue(map.get('export_matrix_value')),
    export_analysis_formats: parseAnalysisFormats(map.get('export_analysis_formats')),
    export_matrix_by_layer:
      map.get('export_matrix_by_layer') == null
        ? DEFAULTS.export_matrix_by_layer
        : map.get('export_matrix_by_layer') === 'true',
    export_include_report:
      map.get('export_include_report') == null
        ? DEFAULTS.export_include_report
        : map.get('export_include_report') === 'true',
    export_report_format: parseReportFormat(map.get('export_report_format')),
    export_levels: parseLevels(map.get('export_levels')),
    export_conservation_fields: parseConservationFields(map.get('export_conservation_fields')),
    enabled_regions: parseRegions(map.get('enabled_regions')),
    language: parseLanguage(map.get('language')),
  };
}

const LANGUAGE_KEYS = new Set<Language>([
  'system',
  'en',
  'zh-TW',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'es-419',
]);
function parseLanguage(raw: string | undefined): Language {
  return raw != null && LANGUAGE_KEYS.has(raw as Language)
    ? (raw as Language)
    : DEFAULTS.language;
}

const REGION_KEYS = new Set<RegionCode>(['TW', 'JP']);
function parseGeoprivacy(raw: string | undefined): Geoprivacy {
  return (GEOPRIVACY_VALUES as string[]).includes(raw ?? '') ? (raw as Geoprivacy) : DEFAULTS.inat_geoprivacy;
}

function parseRegions(raw: string | undefined): RegionCode[] {
  if (raw == null) return DEFAULTS.enabled_regions;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // TW is a default, not a constant: [] (packs-only) and ['JP'] are valid
      // states since the unified region page. Must stay in sync with
      // regions.ts getEnabledRegions(), which reads the same setting from SQL.
      return parsed.filter(
        (v): v is RegionCode => typeof v === 'string' && REGION_KEYS.has(v as RegionCode),
      );
    }
  } catch {
    // ignore corrupt setting
  }
  return DEFAULTS.enabled_regions;
}

const LEVEL_KEYS = new Set(['kingdom', 'phylum', 'class_name', 'order', 'family', 'genus']);
function parseLevels(raw: string | undefined): string[] {
  if (raw == null) return DEFAULTS.export_levels;
  try {
    const parsed = JSON.parse(raw);
    // Empty array is a valid, meaningful value (= per-group defaults).
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string' && LEVEL_KEYS.has(v));
    }
  } catch {
    // ignore corrupt setting
  }
  return DEFAULTS.export_levels;
}

const CONSERVATION_KEYS = new Set(['redlist', 'iucn_category', 'cites', 'protected']);
function parseConservationFields(raw: string | undefined): ConservationField[] {
  if (raw == null) return DEFAULTS.export_conservation_fields;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (v): v is ConservationField => typeof v === 'string' && CONSERVATION_KEYS.has(v),
      );
    }
  } catch {
    // ignore corrupt setting
  }
  return DEFAULTS.export_conservation_fields;
}

function parseSearchGroups(raw: string | undefined): TaxonGroup[] {
  if (!raw) return DEFAULTS.last_search_groups;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is TaxonGroup => typeof v === 'string');
  } catch {
    // ignore corrupt setting
  }
  return DEFAULTS.last_search_groups;
}

function parseGeoFormats(raw: string | undefined): Array<'geojson' | 'gpx' | 'kml'> {
  if (!raw) return DEFAULTS.export_geo_formats;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const allowed = new Set(['geojson', 'gpx', 'kml']);
      const filtered = parsed.filter((v): v is 'geojson' | 'gpx' | 'kml' =>
        typeof v === 'string' && allowed.has(v),
      );
      if (filtered.length > 0) return filtered;
    }
  } catch {
    // ignore corrupt setting
  }
  return DEFAULTS.export_geo_formats;
}

function parseNumberArray(raw: string | undefined): number[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is number => typeof v === 'number');
  } catch {
    // ignore corrupt setting
  }
  return [];
}

const MATRIX_VALUE_KEYS = new Set<MatrixValueMode>(['bb', 'cover', 'ordinal']);
function parseMatrixValue(raw: string | undefined): MatrixValueMode {
  return raw != null && MATRIX_VALUE_KEYS.has(raw as MatrixValueMode)
    ? (raw as MatrixValueMode)
    : DEFAULTS.export_matrix_value;
}

const REPORT_FORMAT_KEYS = new Set<ReportFormat>(['html', 'docx', 'both']);
function parseReportFormat(raw: string | undefined): ReportFormat {
  return raw != null && REPORT_FORMAT_KEYS.has(raw as ReportFormat)
    ? (raw as ReportFormat)
    : DEFAULTS.export_report_format;
}

const ANALYSIS_FORMAT_KEYS = new Set<AnalysisFormat>(['vegan', 'juice', 'dwca']);
function parseAnalysisFormats(raw: string | undefined): AnalysisFormat[] {
  if (raw == null) return DEFAULTS.export_analysis_formats;
  try {
    const parsed = JSON.parse(raw);
    // Empty array is valid: the user can turn every analysis folder off.
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (v): v is AnalysisFormat => typeof v === 'string' && ANALYSIS_FORMAT_KEYS.has(v as AnalysisFormat),
      );
    }
  } catch {
    // ignore corrupt setting
  }
  return DEFAULTS.export_analysis_formats;
}

/** Push a key id to the most-recent slot. Dedupes + caps at 10. Module-level
 *  helper so non-React entry points (e.g. key/[id].tsx mount effect) can call
 *  it without subscribing to the store. Side effect: drops `key_runner_states`
 *  entries for ids evicted from the recent list, so persistence stays bounded. */
export function pushRecentKey(id: number): void {
  if (!Number.isFinite(id)) return;
  const state = useSettings.getState();
  if (!state.loaded) return; // settings not ready yet; skip rather than overwrite
  const prev = state.key_recent_ids;
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, 10);
  state.set('key_recent_ids', next);
  const evicted = prev.filter((x) => !next.includes(x));
  if (evicted.length === 0) return;
  const states = { ...state.key_runner_states };
  let changed = false;
  for (const evictedId of evicted) {
    const k = String(evictedId);
    if (k in states) {
      delete states[k];
      changed = true;
    }
  }
  if (changed) state.set('key_runner_states', states);
}

/** Read the persisted runner state for a key. Returns null if none or settings
 *  aren't loaded yet. Caller should validate that referenced couplet numbers
 *  still exist before applying (re-imports can renumber couplets). */
export function getKeyRunnerState(keyId: number): KeyRunnerStateLite | null {
  const state = useSettings.getState();
  if (!state.loaded) return null;
  return state.key_runner_states[String(keyId)] ?? null;
}

/** Persist runner state for a key. Idempotent — safe to call on every state
 *  change (sync SQLite write, no debounce needed at this volume). */
export function setKeyRunnerState(keyId: number, runner: KeyRunnerStateLite): void {
  const state = useSettings.getState();
  if (!state.loaded) return;
  const next = { ...state.key_runner_states, [String(keyId)]: runner };
  state.set('key_runner_states', next);
}

function writeOne<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
  const db = getUserDb();
  const serialized =
    Array.isArray(value) || (typeof value === 'object' && value !== null)
      ? JSON.stringify(value)
      : String(value);
  db.executeSync(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, serialized]);
}

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULTS,
  loaded: false,
  load: () => {
    const values = readAll();
    set({ ...values, loaded: true });
  },
  set: (key, value) => {
    writeOne(key, value);
    set({ [key]: value } as Partial<SettingsState>);
  },
}));
