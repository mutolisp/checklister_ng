<script lang="ts">
  import { Button } from 'flowbite-svelte';
  import { ArrowLeftOutline } from 'flowbite-svelte-icons';

  export let species: any[] = [];
  export let activeSpeciesId: number | null = null;
  export let onSelectSpecies: (id: number) => void = () => {};
  export let onBack: () => void = () => {};

  const strokeCollator = new Intl.Collator('zh-Hant', { collation: 'stroke' });

  $: sortedSpecies = [...species].sort((a, b) =>
    strokeCollator.compare(a.cname || '', b.cname || '')
  );
</script>

<div class="flex flex-col h-full">
  <div class="p-3 border-b border-gray-200 dark:border-gray-700">
    <Button color="alternative" size="sm" class="w-full" on:click={onBack}>
      <ArrowLeftOutline class="w-4 h-4 me-2" />返回名錄
    </Button>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#each sortedSpecies as item}
      <button
        class="w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors
          {activeSpeciesId === item.id ? 'bg-blue-50 dark:bg-blue-900 border-l-4 border-l-blue-500' : ''}"
        on:click={() => onSelectSpecies(item.id)}
      >
        <div class="font-medium text-sm text-gray-900 dark:text-white">{item.cname}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 italic truncate">{item.name || item.fullname}</div>
      </button>
    {/each}
  </div>
</div>
