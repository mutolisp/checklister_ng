<script lang="ts">
  import { Modal, Button, Badge } from 'flowbite-svelte';

  export let open = false;
  export let nameId: number = 0;
  export let simpleName: string = '';
  export let changes: Record<string, { old: string; new: string }> = {};
  export let onConfirm: () => void = () => {};
  export let onCancel: () => void = () => {};

  const fieldLabels: Record<string, string> = {
    simple_name: '學名',
    name_author: '命名者',
    formatted_name: '格式化學名',
    rank: 'Rank',
    usage_status: '使用狀態',
    common_name_c: '俗名',
    alternative_name_c: '別名',
    family_c: '科中文名',
    genus_c: '屬中文名',
    is_in_taiwan: '現存於臺灣',
    is_endemic: '特有性',
    alien_type: '原生/歸化',
    iucn: 'IUCN 等級',
    redlist: '國內紅皮書',
  };
</script>

<Modal bind:open size="md" title="確認修改" autoclose={false}>
  <div class="space-y-4">
    <div class="text-sm text-gray-600 dark:text-gray-400">
      <span class="font-semibold">Name ID:</span> {nameId}<br />
      <span class="font-semibold">學名:</span> <span class="italic">{simpleName}</span>
    </div>

    <div>
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">變更項目：</h4>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-500 dark:text-gray-400">
            <th class="text-left py-1 pr-2">欄位</th>
            <th class="text-left py-1 pr-2">原始值</th>
            <th class="text-left py-1">新值</th>
          </tr>
        </thead>
        <tbody>
          {#each Object.entries(changes) as [field, diff]}
            <tr class="border-t border-gray-100 dark:border-gray-700">
              <td class="py-1.5 pr-2 text-gray-600 dark:text-gray-400">{fieldLabels[field] || field}</td>
              <td class="py-1.5 pr-2"><Badge color="red" class="text-xs">{diff.old || '(空)'}</Badge></td>
              <td class="py-1.5"><Badge color="green" class="text-xs">{diff.new || '(空)'}</Badge></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <svelte:fragment slot="footer">
    <div class="flex gap-3 w-full justify-end">
      <Button color="alternative" on:click={onCancel}>取消</Button>
      <Button color="blue" on:click={onConfirm}>確認儲存</Button>
    </div>
  </svelte:fragment>
</Modal>
