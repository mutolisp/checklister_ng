<script lang="ts">
  import { Button, Input, Label, Card } from 'flowbite-svelte';
  import { DownloadOutline, UploadOutline, TrashBinOutline } from 'flowbite-svelte-icons';
  import MapEditor from '$lib/MapEditor.svelte';
  import { projectMetadata } from '$stores/metadataStore';

  let mapEditor: MapEditor;
  let fileInput: HTMLInputElement;

  function triggerImport() {
    fileInput.click();
  }

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      await mapEditor.importFile(file);
      input.value = '';
    }
  }

  function downloadText(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportAs(format: string) {
    let content = '';
    let filename = '';
    let type = 'text/plain';

    switch (format) {
      case 'wkt':
        content = mapEditor.exportWKT();
        filename = 'geometry.wkt';
        break;
      case 'geojson':
        content = mapEditor.exportGeoJSON();
        filename = 'geometry.geojson';
        type = 'application/json';
        break;
      case 'gpx':
        content = await mapEditor.exportGPX();
        filename = 'geometry.gpx';
        type = 'application/gpx+xml';
        break;
      case 'kml':
        content = await mapEditor.exportKML();
        filename = 'geometry.kml';
        type = 'application/vnd.google-earth.kml+xml';
        break;
    }

    if (content) {
      downloadText(content, filename, type);
    } else {
      alert('沒有幾何圖形可匯出');
    }
  }

  function clearAll() {
    if (confirm('確定要清除所有繪製的幾何圖形嗎？')) {
      mapEditor.clearAll();
    }
  }
</script>

<div class="max-w-6xl mx-auto p-4">
  <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">樣區地圖編輯器</h1>

  <!-- 樣區資訊 -->
  <Card class="mb-4 max-w-none" size="xl">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <Label class="mb-1">計畫名稱</Label>
        <Input size="sm" bind:value={$projectMetadata.projectName} placeholder="輸入計畫名稱..." />
      </div>
      <div>
        <Label class="mb-1">樣區名稱</Label>
        <Input size="sm" bind:value={$projectMetadata.siteName} placeholder="輸入樣區名稱..." />
      </div>
    </div>
  </Card>

  <!-- 工具列 -->
  <div class="flex flex-wrap gap-2 mb-4">
    <input type="file" accept=".gpx,.kml,.wkt,.txt,.geojson,.json" bind:this={fileInput} on:change={handleImport} class="hidden" />
    <Button size="sm" color="alternative" on:click={triggerImport}>
      <UploadOutline class="w-4 h-4 me-1" />匯入 (GPX/KML/WKT)
    </Button>
    <Button size="sm" color="alternative" on:click={() => exportAs('wkt')}>
      <DownloadOutline class="w-4 h-4 me-1" />WKT
    </Button>
    <Button size="sm" color="alternative" on:click={() => exportAs('gpx')}>
      <DownloadOutline class="w-4 h-4 me-1" />GPX
    </Button>
    <Button size="sm" color="alternative" on:click={() => exportAs('kml')}>
      <DownloadOutline class="w-4 h-4 me-1" />KML
    </Button>
    <Button size="sm" color="alternative" on:click={() => exportAs('geojson')}>
      <DownloadOutline class="w-4 h-4 me-1" />GeoJSON
    </Button>
    <span class="flex-1"></span>
    <Button size="sm" color="red" on:click={clearAll}>
      <TrashBinOutline class="w-4 h-4 me-1" />清除全部
    </Button>
  </div>

  <!-- 地圖 -->
  <MapEditor bind:this={mapEditor} height="70vh" />

  <!-- WKT 預覽 -->
  {#if $projectMetadata.footprintWKT}
    <Card class="mt-4 max-w-none" size="xl">
      <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">WKT</h3>
      <pre class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-all bg-gray-50 dark:bg-gray-800 p-3 rounded max-h-32 overflow-y-auto">{$projectMetadata.footprintWKT}</pre>
    </Card>
  {/if}
</div>
