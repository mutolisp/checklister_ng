<script lang="ts">
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
</script>

<div class="my-4">
  <label>
    <span class="block font-semibold mb-1">匯入 YAML 或俗名檔案：</span>
    <input
      bind:this={fileInput}
      type="file"
      accept=".yaml,.yml,.txt"
      class="block mt-1"
      on:change={handleFileUpload}
    />
  </label>

  {#if message}
    <p class={message.startsWith("✅") ? "text-green-600 mt-2" : "text-red-500 mt-2"}>{message}</p>
  {/if}
</div>

