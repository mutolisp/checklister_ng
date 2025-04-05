<script lang="ts">
  import { onMount } from "svelte";
  import { Label, Input } from "flowbite-svelte";
  import { createEventDispatcher } from "svelte";
  import { debounce } from "$lib/utils";
  import { selectedSpecies } from "$stores/speciesStore";
  import { formatScientificName } from '$lib/formatter';

  const dispatch = createEventDispatcher();
  let query = "";
  let suggestions = [];

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
        return [...current, item];
      }
      return current;
    });
    dispatch("select", { value: item });
    query = "";
    suggestions = [];
  }

  // 點按其他地方會取消建議選單 
  let suggestionBox: HTMLUListElement;
  let inputEl: HTMLInputElement;

  function handleClickOutside(event: MouseEvent) {
    if (
      !suggestionBox?.contains(event.target as Node) &&
      !inputEl?.contains(event.target as Node)
    ) {
      suggestions = [];
    }
  }


  // 按 esc 時或點按其他地方時取消建議選單
  onMount(() => {
    const escListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        suggestions = [];
      }
    };
  
    const handleClickOutside = (event: MouseEvent) => {
      if (
        !suggestionBox?.contains(event.target as Node) &&
        !inputEl?.contains(event.target as Node)
      ) {
        suggestions = [];
      }
    };
 
   window.addEventListener("keydown", escListener);
   window.addEventListener("click", handleClickOutside);

   return () => {
     window.removeEventListener("keydown", escListener);
     window.removeEventListener("click", handleClickOutside);
   };
  });
</script>

<div class="relative w-full max-w-2xl mb-6">
  <Label for="search" class="block mb-2 text-sm font-medium text-gray-700 dark:text-white">
    輸入並查找物種
  </Label>
  <Input
    id="search"
    size="lg"
    placeholder="Type scientific name, common name or family"
    bind:value={query}
    class="w-full"
  />

  {#if suggestions.length}
    <ul class="absolute z-10 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow max-h-60 overflow-y-auto w-full sm:max-w-sm md:max-w-md lg:max-w-xl">
      {#each suggestions as item}
        <li>
          <button
            type="button"
            class="w-full text-left px-3 py-2 hover:bg-blue-100 dark:hover:bg-gray-700 text-sm"
            on:click={() => selectSuggestion(item)}
          >
            {item.cname} ({@html formatScientificName(item.fullname)}); {item.family_cname}({item.family})
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
