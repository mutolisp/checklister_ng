# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Checklister-NG（次世代名錄產生器）是臺灣物種名錄產生工具，支援所有生物類群（維管束植物、鳥類、昆蟲、真菌等）。整合 TaiCOL 臺灣物種名錄（242k 筆），支援俗名/學名搜尋（含模糊比對）、同物異名、多分類群匯出、分類樹瀏覽、樣區地圖繪製等功能。

## Build & Development

### Backend
```bash
cd backend && ./setup.sh                    # 建立 venv + 安裝 requirements.txt
uvicorn backend.main:app --reload           # 開發模式（hot reload）
python run.py --port 8964                   # 啟動 server + 自動開瀏覽器
```

### Frontend
```bash
cd frontend
npm install
npm run dev              # 開發 server（透過 vite proxy 連 backend）
npm run build            # 產出靜態檔到 frontend/build/
npm run check            # svelte-check 型別檢查
```

### Makefile
```bash
make                     # build backend venv + frontend
make run                 # 啟動 server (port 8964)
make dev                 # 同時啟動 backend hot-reload + frontend dev server
make taicol              # 匯入 TaiCOL CSV（自動找 references/TaiCOL_name_*.csv）
make pkg                 # 自動偵測平台打包（macOS → DMG, Windows → EXE）
make pkg-dmg             # 打包 macOS DMG
make pkg-win             # 打包 Windows EXE（需在 Windows 執行）
make icon                # 從 icons/checklister-ng_icons.png 產生 .ico/.icns/tray PNG
make clean               # 清除 build/dist 產物
```

## Architecture

### Backend (`backend/`)

FastAPI app，在 `main.py` 註冊 routers 並 serve 前端靜態檔。含 CORS、rate limiting（slowapi）、logging。前端靜態檔透過 `StaticFiles` mount 處理，SPA fallback 透過 404 exception handler 實現（不使用 catch-all route 或 BaseHTTPMiddleware，避免攔截 `/docs`、`/openapi.json` 等 FastAPI 內建路由）。

**API Routers：**
- `api/search_api.py` — `GET /api/search?q=&group=&rank_filter=&endemic=&alien_type=&family_filter=&order_filter=&class_filter=&genus_filter=`
  - 搜尋 TaiCOL 名錄，支援分類群篩選、階層篩選、進階篩選
  - 台/臺自動互換、accepted-only（non-accepted 自動解析到接受名）
  - 同俗名區分（替代俗名括號）、nominal infraspecific 去重
  - Fuzzy search（Levenshtein distance，62k 俗名快取）
  - 排序優先級：common_name_c 精確 → 學名精確 → common_name_c 包含 → alternative_name_c 精確 → alternative_name_c 包含 → 前綴 → 長度（用 `_raw_cname` 排序，非 display cname）
  - 回傳欄位含：`taxon_id`, `redlist`, `iucn_category`, `cites`, `protected`, `is_hybrid`, `order_c`, `nomenclature_name`, 棲地旗標等
  - `GET /api/search/rank` — 篩選面板專用，依指定 rank 搜尋
- `api/resolve_name.py` — `GET|POST /api/resolve_name` 俗名批次解析
- `api/export.py` — `POST /api/export?format=markdown|docx|yaml|csv&levels=&conservation_fields=`
  - 多分類群自動偵測、預設階層（植物: pt_name→科; 鳥/昆蟲: 目→科; 真菌: 門→綱→科）
  - 維管束植物嚴格使用：石松類→蕨類→裸子→單子葉→真雙子葉姊妹群→真雙子葉
  - Magnoliopsida 用 order 區分單子葉/真雙子葉（MONOCOT_ORDERS / SISTER_EUDICOT_ORDERS）
  - `conservation_fields` 參數控制匯出哪些保育狀態（`redlist`, `iucn_category`, `cites`, `protected`），預設只顯示 `redlist`
  - 匯出 header 自動帶入計畫名稱、樣區名稱、WKT + 物種屬性統計 + 保育統計（排除 LC/NLC 等安全等級）
  - 物種格式：學名 俗名 特有性/來源 保育狀態（分號分隔），動物 cultured 用 `‡`（圈養）、植物用 `†`（栽培）
  - `_enrich_checklist()` 匯出前從 DB 補齊舊資料的 `*_c` common name 欄位
  - CSV 格式用 DwC terms（UTF-8 BOM）
- `api/search_api.py` — `_map_alien_type()` 動物 cultured → 圈養、植物 → 栽培
- `api/synonyms_api.py` — `GET /api/synonyms?taxon_id=` 同物異名查詢
- `api/admin_api.py` — `POST /api/admin/import-taicol` TaiCOL CSV 上傳匯入（name_file 必要 + taxon_file 選填，含 SQL injection 檢查）
- `api/taxonomy_api.py` — `GET /api/taxonomy/children` 分類樹子節點（含病毒 Realm 階層：`rank=realm` / `rank=virus_kingdom`，autonym 偵測，infraspecific 統計）; `GET /api/taxonomy/search` 分類樹搜尋（病毒路徑含 Viruses→Realm 前綴）
- `api/formatter.py` — 學名 Markdown 格式化（屬名種名斜體、rank 縮寫正體）
- `utils/mapper.py` — 內部欄位名 ↔ Darwin Core 對應（36 欄，含 `*_c` → `*VernacularName`、`cites→CITES`、`protected→protectionStatus`、`is_hybrid→isHybrid` 等）
- `utils/backup.py` — 資料庫備份工具
- `services/taicol_import.py` — TaiCOL 匯入服務：name CSV（主資料，`_import_name_csv`）+ taxon CSV（補齊 21 欄，`_backfill_from_taxon_csv`，taxon_id 為 foreign key）+ 索引建立 + fuzzy 快取清空。CLI: `python -m backend.services.taicol_import <name.csv> [taxon.csv]`
- `db.py` — SQLModel engine，DB 路徑透過 `CHECKLISTER_DB_PATH` 環境變數配置
- `models/schema.py` — ORM models：PlantType、PlantName、TaicolName

### Frontend (`frontend/`)

SvelteKit + adapter-static + Tailwind CSS + Flowbite：

**頁面與佈局：**
- `src/routes/+layout.svelte` — 共用 Navbar（Home, Taxonomy, Map, Compare, Docs, Admin），active 狀態標記
- `src/routes/+page.svelte` — 主頁面，Zone A（sticky 搜尋/匯出工具列）+ 條件渲染 table/detail view
- `src/routes/taxonomy/+page.svelte` — 分類樹瀏覽器（可開合階層 + 搜尋 + 快捷按鈕）
- `src/routes/map/+page.svelte` — 樣區地圖編輯器（滿版 + 右側 tabbed panel：細節/底圖/匯入/匯出）
- `src/routes/compare/+page.svelte` — 名錄比較（2-10 份名錄：共同種/獨有種/多樣性指數/相似度矩陣）
- `src/routes/admin/+page.svelte` — TaiCOL 名錄 CSV 上傳管理（name + taxon 雙檔上傳）
- `src/lib/AdminNameEditor.svelte` — 名錄編輯器：CITES 下拉選單（I/II/III/I\|II/NC）、alien_status_note 條列管理（type+citation 新增/刪除/type 驗證）、俗名/別名拖拉互換+排序、所有 Select 用 placeholder 取代空值選項
- `src/lib/AdminAddModal.svelte` — 新增分類群：step 2 階層依 rank 過濾（`RANK_TO_LEVEL` 映射，新增科不顯示屬）
- `src/routes/documentation/+page.svelte` — API 文件（iframe 嵌入 FastAPI Swagger UI `/docs`）

**名錄表格（table view）：**
- `src/lib/SearchBox.svelte` — 搜尋 + 統一篩選面板（高階分類群 icon + 限定特定分類群 + 特有性/原生外來）
- `src/lib/SpeciesTable.svelte` — 可排序表格（TaxonID/階層/科名/俗名/學名/來源/特有/臺灣紅皮書/IUCN/CITES/保育類/數量）+ 使用者可自訂顯示欄位（localStorage 持久化）+ 三層篩選（高階分類群→科別→階層 rank）+ abundance inline 編輯 + 鍵盤快捷鍵（Delete 刪除已勾選）+ 使用 `taxon_id` 做為唯一識別
- `src/lib/ProjectEditModal.svelte` — 新建/編輯專案 metadata popup（計畫名稱/摘要/位置說明/樣區名稱/備註）
- `src/stores/projectStore.ts` — 多專案管理（createProject/saveProject/loadProject/newProject/deleteProject，DB ↔ localStorage sync）
- `src/stores/profileStore.ts` — 偏好設定（setPreference/getPreference，localStorage + DB 雙寫）
- `src/lib/ExportSettings.svelte` — 匯出設定 modal（分類階層 + 保育狀態勾選：臺灣紅皮書/IUCN/CITES/保育類）
- `src/lib/MapPreview.svelte` — 地圖 pop-up 預覽（lazy load）
- `src/lib/LoadYAMLButton.svelte` — 批次匯入 modal（貼上名稱/上傳檔案 → 三階段處理：精確匹配/多筆確認/未收錄）
- `src/lib/AmbiguousSelector.svelte` — 多筆俗名比對選擇器
- `src/lib/MigrationSelector.svelte` — 舊版 YAML 遷移選擇器（舊 id → taxon_id）
- `src/lib/compareUtils.ts` — 名錄比較邏輯（Sørensen/Jaccard/Shannon/Simpson/Evenness）

**物種詳細頁（detail view）：**
- `src/lib/SpeciesDetailView.svelte` — B + C 容器（桌面: 固定 sidebar; 手機: drawer）
- `src/lib/SpeciesSidebar.svelte` — 物種清單（筆畫排序 + 篩選框 + Delete 快捷鍵）
- `src/lib/SpeciesDetailPanel.svelte` — 物種資訊 + 同物異名（auto-fetch）+ 外部連結
  - 物種狀態：原生/歸化/栽培 + 臺灣特有 + 雜交種(is_hybrid) + 棲地標籤
  - 保育狀態：臺灣紅皮書(redlist) + IUCN(iucn_category) + CITES(cites) + 保育類/珍稀植物(protected)
  - 外部連結：所有類群共用(GBIF/TaiCOL/iNat/Wikispecies/NCBI) + 植物專用(IPNI/POWO/台灣植物資訊整合查詢)
  - `isPlant` 判斷僅用 `kingdom === 'Plantae'`

**分類樹：**
- `src/lib/TaxonTreeNode.svelte` — 遞迴樹節點（lazy load + expandPath 自動展開 + scrollTarget 自動捲動 + collapseAll + 展開狀態持久化）。物種列表支援：click 開 popup、hover 快速加入名錄、已加入標記。Autonym 半透明顯示。病毒 realm 階層特殊處理
- `src/lib/TaxonSpeciesPopup.svelte` — 物種詳細 popup（fetch search API + synonyms API，含保育狀態/物種狀態/同物異名/加入名錄按鈕）
- `src/lib/KeyPopup.svelte` — 檢索表 popup（fetch `/api/key/{genus}`，623 屬可用，資料來源：臺灣維管束植物簡誌）
- `src/stores/taxonomyStore.ts` — 分類樹展開狀態（`expandedNodes: Set<string>`，persisted to localStorage `taxonomy_expanded`）
- `src/stores/keyStore.ts` — 檢索表可用屬名集合（`availableKeys: Set<string>`，每次進入 taxonomy 頁面重新 fetch，新增檔案即時偵測）

**地圖：**
- `src/lib/MapEditor.svelte` — Leaflet 編輯器（Marker/Polyline/Polygon + GPX/KML/WKT/GeoJSON 匯入匯出 + metadataStore 連動 + 多底圖切換 + 中研院 WMTS 疊圖 + view state localStorage 持久化）
- `src/lib/sinicaLayers.ts` — 中研院 WMTS 85 圖層清單（pre-built 靜態資料）
- `src/lib/BatchAddModal.svelte` — 批次加入名錄 modal（species_count 預覽 + 篩選 + 進度條 + 超量警告）

**工具與資料：**
- `src/lib/formatter.ts` — 前端學名格式化（HTML italic + XSS escape）
- `src/lib/dwcMapper.ts` — Darwin Core 欄位雙向對應（`taxon_id` ↔ `taxonID`，舊版 `id` 自動偵測遷移）
- `src/lib/importer.ts` — YAML/文字匯入（含舊版 YAML 遷移：`migrateLegacyItems` 用學名查 API 比對）
- `src/stores/speciesStore.ts` — 已選物種（persisted to localStorage，使用 `taxon_id` 辨識）
- `src/stores/metadataStore.ts` — 計畫/樣區 metadata + 幾何資料（GeoJSON/WKT，persisted to localStorage）
- `src/stores/importState.ts` — 未解析/模糊名稱狀態 + 舊版遷移狀態（`migrationStore`）

### Data Flow

搜尋：SearchBox → `/api/search`（含 group/rank/advanced filters）→ speciesStore → SpeciesTable

匯入：LoadYAMLButton → importer.ts → `/api/resolve_name` 批次 → merge into store（含 WKT/metadata 讀取）

舊版 YAML 匯入：importer.ts → `convertFromDarwinCore`（偵測數字 taxonID → `_legacy_id`）→ `migrateLegacyItems`（用學名查 API）→ 精確匹配自動遷移 / 多筆跳 MigrationSelector popup

匯出：SpeciesTable → `/api/export`（含 metadata: project/site/footprintWKT + conservation_fields）→ ZIP/YAML/CSV

地圖：MapEditor → metadataStore（geometries/footprintWKT/projectAbstract/locationDescription/siteNotes）→ YAML 匯出自動帶入。View state（center/zoom/basemap/overlay）→ localStorage `map_view` 持久化

比較：上傳 YAML / 當前名錄 → parseChecklistYAML（支援 checklister-ng 包裹層）→ compareUtils 計算指數/矩陣

批次匯入：LoadYAMLButton modal → 逐一 /api/search → 精確匹配自動加入 / 多筆給使用者選 / 未收錄可放入或忽略

分類樹加入名錄：TaxonTreeNode species row → click 開 TaxonSpeciesPopup（fetch `/api/search` + `/api/synonyms`）→ 「加入名錄」寫入 speciesStore。或 hover → quickAdd 直接加入

分類樹狀態：taxonomyStore（localStorage `taxonomy_expanded`）↔ TaxonTreeNode onMount 自動恢復展開

### External API Links

物種詳細頁連結外部服務：
- **所有類群**: GBIF, TaiCOL（`taicol.tw/zh-hant/taxon/{taxon_id}` 直連，無 taxon_id 時 fallback 俗名搜尋）, iNaturalist, Wikispecies, NCBI Taxonomy
- **植物專用**（`kingdom === 'Plantae'`）: IPNI, POWO, 台灣植物資訊整合查詢系統（tai2.ntu.edu.tw）

### Vascular Plant Export Rules

維管束植物匯出嚴格使用 6 個類群，透過 order 判斷 Magnoliopsida 的歸屬：
1. 石松類植物 Lycophytes（Lycopodiopsida）
2. 蕨類植物 Monilophytes（Polypodiopsida）
3. 裸子植物 Gymnosperms（Cycadopsida, Ginkgoopsida, Pinopsida）
4. 單子葉植物 Monocots（MONOCOT_ORDERS: Acorales, Alismatales, Arecales, Asparagales, Commelinales, Dioscoreales, Liliales, Pandanales, Petrosaviales, Poales, Zingiberales）
5. 真雙子葉植物姊妹群（SISTER_EUDICOT_ORDERS: Ceratophyllales）
6. 真雙子葉植物 Eudicots（其餘 Magnoliopsida orders）

### Database

SQLite（`backend/twnamelist.db`）：
- `dao_plant_type` — 高階類群排序（plant_type 0-6）
- `dao_pnamelist_pg` — 舊版維管束植物名錄（6,270 筆）
- `taicol_names` — TaiCOL 全物種名錄（242k 筆）
  - 完整階層：kingdom(kingdom_c) → phylum(phylum_c) → class(class_c) → order(order_c) → family(family_c) → genus(genus_c)
  - 俗名/替代俗名 + usage_status
  - 保育欄位：`redlist`（臺灣紅皮書）、`iucn`（IUCN 全球）、`cites`（CITES 附錄）、`protected`（保育類等級 I/II/III 或文資法 1）
  - 物種屬性：`is_hybrid`（雜交種）、`is_endemic`、`alien_type`、`nomenclature_name`（命名法規）
  - 棲地旗標：`is_terrestrial`, `is_freshwater`, `is_brackish`, `is_marine`, `is_fossil`
  - 匯入時自動從 taxon CSV 補齊缺少欄位（`_backfill_from_taxon_csv`：common names、分類階層 common names、保育狀態等 21 欄，以 taxon_id 為 foreign key）
  - `is_in_taiwan` 可能是多值（`true,true`），查詢用 `LIKE '%true%'` 而非 `== 'true'`

### Environment Variables

| 變數 | 用途 | 預設值 |
|------|------|--------|
| `CHECKLISTER_DB_PATH` | SQLite 資料庫路徑 | `backend/twnamelist.db` |
| `CHECKLISTER_FRONTEND_DIR` | 前端 build 產物目錄 | `frontend/build` |
| `VITE_API_BASE_URL` | 前端開發時的 API base URL | `/api` |

### Security

- CORS middleware（localhost:5173/8964）
- Rate limiting（slowapi, 60 req/min）
- LIKE injection escape（`_escape_like()`）
- XSS prevention（`escapeHtml()` in formatter.ts）
- CSV upload SQL injection check
- Query length limits（q: 512, taxon_id: 20）
- Export temp file cleanup（BackgroundTasks）

### Packaging (PyInstaller)

- **macOS** (`checklister.spec`): `which pandoc` → `os.path.realpath()` 解析 symlink，包進 `.app` bundle。
- **Windows** (`checklister_win32.spec`): `_find_real_pandoc()` 依序搜尋 Chocolatey 實際安裝路徑、`%LOCALAPPDATA%\Pandoc\`（winget 預設）、`C:\Program Files\Pandoc\`，以檔案大小（>1MB）過濾 Chocolatey shim。CI 用 Chocolatey，本機開發用 winget。
- **Runtime PATH** (`run.py`): 偵測 `sys._MEIPASS` 內的 `pandoc`/`pandoc.exe`，自動加入 `PATH`。
- **Windows subprocess** (`export.py`): `console=False` 模式下 pandoc subprocess 需加 `STARTUPINFO(SW_HIDE)`。
- **System Tray** (`run.py`): PyInstaller 打包時自動啟用 pystray tray icon（右鍵: 開啟/結束）。開發模式不啟用。`--no-tray` 可停用。
- **Icon** (`icons/gen_icons.py`): 從 `checklister-ng_icons.png` 產生 `.ico`/`.icns` + 從 `checklister-ng_trayicon.png` 產生 tray PNG。`make icon` 執行。
- **CI/CD** (`.github/workflows/build.yml`): macOS ARM + Windows。macOS Intel 已停用（macos-13 runner 淘汰，保留為註解）。

## Development Rules

- 改動現有程式碼（特別是 routing、middleware、共用邏輯等有 side effect 的部分）後，**必須驗證相關功能仍正常運作**，不能只測新功能。
- 驗證方式：跑測試、用 httpx 打 endpoint、或手動確認受影響的路由。
- 改完才發現壞了等於沒改。Measure twice, cut once。
- 使用者提出需求時，若 scope 不清楚（影響範圍、邊界條件、實作方式、向下相容），**先引導釐清再動手**。
- 前端資料欄位一律用 **snake_case**（匹配 API 回傳），DwC camelCase 只在匯出時透過 `dwcMapper` 轉換。

## Key Dependencies

- **Backend**: FastAPI, SQLModel, Uvicorn, PyYAML, Pandoc, rapidfuzz, slowapi, python-multipart
- **Frontend**: SvelteKit 2, Svelte 5, Vite 6, Tailwind CSS 3, Flowbite Svelte, Leaflet, leaflet-draw, js-yaml, @tmcw/togeojson, togpx, tokml, terraformer, fastest-levenshtein
- **Packaging**: PyInstaller, pystray, Pillow

## Done (from Planned)

- ~~**分類樹批次加入名錄**~~: `BatchAddModal` + `GET /api/taxonomy/species_under` + `species_count`，含篩選（來源/特有/紅皮書/CITES/保育類）、500 筆警告、5000 筆上限、loading 進度
- ~~**進階篩選批次加入**~~: SearchBox 「限定特定分類群」設定後顯示「+批次加入」按鈕，復用 BatchAddModal

## Done (from Planned)

- ~~**SQLite VACUUM**~~: 匯入後自動 VACUUM
- ~~**地圖改版**~~: 滿版 + 多底圖 + 中研院 WMTS 疊圖 + view state 持久化
- ~~**批次加入名錄**~~: species_under/species_count API + BatchAddModal
- ~~**Autonym s.l./s.str.**~~: 搜尋/分類樹/匯出標記廣義/狹義
- ~~**User Profile + Checklist DB (Phase 1)**~~: 三 DB 架構（user_profile.db + checklists.db）+ profile_api CRUD + projectStore/profileStore + navbar 專案選單 + ProjectEditModal

## Planned

### Phase 2: 待實作

- **搜尋/瀏覽歷史記錄**：search_history + recent_species 表（研究中）
- **設定持久化**：匯出設定/搜尋篩選 persist（Phase 1 user_preferences 涵蓋）
- **i18n**: 正體中文 / English / Japanese
- **MCP Server**: 抽出 core 層，FastAPI + MCP 共用邏輯
- **檢索表 OCR**: PDF OCR 解析二分法檢索表
- **Superfamily/Subfamily**: TaiCOL 種下中間階層匯出
- **TaiCOL 資料更新**: app 內下載最新 TaiCOL CSV → 觸發匯入
- **程式更新提示**: GitHub Release API 版本比對 → 通知
