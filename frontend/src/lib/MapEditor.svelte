<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { Button, Input } from 'flowbite-svelte';
  import { updateGeometries, clearGeometries, projectMetadata } from '$stores/metadataStore';

  export let readonly = false;
  export let height = "600px";

  const dispatch = createEventDispatcher();

  let mapContainer: HTMLDivElement;
  let map: any;
  let drawnItems: any;
  let L: any;

  let searchQuery = "";

  onMount(async () => {
    const leaflet = await import('leaflet');
    L = leaflet.default || leaflet;
    await import('leaflet-draw');

    // 修正 Leaflet marker icon 路徑問題
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    map = L.map(mapContainer).setView([23.5, 121], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    if (!readonly) {
      const drawControl = new L.Control.Draw({
        edit: { featureGroup: drawnItems },
        draw: {
          polygon: true,
          polyline: true,
          rectangle: true,
          circle: false,
          marker: true,
          circlemarker: false,
        }
      });
      map.addControl(drawControl);

      // leaflet-draw 事件名稱用字串（避免 ESM import 問題）
      map.on('draw:created', (event: any) => {
        drawnItems.addLayer(event.layer);
        syncToStore();
      });

      map.on('draw:edited', () => syncToStore());
      map.on('draw:deleted', () => syncToStore());
    }

    // 載入已存在的幾何
    const meta = $projectMetadata;
    if (meta.geometries && meta.geometries.features && meta.geometries.features.length > 0) {
      loadGeoJSON(meta.geometries);
    }
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  function syncToStore() {
    if (!drawnItems) return;
    const geojson = drawnItems.toGeoJSON();
    const wkt = geojsonToWKT(geojson);
    updateGeometries(geojson, wkt);
    dispatch('change', { geojson, wkt });
  }

  function geojsonToWKT(geojson: any): string {
    if (!geojson || !geojson.features || geojson.features.length === 0) return '';

    const wkts = geojson.features.map((f: any) => {
      const g = f.geometry;
      if (g.type === 'Point') {
        return `POINT(${g.coordinates[0]} ${g.coordinates[1]})`;
      } else if (g.type === 'LineString') {
        const coords = g.coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(', ');
        return `LINESTRING(${coords})`;
      } else if (g.type === 'Polygon') {
        const rings = g.coordinates.map((ring: number[][]) =>
          '(' + ring.map((c: number[]) => `${c[0]} ${c[1]}`).join(', ') + ')'
        ).join(', ');
        return `POLYGON(${rings})`;
      }
      return '';
    }).filter(Boolean);

    if (wkts.length === 0) return '';
    if (wkts.length === 1) return wkts[0];
    return `GEOMETRYCOLLECTION(${wkts.join(', ')})`;
  }

  export function loadGeoJSON(geojson: any) {
    if (!L || !drawnItems || !map) return;
    drawnItems.clearLayers();
    try {
      const layer = L.geoJSON(geojson);
      layer.eachLayer((l: any) => drawnItems.addLayer(l));
      if (drawnItems.getLayers().length > 0) {
        map.fitBounds(drawnItems.getBounds(), { padding: [20, 20] });
      }
    } catch (e) {
      console.error('Failed to load GeoJSON:', e);
    }
  }

  export function loadWKT(wkt: string) {
    if (!wkt || !L) return;
    try {
      // 簡易 WKT → GeoJSON 轉換（用 terraformer）
      import('terraformer-wkt-parser').then(({ parse }) => {
        const geom = parse(wkt);
        const geojson = {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: geom, properties: {} }]
        };
        loadGeoJSON(geojson);
        syncToStore();
      });
    } catch (e) {
      console.error('Failed to parse WKT:', e);
    }
  }

  export async function importFile(file: File) {
    const text = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'gpx' || ext === 'kml') {
      const { gpx, kml } = await import('@tmcw/togeojson');
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const geojson = ext === 'gpx' ? gpx(doc) : kml(doc);
      loadGeoJSON(geojson);
      syncToStore();
    } else if (ext === 'wkt' || ext === 'txt') {
      loadWKT(text.trim());
    } else if (ext === 'geojson' || ext === 'json') {
      const geojson = JSON.parse(text);
      loadGeoJSON(geojson);
      syncToStore();
    }
  }

  export function exportGeoJSON(): string {
    if (!drawnItems) return '';
    return JSON.stringify(drawnItems.toGeoJSON(), null, 2);
  }

  export function exportWKT(): string {
    if (!drawnItems) return '';
    return geojsonToWKT(drawnItems.toGeoJSON());
  }

  export async function exportGPX(): Promise<string> {
    if (!drawnItems) return '';
    const togpx = (await import('togpx')).default;
    return togpx(drawnItems.toGeoJSON());
  }

  export async function exportKML(): Promise<string> {
    if (!drawnItems) return '';
    const tokml = (await import('tokml')).default;
    return tokml(drawnItems.toGeoJSON());
  }

  export function clearAll() {
    if (drawnItems) drawnItems.clearLayers();
    clearGeometries();
  }

  async function searchLocation() {
    if (!searchQuery.trim() || !map) return;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
    const results = await res.json();
    if (results.length > 0) {
      map.setView([parseFloat(results[0].lat), parseFloat(results[0].lon)], 14);
    }
  }
</script>

<style>
  @import 'leaflet/dist/leaflet.css';
  @import 'leaflet-draw/dist/leaflet.draw.css';
</style>

{#if !readonly}
<div class="flex gap-2 mb-2">
  <Input size="sm" bind:value={searchQuery} placeholder="搜尋地點..." class="flex-1" on:keydown={(e) => e.key === 'Enter' && searchLocation()} />
  <Button size="sm" color="alternative" on:click={searchLocation}>搜尋</Button>
</div>
{/if}

<div bind:this={mapContainer} style="height: {height}" class="w-full rounded shadow border"></div>
