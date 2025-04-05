<script lang="ts">
  import { Button } from 'flowbite-svelte';
  import { importYAMLText } from "$lib/importer";

  let fileInput: HTMLInputElement;
  let message = "";

  async function handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement)?.files?.[0];
    if (file) {
      const text = await file.text();
      const result = await importYAMLText(text);
      message = result ?? "✅ 匯入成功";
    }
  }

  function triggerUpload() {
    fileInput.click();
  }
</script>

<!-- 使用 hidden input + styled button -->
<div class="flex items-center space-x-2">
  <input
    bind:this={fileInput}
    type="file"
    accept=".yaml,.yml,.txt"
    class="hidden"
    on:change={handleFileUpload}
  />

  <Button size="sm" color="light" on:click={triggerUpload}>
    批次匯入
  </Button>

  {#if message}
    <span class={message.startsWith("✅") ? "text-green-600 text-sm" : "text-red-500 text-sm"}>
      {message}
    </span>
  {/if}
</div>
