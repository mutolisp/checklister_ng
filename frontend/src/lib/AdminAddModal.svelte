<script lang="ts">
  import { Modal, Button, Input, Select, Label, Alert, Spinner, Badge } from 'flowbite-svelte';

  export let open = false;
  export let initialQuery = '';
  export let onCreated: (nameId: number, taxonId: string) => void = () => {};

  // 依學名字尾判斷 rank
  function guessRankFromSuffix(name: string): string {
    // 順序很重要：長字尾先比對
    // 順序重要：長字尾先比對，避免短字尾誤匹配
    const suffixRules: [string, string][] = [
      ['phytina', 'Subphylum'],   // Magnoliophytina
      ['mycotina', 'Subphylum'],  // Pezizomycotina
      ['phyta', 'Phylum'],        // Tracheophyta, Bryophyta
      ['mycota', 'Phylum'],       // Ascomycota, Basidiomycota
      ['opsida', 'Class'],        // Magnoliopsida, Polypodiopsida
      ['psida', 'Class'],         // Pinopsida
      ['mycetes', 'Class'],       // Agaricomycetes
      ['oideae', 'Subfamily'],    // Faboideae（先於 -oidea, -eae）
      ['aceae', 'Family'],        // Pinaceae, Rosaceae（先於 -eae）
      ['oidea', 'Superfamily'],   // Papilionoidea
      ['idae', 'Family'],         // Felidae, Canidae
      ['inae', 'Subfamily'],      // Felinae
      ['ineae', 'Suborder'],      // Rosineae
      ['ales', 'Order'],          // Pinales, Rosales
      ['eae', 'Tribe'],           // Bambuseae（在 -aceae, -oideae 之後）
      ['ini', 'Tribe'],           // Pantherini
    ];

    const lower = name.toLowerCase();
    for (const [suffix, rank] of suffixRules) {
      if (lower.endsWith(suffix)) {
        return rank;
      }
    }
    return '';  // 無法判斷（可能是 Genus 或 Kingdom）
  }

  // 解析學名字串：拆分 simple_name / name_author / rank
  function parseScientificName(input: string): { simpleName: string; nameAuthor: string; rank: string; genus: string } {
    const s = input.trim();
    if (!s) return { simpleName: '', nameAuthor: '', rank: '', genus: '' };

    // 種下階層 regex: Genus species rank epithet [Author...]
    // e.g. "Abies kawakamii var. foo (Hayata) Ito"
    const infraRanks: [RegExp, string][] = [
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+subsp\.\s+[a-z\-]+)/i, 'Subspecies'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+var\.\s+[a-z\-]+)/i, 'Variety'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+fo\.\s+[a-z\-]+)/i, 'Forma'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+f\.\s+[a-z\-]+)/i, 'Forma'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+subvar\.\s+[a-z\-]+)/i, 'Subvariety'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+subf\.\s+[a-z\-]+)/i, 'Subform'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+nothosubsp\.\s+[a-z\-]+)/i, 'Nothosubspecies'],
      [/^([A-Z][a-z]+\s+[a-z\-]+\s+nothovar\.\s+[a-z\-]+)/i, 'Nothovariety'],
    ];

    for (const [re, rankName] of infraRanks) {
      const m = s.match(re);
      if (m) {
        const sn = m[1];
        const author = s.slice(sn.length).trim();
        const genusName = sn.split(/\s+/)[0];
        return { simpleName: sn, nameAuthor: author, rank: rankName, genus: genusName };
      }
    }

    // Species: "Genus species [Author...]"
    // 判斷：兩個以上小寫字母的 token，第一個大寫開頭
    const spMatch = s.match(/^([A-Z][a-z]+\s+[a-z\-]+)\s*(.*)/);
    if (spMatch) {
      const sn = spMatch[1];
      const author = spMatch[2]?.trim() || '';
      const genusName = sn.split(/\s+/)[0];
      return { simpleName: sn, nameAuthor: author, rank: 'Species', genus: genusName };
    }

    // 單字（monomial）：依字尾判斷 rank
    const monoMatch = s.match(/^([A-Z][a-z]{2,})\s*(.*)/);
    if (monoMatch) {
      const name = monoMatch[1];
      const author = monoMatch[2]?.trim() || '';
      const guessedRank = guessRankFromSuffix(name);
      return { simpleName: name, nameAuthor: author, rank: guessedRank, genus: '' };
    }

    return { simpleName: s, nameAuthor: '', rank: '', genus: '' };
  }

  // open 時：解析學名 + 做比對
  $: if (open && initialQuery) {
    const parsed = parseScientificName(initialQuery);
    simpleName = parsed.simpleName;
    nameAuthor = parsed.nameAuthor;
    if (parsed.rank) {
      rank = parsed.rank;
      rankQuery = parsed.rank;
    }
    if (parsed.genus) {
      genus = parsed.genus;
      taxonQueries['genus'] = parsed.genus;
    }
    // 自動比對
    if (parsed.simpleName) {
      doCheckSimilar(parsed.simpleName);
    }
  }

  async function doCheckSimilar(q: string) {
    checkingSimlar = true;
    similarResults = [];
    step = 0;
    try {
      const res = await fetch(`/api/admin/name/check-similar?q=${encodeURIComponent(q)}`);
      if (res.ok) similarResults = await res.json();
    } catch {}
    checkingSimlar = false;
  }

  let step = 0;  // 0=比對確認, 1=基本資訊, 2=分類階層, 3=俗名與狀態
  let saving = false;
  let error = '';

  // Step 0: 比對結果
  let similarResults: any[] = [];
  let checkingSimlar = false;

  // Step 1
  let simpleName = '';
  let nameAuthor = '';
  let rank = '';
  let usageStatus = 'accepted';
  let existingTaxonId = '';

  // Step 2
  let kingdom = '';
  let phylum = '';
  let className = '';
  let orderName = '';
  let family = '';
  let familyC = '';
  let genus = '';
  let genusC = '';

  // Step 3
  let commonNameC = '';
  let altNames: string[] = [];
  let isInTaiwan = true;
  let isEndemic = false;
  let alienType = '';
  let iucn = '';
  let redlist = '';

  // 參考文獻
  let references: { citation: string; doi: string; url: string; note: string }[] = [];

  function addReference() {
    references = [...references, { citation: '', doi: '', url: '', note: '' }];
  }
  function removeReference(i: number) {
    references = references.filter((_, idx) => idx !== i);
  }

  // Rank autocomplete
  const ALL_RANKS = [
    'Aberration', 'Class', 'Epifamily', 'Family', 'Form', 'Genus',
    'Hybrid Formula', 'Infraclass', 'Infrakingdom', 'Infraorder',
    'Infraphylum', 'Kingdom', 'Megaclass', 'Morph', 'Nothosubspecies',
    'Nothovariety', 'Order', 'Phylum', 'Race', 'Realm', 'Section',
    'Special Form', 'Species', 'Subclass', 'Subfamily', 'Subform',
    'Subgenus', 'Subkingdom', 'Suborder', 'Subphylum', 'Subsection',
    'Subspecies', 'Subtribe', 'Subvariety', 'Superclass', 'Superfamily',
    'Superkingdom', 'Superorder', 'Superphylum', 'Tribe', 'Unranked', 'Variety',
  ];
  let rankQuery = '';
  let rankSuggestions: string[] = [];
  let showRankDrop = false;

  function filterRanks() {
    if (!rankQuery) rankSuggestions = ALL_RANKS;
    else rankSuggestions = ALL_RANKS.filter(r => r.toLowerCase().includes(rankQuery.toLowerCase()));
  }
  function selectRank(r: string) { rank = r; rankQuery = r; showRankDrop = false; }

  // Taxonomy cascade autocomplete
  let taxonOptions: Record<string, string[]> = {};
  let taxonQueries: Record<string, string> = { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' };
  let taxonDropdowns: Record<string, boolean> = { kingdom: false, phylum: false, class: false, order: false, family: false, genus: false };

  async function loadOptions(level: string) {
    const params = new URLSearchParams({ rank: level });
    if (kingdom) params.set('kingdom', kingdom);
    if (phylum) params.set('phylum', phylum);
    if (className) params.set('class_name', className);
    if (orderName) params.set('order', orderName);
    if (family) params.set('family', family);
    try {
      const res = await fetch(`/api/admin/taxonomy/options?${params}`);
      if (res.ok) taxonOptions[level] = await res.json();
    } catch { taxonOptions[level] = []; }
  }

  function filteredOptions(level: string): string[] {
    const opts = taxonOptions[level] || [];
    const q = taxonQueries[level]?.toLowerCase() || '';
    if (!q) return opts.slice(0, 50);
    return opts.filter(o => o.toLowerCase().includes(q)).slice(0, 50);
  }

  async function selectTaxon(level: string, val: string) {
    taxonQueries[level] = val;
    taxonDropdowns[level] = false;

    // 先設定選取的值
    if (level === 'kingdom') { kingdom = val; }
    if (level === 'phylum') { phylum = val; }
    if (level === 'class') { className = val; }
    if (level === 'order') { orderName = val; }
    if (level === 'family') { family = val; }
    if (level === 'genus') { genus = val; }

    // 從 DB 查完整上層階層並自動填入
    try {
      const res = await fetch(`/api/admin/taxonomy/lookup?rank=${encodeURIComponent(level)}&name=${encodeURIComponent(val)}`);
      if (res.ok) {
        const h = await res.json();
        if (h.kingdom && !kingdom) { kingdom = h.kingdom; taxonQueries['kingdom'] = h.kingdom; }
        if (h.phylum && !phylum) { phylum = h.phylum; taxonQueries['phylum'] = h.phylum; }
        if (h.class && !className) { className = h.class; taxonQueries['class'] = h.class; }
        if (h.order && !orderName) { orderName = h.order; taxonQueries['order'] = h.order; }
        if (h.family && !family) { family = h.family; taxonQueries['family'] = h.family; }
        if (h.genus && !genus) { genus = h.genus; taxonQueries['genus'] = h.genus; }
        if (h.family_c && !familyC) { familyC = h.family_c; }
        if (h.genus_c && !genusC) { genusC = h.genus_c; }

        // 強制 Svelte 更新
        taxonQueries = { ...taxonQueries };
      }
    } catch {}
  }

  async function handleTaxonBlur(level: string) {
    const val = taxonQueries[level]?.trim();
    if (val) await selectTaxon(level, val);
  }

  function handleTaxonInput(level: string, val: string) {
    taxonQueries[level] = val;
    if (level === 'kingdom') kingdom = val;
    if (level === 'phylum') phylum = val;
    if (level === 'class') className = val;
    if (level === 'order') orderName = val;
    if (level === 'family') family = val;
    if (level === 'genus') genus = val;
  }

  // Species level check
  const SPECIES_RANKS = [
    'Species', 'Subspecies', 'Variety', 'Form', 'Forma', 'Subform', 'Subvariety',
    'Nothosubspecies', 'Nothovariety', 'Aberration', 'Morph', 'Race', 'Special Form',
  ];
  $: isSpeciesLevel = SPECIES_RANKS.includes(rank);

  const statusOptions = [
    { value: 'accepted', name: 'accepted' },
    { value: 'not-accepted', name: 'not-accepted' },
    { value: 'misapplied', name: 'misapplied' },
  ];
  const alienOptions = [
    { value: '', name: '—' },
    { value: 'native', name: '原生' },
    { value: 'naturalized', name: '歸化' },
    { value: 'invasive', name: '入侵' },
    { value: 'cultured', name: '栽培' },
  ];
  const redlistOptions = [
    { value: '', name: '—' }, { value: 'NLC', name: 'NLC' }, { value: 'NDD', name: 'NDD' },
    { value: 'NVU', name: 'NVU' }, { value: 'NNT', name: 'NNT' }, { value: 'NEN', name: 'NEN' },
    { value: 'NCR', name: 'NCR' }, { value: 'EX', name: 'EX' }, { value: 'EW', name: 'EW' },
    { value: 'NA', name: 'NA' },
  ];
  const iucnOptions = [
    { value: '', name: '—' }, { value: 'DD', name: 'DD' }, { value: 'LC', name: 'LC' },
    { value: 'NT', name: 'NT' }, { value: 'VU', name: 'VU' }, { value: 'EN', name: 'EN' },
    { value: 'CR', name: 'CR' }, { value: 'EX', name: 'EX' }, { value: 'EW', name: 'EW' },
  ];

  function addAltName() { altNames = [...altNames, '']; }
  function removeAltName(i: number) { altNames = altNames.filter((_, idx) => idx !== i); }

  function reset() {
    step = 0; error = '';
    simpleName = ''; nameAuthor = ''; rank = ''; rankQuery = '';
    usageStatus = 'accepted'; existingTaxonId = '';
    kingdom = ''; phylum = ''; className = ''; orderName = '';
    family = ''; familyC = ''; genus = ''; genusC = '';
    commonNameC = ''; altNames = []; references = [];
    isInTaiwan = true; isEndemic = false; alienType = ''; iucn = ''; redlist = '';
    taxonQueries = { kingdom: '', phylum: '', class: '', order: '', family: '', genus: '' };
    taxonOptions = {}; similarResults = [];
  }

  function canNext(): boolean {
    if (step === 1) return !!simpleName && !!rank;
    if (step === 2) return true;
    return true;
  }

  async function handleSubmit() {
    error = '';
    saving = true;
    try {
      const res = await fetch('/api/admin/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simple_name: simpleName,
          name_author: nameAuthor,
          rank,
          usage_status: usageStatus,
          taxon_id: usageStatus !== 'accepted' ? existingTaxonId : undefined,
          common_name_c: commonNameC,
          alternative_name_c: altNames.filter(Boolean).join(', '),
          is_in_taiwan: isInTaiwan ? 'true' : '',
          is_endemic: isEndemic ? 'true' : '',
          alien_type: alienType,
          iucn,
          redlist,
          kingdom, phylum,
          class_name: className,
          order_name: orderName,
          family, family_c: familyC, genus, genus_c: genusC,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'created') {
        // 儲存參考文獻
        for (const ref of references.filter(r => r.citation.trim())) {
          await fetch('/api/admin/references', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name_id: data.name_id, ...ref }),
          });
        }
        onCreated(data.name_id, data.taxon_id);
        open = false;
        reset();
      } else {
        error = data.error || '新增失敗';
      }
    } catch (e) {
      error = `錯誤: ${e}`;
    }
    saving = false;
  }

  // 關閉時 reset
  $: if (!open) reset();

  const allTaxonLevels = [
    { key: 'kingdom', label: '界 Kingdom' },
    { key: 'phylum', label: '門 Phylum' },
    { key: 'class', label: '綱 Class' },
    { key: 'order', label: '目 Order' },
    { key: 'family', label: '科 Family' },
    { key: 'genus', label: '屬 Genus' },
  ];

  // rank → 該 rank 在階層中對應的 key（含同級）
  const RANK_TO_LEVEL: Record<string, string> = {
    'Kingdom': 'kingdom', 'Subkingdom': 'kingdom', 'Infrakingdom': 'kingdom', 'Superkingdom': 'kingdom',
    'Realm': 'kingdom',
    'Phylum': 'phylum', 'Subphylum': 'phylum', 'Superphylum': 'phylum', 'Infraphylum': 'phylum',
    'Class': 'class', 'Subclass': 'class', 'Superclass': 'class', 'Infraclass': 'class', 'Megaclass': 'class',
    'Order': 'order', 'Suborder': 'order', 'Superorder': 'order', 'Infraorder': 'order',
    'Family': 'family', 'Subfamily': 'family', 'Superfamily': 'family', 'Epifamily': 'family',
    'Tribe': 'family', 'Subtribe': 'family',
    'Genus': 'genus', 'Subgenus': 'genus', 'Section': 'genus', 'Subsection': 'genus',
  };

  // 根據 rank 過濾：只顯示該 rank 上層的階層（不含自身及以下）
  $: taxonLevels = (() => {
    const levelKey = RANK_TO_LEVEL[rank];
    if (!levelKey) return allTaxonLevels;  // Species 等種下階層 → 全部顯示
    const idx = allTaxonLevels.findIndex(l => l.key === levelKey);
    if (idx <= 0) return [];  // Kingdom → 不需要填上層
    return allTaxonLevels.slice(0, idx);
  })();
</script>

<Modal bind:open size="lg" title="新增分類群" autoclose={false}>
  <!-- Step indicator -->
  <div class="flex gap-2 mb-4">
    {#each [0, 1, 2, 3] as s}
      <div class="flex-1 h-1 rounded {step >= s ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}"></div>
    {/each}
  </div>

  {#if step === 0}
    <!-- Step 0: 比對確認 -->
    <h3 class="text-sm font-semibold text-gray-500 mb-3">比對確認</h3>
    {#if checkingSimlar}
      <div class="flex items-center gap-2 text-sm text-gray-500">
        <Spinner size="4" />搜尋資料庫中是否有相似學名...
      </div>
    {:else if similarResults.length > 0}
      <Alert color="yellow" class="text-sm mb-3">
        找到 {similarResults.length} 筆相似記錄，請確認以下是否為您要新增的分類群：
      </Alert>
      <div class="max-h-64 overflow-y-auto border rounded">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 dark:bg-gray-800 sticky top-0">
            <tr>
              <th class="px-3 py-1.5 text-left">name_id</th>
              <th class="px-3 py-1.5 text-left">學名</th>
              <th class="px-3 py-1.5 text-left">命名者</th>
              <th class="px-3 py-1.5 text-left">俗名</th>
              <th class="px-3 py-1.5 text-left">狀態</th>
              <th class="px-3 py-1.5 text-left">比對</th>
            </tr>
          </thead>
          <tbody>
            {#each similarResults as r}
              <tr class="border-t hover:bg-gray-50 dark:hover:bg-gray-700">
                <td class="px-3 py-1 font-mono text-xs">{r.name_id}</td>
                <td class="px-3 py-1 italic">{r.simple_name}</td>
                <td class="px-3 py-1 text-gray-500 text-xs">{r.name_author || ''}</td>
                <td class="px-3 py-1">{r.common_name_c || ''}</td>
                <td class="px-3 py-1">
                  <Badge color={r.usage_status === 'accepted' ? 'green' : r.usage_status === 'misapplied' ? 'red' : 'dark'} class="text-xs">{r.usage_status}</Badge>
                </td>
                <td class="px-3 py-1">
                  <Badge color={r.match_type === 'exact' ? 'red' : r.match_type === 'contains' ? 'yellow' : 'blue'} class="text-xs">
                    {r.match_type}{r.score ? ` ${r.score}%` : ''}
                  </Badge>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-sm text-gray-500 mt-2">確認以上皆非目標分類群後，點「確認新增」繼續。</p>
    {:else}
      <Alert color="green" class="text-sm">
        資料庫中未找到相似學名「{simpleName}」，可以新增。
      </Alert>
    {/if}

  {:else if step === 1}
    <!-- Step 1: 基本資訊 -->
    <h3 class="text-sm font-semibold text-gray-500 mb-3">Step 1: 基本資訊</h3>
    <div class="space-y-3">
      <div>
        <Label class="mb-1">學名 *</Label>
        <Input bind:value={simpleName} size="sm" placeholder="e.g. Abies kawakamii" />
      </div>
      <div>
        <Label class="mb-1">命名者</Label>
        <Input bind:value={nameAuthor} size="sm" placeholder="e.g. (Hayata) Ito" />
      </div>
      <div class="relative">
        <Label class="mb-1">Rank *</Label>
        <Input size="sm" bind:value={rankQuery}
          on:input={() => { filterRanks(); showRankDrop = true; }}
          on:focus={() => { filterRanks(); showRankDrop = true; }}
          on:blur={() => setTimeout(() => { showRankDrop = false; }, 150)}
          placeholder="輸入搜尋..."
          autocomplete="off"
        />
        {#if showRankDrop && rankSuggestions.length > 0}
          <div class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border rounded shadow-lg max-h-40 overflow-y-auto">
            {#each rankSuggestions as r}
              <button type="button"
                class="w-full text-left px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 {r === rank ? 'bg-blue-50 font-semibold' : ''}"
                on:mousedown|preventDefault={() => selectRank(r)}
              >{r}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div>
        <Label class="mb-1">使用狀態</Label>
        <Select items={statusOptions} bind:value={usageStatus} size="sm" />
      </div>
      {#if usageStatus !== 'accepted'}
        <div>
          <Label class="mb-1">Taxon ID (必填，已存在的 taxon)</Label>
          <Input bind:value={existingTaxonId} size="sm" placeholder="e.g. t0052518" />
        </div>
      {/if}
    </div>

  {:else if step === 2}
    <!-- Step 2: 分類階層 -->
    <h3 class="text-sm font-semibold text-gray-500 mb-3">Step 2: 分類階層</h3>
    <div class="space-y-2">
      {#each taxonLevels as { key, label }}
        <div class="relative">
          <Label class="mb-1 text-xs">{label}</Label>
          <Input size="sm"
            value={taxonQueries[key]}
            on:input={(e) => { handleTaxonInput(key, e.currentTarget.value); taxonDropdowns[key] = true; }}
            on:focus={() => { loadOptions(key); taxonDropdowns[key] = true; }}
            on:blur={() => setTimeout(() => { taxonDropdowns[key] = false; handleTaxonBlur(key); }, 150)}
            placeholder="輸入或選擇..."
            autocomplete="off"
          />
          {#if taxonDropdowns[key] && filteredOptions(key).length > 0}
            <div class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border rounded shadow-lg max-h-32 overflow-y-auto">
              {#each filteredOptions(key) as opt}
                <button type="button"
                  class="w-full text-left px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                  on:mousedown|preventDefault={() => selectTaxon(key, opt)}
                >{opt}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if rank === 'Family' || rank === 'Subfamily' || rank === 'Superfamily' || rank === 'Epifamily'}
        <div>
          <Label class="mb-1 text-xs">科中文名</Label>
          <Input bind:value={familyC} size="sm" />
        </div>
      {/if}
      {#if rank === 'Genus' || rank === 'Subgenus'}
        <div>
          <Label class="mb-1 text-xs">屬中文名</Label>
          <Input bind:value={genusC} size="sm" />
        </div>
      {/if}
    </div>

  {:else}
    <!-- Step 3: 俗名與狀態 -->
    <h3 class="text-sm font-semibold text-gray-500 mb-3">Step 3: 俗名與狀態</h3>
    <div class="space-y-3">
      <div>
        <Label class="mb-1">俗名</Label>
        <Input bind:value={commonNameC} size="sm" />
      </div>
      <div>
        <div class="flex items-center gap-2 mb-1">
          <Label class="mb-0">別名</Label>
          <button type="button" class="text-xs text-blue-600 hover:text-blue-800" on:click={addAltName}>+ 新增</button>
        </div>
        {#each altNames as name, i}
          <div class="flex gap-2 mb-1">
            <Input size="sm" bind:value={altNames[i]} placeholder="別名 {i+1}" class="flex-1" />
            <button type="button" class="text-xs text-red-500 px-2" on:click={() => removeAltName(i)}>✕</button>
          </div>
        {/each}
      </div>
      <div class="flex items-center gap-3">
        <input type="checkbox" bind:checked={isInTaiwan} class="w-4 h-4 text-blue-600 rounded" />
        <span class="text-sm">現存於臺灣</span>
      </div>
      {#if isSpeciesLevel}
        <div class="flex items-center gap-3">
          <input type="checkbox" bind:checked={isEndemic} class="w-4 h-4 text-blue-600 rounded" />
          <span class="text-sm">臺灣特有</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <Label class="mb-1 text-xs">原生/歸化</Label>
            <Select items={alienOptions} bind:value={alienType} size="sm" />
          </div>
          <div>
            <Label class="mb-1 text-xs">國內紅皮書</Label>
            <Select items={redlistOptions} bind:value={redlist} size="sm" />
          </div>
          <div>
            <Label class="mb-1 text-xs">IUCN</Label>
            <Select items={iucnOptions} bind:value={iucn} size="sm" />
          </div>
        </div>
      {/if}

      <!-- 參考文獻 -->
      <hr class="border-gray-200 dark:border-gray-700 my-3" />
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Label class="mb-0 font-semibold">參考文獻</Label>
          <button type="button" class="text-xs text-blue-600 hover:text-blue-800" on:click={addReference}>+ 新增</button>
        </div>
        {#if references.length === 0}
          <p class="text-xs text-gray-400 italic">無參考文獻。點「+ 新增」加入。</p>
        {/if}
        {#each references as ref, i}
          <div class="border rounded p-2 mb-2 space-y-1">
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-500">文獻 {i + 1}</span>
              <button type="button" class="text-xs text-red-500" on:click={() => removeReference(i)}>✕</button>
            </div>
            <Input size="sm" bind:value={references[i].citation} placeholder="引用格式 (必填)" />
            <div class="grid grid-cols-2 gap-1">
              <Input size="sm" bind:value={references[i].doi} placeholder="DOI (選填)" />
              <Input size="sm" bind:value={references[i].url} placeholder="URL (選填)" />
            </div>
            <Input size="sm" bind:value={references[i].note} placeholder="備註 (選填)" />
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if error}
    <Alert color="red" class="mt-3 text-sm">{error}</Alert>
  {/if}

  <svelte:fragment slot="footer">
    <div class="flex gap-3 w-full justify-between">
      <div>
        {#if step > 0 && step !== 0}
          <Button color="alternative" on:click={() => step--}>上一步</Button>
        {/if}
      </div>
      <div class="flex gap-2">
        <Button color="alternative" on:click={() => { open = false; }}>取消</Button>
        {#if step === 0}
          <Button color="blue" on:click={() => { step = 1; }} disabled={checkingSimlar}>
            {similarResults.length > 0 ? '確認新增' : '繼續'}
          </Button>
        {:else if step < 3}
          <Button color="blue" on:click={() => step++} disabled={!canNext()}>下一步</Button>
        {:else}
          <Button color="blue" on:click={handleSubmit} disabled={saving || !simpleName || !rank}>
            {#if saving}<Spinner size="4" class="me-2" />{/if}
            新增
          </Button>
        {/if}
      </div>
    </div>
  </svelte:fragment>
</Modal>
