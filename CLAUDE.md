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
make clean               # 清除 build/dist 產物
```

## Architecture

### Backend (`backend/`)

FastAPI app，在 `main.py` 註冊 routers 並 serve 前端靜態檔。含 CORS、rate limiting（slowapi）、logging。

**API Routers：**
- `api/search_api.py` — `GET /api/search?q=&group=&rank_filter=&endemic=&alien_type=&family_filter=&order_filter=&class_filter=&genus_filter=`
  - 搜尋 TaiCOL 名錄，支援分類群篩選、階層篩選、進階篩選
  - 台/臺自動互換、accepted-only（non-accepted 自動解析到接受名）
  - 同俗名區分（替代俗名括號）、nominal infraspecific 去重
  - Fuzzy search（Levenshtein distance，62k 俗名快取）
  - `GET /api/search/rank` — 篩選面板專用，依指定 rank 搜尋
- `api/resolve_name.py` — `GET|POST /api/resolve_name` 俗名批次解析
- `api/export.py` — `POST /api/export?format=markdown|docx|yaml|csv&levels=`
  - 多分類群自動偵測、預設階層（植物: pt_name→科; 鳥/昆蟲: 目→科; 真菌: 門→綱→科）
  - 維管束植物嚴格使用：石松類→蕨類→裸子→單子葉→真雙子葉姊妹群→真雙子葉
  - Magnoliopsida 用 order 區分單子葉/真雙子葉（MONOCOT_ORDERS / SISTER_EUDICOT_ORDERS）
  - 匯出 header 自動帶入計畫名稱、樣區名稱、WKT
- `api/synonyms_api.py` — `GET /api/synonyms?taxon_id=` 同物異名查詢
- `api/admin_api.py` — `POST /api/admin/import-taicol` TaiCOL CSV 上傳匯入（含 SQL injection 檢查）
- `api/taxonomy_api.py` — `GET /api/taxonomy/children` 分類樹子節點; `GET /api/taxonomy/search` 分類樹搜尋
- `api/formatter.py` — 學名 Markdown 格式化（屬名種名斜體、rank 縮寫正體）
- `utils/mapper.py` — 內部欄位名 ↔ Darwin Core 對應（含 kingdom/phylum/class/order/genus/taxon_id）
- `utils/backup.py` — 資料庫備份工具
- `services/taicol_import.py` — TaiCOL CSV 匯入服務（批次 INSERT + 索引 + fuzzy 快取清空）
- `db.py` — SQLModel engine，DB 路徑透過 `CHECKLISTER_DB_PATH` 環境變數配置
- `models/schema.py` — ORM models：PlantType、PlantName、TaicolName

### Frontend (`frontend/`)

SvelteKit + adapter-static + Tailwind CSS + Flowbite：

**頁面與佈局：**
- `src/routes/+layout.svelte` — 共用 Navbar（Home, Taxonomy, Map, Compare, Docs, Admin），active 狀態標記
- `src/routes/+page.svelte` — 主頁面，Zone A（sticky 搜尋/匯出工具列）+ 條件渲染 table/detail view
- `src/routes/taxonomy/+page.svelte` — 分類樹瀏覽器（可開合階層 + 搜尋 + 快捷按鈕）
- `src/routes/map/+page.svelte` — 樣區地圖編輯器（Leaflet + 繪製/匯入/匯出 GPX/KML/WKT/GeoJSON）
- `src/routes/compare/+page.svelte` — 名錄比較（2-10 份名錄：共同種/獨有種/多樣性指數/相似度矩陣）
- `src/routes/admin/+page.svelte` — TaiCOL 名錄 CSV 上傳管理

**名錄表格（table view）：**
- `src/lib/SearchBox.svelte` — 搜尋 + 統一篩選面板（高階分類群 icon + 限定特定分類群 + 特有性/原生外來）
- `src/lib/SpeciesTable.svelte` — 可排序表格 + abundance 欄位（inline 編輯）+ 鍵盤快捷鍵（Delete 刪除已勾選）
- `src/lib/ExportSettings.svelte` — 匯出階層微調 modal
- `src/lib/MapPreview.svelte` — 地圖 pop-up 預覽（lazy load）
- `src/lib/LoadYAMLButton.svelte` — 批次匯入 modal（貼上名稱/上傳檔案 → 三階段處理：精確匹配/多筆確認/未收錄）
- `src/lib/compareUtils.ts` — 名錄比較邏輯（Sørensen/Jaccard/Shannon/Simpson/Evenness）

**物種詳細頁（detail view）：**
- `src/lib/SpeciesDetailView.svelte` — B + C 容器（桌面: 固定 sidebar; 手機: drawer）
- `src/lib/SpeciesSidebar.svelte` — 物種清單（筆畫排序 + 篩選框 + Delete 快捷鍵）
- `src/lib/SpeciesDetailPanel.svelte` — 物種資訊 + 同物異名（auto-fetch）+ 外部連結

**分類樹：**
- `src/lib/TaxonTreeNode.svelte` — 遞迴樹節點（lazy load + expandPath 自動展開 + collapseAll）

**地圖：**
- `src/lib/MapEditor.svelte` — Leaflet 編輯器（Marker/Polyline/Polygon + GPX/KML/WKT/GeoJSON 匯入匯出 + metadataStore 連動）

**工具與資料：**
- `src/lib/formatter.ts` — 前端學名格式化（HTML italic + XSS escape）
- `src/lib/dwcMapper.ts` — Darwin Core 欄位雙向對應
- `src/stores/speciesStore.ts` — 已選物種（persisted to localStorage + name fallback）
- `src/stores/metadataStore.ts` — 計畫/樣區 metadata + 幾何資料（GeoJSON/WKT，persisted to localStorage）
- `src/stores/importState.ts` — 未解析/模糊名稱狀態

### Data Flow

搜尋：SearchBox → `/api/search`（含 group/rank/advanced filters）→ speciesStore → SpeciesTable

匯入：LoadYAMLButton → importer.ts → `/api/resolve_name` 批次 → merge into store（含 WKT/metadata 讀取）

匯出：SpeciesTable → `/api/export`（含 metadata: project/site/footprintWKT）→ ZIP/YAML/CSV

地圖：MapEditor → metadataStore（geometries/footprintWKT）→ YAML 匯出自動帶入

比較：上傳 YAML / 當前名錄 → parseChecklistYAML（支援 checklister-ng 包裹層）→ compareUtils 計算指數/矩陣

批次匯入：LoadYAMLButton modal → 逐一 /api/search → 精確匹配自動加入 / 多筆給使用者選 / 未收錄可放入或忽略

### External API Links

物種詳細頁連結外部服務：
- **所有類群**: GBIF, TaiCOL（俗名搜尋）, iNaturalist, Wikispecies, NCBI Taxonomy
- **植物專用**: IPNI, POWO, 台灣植物資訊整合查詢系統（tai2.ntu.edu.tw）

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
- `taicol_names` — TaiCOL 全物種名錄（242k 筆，含 kingdom→genus 完整階層 + 俗名/替代俗名 + usage_status）

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

## Key Dependencies

- **Backend**: FastAPI, SQLModel, Uvicorn, PyYAML, Pandoc, rapidfuzz, slowapi, python-multipart
- **Frontend**: SvelteKit 2, Svelte 5, Vite 6, Tailwind CSS 3, Flowbite Svelte, Leaflet, leaflet-draw, js-yaml, @tmcw/togeojson, togpx, tokml, terraformer, fastest-levenshtein
- **Packaging**: PyInstaller

## Planned

- **i18n**: 正體中文 / English / Japanese 語言切換
- **MCP Server**: 抽出 core 層，FastAPI + MCP 共用邏輯
- **檢索表**: PDF OCR 解析二分法檢索表，掛到分類樹節點
- **Superfamily/Subfamily**: TaiCOL 種下中間階層匯出支援
