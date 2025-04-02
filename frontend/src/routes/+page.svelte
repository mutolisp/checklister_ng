<script lang="ts">
  import  SearchBox  from "$lib/SearchBox.svelte";
  import  SpeciesList  from "$lib/SpeciesList.svelte";
  import { selectedSpecies } from "$stores/speciesStore";
  import { downloadYAML } from "$lib/utils";
  import  LoadYAMLButton  from "$lib/LoadYAMLButton.svelte";
  import { derived, get } from "svelte/store";

  const typeOrder = {
  "苔蘚地衣類植物 Mosses and Lichens": 0,
  "石松類植物 Lycophytes": 1,
  "蕨類植物 Monilophytes": 2,
  "裸子植物 Gymnosperms": 3,
  "單子葉植物 Monocots": 4,
  "真雙子葉植物姊妹群 Sister groups of Eudicots": 5,
  "真雙子葉植物 Eudicots": 6,
  };

  // 將 selectedSpecies 依 pt_name → family 分組
  const groupedSpecies = derived(selectedSpecies, ($selectedSpecies) => {
	  const map = new Map();
	  for (const item of $selectedSpecies) {
		const pt = item.pt_name;
		const fam = item.family;
		if (!map.has(pt)) map.set(pt, new Map());
		const famMap = map.get(pt);
		if (!famMap.has(fam)) famMap.set(fam, []);
		famMap.get(fam).push(item);
	  }

	  // sort pt_name, family,fullname
	  const sorted = new Map(
		Array.from(map.entries())
		  .sort(([a], [b]) => typeOrder[a] - typeOrder[b])
		  .map(([pt, famMap]) => [
			pt,
			new Map(
			  Array.from(famMap.entries())
				.sort(([a], [b]) => a.localeCompare(b)) // family 排序
				.map(([fam, list]) => [
				  fam,
				  list.sort((a, b) => a.fullname.localeCompare(b.fullname)) // fullname 排序
				])
			)
		  ])
	  );

	  return sorted;
	});

  function removeSpecies(id: number) {
    const current = get(selectedSpecies);
    selectedSpecies.set(current.filter(item => item.id !== id));
  }

  function exportYAML() {
    const list = get(selectedSpecies);
    downloadYAML(list, "checklist.yml");
  }
</script>

<h1 class="text-2xl font-bold mb-4">checklister-ng 名錄產生器</h1>

<SearchBox />
<div class="mt-4 flex gap-2 items-center">
  <LoadYAMLButton />
  <button on:click={exportYAML} class="bg-blue-600 text-white px-4 py-2 rounded">
    匯出 YAML
  </button>
</div>

<!-- 顯示已選名錄 -->
{#if $selectedSpecies.length && $groupedSpecies}
  <h2 class="mt-6 font-semibold text-lg">已選名錄：</h2>
  <SpeciesList groupedSpecies={$groupedSpecies} onRemove={removeSpecies} />
{/if}
