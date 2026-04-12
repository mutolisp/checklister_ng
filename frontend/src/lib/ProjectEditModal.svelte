<script lang="ts">
  import { Modal, Button, Input, Label, Textarea } from 'flowbite-svelte';
  import { projectMetadata } from '$stores/metadataStore';

  export let open = false;
  export let mode: 'new' | 'edit' = 'new';
  export let onSave: () => void = () => {};

  // 本地表單（不直接 bind store，確認後才寫入）
  let form = {
    projectName: '',
    projectAbstract: '',
    locationDescription: '',
    siteName: '',
    siteNotes: '',
  };

  // 開啟時從 store 載入
  $: if (open) {
    const m = $projectMetadata;
    form = {
      projectName: mode === 'new' ? '' : m.projectName,
      projectAbstract: mode === 'new' ? '' : m.projectAbstract,
      locationDescription: mode === 'new' ? '' : m.locationDescription,
      siteName: mode === 'new' ? '' : m.siteName,
      siteNotes: mode === 'new' ? '' : m.siteNotes,
    };
  }

  function handleConfirm() {
    // 寫入 store
    projectMetadata.update(m => ({
      ...m,
      projectName: form.projectName,
      projectAbstract: form.projectAbstract,
      locationDescription: form.locationDescription,
      siteName: form.siteName,
      siteNotes: form.siteNotes,
    }));
    open = false;
    onSave();
  }
</script>

<div class="project-modal-wrapper">
<Modal bind:open title={mode === 'new' ? '新建專案' : '編輯專案資訊'} size="md">
  <div class="space-y-3">
    <div>
      <Label class="mb-1">計畫名稱 <span class="text-red-500">*</span></Label>
      <Input size="sm" bind:value={form.projectName} placeholder="輸入計畫名稱..." />
    </div>
    <div>
      <Label class="mb-1">摘要</Label>
      <Textarea bind:value={form.projectAbstract} placeholder="計畫摘要說明..." rows={3} class="text-sm" />
    </div>
    <div>
      <Label class="mb-1">位置說明</Label>
      <Input size="sm" bind:value={form.locationDescription} placeholder="例如：臺灣南部恆春半島..." />
    </div>
    <div>
      <Label class="mb-1">樣區名稱</Label>
      <Input size="sm" bind:value={form.siteName} placeholder="輸入樣區名稱..." />
    </div>
    <div>
      <Label class="mb-1">備註</Label>
      <Textarea bind:value={form.siteNotes} placeholder="其他備註..." rows={2} class="text-sm" />
    </div>
  </div>
  <svelte:fragment slot="footer">
    <Button color="blue" size="sm" on:click={handleConfirm} disabled={!form.projectName.trim()}>
      {mode === 'new' ? '建立專案' : '儲存'}
    </Button>
    <Button color="alternative" size="sm" on:click={() => { open = false; }}>取消</Button>
  </svelte:fragment>
</Modal>
</div>

<style>
  .project-modal-wrapper :global(.fixed) {
    z-index: 99999 !important;
  }
</style>
