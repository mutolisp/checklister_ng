<script lang="ts">
  import { Badge, Button, Card } from 'flowbite-svelte';
  import { GlobeOutline } from 'flowbite-svelte-icons';
  import { formatScientificName } from '$lib/formatter';

  export let species: any;

  // 自動從 API 載入同物異名
  let synonyms: any[] = [];
  let synonymsLoading = false;

  async function fetchSynonyms(taxonId: string) {
    if (!taxonId) { synonyms = []; return; }
    synonymsLoading = true;
    try {
      const res = await fetch(`/api/synonyms?taxon_id=${encodeURIComponent(taxonId)}`);
      if (res.ok) {
        synonyms = await res.json();
      } else {
        synonyms = [];
      }
    } catch {
      synonyms = [];
    }
    synonymsLoading = false;
  }

  $: fetchSynonyms(species?.taxon_id);

  function sourceColor(source: string): string {
    switch (source) {
      case '原生': return 'green';
      case '歸化': return 'yellow';
      case '栽培': return 'blue';
      default: return 'dark';
    }
  }

  function iucnColor(cat: string): string {
    switch (cat) {
      case 'CR': return 'red';
      case 'EN': return 'red';
      case 'VU': return 'yellow';
      case 'NT': return 'yellow';
      case 'LC': return 'green';
      case 'DD': return 'dark';
      default: return 'dark';
    }
  }

  // name = 不含命名者的學名；fallback 從 fullname 取屬名+種名
  $: scientificName = species?.name || (species?.fullname?.match(/^([A-Z][a-z]+ [a-z\-]+)/)?.[1] ?? '');
  $: gbifUrl = `https://www.gbif.org/species/search?q=${encodeURIComponent(scientificName)}`;
  $: inatUrl = `https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(scientificName)}`;

  // TaiCOL: 用俗名搜尋目錄頁
  $: taicolUrl = `https://taicol.tw/zh-hant/catalogue?keyword=${encodeURIComponent(species?.cname || '')}&name-select=equal`;
</script>

{#if species}
<div class="p-6 space-y-6 overflow-y-auto h-full">

  <!-- C1: 物種資訊 -->
  <Card class="max-w-none" size="xl">
    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-1">
      {species.cname}
    </h2>
    <p class="text-lg text-gray-600 dark:text-gray-300 mb-4">
      {@html formatScientificName(species.fullname)}
    </p>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">分類資訊</h3>
        <table class="text-sm">
          <tbody>
            {#if species.alternative_name_c}
            <tr>
              <td class="pr-4 py-1 text-gray-500 dark:text-gray-400">其他俗名</td>
              <td class="py-1 text-gray-900 dark:text-white">{species.alternative_name_c}</td>
            </tr>
            {/if}
            <tr>
              <td class="pr-4 py-1 text-gray-500 dark:text-gray-400">科名</td>
              <td class="py-1 text-gray-900 dark:text-white">{species.family_cname} ({species.family})</td>
            </tr>
            <tr>
              <td class="pr-4 py-1 text-gray-500 dark:text-gray-400">高階類群</td>
              <td class="py-1 text-gray-900 dark:text-white">{species.pt_name || '—'}</td>
            </tr>
            <tr>
              <td class="pr-4 py-1 text-gray-500 dark:text-gray-400">學名（不含作者）</td>
              <td class="py-1 text-gray-900 dark:text-white italic">{species.name}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">物種狀態</h3>
        <div class="flex flex-wrap gap-2">
          {#if species.source}
            <Badge color={sourceColor(species.source)}>{species.source}</Badge>
          {/if}
          {#if species.endemic === 1}
            <Badge color="purple">臺灣特有</Badge>
          {/if}
          {#if species.iucn_category}
            <Badge color={iucnColor(species.iucn_category)}>
              IUCN: {species.iucn_category}
            </Badge>
          {/if}
        </div>
      </div>
    </div>
  </Card>

  <!-- C2: 同物異名 -->
  <Card class="max-w-none" size="xl">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">同物異名 Synonyms</h3>
    {#if synonymsLoading}
      <p class="text-sm text-gray-400 dark:text-gray-500 italic">載入中...</p>
    {:else if synonyms.length > 0}
      <ul class="space-y-2">
        {#each synonyms as syn}
          <li class="text-sm text-gray-700 dark:text-gray-300">
            <span class="italic">{@html formatScientificName(syn.scientificName)}</span>
            {#if syn.authorship}
              <span class="text-gray-500"> {syn.authorship}</span>
            {/if}
            {#if syn.status}
              <Badge color={syn.status === 'accepted' ? 'green' : syn.status === 'misapplied' ? 'red' : 'dark'} class="ml-2 text-xs">{syn.status}</Badge>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-gray-400 dark:text-gray-500 italic">尚無同物異名資料</p>
    {/if}
  </Card>

  <!-- C3: 外部連結 -->
  <Card class="max-w-none" size="xl">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">外部連結</h3>
    <div class="flex flex-wrap gap-3">
      <Button color="alternative" href={gbifUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />GBIF
      </Button>
      <Button color="alternative" href={taicolUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />TaiCOL 臺灣物種名錄
      </Button>
      <Button color="alternative" href={inatUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />iNaturalist
      </Button>
    </div>
  </Card>

</div>
{/if}
