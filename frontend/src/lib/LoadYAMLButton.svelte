<script lang="ts">
  import { Button } from 'flowbite-svelte';
  import { importYAMLText } from "$lib/importer";

  let message = "";
  let fileInput: HTMLInputElement;

  async function handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement)?.files?.[0];
    if (file) {
      const text = await file.text();
      const result = await importYAMLText(text);
      message = result ?? "✅ 匯入成功";
    }
  }

  function triggerUpload() {
    fileInput?.click();
  }
</script>

<!-- 像 input 一樣等高、等寬的按鈕容器 -->
<div class="w-full">
  <input
    type="file"
    bind:this={fileInput}
    accept=".yaml,.yml,.txt"
    class="hidden"
    on:change={handleFileUpload}
  />

  <Button
    on:click={triggerUpload}
    color="light"
    size="sm"
    class="w-full h-full"
  >
    匯入 YAML 或俗名清單
  </Button>

  {#if message}
    <p class={`text-sm mt-1 ${message.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>
      {message}
    </p>
  {/if}
</div>
