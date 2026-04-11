<script lang="ts">
  import { Badge, Button, Spinner } from 'flowbite-svelte';
  import { PlusOutline, CheckOutline, CloseOutline } from 'flowbite-svelte-icons';
  import { formatScientificName } from '$lib/formatter';
  import { selectedSpecies } from '$stores/speciesStore';

  export let species: any;  // 從 taxonomy children API 回傳的簡要資料
  export let onClose: () => void = () => {};

  let fullData: any = null;
  let synonyms: any[] = [];
  let loading = true;
  let synLoading = false;

  // 是否已在名錄中
  $: inChecklist = $selectedSpecies.some((s: any) => s.taxon_id === species.taxon_id);

  // IUCN 色系
  function iucnStyle(cat: string): string {
    const c = (cat || '').replace(/^N(?=LC|DD|VU|NT|EN|CR)/, '');
    switch (c) {
      case 'EX': return 'background:#000;color:#fff';
      case 'EW': return 'background:#542344;color:#fff';
      case 'CR': return 'background:#d81e05;color:#fff';
      case 'EN': return 'background:#fc7f3f;color:#000';
      case 'VU': return 'background:#f9e814;color:#000';
      case 'NT': return 'background:#cce226;color:#000';
      case 'LC': return 'background:#60c659;color:#000';
      case 'DD': return 'background:#d1d1c6;color:#000';
      case 'NE': return 'background:#fff;color:#000;border:1px solid #ccc';
      default:   return 'background:#e5e7eb;color:#000';
    }
  }

  async function fetchFullData() {
    loading = true;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(species.name)}`);
      if (res.ok) {
        const results = await res.json();
        // 找精確匹配
        fullData = results.find((r: any) => r.name === species.name || r.taxon_id === species.taxon_id) || results[0] || null;
      }
    } catch { /* ignore */ }
    loading = false;

    // 載入同物異名
    if (species.taxon_id) {
      synLoading = true;
      try {
        const res = await fetch(`/api/synonyms?taxon_id=${encodeURIComponent(species.taxon_id)}`);
        if (res.ok) synonyms = await res.json();
      } catch { /* ignore */ }
      synLoading = false;
    }
  }

  function addToChecklist() {
    if (!fullData || inChecklist) return;
    selectedSpecies.update((current: any[]) => {
      if (!current.some((s: any) => s.taxon_id === fullData.taxon_id)) {
        return [...current, fullData];
      }
      return current;
    });
  }

  fetchFullData();
</script>

<!-- Backdrop + centering wrapper -->
<div class="fixed inset-0 z-[9998] bg-black bg-opacity-30 flex items-center justify-center"
  on:click|self={onClose} role="dialog">

<!-- Popup -->
<div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700
  w-[90vw] max-w-lg max-h-[80vh] overflow-y-auto">

  <!-- Header -->
  <div class="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-2">
    <div class="flex-1 min-w-0">
      <h3 class="text-base font-bold text-gray-900 dark:text-white truncate">
        {species.cname || species.name}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 truncate">
        {@html formatScientificName(species.name)}
        {#if species.author}<span class="text-xs"> {species.author}</span>{/if}
      </p>
    </div>
    <button on:click={onClose} class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
      <CloseOutline class="w-4 h-4 text-gray-500" />
    </button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-8">
      <Spinner size="6" />
    </div>
  {:else if fullData}
    <div class="px-4 py-3 space-y-3">

      <!-- 物種狀態 -->
      <div class="flex flex-wrap gap-1.5">
        {#if fullData.source}
          <Badge color={fullData.source === '原生' ? 'green' : fullData.source === '歸化' ? 'yellow' : (fullData.source === '栽培' || fullData.source === '圈養') ? 'blue' : 'dark'} class="text-xs">{fullData.source}</Badge>
        {/if}
        {#if fullData.endemic === 1}
          <Badge color="purple" class="text-xs">臺灣特有</Badge>
        {/if}
        {#if fullData.is_hybrid === 'true'}
          <Badge color="pink" class="text-xs">雜交種</Badge>
        {/if}
      </div>

      <!-- 保育狀態 -->
      {#if fullData.redlist || fullData.iucn_category || fullData.cites || fullData.protected}
        <div class="flex flex-wrap gap-1.5">
          {#if fullData.redlist}
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold" style={iucnStyle(fullData.redlist)}>
              紅皮書:{fullData.redlist}
            </span>
          {/if}
          {#if fullData.iucn_category}
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold" style={iucnStyle(fullData.iucn_category)}>
              IUCN:{fullData.iucn_category}
            </span>
          {/if}
          {#if fullData.cites}
            <Badge color="red" class="text-xs">CITES {fullData.cites}</Badge>
          {/if}
          {#if fullData.protected}
            <Badge color="purple" class="text-xs">
              {fullData.protected === '1' ? '文資法珍稀' : `保育類${fullData.protected}`}
            </Badge>
          {/if}
        </div>
      {/if}

      <!-- 分類資訊 -->
      <div class="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
        <p>{fullData.family_cname || ''} {fullData.family || ''}</p>
        {#if fullData.alternative_name_c}
          <p>其他俗名：{fullData.alternative_name_c}</p>
        {/if}
      </div>

      <!-- 同物異名 -->
      {#if synLoading}
        <p class="text-xs text-gray-400 italic">載入同物異名...</p>
      {:else if synonyms.length > 0}
        <div>
          <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">同物異名</p>
          <ul class="space-y-0.5">
            {#each synonyms as syn}
              <li class="text-xs text-gray-600 dark:text-gray-300">
                {@html formatScientificName(syn.scientificName)}
                {#if syn.authorship}<span class="text-gray-400"> {syn.authorship}</span>{/if}
                {#if syn.status}
                  <Badge color={syn.status === 'accepted' ? 'green' : syn.status === 'misapplied' ? 'red' : 'dark'} class="text-xs ml-1">{syn.status}</Badge>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {:else}
    <p class="px-4 py-6 text-sm text-gray-400 text-center">查無詳細資料</p>
  {/if}

  <!-- Footer: 加入名錄按鈕 -->
  <div class="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2">
    {#if inChecklist}
      <Button color="alternative" size="sm" class="w-full" disabled>
        <CheckOutline class="w-4 h-4 me-1 text-green-500" />已在名錄中
      </Button>
    {:else}
      <Button color="blue" size="sm" class="w-full" on:click={addToChecklist} disabled={!fullData}>
        <PlusOutline class="w-4 h-4 me-1" />加入名錄
      </Button>
    {/if}
  </div>
</div>
</div>
