<script lang="ts">
  import { Badge, Button, Card } from 'flowbite-svelte';
  import { GlobeOutline } from 'flowbite-svelte-icons';
  import { formatScientificName } from '$lib/formatter';

  export let species: any;

  // 自動從 API 載入同物異名
  let synonyms: any[] = [];
  let synonymsLoading = false;

  // 檢索表
  let keyText = '';
  let keyLoading = false;

  async function fetchKey(genus: string) {
    if (!genus) { keyText = ''; return; }
    keyLoading = true;
    try {
      const res = await fetch(`/api/key/${encodeURIComponent(genus)}`);
      if (res.ok) {
        keyText = await res.text();
      } else {
        keyText = '';
      }
    } catch {
      keyText = '';
    }
    keyLoading = false;
  }

  // 從學名取屬名
  $: genusName = species?.name?.split(' ')[0] || species?.genus || '';
  $: fetchKey(genusName);

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
  $: scientificName = species?.name || (species?.fullname?.match(/^([A-Z][a-z]+ [a-z\-]+(?:\s+(?:subsp\.|var\.|f\.|fo\.)\s+[a-z\-]+)*)/)?.[1] ?? '');

  // 俗名：取第一個（去掉括號中的第二俗名）
  $: primaryCname = (species?.cname || '').replace(/\(.*\)$/, '').trim();

  // 判斷是否為植物（用於顯示植物專用連結）
  $: isPlant = species?.kingdom === 'Plantae' || species?.phylum === 'Tracheophyta' || species?.pt_name;

  // 所有類群共用
  $: gbifUrl = `https://www.gbif.org/species/search?q=${encodeURIComponent(scientificName)}`;
  $: inatUrl = `https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(scientificName)}`;
  $: taicolUrl = `https://taicol.tw/zh-hant/catalogue?keyword=${encodeURIComponent(primaryCname)}&name-select=equal`;
  $: wikispeciesUrl = `https://species.wikimedia.org/wiki/${encodeURIComponent(scientificName.replace(/ /g, '_'))}`;
  $: ncbiUrl = `https://www.ncbi.nlm.nih.gov/taxonomy/?term=${encodeURIComponent(scientificName)}`;

  // 植物專用
  $: ipniUrl = `https://ipni.org/search?q=${encodeURIComponent(scientificName)}`;
  $: powoUrl = `https://powo.science.kew.org/results?q=${encodeURIComponent(scientificName)}`;
  $: taiUrl = `https://tai2.ntu.edu.tw/search/1/${encodeURIComponent(scientificName)}`;
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
            <span>{@html formatScientificName(syn.scientificName)}</span>
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

  <!-- 檢索表 Identification Key -->
  {#if keyText}
  <Card class="max-w-none" size="xl">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">
      檢索表 <span class="text-sm font-normal text-gray-500">({genusName})</span>
    </h3>
    <pre class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">{keyText}</pre>
  </Card>
  {/if}

  <!-- C3: 外部連結 -->
  <Card class="max-w-none" size="xl">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">外部連結</h3>
    <div class="flex flex-wrap gap-3">
      <Button color="alternative" href={gbifUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />GBIF
      </Button>
      <Button color="alternative" href={taicolUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />TaiCOL
      </Button>
      <Button color="alternative" href={inatUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />iNaturalist
      </Button>
      <Button color="alternative" href={wikispeciesUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />Wikispecies
      </Button>
      <Button color="alternative" href={ncbiUrl} target="_blank">
        <GlobeOutline class="w-4 h-4 me-2" />NCBI Taxonomy
      </Button>
      {#if isPlant}
        <Button color="alternative" href={ipniUrl} target="_blank">
          <GlobeOutline class="w-4 h-4 me-2" />IPNI
        </Button>
        <Button color="alternative" href={powoUrl} target="_blank">
          <GlobeOutline class="w-4 h-4 me-2" />POWO
        </Button>
        <Button color="alternative" href={taiUrl} target="_blank">
          <GlobeOutline class="w-4 h-4 me-2" />台灣植物資訊整合查詢
        </Button>
      {/if}
    </div>
  </Card>

</div>
{/if}
