# 更新紀錄

## 2026-04-09：Windows DOCX 匯出修正（Pandoc 打包問題）

### Pandoc 打包修正（`checklister_win32.spec`）

- **根本原因**：GitHub Actions CI 用 `choco install pandoc`（Chocolatey）安裝。`shutil.which('pandoc')` 回傳的是 Chocolatey 的 shim（`C:\ProgramData\chocolatey\bin\pandoc.exe`，約 50KB 轉導程式），不是真正的 pandoc binary（約 80MB）。shim 被 PyInstaller 解壓後無法找到實際執行檔，導致 DOCX 匯出失敗。本機用 `winget install JohnMacFarlane.Pandoc` 安裝到 `%LOCALAPPDATA%\Pandoc\` 則無此問題。
- **修正**：新增 `_find_real_pandoc()` 函式，依序搜尋已知路徑（`chocolatey/lib/pandoc/tools/`、`%LOCALAPPDATA%\Pandoc\`、`C:\Program Files\Pandoc\`），以檔案大小（>1MB）區分真正的 binary 與 shim。同時涵蓋 CI（Chocolatey）與本機（winget）兩種情境。
- Build 時印出 pandoc 路徑與大小，方便 CI 除錯。

### Windows Subprocess 修正（`backend/api/export.py`）

- Windows `console=False` 模式下，pandoc subprocess 加上 `STARTUPINFO`（`SW_HIDE`），避免 windowed app 呼叫 console 程式時出錯。

### CI 驗證（`.github/workflows/build.yml`）

- Chocolatey 安裝後加上 `where pandoc` + `pandoc --version`，在 CI log 中驗證 pandoc 可用性。

---

## 2026-04-09：搜尋排序修正、Taxon CSV 補齊、is_in_taiwan 與 Windows 修正

### 俗名補齊（Taxon CSV Backfill）

- TaiCOL name CSV 約 30% 的 accepted 物種缺少 `common_name_c`，但 taxon CSV 有。
- `taicol_import.py` 匯入後自動從同目錄的 taxon CSV（`TaiCOL_taxon_*.csv`）補齊缺少的俗名，以 `taxon_id` 對照。
- 範例：`Sedum morrisonense`（玉山佛甲草）在 name CSV 中無俗名，taxon CSV 有。
- 匯入輸出新增 `backfilled_names` 計數。

### is_in_taiwan 多值修正

- 部分記錄的 `is_in_taiwan` 為 `true,true`（多個 taxon_id）。搜尋查詢從 `== 'true'` 改為 `LIKE '%true%'`，套用於 `search_api.py` 和 `taxonomy_api.py`。

### 搜尋排序優先級修正

- 排序改用原始 `common_name_c` 而非顯示用的 `cname`（後者可能含括號區分）。
- 新優先級：common_name_c 精確 → 學名精確 → common_name_c 包含 → alternative_name_c 精確 → alternative_name_c 包含 → 前綴 → 長度。
- 修正：搜「玉山佛甲草」現在 `Sedum morrisonense` 排第一（原本被 `Sedum cryptomerioides` 透過 alt name 搶先）。

### 分類資訊補齊擴展

- `_backfill_common_names()` 現在補齊所有缺失的分類欄位（family, family_c, kingdom, phylum, class, order, genus, genus_c, is_endemic, alien_type, iucn, redlist），使用 `COALESCE(NULLIF(...))`。
- 修正 42,349 筆缺少科名/界/門的記錄。

### RWD z-index 修正

- 搜尋建議列表：`z-10` → `z-[9999]`，避免手機版被物種詳細頁元件蓋住。
- Sticky 工具列：`z-30` → `z-[100]`。

### Windows PyInstaller 修正

- `run.py`：Windows `console=False` 時 `sys.stdout`/`sys.stderr` 為 None 會崩潰，重導向到 `os.devnull`。
- 同時檢查 `pandoc` 和 `pandoc.exe` 路徑。
- `uvicorn` log level 設為 `"warning"`。

---

## 2026-04-08：名錄比較、批次匯入改寫、搜尋排序與 YAML 修正

### 名錄比較（`/compare`）

- 新頁面，支援 2-10 份名錄並排比較。
- **輸入**：加入當前名錄 及/或 上傳多個 YAML 檔。
- **有無指數**：物種數、共同種、獨有種、Sørensen / Jaccard 相似度矩陣。
- **豐度指數**（有數量資料時）：Shannon-Wiener H'、Simpson D、Evenness J'。
- **物種矩陣**：所有物種 × 名錄，✓/✗ 顯示，可篩選共同種/獨有種/至少 N 個。
- **匯出**：CSV 報告（含矩陣 + 指數）。
- **數量欄位**：SpeciesTable 新增 inline 可編輯「數量」欄。DwC 對應：`abundance → individualCount`。

### 批次匯入改寫

- 「批次匯入」改為 modal，可貼上名稱列表（換行或逗號分隔）+ 檔案上傳。
- **三階段處理**：
  1. 精確匹配（俗名或學名完全一致）→ 自動加入
  2. 多筆匹配 → modal 內列出讓使用者選擇（可跳過、全部跳過）
  3. 查無資料 → modal 內列出，每筆可選「放入未收錄」或「忽略」（含批次按鈕）
- 全部成功時自動關閉 modal。
- 按鈕文字：「開始比對」→「開始匯入」。

### 搜尋排序修正

- 搜尋結果排序：精確匹配優先 → 前綴匹配 → 名稱長度（短的更相關）。
- 範例：搜「芒」→「芒 (Miscanthus sinensis)」排第一（原本被「三芒耳稃草」擠到後面）。

### YAML 解析修正

- `parseChecklistYAML()` 現在處理 `checklister-ng:` 包裹層（巢狀 YAML 結構）。
- 修正比較頁面無法解析匯出的 YAML 檔的問題。

### YAML 匯出：WKT 只在 YAML

- Markdown/DOCX header 不再包含原始 WKT 字串（只有計畫名稱和樣區名稱）。
- WKT 包含在 ZIP 內的 `.yml` 檔及獨立 YAML 匯出中。

---

## 2026-04-08：地圖編輯器、鍵盤快捷鍵、匯出 metadata 與植物分類修正

### 地圖編輯器（`/map`）

- 完整 Leaflet 地圖編輯器：支援 Marker/Polyline/Polygon/Rectangle 繪製。
- **匯入**：GPX、KML、WKT、GeoJSON 檔案（使用 `@tmcw/togeojson` 和 `terraformer-wkt-parser`）。
- **匯出**：下載為 WKT、GPX（`togpx`）、KML（`tokml`）、GeoJSON。
- 計畫 metadata 表單：計畫名稱 + 樣區名稱（持久化至 localStorage 的 `metadataStore`）。
- 幾何資料自動存入 `metadataStore.geometries`（GeoJSON）和 `metadataStore.footprintWKT`（WKT）。
- 地點搜尋（Nominatim geocoding）。
- 修正：Leaflet marker icon 路徑及 `draw:created` 事件字串（ESM 動態 import 相容性）。

### 地圖預覽（主頁面）

- 工具列「地圖」按鈕開啟 pop-up Modal，內嵌只讀地圖預覽（Leaflet lazy load）。
- 顯示 WKT 片段及「前往編輯」連結至 `/map`。
- 有幾何資料時按鈕轉綠色。

### YAML 幾何連動

- **匯出**：YAML 自動含 `project`、`site`、`footprintWKT` 欄位。
- **匯入**：`importer.ts` 讀取 YAML 中的 `footprintWKT`、`project`、`site` 存入 `metadataStore`。
- **Markdown/DOCX 匯出**：header 自動帶入計畫名稱（作標題）、樣區名稱、WKT。

### 鍵盤快捷鍵

- **SearchBox**：`↑`/`↓` 瀏覽建議（藍色高亮）、`Enter` 加入物種、`Esc` 關閉。
- **SpeciesTable**：`Delete`/`Backspace` 刪除已勾選物種（附確認）。輸入框中不觸發。
- **SpeciesSidebar（詳細頁）**：`Delete`/`Backspace` 刪除當前選中物種（附確認），刪除後自動切換。

### Sidebar 搜尋篩選

- 詳細頁 sidebar「返回名錄」上方新增篩選輸入框，即時過濾物種列表。

### 維管束植物分類修正

- **嚴格 6 類群排序**：石松類→蕨類→裸子→單子葉→真雙子葉姊妹群→真雙子葉。
- **Magnoliopsida 用 order 判斷**：建立 `MONOCOT_ORDERS`（11 目）和 `SISTER_EUDICOT_ORDERS`（Ceratophyllales）對照表，其餘 → 真雙子葉植物。
- 移除「被子植物 Angiosperms」fallback。
- 匯出 `_get_field_display()` 一律走 dao lookup → class 對照 → order 判斷。

### 同俗名區分修正

- 無 `alternative_name_c` 時不再顯示括號內的學名。

### 搜尋結果 Badge

- 搜尋建議列表顯示原生（綠）、歸化（黃）、栽培（藍）、臺灣特有（紫）、IUCN（灰）標籤。

### 統一進階篩選

- 合併為單一「篩選」modal：Emoji icon 分類群按鈕 + 階層搜尋（auto-complete）+ 特有性/原生外來。
- 切換分類群清空限定分類群（附確認）。
- 篩選 auto-complete 最低 1 字觸發。

---

## 2026-04-07：分類樹、進階篩選、UI 調整

### 分類樹瀏覽器

- 新增 `/taxonomy` 路由，可開合的階層瀏覽器（界→門→綱→目→科→屬→種）。
- 透過 `GET /api/taxonomy/children` lazy-load 子節點，每個節點顯示統計（X門 X綱 X目 X科 X屬 X種）。
- 不同階層用不同顏色 badge（界=紅, 門=黃, 綱=綠, 目=藍, 科=紫, 屬=灰）。
- 物種列表顯示特有/原生/歸化/入侵/栽培標籤及 IUCN 狀態。
- 分類樹內搜尋（`GET /api/taxonomy/search`）：輸入名稱 → auto-complete → 選取後自動逐層展開並高亮。
- 「全部收合」按鈕。植物界/動物界/真菌界快捷按鈕。

### 共用 Navbar

- Navbar 從 `+page.svelte` 搬到 `+layout.svelte`，所有頁面（Home, Taxonomy, Docs, Admin）共用同一導覽列，當前頁面自動標記 active。

### 統一進階篩選

- 將原本的分類群下拉和階層下拉合併為單一「篩選」按鈕，開啟統一篩選 modal。
- 篩選 modal 內容：
  - **高階分類群 icon 按鈕**：Emoji 圖示（🌿維管束植物, 🐦鳥綱, 🍄真菌界 等），選中藍色高亮。
  - **限定特定分類群**：選階層（綱/目/科/屬）→ 輸入名稱（auto-complete）→ 選取。
  - **特有性**：僅特有種 checkbox。
  - **原生/外來**：原生/歸化/入侵/栽培下拉。
- 階層搜尋使用專用 `GET /api/search/rank` API。
- 切換高階分類群時清空已選的限定分類群（附確認提示）。
- 啟用的篩選以 badge 顯示於搜尋列下方；「清除篩選」一鍵重置。

### UI 調整（SpeciesTable）

- 搜尋+科別篩選移到表格上方獨立行。
- 刪除按鈕移到表格右上角，縮小為「刪除 (n)」。
- 每頁筆數選單移到表格下方與分頁並排：「顯示 [10▼] 筆/頁，共 N 筆」。
- 每頁選項擴展為 10/20/50/100。

### 搜尋修正

- 篩選 auto-complete 最低輸入從 2 字改為 1 字（支援單個中文字如菊、蘭、松）。
- 屬層級搜尋加入 `genus_c`（屬中文名）查詢。
- 同俗名 Species + nominal infraspecific 去重。

---

## 2026-04-07：安全強化與程式碼品質

### 安全修復

- **LIKE 注入跳脫**：所有 SQL `LIKE` 查詢透過 `_escape_like()` 跳脫使用者輸入中的 `%` 和 `_` 萬用字元。套用於 `search_api.py` 和 `resolve_name.py`。
- **CORS 中介層**：新增 `CORSMiddleware`，允許 `localhost:5173` 和 `localhost:8964`。
- **速率限制**：新增 `slowapi`，預設每 IP 每分鐘 60 次請求。
- **XSS 防護**：`formatter.ts` 的 `formatScientificName()` 在建構斜體標籤前先跳脫 HTML 實體（`<`、`>`、`&`、`"`），防止資料庫被污染時的 stored XSS。
- **CSV SQL 注入檢查**：Admin CSV 上傳（`/api/admin/import-taicol`）掃描上傳內容中的可疑 SQL 語法（`DROP`、`DELETE`、`INSERT`、`UNION` 等），偵測到即拒絕。
- **查詢長度限制**：搜尋 `q` 限制 512 字元，`taxon_id` 限制 20 字元。
- **上傳大小限制**：CSV 上傳限制 200MB。

### 程式碼品質

- **日誌**：`main.py` 新增 `logging.basicConfig()`。所有 `except Exception: pass` 改為 `logger.exception()` 以正確記錄錯誤。
- **暫存檔清理**：匯出 API 使用 `BackgroundTasks` 在回應送出後刪除暫存 ZIP 檔案。

### 依賴

- 新增 `slowapi` 至 `requirements.txt`。

---

## 2026-04-07：匯出修正、RWD、外部連結與資料校正

### 匯出修正

- **植物高階層名稱**：維管束植物匯出嚴格使用中文類群名（石松類植物、蕨類植物、裸子植物、單子葉植物、真雙子葉植物姊妹群、真雙子葉植物），透過 `dao_pnamelist_pg` 查詢正確的 `pt_name`。蘇鐵/銀杏/松綱全部歸入裸子植物。
- **植物階層排序**：依 `dao_plant_type.plant_type` 順序排列（苔蘚→石松→蕨類→裸子→單子葉→姊妹群→真雙子葉）。
- **Markdown 斜體修正**：物種項目縮排從 8 空格改為 4 空格，避免 Pandoc 將 `*斜體*` 當成 code block 直接輸出星號。
- **種下名義亞種去重**：同俗名的 Species 和其 nominal infraspecific（如 `fo. pygmaeus`）只保留 Species 層級。
- **同物異名斜體修正**：移除同物異名列表的外層 `italic` class，rank 縮寫（var./subsp./fo.）現在正確顯示為正體。

### RWD：手機版物種詳細頁

- 桌面版（md 以上）：左側邊欄固定顯示。
- 手機版（md 以下）：側邊欄隱藏，詳細頁頂部顯示「物種列表」按鈕。點擊後從左側滑出 drawer（附半透明背景遮罩），選擇物種後自動關閉。

### 外部連結

- **TaiCOL**：修正為只取第一個俗名（去掉括號內的第二俗名）。
- **植物專用連結**（僅植物界顯示）：IPNI、POWO、台灣植物資訊整合查詢系統。
- **所有類群新增**：Wikispecies、NCBI Taxonomy。

### 資料校正

- `Pinus armandii var. masteriana`（name_id=133788）：`usage_status` 從 `accepted` 改為 `not-accepted`。此為 TaiCOL 原始資料的拼寫錯誤，正確接受名為 `Pinus armandii var. mastersiana`（name_id=61488）。

### 搜尋 API：pt_name 查詢

- 維管束植物的 `_build_pt_name()` 改為查詢 `dao_pnamelist_pg` 取得正確的中文 `pt_name`（如「真雙子葉植物 Eudicots」），而非回傳 `Tracheophyta > Magnoliopsida`。

---

## 2026-04-06：多分類群匯出與可配置階層

### 多分類群匯出

- **自動偵測分類群**：匯出時自動依物種的 `kingdom`、`phylum`、`class_name` 欄位偵測分類群（維管束植物、鳥綱、昆蟲綱、真菌等）。
- **各分類群預設階層**：
  - 維管束植物：類群(pt_name) → 科(family) → 物種
  - 鳥類/昆蟲/哺乳類/爬行類/兩棲類：目(order) → 科(family) → 物種
  - 真菌：門(phylum) → 綱(class) → 科(family) → 物種
  - 軟體動物：綱(class) → 目(order) → 科(family) → 物種
- **混合名錄**：名錄同時包含多個分類群的物種時，匯出自動分段，各段套用各自的預設階層。
- **Markdown 標題**：從硬編碼的「維管束植物名錄」改為動態的「物種名錄」，統計數字正確反映實際內容。

### 可配置匯出階層

- **`levels` 查詢參數**：`POST /api/export?format=markdown&levels=order,family` 可覆蓋預設階層。
- **前端「匯出設定」按鈕**：開啟 modal，提供 6 個 checkbox（界、門、綱、目、科、屬）自訂匯出階層。
- **未勾選時**：使用各分類群的預設階層。
- 注：Superfamily（總科）、Subfamily（亞科）、Tribe（族）第一版不支援（TaiCOL 中為 rank 值而非物種欄位），留待後續版本。

### 搜尋 API：完整分類階層欄位

- 搜尋結果新增：`kingdom`、`phylum`、`class_name`、`order`、`genus`、`genus_c`。
- 這些欄位會存入 species store，供匯出系統使用。

### DwC Mapper

- 新增 `kingdom`、`phylum`、`class`（對應 `class_name`）、`order`、`genus`、`taxon_id` 至 Darwin Core 欄位對應。

### 新建/修改檔案

| 檔案 | 修改內容 |
|------|---------|
| `backend/api/export.py` | 全面改寫：多分類群偵測、預設階層定義、遞迴分群渲染、`levels` 參數 |
| `backend/api/search_api.py` | 回傳完整分類階層欄位（kingdom 到 genus） |
| `backend/utils/mapper.py` | DwC mapping 新增分類階層欄位 |
| `frontend/src/lib/ExportSettings.svelte` | 新建：匯出階層勾選 modal |
| `frontend/src/routes/+page.svelte` | 整合 ExportSettings，匯出時傳遞 levels 參數 |

---

## 2026-04-06：TaiCOL 整合、模糊搜尋與搜尋體驗改進

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

### 模糊比對搜尋（Levenshtein Distance）

- 新增 `rapidfuzz` 依賴，實作打字容錯搜尋。
- **記憶體快取**：62,658 個不重複 accepted 俗名於首次搜尋時載入（~0.2 秒），常駐記憶體（~2-3MB）。Thread-safe lazy loading，TaiCOL 重新匯入後自動清空。
- **兩階段搜尋**：先做 LIKE 精確搜尋，結果不足 5 筆時啟動 fuzzy fallback，以 Levenshtein distance ≤ 1 掃描快取（62k 筆約 11ms），不足再放寬到 distance ≤ 2。
- 範例：「香南」→ 找到「香楠」（dist=1）；「舗地黍」→ 找到「舖地黍」（dist=1）。
- 含 fuzzy 的整體搜尋時間 < 130ms。

### 搜尋體驗改進

- **只顯示接受名**：搜尋下拉選單只顯示 accepted name，非接受名自動解析到對應的接受名。
- **非接受名顯示**：使用者輸入異名（如 `Lycopodium cernuum`）時，下拉顯示：`俗名 (異名學名) [not-accepted] → 接受學名`。
- **同俗名區分**：多個物種共用相同俗名時，以替代俗名加括號區分，例如「過山龍(台灣鹹蝦花)」vs「過山龍(垂穗石松)」。
- **替代俗名匹配**：透過 `alternative_name_c` 匹配時，顯示格式為：`替代俗名(主要俗名) (學名) 科名`。
- **模糊結果提示**：fuzzy 結果以橘色顯示「≈ 您是否在找？」標記。
- **物種詳細頁**：分類資訊科名上方新增「其他俗名」欄位（來自 `alternative_name_c`）。同物異名列表移除俗名，只顯示學名 + 命名者 + 狀態標籤。

### 修改檔案

| 檔案 | 修改內容 |
|------|---------|
| `backend/api/search_api.py` | 全面改寫：TaiCOL 搜尋、分類群篩選、台/臺互換、只顯示接受名並自動解析異名、同俗名區分、Levenshtein 模糊快取搜尋 |
| `backend/main.py` | 註冊 synonyms_api 和 admin_api router |
| `backend/services/taicol_import.py` | 匯入後清空 fuzzy 快取 |
| `frontend/src/lib/SearchBox.svelte` | 分類群下拉選單、非接受名顯示、模糊提示 |
| `frontend/src/lib/SpeciesDetailPanel.svelte` | 自動載入同物異名、顯示其他俗名、移除同物異名中的俗名 |
| `Makefile` | 新增 `taicol` target |
| `requirements.txt` | 新增 `python-multipart`、`rapidfuzz` |

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
