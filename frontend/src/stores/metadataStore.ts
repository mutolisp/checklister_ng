import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface ProjectMetadata {
  projectName: string;
  siteName: string;
  footprintWKT: string;
  geometries: any; // GeoJSON FeatureCollection
}

const defaultMetadata: ProjectMetadata = {
  projectName: '',
  siteName: '',
  footprintWKT: '',
  geometries: { type: 'FeatureCollection', features: [] },
};

// 從 localStorage 載入
const stored = browser ? localStorage.getItem('projectMetadata') : null;
const initial: ProjectMetadata = stored ? { ...defaultMetadata, ...JSON.parse(stored) } : defaultMetadata;

export const projectMetadata = writable<ProjectMetadata>(initial);

// 自動存入 localStorage
projectMetadata.subscribe((value) => {
  if (browser) {
    localStorage.setItem('projectMetadata', JSON.stringify(value));
  }
});

// 便利函式
export function updateGeometries(geojson: any, wkt: string) {
  projectMetadata.update(m => ({
    ...m,
    geometries: geojson,
    footprintWKT: wkt,
  }));
}

export function clearGeometries() {
  projectMetadata.update(m => ({
    ...m,
    geometries: { type: 'FeatureCollection', features: [] },
    footprintWKT: '',
  }));
}

// 向下相容
export const footprintWKT = {
  subscribe: (fn: any) => projectMetadata.subscribe(m => fn(m.footprintWKT)),
};
