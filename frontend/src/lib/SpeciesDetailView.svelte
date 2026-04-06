<script lang="ts">
  import SpeciesSidebar from '$lib/SpeciesSidebar.svelte';
  import SpeciesDetailPanel from '$lib/SpeciesDetailPanel.svelte';

  export let species: any[] = [];
  export let activeSpeciesId: number | null = null;
  export let onSelectSpecies: (id: number) => void = () => {};
  export let onBack: () => void = () => {};

  let detailContainer: HTMLDivElement;

  $: activeItem = species.find(s => s.id === activeSpeciesId) || null;

  // 切換物種時重置 C 區 scroll
  $: if (activeSpeciesId && detailContainer) {
    detailContainer.scrollTop = 0;
  }
</script>

<div class="flex h-full border-t border-gray-200 dark:border-gray-700">
  <!-- Zone B: sidebar -->
  <div class="w-64 lg:w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <SpeciesSidebar
      {species}
      {activeSpeciesId}
      {onSelectSpecies}
      {onBack}
    />
  </div>

  <!-- Zone C: detail panel -->
  <div class="flex-1 bg-gray-50 dark:bg-gray-900 overflow-y-auto" bind:this={detailContainer}>
    {#if activeItem}
      <SpeciesDetailPanel species={activeItem} />
    {:else}
      <div class="flex items-center justify-center h-full">
        <p class="text-gray-400 dark:text-gray-500">請從左側選擇物種</p>
      </div>
    {/if}
  </div>
</div>
