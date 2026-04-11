<script lang="ts">
  import { Modal, Button, Radio, Badge } from 'flowbite-svelte';

  export let open = false;
  export let oldAccepted: { name_id: number; simple_name: string; name_author: string } | null = null;
  export let onConfirm: (newStatus: string) => void = () => {};
  export let onCancel: () => void = () => {};

  let selectedStatus = 'not-accepted';
</script>

<Modal bind:open size="md" title="變更使用狀態" autoclose={false}>
  <div class="space-y-4">
    <p class="text-sm text-gray-600 dark:text-gray-400">
      同一個 taxon 只能有一個 accepted name。目前的 accepted name 是：
    </p>

    {#if oldAccepted}
      <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <span class="font-mono text-xs text-gray-400">{oldAccepted.name_id}</span>
        <span class="italic ml-2">{oldAccepted.simple_name}</span>
        <span class="text-gray-500 ml-1">{oldAccepted.name_author}</span>
        <Badge color="green" class="ml-2 text-xs">accepted</Badge>
      </div>
    {/if}

    <p class="text-sm font-semibold text-gray-700 dark:text-gray-300">
      請選擇要將原 accepted name 改為：
    </p>

    <div class="space-y-2">
      <label class="flex items-center gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
        <input type="radio" bind:group={selectedStatus} value="not-accepted"
          class="w-4 h-4 text-blue-600" />
        <div>
          <span class="text-sm font-medium">not-accepted</span>
          <span class="text-xs text-gray-500 ml-2">同物異名（synonym）</span>
        </div>
      </label>
      <label class="flex items-center gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
        <input type="radio" bind:group={selectedStatus} value="misapplied"
          class="w-4 h-4 text-blue-600" />
        <div>
          <span class="text-sm font-medium">misapplied</span>
          <span class="text-xs text-gray-500 ml-2">誤用名</span>
        </div>
      </label>
    </div>
  </div>

  <svelte:fragment slot="footer">
    <div class="flex gap-3 w-full justify-end">
      <Button color="alternative" on:click={onCancel}>取消</Button>
      <Button color="blue" on:click={() => onConfirm(selectedStatus)}>確認變更</Button>
    </div>
  </svelte:fragment>
</Modal>
