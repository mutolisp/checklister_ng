/**
 * GeoJSON / KML / GPX / WKT parsers.
 * Returns one or more `ImportedGeometry` items per source file.
 *
 * Handles Multi* by either keeping the geometry as Multi (preferred for
 * one-to-one site mapping) or splitting into multiple sites (caller decides).
 */
import { DOMParser } from '@xmldom/xmldom';
import { kml as togeojsonKml, gpx as togeojsonGpx } from '@tmcw/togeojson';
import wellknown from 'wellknown';
import type { GeoJSONGeometry, SiteGeometryType } from '~/db';

export type ImportedGeometry = {
  geometry: GeoJSONGeometry;
  /** Source-provided name if any (KML Placemark, GPX wpt, etc.) */
  name?: string;
  /** Source-provided notes / description */
  notes?: string;
};

export type GeoFormat = 'geojson' | 'kml' | 'gpx' | 'wkt';

/** Detect format by content sniffing + extension hint. */
export function detectFormat(text: string, filename?: string): GeoFormat | null {
  const trimmed = text.trim();
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return 'geojson';
  if (lower.endsWith('.kml')) return 'kml';
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.wkt') || lower.endsWith('.txt')) return 'wkt';

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'geojson';
  if (/^<\?xml/i.test(trimmed) || /<kml[\s>]/i.test(trimmed)) return 'kml';
  if (/<gpx[\s>]/i.test(trimmed)) return 'gpx';
  if (/^\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*\(/i.test(trimmed)) return 'wkt';
  return null;
}

const SUPPORTED_TYPES: ReadonlySet<SiteGeometryType> = new Set([
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
]);

function isSupportedGeometry(g: unknown): g is GeoJSONGeometry {
  if (!g || typeof g !== 'object') return false;
  const obj = g as { type?: unknown; coordinates?: unknown };
  if (typeof obj.type !== 'string') return false;
  return SUPPORTED_TYPES.has(obj.type as SiteGeometryType) && obj.coordinates !== undefined;
}

function flattenGeometryCollection(g: unknown): GeoJSONGeometry[] {
  if (!g || typeof g !== 'object') return [];
  const obj = g as { type?: unknown; geometries?: unknown };
  if (obj.type === 'GeometryCollection' && Array.isArray(obj.geometries)) {
    return obj.geometries.flatMap(flattenGeometryCollection);
  }
  return isSupportedGeometry(g) ? [g] : [];
}

function parseFeatureCollection(json: unknown): ImportedGeometry[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as { type?: unknown; features?: unknown; geometry?: unknown; properties?: unknown };

  // Single Feature
  if (obj.type === 'Feature' && obj.geometry) {
    const props = (obj.properties as Record<string, unknown>) || {};
    const items: ImportedGeometry[] = [];
    for (const g of flattenGeometryCollection(obj.geometry)) {
      items.push({
        geometry: g,
        name: typeof props.name === 'string' ? props.name : undefined,
        notes:
          typeof props.description === 'string'
            ? props.description
            : typeof props.notes === 'string'
              ? props.notes
              : undefined,
      });
    }
    return items;
  }

  // FeatureCollection
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return obj.features.flatMap(parseFeatureCollection);
  }

  // Bare geometry
  if (isSupportedGeometry(json)) {
    return [{ geometry: json }];
  }

  // GeometryCollection at top level
  return flattenGeometryCollection(json).map((geometry) => ({ geometry }));
}

export function parseGeoJSON(text: string): ImportedGeometry[] {
  const parsed = JSON.parse(text);
  return parseFeatureCollection(parsed);
}

export function parseKML(text: string): ImportedGeometry[] {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const geojson = togeojsonKml(doc as unknown as Document);
  return parseFeatureCollection(geojson);
}

export function parseGPX(text: string): ImportedGeometry[] {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const geojson = togeojsonGpx(doc as unknown as Document);
  return parseFeatureCollection(geojson);
}

export function parseWKT(text: string): ImportedGeometry[] {
  // WKT files may contain multiple WKT strings separated by newlines/semicolons.
  const tokens = text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: ImportedGeometry[] = [];
  for (const tok of tokens) {
    const g = wellknown.parse(tok);
    if (g && isSupportedGeometry(g)) out.push({ geometry: g });
  }
  return out;
}

export function parseGeoFile(text: string, format: GeoFormat): ImportedGeometry[] {
  switch (format) {
    case 'geojson':
      return parseGeoJSON(text);
    case 'kml':
      return parseKML(text);
    case 'gpx':
      return parseGPX(text);
    case 'wkt':
      return parseWKT(text);
  }
}
