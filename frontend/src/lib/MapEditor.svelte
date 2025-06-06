<script lang="ts">
  import { onMount } from 'svelte';
  import { footprintWKT } from '$stores/metadataStore';
  import { get } from 'svelte/store';

  let mapContainer: HTMLDivElement;
  let map: any;
  let currentWKT = "";

  $: footprintWKT.subscribe(value => currentWKT = value);

  onMount(async () => {
    // ✅ 動態載入 Leaflet 相關模組
    const L = await import('leaflet');
    await import('leaflet-draw');

    // ✅ 建立地圖
    map = L.map(mapContainer).setView([23.5, 121], 7);

    // ✅ 使用你指定的魯地圖 xyz tile
    //L.tileLayer('http://rudy.tile.basecamp.tw/{z}/{x}/{y}.png', {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; Basecamp.tw Rudy Map'
    }).addTo(map);

    // ✅ 初始化圖層群組
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // ✅ 建立繪圖工具
    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawnItems },
      draw: {
        polygon: true,
        polyline: true,
        rectangle: true,
        circle: false,
        marker: true,
        circlemarker: false
      }
    });
    map.addControl(drawControl);

    // ✅ 當繪製完成時事件處理
    map.on(L.Draw.Event.CREATED, function (event: any) {
      //drawnItems.clearLayers();
      const layer = event.layer;

      // ✅ 加到地圖圖層中
      
      drawnItems.addLayer(layer);

      // ✅ 轉成 WKT
      const wkt = geometryToWKT(layer);
      footprintWKT.set(wkt);
    });

    function geometryToWKT(layer: any): string {
      if (layer instanceof L.Marker) {
        const { lat, lng } = layer.getLatLng();
        return `POINT(${lng} ${lat})`;
      } else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        const latlngs = layer.getLatLngs();
        const coords = latlngs.map((p: any) => `${p.lng} ${p.lat}`).join(', ');
        return `LINESTRING(${coords})`;
      } else {
        const latlngs = layer.getLatLngs()[0]; // polygon only outer ring
        const coords = latlngs.map((p: any) => `${p.lng} ${p.lat}`);
        // 確保閉環
        if (coords[0] !== coords[coords.length - 1]) coords.push(coords[0]);
        return `POLYGON((${coords.join(', ')}))`;
      }
    }
  });

  let searchQuery = "";
  async function searchLocation() {
  if (!searchQuery.trim()) return;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
  const results = await res.json();
  if (results.length > 0) {
    const { lat, lon } = results[0];
    map.setView([parseFloat(lat), parseFloat(lon)], 14); // zoom in
  }
}
  async function saveGeometry() {
    if (!currentWKT) {
      alert("No geometry to save!");
      return;
    }

    try {
      const response = await fetch('/api/save-geometry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wkt: currentWKT })
      });

      if (response.ok) {
        alert("Geometry saved successfully!");
      } else {
        alert("Failed to save geometry.");
      }
    } catch (error) {
      console.error("Error saving geometry:", error);
      alert("An error occurred while saving the geometry.");
    }
  }
</script>

<style>
  /* ✅ 確保圖形與按鈕樣式有載入 */
  @import 'leaflet/dist/leaflet.css';
  @import 'leaflet-draw/dist/leaflet.draw.css';
</style>

<div class="flex gap-2 mb-4">
  <input class="border p-2 rounded w-full" bind:value={searchQuery} placeholder="搜尋地點…" />
  <button on:click={searchLocation} class="bg-blue-600 text-white px-4 py-2 rounded">搜尋</button>
</div>
<div class="mb-4">
  <div bind:this={mapContainer} class="h-[600px] w-full rounded shadow border"></div>
</div>

{#if currentWKT}
  <div class="bg-gray-100 p-3 text-sm rounded border font-mono">
    <strong>目前選取區域 WKT：</strong>
    <pre class="whitespace-pre-wrap break-words">{currentWKT}</pre>
    <button on:click={saveGeometry} class="bg-green-600 text-white px-4 py-2 rounded mt-2">儲存幾何圖形</button>
  </div>
{/if}
