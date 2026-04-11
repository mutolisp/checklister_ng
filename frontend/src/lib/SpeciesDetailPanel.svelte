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

  // 參考文獻
  let references: any[] = [];
  async function fetchReferences(nameId: number) {
    if (!nameId) { references = []; return; }
    try {
      const res = await fetch(`/api/admin/references/${nameId}`);
      if (res.ok) references = await res.json();
      else references = [];
    } catch { references = []; }
  }
  $: fetchReferences(species?.id);

  // 棲地標籤
  $: habitatTags = [
    species?.is_terrestrial === 'true' && '陸域',
    species?.is_freshwater === 'true' && '淡水',
    species?.is_brackish === 'true' && '半鹹水',
    species?.is_marine === 'true' && '海洋',
    species?.is_fossil === 'true' && '化石',
  ].filter(Boolean);

  function sourceColor(source: string): string {
    switch (source) {
      case '原生': return 'green';
      case '歸化': return 'yellow';
      case '栽培': return 'blue';
      default: return 'dark';
    }
  }

  // IUCN 官方色系
  function iucnStyle(cat: string): string {
    // 國內紅皮書 NVU→VU, NCR→CR, NLC→LC 等（只去掉 N+大寫 的前綴，不影響 NT, NE）
    const c = (cat || '').replace(/^N(?=LC|DD|VU|NT|EN|CR)/, '');
    switch (c) {
      case 'EX': return 'background:#000;color:#fff';        // 黑
      case 'EW': return 'background:#542344;color:#fff';     // 深紫
      case 'CR': return 'background:#d81e05;color:#fff';     // 紅
      case 'EN': return 'background:#fc7f3f;color:#000';     // 橘
      case 'VU': return 'background:#f9e814;color:#000';     // 黃
      case 'NT': return 'background:#cce226;color:#000';     // 黃綠
      case 'LC': return 'background:#60c659;color:#000';     // 綠
      case 'DD': return 'background:#d1d1c6;color:#000';     // 灰
      case 'NE': return 'background:#fff;color:#000;border:1px solid #ccc';
      default:   return 'background:#e5e7eb;color:#000';     // 淺灰（NA, NLC 等）
    }
  }

  // name = 不含命名者的學名；fallback 從 fullname 取屬名+種名
  $: scientificName = species?.name || (species?.fullname?.match(/^([A-Z][a-z]+ [a-z\-]+(?:\s+(?:subsp\.|var\.|f\.|fo\.)\s+[a-z\-]+)*)/)?.[1] ?? '');

  // 俗名：取第一個（去掉括號中的第二俗名）
  $: primaryCname = (species?.cname || '').replace(/\(.*\)$/, '').trim();

  // 判斷是否為植物（用於顯示植物專用連結）— 僅以 kingdom 判斷
  $: isPlant = species?.kingdom === 'Plantae';

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

      <div class="space-y-4">
        <!-- Block 1: 物種狀態 -->
        <div>
          <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">物種狀態</h3>
          <div class="flex flex-wrap gap-2">
            {#if species.source}
              <Badge color={sourceColor(species.source)}>{species.source}</Badge>
            {/if}
            {#if species.endemic === 1}
              <Badge color="purple">臺灣特有</Badge>
            {/if}
            {#if species.is_hybrid === 'true'}
              <Badge color="pink">雜交種</Badge>
            {/if}
          </div>

          <!-- 棲地 -->
          {#if habitatTags.length > 0}
            <div class="flex flex-wrap gap-1 mt-2">
              {#each habitatTags as tag}
                <Badge color="blue" class="text-xs">{tag}</Badge>
              {/each}
            </div>
          {/if}

          <!-- 來源參考文獻 -->
          {#if species.alien_status_note}
            <div class="mt-2">
              <p class="text-xs font-semibold text-gray-500 mb-1">來源參考文獻</p>
              <table class="text-xs w-full">
                <tbody>
                  {#each species.alien_status_note.split('|') as entry}
                    {@const parts = entry.trim().match(/^([^:]+):\s*(.+)$/)}
                    <tr class="border-t border-gray-100 dark:border-gray-700">
                      {#if parts}
                        <td class="py-1 pr-2 text-gray-500 whitespace-nowrap">{parts[1].trim()}</td>
                        <td class="py-1 text-gray-700 dark:text-gray-300">{parts[2].trim()}</td>
                      {:else}
                        <td class="py-1 text-gray-700 dark:text-gray-300" colspan="2">{entry.trim()}</td>
                      {/if}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <!-- 命名法規 -->
          {#if species.nomenclature_name}
            <p class="text-xs text-gray-400 mt-1">命名法規: {species.nomenclature_name}</p>
          {/if}
        </div>

        <!-- Block 2: 保育狀態 -->
        {#if species.redlist || species.iucn_category || species.cites || species.protected}
        <div>
          <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">保育狀態</h3>
          <div class="flex flex-wrap gap-2">
            {#if species.redlist}
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={iucnStyle(species.redlist)}>
                臺灣紅皮書: {species.redlist}
              </span>
            {/if}
            {#if species.iucn_category}
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={iucnStyle(species.iucn_category)}>
                IUCN: {species.iucn_category}
              </span>
            {/if}
            {#if species.cites}
              <Badge color="red">CITES 附錄 {species.cites}</Badge>
            {/if}
            {#if species.protected}
              <Badge color="purple">
                {#if species.protected === '1'}
                  文資法珍貴稀有植物
                {:else}
                  保育類 {species.protected}
                {/if}
              </Badge>
            {/if}
          </div>
        </div>
        {/if}
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

  <!-- 參考文獻 -->
  {#if references.length > 0}
  <Card class="max-w-none" size="xl">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">參考文獻</h3>
    <ul class="space-y-2">
      {#each references as ref}
        <li class="text-sm text-gray-700 dark:text-gray-300">
          <span>{ref.citation}</span>
          {#if ref.doi}
            <a href="https://doi.org/{ref.doi}" target="_blank" class="text-blue-600 hover:underline ml-1 text-xs">DOI</a>
          {/if}
          {#if ref.url}
            <a href={ref.url} target="_blank" class="text-blue-600 hover:underline ml-1 text-xs">連結</a>
          {/if}
          {#if ref.note}
            <span class="text-xs text-gray-400 ml-1">({ref.note})</span>
          {/if}
        </li>
      {/each}
    </ul>
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
