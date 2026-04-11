<script lang="ts">
  import { Button, Card, Alert, Spinner, Tabs, TabItem, Input, Badge } from 'flowbite-svelte';
  import { UploadOutline, SearchOutline } from 'flowbite-svelte-icons';
  import AdminNameEditor from '$lib/AdminNameEditor.svelte';
  import AdminNameList from '$lib/AdminNameList.svelte';
  import AdminAddModal from '$lib/AdminAddModal.svelte';
  import AdminQAPanel from '$lib/AdminQAPanel.svelte';

  // ─── CSV 匯入 ───
  let nameFile: File | null = null;
  let taxonFile: File | null = null;
  let uploading = false;
  let importResult: { status: string; rows_imported: number; backfilled_records: number; taxon_csv: string | null; time_elapsed: number } | null = null;
  let importError = "";

  function handleNameFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    nameFile = input.files?.[0] || null;
    importResult = null;
    importError = "";
  }

  function handleTaxonFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    taxonFile = input.files?.[0] || null;
  }

  async function uploadFile() {
    if (!nameFile) return;
    uploading = true;
    importError = "";
    importResult = null;
    try {
      const formData = new FormData();
      formData.append("name_file", nameFile);
      if (taxonFile) {
        formData.append("taxon_file", taxonFile);
      }
      const res = await fetch("/api/admin/import-taicol", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) { importResult = data; } else { importError = data.detail || data.error || "匯入失敗"; }
    } catch (e) { importError = `上傳錯誤: ${e}`; }
    uploading = false;
  }

  // ─── 名錄管理 ───
  let searchQuery = '';
  let showAddModal = false;
  let searchResults: any[] = [];
  let searchLoading = false;
  let selectedRecord: any = null;
  let taxonNames: any[] = [];
  let selectedNameId: number | null = null;

  let searchTimer: ReturnType<typeof setTimeout>;

  function handleSearchInput() {
    clearTimeout(searchTimer);
    if (searchQuery.length < 1) { searchResults = []; return; }
    searchTimer = setTimeout(doSearch, 300);
  }

  async function doSearch() {
    if (!searchQuery) return;
    searchLoading = true;
    try {
      const res = await fetch(`/api/admin/name/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) { searchResults = await res.json(); }
    } catch { searchResults = []; }
    searchLoading = false;
  }

  async function selectSearchResult(item: any) {
    searchResults = [];
    searchQuery = `${item.common_name_c || ''} ${item.simple_name}`.trim();

    // 載入 taxon 下所有 names
    try {
      const res = await fetch(`/api/admin/taxon/${encodeURIComponent(item.taxon_id)}/names`);
      if (res.ok) { taxonNames = await res.json(); }
    } catch { taxonNames = []; }

    // 載入該 name 完整記錄
    await loadName(item.name_id);
  }

  async function loadName(nameId: number) {
    selectedNameId = nameId;
    try {
      const res = await fetch(`/api/admin/name/${nameId}`);
      if (res.ok) { selectedRecord = await res.json(); }
    } catch { selectedRecord = null; }
  }

  function handleNameSelect(nameId: number) {
    loadName(nameId);
  }

  async function handleNavigate(name: string) {
    searchQuery = name;
    searchResults = [];
    try {
      const res = await fetch(`/api/admin/name/search?q=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        // 找精確匹配且 accepted 的
        const exact = data.find((d: any) => d.simple_name === name && d.usage_status === 'accepted')
                   || data.find((d: any) => d.simple_name === name)
                   || data[0];
        if (exact) {
          await selectSearchResult(exact);
        }
      }
    } catch {}
  }

  async function handleCreated(nameId: number, taxonId: string) {
    // 新增成功後自動載入
    await loadName(nameId);
    try {
      const res = await fetch(`/api/admin/taxon/${encodeURIComponent(taxonId)}/names`);
      if (res.ok) taxonNames = await res.json();
    } catch {}
  }

  async function handleQANavigate(nameId: number) {
    // 從 QA 面板點擊 name_id 跳到名錄管理
    await loadName(nameId);
    if (selectedRecord?.taxon_id) {
      try {
        const res = await fetch(`/api/admin/taxon/${encodeURIComponent(selectedRecord.taxon_id)}/names`);
        if (res.ok) taxonNames = await res.json();
      } catch {}
      searchQuery = selectedRecord.simple_name || '';
    }
  }

  async function handleSaved() {
    // 儲存後重新載入 taxon names（可能俗名等有變更）
    if (selectedRecord?.taxon_id) {
      try {
        const res = await fetch(`/api/admin/taxon/${encodeURIComponent(selectedRecord.taxon_id)}/names`);
        if (res.ok) { taxonNames = await res.json(); }
      } catch {}
    }
  }
</script>

<div class="max-w-6xl mx-auto p-4 md:p-8">
  <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">名錄管理</h1>

  <Tabs>
    <!-- Tab 1: 名錄管理 -->
    <TabItem open title="名錄管理">
      <div class="space-y-4 mt-4">
        <!-- 搜尋列 -->
        <div class="relative">
          <div class="flex gap-2">
            <div class="flex-1 relative">
              <Input
                bind:value={searchQuery}
                on:input={handleSearchInput}
                on:keydown={(e) => { if (e.key === 'Escape') searchResults = []; }}
                placeholder="搜尋俗名或學名..."
                size="sm"
              >
                <SearchOutline slot="left" class="w-4 h-4" />
              </Input>

              <!-- 搜尋建議下拉 -->
              {#if searchResults.length > 0}
                <div class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                  {#each searchResults as item}
                    <button
                      class="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm border-b border-gray-50 dark:border-gray-700 last:border-0"
                      on:click={() => selectSearchResult(item)}
                    >
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-mono text-xs text-gray-400">{item.name_id}</span>
                        <Badge color={item.usage_status === 'accepted' ? 'green' : item.usage_status === 'misapplied' ? 'red' : 'dark'} class="text-xs">{item.usage_status}</Badge>
                        <span class="font-semibold">{item.common_name_c || '—'}</span>
                        <span class="italic text-gray-600 dark:text-gray-400">{item.simple_name}</span>
                        <span class="text-gray-400 text-xs">{item.name_author || ''}</span>
                      </div>
                      <div class="text-xs text-gray-400 mt-0.5">
                        {item.family_c || ''} {item.family || ''} · {item.taxon_id}
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            <Button color="blue" size="sm" on:click={() => { showAddModal = true; }}>新增</Button>
          </div>
        </div>

        <!-- 主內容：左右面板 -->
        {#if selectedRecord}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <!-- 左面板：編輯表單 -->
            <div class="lg:col-span-2">
              <Card class="max-w-none" size="xl">
                <AdminNameEditor record={selectedRecord} onSaved={handleSaved} onNavigate={handleNavigate} />
              </Card>
            </div>

            <!-- 右面板：同物異名 -->
            <div>
              <Card class="max-w-none" size="xl">
                <AdminNameList
                  names={taxonNames}
                  selectedNameId={selectedNameId}
                  onSelect={handleNameSelect}
                />
              </Card>
            </div>
          </div>
        {:else}
          <Card class="max-w-none" size="xl">
            <div class="flex items-center justify-center h-48 text-gray-400">
              搜尋物種名稱以開始編輯
            </div>
          </Card>
        {/if}
      </div>
    </TabItem>

    <!-- Tab 2: CSV 匯入 -->
    <TabItem title="CSV 匯入">
      <div class="max-w-2xl mt-4 space-y-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          上傳 TaiCOL 的 name CSV 與 taxon CSV。Name CSV 為主要資料來源，taxon CSV 用於補齊 common names、保育狀態等欄位。匯入前會自動備份資料庫。
        </p>
        <Card class="max-w-none" size="xl">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">上傳 TaiCOL CSV</h2>
          <div class="space-y-4">
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name CSV（必要）</p>
              <input
                type="file" accept=".csv" on:change={handleNameFileChange}
                class="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4 file:rounded file:border-0
                  file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700
                  dark:file:bg-blue-900 dark:file:text-blue-300 hover:file:bg-blue-100"
              />
              {#if nameFile}
                <p class="text-xs text-gray-500 mt-1">{nameFile.name}（{(nameFile.size / 1024 / 1024).toFixed(1)} MB）</p>
              {/if}
            </div>
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Taxon CSV（選填，補齊 common names）</p>
              <input
                type="file" accept=".csv" on:change={handleTaxonFileChange}
                class="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4 file:rounded file:border-0
                  file:text-sm file:font-semibold file:bg-gray-50 file:text-gray-700
                  dark:file:bg-gray-800 dark:file:text-gray-300 hover:file:bg-gray-100"
              />
              {#if taxonFile}
                <p class="text-xs text-gray-500 mt-1">{taxonFile.name}（{(taxonFile.size / 1024 / 1024).toFixed(1)} MB）</p>
              {:else}
                <p class="text-xs text-gray-400 mt-1">未上傳時，會自動從 name CSV 同目錄偵測</p>
              {/if}
            </div>
            <Button color="blue" on:click={uploadFile} disabled={!nameFile || uploading} class="w-full">
              {#if uploading}<Spinner size="4" class="me-2" />匯入中...{:else}<UploadOutline class="w-4 h-4 me-2" />開始匯入{/if}
            </Button>
          </div>
          {#if importResult}
            <Alert color="green" class="mt-4">
              匯入成功！共 {importResult.rows_imported.toLocaleString()} 筆名稱，
              從 taxon CSV 補齊 {importResult.backfilled_records.toLocaleString()} 筆，
              耗時 {importResult.time_elapsed} 秒。
              {#if importResult.taxon_csv}
                <br/>Taxon CSV: {importResult.taxon_csv}
              {/if}
            </Alert>
          {/if}
          {#if importError}
            <Alert color="red" class="mt-4">{importError}</Alert>
          {/if}
        </Card>
      </div>
    </TabItem>

    <!-- Tab 3: 資料品質 -->
    <TabItem title="資料品質">
      <AdminQAPanel onNavigate={handleQANavigate} />
    </TabItem>
  </Tabs>

  <AdminAddModal bind:open={showAddModal} initialQuery={searchQuery} onCreated={handleCreated} />
</div>
