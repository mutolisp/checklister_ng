<script lang="ts">
  import {
    Table, TableBody, TableBodyRow, TableBodyCell, TableHead, TableHeadCell,
    Select, Input, Button
  } from 'flowbite-svelte';
  import { Section } from 'flowbite-svelte-blocks';
  import { formatScientificName } from '$lib/formatter';

  export let data: any[] = [];
  export let onRemove: (id: number) => void;
  export let onUpdate: (updated: any[]) => void = () => {};

  let currentPage = 1;
  let perPage = 10;
  let selectedIds = new Set<number>();
  let search = "";
  let filterFamily = "";

  $: families = Array.from(new Set(data.map(d => d.family))).sort();
  $: filtered = data.filter(d => {
    const match = d.fullname.includes(search) || d.cname?.includes?.(search);
    const familyMatch = filterFamily ? d.family === filterFamily : true;
    return match && familyMatch;
  });

  $: pageCount = Math.ceil(filtered.length / perPage);
  $: paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  $: {
  if (currentPage > pageCount) {
    currentPage = pageCount || 1;
    }
  }

  function toggleAllChecked(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      selectedIds = new Set(filtered.map(item => item.id));
    } else {
      selectedIds = new Set();
    }
  }

  function toggleItem(id: number, checked: boolean) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    selectedIds = new Set(selectedIds); // force update
  }

  function removeSelected() {
    if (selectedIds.size === 0) return;
    const confirmDelete = confirm(`你確定要刪除 ${selectedIds.size} 筆資料嗎？`);
    if (!confirmDelete) return;
    const updated = data.filter(d => !selectedIds.has(d.id));
    selectedIds = new Set();
    onUpdate?.(updated);
  }

  function goToPage(p: number) {
    if (p >= 1 && p <= pageCount) {
      currentPage = p;
    }
  }

  $: visiblePages = (() => {
    const range = 2; // 前後最多兩頁
    let start = Math.max(1, currentPage - range);
    let end = Math.min(pageCount, currentPage + range);
    if (end - start < 4) {
      if (start === 1) end = Math.min(start + 4, pageCount);
      else if (end === pageCount) start = Math.max(end - 4, 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  })();
</script>

<Section class="p-6 rounded bg-white dark:bg-gray-800">
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
    <Input bind:value={search} placeholder="搜尋學名或中文名..." class="w-full" />
    <Select bind:value={filterFamily} class="w-full">
      <option value="">全部科別</option>
      {#each families as fam}
        <option value={fam}>{fam}</option>
      {/each}
    </Select>
    <Select bind:value={perPage} class="w-full">
      <option value="10">每頁 10 筆</option>
      <option value="20">每頁 20 筆</option>
      <option value="50">每頁 50 筆</option>
    </Select>
    <Button color="red" on:click={removeSelected} disabled={selectedIds.size === 0} class="w-full">
      批次刪除 ({selectedIds.size})
    </Button>
  </div>

  <Table class="text-sm">
    <TableHead>
      <TableHeadCell><input type="checkbox" on:change={toggleAllChecked} /></TableHeadCell>
      <TableHeadCell>ID</TableHeadCell>
      <TableHeadCell>科名</TableHeadCell>
      <TableHeadCell>俗名</TableHeadCell>
      <TableHeadCell>學名</TableHeadCell>
      <TableHeadCell>來源</TableHeadCell>
      <TableHeadCell>特有</TableHeadCell>
    </TableHead>
    <TableBody>
      {#each paginated as item}
        <TableBodyRow class="hover:bg-gray-100 h-10">
          <TableBodyCell>
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              on:change={(e) => toggleItem(item.id, e.target.checked)}
            />
          </TableBodyCell>
          <TableBodyCell>{item.id}</TableBodyCell>
          <TableBodyCell>{item.family_cname} ({item.family})</TableBodyCell>
          <TableBodyCell>{item.cname}</TableBodyCell>
          <TableBodyCell>{@html formatScientificName(item.fullname)}</TableBodyCell>
          <TableBodyCell>{item.source}</TableBodyCell>
          <TableBodyCell>{item.endemic === 1 ? '✅' : ''}</TableBodyCell>
        </TableBodyRow>
      {/each}
    </TableBody>
  </Table>

  <!-- Custom pagination buttons -->
  {#if pageCount > 1}
    <div class="flex justify-center items-center gap-1 mt-4">
      <Button size="sm" color="light" on:click={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>
        ‹
      </Button>

      {#each visiblePages as p}
        <Button
          size="sm"
          color={p === currentPage ? 'blue' : 'light'}
          on:click={() => goToPage(p)}>
          {p}
        </Button>
      {/each}

      <Button size="sm" color="light" on:click={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount}>
        ›
      </Button>
    </div>
  {/if}

  <p class="text-sm text-gray-500 mt-2 text-center">
    顯示 {Math.min((currentPage - 1) * perPage + 1, filtered.length)} -
    {Math.min(currentPage * perPage, filtered.length)} 筆，共 {filtered.length} 筆
  </p>
</Section>
