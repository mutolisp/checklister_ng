<script lang="ts">
  import { selectedSpecies } from "$stores/speciesStore";
  import { get } from "svelte/store";
  import * as yaml from "js-yaml";

  let fileInput: HTMLInputElement;

  function handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = reader.result as string;
        const parsed = yaml.load(content);

        const data = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.species)
            ? parsed.species
            : null;

        if (!data) {
          alert("YAML 檔案格式錯誤，應為物種陣列或 species 陣列。");
          return;
        }

        const current = get(selectedSpecies);
        const currentIds = new Set(current.map(d => d.id));
        const merged = [...current];

        for (const item of data) {
          if (item.id && !currentIds.has(item.id)) {
            merged.push(item);
          }
        }

        selectedSpecies.set(merged);
        alert(`成功匯入 ${merged.length - current.length} 筆物種`);
      } catch (err) {
        alert("解析 YAML 失敗");
        console.error(err);
      }
    };

    reader.readAsText(file);
    fileInput.value = ""; // reset file input
  }
</script>

<button
  class="bg-green-600 text-white px-4 py-2 rounded mr-2"
  on:click={() => fileInput.click()}
>
  匯入 YAML
</button>
<input
  type="file"
  accept=".yml,.yaml"
  bind:this={fileInput}
  class="hidden"
  on:change={handleFileUpload}
/>

