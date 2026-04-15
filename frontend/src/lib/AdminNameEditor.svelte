<script lang="ts">
  import { Card, Button, Input, Select, Toggle, Label, Badge, Alert, Spinner } from 'flowbite-svelte';
  import AdminConfirmDialog from './AdminConfirmDialog.svelte';
  import AdminCascadeDialog from './AdminCascadeDialog.svelte';
  import AdminMoveDialog from './AdminMoveDialog.svelte';

  export let record: any = null;
  export let onSaved: () => void = () => {};
  export let onNavigate: (name: string) => void = () => {};

  // 搬移
  let showMoveDialog = false;
  // 可搬移的 rank（有明確上層的）
  const MOVEABLE_RANKS = ['genus', 'family', 'order', 'class', 'phylum'];
  $: canMove = record && MOVEABLE_RANKS.includes(record.rank?.toLowerCase());

  // 編輯用的本地副本
  let form: Record<string, any> = {};
  let original: Record<string, any> = {};
  let saving = false;
  let saveError = '';
  let saveSuccess = '';
  let showConfirm = false;
  let pendingChanges: Record<string, { old: string; new: string }> = {};

  // Cascade：usage_status 改為 accepted 時連動
  let showCascade = false;
  let cascadeOldAccepted: { name_id: number; simple_name: string; name_author: string } | null = null;
  let cascadeNewStatus: string | null = null;

  // record 變更時重置表單
  $: if (record) {
    original = { ...record };
    form = { ...record };
    altNames = parseAltNames(record.alternative_name_c);
    noteEntries = parseNoteEntries(record.alien_status_note);
    rankQuery = record.rank || '';
    saveError = '';
    saveSuccess = '';
  }

  // Species 以下才顯示物種狀態欄位
  const SPECIES_RANKS = [
    'Species', 'Subspecies', 'Variety', 'Form', 'Forma', 'Subform', 'Subvariety',
    'Nothosubspecies', 'Nothovariety', 'Aberration', 'Morph', 'Race', 'Special Form',
  ];
  $: isSpeciesLevel = record && SPECIES_RANKS.includes(record.rank);

  // 分類階層（結構化，用於超連結）
  $: taxonomySteps = record
    ? [record.kingdom, record.phylum, record.class, record.order, record.family, record.genus]
        .filter(Boolean)
    : [];

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
  let showRankDropdown = false;

  function filterRanks() {
    if (!rankQuery) {
      rankSuggestions = ALL_RANKS;
    } else {
      const q = rankQuery.toLowerCase();
      rankSuggestions = ALL_RANKS.filter(r => r.toLowerCase().includes(q));
    }
  }

  function selectRank(rank: string) {
    form.rank = rank;
    rankQuery = rank;
    showRankDropdown = false;
  }

  const statusOptions = [
    { value: 'accepted', name: 'accepted' },
    { value: 'not-accepted', name: 'not-accepted' },
    { value: 'misapplied', name: 'misapplied' },
  ];

  const alienOptions = [
    { value: 'native', name: '原生 native' },
    { value: 'naturalized', name: '歸化 naturalized' },
    { value: 'invasive', name: '入侵 invasive' },
    { value: 'cultured', name: '栽培 cultured' },
  ];

  const redlistOptions = [
    { value: 'EX', name: 'EX (滅絕)' },
    { value: 'EW', name: 'EW (野外滅絕)' },
    { value: 'RE', name: 'RE (區域滅絕)' },
    { value: 'NCR', name: 'NCR (國家極危)' },
    { value: 'NEN', name: 'NEN (國家瀕危)' },
    { value: 'NVU', name: 'NVU (國家易危)' },
    { value: 'NNT', name: 'NNT (國家接近受脅)' },
    { value: 'NLC', name: 'NLC (國家安全)' },
    { value: 'DD', name: 'DD (資料不足)' },
    { value: 'NA', name: 'NA (不適用)' },
    { value: 'NE', name: 'NE (未評估)' },
  ];

  const iucnOptions = [
    { value: 'EX', name: 'EX (Extinct)' },
    { value: 'EW', name: 'EW (Extinct in the Wild)' },
    { value: 'RE', name: 'RE (Regionally Extinct)' },
    { value: 'CR', name: 'CR (Critically Endangered)' },
    { value: 'EN', name: 'EN (Endangered)' },
    { value: 'VU', name: 'VU (Vulnerable)' },
    { value: 'NT', name: 'NT (Near Threatened)' },
    { value: 'LC', name: 'LC (Least Concern)' },
    { value: 'DD', name: 'DD (Data Deficient)' },
    { value: 'NA', name: 'NA (Not Applicable)' },
    { value: 'NE', name: 'NE (Not Evaluated)' },
  ];

  const protectedOptions = [
    { value: 'I', name: 'I (瀕臨絕種保育類)' },
    { value: 'II', name: 'II (珍貴稀有保育類)' },
    { value: 'III', name: 'III (其他應予保育類)' },
    { value: '1', name: '文資法公告珍貴稀有植物' },
  ];

  const citesOptions = [
    { value: 'I', name: 'I (禁止商業貿易)' },
    { value: 'II', name: 'II (限制貿易)' },
    { value: 'III', name: 'III (個別國家列入)' },
    { value: 'I/II', name: 'I/II' },
    { value: 'NC', name: 'NC (非列入)' },
  ];

  // 來源參考文獻：解析 "type: citation|type: citation" 為條列
  const alienNoteTypes = [
    { value: 'native', name: '原生 native' },
    { value: 'naturalized', name: '歸化 naturalized' },
    { value: 'invasive', name: '入侵 invasive' },
    { value: 'cultured', name: '栽培 cultured' },
  ];

  let noteEntries: { type: string; citation: string }[] = [];
  let newNoteType = '';
  let newNoteCitation = '';

  function parseNoteEntries(raw: string): { type: string; citation: string }[] {
    if (!raw) return [];
    return raw.split('|').map(s => s.trim()).filter(Boolean).map(entry => {
      const m = entry.match(/^([^:]+):\s*(.+)$/);
      return m ? { type: m[1].trim(), citation: m[2].trim() } : { type: '', citation: entry };
    });
  }

  function serializeNoteEntries(entries: { type: string; citation: string }[]): string {
    return entries.map(e => e.type ? `${e.type}: ${e.citation}` : e.citation).join('|');
  }

  function addNoteEntry() {
    if (!newNoteCitation.trim()) return;
    const t = newNoteType || form.alien_type || '';
    noteEntries = [...noteEntries, { type: t, citation: newNoteCitation.trim() }];
    form.alien_status_note = serializeNoteEntries(noteEntries);
    newNoteCitation = '';
  }

  function removeNoteEntry(i: number) {
    noteEntries = noteEntries.filter((_, idx) => idx !== i);
    form.alien_status_note = serializeNoteEntries(noteEntries);
  }

  // alien_type 變更時，預設 newNoteType 連動
  $: if (form.alien_type) {
    newNoteType = form.alien_type;
  }

  // 別名管理
  let altNames: string[] = [];

  function parseAltNames(val: string): string[] {
    if (!val) return [];
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }

  function syncAltNames() {
    form.alternative_name_c = altNames.filter(Boolean).join(', ');
  }

  function addAltName() {
    altNames = [...altNames, ''];
  }

  function removeAltName(index: number) {
    altNames = altNames.filter((_, i) => i !== index);
    syncAltNames();
  }

  // 拖拉：別名 → 俗名互換 + 別名間排序
  let dragIndex: number | null = null;
  let dragOverPrimary = false;
  let dragOverIndex: number | null = null;

  function handleDragStart(index: number) {
    dragIndex = index;
  }

  function handleDropOnPrimary() {
    if (dragIndex === null) return;
    const draggedName = altNames[dragIndex];
    if (!draggedName) { dragOverPrimary = false; return; }
    const oldPrimary = form.common_name_c;
    form.common_name_c = draggedName;
    altNames[dragIndex] = oldPrimary;
    altNames = [...altNames];
    syncAltNames();
    dragIndex = null;
    dragOverPrimary = false;
  }

  function handleDropOnAlt(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      dragOverIndex = null;
      return;
    }
    // 從原位置移除，插入到目標位置
    const item = altNames[dragIndex];
    const arr = altNames.filter((_, i) => i !== dragIndex);
    const insertAt = dragIndex < targetIndex ? targetIndex - 1 : targetIndex;
    arr.splice(insertAt, 0, item);
    altNames = arr;
    syncAltNames();
    dragIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    dragIndex = null;
    dragOverPrimary = false;
    dragOverIndex = null;
  }

  function computeDiff(): Record<string, { old: string; new: string }> {
    const diff: Record<string, { old: string; new: string }> = {};
    const editableFields = [
      'simple_name', 'name_author', 'rank', 'usage_status',
      'common_name_c', 'alternative_name_c', 'family_c', 'genus_c',
      'is_in_taiwan', 'is_endemic', 'is_hybrid', 'alien_type', 'iucn', 'redlist', 'protected',
      'cites', 'alien_status_note',
      'is_fossil', 'is_terrestrial', 'is_freshwater', 'is_brackish', 'is_marine',
    ];
    for (const field of editableFields) {
      const oldVal = String(original[field] || '');
      const newVal = String(form[field] || '');
      if (oldVal !== newVal) {
        diff[field] = { old: original[field] || '', new: form[field] || '' };
      }
    }
    return diff;
  }

  function handleSave() {
    saveError = '';
    saveSuccess = '';
    const diff = computeDiff();
    if (Object.keys(diff).length === 0) {
      saveError = '無任何變更';
      return;
    }
    pendingChanges = diff;
    showConfirm = true;
  }

  async function confirmSave() {
    showConfirm = false;
    saving = true;
    saveError = '';
    saveSuccess = '';

    const changes: Record<string, any> = {};
    for (const [field, diff] of Object.entries(pendingChanges)) {
      changes[field] = diff.new;
    }

    // 組裝 request body
    const body: any = { changes };
    if (cascadeNewStatus) {
      body.cascade_old_accepted = cascadeNewStatus;
    }

    try {
      const res = await fetch(`/api/admin/name/${record.name_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.status === 409 && data.error === 'cascade_required') {
        // 後端偵測到需要 cascade — 彈出選擇 popup
        saving = false;
        cascadeOldAccepted = data.old_accepted;
        showCascade = true;
        return;
      }

      if (res.ok && data.status === 'updated') {
        let msg = `已儲存 ${Object.keys(data.changes).length} 項變更`;
        if (data.cascade) {
          msg += `，同時將 ${data.cascade.name_id} 降級為 ${Object.values(data.cascade.changes)[0]?.new || ''}`;
        }
        saveSuccess = msg;
        cascadeNewStatus = null;
        original = { ...form };
        onSaved();
      } else {
        saveError = data.error || data.message || '儲存失敗';
      }
    } catch (e) {
      saveError = `儲存錯誤: ${e}`;
    }
    saving = false;
  }

  function handleCancel() {
    form = { ...original };
    noteEntries = parseNoteEntries(original.alien_status_note);
    saveError = '';
    saveSuccess = '';
  }

  function handleCascadeConfirm(newStatus: string) {
    showCascade = false;
    cascadeNewStatus = newStatus;
    // 帶著 cascade 再送一次
    confirmSave();
  }

  function handleCascadeCancel() {
    showCascade = false;
    cascadeOldAccepted = null;
    cascadeNewStatus = null;
    // 還原 usage_status
    form.usage_status = original.usage_status;
    saveError = '已取消狀態變更';
  }
</script>

{#if !record}
  <div class="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
    <p>請先搜尋並選取一筆記錄</p>
  </div>
{:else}
  <div class="space-y-4">
    <!-- 唯讀資訊 -->
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div>
        <span class="text-gray-500">Taxon ID:</span>
        <span class="font-mono">{record.taxon_id}</span>
      </div>
      <div>
        <span class="text-gray-500">Name ID:</span>
        <span class="font-mono">{record.name_id}</span>
      </div>
    </div>

    <div class="text-sm flex items-center gap-2">
      <div>
        <span class="text-gray-500">分類階層:</span>
        {#each taxonomySteps as step, i}
          {#if i > 0}<span class="text-gray-400 mx-1">&gt;</span>{/if}
          <button
            type="button"
            class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
            on:click={() => onNavigate(step)}
          >{step}</button>
        {/each}
      </div>
      {#if canMove}
        <button
          type="button"
          class="text-xs text-orange-600 hover:text-orange-800 border border-orange-300 rounded px-2 py-0.5"
          on:click={() => { showMoveDialog = true; }}
        >搬移</button>
      {/if}
    </div>

    <hr class="border-gray-200 dark:border-gray-700" />

    <!-- 可編輯欄位 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <Label for="simple_name" class="mb-1">學名</Label>
        <Input id="simple_name" bind:value={form.simple_name} size="sm" />
      </div>
      <div>
        <Label for="name_author" class="mb-1">命名者</Label>
        <Input id="name_author" bind:value={form.name_author} size="sm" />
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="relative">
        <Label for="rank" class="mb-1">Rank</Label>
        <Input id="rank" size="sm"
          bind:value={rankQuery}
          on:input={() => { filterRanks(); showRankDropdown = true; }}
          on:focus={() => { filterRanks(); showRankDropdown = true; }}
          on:blur={() => { setTimeout(() => { showRankDropdown = false; }, 150); }}
          placeholder="輸入搜尋 rank..."
          autocomplete="off"
        />
        {#if showRankDropdown && rankSuggestions.length > 0}
          <div class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-48 overflow-y-auto">
            {#each rankSuggestions as r}
              <button
                type="button"
                class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700
                  {r === form.rank ? 'bg-blue-50 dark:bg-blue-900 font-semibold' : ''}"
                on:mousedown|preventDefault={() => selectRank(r)}
              >{r}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div>
        <Label for="usage_status" class="mb-1">使用狀態</Label>
        <Select id="usage_status" items={statusOptions} bind:value={form.usage_status} size="sm" />
      </div>
    </div>

    <!-- 俗名（可接受別名拖入） -->
    <div>
      <Label for="common_name_c" class="mb-1">俗名</Label>
      <div
        class="rounded border-2 transition-colors {dragOverPrimary ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent'}"
        on:dragover|preventDefault={() => { dragOverPrimary = true; }}
        on:dragleave={() => { dragOverPrimary = false; }}
        on:drop|preventDefault={handleDropOnPrimary}
        role="region"
      >
        <Input id="common_name_c" bind:value={form.common_name_c} size="sm" />
      </div>
      {#if altNames.length > 0}
        <p class="text-xs text-gray-400 mt-0.5">可將別名拖曳至此交換</p>
      {/if}
    </div>

    <!-- 別名（可拖曳，多筆） -->
    <div>
      <div class="flex items-center gap-2 mb-1">
        <Label class="mb-0">別名</Label>
        <button
          type="button"
          class="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
          on:click={addAltName}
        >+ 新增</button>
      </div>
      {#if altNames.length === 0}
        <p class="text-xs text-gray-400 italic">無別名。點「+ 新增」加入。</p>
      {/if}
      {#each altNames as name, i}
        <div
          class="flex gap-2 mb-1 items-center rounded transition-colors
            {dragOverIndex === i ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-300' : 'border border-transparent'}"
          draggable="true"
          on:dragstart={() => handleDragStart(i)}
          on:dragover|preventDefault={() => { dragOverIndex = i; }}
          on:dragleave={() => { if (dragOverIndex === i) dragOverIndex = null; }}
          on:drop|preventDefault={() => handleDropOnAlt(i)}
          on:dragend={handleDragEnd}
        >
          <span class="cursor-grab text-gray-400 hover:text-gray-600 select-none" title="拖曳排序或拖至俗名交換">⠿</span>
          <Input
            size="sm"
            bind:value={altNames[i]}
            on:input={syncAltNames}
            placeholder="別名 {i + 1}"
            class="flex-1"
          />
          <button
            type="button"
            class="text-xs text-red-500 hover:text-red-700 px-2"
            on:click={() => removeAltName(i)}
          >✕</button>
        </div>
      {/each}
    </div>

    <!-- 科中文名：僅 Family rank 顯示 -->
    {#if form.rank === 'Family' || form.rank === 'Subfamily' || form.rank === 'Superfamily' || form.rank === 'Epifamily'}
      <div>
        <Label for="family_c" class="mb-1">科中文名</Label>
        <Input id="family_c" bind:value={form.family_c} size="sm" />
      </div>
    {/if}
    <!-- 屬中文名：僅 Genus/Subgenus rank 顯示 -->
    {#if form.rank === 'Genus' || form.rank === 'Subgenus'}
      <div>
        <Label for="genus_c" class="mb-1">屬中文名</Label>
        <Input id="genus_c" bind:value={form.genus_c} size="sm" />
      </div>
    {/if}

    <!-- 現存於臺灣 -->
    <div class="flex items-center gap-3">
      <input type="checkbox"
        checked={form.is_in_taiwan === 'true' || record?.has_taiwan_children}
        disabled={record?.has_taiwan_children}
        on:change={(e) => { if (!record?.has_taiwan_children) form.is_in_taiwan = e.currentTarget.checked ? 'true' : ''; }}
        class="w-4 h-4 rounded {record?.has_taiwan_children ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600'}"
      />
      <span class="text-sm {record?.has_taiwan_children ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}">
        現存於臺灣
        {#if record?.has_taiwan_children}
          <span class="text-xs">（底下有現存於臺灣的分類群，不可修改）</span>
        {/if}
      </span>
    </div>

    <!-- 物種層級欄位 -->
    {#if isSpeciesLevel}
      <hr class="border-gray-200 dark:border-gray-700" />
      <p class="text-xs text-gray-400">以下欄位僅 Species 及以下層級顯示</p>

      <div class="flex items-center gap-6">
        <div class="flex items-center gap-2">
          <input type="checkbox"
          checked={form.is_endemic === 'true'}
          on:change={(e) => { form.is_endemic = e.currentTarget.checked ? 'true' : ''; }}
          class="w-4 h-4 text-blue-600 rounded"
          />
          <span class="text-sm text-gray-700 dark:text-gray-300">臺灣特有</span>
        </div>
        <div class="flex items-center gap-2">
          <input type="checkbox"
          checked={form.is_hybrid === 'true'}
          on:change={(e) => { form.is_hybrid = e.currentTarget.checked ? 'true' : 'false'; }}
          class="w-4 h-4 text-purple-600 rounded"
          />
          <span class="text-sm text-gray-700 dark:text-gray-300">雜交種</span>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label for="alien_type" class="mb-1">原生/歸化</Label>
          <Select id="alien_type" items={alienOptions} bind:value={form.alien_type} size="sm" placeholder="選擇..." />
        </div>
        <div>
          <Label for="redlist" class="mb-1">國內紅皮書</Label>
          <Select id="redlist" items={redlistOptions} bind:value={form.redlist} size="sm" placeholder="選擇..." />
        </div>
        <div>
          <Label for="iucn" class="mb-1">IUCN 等級</Label>
          <Select id="iucn" items={iucnOptions} bind:value={form.iucn} size="sm" placeholder="選擇..." />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label for="cites" class="mb-1">CITES</Label>
          <Select id="cites" items={citesOptions} bind:value={form.cites} size="sm" placeholder="選擇..." />
        </div>
        <div>
          <Label for="protected" class="mb-1">保育類/珍稀植物</Label>
          <Select id="protected" items={protectedOptions} bind:value={form.protected} size="sm" placeholder="選擇..." />
        </div>
      </div>

      <!-- 來源參考文獻 -->
      <div>
        <Label class="mb-1">來源參考文獻</Label>
        <div class="flex gap-2 items-end">
          <div class="w-36">
            <Select size="sm" items={alienNoteTypes} bind:value={newNoteType} placeholder="類型" />
          </div>
          <div class="flex-1">
            <Input size="sm" bind:value={newNoteCitation} placeholder="Author, Year" on:keydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNoteEntry(); }}} />
          </div>
          <Button size="sm" color="blue" on:click={addNoteEntry} disabled={!newNoteCitation.trim()}>新增</Button>
        </div>
        {#if noteEntries.length > 0}
          <ul class="mt-2 space-y-1">
            {#each noteEntries as entry, i}
              <li class="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400 w-20 shrink-0">{entry.type}</span>
                <span class="flex-1 text-gray-700 dark:text-gray-300">{entry.citation}</span>
                {#if form.alien_type && entry.type && entry.type !== form.alien_type}
                  <span class="text-xs text-red-500 shrink-0" title="類型與原生/歸化不一致">不一致</span>
                {/if}
                <button class="text-red-400 hover:text-red-600 text-xs shrink-0 px-1" on:click={() => removeNoteEntry(i)} title="刪除">✕</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
        {#each [
          ['is_terrestrial', '陸域'],
          ['is_freshwater', '淡水'],
          ['is_brackish', '半鹹水'],
          ['is_marine', '海洋'],
          ['is_fossil', '化石'],
        ] as [field, label]}
          <div class="flex items-center gap-2">
            <input type="checkbox"
              checked={form[field] === 'true'}
              on:change={(e) => { form[field] = e.currentTarget.checked ? 'true' : 'false'; }}
              class="w-4 h-4 text-blue-600 rounded" />
            <span class="text-sm">{label}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- 操作按鈕 -->
    <hr class="border-gray-200 dark:border-gray-700" />
    <div class="flex gap-3">
      <Button color="blue" on:click={handleSave} disabled={saving}>
        {#if saving}<Spinner size="4" class="me-2" />{/if}
        儲存
      </Button>
      <Button color="alternative" on:click={handleCancel} disabled={saving}>取消</Button>
    </div>

    {#if saveSuccess}
      <Alert color="green" class="text-sm">{saveSuccess}</Alert>
    {/if}
    {#if saveError}
      <Alert color="red" class="text-sm">{saveError}</Alert>
    {/if}
  </div>

  <!-- 確認 popup -->
  <AdminConfirmDialog
    bind:open={showConfirm}
    nameId={record.name_id}
    simpleName={record.simple_name}
    changes={pendingChanges}
    onConfirm={confirmSave}
    onCancel={() => { showConfirm = false; }}
  />

  <!-- Cascade: usage_status 改 accepted 時連動降級 -->
  <AdminCascadeDialog
    bind:open={showCascade}
    oldAccepted={cascadeOldAccepted}
    onConfirm={handleCascadeConfirm}
    onCancel={handleCascadeCancel}
  />

  <!-- 搬移分類群 -->
  <AdminMoveDialog
    bind:open={showMoveDialog}
    sourceRank={record?.rank?.toLowerCase() || ''}
    sourceName={record?.simple_name || ''}
    onMoved={() => { onSaved(); }}
  />
{/if}
