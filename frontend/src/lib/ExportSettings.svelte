<script lang="ts">
  import { Button, Card, Checkbox, Label, Modal } from 'flowbite-svelte';
  import { AdjustmentsHorizontalOutline } from 'flowbite-svelte-icons';

  export let show = false;
  export let levels: string[] = [];

  const allLevels = [
    { value: 'kingdom', label: '界 Kingdom' },
    { value: 'phylum', label: '門 Phylum' },
    { value: 'class_name', label: '綱 Class' },
    { value: 'order', label: '目 Order' },
    { value: 'family', label: '科 Family' },
    { value: 'genus', label: '屬 Genus' },
  ];

  function toggleLevel(value: string) {
    if (levels.includes(value)) {
      levels = levels.filter(l => l !== value);
    } else {
      levels = [...levels, value];
    }
  }

  function resetToDefault() {
    levels = [];
  }
</script>

<Button color="alternative" size="sm" on:click={() => show = true}>
  <AdjustmentsHorizontalOutline class="w-4 h-4 me-2" />匯出設定
</Button>

<Modal bind:open={show} title="匯出階層設定" size="sm">
  <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
    勾選要在匯出名錄中顯示的分類階層。未勾選時使用各分類群的預設階層。
  </p>

  <div class="space-y-3">
    {#each allLevels as level}
      <div class="flex items-center gap-2">
        <Checkbox
          checked={levels.includes(level.value)}
          on:change={() => toggleLevel(level.value)}
        />
        <Label>{level.label}</Label>
      </div>
    {/each}
  </div>

  <svelte:fragment slot="footer">
    <div class="flex gap-2">
      <Button color="alternative" size="sm" on:click={resetToDefault}>使用預設</Button>
      <Button color="blue" size="sm" on:click={() => show = false}>確認</Button>
    </div>
  </svelte:fragment>
</Modal>
