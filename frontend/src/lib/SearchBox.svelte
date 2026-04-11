<script lang="ts">
  import { onMount } from "svelte";
  import { Label, Input, Select, Button, Badge, Modal, Checkbox } from "flowbite-svelte";
  import { FilterOutline, CloseOutline } from "flowbite-svelte-icons";
  import { createEventDispatcher } from "svelte";
  import { debounce } from "$lib/utils";
  import { selectedSpecies } from "$stores/speciesStore";
  import { formatScientificName } from '$lib/formatter';

  const dispatch = createEventDispatcher();
  let query = "";
  let suggestions: any[] = [];
  let selectedGroup = "";

  function iucnStyle(cat: string): string {
    const c = (cat || '').replace(/^N(?=LC|DD|VU|NT|EN|CR)/, '');
    switch (c) {
      case 'EX': return 'background:#000;color:#fff';
      case 'EW': return 'background:#542344;color:#fff';
      case 'CR': return 'background:#d81e05;color:#fff';
      case 'EN': return 'background:#fc7f3f;color:#000';
      case 'VU': return 'background:#f9e814;color:#000';
      case 'NT': return 'background:#cce226;color:#000';
      case 'LC': return 'background:#60c659;color:#000';
      case 'DD': return 'background:#d1d1c6;color:#000';
      default:   return 'background:#e5e7eb;color:#000';
    }
  }

  // 篩選面板
  let showFilter = false;
  let filterRank = "";
  let filterTaxonName = "";
  let filterTaxonDisplay = "";
  let filterTaxonQuery = "";
  let filterSuggestions: any[] = [];
  let filterEndemic = false;
  let filterAlienType = "";

  const taxonGroups = [
    { value: "", label: "所有類群", icon: "🌍" },
    { value: "Tracheophyta", label: "維管束植物", icon: "🌿" },
    { value: "Plantae", label: "植物界", icon: "🪴" },
    { value: "Aves", label: "鳥綱", icon: "🐦" },
    { value: "Fungi", label: "真菌界", icon: "🍄" },
    { value: "Mammalia", label: "哺乳類", icon: "🐾" },
    { value: "Reptilia", label: "爬行類", icon: "🦎" },
    { value: "Insecta", label: "昆蟲綱", icon: "🐛" },
    { value: "Arachnida", label: "蛛形綱", icon: "🕷" },
    { value: "Mollusca", label: "軟體動物", icon: "🐚" },
    { value: "Actinopterygii", label: "輻鰭魚類", icon: "🐟" },
    { value: "Amphibia", label: "兩棲類", icon: "🐸" },
    { value: "Protozoa", label: "原生生物", icon: "🦠" },
    { value: "Animalia", label: "所有動物", icon: "🐘" },
  ];

  const filterRankOptions = [
    { value: "", label: "不限階層" },
    { value: "Class", label: "綱" },
    { value: "Order", label: "目" },
    { value: "Family", label: "科" },
    { value: "Genus", label: "屬" },
  ];

  const alienOptions = [
    { value: "", label: "不限" },
    { value: "native", label: "原生" },
    { value: "naturalized", label: "歸化" },
    { value: "invasive", label: "入侵" },
    { value: "cultured", label: "栽培" },
  ];

  const rankLabelMap: Record<string, string> = { Class: "綱", Order: "目", Family: "科", Genus: "屬" };

  $: hasFilter = filterTaxonName || filterEndemic || filterAlienType;
  $: filterBadges = (() => {
    const badges: { label: string; color: string }[] = [];
    // 高階分類群
    if (selectedGroup) {
      const g = taxonGroups.find(t => t.value === selectedGroup);
      if (g) badges.push({ label: `${g.icon} ${g.label}`, color: "green" });
    }
    if (filterTaxonName) {
      badges.push({ label: `${rankLabelMap[filterRank] || filterRank}: ${filterTaxonDisplay}`, color: "blue" });
    }
    if (filterEndemic) badges.push({ label: "特有種", color: "purple" });
    if (filterAlienType) {
      const al = alienOptions.find(a => a.value === filterAlienType);
      badges.push({ label: al?.label || filterAlienType, color: "yellow" });
    }
    return badges;
  })();

  // 主搜尋
  const fetchSuggestions = debounce(async (text: string, group: string) => {
    if (!text || text.trim().length === 0) {
      suggestions = [];
      return;
    }
    let url = `/api/search?q=${encodeURIComponent(text)}`;
    if (group) url += `&group=${encodeURIComponent(group)}`;
    if (filterEndemic) url += `&endemic=true`;
    if (filterAlienType) url += `&alien_type=${encodeURIComponent(filterAlienType)}`;
    if (filterTaxonName && filterRank) {
      const paramMap: Record<string, string> = {
        Family: "family_filter",
        Order: "order_filter",
        Class: "class_filter",
        Genus: "genus_filter",
      };
      const param = paramMap[filterRank];
      if (param) url += `&${param}=${encodeURIComponent(filterTaxonName)}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      suggestions = await res.json();
    }
  }, 300);

  $: fetchSuggestions(query, selectedGroup);

  // 篩選面板 auto-complete（使用專用 API，帶高階分類群限定）
  const fetchFilterSuggestions = debounce(async (text: string, rank: string, group: string) => {
    if (!text || text.trim().length < 1 || !rank) {
      filterSuggestions = [];
      return;
    }
    let url = `/api/search/rank?q=${encodeURIComponent(text)}&rank=${encodeURIComponent(rank)}`;
    if (group) url += `&group=${encodeURIComponent(group)}`;
    const res = await fetch(url);
    if (res.ok) {
      filterSuggestions = await res.json();
    }
  }, 300);

  $: fetchFilterSuggestions(filterTaxonQuery, filterRank, selectedGroup);

  function selectFilterSuggestion(item: any) {
    if (filterRank === "Family") {
      filterTaxonName = item.family || item.name || "";
      filterTaxonDisplay = `${item.family_cname || ""} ${item.family || item.name || ""}`.trim();
    } else if (filterRank === "Genus") {
      filterTaxonName = item.genus || item.name || "";
      filterTaxonDisplay = `${item.genus_c || item.cname || ""} ${item.genus || item.name || ""}`.trim();
    } else if (filterRank === "Order") {
      filterTaxonName = item.order || item.name || "";
      filterTaxonDisplay = item.order || item.name || "";
    } else if (filterRank === "Class") {
      filterTaxonName = item.class_name || item.name || "";
      filterTaxonDisplay = item.class_name || item.name || "";
    } else {
      filterTaxonName = item.name || "";
      filterTaxonDisplay = `${item.cname || ""} ${item.name || ""}`.trim();
    }
    filterTaxonQuery = "";
    filterSuggestions = [];
  }

  function selectGroupFromFilter(value: string) {
    if (selectedGroup !== value && filterTaxonName) {
      if (!confirm(`切換高階分類群將清空已設定的限定分類群「${filterTaxonDisplay}」，確定要切換嗎？`)) {
        return;
      }
      filterRank = "";
      filterTaxonName = "";
      filterTaxonDisplay = "";
      filterTaxonQuery = "";
      filterSuggestions = [];
    }
    selectedGroup = value;
  }

  function applyFilter() {
    showFilter = false;
    filterSuggestions = [];
    if (query) fetchSuggestions(query, selectedGroup);
  }

  function clearFilter() {
    filterRank = "";
    filterTaxonName = "";
    filterTaxonDisplay = "";
    filterTaxonQuery = "";
    filterEndemic = false;
    filterAlienType = "";
    filterSuggestions = [];
    selectedGroup = "";
  }

  // 鍵盤導航
  let highlightIndex = -1;

  function handleKeydown(e: KeyboardEvent) {
    if (!suggestions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, suggestions.length - 1);
      scrollToHighlighted();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      scrollToHighlighted();
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIndex]);
    }
  }

  function scrollToHighlighted() {
    if (!suggestionBox) return;
    const items = suggestionBox.querySelectorAll('li');
    if (items[highlightIndex]) {
      items[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  // 重置 highlight 當建議列表更新
  $: if (suggestions) highlightIndex = -1;

  function selectSuggestion(item: any) {
    selectedSpecies.update(current => {
      if (!current.find(entry => entry.id === item.id)) {
        return [...current, item];
      }
      return current;
    });
    dispatch("select", { value: item });
    query = "";
    suggestions = [];
    highlightIndex = -1;
  }

  let suggestionBox: HTMLUListElement;
  let inputEl: HTMLInputElement;

  onMount(() => {
    const escListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") { suggestions = []; highlightIndex = -1; }
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (!suggestionBox?.contains(event.target as Node) && !inputEl?.contains(event.target as Node)) {
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

<div class="relative w-full max-w-3xl mb-6">
  <Label for="search" class="block mb-2 text-sm font-medium text-gray-700 dark:text-white">
    輸入並查找物種
  </Label>
  <div class="flex gap-2 items-center">
    <Input
      id="search"
      size="lg"
      placeholder="學名、俗名、科名...（↑↓ 選擇, Enter 加入）"
      bind:value={query}
      bind:ref={inputEl}
      on:keydown={handleKeydown}
      class="w-full"
    />
    <Button color={hasFilter || selectedGroup ? 'blue' : 'alternative'} size="sm" class="shrink-0" on:click={() => showFilter = true}>
      <FilterOutline class="w-4 h-4 me-1" />篩選
    </Button>
  </div>

  <!-- Active filter badges -->
  {#if filterBadges.length > 0}
    <div class="flex flex-wrap gap-1 mt-2 items-center">
      {#each filterBadges as b}
        <Badge color={b.color} class="text-xs">{b.label}</Badge>
      {/each}
      <button class="text-xs text-red-500 hover:underline ml-1" on:click={() => { clearFilter(); if (query) fetchSuggestions(query, selectedGroup); }}>清除篩選</button>
    </div>
  {/if}

  <!-- Search suggestions -->
  {#if suggestions.length}
    <ul bind:this={suggestionBox} class="absolute z-[9999] mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto w-full">
      {#each suggestions as item, i}
        <li>
          <button
            type="button"
            class="w-full text-left px-3 py-2 hover:bg-blue-100 dark:hover:bg-gray-700 text-sm
              {i === highlightIndex ? 'bg-blue-100 dark:bg-gray-700' : ''}"
            on:click={() => selectSuggestion(item)}
          >
            {#if item.fuzzy_match}
              <span class="text-orange-500">{item.fuzzy_match.matched}</span>
              <span class="text-gray-500"> ({@html formatScientificName(item.fullname)})</span>
              <span class="text-gray-400 text-xs"> {item.family_cname}({item.family})</span>
              <span class="text-orange-400 text-xs ml-1">≈ 您是否在找？</span>
            {:else}
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
            {/if}
            {#if item.source === '原生'}<Badge color="green" class="text-xs ml-1">原生</Badge>{/if}
            {#if item.source === '歸化'}<Badge color="yellow" class="text-xs ml-1">歸化</Badge>{/if}
            {#if item.source === '栽培'}<Badge color="blue" class="text-xs ml-1">栽培</Badge>{/if}
            {#if item.endemic === 1}<Badge color="purple" class="text-xs ml-1">臺灣特有</Badge>{/if}
            {#if item.redlist}<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ml-1" style={iucnStyle(item.redlist)}>TW:{item.redlist}</span>{/if}
            {#if item.iucn_category}<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold ml-1" style={iucnStyle(item.iucn_category)}>IUCN:{item.iucn_category}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- Filter modal -->
<Modal bind:open={showFilter} title="進階篩選" size="md">
  <div class="space-y-5">

    <!-- 高階分類群 icon 按鈕 -->
    <div>
      <Label class="mb-2 font-semibold">高階分類群</Label>
      <div class="flex flex-wrap gap-2">
        {#each taxonGroups as g}
          <button
            class="flex flex-col items-center gap-1 px-3 py-2 rounded-lg border text-xs transition-colors
              {selectedGroup === g.value
                ? 'bg-blue-100 dark:bg-blue-900 border-blue-400 text-blue-700 dark:text-blue-300'
                : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}"
            on:click={() => selectGroupFromFilter(g.value)}
          >
            <span class="text-lg">{g.icon}</span>
            <span>{g.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- 限定分類群 -->
    <div>
      <Label class="mb-2 font-semibold">限定特定分類群</Label>
      <div class="flex gap-2 items-start">
        <Select bind:value={filterRank} size="sm" class="w-28 shrink-0">
          {#each filterRankOptions as r}
            <option value={r.value}>{r.label}</option>
          {/each}
        </Select>
        <div class="flex-1 relative">
          {#if filterRank}
            {#if filterTaxonName}
              <div class="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 rounded border border-blue-200 dark:border-blue-700">
                <span class="text-sm">{filterTaxonDisplay}</span>
                <button class="text-gray-400 hover:text-red-500" on:click={() => { filterTaxonName = ""; filterTaxonDisplay = ""; }}>
                  <CloseOutline class="w-3 h-3" />
                </button>
              </div>
            {:else}
              <Input
                size="sm"
                placeholder="輸入{rankLabelMap[filterRank] || ''}的學名或俗名..."
                bind:value={filterTaxonQuery}
              />
              {#if filterSuggestions.length > 0}
                <ul class="absolute z-30 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow max-h-40 overflow-y-auto w-full">
                  {#each filterSuggestions as item}
                    <li>
                      <button
                        type="button"
                        class="w-full text-left px-3 py-2 hover:bg-blue-100 dark:hover:bg-gray-700 text-sm"
                        on:click={() => selectFilterSuggestion(item)}
                      >
                        <span>{item.cname || item.name}</span>
                        {#if item.cname}
                          <span class="text-gray-400"> ({item.name})</span>
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {:else}
            <span class="text-sm text-gray-400 py-2">請先選擇階層</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- 特有性 -->
    <div>
      <Label class="mb-2 font-semibold">特有性</Label>
      <Checkbox bind:checked={filterEndemic}>僅顯示特有種</Checkbox>
    </div>

    <!-- 原生/外來 -->
    <div>
      <Label class="mb-2 font-semibold">原生/外來屬性</Label>
      <Select bind:value={filterAlienType} size="sm" class="w-40">
        {#each alienOptions as a}
          <option value={a.value}>{a.label}</option>
        {/each}
      </Select>
    </div>
  </div>

  <svelte:fragment slot="footer">
    <div class="flex gap-2">
      <Button color="alternative" size="sm" on:click={clearFilter}>清除全部</Button>
      <Button color="blue" size="sm" on:click={applyFilter}>套用篩選</Button>
    </div>
  </svelte:fragment>
</Modal>
