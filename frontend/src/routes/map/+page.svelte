<script lang="ts">
  import { Button, Input, Label, Textarea, Badge } from 'flowbite-svelte';
  import { DownloadOutline, UploadOutline, TrashBinOutline, BarsOutline, CloseOutline } from 'flowbite-svelte-icons';
  import MapEditor from '$lib/MapEditor.svelte';
  import { projectMetadata } from '$stores/metadataStore';

  let mapEditor: MapEditor;
  let fileInput: HTMLInputElement;

  // 側邊面板
  let panelOpen = false;
  let activeTab = 'metadata';

  function openPanel(tab: typeof activeTab) {
    activeTab = tab;
    panelOpen = true;
  }

  import { browser } from '$app/environment';

  // 底圖（從 localStorage 恢復）
  const savedView = browser ? localStorage.getItem('map_view') : null;
  const viewState = savedView ? JSON.parse(savedView) : null;
  let currentBasemap = viewState?.basemap || 'osm';
  let sinicaSearch = '';
  let sinicaLayerId = viewState?.sinicaLayer || '';
  let sinicaOpacity = viewState?.sinicaOpacity ?? 0.7;

  function selectBasemap(type: string) {
    mapEditor.switchBaseLayer(type);
    currentBasemap = type;
  }

  function selectSinicaOverlay(layerId: string) {
    sinicaLayerId = layerId;
    mapEditor.setSinicaOverlay(layerId);
  }

  function clearSinicaOverlay() {
    sinicaLayerId = '';
    mapEditor.removeSinicaOverlay();
  }

  function handleOpacityChange() {
    mapEditor.setSinicaOpacity(sinicaOpacity);
  }

  import { SINICA_LAYERS } from '$lib/sinicaLayers';

  $: filteredSinicaLayers = (() => {
    if (!sinicaSearch.trim()) return SINICA_LAYERS;
    const q = sinicaSearch.trim().toLowerCase();
    return SINICA_LAYERS.filter(l => l.title.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
  })();

  // Import
  function triggerFileSelect() { fileInput.click(); }

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      await mapEditor.importFile(file);
      input.value = '';
      panelOpen = false;
    }
  }

  // Export
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
    let content = '', filename = '', type = 'text/plain';
    switch (format) {
      case 'wkt': content = mapEditor.exportWKT(); filename = 'geometry.wkt'; break;
      case 'geojson': content = mapEditor.exportGeoJSON(); filename = 'geometry.geojson'; type = 'application/json'; break;
      case 'gpx': content = await mapEditor.exportGPX(); filename = 'geometry.gpx'; break;
      case 'kml': content = await mapEditor.exportKML(); filename = 'geometry.kml'; break;
    }
    if (content) { downloadText(content, filename, type); panelOpen = false; }
    else { alert('沒有幾何圖形可匯出'); }
  }

  function clearAll() {
    if (confirm('確定要清除所有繪製的幾何圖形嗎？')) {
      mapEditor.clearAll();
    }
  }

  $: hasGeometry = !!$projectMetadata.footprintWKT;
  $: hasMeta = !!($projectMetadata.projectName || $projectMetadata.siteName);
</script>

<div class="relative w-full" style="height: calc(100vh - 64px);">

  <!-- 地圖 -->
  <MapEditor bind:this={mapEditor} height="100%" />

  <!-- 右上選單按鈕 -->
  <div class="absolute top-3 right-3 z-[1100] flex flex-col gap-1.5">
    <button
      class="w-9 h-9 flex items-center justify-center rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
      on:click={() => { panelOpen = !panelOpen; }}
      title="選單"
    >
      {#if panelOpen}
        <CloseOutline class="w-4 h-4 text-gray-600 dark:text-gray-300" />
      {:else}
        <BarsOutline class="w-4 h-4 text-gray-600 dark:text-gray-300" />
      {/if}
    </button>
    {#if hasGeometry}
      <button
        class="w-9 h-9 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/30 shadow-lg border border-red-200 dark:border-red-700 hover:bg-red-100"
        on:click={clearAll}
        title="清除全部"
      >
        <TrashBinOutline class="w-4 h-4 text-red-500" />
      </button>
    {/if}
  </div>

  <!-- 右側浮動面板 -->
  {#if panelOpen}
    <div class="absolute top-0 right-0 z-[1050] h-full w-96 bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col">

      <!-- Header + 關閉 -->
      <div class="flex items-center border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button class="flex-1 py-2 text-xs font-medium text-center border-b-2 {activeTab === 'metadata' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
          on:click={() => { activeTab = 'metadata'; }}>細節</button>
        <button class="flex-1 py-2 text-xs font-medium text-center border-b-2 {activeTab === 'basemap' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
          on:click={() => { activeTab = 'basemap'; }}>底圖</button>
        <button class="flex-1 py-2 text-xs font-medium text-center border-b-2 {activeTab === 'import' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
          on:click={() => { activeTab = 'import'; }}>匯入</button>
        <button class="flex-1 py-2 text-xs font-medium text-center border-b-2 {activeTab === 'export' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
          on:click={() => { activeTab = 'export'; }}>匯出</button>
        <button class="px-2 py-2 text-gray-400 hover:text-gray-600" on:click={() => { panelOpen = false; }}>
          <CloseOutline class="w-4 h-4" />
        </button>
      </div>

      <!-- 內容 -->
      <div class="flex-1 overflow-y-auto p-3">

        {#if activeTab === 'metadata'}
          <div class="space-y-3">
            <div>
              <Label class="mb-1 text-xs">計畫名稱</Label>
              <Input size="sm" bind:value={$projectMetadata.projectName} placeholder="輸入計畫名稱..." />
            </div>
            <div>
              <Label class="mb-1 text-xs">摘要</Label>
              <Textarea bind:value={$projectMetadata.projectAbstract} placeholder="計畫摘要說明..." rows={3} class="text-sm" />
            </div>
            <div>
              <Label class="mb-1 text-xs">位置說明</Label>
              <Input size="sm" bind:value={$projectMetadata.locationDescription} placeholder="例如：臺灣南部恆春半島..." />
            </div>
            <div>
              <Label class="mb-1 text-xs">樣區名稱</Label>
              <Input size="sm" bind:value={$projectMetadata.siteName} placeholder="輸入樣區名稱..." />
            </div>
            <div>
              <Label class="mb-1 text-xs">備註</Label>
              <Textarea bind:value={$projectMetadata.siteNotes} placeholder="其他備註..." rows={2} class="text-sm" />
            </div>
            {#if hasGeometry}
              <div>
                <Label class="mb-1 text-xs">WKT</Label>
                <pre class="text-xs text-gray-500 bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-24 overflow-y-auto break-all whitespace-pre-wrap">{$projectMetadata.footprintWKT}</pre>
              </div>
            {/if}
          </div>

        {:else if activeTab === 'basemap'}
          <div class="space-y-2">
            <p class="text-xs text-gray-400 font-medium">底圖</p>
            <button class="w-full text-left px-3 py-2 rounded text-sm {currentBasemap === 'osm' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
              on:click={() => selectBasemap('osm')}>OpenStreetMap</button>
            <button class="w-full text-left px-3 py-2 rounded text-sm {currentBasemap === 'satellite' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
              on:click={() => selectBasemap('satellite')}>衛星影像 (Esri)</button>
            <button class="w-full text-left px-3 py-2 rounded text-sm {currentBasemap === 'hybrid' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
              on:click={() => selectBasemap('hybrid')}>衛星影像 + 地名標註 (Esri)</button>

            <hr class="dark:border-gray-700 my-2" />

            <p class="text-xs text-gray-400 font-medium">中研院歷史地圖疊圖 ({SINICA_LAYERS.length})</p>

            {#if sinicaLayerId}
              <div class="bg-blue-50 dark:bg-blue-900/20 rounded px-3 py-2 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-blue-700 dark:text-blue-300 font-medium truncate flex-1">
                    {SINICA_LAYERS.find(l => l.id === sinicaLayerId)?.title || sinicaLayerId}
                  </span>
                  <button class="text-xs text-red-400 hover:text-red-600 ml-2 shrink-0" on:click={clearSinicaOverlay}>移除</button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500 shrink-0">透明度</span>
                  <input type="range" min="0" max="1" step="0.05" bind:value={sinicaOpacity} on:input={handleOpacityChange}
                    class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                  <span class="text-xs text-gray-500 w-8 text-right">{Math.round(sinicaOpacity * 100)}%</span>
                </div>
              </div>
            {/if}

            <Input size="sm" bind:value={sinicaSearch} placeholder="搜尋圖層名稱..." />
            <div class="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded">
              {#each filteredSinicaLayers as layer}
                <button
                  class="w-full text-left px-2 py-1 text-xs truncate border-b border-gray-100 dark:border-gray-700 last:border-b-0
                    {sinicaLayerId === layer.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}"
                  on:click={() => selectSinicaOverlay(layer.id)}
                  title={layer.title}
                >{layer.title}</button>
              {/each}
              {#if filteredSinicaLayers.length === 0}
                <p class="text-xs text-gray-400 py-3 text-center">無符合的圖層</p>
              {/if}
            </div>
          </div>

        {:else if activeTab === 'import'}
          <div class="space-y-4">
            <p class="text-sm text-gray-500">選擇檔案匯入樣區幾何圖形：</p>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div class="flex items-center gap-2"><Badge color="blue" class="text-xs">GPX</Badge><span class="text-gray-600">GPS 軌跡</span></div>
              <div class="flex items-center gap-2"><Badge color="green" class="text-xs">KML</Badge><span class="text-gray-600">Google Earth</span></div>
              <div class="flex items-center gap-2"><Badge color="purple" class="text-xs">GeoJSON</Badge><span class="text-gray-600">標準格式</span></div>
              <div class="flex items-center gap-2"><Badge color="dark" class="text-xs">WKT</Badge><span class="text-gray-600">文字幾何</span></div>
            </div>
            <Button color="blue" class="w-full" on:click={triggerFileSelect}>
              <UploadOutline class="w-4 h-4 me-2" />選擇檔案
            </Button>
          </div>

        {:else if activeTab === 'export'}
          <div class="space-y-2">
            <p class="text-sm text-gray-500 mb-3">選擇匯出格式：</p>
            {#if hasGeometry}
              <Button color="alternative" class="w-full justify-start" size="sm" on:click={() => exportAs('gpx')}>
                <Badge color="blue" class="text-xs me-2">GPX</Badge>GPS 軌跡
              </Button>
              <Button color="alternative" class="w-full justify-start" size="sm" on:click={() => exportAs('kml')}>
                <Badge color="green" class="text-xs me-2">KML</Badge>Google Earth
              </Button>
              <Button color="alternative" class="w-full justify-start" size="sm" on:click={() => exportAs('geojson')}>
                <Badge color="purple" class="text-xs me-2">GeoJSON</Badge>JSON 格式
              </Button>
              <Button color="alternative" class="w-full justify-start" size="sm" on:click={() => exportAs('wkt')}>
                <Badge color="dark" class="text-xs me-2">WKT</Badge>Well-Known Text
              </Button>
            {:else}
              <p class="text-sm text-gray-400 text-center py-4">尚無幾何圖形可匯出。<br/>請先在地圖上繪製或匯入。</p>
            {/if}
          </div>
        {/if}

      </div>
    </div>
  {/if}
</div>

<input type="file" accept=".gpx,.kml,.wkt,.txt,.geojson,.json" bind:this={fileInput} on:change={handleImport} class="hidden" />
