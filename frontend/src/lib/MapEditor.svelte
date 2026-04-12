<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { Button, Input } from 'flowbite-svelte';
  import { browser } from '$app/environment';
  import { updateGeometries, clearGeometries, projectMetadata } from '$stores/metadataStore';

  export let readonly = false;
  export let height = "600px";

  const dispatch = createEventDispatcher();

  let mapContainer: HTMLDivElement;
  let map: any;
  let drawnItems: any;
  let L: any;
  let currentBaseLayer: any;
  let sinicaOverlay: any = null;

  let searchQuery = "";

  import { SINICA_LAYERS } from '$lib/sinicaLayers';

  // 中研院 WMTS 圖層清單（靜態 pre-built，不需 runtime fetch）
  export let sinicaLayers: { id: string; title: string }[] = SINICA_LAYERS;

  onMount(async () => {
    const leaflet = await import('leaflet');
    L = leaflet.default || leaflet;
    await import('leaflet-draw');

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    // 從 localStorage 恢復 view state
    const savedView = browser ? localStorage.getItem('map_view') : null;
    const viewState = savedView ? JSON.parse(savedView) : null;
    const initCenter = viewState?.center || [23.5, 121];
    const initZoom = viewState?.zoom || 7;

    map = L.map(mapContainer, { zoomControl: false }).setView(initCenter, initZoom);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 底圖（從 cache 恢復或預設 OSM）
    const savedBasemap = viewState?.basemap || 'osm';
    switchBaseLayer(savedBasemap);

    // 中研院疊圖恢復
    if (viewState?.sinicaLayer) {
      setSinicaOverlay(viewState.sinicaLayer);
      if (viewState.sinicaOpacity != null) setSinicaOpacity(viewState.sinicaOpacity);
    }

    // 儲存 view state on move/zoom
    map.on('moveend', saveViewState);
    map.on('zoomend', saveViewState);

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

  // 當前底圖/疊圖 ID（用於 save/restore）
  let _currentBasemapType = 'osm';
  let _currentSinicaId = '';
  let _currentSinicaOpacity = 0.7;

  function saveViewState() {
    if (!browser || !map) return;
    const center = map.getCenter();
    localStorage.setItem('map_view', JSON.stringify({
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
      basemap: _currentBasemapType,
      sinicaLayer: _currentSinicaId,
      sinicaOpacity: _currentSinicaOpacity,
    }));
  }

  export function switchBaseLayer(type: string) {
    if (!map || !L) return;
    if (currentBaseLayer) map.removeLayer(currentBaseLayer);
    _currentBasemapType = type;

    if (type === 'osm') {
      currentBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      });
    } else if (type === 'satellite') {
      currentBaseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar'
      });
    } else if (type === 'hybrid') {
      const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar'
      });
      const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}');
      currentBaseLayer = L.layerGroup([imagery, labels]);
    }
    if (currentBaseLayer) currentBaseLayer.addTo(map);
    saveViewState();
  }

  export function setSinicaOverlay(layerId: string) {
    if (!map || !L) return;
    if (sinicaOverlay) { map.removeLayer(sinicaOverlay); sinicaOverlay = null; }
    if (!layerId) { _currentSinicaId = ''; saveViewState(); return; }
    _currentSinicaId = layerId;
    sinicaOverlay = L.tileLayer(
      `https://gis.sinica.edu.tw/tileserver/file-exists.php?img=${layerId}-png-{z}-{x}-{y}`,
      { attribution: '&copy; 中央研究院 GIS', opacity: _currentSinicaOpacity }
    );
    sinicaOverlay.addTo(map);
    saveViewState();
  }

  export function setSinicaOpacity(opacity: number) {
    _currentSinicaOpacity = opacity;
    if (sinicaOverlay) sinicaOverlay.setOpacity(opacity);
    saveViewState();
  }

  export function removeSinicaOverlay() {
    if (sinicaOverlay && map) { map.removeLayer(sinicaOverlay); sinicaOverlay = null; }
    _currentSinicaId = '';
    saveViewState();
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
<div class="absolute top-2 left-12 z-[1000] flex gap-2">
  <Input size="sm" bind:value={searchQuery} placeholder="搜尋地點..." class="w-48 bg-white/90 shadow" on:keydown={(e) => e.key === 'Enter' && searchLocation()} />
  <Button size="xs" color="alternative" on:click={searchLocation} class="shadow">搜尋</Button>
</div>
{/if}

<div bind:this={mapContainer} style="height: {height}" class="w-full"></div>
