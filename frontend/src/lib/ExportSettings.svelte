<script lang="ts">
  import { Button, Checkbox, Label, Modal, Select } from 'flowbite-svelte';
  import { AdjustmentsHorizontalOutline } from 'flowbite-svelte-icons';

  export let show = false;
  export let levels: string[] = [];
  export let conservationFields: string[] = ['redlist'];
  export let exportFormat: string = 'bundle';

  const formatOptions = [
    { value: 'bundle', name: '名錄（Word + CSV）' },
    { value: 'docx', name: 'Word (.docx)' },
    { value: 'markdown', name: 'Markdown (.md)' },
    { value: 'csv', name: 'CSV (DwC)' },
    { value: 'yaml', name: 'DwC YAML' },
  ];

  const allLevels = [
    { value: 'kingdom', label: '界 Kingdom' },
    { value: 'phylum', label: '門 Phylum' },
    { value: 'class_name', label: '綱 Class' },
    { value: 'order', label: '目 Order' },
    { value: 'family', label: '科 Family' },
    { value: 'genus', label: '屬 Genus' },
  ];

  const allConservationFields = [
    { value: 'redlist', label: '臺灣紅皮書' },
    { value: 'iucn_category', label: 'IUCN 全球紅皮書' },
    { value: 'cites', label: 'CITES 附錄' },
    { value: 'protected', label: '保育類/珍貴稀有植物' },
  ];

  function toggleLevel(value: string) {
    if (levels.includes(value)) {
      levels = levels.filter(l => l !== value);
    } else {
      levels = [...levels, value];
    }
  }

  function toggleConservation(value: string) {
    if (conservationFields.includes(value)) {
      conservationFields = conservationFields.filter(f => f !== value);
    } else {
      conservationFields = [...conservationFields, value];
    }
  }

  function resetToDefault() {
    levels = [];
    conservationFields = ['redlist'];
    exportFormat = 'bundle';
  }
</script>

<Button color="alternative" size="sm" on:click={() => show = true}>
  <AdjustmentsHorizontalOutline class="w-4 h-4 me-2" />匯出設定
</Button>

<Modal bind:open={show} title="匯出設定" size="sm">
  <!-- 分類階層 -->
  <div class="mb-6">
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">分類階層</h3>
    <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
      勾選要在匯出名錄中顯示的分類階層。未勾選時使用各分類群的預設階層。
    </p>
    <div class="space-y-2">
      {#each allLevels as level}
        <div class="flex items-center gap-2">
          <Checkbox
            checked={levels.includes(level.value)}
            on:change={() => toggleLevel(level.value)}
          />
          <Label class="text-sm">{level.label}</Label>
        </div>
      {/each}
    </div>
  </div>

  <!-- 保育狀態 -->
  <div>
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">保育狀態</h3>
    <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
      勾選要在匯出名錄中附加的保育等級資訊。
    </p>
    <div class="space-y-2">
      {#each allConservationFields as field}
        <div class="flex items-center gap-2">
          <Checkbox
            checked={conservationFields.includes(field.value)}
            on:change={() => toggleConservation(field.value)}
          />
          <Label class="text-sm">{field.label}</Label>
        </div>
      {/each}
    </div>
  </div>

  <!-- 匯出格式 -->
  <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">匯出格式</h3>
    <Select size="sm" bind:value={exportFormat} items={formatOptions} />
  </div>

  <svelte:fragment slot="footer">
    <div class="flex gap-2">
      <Button color="alternative" size="sm" on:click={resetToDefault}>使用預設</Button>
      <Button color="blue" size="sm" on:click={() => show = false}>確認</Button>
    </div>
  </svelte:fragment>
</Modal>
