<script lang="ts">
  import { Button, Modal } from 'flowbite-svelte';
  import { MapPinAltSolid } from 'flowbite-svelte-icons';
  import { projectMetadata } from '$stores/metadataStore';

  let show = false;
  let mapLoaded = false;
  let MapEditorComponent: any = null;
  let mapEditor: any;

  async function openPreview() {
    show = true;
    if (!mapLoaded) {
      // Lazy load MapEditor
      const mod = await import('$lib/MapEditor.svelte');
      MapEditorComponent = mod.default;
      mapLoaded = true;
    }
  }

  $: hasGeometry = $projectMetadata.footprintWKT !== '';
</script>

<Button size="sm" color={hasGeometry ? 'green' : 'alternative'} on:click={openPreview}>
  <MapPinAltSolid class="w-4 h-4 me-1" />地圖{hasGeometry ? ' ✓' : ''}
</Button>

<Modal bind:open={show} title="樣區地圖預覽" size="xl">
  {#if mapLoaded && MapEditorComponent}
    <svelte:component this={MapEditorComponent} bind:this={mapEditor} readonly={true} height="400px" />
  {/if}

  {#if $projectMetadata.footprintWKT}
    <p class="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">
      WKT: {$projectMetadata.footprintWKT.substring(0, 100)}{$projectMetadata.footprintWKT.length > 100 ? '...' : ''}
    </p>
  {:else}
    <p class="text-sm text-gray-400 dark:text-gray-500 mt-2">尚未繪製樣區範圍</p>
  {/if}

  <svelte:fragment slot="footer">
    <div class="flex gap-2">
      <Button color="blue" size="sm" href="/map">前往編輯</Button>
      <Button color="alternative" size="sm" on:click={() => show = false}>關閉</Button>
    </div>
  </svelte:fragment>
</Modal>
