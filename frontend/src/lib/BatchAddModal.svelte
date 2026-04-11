<script lang="ts">
  import { Modal, Button, Checkbox, Label, Select, Spinner, Alert, Badge } from 'flowbite-svelte';
  import { PlusOutline } from 'flowbite-svelte-icons';
  import { selectedSpecies, type ChecklistItem } from '$stores/speciesStore';

  export let open = false;
  export let rank = '';       // e.g. "family"
  export let name = '';       // e.g. "Lauraceae"
  export let nameC = '';      // e.g. "樟科"

  // Filters
  let filterEndemic = false;
  let filterAlienType = '';
  let filterRedlist = '';
  let filterCites = '';
  let filterProtected = '';

  const alienOptions = [
    { value: '', name: '全部' },
    { value: 'native', name: '原生' },
    { value: 'naturalized', name: '歸化' },
    { value: 'cultured', name: '栽培/圈養' },
  ];
  const redlistOptions = [
    { value: '', name: '全部' },
    { value: 'NCR', name: 'NCR (國家極危)' },
    { value: 'NEN', name: 'NEN (國家瀕危)' },
    { value: 'NVU', name: 'NVU (國家易危)' },
    { value: 'NNT', name: 'NNT (國家接近受脅)' },
    { value: 'NLC', name: 'NLC (國家安全)' },
  ];
  const citesOptions = [
    { value: '', name: '全部' },
    { value: 'I', name: 'CITES I' },
    { value: 'II', name: 'CITES II' },
    { value: 'III', name: 'CITES III' },
  ];
  const protectedOptions = [
    { value: '', name: '全部' },
    { value: 'I', name: 'I (瀕臨絕種)' },
    { value: 'II', name: 'II (珍貴稀有)' },
    { value: 'III', name: 'III (其他應予保育)' },
    { value: '1', name: '文資法珍稀' },
  ];

  const LIMIT = 5000;
  const WARN_THRESHOLD = 500;

  // State
  let count: number | null = null;
  let loading = false;
  let adding = false;
  let addedCount = 0;
  let skippedCount = 0;
  let progress = 0;
  let error = '';
  let done = false;
  let confirmed = false;  // 超過 WARN_THRESHOLD 需先確認

  function buildFilterParams(): string {
    let p = '';
    if (filterEndemic) p += '&endemic=true';
    if (filterAlienType) p += `&alien_type=${encodeURIComponent(filterAlienType)}`;
    if (filterRedlist) p += `&redlist=${encodeURIComponent(filterRedlist)}`;
    if (filterCites) p += `&cites=${encodeURIComponent(filterCites)}`;
    if (filterProtected) p += `&protected=${encodeURIComponent(filterProtected)}`;
    return p;
  }

  // 取得物種數
  async function fetchCount() {
    count = null;
    const url = `/api/taxonomy/species_count?rank=${encodeURIComponent(rank)}&name=${encodeURIComponent(name)}${buildFilterParams()}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        count = data.count;
      }
    } catch { /* ignore */ }
  }

  // 篩選變更時重新計數 + 重置確認
  $: if (open && rank && name) {
    fetchCount();
    confirmed = false;
  }
  // 任何 filter 變更都重新計數
  $: filterEndemic, filterAlienType, filterRedlist, filterCites, filterProtected,
    (() => { if (open) { fetchCount(); confirmed = false; } })();

  // 需要確認的情況
  $: needsConfirm = count !== null && count > WARN_THRESHOLD && !confirmed;
  $: exceedsLimit = count !== null && count > LIMIT;
  $: actualLimit = exceedsLimit ? LIMIT : (count || 0);

  // 批次加入
  async function doAdd() {
    if (count === null || count === 0) return;
    adding = true;
    progress = 0;
    addedCount = 0;
    skippedCount = 0;
    error = '';
    done = false;

    const url = `/api/taxonomy/species_under?rank=${encodeURIComponent(rank)}&name=${encodeURIComponent(name)}&limit=${LIMIT}${buildFilterParams()}`;

    try {
      loading = true;
      progress = 10;
      const res = await fetch(url);
      if (!res.ok) {
        error = `API 錯誤: ${res.status}`;
        adding = false;
        loading = false;
        return;
      }

      progress = 50;
      const species: ChecklistItem[] = await res.json();
      progress = 70;

      // Merge into store
      selectedSpecies.update(current => {
        const existingIds = new Set(current.map(d => d.taxon_id));
        const toAdd: ChecklistItem[] = [];
        for (const sp of species) {
          if (existingIds.has(sp.taxon_id)) {
            skippedCount++;
          } else {
            toAdd.push(sp);
            addedCount++;
          }
        }
        return [...current, ...toAdd];
      });

      progress = 100;
      done = true;
    } catch (e: any) {
      error = `加入失敗: ${e.message}`;
    }
    adding = false;
    loading = false;
  }

  function handleClose() {
    open = false;
    done = false;
    confirmed = false;
    addedCount = 0;
    skippedCount = 0;
    progress = 0;
    error = '';
  }
</script>

<Modal bind:open size="sm" title="批次加入名錄" on:close={handleClose}>
  <div class="space-y-4">
    <!-- 分類群資訊 -->
    <div class="text-sm">
      <span class="text-gray-500">分類群：</span>
      <span class="font-semibold">{nameC ? `${nameC} (${name})` : name}</span>
    </div>

    <!-- 篩選 -->
    {#if !done}
      <div class="grid grid-cols-2 gap-3">
        <div>
          <Label class="mb-1 text-xs">來源</Label>
          <Select items={alienOptions} bind:value={filterAlienType} size="sm" />
        </div>
        <div class="flex items-end pb-1">
          <Checkbox bind:checked={filterEndemic}>僅特有種</Checkbox>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <Label class="mb-1 text-xs">臺灣紅皮書</Label>
          <Select items={redlistOptions} bind:value={filterRedlist} size="sm" />
        </div>
        <div>
          <Label class="mb-1 text-xs">CITES</Label>
          <Select items={citesOptions} bind:value={filterCites} size="sm" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <Label class="mb-1 text-xs">保育類</Label>
          <Select items={protectedOptions} bind:value={filterProtected} size="sm" />
        </div>
      </div>

      <!-- 物種數 -->
      <div class="text-center py-2">
        {#if count === null}
          <Spinner size="4" />
        {:else}
          <span class="text-2xl font-bold {count > WARN_THRESHOLD ? 'text-orange-600' : 'text-blue-600'}">{count}</span>
          <span class="text-sm text-gray-500 ml-1">筆物種</span>
        {/if}
      </div>

      <!-- 超量警告 -->
      {#if count !== null && count > WARN_THRESHOLD && !confirmed}
        <Alert color="yellow">
          {#if exceedsLimit}
            此分類群下有 {count.toLocaleString()} 筆物種，超過上限 {LIMIT.toLocaleString()} 筆。
            確認後將加入前 {LIMIT.toLocaleString()} 筆（依學名排序）。
          {:else}
            此分類群下有 {count.toLocaleString()} 筆物種，名錄可能會很大。
          {/if}
        </Alert>
      {/if}
    {/if}

    <!-- 進度 -->
    {#if adding || done}
      <div>
        <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
          <div class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: {progress}%"></div>
        </div>
        <p class="text-xs text-gray-500 mt-1 text-center">
          {#if progress < 50}
            載入資料中...
          {:else if progress < 100}
            合併名錄中...
          {:else}
            完成
          {/if}
        </p>
      </div>
    {/if}

    {#if done}
      <Alert color="green">
        加入 {addedCount} 筆{skippedCount > 0 ? `，跳過 ${skippedCount} 筆（已在名錄中）` : ''}。
      </Alert>
    {/if}

    {#if error}
      <Alert color="red">{error}</Alert>
    {/if}
  </div>

  <svelte:fragment slot="footer">
    {#if done}
      <Button color="alternative" on:click={handleClose}>關閉</Button>
    {:else if needsConfirm}
      <Button color="yellow" on:click={() => { confirmed = true; }}>
        {exceedsLimit ? `確認加入前 ${LIMIT.toLocaleString()} 筆` : `確認加入 ${count?.toLocaleString()} 筆`}
      </Button>
      <Button color="alternative" on:click={handleClose}>取消</Button>
    {:else}
      <Button color="blue" on:click={doAdd} disabled={adding || count === 0 || count === null}>
        {#if adding}
          <Spinner size="4" class="me-2" />加入中...
        {:else}
          <PlusOutline class="w-4 h-4 me-2" />加入 {actualLimit} 筆
        {/if}
      </Button>
      <Button color="alternative" on:click={handleClose}>取消</Button>
    {/if}
  </svelte:fragment>
</Modal>
