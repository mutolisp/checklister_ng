<script lang="ts">
  import { Modal, Button, Input, Label, Alert, Spinner, Badge, Select } from 'flowbite-svelte';

  export let open = false;
  export let sourceRank = '';
  export let sourceName = '';
  export let onMoved: () => void = () => {};

  const parentRanks: Record<string, { value: string; name: string }[]> = {
    genus:   [{ value: 'family', name: '科 Family' }],
    family:  [{ value: 'order', name: '目 Order' }],
    order:   [{ value: 'class', name: '綱 Class' }],
    class:   [{ value: 'phylum', name: '門 Phylum' }],
    phylum:  [{ value: 'kingdom', name: '界 Kingdom' }],
  };

  let targetRank = '';
  let targetName = '';
  let targetQuery = '';
  let targetOptions: string[] = [];
  let showTargetDrop = false;

  let preview: any = null;
  let previewLoading = false;
  let previewError = '';
  let executing = false;
  let executeError = '';
  let step: 'input' | 'preview' | 'done' = 'input';

  $: availableParents = parentRanks[sourceRank] || [];
  $: if (availableParents.length === 1) targetRank = availableParents[0].value;

  async function loadTargetOptions() {
    if (!targetRank) return;
    try {
      const res = await fetch(`/api/admin/taxonomy/options?rank=${targetRank}`);
      if (res.ok) targetOptions = await res.json();
    } catch { targetOptions = []; }
  }

  $: filteredTargets = (() => {
    const q = targetQuery.toLowerCase();
    if (!q) return targetOptions.slice(0, 50);
    return targetOptions.filter(o => o.toLowerCase().includes(q)).slice(0, 50);
  })();

  function selectTarget(val: string) {
    targetName = val;
    targetQuery = val;
    showTargetDrop = false;
  }

  async function doPreview() {
    previewError = '';
    previewLoading = true;
    try {
      const res = await fetch('/api/admin/taxonomy/move/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_rank: sourceRank,
          source_name: sourceName,
          target_rank: targetRank,
          target_name: targetName,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        preview = data;
        step = 'preview';
      } else {
        previewError = data.error || '預覽失敗';
      }
    } catch (e) {
      previewError = `錯誤: ${e}`;
    }
    previewLoading = false;
  }

  async function doExecute() {
    executeError = '';
    executing = true;
    try {
      const res = await fetch('/api/admin/taxonomy/move/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_rank: sourceRank,
          source_name: sourceName,
          target_rank: targetRank,
          target_name: targetName,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'moved') {
        step = 'done';
        onMoved();
      } else {
        executeError = data.error || '搬移失敗';
      }
    } catch (e) {
      executeError = `錯誤: ${e}`;
    }
    executing = false;
  }

  function reset() {
    targetRank = availableParents.length === 1 ? availableParents[0].value : '';
    targetName = '';
    targetQuery = '';
    preview = null;
    previewError = '';
    executeError = '';
    step = 'input';
  }

  $: if (!open) reset();
</script>

<Modal bind:open size="lg" title="搬移分類群" autoclose={false}>
  {#if step === 'input'}
    <div class="space-y-4">
      <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded">
        <span class="text-sm text-gray-500">搬移對象：</span>
        <span class="font-semibold">{sourceName}</span>
        <Badge color="blue" class="ml-2 text-xs">{sourceRank}</Badge>
      </div>

      {#if availableParents.length > 1}
        <div>
          <Label class="mb-1">目標層級</Label>
          <Select items={availableParents} bind:value={targetRank} size="sm"
            on:change={() => { targetName = ''; targetQuery = ''; loadTargetOptions(); }} />
        </div>
      {:else}
        <p class="text-sm text-gray-500">目標層級：<Badge color="dark" class="text-xs">{targetRank}</Badge></p>
      {/if}

      <div class="relative">
        <Label class="mb-1">搬移到哪個 {targetRank}？</Label>
        <Input size="sm" bind:value={targetQuery}
          on:input={() => { targetName = targetQuery; showTargetDrop = true; }}
          on:focus={() => { loadTargetOptions(); showTargetDrop = true; }}
          on:blur={() => setTimeout(() => { showTargetDrop = false; }, 150)}
          placeholder="輸入搜尋目標分類群..."
          autocomplete="off"
        />
        {#if showTargetDrop && filteredTargets.length > 0}
          <div class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border rounded shadow-lg max-h-48 overflow-y-auto">
            {#each filteredTargets as opt}
              <button type="button"
                class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                on:mousedown|preventDefault={() => selectTarget(opt)}
              >{opt}</button>
            {/each}
          </div>
        {/if}
      </div>

      {#if previewError}
        <Alert color="red" class="text-sm">{previewError}</Alert>
      {/if}
    </div>

  {:else if step === 'preview'}
    <div class="space-y-4">
      <Alert color="yellow" class="text-sm">
        即將把 <strong>{sourceName}</strong>（{sourceRank}）從目前位置搬移到 <strong>{targetName}</strong>（{targetRank}）底下。
      </Alert>

      <div class="text-sm">
        <p class="font-semibold mb-2">影響範圍：{preview.affected_count} 筆記錄</p>

        <table class="w-full text-sm border">
          <thead>
            <tr class="bg-gray-50 dark:bg-gray-800">
              <th class="px-3 py-1 text-left">欄位</th>
              <th class="px-3 py-1 text-left">原值</th>
              <th class="px-3 py-1 text-left">新值</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(preview.changes) as [field, diff]}
              <tr class="border-t">
                <td class="px-3 py-1 text-gray-600">{field}</td>
                <td class="px-3 py-1"><Badge color="red" class="text-xs">{diff.old || '(空)'}</Badge></td>
                <td class="px-3 py-1"><Badge color="green" class="text-xs">{diff.new || '(空)'}</Badge></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if executeError}
        <Alert color="red" class="text-sm">{executeError}</Alert>
      {/if}
    </div>

  {:else}
    <Alert color="green">
      搬移完成！共更新 {preview?.affected_count || 0} 筆記錄。
    </Alert>
  {/if}

  <svelte:fragment slot="footer">
    <div class="flex gap-3 w-full justify-between">
      <div>
        {#if step === 'preview'}
          <Button color="alternative" on:click={() => { step = 'input'; }}>上一步</Button>
        {/if}
      </div>
      <div class="flex gap-2">
        {#if step === 'done'}
          <Button color="blue" on:click={() => { open = false; }}>關閉</Button>
        {:else}
          <Button color="alternative" on:click={() => { open = false; }}>取消</Button>
          {#if step === 'input'}
            <Button color="blue" on:click={doPreview} disabled={!targetName || !targetRank || previewLoading}>
              {#if previewLoading}<Spinner size="4" class="me-2" />{/if}
              預覽影響
            </Button>
          {:else if step === 'preview'}
            <Button color="red" on:click={doExecute} disabled={executing}>
              {#if executing}<Spinner size="4" class="me-2" />{/if}
              確認搬移（{preview?.affected_count} 筆）
            </Button>
          {/if}
        {/if}
      </div>
    </div>
  </svelte:fragment>
</Modal>
