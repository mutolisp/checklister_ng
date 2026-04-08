<script lang="ts">
  import { Badge, Button } from 'flowbite-svelte';
  import { Alert, Label, Input } from 'flowbite-svelte';
  import { Dropdown, DropdownItem, DropdownDivider, DropdownHeader } from 'flowbite-svelte';
  // Navbar moved to +layout.svelte
  import { DownloadSolid, ChevronDownOutline, TrashBinOutline } from 'flowbite-svelte-icons';
  import { FileOutline, FileCodeOutline, FileWordOutline } from 'flowbite-svelte-icons';
  import { Card } from 'flowbite-svelte';
  import  SearchBox  from "$lib/SearchBox.svelte";
  import  SpeciesTable from "$lib/SpeciesTable.svelte";
  import  SpeciesList  from "$lib/SpeciesList.svelte";
  import  LoadYAMLButton  from "$lib/LoadYAMLButton.svelte";
  import AmbiguousSelector from "$lib/AmbiguousSelector.svelte";
  import SpeciesDetailView from "$lib/SpeciesDetailView.svelte";
  import ExportSettings from "$lib/ExportSettings.svelte";
  import MapPreview from "$lib/MapPreview.svelte";
  import { selectedSpecies } from "$stores/speciesStore";
  import { projectMetadata } from "$stores/metadataStore";
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
      const meta = get(projectMetadata);
	  const metadata: any = {
		version: "1.0",
		exported_at: new Date().toISOString(),
		generated_by: "checklister-ng App",
		checklist,
	  };
	  if (meta.projectName) metadata.project = meta.projectName;
	  if (meta.siteName) metadata.site = meta.siteName;
	  if (meta.footprintWKT) metadata.footprintWKT = meta.footprintWKT;
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

    // 匯出設定
    let showExportSettings = false;
    let exportLevels: string[] = [];

	async function exportData(format: string) {
	  let exportUrl = `/api/export?format=${format}`;
	  if (exportLevels.length > 0) {
	    exportUrl += `&levels=${exportLevels.join(',')}`;
	  }
	  const meta = get(projectMetadata);
	  const response = await fetch(exportUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
		  checklist: get(selectedSpecies),
		  project: meta.projectName || "",
		  site: meta.siteName || "",
		  footprintWKT: meta.footprintWKT || "",
		})
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

    // 物種詳細頁狀態
    let viewMode: 'table' | 'detail' = 'table';
    let activeSpeciesId: number | null = null;

    function openDetail(item: any) {
      activeSpeciesId = item.id;
      viewMode = 'detail';
    }

    function backToTable() {
      viewMode = 'table';
      activeSpeciesId = null;
    }

</script>
<div class="flex flex-col h-screen">

<!-- Zone A: sticky toolbar -->
<div class="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-8 py-4 space-y-4">
    <div class="flex flex-wrap gap-2 items-center">
      <SearchBox />
      <LoadYAMLButton />
    </div>

    <div class="flex flex-wrap gap-2 items-center">
      <Button color="alternative" size="sm">
        <DownloadSolid class="w-4 h-4 me-1" />Export
        <ChevronDownOutline class="w-4 h-4 ms-1" />
      </Button>
      <Dropdown>
        <DropdownItem on:click={() => exportData('docx')}>
          <FileWordOutline class="w-4 h-4 me-2" />匯出 Word (.docx)</DropdownItem>
        <DropdownItem on:click={() => exportData('markdown')}>
          <FileOutline class="w-4 h-4 me-2" />匯出 Markdown (.md)</DropdownItem>
        <DropdownItem on:click={exportYAML}>
          <FileCodeOutline class="w-4 h-4 me-2" />匯出 DwC YAML</DropdownItem>
        <DropdownDivider />
        <DropdownItem color="red" on:click={exportUnresolved}>匯出未解析俗名</DropdownItem>
      </Dropdown>
      <Button color="alternative" size="sm" on:click={clearChecklist}>
        <TrashBinOutline class="w-4 h-4 me-1" />清除名錄</Button>
      <ExportSettings bind:show={showExportSettings} bind:levels={exportLevels} />
      <MapPreview />
      <Badge large color="green">已選擇/匯入物種數：{$selectedSpecies.length}</Badge>
    </div>

    {#if Array.isArray($unresolvedStore) && $unresolvedStore.length > 0}
      <Alert color="failure">
        ⚠️ 無法解析的名稱：{$unresolvedStore.join("、")}
      </Alert>
    {/if}

    <AmbiguousSelector />
</div>

<!-- Main content area -->
<div class="flex-1 overflow-hidden">
  {#if viewMode === 'table'}
    <div class="p-8 overflow-y-auto h-full">
      {#if $selectedSpecies.length && $groupedSpecies}
        <h2 class="font-semibold text-lg mb-2">已選名錄</h2>
        <SpeciesTable
          data={$selectedSpecies}
          onRemove={removeSpecies}
          onUpdate={(updated) => selectedSpecies.set(updated)}
          onRowClick={openDetail} />
      {/if}
    </div>
  {:else}
    <SpeciesDetailView
      species={$selectedSpecies}
      {activeSpeciesId}
      onSelectSpecies={(id) => activeSpeciesId = id}
      onBack={backToTable}
      onDelete={(id) => {
        removeSpecies(id);
        // 如果刪除的是當前顯示的，選下一個或回到名錄
        if (id === activeSpeciesId) {
          const remaining = get(selectedSpecies);
          activeSpeciesId = remaining.length > 0 ? remaining[0].id : null;
          if (!activeSpeciesId) backToTable();
        }
      }}
    />
  {/if}
</div>
</div>