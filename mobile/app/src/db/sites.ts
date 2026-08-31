import { getUserDb } from './init';

export type SiteGeometryType =
  | 'Point'
  | 'LineString'
  | 'Polygon'
  | 'MultiPoint'
  | 'MultiLineString'
  | 'MultiPolygon';

export type Site = {
  id: number;
  project_id: number;
  session_id: number | null;
  name: string;
  geometry_type: SiteGeometryType;
  geometry_geojson: string;
  color: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type SiteWithProject = Site & {
  project_name: string;
};

/** Single point: [lng, lat] */
export type PointCoords = [number, number];
/** LineString / Polygon ring: array of [lng, lat] */
export type LineCoords = PointCoords[];
/** Polygon outer ring: first point repeated at end */
export type PolygonCoords = LineCoords[];

export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: PointCoords }
  | { type: 'LineString'; coordinates: LineCoords }
  | { type: 'Polygon'; coordinates: PolygonCoords }
  | { type: 'MultiPoint'; coordinates: PointCoords[] }
  | { type: 'MultiLineString'; coordinates: LineCoords[] }
  | { type: 'MultiPolygon'; coordinates: PolygonCoords[] };

export type CreateSiteInput = {
  project_id?: number;
  session_id?: number | null;
  name: string;
  geometry: GeoJSONGeometry;
  color?: string | null;
  notes?: string | null;
};

export function createSite(input: CreateSiteInput): number {
  const db = getUserDb();
  const now = Date.now();
  const res = db.executeSync(
    `INSERT INTO sites (project_id, session_id, name, geometry_type, geometry_geojson, color, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.project_id ?? 0,
      input.session_id ?? null,
      input.name,
      input.geometry.type,
      JSON.stringify(input.geometry),
      input.color ?? null,
      input.notes ?? null,
      now,
      now,
    ],
  );
  return res.insertId ?? 0;
}

export function getSite(id: number): Site | null {
  const db = getUserDb();
  const res = db.executeSync(`SELECT * FROM sites WHERE id = ?`, [id]);
  const rows = (res.rows ?? []) as unknown as Site[];
  return rows[0] ?? null;
}

export function listSites(): SiteWithProject[] {
  const db = getUserDb();
  const res = db.executeSync(`
    SELECT s.*, p.name AS project_name
    FROM sites s
    -- LEFT JOIN：project_id 可能是 0（未分類）或指向已刪除的計畫，
    -- inner join 會讓那些樣點整個從清單消失。與 listPlotSurveysWithMeta 一致。
    LEFT JOIN projects p ON p.id = s.project_id
    ORDER BY s.updated_at DESC
  `);
  return ((res.rows ?? []) as unknown) as SiteWithProject[];
}

export function listSitesByProject(projectId: number): Site[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM sites WHERE project_id = ? ORDER BY updated_at DESC`,
    [projectId],
  );
  return ((res.rows ?? []) as unknown) as Site[];
}

export function updateSite(
  id: number,
  updates: Partial<Pick<Site, 'name' | 'project_id' | 'session_id' | 'color' | 'notes' | 'geometry_geojson' | 'geometry_type'>>,
): void {
  const db = getUserDb();
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    params.push(v as string | number | null);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  params.push(Date.now(), id);
  db.executeSync(`UPDATE sites SET ${fields.join(', ')} WHERE id = ?`, params);
}

export function deleteSite(id: number): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM sites WHERE id = ?`, [id]);
}

/**
 * Drop a site only when nothing points at it any more.
 *
 * Used by record import: re-importing the same record over itself creates a
 * fresh site row, so the one the previous copy was bound to would pile up on
 * every re-import. It may however be a site the user drew and shares with
 * other records, so check all three references before deleting.
 */
export function deleteSiteIfUnreferenced(id: number): void {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT
       (SELECT COUNT(*) FROM sessions WHERE site_id = ?) +
       (SELECT COUNT(*) FROM plot_surveys WHERE site_id = ?) +
       (SELECT COUNT(*) FROM sites WHERE id = ? AND session_id IS NOT NULL) AS refs`,
    [id, id, id],
  );
  const refs = Number((res.rows?.[0] as { refs?: number } | undefined)?.refs ?? 0);
  if (refs === 0) deleteSite(id);
}

/** A site as carried by an exported record yml (`site:` block). Geometry is a
 *  GeoJSON object, not the stringified DB column. */
export type ImportedSite = {
  name: string;
  notes: string | null;
  geometry: GeoJSONGeometry;
};

/** Flatten any GeoJSON geometry (including Multi*) into a list of [lng, lat] points. */
function flattenPoints(g: GeoJSONGeometry): PointCoords[] {
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'MultiPoint':
      return g.coordinates;
    case 'LineString':
      return g.coordinates;
    case 'MultiLineString':
      return g.coordinates.flat();
    case 'Polygon':
      return g.coordinates.flat();
    case 'MultiPolygon':
      return g.coordinates.flat(2) as PointCoords[];
  }
}

/** Compute a region (lat/lng + delta) that fits the given geometry. */
export function geometryBounds(g: GeoJSONGeometry): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} {
  const points = flattenPoints(g);
  if (points.length === 0) {
    return { latitude: 23.7, longitude: 121.0, latitudeDelta: 4.5, longitudeDelta: 4.5 };
  }
  let minLat = points[0][1],
    maxLat = points[0][1],
    minLng = points[0][0],
    maxLng = points[0][0];
  for (const [lng, lat] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const latDelta = Math.max(0.005, (maxLat - minLat) * 1.4);
  const lngDelta = Math.max(0.005, (maxLng - minLng) * 1.4);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

export function parseGeometry(s: Site): GeoJSONGeometry {
  return JSON.parse(s.geometry_geojson) as GeoJSONGeometry;
}

/**
 * Render-ready primitive shape derived from a GeoJSON geometry.
 * Multi* types expand to multiple primitives; useful because react-native-maps
 * has no native Multi* components — caller must loop over these to render.
 */
export type RenderPrimitive =
  | { kind: 'point'; latitude: number; longitude: number }
  | { kind: 'line'; coords: Array<{ latitude: number; longitude: number }> }
  | { kind: 'polygon'; coords: Array<{ latitude: number; longitude: number }> };

const toLatLng = ([lng, lat]: PointCoords) => ({ latitude: lat, longitude: lng });

export function geometryToPrimitives(g: GeoJSONGeometry): RenderPrimitive[] {
  switch (g.type) {
    case 'Point': {
      const [lng, lat] = g.coordinates;
      return [{ kind: 'point', latitude: lat, longitude: lng }];
    }
    case 'MultiPoint':
      return g.coordinates.map(([lng, lat]) => ({ kind: 'point', latitude: lat, longitude: lng }));
    case 'LineString':
      return [{ kind: 'line', coords: g.coordinates.map(toLatLng) }];
    case 'MultiLineString':
      return g.coordinates.map((line) => ({ kind: 'line', coords: line.map(toLatLng) }));
    case 'Polygon':
      // Outer ring only (rendering); holes ignored for MVP.
      return [{ kind: 'polygon', coords: g.coordinates[0]?.map(toLatLng) ?? [] }];
    case 'MultiPolygon':
      return g.coordinates.map((poly) => ({ kind: 'polygon', coords: poly[0]?.map(toLatLng) ?? [] }));
  }
}
