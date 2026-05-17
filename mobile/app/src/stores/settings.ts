import { create } from 'zustand';
import { getUserDb } from '~/db';
import type { TaxonGroup } from '~/db/types';

export type Theme = 'light' | 'dark' | 'auto';
export type CardDensity = 'compact' | 'comfortable';

export type RecordSort = 'observed' | 'cname' | 'name' | 'family';
export type FontScale = 'small' | 'normal' | 'large' | 'xlarge';
export type MapBasemap = 'standard' | 'satellite' | 'hybrid' | 'terrain';
export type RecordTypeDefault = 'session' | 'plot' | 'ask';

export type MapViewState = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
  basemap: MapBasemap;
  /** Selected 中研院 WMTS layer id, '' for none */
  sinica_layer: string;
  /** WMTS overlay opacity 0..1 */
  sinica_opacity: number;
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
  last_search_group: TaxonGroup | '';
  last_record_sort: RecordSort;
  taxonomy_expanded: string[];
  font_scale: FontScale;
  map_view: MapViewState;
  record_type_default: RecordTypeDefault;
  /** Recently opened identification key ids (most-recent first, capped 10). */
  key_recent_ids: number[];
  /** Per-key runner state, keyed by `String(keyId)`. Only kept for keys in
   *  `key_recent_ids` — older entries are evicted by `pushRecentKey`. */
  key_runner_states: Record<string, KeyRunnerStateLite>;
  /** Whether to bias AI species identification with current GPS (geomodel
   *  filter). On = predictions skewed to species likely at this location;
   *  off = vision-only. Default on, per user request. */
  ai_geomodel_filter: boolean;
};

const DEFAULTS: SettingsValues = {
  theme: 'auto',
  undo_duration: 5,
  card_density: 'comfortable',
  last_search_group: '',
  last_record_sort: 'observed',
  taxonomy_expanded: [],
  font_scale: 'normal',
  map_view: DEFAULT_MAP_VIEW,
  record_type_default: 'ask',
  key_recent_ids: [],
  key_runner_states: {},
  ai_geomodel_filter: true,
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
    last_search_group: (map.get('last_search_group') as TaxonGroup | '') ?? DEFAULTS.last_search_group,
    last_record_sort: (map.get('last_record_sort') as RecordSort) ?? DEFAULTS.last_record_sort,
    taxonomy_expanded: taxonomyExpanded,
    font_scale: (map.get('font_scale') as FontScale) ?? DEFAULTS.font_scale,
    map_view: mapView,
    record_type_default:
      (map.get('record_type_default') as RecordTypeDefault) ?? DEFAULTS.record_type_default,
    key_recent_ids: keyRecentIds,
    key_runner_states: keyRunnerStates,
    ai_geomodel_filter:
      map.get('ai_geomodel_filter') == null
        ? DEFAULTS.ai_geomodel_filter
        : map.get('ai_geomodel_filter') === 'true',
  };
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
