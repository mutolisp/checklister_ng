/**
 * The stored representation of a recorded track: a GeoJSON MultiLineString,
 * JSON-stringified into `plot_surveys.track_geojson` / `sessions.track_geojson`.
 *
 * Split out of `src/db/plots.ts` (which re-exports it) so the import parsers
 * can build the same canonical shape without pulling in the DB — a track
 * rebuilt from a `track.gpx` sidecar must be byte-identical to one the
 * recorder wrote, and two definitions would drift.
 */
export type TrackSegment = [number, number][]; // [[lng, lat], ...]

type MultiLineString = {
  type: 'MultiLineString';
  coordinates: TrackSegment[];
};

/** Parse a stored track into segments. Returns [] if missing/invalid. */
export function parseTrackSegments(geojson: string | null): TrackSegment[] {
  if (!geojson) return [];
  try {
    const obj = JSON.parse(geojson);
    if (obj && obj.type === 'MultiLineString' && Array.isArray(obj.coordinates)) {
      return obj.coordinates as TrackSegment[];
    }
    // Backward-compat: a legacy LineString gets wrapped as one segment.
    if (obj && obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
      return [obj.coordinates as TrackSegment];
    }
  } catch {
    // ignore
  }
  return [];
}

export function buildTrackGeoJSON(segments: TrackSegment[]): string {
  const obj: MultiLineString = { type: 'MultiLineString', coordinates: segments };
  return JSON.stringify(obj);
}
