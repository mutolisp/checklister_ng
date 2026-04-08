<script lang="ts">
  import { Button, Card, Badge, Table, TableHead, TableHeadCell, TableBody, TableBodyRow, TableBodyCell, Select } from 'flowbite-svelte';
  import { UploadOutline, TrashBinOutline, DownloadOutline } from 'flowbite-svelte-icons';
  import { selectedSpecies } from '$stores/speciesStore';
  import { parseChecklistYAML } from '$lib/importer';
  import { compareChecklists, sorensen, jaccard, shannonWiener, simpson, evenness, getAbundances, hasAbundanceData } from '$lib/compareUtils';
  import type { ChecklistInput, ComparisonResult } from '$lib/compareUtils';
  import { get } from 'svelte/store';

  let checklists: ChecklistInput[] = [];
  let result: ComparisonResult | null = null;
  let filterMode = "all"; // all, shared, unique-0, unique-1, ...
  let fileInput: HTMLInputElement;

  function addCurrentChecklist() {
    const species = get(selectedSpecies);
    if (species.length === 0) {
      alert("目前名錄為空");
      return;
    }
    checklists = [...checklists, { name: `當前名錄 (${species.length}種)`, species }];
    runCompare();
  }

  function triggerUpload() { fileInput.click(); }

  async function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const text = await file.text();
      try {
        const { species } = parseChecklistYAML(text);
        if (species.length > 0) {
          checklists = [...checklists, { name: file.name.replace('.yml', '').replace('.yaml', ''), species }];
        } else {
          alert(`${file.name} 中沒有找到物種資料`);
        }
      } catch {
        alert(`${file.name} 解析失敗`);
      }
    }
    input.value = '';
    runCompare();
  }

  function removeChecklist(index: number) {
    checklists = checklists.filter((_, i) => i !== index);
    runCompare();
  }

  function runCompare() {
    if (checklists.length >= 2) {
      result = compareChecklists(checklists);
    } else {
      result = null;
    }
  }

  // 相似度矩陣
  $: similarityMatrix = (() => {
    if (!result || checklists.length < 2) return null;
    const names = checklists.map(c => c.name);
    const sets = checklists.map(c => result!.sets.get(c.name)!);
    return {
      names,
      sorensen: names.map((_, i) => names.map((_, j) => i === j ? 1 : sorensen(sets[i], sets[j]))),
      jaccard: names.map((_, i) => names.map((_, j) => i === j ? 1 : jaccard(sets[i], sets[j]))),
    };
  })();

  // 多樣性指數
  $: diversityStats = checklists.map(c => {
    const abundances = getAbundances(c.species);
    const hasAbund = hasAbundanceData(c.species);
    const h = hasAbund ? shannonWiener(abundances) : null;
    const d = hasAbund ? simpson(abundances) : null;
    const j = h !== null ? evenness(h, c.species.length) : null;
    return {
      name: c.name,
      richness: c.species.length,
      shannon: h,
      simpson: d,
      evenness: j,
      hasAbundance: hasAbund,
    };
  });

  // 過濾後的矩陣
  $: filteredMatrix = (() => {
    if (!result) return [];
    if (filterMode === "all") return result.matrix;
    if (filterMode === "shared") return result.matrix.filter(r => r.lists.every(Boolean));
    if (filterMode.startsWith("unique-")) {
      const idx = parseInt(filterMode.split("-")[1]);
      return result.matrix.filter(r => r.lists[idx] && r.lists.filter(Boolean).length === 1);
    }
    if (filterMode.startsWith("atleast-")) {
      const n = parseInt(filterMode.split("-")[1]);
      return result.matrix.filter(r => r.lists.filter(Boolean).length >= n);
    }
    return result.matrix;
  })();

  function exportReport() {
    if (!result) return;
    let csv = "物種,俗名," + checklists.map(c => c.name).join(",") + "\n";
    for (const row of result.matrix) {
      csv += `"${row.name}","${row.cname}",${row.lists.map(b => b ? "1" : "0").join(",")}\n`;
    }
    csv += "\n\n相似度矩陣 (Sørensen)\n";
    if (similarityMatrix) {
      csv += "," + similarityMatrix.names.join(",") + "\n";
      for (let i = 0; i < similarityMatrix.names.length; i++) {
        csv += `"${similarityMatrix.names[i]}",${similarityMatrix.sorensen[i].map(v => v.toFixed(3)).join(",")}\n`;
      }
    }
    csv += "\n多樣性指數\n名錄,物種數,Shannon H',Simpson D,Evenness J'\n";
    for (const s of diversityStats) {
      csv += `"${s.name}",${s.richness},${s.shannon?.toFixed(4) ?? "N/A"},${s.simpson?.toFixed(4) ?? "N/A"},${s.evenness?.toFixed(4) ?? "N/A"}\n`;
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comparison_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="max-w-6xl mx-auto p-6">
  <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">名錄比較</h1>

  <!-- A: 名錄輸入區 -->
  <Card class="mb-6 max-w-none" size="xl">
    <div class="flex flex-wrap gap-2 mb-4">
      <Button size="sm" color="blue" on:click={addCurrentChecklist}>加入當前名錄</Button>
      <input type="file" accept=".yml,.yaml" multiple bind:this={fileInput} on:change={handleUpload} class="hidden" />
      <Button size="sm" color="alternative" on:click={triggerUpload}>
        <UploadOutline class="w-4 h-4 me-1" />上傳 YAML（可多選）
      </Button>
      {#if result}
        <span class="flex-1"></span>
        <Button size="sm" color="green" on:click={exportReport}>
          <DownloadOutline class="w-4 h-4 me-1" />匯出報告 (CSV)
        </Button>
      {/if}
    </div>

    <div class="flex flex-wrap gap-2">
      {#each checklists as cl, i}
        <Badge color="blue" class="text-sm py-1 px-3">
          {cl.name} ({cl.species.length}種)
          <button class="ml-2 text-red-400 hover:text-red-600" on:click={() => removeChecklist(i)}>×</button>
        </Badge>
      {/each}
      {#if checklists.length < 2}
        <span class="text-sm text-gray-400">請加入至少 2 個名錄以進行比較</span>
      {/if}
    </div>
  </Card>

  {#if result}
    <!-- B: 統計指數 -->
    <Card class="mb-6 max-w-none" size="xl">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">多樣性指數</h3>
      <Table class="text-sm">
        <TableHead>
          <TableHeadCell>名錄</TableHeadCell>
          <TableHeadCell>物種數</TableHeadCell>
          <TableHeadCell>共同種</TableHeadCell>
          <TableHeadCell>獨有種</TableHeadCell>
          <TableHeadCell>Shannon H'</TableHeadCell>
          <TableHeadCell>Simpson D</TableHeadCell>
          <TableHeadCell>Evenness J'</TableHeadCell>
        </TableHead>
        <TableBody>
          {#each diversityStats as stat, i}
            <TableBodyRow>
              <TableBodyCell class="font-medium">{stat.name}</TableBodyCell>
              <TableBodyCell>{stat.richness}</TableBodyCell>
              <TableBodyCell>{result.shared.length}</TableBodyCell>
              <TableBodyCell>{result.unique.get(checklists[i].name)?.length || 0}</TableBodyCell>
              <TableBodyCell>{stat.shannon !== null ? stat.shannon.toFixed(4) : '—'}</TableBodyCell>
              <TableBodyCell>{stat.simpson !== null ? stat.simpson.toFixed(4) : '—'}</TableBodyCell>
              <TableBodyCell>{stat.evenness !== null ? stat.evenness.toFixed(4) : '—'}</TableBodyCell>
            </TableBodyRow>
          {/each}
        </TableBody>
      </Table>
    </Card>

    <!-- 相似度矩陣 -->
    {#if similarityMatrix && checklists.length >= 2}
      <Card class="mb-6 max-w-none" size="xl">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">相似度矩陣</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 class="text-sm font-semibold text-gray-500 mb-2">Sørensen</h4>
            <Table class="text-xs">
              <TableHead>
                <TableHeadCell></TableHeadCell>
                {#each similarityMatrix.names as n}<TableHeadCell class="text-xs">{n}</TableHeadCell>{/each}
              </TableHead>
              <TableBody>
                {#each similarityMatrix.names as n, i}
                  <TableBodyRow>
                    <TableBodyCell class="font-medium text-xs">{n}</TableBodyCell>
                    {#each similarityMatrix.sorensen[i] as v, j}
                      <TableBodyCell class="text-xs {i === j ? 'bg-gray-100 dark:bg-gray-700' : ''}">{v.toFixed(3)}</TableBodyCell>
                    {/each}
                  </TableBodyRow>
                {/each}
              </TableBody>
            </Table>
          </div>
          <div>
            <h4 class="text-sm font-semibold text-gray-500 mb-2">Jaccard</h4>
            <Table class="text-xs">
              <TableHead>
                <TableHeadCell></TableHeadCell>
                {#each similarityMatrix.names as n}<TableHeadCell class="text-xs">{n}</TableHeadCell>{/each}
              </TableHead>
              <TableBody>
                {#each similarityMatrix.names as n, i}
                  <TableBodyRow>
                    <TableBodyCell class="font-medium text-xs">{n}</TableBodyCell>
                    {#each similarityMatrix.jaccard[i] as v, j}
                      <TableBodyCell class="text-xs {i === j ? 'bg-gray-100 dark:bg-gray-700' : ''}">{v.toFixed(3)}</TableBodyCell>
                    {/each}
                  </TableBodyRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    {/if}

    <!-- C: 物種矩陣 -->
    <Card class="max-w-none" size="xl">
      <div class="flex flex-wrap gap-2 mb-4 items-center">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">物種比較矩陣</h3>
        <span class="flex-1"></span>
        <Select bind:value={filterMode} size="sm" class="w-48">
          <option value="all">所有物種 ({result.matrix.length})</option>
          <option value="shared">共同種 ({result.shared.length})</option>
          {#each checklists as cl, i}
            <option value="unique-{i}">{cl.name} 獨有 ({result.unique.get(cl.name)?.length || 0})</option>
          {/each}
          {#if checklists.length > 2}
            {#each Array.from({length: checklists.length - 1}, (_, i) => i + 2) as n}
              <option value="atleast-{n}">至少 {n} 個名錄</option>
            {/each}
          {/if}
        </Select>
      </div>

      <div class="overflow-x-auto max-h-96 overflow-y-auto">
        <Table class="text-sm">
          <TableHead>
            <TableHeadCell>學名</TableHeadCell>
            <TableHeadCell>俗名</TableHeadCell>
            {#each checklists as cl}
              <TableHeadCell class="text-center text-xs">{cl.name}</TableHeadCell>
            {/each}
          </TableHead>
          <TableBody>
            {#each filteredMatrix as row}
              <TableBodyRow>
                <TableBodyCell class="italic text-xs">{row.name}</TableBodyCell>
                <TableBodyCell class="text-xs">{row.cname}</TableBodyCell>
                {#each row.lists as present}
                  <TableBodyCell class="text-center">{present ? '✓' : ''}</TableBodyCell>
                {/each}
              </TableBodyRow>
            {/each}
          </TableBody>
        </Table>
      </div>
      <p class="text-xs text-gray-400 mt-2">顯示 {filteredMatrix.length} 種</p>
    </Card>
  {/if}
</div>
