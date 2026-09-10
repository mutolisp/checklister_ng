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

/** Haversine length in meters; sums per-segment distances. */
export function trackLengthMeters(segments: TrackSegment[]): number {
  let total = 0;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const [lng1, lat1] = seg[i - 1];
      const [lng2, lat2] = seg[i];
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      total += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }
  }
  return total;
}
