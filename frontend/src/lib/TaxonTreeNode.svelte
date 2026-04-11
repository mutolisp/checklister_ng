<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Badge, Button } from 'flowbite-svelte';
  import { ChevronDownOutline, ChevronRightOutline, PlusOutline, CheckOutline } from 'flowbite-svelte-icons';
  import { formatScientificName } from '$lib/formatter';
  import { selectedSpecies } from '$stores/speciesStore';
  import { expandedNodes, nodeKey, markExpanded, markCollapsed } from '$stores/taxonomyStore';
  import { availableKeys } from '$stores/keyStore';
  import TaxonSpeciesPopup from '$lib/TaxonSpeciesPopup.svelte';
  import KeyPopup from '$lib/KeyPopup.svelte';
  import BatchAddModal from '$lib/BatchAddModal.svelte';

  export let node: any;
  export let depth: number = 0;
  export let expandPath: { rank: string; value: string }[] = [];
  export let collapseAll: number = 0;
  export let scrollTarget: string = '';  // "rank:value" of node to scroll to

  let expanded = false;
  let children: any[] | null = null;
  let loading = false;
  let lastExpandPathId = "";
  let el: HTMLDivElement;

  const myKey = nodeKey(node.rank_key, node.name);

  const rankColors: Record<string, string> = {
    '未定': 'dark',
    '病毒域': 'red',
    '界': 'red',
    '門': 'yellow',
    '綱': 'green',
    '目': 'blue',
    '科': 'purple',
    '屬': 'dark',
  };

  // 開啟時檢查 localStorage 是否有記錄
  onMount(() => {
    if ($expandedNodes.has(myKey)) {
      doExpand();
    }
  });

  // expandPath 自動展開
  function isOnExpandPath(): boolean {
    if (!expandPath || expandPath.length === 0) return false;
    return expandPath.some(p => p.rank === node.rank_key && p.value === node.name);
  }

  function pathId(): string {
    return expandPath.map(p => `${p.rank}:${p.value}`).join('/');
  }

  $: {
    const currentPathId = pathId();
    if (expandPath.length > 0 && isOnExpandPath() && currentPathId !== lastExpandPathId) {
      lastExpandPathId = currentPathId;
      if (!expanded) {
        doExpand();
      }
    }
  }

  // Scroll into view when this node is the target
  $: if (scrollTarget && scrollTarget === myKey && el) {
    tick().then(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // 全部收合
  $: if (collapseAll > 0) {
    expanded = false;
    // 不清 children cache，只收合顯示
  }

  async function doExpand() {
    if (children === null) {
      loading = true;
      try {
        const childRank = node.child_rank;
        let url: string;
        if (node.rank_key === 'viruses') {
          // 病毒頂層 → 載入 realm
          url = `/api/taxonomy/children?rank=realm`;
        } else if (node.rank_key === 'realm') {
          // Realm → 載入 kingdom
          url = `/api/taxonomy/children?rank=virus_kingdom&parent_rank=realm&parent_value=${encodeURIComponent(node.name)}`;
        } else {
          url = `/api/taxonomy/children?rank=${childRank}`;
          url += `&parent_rank=${node.rank_key}`;
          url += `&parent_value=${encodeURIComponent(node.name)}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          children = await res.json();
        } else {
          children = [];
        }
      } catch {
        children = [];
      }
      loading = false;
    }
    expanded = true;
    markExpanded(node.rank_key, node.name);
  }

  function toggle() {
    if (expanded) {
      expanded = false;
      markCollapsed(node.rank_key, node.name);
    } else {
      doExpand();
    }
  }

  // 物種 popup
  let popupSpecies: any = null;
  function openPopup(sp: any) { popupSpecies = sp; }
  function closePopup() { popupSpecies = null; }

  // 檢索表 popup
  let showKeyPopup = false;
  $: hasKey = node.rank_key === 'genus' && $availableKeys.has(node.name);

  // 批次加入
  let showBatchAdd = false;
  $: canBatchAdd = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].includes(node.rank_key);

  // 快速加入名錄
  async function quickAdd(sp: any, e: Event) {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(sp.name)}`);
      if (!res.ok) return;
      const results = await res.json();
      const match = results.find((r: any) => r.name === sp.name || r.taxon_id === sp.taxon_id) || results[0];
      if (!match) return;
      selectedSpecies.update((current: any[]) => {
        if (!current.some((s: any) => s.taxon_id === match.taxon_id)) {
          return [...current, match];
        }
        return current;
      });
    } catch { /* ignore */ }
  }

  function isInChecklist(taxonId: string): boolean {
    return $selectedSpecies.some((s: any) => s.taxon_id === taxonId);
  }

  $: statsText = Object.entries(node.stats || {})
    .map(([k, v]) => `${v}${k}`)
    .join(' ');

  $: isSpeciesList = node.child_rank === 'species';
  $: highlighted = isOnExpandPath();
</script>

<div class="border-b border-gray-100 dark:border-gray-700" style="padding-left: {depth * 24}px" bind:this={el}>
  <button
    class="w-full text-left py-3 px-4 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group
      {highlighted ? 'bg-blue-50 dark:bg-blue-900/30' : ''}"
    on:click={toggle}
  >
    <Badge color={rankColors[node.rank] || 'dark'} class="text-xs shrink-0 w-8 text-center">
      {node.rank}
    </Badge>

    <span class="flex-1">
      {#if node.name_c}
        <span class="font-medium text-gray-900 dark:text-white">{node.name_c}</span>
        <span class="text-gray-500 dark:text-gray-400 ml-1"><i>{node.name}</i></span>
      {:else}
        <span class="font-medium text-gray-900 dark:text-white"><i>{node.name}</i></span>
      {/if}
      <span class="text-gray-400 dark:text-gray-500 text-sm ml-2">{statsText}</span>
      {#if hasKey}
        <button
          class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium
            bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200
            hover:bg-amber-200 dark:hover:bg-amber-800 ml-1"
          on:click|stopPropagation={() => { showKeyPopup = true; }}
          title="檢索表"
        >檢索表</button>
      {/if}
      {#if canBatchAdd}
        <button
          class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium
            bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200
            hover:bg-blue-200 dark:hover:bg-blue-800 ml-1
            opacity-0 group-hover:opacity-100 transition-opacity"
          on:click|stopPropagation={() => { showBatchAdd = true; }}
          title="批次加入此分類群下所有物種"
        >+批次加入</button>
      {/if}
    </span>

    {#if loading}
      <span class="text-gray-400 text-sm animate-pulse">...</span>
    {:else if expanded}
      <ChevronDownOutline class="w-4 h-4 text-gray-400 shrink-0" />
    {:else}
      <ChevronRightOutline class="w-4 h-4 text-gray-400 shrink-0" />
    {/if}
  </button>

  {#if expanded && children}
    {#if isSpeciesList}
      <div style="padding-left: {(depth + 1) * 24}px" class="pb-2">
        {#each children as sp}
          <div class="py-1.5 px-4 text-sm flex items-center gap-1.5 flex-wrap group hover:bg-gray-50 dark:hover:bg-gray-800/50
            {sp.is_autonym ? 'opacity-50' : ''}">
            <button class="flex items-center gap-1.5 flex-wrap text-left" on:click={() => openPopup(sp)}>
              <span class="text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer">{sp.cname || '—'}</span>
              <span class="text-gray-500">{@html formatScientificName(sp.name)}</span>
              {#if sp.author}
                <span class="text-gray-400 text-xs">{sp.author}</span>
              {/if}
              {#if sp.rank && sp.rank !== 'Species'}
                <span class="text-gray-400 text-xs">({sp.rank}{sp.is_autonym ? ', autonym' : ''})</span>
              {/if}
            </button>
            {#if sp.endemic}
              <Badge color="purple" class="text-xs">特有</Badge>
            {/if}
            {#if sp.alien_type === 'naturalized'}
              <Badge color="yellow" class="text-xs">歸化</Badge>
            {:else if sp.alien_type === 'invasive'}
              <Badge color="red" class="text-xs">入侵</Badge>
            {:else if sp.alien_type === 'cultured'}
              <Badge color="blue" class="text-xs">{sp.kingdom === 'Animalia' ? '圈養' : '栽培'}</Badge>
            {:else if sp.alien_type === 'native'}
              <Badge color="green" class="text-xs">原生</Badge>
            {/if}
            {#if sp.iucn}
              <Badge color="dark" class="text-xs">{sp.iucn}</Badge>
            {/if}
            {#if sp.protected}
              <Badge color="purple" class="text-xs">{sp.protected === '1' ? '珍稀' : `保育${sp.protected}`}</Badge>
            {/if}
            <span class="ml-auto shrink-0">
              {#if isInChecklist(sp.taxon_id)}
                <span class="inline-flex items-center text-xs text-green-600 dark:text-green-400 gap-0.5">
                  <CheckOutline class="w-3 h-3" />已加入
                </span>
              {:else}
                <button
                  class="inline-flex items-center text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  on:click|stopPropagation={(e) => quickAdd(sp, e)}
                  title="加入名錄"
                >
                  <PlusOutline class="w-3 h-3" />加入
                </button>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      {#each children as child}
        <svelte:self node={child} depth={depth + 1} {expandPath} {collapseAll} {scrollTarget} />
      {/each}
    {/if}
  {/if}
</div>

{#if popupSpecies}
  <TaxonSpeciesPopup species={popupSpecies} onClose={closePopup} />
{/if}

{#if showKeyPopup}
  <KeyPopup genus={node.name} onClose={() => { showKeyPopup = false; }} />
{/if}

{#if showBatchAdd}
  <BatchAddModal bind:open={showBatchAdd} rank={node.rank_key} name={node.name} nameC={node.name_c || ''} />
{/if}
