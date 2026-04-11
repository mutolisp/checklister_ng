<script lang="ts">
  import { Button, Card, Spinner, Input } from 'flowbite-svelte';
  import TaxonTreeNode from '$lib/TaxonTreeNode.svelte';
  import { debounce } from '$lib/utils';
  import { clearAll as clearExpandedNodes } from '$stores/taxonomyStore';

  let roots: any[] | null = null;
  let loading = false;

  // Search
  let searchQuery = "";
  let searchResults: any[] = [];
  let searchLoading = false;

  // Expand path tracking
  let expandPath: { rank: string; value: string }[] = [];

  // Scroll target: "rank:value" to scroll into view after expand
  let scrollTarget = '';

  // Collapse all counter (increment to trigger)
  let collapseAll = 0;

  async function loadKingdoms() {
    loading = true;
    try {
      const res = await fetch('/api/taxonomy/children?rank=kingdom');
      if (res.ok) {
        roots = await res.json();
      }
    } catch {
      roots = [];
    }
    loading = false;
  }

  const doSearch = debounce(async (q: string) => {
    if (!q || q.trim().length < 2) {
      searchResults = [];
      return;
    }
    searchLoading = true;
    try {
      const res = await fetch(`/api/taxonomy/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        searchResults = await res.json();
      }
    } catch {
      searchResults = [];
    }
    searchLoading = false;
  }, 300);

  $: doSearch(searchQuery);

  function selectSearchResult(result: any) {
    const path = result.path || [];
    if (path.length > 0) {
      // 先收合全部，再展開新路徑
      collapseAll++;
      // 設定 scroll target 為路徑最後一個節點
      const last = path[path.length - 1];
      scrollTarget = `${last.rank}:${last.value}`;
      // 等一個 tick 讓收合生效
      setTimeout(() => {
        expandPath = [...path];
      }, 50);
    }
    searchQuery = "";
    searchResults = [];
  }

  function doCollapseAll() {
    collapseAll++;
    expandPath = [];
    scrollTarget = '';
    clearExpandedNodes();
  }

  loadKingdoms();
</script>

<div class="max-w-5xl mx-auto p-6">
  <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">分類樹瀏覽器</h1>
  <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
    資料來源：TaiCOL 臺灣物種名錄。點擊各階層展開子分類。
  </p>

  <!-- Search -->
  <div class="relative mb-4">
    <Input
      size="lg"
      placeholder="搜尋分類名稱（學名、俗名、科名...）"
      bind:value={searchQuery}
      class="w-full"
    />
    {#if searchResults.length > 0}
      <ul class="absolute z-20 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow max-h-60 overflow-y-auto w-full">
        {#each searchResults as result}
          <li>
            <button
              type="button"
              class="w-full text-left px-3 py-2 hover:bg-blue-100 dark:hover:bg-gray-700 text-sm"
              on:click={() => selectSearchResult(result)}
            >
              <span class="text-gray-400 text-xs mr-1">[{result.rank}]</span>
              <span class="font-medium">{result.display}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Quick access + collapse -->
  <div class="flex flex-wrap gap-2 mb-6 items-center">
    <Button color="green" size="sm" outline on:click={() => selectSearchResult({path:[{rank:'kingdom',value:'Plantae'}]})}>植物界</Button>
    <Button color="blue" size="sm" outline on:click={() => selectSearchResult({path:[{rank:'kingdom',value:'Animalia'}]})}>動物界</Button>
    <Button color="yellow" size="sm" outline on:click={() => selectSearchResult({path:[{rank:'kingdom',value:'Fungi'}]})}>真菌界</Button>
    <span class="flex-1"></span>
    <Button color="alternative" size="sm" on:click={doCollapseAll}>
      全部收合
    </Button>
  </div>

  {#if loading}
    <div class="flex items-center gap-2 text-gray-500">
      <Spinner size="5" />
      <span>載入中...</span>
    </div>
  {:else if roots}
    <Card class="max-w-none p-0 overflow-hidden" size="xl">
      <div class="divide-y divide-gray-100 dark:divide-gray-700">
        {#each roots as node}
          <TaxonTreeNode {node} depth={0} {expandPath} {collapseAll} {scrollTarget} />
        {/each}
      </div>
    </Card>
  {/if}
</div>
