<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Table, TableBody, TableBodyRow, TableBodyCell, TableHead, TableHeadCell,
    Select, Input, Button
  } from 'flowbite-svelte';
  import { TrashBinOutline } from 'flowbite-svelte-icons';
  import { Section } from 'flowbite-svelte-blocks';
  import { formatScientificName } from '$lib/formatter';

  export let data: any[] = [];
  export let onRemove: (id: number) => void;
  export let onUpdate: (updated: any[]) => void = () => {};
  export let onRowClick: (item: any) => void = () => {};

  let currentPage = 1;
  let perPage = 10;
  let selectedIds = new Set<number>();
  let search = "";
  let filterFamily = "";

  // 排序狀態
  type SortKey = 'id' | 'family' | 'cname' | 'fullname' | 'source' | 'endemic' | 'abundance';
  let sortKey: SortKey | null = null;
  let sortAsc = true;

  const strokeCollator = new Intl.Collator('zh-Hant', { collation: 'stroke' });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
    currentPage = 1;
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortAsc ? ' ▲' : ' ▼';
  }

  $: families = Array.from(new Set(data.map(d => d.family))).sort();
  $: filtered = data.filter(d => {
    const match = d.fullname.includes(search) || d.cname?.includes?.(search);
    const familyMatch = filterFamily ? d.family === filterFamily : true;
    return match && familyMatch;
  });

  $: sorted = (() => {
    if (!sortKey) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':
          cmp = a.id - b.id;
          break;
        case 'family':
          cmp = (a.family || '').localeCompare(b.family || '');
          break;
        case 'cname':
          cmp = strokeCollator.compare(a.cname || '', b.cname || '');
          break;
        case 'fullname':
          cmp = (a.fullname || '').localeCompare(b.fullname || '');
          break;
        case 'source':
          cmp = (a.source || '').localeCompare(b.source || '');
          break;
        case 'endemic':
          cmp = (a.endemic || 0) - (b.endemic || 0);
          break;
        case 'abundance':
          cmp = (a.abundance || 0) - (b.abundance || 0);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  })();

  $: pageCount = Math.ceil(sorted.length / perPage);
  $: paginated = sorted.slice((currentPage - 1) * perPage, currentPage * perPage);
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
    selectedIds = new Set(selectedIds);
  }

  function removeSelected() {
    if (selectedIds.size === 0) return;
    const confirmDelete = confirm(`你確定要刪除 ${selectedIds.size} 筆資料嗎？`);
    if (!confirmDelete) return;
    const updated = data.filter(d => !selectedIds.has(d.id));
    selectedIds = new Set();
    onUpdate?.(updated);
  }

  // 鍵盤快捷鍵：Delete/Backspace 刪除已勾選項目
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // 避免在輸入框中觸發
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (selectedIds.size > 0) {
        e.preventDefault();
        removeSelected();
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
  });

  function goToPage(p: number) {
    if (p >= 1 && p <= pageCount) {
      currentPage = p;
    }
  }

  $: visiblePages = (() => {
    const range = 2;
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
  <!-- 搜尋 + 科別篩選 + 刪除按鈕 -->
  <div class="flex flex-wrap gap-2 mb-4 items-center">
    <Input bind:value={search} placeholder="搜尋學名或中文名..." class="w-48 lg:w-64" size="sm" />
    <Select bind:value={filterFamily} class="w-40" size="sm">
      <option value="">全部科別</option>
      {#each families as fam}
        <option value={fam}>{fam}</option>
      {/each}
    </Select>
    <span class="flex-1"></span>
    <Button color="red" size="sm" on:click={removeSelected} disabled={selectedIds.size === 0}>
      <TrashBinOutline class="w-3 h-3 me-1" />刪除 ({selectedIds.size})
    </Button>
  </div>

  <Table class="text-sm">
    <TableHead>
      <TableHeadCell><input type="checkbox" on:change={toggleAllChecked} /></TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('id')}>ID{sortIndicator('id')}</TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('family')}>科名{sortIndicator('family')}</TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('cname')}>俗名{sortIndicator('cname')}</TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('fullname')}>學名{sortIndicator('fullname')}</TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('source')}>來源{sortIndicator('source')}</TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('endemic')}>特有{sortIndicator('endemic')}</TableHeadCell>
      <TableHeadCell class="cursor-pointer select-none" on:click={() => toggleSort('abundance')}>數量{sortIndicator('abundance')}</TableHeadCell>
    </TableHead>
    <TableBody>
      {#each paginated as item}
        <TableBodyRow class="hover:bg-gray-100 h-10 cursor-pointer" on:click={(e) => {
            if ((e.target).closest('input[type="checkbox"]')) return;
            onRowClick(item);
          }}>
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
          <TableBodyCell>
            <input
              type="number"
              min="0"
              class="w-16 text-xs border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 bg-transparent text-center"
              value={item.abundance || 0}
              on:click|stopPropagation
              on:change={(e) => {
                const val = parseInt(e.target.value) || 0;
                const updated = data.map(d => d.id === item.id ? { ...d, abundance: val } : d);
                onUpdate(updated);
              }}
            />
          </TableBodyCell>
        </TableBodyRow>
      {/each}
    </TableBody>
  </Table>

  <!-- 分頁 + 每頁筆數 -->
  <div class="flex justify-center items-center gap-2 mt-4 flex-wrap">
    {#if pageCount > 1}
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
    {/if}

    <span class="text-sm text-gray-500 ml-2">
      顯示
    </span>
    <Select bind:value={perPage} size="sm" class="w-20 inline-block">
      <option value={10}>10</option>
      <option value={20}>20</option>
      <option value={50}>50</option>
      <option value={100}>100</option>
    </Select>
    <span class="text-sm text-gray-500">
      筆/頁，共 {sorted.length} 筆
    </span>
  </div>
</Section>
