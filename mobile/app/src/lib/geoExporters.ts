/**
 * GeoJSON / KML / GPX / WKT writers for sites.
 * KML/GPX are built as plain XML strings (no library dep needed for output).
 */
import wellknown from 'wellknown';
import type { GeoJSONGeometry, Site } from '~/db';
import { parseGeometry } from '~/db';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function coordToString(coord: [number, number]): string {
  return `${coord[0]},${coord[1]}`;
}

// ─── GeoJSON ─────────────────────────────────────────────────

export function siteToGeoJSONFeature(site: Site): Record<string, unknown> {
  return {
    type: 'Feature',
    geometry: parseGeometry(site),
    properties: {
      name: site.name,
      description: site.notes ?? '',
      project_id: site.project_id,
      created_at: site.created_at,
      updated_at: site.updated_at,
    },
  };
}

export function sitesToGeoJSON(sites: Site[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: sites.map(siteToGeoJSONFeature),
    },
    null,
    2,
  );
}

// ─── KML ─────────────────────────────────────────────────────

function geometryToKml(g: GeoJSONGeometry, indent = '      '): string {
  switch (g.type) {
    case 'Point': {
      const [lng, lat] = g.coordinates;
      return `${indent}<Point><coordinates>${lng},${lat}</coordinates></Point>`;
    }
    case 'LineString': {
      const coords = g.coordinates.map(coordToString).join(' ');
      return `${indent}<LineString><coordinates>${coords}</coordinates></LineString>`;
    }
    case 'Polygon': {
      const rings = g.coordinates.map((ring, i) => {
        const tag = i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs';
        return `${indent}  <${tag}><LinearRing><coordinates>${ring
          .map(coordToString)
          .join(' ')}</coordinates></LinearRing></${tag}>`;
      });
      return `${indent}<Polygon>\n${rings.join('\n')}\n${indent}</Polygon>`;
    }
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon': {
      const inner = (g.coordinates as unknown[]).map((coords) => {
        const sub = { type: g.type.replace('Multi', ''), coordinates: coords } as GeoJSONGeometry;
        return geometryToKml(sub, indent + '  ');
      });
      return `${indent}<MultiGeometry>\n${inner.join('\n')}\n${indent}</MultiGeometry>`;
    }
  }
}

export function sitesToKML(sites: Site[]): string {
  const placemarks = sites
    .map((s) => {
      const g = parseGeometry(s);
      return [
        '    <Placemark>',
        `      <name>${escapeXml(s.name)}</name>`,
        s.notes ? `      <description>${escapeXml(s.notes)}</description>` : '',
        geometryToKml(g),
        '    </Placemark>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Checklister sites</name>
${placemarks}
  </Document>
</kml>`;
}

// ─── GPX ─────────────────────────────────────────────────────

function geometryToGpx(s: Site, g: GeoJSONGeometry): string {
  const ts = new Date(s.updated_at).toISOString();
  switch (g.type) {
    case 'Point': {
      const [lng, lat] = g.coordinates;
      return `  <wpt lat="${lat}" lon="${lng}">
    <name>${escapeXml(s.name)}</name>
    <time>${ts}</time>${s.notes ? `\n    <desc>${escapeXml(s.notes)}</desc>` : ''}
  </wpt>`;
    }
    case 'MultiPoint':
      return g.coordinates
        .map(([lng, lat], i) => {
          const name = i === 0 ? s.name : `${s.name} #${i + 1}`;
          return `  <wpt lat="${lat}" lon="${lng}">\n    <name>${escapeXml(name)}</name>\n    <time>${ts}</time>\n  </wpt>`;
        })
        .join('\n');
    case 'LineString':
      return `  <trk>
    <name>${escapeXml(s.name)}</name>${s.notes ? `\n    <desc>${escapeXml(s.notes)}</desc>` : ''}
    <trkseg>
${g.coordinates.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('\n')}
    </trkseg>
  </trk>`;
    case 'MultiLineString':
      return `  <trk>
    <name>${escapeXml(s.name)}</name>${s.notes ? `\n    <desc>${escapeXml(s.notes)}</desc>` : ''}
${g.coordinates
  .map(
    (line) =>
      `    <trkseg>\n${line.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('\n')}\n    </trkseg>`,
  )
  .join('\n')}
  </trk>`;
    case 'Polygon':
    case 'MultiPolygon':
      // GPX has no native polygon. Approximate as track of outer ring(s).
      // eslint-disable-next-line no-case-declarations
      const rings =
        g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
      return `  <trk>
    <name>${escapeXml(s.name)} (polygon)</name>${s.notes ? `\n    <desc>${escapeXml(s.notes)}</desc>` : ''}
${rings
  .map(
    (ring) =>
      `    <trkseg>\n${ring.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('\n')}\n    </trkseg>`,
  )
  .join('\n')}
  </trk>`;
  }
}

export function sitesToGPX(sites: Site[]): string {
  const body = sites.map((s) => geometryToGpx(s, parseGeometry(s))).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Checklister" xmlns="http://www.topografix.com/GPX/1/1">
${body}
</gpx>`;
}

// ─── WKT ─────────────────────────────────────────────────────

export function sitesToWKT(sites: Site[]): string {
  return sites
    .map((s) => {
      const wkt = wellknown.stringify(parseGeometry(s) as never);
      return `# ${s.name}\n${wkt}`;
    })
    .join('\n\n');
}
