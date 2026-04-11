<script lang="ts">
  import { Badge } from 'flowbite-svelte';

  export let names: any[] = [];
  export let selectedNameId: number | null = null;
  export let onSelect: (nameId: number) => void = () => {};

  function statusColor(status: string): string {
    switch (status) {
      case 'accepted': return 'green';
      case 'misapplied': return 'red';
      default: return 'dark';
    }
  }
</script>

<div class="space-y-1">
  <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">
    同物異名 ({names.length})
  </h3>
  {#each names as n}
    <button
      class="w-full text-left px-3 py-2 rounded text-sm transition-colors
        {selectedNameId === n.name_id
          ? 'bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'}"
      on:click={() => onSelect(n.name_id)}
    >
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs text-gray-400">{n.name_id}</span>
        <Badge color={statusColor(n.usage_status)} class="text-xs">{n.usage_status}</Badge>
      </div>
      <div class="mt-0.5">
        <span class="italic">{n.simple_name}</span>
        <span class="text-gray-500"> {n.name_author || ''}</span>
      </div>
      {#if n.common_name_c}
        <div class="text-xs text-gray-500 dark:text-gray-400">{n.common_name_c}</div>
      {/if}
    </button>
  {/each}
  {#if names.length === 0}
    <p class="text-sm text-gray-400 italic px-3">無資料</p>
  {/if}
</div>
