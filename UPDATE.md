# Update Log

## 2026-04-08: Checklist Comparison, Batch Import Rewrite, Search Sort & YAML Fix

### Checklist Comparison (`/compare`)

- New page for comparing 2-10 checklists side by side.
- **Input**: Add current checklist and/or upload multiple YAML files.
- **Presence/absence indices**: Species richness, shared species, unique species per list, Sørensen and Jaccard similarity matrices.
- **Abundance indices** (when data available): Shannon-Wiener H', Simpson D, Evenness J'.
- **Species matrix**: All species × checklists table with ✓/✗, filterable by shared/unique/at-least-N.
- **Export**: CSV report with matrix + indices.
- **Abundance column**: SpeciesTable now has inline editable "數量" column. DwC mapping: `abundance → individualCount`.

### Batch Import Rewrite

- "批次匯入" button now opens a modal with textarea for pasting names (newline or comma separated) + file upload.
- **Three-stage processing**:
  1. Exact match (cname or scientific name) → auto-added to checklist
  2. Multiple matches → shown in-modal for user selection (per species: click to select, skip, or skip-all)
  3. Unresolved (no match) → shown in-modal with options: "放入未收錄" (add as unresolved) or "忽略" (ignore), with bulk buttons
- Auto-closes modal when all names resolved successfully.
- Button text changed: "開始比對" → "開始匯入".

### Search Sort Fix

- Search results now prioritize exact matches: `cname == query` or `name == query` shown first, then prefix matches, then by name length (shorter = more relevant).
- Example: searching "芒" now returns "芒 (Miscanthus sinensis)" first instead of "三芒耳稃草".

### YAML Parse Fix

- `parseChecklistYAML()` now handles the `checklister-ng:` wrapper key in YAML files (e.g., `checklister-ng.checklist` nested structure).
- Fixes comparison page failing to parse exported YAML files.

### YAML Export: WKT in YAML only

- Markdown/DOCX header no longer includes raw WKT string (only project name and site name).
- WKT is included in the `.yml` file inside the ZIP and in standalone YAML export.

### New/Modified Files

| File | Action |
|------|--------|
| `frontend/src/lib/compareUtils.ts` | New: comparison logic + diversity indices |
| `frontend/src/routes/compare/+page.svelte` | New: comparison page |
| `frontend/src/lib/LoadYAMLButton.svelte` | Rewrite: modal-based batch import with in-modal resolution |
| `frontend/src/lib/SpeciesTable.svelte` | Added abundance column |
| `frontend/src/lib/importer.ts` | Added `parseChecklistYAML()`, fixed `checklister-ng` wrapper parsing |
| `frontend/src/routes/+layout.svelte` | Navbar: added Compare link |
| `backend/api/search_api.py` | Search sort: exact → prefix → length |
| `backend/api/export.py` | YAML export includes metadata; Markdown header WKT removed |
| `backend/utils/mapper.py` | DwC mapping: `abundance → individualCount` |

---

## 2026-04-08: Map Editor, Keyboard Shortcuts, Export Metadata & Plant Classification Fix

### Map Editor (`/map`)

- Full Leaflet map editor with Marker, Polyline, Polygon, Rectangle drawing tools.
- **Import**: GPX, KML, WKT, GeoJSON files via `@tmcw/togeojson` and `terraformer-wkt-parser`.
- **Export**: Download as WKT, GPX (`togpx`), KML (`tokml`), or GeoJSON.
- Project metadata form: project name + site name (persisted to localStorage via `metadataStore`).
- Geometry auto-saved to `metadataStore.geometries` (GeoJSON) and `metadataStore.footprintWKT` (WKT).
- Location search via Nominatim geocoding.
- Fix: Leaflet marker icon path and `draw:created` event string (ESM dynamic import compatibility).

### Map Preview (Main Page)

- "地圖" button in toolbar opens a pop-up Modal with read-only map preview (lazy-loaded Leaflet).
- Shows WKT snippet and "前往編輯" link to `/map`.
- Button turns green when geometry exists.

### YAML Geometry Integration

- **Export**: YAML now includes `project`, `site`, `footprintWKT` fields from `metadataStore`.
- **Import**: `importer.ts` reads `footprintWKT`, `project`, `site` from YAML and stores in `metadataStore`.
- **Markdown/DOCX export**: Header auto-appends project name (as title), site name, and WKT.

### Keyboard Shortcuts

- **SearchBox**: `↑`/`↓` navigate suggestions (blue highlight), `Enter` adds highlighted species, `Esc` closes list.
- **SpeciesTable**: `Delete`/`Backspace` removes checked species (with confirmation). Not triggered inside input fields.
- **SpeciesSidebar (detail view)**: `Delete`/`Backspace` removes currently selected species (with confirmation). Deleted species auto-switches to next or returns to table.

### Sidebar Search Filter

- Added search/filter input above "返回名錄" button in detail view sidebar.
- Filters species list by common name or scientific name in real-time.

### Vascular Plant Classification Fix

- **Strict 6-group ordering**: 石松類 → 蕨類 → 裸子 → 單子葉 → 真雙子葉姊妹群 → 真雙子葉.
- **Magnoliopsida resolved by order**: Built `MONOCOT_ORDERS` (11 orders) and `SISTER_EUDICOT_ORDERS` (Ceratophyllales) lookup tables. Remaining Magnoliopsida orders → 真雙子葉植物.
- Removed fallback "被子植物 Angiosperms" — all Magnoliopsida now correctly classified.
- Export `_get_field_display()` always resolves vascular plants via dao lookup → class mapping → order-based resolution, regardless of `pt_name` value.

### Same Common Name Disambiguation Fix

- When multiple accepted species share the same common name and no `alternative_name_c` exists, the display no longer appends the full scientific name in parentheses. Only species with `alternative_name_c` show disambiguation.

### Search Badges

- Search suggestion dropdown now shows colored badges: 原生 (green), 歸化 (yellow), 栽培 (blue), 臺灣特有 (purple), IUCN status (dark).

### Unified Advanced Filter

- Merged taxon group dropdown + rank dropdown into single "篩選" modal with:
  - Emoji icon buttons for 14 taxon groups (connected to search)
  - Rank-specific search with auto-complete (via `/api/search/rank`)
  - Endemic checkbox + alien type dropdown
- Changing taxon group clears rank filter (with confirmation).
- Filter auto-complete minimum input: 1 character.

### New/Modified Files

| File | Action |
|------|--------|
| `frontend/src/stores/metadataStore.ts` | Expanded: projectName, siteName, geometries, footprintWKT + localStorage |
| `frontend/src/lib/MapEditor.svelte` | Full rewrite: Leaflet editor + GPX/KML/WKT/GeoJSON import/export |
| `frontend/src/lib/MapPreview.svelte` | New: pop-up map preview |
| `frontend/src/lib/TaxonTreeNode.svelte` | New: recursive tree node with auto-expand |
| `frontend/src/lib/ExportSettings.svelte` | New: export hierarchy config modal |
| `frontend/src/routes/map/+page.svelte` | Rewrite: full map editor page |
| `frontend/src/routes/taxonomy/+page.svelte` | New: taxonomy browser page |
| `frontend/src/routes/+layout.svelte` | Shared Navbar with active state |
| `frontend/src/lib/SearchBox.svelte` | Unified filter + keyboard nav + search badges |
| `frontend/src/lib/SpeciesTable.svelte` | UI polish + Delete shortcut |
| `frontend/src/lib/SpeciesSidebar.svelte` | Filter input + Delete shortcut |
| `frontend/src/lib/importer.ts` | YAML geometry import |
| `backend/api/export.py` | Multi-taxon + plant classification fix + metadata header |
| `backend/api/search_api.py` | Advanced filters + `/api/search/rank` + plant pt_name resolution |
| `backend/api/taxonomy_api.py` | New: taxonomy tree + search API |

---

## 2026-04-07: Taxonomy Tree, Advanced Filter, UI Polish

### Taxonomy Tree Browser

- New `/taxonomy` route with collapsible hierarchy browser (Kingdom → Phylum → Class → Order → Family → Genus → Species).
- Lazy-load children via `GET /api/taxonomy/children`. Each node shows stats (X門 X綱 X目 X科 X屬 X種).
- Rank badges with color coding (界=red, 門=yellow, 綱=green, 目=blue, 科=purple, 屬=dark).
- Species list shows endemic/native/naturalized/invasive/cultured badges and IUCN status.
- Search within taxonomy tree (`GET /api/taxonomy/search`): type a name → auto-complete → select → auto-expand full ancestor path with highlight.
- "全部收合" button to collapse all expanded nodes.
- Quick access buttons for Plantae/Animalia/Fungi.

### Shared Navbar

- Navbar moved from `+page.svelte` to `+layout.svelte`. All pages (Home, Taxonomy, Docs, Admin) now share the same navigation bar with active page highlighting.

### Advanced Search Filter (Unified)

- Replaced separate taxon group dropdown + rank dropdown with a single "篩選" button opening a unified filter modal.
- Filter modal contains:
  - **Taxon group icons**: Emoji-based buttons (🌿維管束植物, 🐦鳥綱, 🍄真菌界, etc.) with blue highlight on selection.
  - **Rank-specific search**: Select rank (綱/目/科/屬) → type name with auto-complete → select from suggestions.
  - **Endemic filter**: Checkbox for endemic-only species.
  - **Alien type filter**: Dropdown for native/naturalized/invasive/cultured.
- Rank search uses dedicated `GET /api/search/rank` endpoint (queries by specific rank level).
- Changing taxon group clears rank-specific filter with confirmation prompt.
- Active filters shown as colored badges below search bar; "清除篩選" to reset all.
- Backend: Added `class_filter` and `genus_filter` parameters to `/api/search`.

### UI Polish (SpeciesTable)

- Search + family filter moved above the table as a compact row.
- Delete button moved to table top-right, smaller: "刪除 (n)".
- Per-page selector moved to bottom alongside pagination: "顯示 [10▼] 筆/頁，共 N 筆".
- Per-page options expanded: 10, 20, 50, 100.

### Search Fixes

- Filter auto-complete minimum input reduced from 2 to 1 character (supports single Chinese character like 菊, 蘭, 松).
- Genus rank search now also queries `genus_c` (Chinese genus name).
- Nominal infraspecific dedup: Species + its nominal form/variety with same common name only shows Species rank.

---

## 2026-04-07: Security Hardening & Code Quality

### Security Fixes

- **LIKE injection escape**: All SQL `LIKE` queries now escape `%` and `_` wildcards in user input via `_escape_like()`. Applied to `search_api.py` and `resolve_name.py`.
- **CORS middleware**: Added `CORSMiddleware` allowing `localhost:5173` and `localhost:8964`.
- **Rate limiting**: Added `slowapi` with default limit of 60 requests/minute per IP.
- **XSS prevention**: `formatScientificName()` in `formatter.ts` now escapes HTML entities (`<`, `>`, `&`, `"`) before constructing italic tags, preventing stored XSS from compromised database values.
- **CSV SQL injection check**: Admin CSV upload (`/api/admin/import-taicol`) scans uploaded content for suspicious SQL patterns (`DROP`, `DELETE`, `INSERT`, `UNION`, etc.) and rejects if detected.
- **Query length limits**: Search query `q` limited to 512 characters, `taxon_id` to 20 characters.
- **Upload size limit**: CSV upload capped at 200MB.

### Code Quality

- **Logging**: Added `logging.basicConfig()` in `main.py`. All bare `except Exception: pass` blocks replaced with `logger.exception()` for proper error tracking.
- **Temp file cleanup**: Export API uses `BackgroundTasks` to delete temp ZIP files after response is sent.

### Dependencies

- Added `slowapi` to `requirements.txt`.

---

## 2026-04-07: Export Fixes, RWD, External Links & Data Corrections

### Export Fixes

- **Plant hierarchy names**: Vascular plant exports now strictly use Chinese group names (石松類植物, 蕨類植物, 裸子植物, 單子葉植物, 真雙子葉植物姊妹群, 真雙子葉植物) by looking up `dao_pnamelist_pg` for the correct `pt_name`. Cycadopsida/Ginkgoopsida/Pinopsida are all grouped under 裸子植物. Fallback to class→Chinese name mapping when dao lookup fails.
- **Plant hierarchy ordering**: Groups are sorted by `dao_plant_type.plant_type` order (苔蘚→石松→蕨類→裸子→單子葉→姊妹群→真雙子葉).
- **Markdown italic fix**: Species item indentation reduced from 8 spaces to 4 spaces (2×depth) to prevent Pandoc from treating `*italic*` as code blocks.
- **Nominal infraspecific dedup**: When a Species and its nominal infraspecific (e.g., `Dianthus pygmaeus` vs `Dianthus pygmaeus fo. pygmaeus`) share the same common name, only the Species rank is shown in search results.
- **Synonym italic fix**: Removed outer `class="italic"` from synonym list items — `formatScientificName()` already handles italic via `<i>` tags, so rank abbreviations (var., subsp., fo.) are now correctly upright.

### RWD: Mobile Species Detail View

- Desktop (md+): Sidebar (Zone B) remains fixed on the left.
- Mobile (< md): Sidebar is hidden. A "物種列表" button appears at the top of the detail panel. Tapping it opens a slide-in drawer from the left with semi-transparent backdrop. Selecting a species auto-closes the drawer.

### External Links

- **TaiCOL**: Fixed to use only the primary common name (strips parenthesized secondary name).
- **Plant-only links** (shown only when `kingdom=Plantae`): IPNI, POWO, 台灣植物資訊整合查詢系統 (`tai2.ntu.edu.tw/search/1/{scientificName}`).
- **All taxon groups**: Added Wikispecies (`species.wikimedia.org/wiki/{name}`) and NCBI Taxonomy (`ncbi.nlm.nih.gov/taxonomy/?term={name}`).

### Data Corrections

- `Pinus armandii var. masteriana` (name_id=133788): Changed `usage_status` from `accepted` to `not-accepted`. This is a misspelling in the TaiCOL source data; the correct accepted name is `Pinus armandii var. mastersiana` (name_id=61488).

### Search API: pt_name from dao

- For vascular plants, `_build_pt_name()` now queries `dao_pnamelist_pg` to get the correct Chinese `pt_name` (e.g., 真雙子葉植物 Eudicots) instead of returning `Tracheophyta > Magnoliopsida`. Cache is built on first call.

---

## 2026-04-06: Multi-Taxon Export with Configurable Hierarchy

### Multi-Taxon Export

- **Auto-detection**: Export automatically detects taxonomic groups (Tracheophyta, Aves, Insecta, Fungi, etc.) from each species' `kingdom`, `phylum`, and `class_name` fields.
- **Default hierarchies per group**:
  - Vascular plants: 類群(pt_name) → 科(family) → species
  - Birds/Insects/Mammals/Reptiles/Amphibians: 目(order) → 科(family) → species
  - Fungi: 門(phylum) → 綱(class) → 科(family) → species
  - Mollusca: 綱(class) → 目(order) → 科(family) → species
- **Mixed checklists**: When a checklist contains species from multiple groups (e.g., plants + birds), the export automatically segments by group, each with its own hierarchy.
- **Markdown header**: Changed from hardcoded "維管束植物名錄" to dynamic "物種名錄" with accurate statistics.

### Configurable Hierarchy Levels

- **`levels` query parameter**: `POST /api/export?format=markdown&levels=order,family` overrides default hierarchy.
- **Frontend "匯出設定" button**: Opens a modal with 6 checkboxes (kingdom, phylum, class, order, family, genus) to customize export levels.
- **When unchecked**: Uses each group's default hierarchy.
- Note: Superfamily, Subfamily, Tribe not yet supported (TaiCOL stores these as rank values, not species-level columns). Planned for future version.

### Search API: Full Taxonomy Fields

- Search results now include: `kingdom`, `phylum`, `class_name`, `order`, `genus`, `genus_c` in addition to existing fields.
- These fields flow through to the species store and are used by the export system.

### DwC Mapper

- Added `kingdom`, `phylum`, `class` (from `class_name`), `order`, `genus`, `taxon_id` to Darwin Core field mapping.

### New/Modified Files

| File | Change |
|------|--------|
| `backend/api/export.py` | Full rewrite: multi-group detection, default hierarchies, recursive grouping, `levels` parameter |
| `backend/api/search_api.py` | Return full taxonomy fields (kingdom through genus) |
| `backend/utils/mapper.py` | Add taxonomy fields to DwC mapping |
| `frontend/src/lib/ExportSettings.svelte` | New: hierarchy level selection modal |
| `frontend/src/routes/+page.svelte` | Integrate ExportSettings, pass levels to export API |

---

## 2026-04-06: TaiCOL Integration, Fuzzy Search & Search UX Improvements

### TaiCOL Database Integration

- Imported TaiCOL species name CSV (242,285 rows, covering all biological groups in Taiwan) into a new `taicol_names` SQLite table.
- Key fields indexed for search performance: `common_name_c`, `alternative_name_c`, `simple_name`, `family`, `family_c`, `taxon_id`, `usage_status`, `(kingdom, phylum)`, `class`.
- Multi-value `taxon_id` rows (433 records with comma-separated IDs) are handled by extracting the primary taxon_id and preserving the original in `taxon_id_all`.
- Duplicate `name_id` entries in CSV are automatically skipped during import.
- Database is automatically backed up before each import.

### Search API Rewrite

- **`GET /api/search?q=&group=`**: Now queries the `taicol_names` table with LIKE on 5 fields (`common_name_c`, `alternative_name_c`, `simple_name`, `family`, `family_c`), with fallback to the legacy `dao_pnamelist_pg` table.
- **Alternative name search**: Searching any common name (primary or alternative) finds the species. For example, "過山龍", "台灣鹹蝦花", and "臺灣鹹蝦花" all find *Vernonia gratiosa*.
- **台/臺 auto-conversion**: Search queries automatically generate variants with 台↔臺 swapped.
- **Accepted-first sorting**: Results with `usage_status = 'accepted'` are shown before synonyms and misapplied names.
- **`is_in_taiwan` filter**: Only species present in Taiwan are returned.
- **Taxon group filter**: New `group` query parameter filters by taxonomic group (see frontend section below).
- Response includes new fields: `taxon_id` and `usage_status`.

### Synonyms API

- **`GET /api/synonyms?taxon_id={id}`** (`backend/api/synonyms_api.py`): Returns all names sharing the same `taxon_id`, with status labels (`accepted`, `not-accepted`, `misapplied`), authorship, and common name.

### Admin Import API

- **`POST /api/admin/import-taicol`** (`backend/api/admin_api.py`): Accepts TaiCOL CSV file upload (multipart), backs up the database, drops and recreates `taicol_names`, imports all rows in batches of 5,000, and rebuilds indexes. Returns import statistics (row count, elapsed time).
- Requires `python-multipart` package (added to `requirements.txt`).

### Frontend: Taxon Group Filter

- `SearchBox.svelte` now includes a dropdown filter with 13 taxonomic groups plus "所有類群" (all):
  - 維管束植物 (Tracheophyta), 植物界 (Plantae), 鳥綱 (Aves), 真菌界 (Fungi), 哺乳類 (Mammalia), 爬行類 (Reptilia), 昆蟲綱 (Insecta), 蛛形綱 (Arachnida), 軟體動物 (Mollusca), 輻鰭魚類 (Actinopterygii), 兩棲類 (Amphibia), 原生生物 (Protozoa), 所有動物 (Animalia).
- Search results show `usage_status` badge for non-accepted names.

### Frontend: Synonym Display

- `SpeciesDetailPanel.svelte` C2 section now automatically fetches synonyms from `/api/synonyms?taxon_id=` when a species is selected.
- Synonyms are displayed with scientific name, authorship, common name, and color-coded status badges (green=accepted, red=misapplied, dark=not-accepted).

### Frontend: Admin Page

- New route `/admin` (`frontend/src/routes/admin/+page.svelte`): Provides a file upload interface for importing TaiCOL CSV files.
- Shows upload progress, import statistics (row count, elapsed time), and error messages.
- Admin link added to the navigation bar.

### Makefile

- New target `make taicol`: Automatically finds the latest `references/TaiCOL_name_*.csv` file, backs up the database, and runs the import. Supports custom path via `make taicol CSV=path/to/file.csv`.

### New Files

| File | Purpose |
|------|---------|
| `backend/models/schema.py` (modified) | Added `TaicolName` model for `taicol_names` table |
| `backend/services/taicol_import.py` | CSV import service with batch insert and index creation |
| `backend/services/__init__.py` | Package init |
| `backend/utils/backup.py` | Database backup utility |
| `backend/api/admin_api.py` | TaiCOL CSV upload endpoint |
| `backend/api/synonyms_api.py` | Synonym query endpoint |
| `frontend/src/routes/admin/+page.svelte` | Admin upload page |

### Fuzzy Search (Levenshtein Distance)

- Added `rapidfuzz` dependency for typo-tolerant search.
- **In-memory cache**: 62,658 distinct accepted common names loaded on first search (~0.2s), stays resident (~2-3MB). Thread-safe lazy loading with lock. Invalidated automatically on TaiCOL re-import.
- **Two-stage search**: Exact LIKE search first. If results < 5, fuzzy fallback scans cached names with Levenshtein distance ≤ 1 (~11ms for 62k entries). Widens to distance ≤ 2 if still insufficient.
- Examples: "香南" → finds "香楠" (dist=1); "舗地黍" → finds "舖地黍" (dist=1).
- Total search time including fuzzy: < 130ms.

### Search UX Improvements

- **Accepted-only results**: Search dropdown only shows accepted names. Non-accepted names are auto-resolved to their accepted counterpart.
- **Non-accepted name display**: When user types a synonym (e.g., `Lycopodium cernuum`), the dropdown shows: `俗名 (synonym name) [not-accepted] → accepted name`.
- **Same common name disambiguation**: When multiple species share the same common name, they are shown with alternative names in parentheses. E.g., "過山龍(台灣鹹蝦花)" vs "過山龍(垂穗石松)".
- **Alternative name via alt match**: When a match comes from `alternative_name_c`, display format is: `alt_name(primary_cname) (scientific name) family`.
- **Fuzzy match hint**: Fuzzy results show orange "≈ 您是否在找？" label in the dropdown.
- **Species detail panel**: "其他俗名" row added above family name in classification info (from `alternative_name_c`). Synonyms list no longer shows common names — only scientific name + authorship + status badge.

### Modified Files

| File | Change |
|------|--------|
| `backend/api/search_api.py` | Full rewrite: TaiCOL search, group filter, 台/臺 conversion, accepted-only with non-accepted resolution, same-cname disambiguation, fuzzy search with Levenshtein cache |
| `backend/main.py` | Register synonyms_api and admin_api routers |
| `backend/services/taicol_import.py` | Invalidate fuzzy cache after import |
| `frontend/src/lib/SearchBox.svelte` | Taxon group dropdown, non-accepted display, fuzzy hint |
| `frontend/src/lib/SpeciesDetailPanel.svelte` | Auto-fetch synonyms, show alternative names, remove cname from synonyms |
| `Makefile` | Added `taicol` target |
| `requirements.txt` | Added `python-multipart`, `rapidfuzz` |

---

## 2026-04-06: Architecture Overhaul & Species Detail View

### Removed

- **Electron app** (`electron-app/`): Removed the entire Electron wrapper. It provided no native functionality beyond opening a browser window, yet added 584MB of `node_modules`. The same behavior is achieved by `run.py` using `webbrowser.open()`.
- **Dead code** (`backend/api/main.py`): Removed unused legacy main file that was never imported and contained broken router references.
- **Commented-out code**: Cleaned up ~100 lines of commented-out code across `backend/main.py`, `backend/api/export.py`, `backend/models/schema.py`.
- **Unused dependency**: Removed `python-docx` and `lxml` from `requirements.txt` (code uses Pandoc for DOCX conversion, not python-docx).

### Backend Changes

- **Configurable database path** (`backend/db.py`): Database path is now configurable via the `CHECKLISTER_DB_PATH` environment variable, with fallback to the default `backend/twnamelist.db`.
- **Search API** (`backend/api/search_api.py`): Added the `name` field (scientific name without author) to the search response. Previously only `fullname` (with author) was returned.
- **Export type ordering** (`backend/api/export.py`): Plant type ordering for checklist export is now read from the `dao_plant_type` database table instead of being hardcoded. This means new plant groups added to the database will be automatically reflected in exports.
- **Pandoc error handling** (`backend/api/export.py`): Added `capture_output`, return code checking, and 30-second timeout to the Pandoc subprocess call. Previously, Pandoc failures were silent.
- **Static file serving** (`backend/main.py`): FastAPI now serves the frontend build output as static files, with a catch-all route for SPA client-side routing. The frontend directory is configurable via `CHECKLISTER_FRONTEND_DIR`.
- **Setup script** (`backend/setup.sh`): Fixed shebang (`sh` → `bash`), added `set -e`, changed to install from `requirements.txt` instead of manually listing packages.

### Frontend Changes

- **Static adapter** (`frontend/svelte.config.js`): Changed from `adapter-auto` to `adapter-static` for proper static site generation.
- **Layout config** (`frontend/src/routes/+layout.ts`): Added `prerender = true` and `ssr = false` for static build compatibility.
- **Sortable table** (`frontend/src/lib/SpeciesTable.svelte`): All table columns (ID, family, common name, scientific name, source, endemic) are now clickable to sort. Common names sort by Chinese stroke order using `Intl.Collator('zh-Hant', { collation: 'stroke' })`. Family names sort by Latin name alphabetically while displaying as "中文名 (Latin)".
- **Row click to detail view** (`frontend/src/lib/SpeciesTable.svelte`): Added `onRowClick` prop. Clicking a species row (not the checkbox) opens the species detail view.
- **Species detail view** (new files):
  - `SpeciesDetailView.svelte`: Container with flex layout for sidebar + detail panel.
  - `SpeciesSidebar.svelte`: Left sidebar with stroke-order sorted species list and "back to checklist" button.
  - `SpeciesDetailPanel.svelte`: Right panel with three sections:
    - C1: Species info (scientific name, common name, family, higher classification, source/endemic/IUCN badges).
    - C2: Synonyms placeholder (UI ready, awaiting data integration).
    - C3: External links to GBIF, TaiCOL, and iNaturalist.
- **Sticky toolbar** (`frontend/src/routes/+page.svelte`): The search bar, import button, export controls, and species count badge are now in a sticky zone that stays fixed at the top when scrolling.
- **View mode switching** (`frontend/src/routes/+page.svelte`): Added `viewMode` state (`'table'` | `'detail'`) to toggle between the checklist table and species detail view.
- **Data migration** (`frontend/src/stores/speciesStore.ts`): When loading data from localStorage, items missing the `name` field are automatically backfilled using `extractName()`, which parses the scientific name (including infraspecific ranks like subsp., var., f.) from the `fullname` field.

### External API Links

- **GBIF**: `https://www.gbif.org/species/search?q={scientificName}`
- **TaiCOL API**: `https://api.taicol.tw/v2/taxon?scientific_name={scientificName}` (note: domain is `api.taicol.tw`, not `taicol.tw/api`)
- **TaiCOL Web**: `https://taicol.tw/zh-hant/search?name={scientificName}`
- **iNaturalist**: `https://www.inaturalist.org/taxa/search?q={scientificName}`

All URLs use the `name` field (without author), encoded with `encodeURIComponent()`.

### Packaging

- **Makefile**: Added `Makefile` with targets: `make`, `make run`, `make dev`, `make pkg`, `make pkg-dmg`, `make pkg-win`, `make clean`.
- **PyInstaller improvements** (`run.py`, `checklister.spec`):
  - `run.py` now uses `sys._MEIPASS` to locate bundled resources in PyInstaller environment.
  - `wait_for_server()` polls the server with socket connection before opening the browser, fixing the "localhost refused to connect" race condition.
  - Environment variables (`CHECKLISTER_DB_PATH`, `CHECKLISTER_FRONTEND_DIR`) are set before importing the app module.
  - Frontend build output is now included in the PyInstaller bundle.
  - Pandoc binary is bundled in the app (auto-detected via `which pandoc`), so users don't need to install Pandoc separately.
  - Unnecessary packages (PIL, numpy, IPython, jedi, pygments, zmq, etc.) are excluded to reduce bundle size.
  - Default port changed to 8964.
- **DMG packaging**: `make pkg-dmg` creates a macOS DMG with the `.app` bundle and an Applications symlink for drag-to-install.
- **Windows spec** (`checklister_win32.spec`): Added spec file for Windows single-file executable packaging.
