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
  };
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
