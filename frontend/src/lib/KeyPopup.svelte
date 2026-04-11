<script lang="ts">
  import { Spinner } from 'flowbite-svelte';
  import { CloseOutline } from 'flowbite-svelte-icons';

  export let genus: string;
  export let onClose: () => void = () => {};

  let keyText = '';
  let loading = true;

  async function fetchKey() {
    loading = true;
    try {
      const res = await fetch(`/api/key/${encodeURIComponent(genus)}`);
      if (res.ok) {
        keyText = await res.text();
      } else {
        keyText = '';
      }
    } catch {
      keyText = '';
    }
    loading = false;
  }

  fetchKey();
</script>

<div class="fixed inset-0 z-[9998] bg-black bg-opacity-30 flex items-center justify-center"
  on:click|self={onClose} role="dialog">

<div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700
  w-[90vw] max-w-2xl max-h-[80vh] overflow-y-auto">

  <div class="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
    <h3 class="text-base font-bold text-gray-900 dark:text-white">
      檢索表 <span class="text-sm font-normal text-gray-500 italic">{genus}</span>
    </h3>
    <button on:click={onClose} class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
      <CloseOutline class="w-4 h-4 text-gray-500" />
    </button>
  </div>

  <div class="px-4 py-3">
    <p class="text-xs text-gray-400 dark:text-gray-500 mb-2">資料來源：臺灣維管束植物簡誌</p>
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Spinner size="6" />
      </div>
    {:else if keyText}
      <pre class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">{keyText}</pre>
    {:else}
      <p class="text-sm text-gray-400 text-center py-6">無檢索表資料</p>
    {/if}
  </div>
</div>
</div>
