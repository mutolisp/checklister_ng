<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Table, TableBody, TableBodyRow, TableBodyCell, TableHead, TableHeadCell,
    Select, Input, Button, Dropdown, DropdownItem, Checkbox
  } from 'flowbite-svelte';
  import { TrashBinOutline, AdjustmentsHorizontalOutline } from 'flowbite-svelte-icons';
  import { Section } from 'flowbite-svelte-blocks';
  import { formatScientificName } from '$lib/formatter';
  import { browser } from '$app/environment';

  export let data: any[] = [];
  export let onRemove: (id: string) => void;
  export let onUpdate: (updated: any[]) => void = () => {};
  export let onRowClick: (item: any) => void = () => {};

  let currentPage = 1;
  let perPage = 10;
  let selectedIds = new Set<string>();
  let search = "";
  let filterFamily = "";

  // 欄位定義
  type ColumnDef = {
    key: string;
    label: string;
    defaultVisible: boolean;
  };

  const allColumns: ColumnDef[] = [
    { key: 'taxon_id', label: 'TaxonID', defaultVisible: true },
    { key: 'family', label: '科名', defaultVisible: true },
    { key: 'cname', label: '俗名', defaultVisible: true },
    { key: 'fullname', label: '學名', defaultVisible: true },
    { key: 'source', label: '來源', defaultVisible: false },
    { key: 'endemic', label: '特有', defaultVisible: false },
    { key: 'redlist', label: '臺灣紅皮書', defaultVisible: true },
    { key: 'iucn_category', label: 'IUCN', defaultVisible: false },
    { key: 'cites', label: 'CITES', defaultVisible: true },
    { key: 'protected', label: '保育類', defaultVisible: true },
    { key: 'abundance', label: '數量', defaultVisible: true },
  ];

  // 從 localStorage 讀取使用者偏好
  const storedCols = browser ? localStorage.getItem('speciesTable_columns') : null;
  let visibleColumns: Set<string> = storedCols
    ? new Set(JSON.parse(storedCols))
    : new Set(allColumns.filter(c => c.defaultVisible).map(c => c.key));

  function toggleColumn(key: string) {
    if (visibleColumns.has(key)) {
      visibleColumns.delete(key);
    } else {
      visibleColumns.add(key);
    }
    visibleColumns = new Set(visibleColumns);
    if (browser) {
      localStorage.setItem('speciesTable_columns', JSON.stringify([...visibleColumns]));
    }
  }

  $: isColumnVisible = (key: string) => visibleColumns.has(key);

  // 排序狀態
  type SortKey = 'taxon_id' | 'family' | 'cname' | 'fullname' | 'source' | 'endemic' | 'redlist' | 'iucn_category' | 'cites' | 'protected' | 'abundance';
  let sortKey: SortKey | null = null;
  let sortAsc = true;

  const strokeCollator = new Intl.Collator('zh-Hant', { collation: 'stroke' });

  // IUCN 官方色系
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
      case 'NE': return 'background:#fff;color:#000;border:1px solid #ccc';
      default:   return 'background:#e5e7eb;color:#000';
    }
  }

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
        case 'taxon_id':
          cmp = (a.taxon_id || '').localeCompare(b.taxon_id || '');
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
        case 'redlist':
          cmp = (a.redlist || '').localeCompare(b.redlist || '');
          break;
        case 'iucn_category':
          cmp = (a.iucn_category || '').localeCompare(b.iucn_category || '');
          break;
        case 'cites':
          cmp = (a.cites || '').localeCompare(b.cites || '');
          break;
        case 'protected':
          cmp = (a.protected || '').localeCompare(b.protected || '');
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
      selectedIds = new Set(filtered.map(item => item.taxon_id));
    } else {
      selectedIds = new Set();
    }
  }

  function toggleItem(id: string, checked: boolean) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    selectedIds = new Set(selectedIds);
  }

  function removeSelected() {
    if (selectedIds.size === 0) return;
    const confirmDelete = confirm(`你確定要刪除 ${selectedIds.size} 筆資料嗎？`);
    if (!confirmDelete) return;
    const updated = data.filter(d => !selectedIds.has(d.taxon_id));
    selectedIds = new Set();
    onUpdate?.(updated);
  }

  // 鍵盤快捷鍵：Delete/Backspace 刪除已勾選項目
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
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

<Section class="p-4 rounded bg-white dark:bg-gray-800">
  <!-- 搜尋 + 科別篩選 + 欄位設定 + 刪除按鈕 -->
  <div class="flex flex-wrap gap-2 mb-3 items-center">
    <Input bind:value={search} placeholder="搜尋學名或中文名..." class="w-48 lg:w-64" size="sm" />
    <Select bind:value={filterFamily} class="w-40" size="sm">
      <option value="">全部科別</option>
      {#each families as fam}
        <option value={fam}>{fam}</option>
      {/each}
    </Select>

    <!-- 欄位顯示設定 -->
    <Button color="alternative" size="sm">
      <AdjustmentsHorizontalOutline class="w-3.5 h-3.5 me-1" />欄位
    </Button>
    <Dropdown class="p-2 w-40">
      {#each allColumns as col}
        <li class="px-2 py-1">
          <Checkbox
            checked={visibleColumns.has(col.key)}
            on:change={() => toggleColumn(col.key)}
          >{col.label}</Checkbox>
        </li>
      {/each}
    </Dropdown>

    <span class="flex-1"></span>
    <Button color="red" size="sm" on:click={removeSelected} disabled={selectedIds.size === 0}>
      <TrashBinOutline class="w-3 h-3 me-1" />刪除 ({selectedIds.size})
    </Button>
  </div>

  <div class="overflow-x-auto">
  <Table class="text-xs whitespace-nowrap">
    <TableHead>
      <TableHeadCell class="px-2 py-1.5"><input type="checkbox" on:change={toggleAllChecked} /></TableHeadCell>
      {#if isColumnVisible('taxon_id')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('taxon_id')}>TaxonID{sortIndicator('taxon_id')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('family')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('family')}>科名{sortIndicator('family')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('cname')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('cname')}>俗名{sortIndicator('cname')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('fullname')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('fullname')}>學名{sortIndicator('fullname')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('source')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('source')}>來源{sortIndicator('source')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('endemic')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('endemic')}>特有{sortIndicator('endemic')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('redlist')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('redlist')}>臺灣紅皮書{sortIndicator('redlist')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('iucn_category')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('iucn_category')}>IUCN{sortIndicator('iucn_category')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('cites')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('cites')}>CITES{sortIndicator('cites')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('protected')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('protected')}>保育類{sortIndicator('protected')}</TableHeadCell>
      {/if}
      {#if isColumnVisible('abundance')}
        <TableHeadCell class="px-2 py-1.5 cursor-pointer select-none" on:click={() => toggleSort('abundance')}>數量{sortIndicator('abundance')}</TableHeadCell>
      {/if}
    </TableHead>
    <TableBody>
      {#each paginated as item}
        <TableBodyRow class="hover:bg-gray-100 h-8 cursor-pointer" on:click={(e) => {
            if ((e.target).closest('input[type="checkbox"]')) return;
            onRowClick(item);
          }}>
          <TableBodyCell class="px-2 py-1">
            <input
              type="checkbox"
              checked={selectedIds.has(item.taxon_id)}
              on:change={(e) => toggleItem(item.taxon_id, e.target.checked)}
            />
          </TableBodyCell>
          {#if isColumnVisible('taxon_id')}
            <TableBodyCell class="px-2 py-1 font-mono">{item.taxon_id}</TableBodyCell>
          {/if}
          {#if isColumnVisible('family')}
            <TableBodyCell class="px-2 py-1">{item.family_cname} {item.family}</TableBodyCell>
          {/if}
          {#if isColumnVisible('cname')}
            <TableBodyCell class="px-2 py-1">{item.cname}</TableBodyCell>
          {/if}
          {#if isColumnVisible('fullname')}
            <TableBodyCell class="px-2 py-1">{@html formatScientificName(item.fullname)}</TableBodyCell>
          {/if}
          {#if isColumnVisible('source')}
            <TableBodyCell class="px-2 py-1">{item.source}</TableBodyCell>
          {/if}
          {#if isColumnVisible('endemic')}
            <TableBodyCell class="px-2 py-1 text-center">{item.endemic === 1 ? '✅' : ''}</TableBodyCell>
          {/if}
          {#if isColumnVisible('redlist')}
            <TableBodyCell class="px-2 py-1">
              {#if item.redlist}
                <span class="inline-block px-1 py-0.5 rounded text-xs font-semibold" style={iucnStyle(item.redlist)}>
                  {item.redlist}
                </span>
              {/if}
            </TableBodyCell>
          {/if}
          {#if isColumnVisible('iucn_category')}
            <TableBodyCell class="px-2 py-1">
              {#if item.iucn_category}
                <span class="inline-block px-1 py-0.5 rounded text-xs font-semibold" style={iucnStyle(item.iucn_category)}>
                  {item.iucn_category}
                </span>
              {/if}
            </TableBodyCell>
          {/if}
          {#if isColumnVisible('cites')}
            <TableBodyCell class="px-2 py-1">
              {#if item.cites}
                <span class="inline-block px-1 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                  {item.cites}
                </span>
              {/if}
            </TableBodyCell>
          {/if}
          {#if isColumnVisible('protected')}
            <TableBodyCell class="px-2 py-1">
              {#if item.protected}
                <span class="inline-block px-1 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  {item.protected === '1' ? '珍稀' : item.protected}
                </span>
              {/if}
            </TableBodyCell>
          {/if}
          {#if isColumnVisible('abundance')}
            <TableBodyCell class="px-2 py-1">
              <input
                type="number"
                min="0"
                class="w-14 text-xs border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5 bg-transparent text-center"
                value={item.abundance || 0}
                on:click|stopPropagation
                on:change={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  const updated = data.map(d => d.taxon_id === item.taxon_id ? { ...d, abundance: val } : d);
                  onUpdate(updated);
                }}
              />
            </TableBodyCell>
          {/if}
        </TableBodyRow>
      {/each}
    </TableBody>
  </Table>
  </div>

  <!-- 分頁 + 每頁筆數 -->
  <div class="flex justify-center items-center gap-2 mt-3 flex-wrap">
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

    <span class="text-xs text-gray-500 ml-2">
      顯示
    </span>
    <Select bind:value={perPage} size="sm" class="w-20 inline-block">
      <option value={10}>10</option>
      <option value={20}>20</option>
      <option value={50}>50</option>
      <option value={100}>100</option>
    </Select>
    <span class="text-xs text-gray-500">
      筆/頁，共 {sorted.length} 筆
    </span>
  </div>
</Section>
