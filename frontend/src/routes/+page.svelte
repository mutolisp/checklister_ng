<script lang="ts">
  import { Badge, Button } from 'flowbite-svelte';
  import { Alert, Label, Input } from 'flowbite-svelte';
  import { Dropdown, DropdownItem, DropdownDivider, DropdownHeader } from 'flowbite-svelte';
  import { Navbar, NavBrand, NavHamburger, NavUl, NavLi } from 'flowbite-svelte';
  import { DownloadSolid, ChevronDownOutline, TrashBinOutline } from 'flowbite-svelte-icons';
  import { FileOutline, FileCodeOutline, FileWordOutline } from 'flowbite-svelte-icons';
  import { Card } from 'flowbite-svelte';
  import  SearchBox  from "$lib/SearchBox.svelte";
  import  SpeciesTable from "$lib/SpeciesTable.svelte";
  import  SpeciesList  from "$lib/SpeciesList.svelte";
  import  LoadYAMLButton  from "$lib/LoadYAMLButton.svelte";
  import AmbiguousSelector from "$lib/AmbiguousSelector.svelte"; //模糊比對
  import { selectedSpecies } from "$stores/speciesStore";
  import { downloadYAML } from "$lib/utils";
  import { derived, get } from "svelte/store";
  import { convertToDarwinCore } from '$lib/dwcMapper'; //DwC的解析
  import { importYAMLText } from '$lib/importer'; //匯入yaml或文字檔案
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

	async function exportData(format: string) {
	  const response = await fetch(`/api/export?format=${format}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ checklist: get(selectedSpecies) })
	  });

	  if (!response.ok) {
		alert("❌ 匯出失敗！");
		return;
	  }

	  const blob = await response.blob();
	  const url = URL.createObjectURL(blob);
	  const a = document.createElement("a");
	  a.href = url;
      a.download = `checklist-${format}.zip`
	  a.click();
	  URL.revokeObjectURL(url);
	}

    function clearChecklist() {
      const confirmClear = confirm("你確定要清除目前名錄？");
      if (confirmClear) {
        selectedSpecies.set([]);
      }
    }

    let dark = false;
    function toggleDark() {
      dark = !dark;
      document.documentElement.classList.toggle("dark", dark);
    }

</script>
<Navbar let:hidden let:toggle>
<h1 class="text-2xl font-bold mb-2">checklister-ng 名錄產生器</h1>
<NavHamburger on:click={toggle} />
<NavUl {hidden} class="ms-3 pt-6">
    <NavLi href="/" active={true}>Home</NavLi>
    <NavLi class="cursor-pointer">App</NavLi>
    <NavLi href="/services">Services</NavLi>
    <NavLi href="/pricing">Contact</NavLi>
</NavUl>
</Navbar>

<div class="grid grid-cols-1 gap-8 p-8">
    <!-- div class="flex flex-wrap gap-2" -->
    <div class="grid flex gap-4 md:grid-cols-2">
    <SearchBox />
    <LoadYAMLButton />
    </div>

    <div class="flex flex-wrap gap-2">
    <Button color="alternative">
        <DownloadSolid class="w-8 h-4 me-2" />
        Export
        <ChevronDownOutline class="w-6 h-6 ms-2 text-white dark:text-white" />
    </Button>
    <Dropdown>
      <DropdownItem color="alternative" on:click={() => exportData('docx')}>
        <FileWordOutline class="w-4 h-4 me-2" />匯出Word (.docx)</DropdownItem>
      <DropdownItem on:click={() => exportData('markdown')}>
        <FileOutline class="w-4 h-4 me-2" />匯出 Markdown (.md)</DropdownItem>
      <DropdownItem on:click={exportYAML}>
        <FileCodeOutline class="w-4 h-4 me-2" />匯出支援DwC的YAML</DropdownItem>
      <DropdownDivider />
      <DropdownItem color="red" on:click={exportUnresolved}>匯出未解析俗名</DropdownItem>
    </Dropdown> 
      <Button color="alternative" on:click={clearChecklist}>
        <TrashBinOutline class="w-4 h-4 me-2" /> 清除名錄</Button>
    <Badge large color="green">已選擇/匯入物種數：{$selectedSpecies.length}</Badge>
    </div>

    {#if Array.isArray($unresolvedStore) && $unresolvedStore.length > 0}
      <Alert color="failure" class="mt-2">
        ⚠️ 無法解析的名稱：{$unresolvedStore.join("、")}
      </Alert>
    {/if}

    <AmbiguousSelector />

  {#if $selectedSpecies.length && $groupedSpecies}
      <h2 class="font-semibold text-lg mb-2">已選名錄</h2>
      <!-- SpeciesList groupedSpecies={$groupedSpecies} onRemove={removeSpecies} / -->
      <SpeciesTable 
        data={$selectedSpecies}
        onRemove={removeSpecies}
        onUpdate={(updated) => selectedSpecies.set(updated)} />
  {/if}
</div>