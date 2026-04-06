# 更新紀錄

## 2026-04-06：架構重構與物種詳細頁

### 移除項目

- **Electron app**（`electron-app/`）：移除整個 Electron wrapper。它沒有使用任何原生功能，僅開啟瀏覽器視窗，卻增加 584MB 的 `node_modules`。相同功能已由 `run.py` 的 `webbrowser.open()` 實現。
- **死碼**（`backend/api/main.py`）：移除未被使用的舊版主程式檔案，該檔案從未被 import 且包含壞掉的 router 引用。
- **註解程式碼**：清除 `backend/main.py`、`backend/api/export.py`、`backend/models/schema.py` 中約 100 行的註解程式碼。
- **未使用的依賴**：從 `requirements.txt` 移除 `python-docx` 和 `lxml`（程式碼使用 Pandoc 轉換 DOCX，並非 python-docx）。

### 後端變更

- **可配置的資料庫路徑**（`backend/db.py`）：資料庫路徑現可透過 `CHECKLISTER_DB_PATH` 環境變數設定，預設仍為 `backend/twnamelist.db`。
- **搜尋 API**（`backend/api/search_api.py`）：新增 `name` 欄位（不含命名者的學名）至搜尋回應。先前僅回傳 `fullname`（含命名者）。
- **匯出類群排序**（`backend/api/export.py`）：名錄匯出的高階類群排序改從 `dao_plant_type` 資料庫表讀取，不再寫死於程式碼中。新增至資料庫的分類群將自動反映在匯出結果。
- **Pandoc 錯誤處理**（`backend/api/export.py`）：Pandoc subprocess 呼叫新增 `capture_output`、回傳碼檢查及 30 秒 timeout。先前 Pandoc 失敗時不會回報任何錯誤。
- **靜態檔案服務**（`backend/main.py`）：FastAPI 現在直接 serve 前端 build 產物作為靜態檔案，並提供 catch-all route 支援 SPA 客戶端路由。前端目錄可透過 `CHECKLISTER_FRONTEND_DIR` 設定。
- **設定腳本**（`backend/setup.sh`）：修正 shebang（`sh` → `bash`）、加入 `set -e`、改從 `requirements.txt` 安裝而非手動列出套件。

### 前端變更

- **靜態 adapter**（`frontend/svelte.config.js`）：從 `adapter-auto` 改為 `adapter-static`，以正確產出靜態網站。
- **佈局設定**（`frontend/src/routes/+layout.ts`）：新增 `prerender = true` 和 `ssr = false` 以配合靜態 build。
- **可排序表格**（`frontend/src/lib/SpeciesTable.svelte`）：所有表格欄位（ID、科名、俗名、學名、來源、特有）皆可點擊排序。俗名依中文筆畫排序（使用 `Intl.Collator('zh-Hant', { collation: 'stroke' })`）。科名依拉丁名字母排序，顯示格式為「中文名 (拉丁名)」。
- **點擊列開啟詳細頁**（`frontend/src/lib/SpeciesTable.svelte`）：新增 `onRowClick` prop，點擊物種列（非勾選框）即開啟物種詳細頁面。
- **物種詳細頁**（新檔案）：
  - `SpeciesDetailView.svelte`：容器，flex 佈局配置側邊欄與詳細面板。
  - `SpeciesSidebar.svelte`：左側邊欄，依筆畫排序的物種清單及「返回名錄」按鈕。
  - `SpeciesDetailPanel.svelte`：右側面板，包含三個區塊：
    - C1：物種資訊（學名、俗名、科名、高階類群、來源/特有/IUCN 標籤）。
    - C2：同物異名（UI 已就緒，等待資料串接）。
    - C3：外部連結至 GBIF、TaiCOL 及 iNaturalist。
- **固定工具列**（`frontend/src/routes/+page.svelte`）：搜尋列、匯入按鈕、匯出控制項及物種數量標籤現在固定於頁面頂部（sticky），捲動時不會離開視野。
- **視圖切換**（`frontend/src/routes/+page.svelte`）：新增 `viewMode` 狀態（`'table'` | `'detail'`），在名錄表格與物種詳細頁之間切換。
- **資料遷移**（`frontend/src/stores/speciesStore.ts`）：從 localStorage 載入資料時，缺少 `name` 欄位的項目會自動透過 `extractName()` 補齊。此函式可從 `fullname` 欄位解析學名（包含 subsp.、var.、f. 等種下階層格式）。

### 外部 API 連結

- **GBIF**：`https://www.gbif.org/species/search?q={scientificName}`
- **TaiCOL API**：`https://api.taicol.tw/v2/taxon?scientific_name={scientificName}`（注意：domain 為 `api.taicol.tw`，非 `taicol.tw/api`）
- **TaiCOL 網頁**：`https://taicol.tw/zh-hant/search?name={scientificName}`
- **iNaturalist**：`https://www.inaturalist.org/taxa/search?q={scientificName}`

所有 URL 使用 `name` 欄位（不含命名者），以 `encodeURIComponent()` 編碼。

### 打包

- **Makefile**：新增 `Makefile`，提供目標：`make`、`make run`、`make dev`、`make pkg`、`make pkg-dmg`、`make pkg-win`、`make clean`。
- **PyInstaller 改進**（`run.py`、`checklister.spec`）：
  - `run.py` 使用 `sys._MEIPASS` 在 PyInstaller 環境中定位打包資源。
  - `wait_for_server()` 以 socket 輪詢 server 就緒後才開啟瀏覽器，修復「localhost refused to connect」的 race condition。
  - 環境變數（`CHECKLISTER_DB_PATH`、`CHECKLISTER_FRONTEND_DIR`）在 import app 模組之前設定。
  - 前端 build 產物現已包含於 PyInstaller bundle 中。
  - Pandoc binary 已打包於 app 內（透過 `which pandoc` 自動偵測），使用者無需額外安裝 Pandoc。
  - 排除不必要的套件（PIL、numpy、IPython、jedi、pygments、zmq 等）以縮小 bundle 體積。
  - 預設 port 改為 8964。
- **DMG 打包**：`make pkg-dmg` 建立 macOS DMG，內含 `.app` bundle 和 Applications 捷徑，支援拖拉安裝。
- **Windows spec**（`checklister_win32.spec`）：新增 Windows 單檔執行檔打包設定。
