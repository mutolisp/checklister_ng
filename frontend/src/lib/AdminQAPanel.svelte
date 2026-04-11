<script lang="ts">
  import { Button, Alert, Spinner, Badge } from 'flowbite-svelte';

  export let onNavigate: (nameId: number) => void = () => {};

  let loading = false;
  let checks: any[] = [];
  let expandedIds: Set<string> = new Set();
  let loadingMore: Record<string, boolean> = {};

  const severityLabel: Record<string, { color: string; text: string }> = {
    high: { color: 'red', text: '高' },
    medium: { color: 'yellow', text: '中' },
    low: { color: 'green', text: '低' },
  };

  async function runChecks() {
    loading = true;
    checks = [];
    try {
      const res = await fetch('/api/admin/qa/run');
      if (res.ok) {
        const data = await res.json();
        checks = data.checks;
      }
    } catch {}
    loading = false;
  }

  function toggleExpand(id: string) {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
    expandedIds = new Set(expandedIds);
  }

  async function loadMore(checkId: string) {
    loadingMore[checkId] = true;
    const chk = checks.find(c => c.id === checkId);
    if (!chk) return;
    const offset = chk.items.length;
    try {
      const res = await fetch(`/api/admin/qa/${checkId}?offset=${offset}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        chk.items = [...chk.items, ...data.items];
        checks = [...checks];
      }
    } catch {}
    loadingMore[checkId] = false;
    loadingMore = { ...loadingMore };
  }

  function downloadCSV(checkId: string) {
    window.open(`/api/admin/qa/export/csv/${checkId}`, '_blank');
  }

  function downloadDocx() {
    window.open('/api/admin/qa/export/docx', '_blank');
  }
</script>

<div class="space-y-4 mt-4">
  <div class="flex items-center gap-3">
    <Button color="blue" size="sm" on:click={runChecks} disabled={loading}>
      {#if loading}<Spinner size="4" class="me-2" />{/if}
      執行檢核
    </Button>
    {#if checks.length > 0}
      <span class="text-sm text-gray-500">
        {checks.filter(c => c.count > 0).length} / {checks.length} 項有問題
      </span>
      <Button color="alternative" size="sm" on:click={downloadDocx}>匯出報告 (DOCX)</Button>
    {/if}
  </div>

  {#if checks.length > 0}
    <div class="space-y-2">
      {#each checks as chk}
        {@const sev = severityLabel[chk.severity] || { color: 'dark', text: '?' }}
        {@const isExpanded = expandedIds.has(chk.id)}
        <div class="border rounded-lg {chk.count > 0 ? 'border-gray-300 dark:border-gray-600' : 'border-gray-100 dark:border-gray-800'}">
          <!-- Header -->
          <button
            class="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
            on:click={() => { if (chk.count > 0) toggleExpand(chk.id); }}
            disabled={chk.count === 0}
          >
            <div class="flex items-center gap-3">
              <span class="text-xs font-mono text-gray-400 w-6">{chk.id}</span>
              <Badge color={sev.color} class="text-xs">{sev.text}</Badge>
              <span class="font-medium text-sm {chk.count > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400'}">{chk.name}</span>
              <span class="text-xs text-gray-400">{chk.description || ''}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-mono {chk.count > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}">
                {chk.count > 0 ? chk.count.toLocaleString() + ' 筆' : '✓'}
              </span>
              {#if chk.count > 0}
                <span class="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
              {/if}
            </div>
          </button>

          <!-- Detail table -->
          {#if isExpanded && chk.items.length > 0}
            <div class="px-4 pb-3">
              <div class="max-h-96 overflow-auto border rounded">
                <table class="w-full text-sm">
                  <thead class="bg-gray-50 dark:bg-gray-800 sticky top-0">
                    <tr>
                      <th class="px-3 py-1.5 text-left text-xs">name_id</th>
                      <th class="px-3 py-1.5 text-left text-xs">學名</th>
                      <th class="px-3 py-1.5 text-left text-xs">rank</th>
                      <th class="px-3 py-1.5 text-left text-xs">問題說明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each chk.items as item}
                      <tr class="border-t hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td class="px-3 py-1">
                          {#if item.name_id > 0}
                            <button
                              class="text-blue-600 hover:underline font-mono text-xs"
                              on:click={() => onNavigate(item.name_id)}
                            >{item.name_id}</button>
                          {:else}
                            <span class="text-gray-400 text-xs">—</span>
                          {/if}
                        </td>
                        <td class="px-3 py-1 italic">{item.simple_name || ''}</td>
                        <td class="px-3 py-1 text-xs text-gray-500">{item.rank || ''}</td>
                        <td class="px-3 py-1 text-xs text-gray-600 dark:text-gray-400">{item.detail || ''}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="mt-2 flex items-center justify-between">
                <div>
                  {#if chk.items.length < chk.count}
                    <Button size="xs" color="alternative"
                      on:click={() => loadMore(chk.id)}
                      disabled={loadingMore[chk.id]}
                    >
                      {#if loadingMore[chk.id]}<Spinner size="3" class="me-1" />{/if}
                      載入更多（已顯示 {chk.items.length} / {chk.count}）
                    </Button>
                  {/if}
                </div>
                <Button size="xs" color="alternative" on:click={() => downloadCSV(chk.id)}>
                  匯出 CSV
                </Button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
