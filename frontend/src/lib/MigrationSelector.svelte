<script lang="ts">
  import { migrationStore } from "$stores/importState";
  import { selectedSpecies } from "$stores/speciesStore";
  import { formatScientificName } from '$lib/formatter';

  $: pending = $migrationStore;
  $: entries = Object.entries(pending);

  function selectCandidate(label: string, candidate: any, original: any) {
    // 保留使用者欄位（abundance 等）
    const migrated = { ...candidate, abundance: original.abundance || 0 };

    selectedSpecies.update((current) => {
      const ids = new Set(current.map((d: any) => d.taxon_id));
      if (!ids.has(migrated.taxon_id)) {
        return [...current, migrated];
      }
      return current;
    });

    const updated = { ...$migrationStore };
    delete updated[label];
    migrationStore.set(updated);
  }

  function skipItem(label: string) {
    const updated = { ...$migrationStore };
    delete updated[label];
    migrationStore.set(updated);
  }

  function closeAll() {
    migrationStore.set({});
  }
</script>

{#if entries.length > 0}
  <div class="fixed inset-0 bg-black bg-opacity-30 flex items-start justify-center pt-16 z-[9999]">
    <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
      <h2 class="text-lg font-bold mb-1 text-gray-900 dark:text-white">舊版名錄遷移</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        以下 {entries.length} 筆資料來自舊版格式，有多筆相似物種，請選擇正確的對應：
      </p>

      {#each entries as [label, entry]}
        <div class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
          <div class="flex items-center justify-between mb-2">
            <p class="font-semibold text-blue-700 dark:text-blue-400">「{label}」</p>
            <button
              class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              on:click={() => skipItem(label)}
            >跳過</button>
          </div>
          <ul class="space-y-1">
            {#each entry.candidates as candidate}
              <li>
                <button
                  class="w-full text-left hover:bg-blue-50 dark:hover:bg-blue-900 px-3 py-2 rounded transition-colors"
                  on:click={() => selectCandidate(label, candidate, entry.original)}
                >
                  <span class="font-medium text-sm">{candidate.cname}</span>
                  <span class="ml-2 text-sm text-gray-600 dark:text-gray-300">{@html formatScientificName(candidate.fullname)}</span>
                  <span class="ml-2 text-xs text-gray-400">({candidate.family_cname} {candidate.family})</span>
                  <span class="ml-1 text-xs font-mono text-gray-400">{candidate.taxon_id}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}

      <div class="text-right mt-4">
        <button
          class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200"
          on:click={closeAll}
        >全部跳過並關閉</button>
      </div>
    </div>
  </div>
{/if}
