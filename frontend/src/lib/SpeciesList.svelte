<script lang="ts">
  export let groupedSpecies: Map<string, Map<string, any[]>>;
  export let onRemove: (id: number) => void;
</script>

{#if groupedSpecies}
  {#each Array.from(groupedSpecies.entries()) as [pt_name, famMap]}
    <h3 class="text-xl mt-4 mb-2 font-bold">## {pt_name}</h3>
    <ul>
      {#each Array.from(famMap.entries()) as [family, speciesList]}
        <li class="mb-1">
          <strong>{speciesList[0].family_cname} ({family})</strong> ({speciesList.length})
          <ul>
            {#each speciesList as item}
              <li class="flex justify-between items-center">
                <span>
                  {item.cname} (<i>{item.fullname}</i>)
                  {item.endemic === 1 ? " #" : ""}
                  {item.source === "歸化" ? " *" : ""}
                  {item.source === "栽培" ? " †" : ""}
                  {item.iucn_category ? ` ${item.iucn_category}` : ""}
                </span>
                <button
                  class="text-red-500 text-sm ml-2"
                  on:click={() => onRemove(item.id)}
                >
                  ✕
                </button>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/each}
{/if}

