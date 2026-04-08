<script lang="ts">
  import { Button, Modal, Textarea, Spinner, Badge } from 'flowbite-svelte';
  import { UploadOutline } from 'flowbite-svelte-icons';
  import { importYAMLText } from "$lib/importer";
  import { selectedSpecies } from "$stores/speciesStore";
  import { unresolvedStore } from "$stores/importState";
  import { formatScientificName } from '$lib/formatter';
  import { get } from "svelte/store";

  let showModal = false;
  let textInput = "";
  let processing = false;
  let statusMessage = "";
  let fileInput: HTMLInputElement;

  // 需確認的物種（在 modal 內顯示）
  let pendingAmbiguous: Record<string, any[]> = {};
  let pendingUnresolved: string[] = [];

  $: hasPending = Object.keys(pendingAmbiguous).length > 0 || pendingUnresolved.length > 0;

  async function handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement)?.files?.[0];
    if (!file) return;
    const text = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'yaml' || ext === 'yml') {
      const result = await importYAMLText(text);
      statusMessage = result ?? "匯入成功";
      if (!result) showModal = false;
    } else {
      textInput = text;
    }
    (event.target as HTMLInputElement).value = '';
  }

  async function processBatchText() {
    if (!textInput.trim()) return;

    processing = true;
    statusMessage = "";
    pendingAmbiguous = {};

    const names = textInput
      .split(/[\n,]/)
      .map(n => n.trim())
      .filter(n => n.length > 0);

    if (names.length === 0) {
      statusMessage = "沒有找到有效的名稱";
      processing = false;
      return;
    }

    let added = 0;
    let ambiguous = 0;
    let unresolved: string[] = [];
    const newAmbiguous: Record<string, any[]> = {};

    for (const name of names) {
      const variants = [name];
      if (name.includes("台")) variants.push(name.replace(/台/g, "臺"));
      else if (name.includes("臺")) variants.push(name.replace(/臺/g, "台"));

      let found = false;

      for (const q of variants) {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          if (!res.ok) continue;
          const results = await res.json();
          if (results.length === 0) continue;

          // 精確匹配：俗名或學名完全一致
          const exact = results.filter((r: any) =>
            r.cname === q || r.name === q || r.cname === name
          );

          if (exact.length === 1) {
            selectedSpecies.update(current => {
              if (!current.find(entry => entry.id === exact[0].id)) {
                return [...current, exact[0]];
              }
              return current;
            });
            added++;
            found = true;
            break;
          } else if (exact.length > 1) {
            newAmbiguous[name] = exact;
            ambiguous++;
            found = true;
            break;
          } else if (results.length > 0) {
            newAmbiguous[name] = results.slice(0, 8);
            ambiguous++;
            found = true;
            break;
          }
        } catch { /* ignore */ }
      }

      if (!found) {
        unresolved.push(name);
      }
    }

    pendingAmbiguous = newAmbiguous;
    pendingUnresolved = unresolved;
    statusMessage = `處理完成：${added} 筆加入、${ambiguous} 筆需確認、${unresolved.length} 筆未收錄`;
    processing = false;
    textInput = "";

    // 全部成功：自動關閉
    if (ambiguous === 0 && unresolved.length === 0) {
      showModal = false;
    }
  }

  function selectAmbiguousOption(name: string, item: any) {
    selectedSpecies.update(current => {
      if (!current.find(entry => entry.id === item.id)) {
        return [...current, item];
      }
      return current;
    });
    const updated = { ...pendingAmbiguous };
    delete updated[name];
    pendingAmbiguous = updated;
  }

  function skipAmbiguous(name: string) {
    const updated = { ...pendingAmbiguous };
    delete updated[name];
    pendingAmbiguous = updated;
  }

  function skipAllAmbiguous() {
    pendingAmbiguous = {};
  }

  function addToUnresolved(name: string) {
    unresolvedStore.update(current => [...current, name]);
    selectedSpecies.update(current => [
      ...current,
      {
        id: -(Date.now()),
        name, fullname: name, cname: name,
        family: "", family_cname: "",
        iucn_category: "", endemic: 0,
        source: "未收錄", pt_name: "",
        taxon_id: "", usage_status: "unresolved",
      }
    ]);
    pendingUnresolved = pendingUnresolved.filter(n => n !== name);
  }

  function ignoreUnresolved(name: string) {
    pendingUnresolved = pendingUnresolved.filter(n => n !== name);
  }

  function addAllUnresolved() {
    for (const name of pendingUnresolved) {
      addToUnresolved(name);
    }
    pendingUnresolved = [];
  }

  function ignoreAllUnresolved() {
    pendingUnresolved = [];
  }
</script>

<div class="flex items-center">
  <Button size="sm" color="light" on:click={() => showModal = true}>
    批次匯入
  </Button>
</div>

<Modal bind:open={showModal} title="批次匯入" size="xl">
  <div class="space-y-4">
    {#if !hasPending}
      <!-- 輸入區 -->
      <p class="text-sm text-gray-500 dark:text-gray-400">
        貼上俗名或學名列表（每行一個，或以逗號分隔），或上傳 YAML/TXT 檔案。
      </p>

      <Textarea
        rows={6}
        placeholder="臺灣二葉松&#10;玉山杜鵑&#10;Yushania niitakayamensis&#10;紅檜&#10;..."
        bind:value={textInput}
        class="font-mono text-sm"
      />

      <div class="flex gap-2">
        <input type="file" accept=".yaml,.yml,.txt,.csv" bind:this={fileInput} on:change={handleFileUpload} class="hidden" />
        <Button size="sm" color="alternative" on:click={() => fileInput.click()}>
          <UploadOutline class="w-4 h-4 me-1" />上傳檔案
        </Button>
        <span class="flex-1"></span>
        <Button size="sm" color="blue" on:click={processBatchText} disabled={processing || !textInput.trim()}>
          {#if processing}
            <Spinner size="4" class="me-2" />處理中...
          {:else}
            開始匯入
          {/if}
        </Button>
      </div>

    {:else}
      <!-- 需確認的物種列表 -->
      <div class="flex items-center gap-2 mb-2">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">請選擇正確的物種</h3>
        <Badge color="yellow">{Object.keys(pendingAmbiguous).length} 筆待確認</Badge>
        <span class="flex-1"></span>
        <Button size="xs" color="alternative" on:click={skipAllAmbiguous}>全部跳過</Button>
      </div>

      <div class="max-h-[60vh] overflow-y-auto space-y-4">
        <!-- 需確認（多筆對應） -->
        {#if Object.keys(pendingAmbiguous).length > 0}
          {#each Object.entries(pendingAmbiguous) as [name, options]}
            <div class="border-b border-gray-200 dark:border-gray-700 pb-3">
              <div class="flex items-center gap-2 mb-2">
                <p class="font-semibold text-blue-700 dark:text-blue-400">「{name}」有多筆對應：</p>
                <button class="text-xs text-gray-400 hover:text-red-500" on:click={() => skipAmbiguous(name)}>跳過</button>
              </div>
              <ul class="space-y-1">
                {#each options as item}
                  <li>
                    <button
                      class="w-full text-left hover:bg-blue-50 dark:hover:bg-gray-700 px-3 py-2 rounded text-sm"
                      on:click={() => selectAmbiguousOption(name, item)}
                    >
                      <span class="font-medium">{item.cname}</span>
                      <span class="ml-2 text-gray-500 italic">{@html formatScientificName(item.fullname)}</span>
                      <span class="ml-2 text-xs text-gray-400">({item.family_cname} {item.family})</span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        {/if}

        <!-- 未收錄（查無資料） -->
        {#if pendingUnresolved.length > 0}
          <div class="border-t border-gray-300 dark:border-gray-600 pt-3">
            <div class="flex items-center gap-2 mb-3">
              <h4 class="font-semibold text-red-600 dark:text-red-400">以下名稱查無資料：</h4>
              <Badge color="red">{pendingUnresolved.length} 筆</Badge>
              <span class="flex-1"></span>
              <Button size="xs" color="yellow" on:click={addAllUnresolved}>全部放入未收錄</Button>
              <Button size="xs" color="alternative" on:click={ignoreAllUnresolved}>全部忽略</Button>
            </div>
            {#each pendingUnresolved as name}
              <div class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
                <span class="flex-1 text-sm">{name}</span>
                <Button size="xs" color="yellow" on:click={() => addToUnresolved(name)}>放入未收錄</Button>
                <Button size="xs" color="alternative" on:click={() => ignoreUnresolved(name)}>忽略</Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if statusMessage}
      <p class="text-sm {statusMessage.includes('未收錄') ? 'text-yellow-600' : 'text-green-600'}">
        {statusMessage}
      </p>
    {/if}
  </div>
</Modal>
