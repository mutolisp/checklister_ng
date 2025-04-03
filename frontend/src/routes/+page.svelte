<script lang="ts">
  import  SearchBox  from "$lib/SearchBox.svelte";
  import  SpeciesList  from "$lib/SpeciesList.svelte";
  import { selectedSpecies } from "$stores/speciesStore";
  import { downloadYAML } from "$lib/utils";
  import  LoadYAMLButton  from "$lib/LoadYAMLButton.svelte";
  import { derived, get } from "svelte/store";
  import { convertToDarwinCore } from '$lib/dwcMapper'; //DwC的解析
  import { importYAMLText } from '$lib/importer'; //匯入yaml或文字檔案
  import AmbiguousSelector from "$lib/AmbiguousSelector.svelte"; //模糊比對
  import { unresolvedStore } from "$stores/importState"; //未解析的名字

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

	  // sort pt_name, family, fullname
	  const sorted = new Map(
		Array.from(map.entries())
		  .sort(([a], [b]) => typeOrder[a] - typeOrder[b])
		  .map(([pt, famMap]) => [
			pt,
			new Map(
			  Array.from(famMap.entries())
                .sort((a, b) => (a.family ?? "").localeCompare(b.family ?? ""))
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
      //const list = get(selectedSpecies);
      //downloadYAML(list, "checklist.yml");
	  //const checklist = get(selectedSpecies);

      const raw = get(selectedSpecies);
      const checklist = raw.map(convertToDarwinCore);
	  const metadata = {
		version: "1.0",
		exported_at: new Date().toISOString(),
		generated_by: "checklister-ng App",
		//project: metadataStore.project ?? "",
		//site: metadataStore.site ?? "",
		//geometry: metadataStore.geometry ?? null,
		checklist,
	  };
	  downloadYAML(metadata, "checklist.yml");
	}
    
    let errorMsg = "";
    async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const err = await importYAMLText(file);
      if (err) {
        errorMsg = err;
      } else {
        errorMsg = "";
        alert("✅ 匯入成功！");
      }
     }
    }
	function exportUnresolved() {
	  if (Array.isArray($unresolvedStore)) {
		const content = $unresolvedStore.join("\n");
		const blob = new Blob([content], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "unresolved.txt";
		a.click();
		URL.revokeObjectURL(url);
	  }
	}

</script>

<h1 class="text-2xl font-bold mb-4">checklister-ng 名錄產生器</h1>

<div class="container mx-auto px-4 py-6">
<SearchBox />
<div class="mt-4 flex gap-2 items-center">
  <LoadYAMLButton />
  <button on:click={exportYAML} class="bg-blue-600 text-white px-4 py-2 rounded">
    匯出支援DwC的YAML
  </button>
</div>

<button on:click={exportUnresolved} class="mt-2 text-sm px-3 py-1 bg-yellow-100 border rounded hover:bg-yellow-200">
    ⬇ 匯出未解析俗名
 </button>

<p class="text-sm text-gray-700 mt-2">
✅ 目前已匯入物種筆數：{$selectedSpecies.length}
</p>

{#if Array.isArray($unresolvedStore) && $unresolvedStore.length > 0}
  <div class="mt-2 text-red-500 text-sm">
    ⚠️ 無法解析的名稱：{$unresolvedStore.join("、")}
  </div>
{/if}

<AmbiguousSelector />
</div>
<!-- 顯示已選名錄 -->
{#if $selectedSpecies.length && $groupedSpecies}
  <h2 class="mt-6 font-semibold text-lg">已選名錄：</h2>
  <SpeciesList groupedSpecies={$groupedSpecies} onRemove={removeSpecies} />
{/if}
