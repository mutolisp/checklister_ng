<script lang="ts">
  import { Button, Card, Alert, Fileupload, Spinner } from 'flowbite-svelte';
  import { UploadOutline } from 'flowbite-svelte-icons';

  let file: File | null = null;
  let uploading = false;
  let result: { status: string; rows_imported: number; time_elapsed: number } | null = null;
  let error = "";

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    file = input.files?.[0] || null;
    result = null;
    error = "";
  }

  async function uploadFile() {
    if (!file) return;

    uploading = true;
    error = "";
    result = null;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/import-taicol", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        result = data;
      } else {
        error = data.error || "匯入失敗";
      }
    } catch (e) {
      error = `上傳錯誤: ${e}`;
    }

    uploading = false;
  }
</script>

<div class="max-w-2xl mx-auto p-8 space-y-6">
  <h1 class="text-2xl font-bold text-gray-900 dark:text-white">TaiCOL 名錄管理</h1>
  <p class="text-sm text-gray-500 dark:text-gray-400">
    上傳最新的 TaiCOL 物種名錄 CSV 檔案（學名版本）。匯入前會自動備份資料庫。
  </p>

  <Card class="max-w-none" size="xl">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">上傳 TaiCOL CSV</h2>

    <div class="space-y-4">
      <input
        type="file"
        accept=".csv"
        on:change={handleFileChange}
        class="block w-full text-sm text-gray-500 dark:text-gray-400
          file:mr-4 file:py-2 file:px-4
          file:rounded file:border-0
          file:text-sm file:font-semibold
          file:bg-blue-50 file:text-blue-700
          dark:file:bg-blue-900 dark:file:text-blue-300
          hover:file:bg-blue-100"
      />

      {#if file}
        <p class="text-sm text-gray-600 dark:text-gray-300">
          選取檔案：{file.name}（{(file.size / 1024 / 1024).toFixed(1)} MB）
        </p>
      {/if}

      <Button
        color="blue"
        on:click={uploadFile}
        disabled={!file || uploading}
        class="w-full"
      >
        {#if uploading}
          <Spinner size="4" class="me-2" />匯入中，請稍候...
        {:else}
          <UploadOutline class="w-4 h-4 me-2" />開始匯入
        {/if}
      </Button>
    </div>

    {#if result}
      <Alert color="green" class="mt-4">
        匯入成功！共 {result.rows_imported.toLocaleString()} 筆，耗時 {result.time_elapsed} 秒。
      </Alert>
    {/if}

    {#if error}
      <Alert color="red" class="mt-4">
        {error}
      </Alert>
    {/if}
  </Card>
</div>
