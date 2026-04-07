<script lang="ts">
  import { Button } from 'flowbite-svelte';
  import { ListOutline, CloseOutline } from 'flowbite-svelte-icons';
  import SpeciesSidebar from '$lib/SpeciesSidebar.svelte';
  import SpeciesDetailPanel from '$lib/SpeciesDetailPanel.svelte';

  export let species: any[] = [];
  export let activeSpeciesId: number | null = null;
  export let onSelectSpecies: (id: number) => void = () => {};
  export let onBack: () => void = () => {};

  let detailContainer: HTMLDivElement;
  let mobileDrawerOpen = false;

  $: activeItem = species.find(s => s.id === activeSpeciesId) || null;

  // 切換物種時重置 C 區 scroll + 關閉手機 drawer
  $: if (activeSpeciesId && detailContainer) {
    detailContainer.scrollTop = 0;
    mobileDrawerOpen = false;
  }

  function handleSelectSpecies(id: number) {
    onSelectSpecies(id);
    mobileDrawerOpen = false;
  }
</script>

<div class="flex h-full border-t border-gray-200 dark:border-gray-700 relative">
  <!-- Zone B: sidebar (桌面版) -->
  <div class="hidden md:block w-64 lg:w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
    <SpeciesSidebar
      {species}
      {activeSpeciesId}
      {onSelectSpecies}
      {onBack}
    />
  </div>

  <!-- Zone B: 手機版浮動 drawer -->
  {#if mobileDrawerOpen}
    <!-- backdrop -->
    <button
      class="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
      on:click={() => mobileDrawerOpen = false}
      aria-label="關閉名錄列表"
    ></button>
    <!-- drawer -->
    <div class="md:hidden fixed left-0 top-0 h-full w-72 z-50 bg-white dark:bg-gray-800 shadow-xl">
      <div class="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">物種列表</span>
        <Button color="alternative" size="xs" on:click={() => mobileDrawerOpen = false}>
          <CloseOutline class="w-4 h-4" />
        </Button>
      </div>
      <div class="h-[calc(100%-3rem)]">
        <SpeciesSidebar
          {species}
          {activeSpeciesId}
          onSelectSpecies={handleSelectSpecies}
          {onBack}
        />
      </div>
    </div>
  {/if}

  <!-- Zone C: detail panel -->
  <div class="flex-1 bg-gray-50 dark:bg-gray-900 overflow-y-auto" bind:this={detailContainer}>
    <!-- 手機版：浮動按鈕開啟名錄列表 -->
    <div class="md:hidden sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex gap-2">
      <Button color="alternative" size="sm" on:click={() => mobileDrawerOpen = true}>
        <ListOutline class="w-4 h-4 me-2" />物種列表
      </Button>
      <Button color="alternative" size="sm" on:click={onBack}>
        返回名錄
      </Button>
    </div>

    {#if activeItem}
      <SpeciesDetailPanel species={activeItem} />
    {:else}
      <div class="flex items-center justify-center h-full">
        <p class="text-gray-400 dark:text-gray-500">請從左側選擇物種</p>
      </div>
    {/if}
  </div>
</div>
