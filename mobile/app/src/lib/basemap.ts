/**
 * Shared basemap helpers. The main map screen (`app/(tabs)/map.tsx`) keeps its
 * own copy with a `terrain` option + icons; this lightweight version is for the
 * inline record-location editor, whose basemap toggle cycles only
 * standard → satellite → hybrid (terrain rarely useful for a single point).
 */
import type { MapType } from 'react-native-maps';
import type { MapBasemap } from '~/stores/settings';

export function basemapToMapType(b: MapBasemap): MapType {
  switch (b) {
    case 'satellite':
      return 'satellite';
    case 'hybrid':
      return 'hybrid';
    case 'terrain':
      return 'terrain';
    default:
      return 'standard';
  }
}

/** Cycle order for the inline location editor's basemap toggle (no terrain). */
export const BASEMAP_CYCLE: MapBasemap[] = ['standard', 'satellite', 'hybrid'];

export function nextBasemap(b: MapBasemap): MapBasemap {
  const i = BASEMAP_CYCLE.indexOf(b);
  return BASEMAP_CYCLE[(i + 1) % BASEMAP_CYCLE.length] ?? 'standard';
}

/** i18n key for a basemap's display label (reuses the main map's keys). */
export const BASEMAP_LABEL_KEY: Record<MapBasemap, string> = {
  standard: 'map.basemapStandard',
  satellite: 'map.basemapSatellite',
  hybrid: 'map.basemapHybrid',
  terrain: 'map.basemapTerrain',
};
