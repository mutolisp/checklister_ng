# 更新紀錄

## 2026-04-06：TaiCOL 資料整合與多分類群搜尋

### TaiCOL 資料庫整合

- 匯入 TaiCOL 物種名錄 CSV（242,285 筆，涵蓋臺灣所有生物類群）至新的 `taicol_names` SQLite 資料表。
- 對搜尋常用欄位建立索引：`common_name_c`、`alternative_name_c`、`simple_name`、`family`、`family_c`、`taxon_id`、`usage_status`、`(kingdom, phylum)`、`class`。
- 多值 `taxon_id`（433 筆含逗號分隔 ID）取第一個為主要值，原始值保留於 `taxon_id_all`。
- CSV 中重複的 `name_id` 自動跳過。
- 每次匯入前自動備份資料庫。

### 搜尋 API 改寫

- **`GET /api/search?q=&group=`**：改查 `taicol_names` 表，LIKE 搜尋 5 個欄位（`common_name_c`、`alternative_name_c`、`simple_name`、`family`、`family_c`），並保留舊 `dao_pnamelist_pg` 表作為 fallback。
- **替代俗名搜尋**：輸入任何俗名（主要或替代）皆可找到物種。例如「過山龍」、「台灣鹹蝦花」、「臺灣鹹蝦花」都找到 *Vernonia gratiosa*。
- **台/臺自動互換**：搜尋時自動產生台↔臺的查詢變體。
- **接受名優先排序**：`usage_status = 'accepted'` 的結果排在異名和誤用名之前。
- **`is_in_taiwan` 篩選**：只回傳存在於臺灣的物種。
- **分類群篩選器**：新增 `group` 查詢參數（見前端章節）。
- 回應新增 `taxon_id` 和 `usage_status` 欄位。

### 同物異名 API

- **`GET /api/synonyms?taxon_id={id}`**（`backend/api/synonyms_api.py`）：回傳同一 `taxon_id` 的所有學名，含狀態標記（`accepted`、`not-accepted`、`misapplied`）、命名者及俗名。

### 管理匯入 API

- **`POST /api/admin/import-taicol`**（`backend/api/admin_api.py`）：接受 TaiCOL CSV 檔案上傳（multipart），備份資料庫後清空重建 `taicol_names`，以每 5,000 筆為單位批次匯入，完成後重建索引。回傳匯入統計（筆數、耗時）。
- 需要 `python-multipart` 套件（已新增至 `requirements.txt`）。

### 前端：分類群篩選器

- `SearchBox.svelte` 新增下拉篩選器，包含 13 個分類群與「所有類群」：
  - 維管束植物、植物界、鳥綱、真菌界、哺乳類、爬行類、昆蟲綱、蛛形綱、軟體動物、輻鰭魚類、兩棲類、原生生物、所有動物。
- 搜尋結果中非接受名顯示 `usage_status` 標籤。

### 前端：同物異名顯示

- `SpeciesDetailPanel.svelte` C2 區塊現在會自動從 `/api/synonyms?taxon_id=` 載入同物異名資料。
- 以科學名、命名者、俗名和色彩標籤（綠=接受名、紅=誤用名、深灰=異名）顯示。

### 前端：管理頁面

- 新增 `/admin` 路由（`frontend/src/routes/admin/+page.svelte`）：提供 TaiCOL CSV 檔案上傳介面。
- 顯示上傳進度、匯入統計（筆數、耗時）及錯誤訊息。
- 導覽列新增 Admin 連結。

### Makefile

- 新增 `make taicol` target：自動找到最新的 `references/TaiCOL_name_*.csv`，備份資料庫並匯入。支援自訂路徑：`make taicol CSV=path/to/file.csv`。

### 新建檔案

| 檔案 | 用途 |
|------|------|
| `backend/models/schema.py`（修改） | 新增 `TaicolName` model 對應 `taicol_names` 表 |
| `backend/services/taicol_import.py` | CSV 匯入服務（批次插入 + 索引建立） |
| `backend/services/__init__.py` | 套件初始化 |
| `backend/utils/backup.py` | 資料庫備份工具 |
| `backend/api/admin_api.py` | TaiCOL CSV 上傳端點 |
| `backend/api/synonyms_api.py` | 同物異名查詢端點 |
| `frontend/src/routes/admin/+page.svelte` | 管理上傳頁面 |

### 修改檔案

| 檔案 | 修改內容 |
|------|---------|
| `backend/api/search_api.py` | 全面改寫：TaiCOL 搜尋、分類群篩選、台/臺互換 |
| `backend/main.py` | 註冊 synonyms_api 和 admin_api router |
| `frontend/src/lib/SearchBox.svelte` | 分類群下拉選單、usage_status 標籤 |
| `frontend/src/lib/SpeciesDetailPanel.svelte` | 自動從 API 載入同物異名 |
| `Makefile` | 新增 `taicol` target |
| `requirements.txt` | 新增 `python-multipart` |

---

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
