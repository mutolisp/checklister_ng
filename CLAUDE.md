# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Checklister-NG（次世代名錄產生器）是臺灣維管束植物名錄產生工具。使用者可搜尋、選取物種，匯出為 Markdown、DOCX、YAML、CSV 格式的名錄文件。名錄依高階類群（苔蘚地衣→石松→蕨類→裸子→單子葉→真雙子葉）排序，標註特有種(#)、歸化種(*)、栽培種(†)及 IUCN 保育等級。點擊物種可查看詳細資訊、同物異名及外部連結（GBIF、TaiCOL、iNaturalist）。

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
make pkg                 # 自動偵測平台打包（macOS → DMG, Windows → EXE）
make pkg-dmg             # 打包 macOS DMG
make pkg-win             # 打包 Windows EXE（需在 Windows 執行）
make clean               # 清除 build/dist 產物
```

## Architecture

### Backend (`backend/`)

FastAPI app，在 `main.py` 註冊三個 router 並 serve 前端靜態檔：

- `api/search_api.py` — `GET /api/search?q=` 全文搜尋植物名/科名（LIKE 查詢，上限 30 筆）
  - 回傳欄位：`id`, `name`（不含命名者學名）, `fullname`（含命名者）, `cname`, `family`, `family_cname`, `iucn_category`, `endemic`, `source`, `pt_name`
- `api/resolve_name.py` — `GET /api/resolve_name?q=` 單筆中文名查詢；`POST /api/resolve_name` 批次查詢（body: `{"names": [...]}`)
- `api/export.py` — `POST /api/export?format=markdown|docx|yaml|csv` 匯出名錄
  - markdown/docx 回傳 ZIP（含 .md/.docx + .yml）
  - DOCX 透過 Pandoc subprocess + `reference.docx` 樣式模板轉換（有錯誤處理和 30s timeout）
  - YAML 自動轉為 Darwin Core 欄位名稱
  - 高階類群排序從 `dao_plant_type` 資料庫表讀取（不再 hardcode）
- `api/formatter.py` — 學名 Markdown 格式化（屬名種名斜體、處理 subsp./var./f.）
- `utils/mapper.py` — 內部欄位名 ↔ Darwin Core 對應
- `db.py` — SQLModel engine，DB 路徑透過 `CHECKLISTER_DB_PATH` 環境變數配置
- `models/schema.py` — ORM models：`PlantType`（dao_plant_type）、`PlantName`（dao_pnamelist_pg）

### Frontend (`frontend/`)

SvelteKit + adapter-static + Tailwind CSS + Flowbite：

**頁面與佈局：**
- `src/routes/+page.svelte` — 主頁面，Zone A（sticky 搜尋/匯出工具列）+ 條件渲染 table/detail view
- `src/routes/+layout.ts` — prerender + ssr=false（靜態 build）

**名錄表格（table view）：**
- `src/lib/SearchBox.svelte` — 防抖搜尋輸入，呼叫 `/api/search`
- `src/lib/SpeciesTable.svelte` — 可排序物種表格（ID/科名/俗名筆畫/學名/來源/特有），點擊列開啟 detail view
- `src/lib/LoadYAMLButton.svelte` + `importer.ts` — 匯入 YAML/純文字名錄，透過 `/api/resolve_name` 批次解析
- `src/lib/AmbiguousSelector.svelte` — 模糊比對結果選擇器

**物種詳細頁（detail view）：**
- `src/lib/SpeciesDetailView.svelte` — B + C 容器（flex 佈局）
- `src/lib/SpeciesSidebar.svelte` — Zone B：左側物種清單（筆畫排序）+ 返回名錄按鈕
- `src/lib/SpeciesDetailPanel.svelte` — Zone C：
  - C1 物種資訊（學名、俗名、科名、高階類群、來源/特有/IUCN Badge）
  - C2 同物異名（預留介面，目前顯示 placeholder）
  - C3 外部連結（GBIF、TaiCOL、iNaturalist）

**其他元件：**
- `src/lib/MapEditor.svelte` — Leaflet 地圖幾何編輯器
- `src/lib/SpeciesList.svelte` — 分類群分組列表（目前未使用）

**工具與資料：**
- `src/lib/formatter.ts` — 前端學名格式化（HTML italic）
- `src/lib/dwcMapper.ts` — Darwin Core 欄位雙向對應
- `src/stores/speciesStore.ts` — 已選物種（persisted to localStorage）
- `src/stores/importState.ts` — 未解析/模糊名稱狀態

### Data Migration & Compatibility

API 回傳的物種資料必須包含 `name`（不含命名者學名）和 `fullname`（含命名者）兩個欄位。`speciesStore.ts` 在從 localStorage 載入舊資料時，會自動對缺少 `name` 欄位的項目用 `extractName()` 從 `fullname` 提取學名（支援 `Genus species` 及 `subsp./var./f./fo.` 等種下階層格式）。新增 API 欄位時應同步確保前端有 fallback 邏輯以相容舊資料。

### Data Flow

搜尋：SearchBox → `/api/search` → 使用者選取 → speciesStore（localStorage）→ SpeciesTable

匯入：LoadYAMLButton → importer.ts 解析 YAML/文字 → `/api/resolve_name` 批次 → merge into store

匯出：SpeciesTable → `/api/export` → 下載 ZIP/YAML/CSV

詳細頁：SpeciesTable 點擊列 → viewMode='detail' → SpeciesDetailView（Sidebar + DetailPanel）

### External API Links

物種詳細頁連結外部服務（使用 `name` 欄位，不含命名者）：
- GBIF: `https://www.gbif.org/species/search?q={scientificName}`
- TaiCOL: `https://api.taicol.tw/v2/taxon?scientific_name={scientificName}`（API）/ `https://taicol.tw/zh-hant/search?name={scientificName}`（網頁）
- iNaturalist: `https://www.inaturalist.org/taxa/search?q={scientificName}`

### Database

預載 SQLite（`backend/twnamelist.db`），包含臺灣維管束植物名錄：
- `dao_plant_type` — 高階類群（plant_type 0-6 為排序值）
- `dao_pnamelist_pg` — 完整植物名錄（id, family, cname, name, fullname, endemic, source, iucn_category）

### Environment Variables

| 變數 | 用途 | 預設值 |
|------|------|--------|
| `CHECKLISTER_DB_PATH` | SQLite 資料庫路徑 | `backend/twnamelist.db` |
| `CHECKLISTER_FRONTEND_DIR` | 前端 build 產物目錄 | `frontend/build` |
| `VITE_API_BASE_URL` | 前端開發時的 API base URL | `/api` |

### PyInstaller Packaging

`run.py` 為打包入口，透過 `sys._MEIPASS` 偵測 PyInstaller 環境：
- 自動設定 DB、前端、Pandoc 路徑至 bundle 內資源
- `wait_for_server()` 等待 server 就緒後才開瀏覽器（解決 race condition）
- `checklister.spec`（macOS）/ `checklister_win32.spec`（Windows）排除不需要的套件以減小體積
- Pandoc binary 打包在 bundle 的 `binaries` 中，不需使用者額外安裝
- DMG 透過 `make pkg-dmg` 產出，含 Applications 捷徑供拖拉安裝

## Key Dependencies

- **Backend**: FastAPI, SQLModel, Uvicorn, PyYAML, Pandoc（DOCX 轉換）
- **Frontend**: SvelteKit 2, Svelte 5, Vite 6, Tailwind CSS 3, Flowbite Svelte, Leaflet, js-yaml
- **Packaging**: PyInstaller

## Planned: MCP Server Support

目標：讓 AI agent 透過 MCP 直接操作名錄功能。架構方向：
- 抽出 `backend/core/` 層（純邏輯：search, resolve, export），不依賴 HTTP
- FastAPI routes 和 MCP server 共用同一套 core 邏輯
- MCP tools 對應：`search_species(query)`, `resolve_names(names)`, `export_checklist(checklist, format)`

## Planned: Synonyms Data

同物異名功能 UI 已建好（`SpeciesDetailPanel.svelte` C2 區域），資料介面預留：
```typescript
type Synonym = {
  scientificName: string;   // 異名學名
  authorship: string;       // 命名者
  source: string;           // 資料來源 (TaiCOL, GBIF)
  status: string;           // synonym, homotypic synonym, etc.
};
```
待串接 TaiCOL API (`https://api.taicol.tw/v2/taxon?scientific_name=`) 或建立本地異名資料表。
