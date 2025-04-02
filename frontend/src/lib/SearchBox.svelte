<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { debounce } from "$lib/utils";
  import { selectedSpecies } from "$stores/speciesStore";

  const dispatch = createEventDispatcher();
  let query = "";
  let suggestions = [];

  // 延遲 300ms 執行搜尋
  const fetchSuggestions = debounce(async (text: string) => {
    if (!text || text.trim().length === 0) {
      suggestions = [];
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`);
    if (res.ok) {
      suggestions = await res.json();
    }
  }, 300);

  $: fetchSuggestions(query);

  function selectSuggestion(item) {
    selectedSpecies.update(current => {
      if (!current.find(entry => entry.id === item.id)) {
        return [...current, item];  // ✅ 改為建立新陣列才能觸發更新
      }
      return current;
    });
    dispatch("select", { value: item });
    query = "";
    suggestions = [];
  }
</script>

<div class="w-full max-w-xl mx-auto relative">
  <input
    class="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring focus:border-blue-300"
    placeholder="輸入學名、俗名或科名"
    bind:value={query}
  />
  {#if suggestions.length}
    <ul class="absolute z-10 w-full bg-white border rounded-md shadow max-h-60 overflow-y-auto mt-1">
      {#each suggestions as item}
        <li>
          <button
            type="button"
            class="w-full text-left px-3 py-2 hover:bg-blue-100"
            on:click={() => selectSuggestion(item)}
          >
            {item.cname} ({item.fullname}) {item.family_cname} {item.family}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

