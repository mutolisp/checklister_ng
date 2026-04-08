<script lang="ts">
  import { Badge } from 'flowbite-svelte';
  import { ChevronDownOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
  import { formatScientificName } from '$lib/formatter';

  export let node: any;
  export let depth: number = 0;
  export let expandPath: { rank: string; value: string }[] = [];
  export let collapseAll: number = 0;  // 遞增觸發全部收合

  let expanded = false;
  let children: any[] | null = null;
  let loading = false;
  let lastExpandPathId = "";  // 避免重複觸發

  const rankColors: Record<string, string> = {
    '界': 'red',
    '門': 'yellow',
    '綱': 'green',
    '目': 'blue',
    '科': 'purple',
    '屬': 'dark',
  };

  // 檢查此節點是否在展開路徑上
  function isOnExpandPath(): boolean {
    if (!expandPath || expandPath.length === 0) return false;
    return expandPath.some(p => p.rank === node.rank_key && p.value === node.name);
  }

  // 產生 expandPath 的唯一 ID
  function pathId(): string {
    return expandPath.map(p => `${p.rank}:${p.value}`).join('/');
  }

  // 當 expandPath 變化且匹配此節點時，自動展開（只觸發一次）
  $: {
    const currentPathId = pathId();
    if (expandPath.length > 0 && isOnExpandPath() && currentPathId !== lastExpandPathId) {
      lastExpandPathId = currentPathId;
      if (!expanded) {
        doExpand();
      }
    }
  }

  // 全部收合
  $: if (collapseAll > 0) {
    expanded = false;
  }

  async function doExpand() {
    if (children === null) {
      loading = true;
      try {
        const childRank = node.child_rank;
        let url = `/api/taxonomy/children?rank=${childRank}`;
        url += `&parent_rank=${node.rank_key}`;
        url += `&parent_value=${encodeURIComponent(node.name)}`;
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
  }

  function toggle() {
    if (expanded) {
      expanded = false;
    } else {
      doExpand();
    }
  }

  $: statsText = Object.entries(node.stats || {})
    .map(([k, v]) => `${v}${k}`)
    .join(' ');

  $: isSpeciesList = node.child_rank === 'species';
  $: highlighted = isOnExpandPath();
</script>

<div class="border-b border-gray-100 dark:border-gray-700" style="padding-left: {depth * 24}px">
  <button
    class="w-full text-left py-3 px-4 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors
      {highlighted ? 'bg-blue-50 dark:bg-blue-900/30' : ''}"
    on:click={toggle}
  >
    <Badge color={rankColors[node.rank] || 'dark'} class="text-xs shrink-0 w-8 text-center">
      {node.rank}
    </Badge>

    <span class="flex-1">
      {#if node.name_c}
        <span class="font-medium text-gray-900 dark:text-white">{node.name_c}</span>
        <span class="text-gray-500 dark:text-gray-400 ml-1">{node.rank} <i>{node.name}</i></span>
      {:else}
        <span class="font-medium text-gray-900 dark:text-white">{node.rank} <i>{node.name}</i></span>
      {/if}
      <span class="text-gray-400 dark:text-gray-500 text-sm ml-2">{statsText}</span>
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
          <div class="py-1.5 px-4 text-sm flex items-center gap-2 flex-wrap">
            <span class="text-gray-900 dark:text-white">{sp.cname || '—'}</span>
            <span class="text-gray-500">{@html formatScientificName(sp.name)}</span>
            {#if sp.author}
              <span class="text-gray-400 text-xs">{sp.author}</span>
            {/if}
            {#if sp.endemic}
              <Badge color="purple" class="text-xs">特有</Badge>
            {/if}
            {#if sp.alien_type === 'naturalized'}
              <Badge color="yellow" class="text-xs">歸化</Badge>
            {:else if sp.alien_type === 'invasive'}
              <Badge color="red" class="text-xs">入侵</Badge>
            {:else if sp.alien_type === 'cultured'}
              <Badge color="blue" class="text-xs">栽培</Badge>
            {:else if sp.alien_type === 'native'}
              <Badge color="green" class="text-xs">原生</Badge>
            {/if}
            {#if sp.iucn}
              <Badge color="dark" class="text-xs">{sp.iucn}</Badge>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      {#each children as child}
        <svelte:self node={child} depth={depth + 1} {expandPath} {collapseAll} />
      {/each}
    {/if}
  {/if}
</div>
