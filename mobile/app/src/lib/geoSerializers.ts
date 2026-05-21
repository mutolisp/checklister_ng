/**
 * Minimal hand-written GeoJSON → GPX / KML serializers.
 *
 * Supports: Point, LineString, MultiLineString, Polygon (with optional
 * properties.name, properties.description), and FeatureCollection of those.
 * Throws on unsupported geometry types so the caller knows to fall back to
 * GeoJSON-only output.
 *
 * Why hand-written: `togpx` / `tokml` each pull ~100KB+ for features we don't
 * use. Our shape is small enough that 100 lines of TS beats a dependency.
 */

type Position = [number, number] | [number, number, number];

type PointGeom = { type: 'Point'; coordinates: Position };
type LineStringGeom = { type: 'LineString'; coordinates: Position[] };
type MultiLineStringGeom = { type: 'MultiLineString'; coordinates: Position[][] };
type PolygonGeom = { type: 'Polygon'; coordinates: Position[][] };
type Geometry = PointGeom | LineStringGeom | MultiLineStringGeom | PolygonGeom;

type Feature = {
  type: 'Feature';
  geometry: Geometry | null;
  properties?: Record<string, unknown> | null;
};

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
};

export type SupportedGeoJson = Feature | FeatureCollection | Geometry;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asFeatures(input: SupportedGeoJson): Feature[] {
  if ((input as FeatureCollection).type === 'FeatureCollection') {
    return (input as FeatureCollection).features;
  }
  if ((input as Feature).type === 'Feature') {
    return [input as Feature];
  }
  // Bare geometry — wrap as anonymous feature.
  return [{ type: 'Feature', geometry: input as Geometry, properties: null }];
}

function nameOf(f: Feature, fallback: string): string {
  const n = (f.properties?.name as string) ?? '';
  return n || fallback;
}
function descOf(f: Feature): string {
  return (f.properties?.description as string) ?? '';
}

// ---- GPX 1.1 ---------------------------------------------------------------

const GPX_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Checklister-NG">`;
const GPX_FOOTER = `</gpx>`;

function gpxWpt(lon: number, lat: number, ele: number | undefined, name: string, desc: string): string {
  const parts = [`<wpt lat="${lat}" lon="${lon}">`];
  if (ele !== undefined) parts.push(`<ele>${ele}</ele>`);
  if (name) parts.push(`<name>${escapeXml(name)}</name>`);
  if (desc) parts.push(`<desc>${escapeXml(desc)}</desc>`);
  parts.push(`</wpt>`);
  return parts.join('');
}

function gpxTrkseg(coords: Position[]): string {
  const pts = coords
    .map(([lon, lat, ele]) => {
      const e = ele !== undefined ? `<ele>${ele}</ele>` : '';
      return `<trkpt lat="${lat}" lon="${lon}">${e}</trkpt>`;
    })
    .join('');
  return `<trkseg>${pts}</trkseg>`;
}

export function geoJsonToGpx(geo: SupportedGeoJson): string {
  const features = asFeatures(geo);
  const body: string[] = [];
  let trkCount = 0;

  features.forEach((f, idx) => {
    if (!f.geometry) return;
    const g = f.geometry;
    const name = nameOf(f, `feature-${idx + 1}`);
    const desc = descOf(f);

    if (g.type === 'Point') {
      const [lon, lat, ele] = g.coordinates;
      body.push(gpxWpt(lon, lat, ele, name, desc));
      return;
    }
    if (g.type === 'LineString') {
      trkCount += 1;
      const trkName = name || `track-${trkCount}`;
      body.push(
        `<trk><name>${escapeXml(trkName)}</name>${desc ? `<desc>${escapeXml(desc)}</desc>` : ''}${gpxTrkseg(g.coordinates)}</trk>`,
      );
      return;
    }
    if (g.type === 'MultiLineString') {
      trkCount += 1;
      const trkName = name || `track-${trkCount}`;
      const segs = g.coordinates.map(gpxTrkseg).join('');
      body.push(
        `<trk><name>${escapeXml(trkName)}</name>${desc ? `<desc>${escapeXml(desc)}</desc>` : ''}${segs}</trk>`,
      );
      return;
    }
    if (g.type === 'Polygon') {
      // GPX has no polygon — emit the outer ring as a closed track.
      trkCount += 1;
      const trkName = name || `polygon-${trkCount}`;
      const outer = g.coordinates[0] ?? [];
      const closed: Position[] = outer.length > 0 && outer[0] !== outer[outer.length - 1]
        ? [...outer, outer[0]]
        : outer;
      body.push(
        `<trk><name>${escapeXml(trkName)}</name>${desc ? `<desc>${escapeXml(desc)}</desc>` : ''}${gpxTrkseg(closed)}</trk>`,
      );
      return;
    }
    throw new Error(`Unsupported geometry for GPX: ${(g as Geometry).type}`);
  });

  return `${GPX_HEADER}\n${body.join('\n')}\n${GPX_FOOTER}`;
}

// ---- KML 2.2 ---------------------------------------------------------------

const KML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>`;
const KML_FOOTER = `</Document></kml>`;

function kmlCoords(coords: Position[]): string {
  return coords.map((p) => p.join(',')).join(' ');
}

function kmlPlacemark(name: string, desc: string, geomXml: string): string {
  return `<Placemark><name>${escapeXml(name)}</name>${desc ? `<description>${escapeXml(desc)}</description>` : ''}${geomXml}</Placemark>`;
}

export function geoJsonToKml(geo: SupportedGeoJson): string {
  const features = asFeatures(geo);
  const body: string[] = [];

  features.forEach((f, idx) => {
    if (!f.geometry) return;
    const g = f.geometry;
    const name = nameOf(f, `feature-${idx + 1}`);
    const desc = descOf(f);

    if (g.type === 'Point') {
      body.push(
        kmlPlacemark(name, desc, `<Point><coordinates>${g.coordinates.join(',')}</coordinates></Point>`),
      );
      return;
    }
    if (g.type === 'LineString') {
      body.push(
        kmlPlacemark(
          name,
          desc,
          `<LineString><coordinates>${kmlCoords(g.coordinates)}</coordinates></LineString>`,
        ),
      );
      return;
    }
    if (g.type === 'MultiLineString') {
      const segs = g.coordinates
        .map((seg) => `<LineString><coordinates>${kmlCoords(seg)}</coordinates></LineString>`)
        .join('');
      body.push(kmlPlacemark(name, desc, `<MultiGeometry>${segs}</MultiGeometry>`));
      return;
    }
    if (g.type === 'Polygon') {
      const rings = g.coordinates;
      const outer = rings[0] ?? [];
      const inner = rings.slice(1);
      const outerXml = `<outerBoundaryIs><LinearRing><coordinates>${kmlCoords(outer)}</coordinates></LinearRing></outerBoundaryIs>`;
      const innerXml = inner
        .map(
          (ring) =>
            `<innerBoundaryIs><LinearRing><coordinates>${kmlCoords(ring)}</coordinates></LinearRing></innerBoundaryIs>`,
        )
        .join('');
      body.push(kmlPlacemark(name, desc, `<Polygon>${outerXml}${innerXml}</Polygon>`));
      return;
    }
    throw new Error(`Unsupported geometry for KML: ${(g as Geometry).type}`);
  });

  return `${KML_HEADER}\n${body.join('\n')}\n${KML_FOOTER}`;
}
