<script lang="ts">
  export let groupedSpecies: Map<string, Map<string, any[]>>;
  export let onRemove: (id: number) => void;
  import { formatScientificName } from "$lib/formatter";

 const ptOrderMap = {
  '苔蘚地衣類植物 Mosses and Lichens': 0,
  '石松類植物 Lycophytes': 1,
  '蕨類植物 Monilophytes': 2,
  '裸子植物 Gymnosperms': 3,
  '單子葉植物 Monocots': 4,
  '真雙子葉植物姊妹群 Sister groups of Eudicots': 5,
  '真雙子葉植物 Eudicots': 6
  }; 

  function safeSortByKey(a: any, b: any) {
    const aKey = typeof a?.[0] === 'string' ? a[0] : '';
    const bKey = typeof b?.[0] === 'string' ? b[0] : '';
    return aKey.localeCompare(bKey);
  }
  function sortByPtNameOrder(a: [string, Map<string, any[]>], b: [string, Map<string, any[]>]) {
    const aIndex = ptOrderMap[a?.[0] ?? ''] ?? 999;
    const bIndex = ptOrderMap[b?.[0] ?? ''] ?? 999;
    return aIndex - bIndex;
  }
</script>


{#if groupedSpecies}
  {#each Array.from(groupedSpecies.entries()).sort(sortByPtNameOrder) as [pt_name, famMap]}
    <h3 class="text-xl mt-4 mb-2 font-bold">{pt_name}</h3>
    <ul>
      {#each Array.from(famMap.entries()).sort(safeSortByKey) as [family, speciesList]}
        <li class="mb-1">
          <strong>{speciesList[0].family_cname} ({family})</strong> ({speciesList.length})
          <ul>
            {#each speciesList.sort((a, b) => a.name?.localeCompare(b.name ?? '') ?? 0) as item}
              <li class="flex justify-between items-center">
                <span>
                  {item.cname}
                  ({@html formatScientificName(item.fullname)})
                  {item.endemic === 1 ? ' #' : ''}
                  {item.source === '歸化' ? ' *' : ''}
                  {item.source === '栽培' ? ' †' : ''}
                  {item.iucn_category ? ` ${item.iucn_category}` : ''}
                </span>
                <button
                  class="text-red-500 text-sm ml-2"
                  on:click={() => onRemove(item.id)}
                >
                  🗑️
                </button>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/each}
{/if}
