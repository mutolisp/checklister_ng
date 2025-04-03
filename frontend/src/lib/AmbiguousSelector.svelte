<script lang="ts">
  import { ambiguousStore } from "$stores/importState";
  import { selectedSpecies } from "$stores/speciesStore";

  $: ambiguous = $ambiguousStore;

  function selectOption(name: string, option: any) {
    selectedSpecies.update((current) => {
      const ids = new Set(current.map((d) => d.taxonID));
      if (!ids.has(option.id)) {
        return [...current, option];
      }
      return current;
    });
    const updated = { ...$ambiguousStore };
    delete updated[name];
    ambiguousStore.set(updated);
  }
</script>

{#if Object.keys($ambiguousStore).length > 0}
  <div class="fixed inset-0 bg-black bg-opacity-30 flex items-start justify-center pt-20 z-[9999]">
    <div class="bg-white p-6 rounded-md shadow-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto">
      <h2 class="text-xl font-bold mb-4">請選擇正確的物種</h2>

      {#each Object.entries($ambiguousStore) as [name, options]}
        <div class="mb-4 border-b pb-3">
          <p class="font-semibold mb-2 text-blue-700">「{name}」有多筆對應：</p>
          <ul class="space-y-1">
            {#each options as item}
              <li>
                <button class="w-full text-left hover:bg-blue-100 px-2 py-1 rounded" on:click={() => selectOption(name, item)}>
                  <span class="font-medium">{item.cname}</span>
                  <span class="ml-2 text-sm text-gray-600 italic">{item.fullname}</span>
                  <span class="ml-2 text-xs text-gray-500">({item.family_cname} {item.family})</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}

      <div class="text-right mt-4">
        <button class="px-4 py-2 text-sm bg-gray-300 rounded hover:bg-gray-400" on:click={() => ambiguousStore.set({})}>關閉</button>
      </div>
    </div>
  </div>
{/if}

