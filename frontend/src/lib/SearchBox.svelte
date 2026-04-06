<script lang="ts">
  import { onMount } from "svelte";
  import { Label, Input, Select } from "flowbite-svelte";
  import { createEventDispatcher } from "svelte";
  import { debounce } from "$lib/utils";
  import { selectedSpecies } from "$stores/speciesStore";
  import { formatScientificName } from '$lib/formatter';

  const dispatch = createEventDispatcher();
  let query = "";
  let suggestions = [];
  let selectedGroup = "";

  const taxonGroups = [
    { value: "", label: "所有類群" },
    { value: "Tracheophyta", label: "維管束植物" },
    { value: "Plantae", label: "植物界" },
    { value: "Aves", label: "鳥綱" },
    { value: "Fungi", label: "真菌界" },
    { value: "Mammalia", label: "哺乳類" },
    { value: "Reptilia", label: "爬行類" },
    { value: "Insecta", label: "昆蟲綱" },
    { value: "Arachnida", label: "蛛形綱" },
    { value: "Mollusca", label: "軟體動物" },
    { value: "Actinopterygii", label: "輻鰭魚類" },
    { value: "Amphibia", label: "兩棲類" },
    { value: "Protozoa", label: "原生生物" },
    { value: "Animalia", label: "所有動物" },
  ];

  const fetchSuggestions = debounce(async (text: string, group: string) => {
    if (!text || text.trim().length === 0) {
      suggestions = [];
      return;
    }
    let url = `/api/search?q=${encodeURIComponent(text)}`;
    if (group) {
      url += `&group=${encodeURIComponent(group)}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      suggestions = await res.json();
    }
  }, 300);

  $: fetchSuggestions(query, selectedGroup);

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

  let suggestionBox: HTMLUListElement;
  let inputEl: HTMLInputElement;

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
  <div class="flex gap-2">
    <Select bind:value={selectedGroup} size="sm" class="w-40 shrink-0">
      {#each taxonGroups as g}
        <option value={g.value}>{g.label}</option>
      {/each}
    </Select>
    <Input
      id="search"
      size="lg"
      placeholder="Type scientific name, common name or family"
      bind:value={query}
      class="w-full"
    />
  </div>

  {#if suggestions.length}
    <ul class="absolute z-10 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow max-h-60 overflow-y-auto w-full">
      {#each suggestions as item}
        <li>
          <button
            type="button"
            class="w-full text-left px-3 py-2 hover:bg-blue-100 dark:hover:bg-gray-700 text-sm"
            on:click={() => selectSuggestion(item)}
          >
            <span>{item.cname}</span>
            {#if item.matched_as}
              <span class="text-gray-500"> ({@html formatScientificName(item.matched_as.fullname)})</span>
              <span class="text-gray-400 text-xs"> {item.family_cname}({item.family})</span>
              <span class="text-yellow-600 dark:text-yellow-400 text-xs ml-1">[{item.matched_as.status}]</span>
              <span class="text-blue-500 text-xs"> → {@html formatScientificName(item.fullname)}</span>
            {:else}
              <span class="text-gray-500"> ({@html formatScientificName(item.fullname)})</span>
              <span class="text-gray-400 text-xs"> {item.family_cname}({item.family})</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
