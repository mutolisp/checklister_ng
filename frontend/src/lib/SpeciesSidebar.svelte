<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input } from 'flowbite-svelte';
  import { ArrowLeftOutline } from 'flowbite-svelte-icons';

  export let species: any[] = [];
  export let activeSpeciesId: string | null = null;
  export let onSelectSpecies: (id: string) => void = () => {};
  export let onBack: () => void = () => {};
  export let onDelete: (id: string) => void = () => {};

  let filterText = "";

  const strokeCollator = new Intl.Collator('zh-Hant', { collation: 'stroke' });

  $: sortedSpecies = [...species].sort((a, b) =>
    strokeCollator.compare(a.cname || '', b.cname || '')
  );

  $: filteredSpecies = filterText.trim()
    ? sortedSpecies.filter(s =>
        (s.cname || '').includes(filterText) ||
        (s.name || '').toLowerCase().includes(filterText.toLowerCase()) ||
        (s.fullname || '').toLowerCase().includes(filterText.toLowerCase())
      )
    : sortedSpecies;

  // Delete/Backspace 刪除當前選中的物種
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (activeSpeciesId) {
        e.preventDefault();
        const item = species.find(s => s.taxon_id === activeSpeciesId);
        const name = item ? `${item.cname} (${item.name})` : '';
        if (confirm(`確定要從名錄中刪除「${name}」嗎？`)) {
          onDelete(activeSpeciesId);
        }
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="flex flex-col h-full">
  <!-- 搜尋框 -->
  <div class="p-2 border-b border-gray-200 dark:border-gray-700">
    <Input
      size="sm"
      placeholder="篩選物種..."
      bind:value={filterText}
      class="w-full"
    />
  </div>

  <!-- 返回名錄 -->
  <div class="p-2 border-b border-gray-200 dark:border-gray-700">
    <Button color="alternative" size="sm" class="w-full" on:click={onBack}>
      <ArrowLeftOutline class="w-4 h-4 me-2" />返回名錄
    </Button>
  </div>

  <!-- 物種列表 -->
  <div class="flex-1 overflow-y-auto">
    {#each filteredSpecies as item}
      <button
        class="w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors
          {activeSpeciesId === item.taxon_id ? 'bg-blue-50 dark:bg-blue-900 border-l-4 border-l-blue-500' : ''}"
        on:click={() => onSelectSpecies(item.taxon_id)}
      >
        <div class="font-medium text-sm text-gray-900 dark:text-white">{item.cname}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 italic truncate">{item.name || item.fullname}</div>
      </button>
    {/each}
    {#if filteredSpecies.length === 0 && filterText}
      <p class="text-sm text-gray-400 dark:text-gray-500 p-4 text-center">無符合的物種</p>
    {/if}
  </div>
</div>
