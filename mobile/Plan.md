# Checklister Mobile 設計文件

## 原始需求

1. 具有和 checklister 搜尋相同的功能
2. 可建立名錄 (species richness)、物種豐度 (abundance) 等功能
3. 具有匯出名錄、物種豐度等功能
4. 有地圖功能，可記錄點位和錄製軌跡
5. 支援 iOS / Android

## 實作狀態（v0.1, 2026-05-11）

**MVP 功能完成度：100%**（搜尋、名錄記錄、專案管理、匯出 YAML/CSV/Markdown，已在 iOS Simulator 驗證跑得起來）

| Sprint | 內容 | 狀態 |
|------|------|------|
| 0 | 專案 setup（Expo SDK 54、TS、NativeWind、Prettier）| ✅ |
| 1 | 資料層（TaiCOL DB bundle、user.db schema、search/fuzzy/synonyms port、CRUD 模組）| ✅ |
| 2 | 核心 UI（bottom tabs、session 列表、session 詳細頁、SearchBox、SpeciesCard、Toast）| ✅ |
| 3 | CRUD 完整（detail bottom sheet、Notes modal、End session B2 modal、專案 / 設定 / 關於頁、物種查詢頁）| ✅ |
| 4 | YAML / CSV 匯出 + 系統 Share Sheet | ✅ |
| 3.5 | 額外 polish（TaxonGroupPicker、SafeArea、Swipe-left 移除、session 內專案指派 / 新建）| ✅ |
| 4.5 | Phase 1 收尾：清除所有資料、空 session 刪除、隔日 stale session 提示、排序選項（4 種 + persist）、long-press ActionSheet、Markdown 匯出（含維管束植物 6 類群分流） | ✅ |
| 4.6 | 學名 italic 規範化：`<ScientificName>` 元件（rank abbr 不 italic、subordinate epithet italic、動物 vs 植物分流）、family/order/etc Latin 名移除 italic | ✅ |
| 4.7 | 結束的 session 可重新啟用：`reopenSession()` + header「繼續編輯」按鈕、衝突偵測（已有 active session 時 prompt 先結束舊的）| ✅ |
| 4.8 | Phase 1 收尾：sessions 多選刪除（long-press 進入 + checkbox + batch delete + 全選）、EAS Build profiles 設定 | ✅ |
| 5.0 | Phase 2 起點：分類樹 tab（kingdom → phylum → class → order → family → genus → species lazy load、tap 物種開 LookupResultSheet、long-press 加入 session、autonym s.str. 標示） | ✅ |
| 5.1 | 分類樹底部搜尋：`searchTaxonomy()` query → SearchBox 顯示候選（俗名/學名/科/屬/path 預覽）、tap 結果自動展開祖先節點（TaxonNode 改為 `useEffect` auto-load） | ✅ |
| 5.2 | 分類樹 polish：展開狀態 persist 到 settings.taxonomy_expanded（JSON-encoded set）、頂部「全部收合 (N)」按鈕、search-pick 後 scrollToIndex 到該 path 的 kingdom | ✅ |
| 5.3 | 分類樹改扁平 list：state 管理移到 screen 層（nodeMap + childrenMap + speciesMap）、`flatten()` 產出 FlatList items、search-pick 可精確 scrollToIndex 到 deep leaf；KeyboardAvoidingView 加 useBottomTabBarHeight offset 修正鍵盤遮蔽 | ✅ |
| 5.4 | UX polish：bottom sheet 改 absolute 定位修 ScrollView 無法 scroll、detail 文字加 selectable 可複製、批次匯入物種（BatchImportModal：貼名單/上傳檔案 + resolveBatch 三階段精確/多筆/未收錄 + sub-bar「批次」按鈕觸發） | ✅ |
| 5.5 | 修加入備註：iOS 兩個 sibling Modal 衝突。NotesEditModal 改成 SpeciesDetailSheet 內部 child（detail sheet 自管 notesModalOpen 狀態 + onSaveNotes callback）。長按 ActionSheet 走獨立 modal 路徑（!activeRecord 時才 render） | ✅ |
| 5.6 | 「其他俗名」block 加在 SpeciesDetailSheet / LookupResultSheet（alternative_name_c 逗號展開為「、」分隔，置於物種狀態之上、無內容時 block 隱藏）+ RecordWithTaxon 補 alternative_name_c 欄位 | ✅ |
| 5.7 | 字體大小設定：tailwind.config.js 改 fontSize 用 CSS vars + FontScaleProvider 在 root 注入 vars + settings 加「字體大小」radio（小/預設/大/特大）+ font_scale persist | ✅ |
| 6.0 | Phase 2.0.1：react-native-maps 安裝 + 地圖 tab 滿版（Apple Maps iOS）+ 多基底切換（標準/衛星/混合/地形）+ map view state persist（zoom/center/basemap） | ✅ |
| 6.1 | Phase 2.0.2：中研院 WMTS overlay（85 圖層，port 自 web sinicaLayers.ts）+ SinicaLayerSheet 圖層選擇器（搜尋 + 透明度 slider）+ 設定 persist + 當前位置浮動按鈕（expo-location）+ 地址搜尋框（Location.geocodeAsync 跨平台免 key） | ✅ |
| 6.2 | 地圖 UI 重設計（方案 B 雙 FAB）：搜尋 FAB（左上 collapsed icon → tap 展開全寬輸入框 + autoFocus）+ 工具 FAB（右上 ⋮ icon → tap 展開垂直 row 列：basemap / locate / 圖層 + 未來預留樣區/名錄 toggle）。WMTS active 時 FAB 圖示變藍 | ✅ |
| 6.3 | Phase 2.0.3：sites 樣區（migration v2 加 sites 表 + CRUD 模組 + GeoJSON helpers + bounds 計算）+ 地圖繪製互動（Point/LineString/Polygon 三種模式、紅色臨時點、頂部 toolbar 顯示「N 點」+ 取消/復原/完成）+ SaveSiteModal（命名/專案/備註）+ 渲染既有 sites（藍色 Marker/Polyline/Polygon、tap 跳查/刪）+ Sites 列表頁（drawer 入口、按 project 分組、tap 跳到地圖該位置、swipe 刪除） | ✅ |
| 6.3.1 | sites 加 Multi geometry 支援：v2 CHECK 與 v3 migration（rename + create + copy 重建表）擴充至含 MultiPoint/MultiLineString/MultiPolygon、TS GeoJSONGeometry union 加 3 種 Multi、`flattenPoints()` + `geometryBounds()` 處理任何型別、新增 `geometryToPrimitives()` 把 Multi* 攤平成多個 RenderPrimitive、map render 改用 flatMap loop。繪製 UI 仍只產生 simple 三型（Multi 留給 KML/GPX 匯入用） | ✅ |
| 6.4 | Phase 2.0.4：地理檔案匯入（GeoJSON / KML / GPX / WKT）+ 匯出（同 4 種）。`@tmcw/togeojson` + `@xmldom/xmldom` + `wellknown` 純 JS 解析、自動偵測格式（副檔名 + 內容嗅探）、Multi* 結構保留、GeometryCollection 攤平、FeatureCollection / Feature / bare geometry 都接受。匯入：地圖工具 ⋮ → 匯入 → GeoImportModal（檔案選擇 + 預覽 + 名稱前綴 + 專案 picker，多筆自動 #1/#2）。匯出：sites 列表頁 header 全部匯出 + 每個 project group 局部匯出 → ActionSheet 4 格式 → expo-sharing | ✅ |
| 6.5 | Phase 2.0.6：Session ↔ Site 關聯。migration v4 加 `sessions.site_id` (nullable FK ON DELETE SET NULL)、SiteAssignSheet 新元件（按 preferred project 排序、＋新建 row、移除指派 row）、Session detail header 加「📍 指定樣區」chip（與專案 chip 並排）、新建流程跳 map tab + query params (draw=Polygon&session=X) + handoffSessionId ref + 完成後 updateSession site_id + router.replace 回 session、地圖頂部綠色 banner 顯示「為 session #X 建立樣區」| ✅ |
| 6.6 | 繪製模式 polish：SiteAssignSheet「新建」展開為三按鈕（點/線/範圍）讓使用者直接選類型；繪製時搜尋 FAB 仍顯示（draw toolbar 移到 top+60 避開）；繪製中的 Marker 加 `draggable` + tap 跳 Alert「刪除此點」、SaveSiteModal 內專案 picker 加「+ 新建專案」row 內嵌 ProjectEditModal | ✅ |
| 6.6.1 | iOS 3 層巢狀 Modal hang 修正：SaveSiteModal / ProjectAssignSheet 內的「+ 新建專案」改用 `Alert.prompt`（iOS native dialog，不堆 Modal）。Android 不支援 Alert.prompt，引導使用者到「專案管理」頁建立 | ✅ |
| 6.7 | UI polish：(1) 移除 SearchBox 的 recent search 列表 (2) tabs 沒 active session 時加 SafeArea top spacer 避免名錄/選單/分類樹標題被狀態列/動態島蓋住 (3) autocomplete row 改 `flex-wrap` 允許換行不切斷長學名 (4) 候選 long-press → LookupResultSheet 看完整 metadata (5) `matched_as` 同物異名命中時 LookupResultSheet 頂部多一條 orange 提示「你輸入的是 xxx (synonym)」 | ✅ |
| 6.8 | 地圖首次載入 loading overlay：mapReady state + `onMapReady` callback + 4 秒 fallback timer + 全螢幕半透明 overlay（spinner + 「載入地圖中...」+「首次開啟需數秒」）；pointerEvents none 不擋互動 | ✅ |
| 6.9 | 無 session 時狀態列文字看不見修正：tabs layout 依 session 狀態切換 expo-status-bar style，session 時 light（白字 on 綠底）、無 session 時 dark（深色字 on 白底）。原 root `style="auto"` 在 dark mode 下會用白字導致白底白字 | ✅ |
| 7.0 | Phase 2.0.5：GPS 整合（前景）。Session sub-bar 加 GPS chip + ActionSheet（打點當前位置 / 開始軌跡 / 停止軌跡 / 清除）、`Location.watchPositionAsync` 5m / 4s interval、軌跡 LineString 寫 `session.track_geojson`（每 5 點 batch persist）、起點寫 `start_lat/lng`、SpeciesDetailSheet 加 per-record GPS 按鈕 → `updateRecordLocation()`、map tab 渲染 active session GPS overlay（綠色起點 + 綠色軌跡 + 橘色 per-record 點）。背景定位 deferred 到後續 sprint | ✅ |
| 7.1 | Session sub-bar redesign：單列 icon-only。專案 chip → 純 icon（title 已顯示專案名）；樣區 + GPS 合併為單一空間 chip（軌跡中>樣區>起點>空 四狀態優先級顯示）；排序 / 批次 → 純 icon。Spatial ActionSheet 新增「從當前位置建立 Point 樣區」一鍵動作，自動 createSite + assign + 寫 start_lat/lng | ✅ |
| 7.2 | Phase 2.x：物種照片（L2 metadata 嵌入 + 多照片）。expo-image-picker 拍照 (quality 0.9 強制 JPEG，preserve EXIF) / 相簿選擇（allowsMultipleSelection）；piexifjs 嵌入 ImageDescription（學名 · 俗名 · 科） + Exif.UserComment（JSON schema: checklister.v1，含 taxon_id/name/author/cname/family/kingdom/notes/lat/lng/observed_at/session_id）+ GPS override；UTF-8→Latin1 byte trick 解決中文 `????` 問題；expo-media-library 寫入 Photos.app；URI 存進 `checklist_records.photo_paths` JSON array（多張）；SpeciesDetailSheet PhotoGrid 88×88 縮圖、ActionSheet（拍照 / 從相簿選）、tap 縮圖→PhotoViewerModal 全螢幕（FlatList paging + close icon + 頁碼）、long-press 縮圖移除；SpeciesCard 列表前 placeholder 顯示首張縮圖 + 右下角 ×N 角標；album-pick 不改原檔（DB 是 metadata 真相源）；piexif 失敗 fallback 存原檔 | ✅ |
| 8.0 | Phase 3 scaffold：植群樣區調查 schema + UI 框架。migration v5 (plot_surveys 30+ 欄含 DwC core / 地形 / E0-E3 cover/height/method + plot_species_records with bb_value / percent / dbh_values_json) + `src/db/plots.ts` (uuid 生成、CRUD、plotCanAcceptSpecies hard-gate)；底部 tab 加「樣區」(grid-outline)；plot list (empty state + FAB + 「資訊未補齊」黃 chip 提示)；plot detail 3-tab (Env / Species / Layers)：Env M 欄位優先 + GPS 一鍵抓（accuracy 寫入 coord_uncertainty_m + 自動 start_ts）+ 進階折疊 + 結束/重開、Layers 各層 cover%/height(cm) + method chip (BB / % / DBH)、Species 暫 placeholder 待下個 sprint | ✅ |
| 8.1 | Phase 3：物種 tab 全功能。PlotSpeciesTab 元件：頂部 layer focus chips (E0/E1/E2/E3，每 chip 顯示該層 method short)、records 依 layer 分組顯示 + 各組 header 含 method 標示、底部 pinned SearchBox 直接搜尋加入；ValueBadge 依 method 切色（BB 綠、% 藍、DBH 琥珀 + stem count + BA cm² + 列表）。PlotSpeciesValueModal 元件：BB 顯示 7 個大 chips (+/r/1-5) 單選、percent 顯示 numeric input + 快捷 chips (1/5/10/25/50/75)、DBH 顯示 stem chip 輸入器 (Enter 或 + 加入，tap × 或 long-press 刪除，顯示 BA cm² 統計) + 備註欄。lastValue per (layer:method) 記憶供下次帶入加快批次輸入；tap record 編輯既有值；long-press → ActionSheet (編輯/刪除)；hard-gate 未通過顯示 SpeciesGateScreen 鎖 | ✅ |
| 9.0 | Phase 3.5 主導覽列重構（Step 4-1/2/3）：(4-1) 名錄 + 樣區 tab 合併為「記錄」混合列表（src/db/records_list.ts + 統一 RecordItem、active 優先排序、icon + chip 區分 kind、segmented filter [全部/名錄/樣區]、swipe 刪除）、(4-2) tab bar 中央 FAB 點擊依 `record_type_default` 設定派發（'session'/'plot'/'ask'），長按 ActionSheet 6 選項（建立 ×2 + 改預設 ×3），setting 頁加「＋ 預設建立」radio；recordCreate.ts 共用 helpers、(4-3) taxonomy tab 改為「物種」segmented [分類樹/檢索表/搜尋]，KeyPlaceholder 等 Step 5；SpeciesSearchPanel 抽出（lookup.tsx + 物種 tab 搜尋 segment 共用） | ✅ |
| 9.1 | 5 個小修：(Fix-1) WMTS 取消後仍暫存 → 不修（cache 問題重啟即解）、(Fix-2) 「打點」→「定位」字串替換 4 處、(Fix-3) ActiveBar 擴充支援 plot：新增 `getActivePlot` / `useActivePlot` store / 統一 bar（最近 startedAt 優先 + icon 區分）、`_layout.tsx` status bar 依 session\|\|plot 切換、(Fix-4) 「看詳細」→「看詳細資訊」、(Fix-5a) Step A 軌跡 schema | ✅ |
| 9.2 | Phase 3 Step A：穿越線軌跡記錄。migration v6 (plot_surveys 加 plot_type 'fixed'\|'transect' + track_geojson + track_finalized；plot_species_records.layer CHECK 加 'T' rebuild 表)、TS type 分離 `FixedLayer` / `Layer = FixedLayer\|'T'`、TRANSECT_LAYER 常數、recordCreate FAB 走 ActionSheet 選樣區類型 + transect 預設 protocol「穿越線調查法」；TransectTrackControl + TrackPreviewModal（react-native-maps 多段 polyline + 起點/終點 marker + 軌跡長度 km）；plots.ts 加 parseTrackSegments / buildTrackGeoJSON / writePlotTrack / finalizePlotTrack / trackLengthMeters；plot detail 對 transect 隱藏「分層」tab；PlotSpeciesTab transect 模式跳過 layer chips、record layer='T'。後續修：track recorder state 提升到 module-level + zustand store (`src/lib/trackRecorder.ts`)，切換 tab 不會 unmount GPS watch；軌跡啟用即設 start_ts；transect plotCanAcceptSpecies 改 check start_ts != null（軌跡曾啟用過即通過 gate） | ✅ |
| 9.3 | Phase 3 Step B：物種屬性欄位（DwC）。migration v8 (checklist_records + plot_species_records 各加 sex / life_stage / reproductive_condition / leaf_phenology 4 欄位)；`src/lib/dwcAttributes.ts`（enum + lifeStageOptions(class) 依 class 動態 + parseMultiAttribute / serializeMultiAttribute / EMPTY_DRAFT helpers）；`SpeciesAttributesBlock` 摺疊 block：依 kingdom 顯示（Plantae sex+repro+leaf；Animalia sex+lifeStage；其他只 sex）；reproductive_condition / leaf_phenology 改 multi-select（JSON array 存）、sex / life_stage 單選；PlotSpeciesValueModal 與 SpeciesDetailSheet 都接入 | ✅ |
| 9.4 | Phase 3 Step C：豐度通用化（DwC organismQuantity + organismQuantityType）。migration v9 (兩表加 organism_quantity TEXT + organism_quantity_type TEXT；UPDATE 遷移既有 bb_value → 'Braun-Blanquet Scale'、percent → '% cover'、dbh_values_json → 'DBH (cm)'）；`src/lib/dwcAbundance.ts`（QUANTITY_TYPES 4 內建 + 自定義、kindForType、parseDbhArray / serializeDbhArray、basalArea、defaultQuantityTypeFor(kingdom)、legacyMethodToType、formatQuantityBadge）；PlotSpeciesValueModal 完整重寫：頂部 type picker（BB / % cover / individuals / DBH / 自定義）→ 對應輸入元件（BBInput / PercentInput / CountInput / DBHInput / CustomInput）；切換 type 自動清空其他輸入；ValueBadge 通用顯示依 kind 切色；lastValue 改 keyed by Layer（記憶單位 + 純量值；DBH stems 與 attributes 清空避免漏抄）；fixed plot per-layer method 改稱「預設豐度單位」hint；DBH 顯示「N 分枝」（非「N 支」）+ label「胸高直徑 (DBH, cm)」。Session 名錄端 abundance UI **deferred 不做**（schema 已 ready，未來開不用 migration）| ✅ |
| 9.5 | Phase 3 Step D：StalePlotWatcher。`latestPlotActivityAt(plotId)` helper；新 component 偵測 active plot 內最近一筆物種觀察 >30 分（無記錄則用 plot.start_ts 當基準）；每分鐘 check + `AppState='active'` 時 immediate check；Alert「繼續記錄 / 前往樣區 / 結束」；結束時若軌跡正錄會先 stop watch；mount 進 `(tabs)/_layout.tsx` | ✅ |
| 9.6 | Single active enforcement：`recordCreate.ts` 加 `ensureNoConflictingActive(wanted)` guard。建任何 record 前若有 active plot/session 衝突，prompt「結束並開始新 X / 前往 X / 取消」3 選項；session→session 仍 reuse；結束時若軌跡正錄會先 pauseRecording 再 endPlotSurvey | ✅ |
| 9.7 | 資料層級重構（方案 A）：(a) 選單「樣區管理」→「**地理樣區**」明確標示是地圖點線面、(b) `/projects` 列表每 row 顯示「名錄 N · 樣區 M」（`listProjectsWithCounts()` 雙 sub-query），deleteProject 也 reassign plots 回未分類、(c) 記錄 tab 右上加「時間軸 ↔ 按專案」切換，按專案模式以 collapsible header 分組（`listRecordsByProject()`） | ✅ |
| 9.8 | Plot env 加專案 picker + DB-level single-active safety net：(a) `app/plot/[id].tsx` EnvTab 內、Plotid 欄位下方新增 project chip → tap 開 `ProjectAssignSheet`（沿用 session 那套，支援 +新建專案 inline）→ `patch({ project_id })`；ProjectAssignSheet 文案泛化（「本次 session」→「本次記錄」）。(b) DB-level safety net：`createSession()` / `reopenSession()` 進來前先 end 所有未結束 session；`createPlotSurvey()` / `reopenPlotSurvey()` 進來前先 end 所有 active plot；新 `endAllActiveSessions()` / `endAllActivePlots()` helpers。即使任何流程繞過 `recordCreate.ensureNoConflictingActive`，DB 層也會強制單一 | ✅ |
| 9.9 | Startup-once cleanup：`src/db/cleanup.ts` 加 `enforceSingleActiveOnStartup()` — Step 1a sessions 保留 latest started_at、其他 end；Step 1b plots 保留 latest start_ts/created_at、其他 end；Step 2 跨 kind：若兩種都仍 active 則 end 較舊那邊。掛進 `initDb()` 在 migrations 跑完後立即執行；idempotent — 二次啟動或單一 active 狀態下 no-op。處理舊 build 殘留的多筆 active | ✅ |
| 9.10 | 跨平台 audit + 統一輸入/選單元件：(a) 新 `src/components/TextPromptModal.tsx` + `promptText()` imperative API + `<TextPromptHost />` 掛 root layout 取代 iOS-only `Alert.prompt`（4 處 callers：recordCreate.promptPlotid / ProjectAssignSheet 新建 / SaveSiteModal 新建專案 / plots.tsx）。(b) 新 `src/components/ActionSheet.tsx` + `showActionSheet()` imperative API + `<ActionSheetHost />` 掛 root layout：iOS 仍走 native ActionSheetIOS（HIG），Android 走 Modal bottom sheet。取代全部 10 處 ActionSheetIOS + 1 處 taxonomy 3-button Alert（之前 Android fallback 部分功能缺失或退化）：_layout PlusButton 長按 6 選 / createChooser / 樣區類型 / 照片來源 / sites 匯出 4 格式 / map 基底地圖 / map 繪製模式 / session 空間選單 / session 排序 / session record 長按 / taxonomy 物種長按。(c) CLAUDE.md 新增 Mobile section 列入這套跨平台規則；用詞「導航」一律改「導覽列」 | ✅ |
| 9.11 | Backend: Google Sheets 檢索表 import（Phase 3.5 Step 3）：`backend/services/key_sheet_import.py`（gspread + google-auth；service account 走 `GLORIA_GOOGLE_CREDENTIALS` env var）+ requirements.txt 加 `gspread==6.2.1 google-auth==2.52.0`。Sheet schema：一 spreadsheet = 一 family，`meta` worksheet 為 column-orient header 提供 scope_rank/name/cname/source；每個 key worksheet 名稱即 scope Latin 名（`aceae` → family，否則 genus），header `id\|description\|target/couplet`；同 id 連續 2 row = A/B（3 row+ warning）；target 純數字 → next；含 CJK → split 學名 + 俗名；學名 lowercase 開頭時自動 prepend default_genus（從首個大寫 token 或 worksheet 名稱推導）。TaiCOL 自動 join 補 taxon_id + scope_cname；同 spreadsheet 重 import 自動覆寫。卷柏屬 Selaginella 20 couplets / 21 sciname 全 resolve 跑通 | ✅ |
| 9.12 | Splash 改善：(a) `_layout.tsx` module-level `SplashScreen.preventAutoHideAsync()` + `DBProvider` finally `SplashScreen.hideAsync()`，cold start 整段都顯示同一張 splash，視覺連貫不再分段（先 Expo splash → 白屏 spinner）。(b) `DBProvider` 加 progress text，依照 initDb 各階段顯示「準備物種資料庫... / 解壓縮... / 開啟資料庫... / 更新資料結構... / 清理狀態... / 載入偏好設定... / 載入當前記錄...」。(c) `initDb(onProgress?)` 加 callback 參數讓 host 顯示 step text | ✅ |
| 9.13 | Records 列表上方統計 stale 修：上方 `名錄 N · 樣區 M` 與 filter chip count 改 keyed by useState（`reload()` 內同步 setCounts），不再 inline IIFE 在 render 內 call DB。刪除 plot/session 後統計即時更新 | ✅ |
| 9.14 | iOS Modal 巢狀 / IME-active crash 修正：(a) `ProjectAssignSheet.handleCreateInline` 與 `SaveSiteModal.handleCreateProjectInline` 內嵌「新建專案」流程改 dismiss-await-present pattern（`onCancel()`/`setShowProjectPicker(false)` → `await setTimeout(350)` → `promptText()`），避免 iOS UIKit「present on already presenting」crash。(b) 搜尋物種開 Modal 時 IME composition 仍 active 會 crash：`SpeciesSearchPanel` / `session/[id]` long-press / `PlotSpeciesTab.handleSelect` 三處在 `setActive` / `setSearchPreview` / `setModal` 前都先 `Keyboard.dismiss()` + iOS 等 150ms。同一 dismiss-then-present pattern | ✅ |
| 9.15 | 中文輸入搜尋 Hermes GC `_newChunkAndPHV` EXC_BAD_ACCESS 修正：根因是 bundle DB 缺 `cname_fuzzy_index` table（後續更新 keys 時 build pipeline 沒一併重 build fuzzy index），fuzzySearch 每次 query 在 exact 結果 < 5 時 throw `no such table`，未捕獲例外在 setTimeout 內反覆觸發 destabilize Hermes 直至 GC 崩潰。修正：(a) 跑 `backend/scripts/build_mobile_fuzzy_index.py` 重 build bundle DB 的 fuzzy index (62809 cnames)。(b) `fuzzy.ts` 加 sqlite_master 偵測 + try/catch，缺表時優雅退場（cnameIndexMissing flag 避免反覆探測）。(c) `searchWithFuzzyFallback` 拆兩段 try/catch — fuzzy 失敗仍回 exact。(d) `SearchBox` debounce setTimeout 包 try/catch，defense in depth。bundle DB hash 因此改變，下次冷啟動 `ensureTaicolDb` 會自動 re-copy | ✅ |
| 10.0 | Step 5-1：Mobile dichotomous key 離線版。`src/db/keys.ts` query helpers（listIdentificationKeys / getIdentificationKey / listKeyCouplets / indexCoupletsByNumber / getKeyTaxonInfo）+ `src/db/search.ts` 加 `searchByTaxonId` 供 terminal taxon 開 LookupResultSheet。新 `KeyListView`（物種 tab segment）顯示所有 keys（scope 名 + cname + source）。新 `app/key/[id].tsx` full-screen runner：水平 ScrollView breadcrumb（`flexGrow: 0` 防搶垂直空間）+ 步進式 couplet UI（LeadButton 顯示 A/B 描述 + LeadPreview「→ 檢索條件 N」 / unresolved → rawText / terminal → ScientificName + cname）+ TerminalTaxonCard（紅皮書/IUCN/CITES/保育類 chip，redlistTone helper 統一配色、strip `N` 前綴）+ Pressable 整張卡開 LookupResultSheet 詳細資訊（內部連 TaiCOL）。所有 DB query 移到 `useEffect` 預 fetch 進 `taxonCache: Map`（避免 render-time sync DB call 觸發 SIGABRT，`recursivelyTraversePassiveMountEffects` 無限遞迴）；LeadPreview 走 `useMemo`。文案 zh-TW：「檢索條件 N」（非 Couplet）、「檢索完成」（非定種完成）、「→ 檢索條件 N」 | ✅ |
| 10.1 | Bundle DB 更新流程定型：`Makefile` 加 `mobile-db` target（`cp backend/twnamelist.db mobile/app/assets/db/twnamelist.db` + 立即跑 `backend.scripts.build_mobile_fuzzy_index`），把 fuzzy index 重 build 綁進 bundle 更新流程，避免 9.15 事故重演。`CLAUDE.md` Mobile section 新增「Bundle DB 更新流程」說明 fuzzy index 是 mobile-only table（backend 自己沒有）、何時要跑、漏跑會 Hermes crash。Memory 新增 `project_mobile_bundle_db.md` 跨 session 提醒 | ✅ |
| 10.2 | 移除錯誤的 Selaginellaceae 科 dichotomous key（id=1，Step 1 早期 PDF 解析測試產物，內容全錯）：DELETE from key_couplets WHERE key_id=1 (15 rows) + identification_keys WHERE id=1 + VACUUM。重 `make mobile-db` 同步 bundle DB。保留 id=2 卷柏屬 key（Sheets import 跑通的版本） | ✅ |
| 10.3 | 正規深淺色系統：(a) `tailwind.config.js` 加 `darkMode: 'class'`，啟用 NativeWind class-based 切換；新 `src/hooks/useThemeSync.ts` watch `settings.theme` (light/dark/auto) + system colorScheme → resolve effective scheme → 透過 NativeWind `setColorScheme()` 推進 root provider；新 `src/hooks/useThemeColors.ts` 提供 RN 原生 prop 用 hex（placeholder/icon）。(b) `_layout.tsx` 拆出 `ThemedShell` 子元件（DBProvider 內部）讓 useThemeSync 能讀 settings store；ThemeProvider value 與 StatusBar style 都改吃 effective scheme（StatusBar 從 `auto` 改 `dark`/`light` 明示，修正白底/深色時間電池看不見）。(c) settings 頁早就有「外觀」radio（淺色/深色/跟隨系統），現在 store 接通即生效。(d) 三輪 Python 腳本 sweep 把 41 個檔案 `bg-white` / `text-gray-900` / `border-gray-100` 等 light-mode hardcode 加上 `dark:` 對應（總共 +684 variants）：bulk neutral + active state press + accent chip。Negative lookbehind 避免重複套用、idempotent re-run safe。(e) `Tailwind` 配色決策：bg-white → bg-gray-900；bg-gray-50 → bg-gray-950；text-gray-{700-900} → text-gray-{100-300}；accent-50 → accent-950/40；accent-100 → accent-900/60；solid accent-{500,600,700} 保留原色 | ✅ |
| 10.4 | 深淺色 follow-up 修正：(a) `LookupResultSheet` / `SpeciesDetailSheet` / `SpeciesCard` 三處的 `Tag` / `statusColor` 用 `cls.split(' ')[0]` / `[1]` 取 bg+text class — 在 dark pass 後 string 變長索引指到 `dark:bg-...` 導致「特有/原生/IUCN chip」文字錯位看不見。改成回傳 `{ bg, text }` typed pair，索引拿掉。(b) DBH stem chip（PlotSpeciesValueModal）`text-blue-800` 在深色背景看不見：抽出 `DbhStemChip` 元件，文字 `text-blue-800 dark:text-white`，close icon 走 `useNwColorScheme` 動態切換 `#1e40af` ↔ `#ffffff`。(c) Fuzzy search 無視 group filter — `fuzzy.ts` 收 `group` 參數但 SQL `SELECT * FROM taicol_names WHERE name_id IN (...)` 沒帶 group 條件，「維管束植物」篩選只對 exact search 生效，fuzzy fallback 撈出昆蟲。`TAXON_GROUP_FILTERS` 從 `search.ts` export 後 fuzzy 重用，SQL 補上 `AND "phylum"=?` / `AND "kingdom"=?` 條件 | ✅ |
| 10.5 | KeyListView 改進（方案 B step 1）：搜尋 box + 階層 chip 多選 + 每階層 live count。chip 排序按 taxonomic depth（class→order→family→subfamily→tribe→genus），未來新增 rank 直接寫進 `RANK_ORDER` array。搜尋對 `scope_name` + `scope_cname` 做 substring match。空結果有 empty state + 「清除篩選」按鈕。屬名（Selaginella）改用 `ScientificName` 走斜體；新增 `isItalicRank()` helper（family / order 不斜體）。`KeyListView` 拿掉 source citation 行（密度太高），改放 `app/key/[id].tsx` runner 內 ScrollView 底，small muted text 加可選取。Step 5-2 之前先用簡版 chip filter，等真有第三維度（來源/區域）再升級成 `FilterDimension` sheet。Runner source citation strip `(Sheets:<id>#<worksheet>)` 後綴只留可讀標題 | ✅ |
| 10.6 | Sheets import parser 支援「混合屬+種」key（小科常見格式）：`backend/services/key_sheet_import.py` 加 `_chain_orphan_subtrees()` post-process。演算法 — (1) 蒐集所有 forward arrow 的目標 couplet 編號為 incoming set，(2) 找出 incoming set 外（且非 root #1）的孤兒 couplet，(3) 對每個孤兒計算 reachable scinames、檢查是否共用同一個 first-token（genus），(4) 走過每個 lead，若 target 是 single-token sciname（genus 終點）且與某孤兒的共用 genus 相符，就 retarget 成 forward 進去那個 couplet。樺木科 Betulaceae 範例（Alnus / Carpinus 混合）驗證通過：1.A 'Alnus' → couplet 2、1.B 'Carpinus' → couplet 3。Mixed-genus 孤兒（不同 genus 混在同一 subtree）會 skip，不會誤接 | ✅ |
| 10.7 | Step 5-2：Subkey chain UX。新 `findSubkeyForTaxon(taxonId)` helper（`src/db/keys.ts`）— 查 taxon row 取 simple_name + rank，依 `RANK_TO_SCOPE`（Family/Subfamily/Tribe/Genus/Subgenus）找 `identification_keys` 同 scope_name + scope_rank 匹配。Runner（`app/key/[id].tsx`）effect 內 pre-fetch `subkeyCache: Map<taxonId, IdentificationKey | null>`（同 `taxonCache` 模式避免 render-time DB call），自動 skip self-link（屬 key terminal 指回自己會被排除）。`TerminalTaxon` 元件新增 `subkey` / `onOpenSubkey` props，在物種卡下方顯示藍色「續查 X 屬內檢索表」按鈕（icon + scope_name 斜體 + cname + chevron）。按下 `router.push(/key/{sub.id})` push 子 key 進 navigation stack（back gesture 自然回上層）。`subkeyRankLabel()` helper 依 scope_rank（family/subfamily/tribe/genus/subgenus）動態取中文 label。驗證：Fagaceae key 三個 genus 終點（Quercus / Castanopsis / Lithocarpus）全成功 chain；species 終點與單屬 Selaginella key 不顯示按鈕 | ✅ |
| 10.8 | Step 5-3：Smart routing — key 定種終點直接加入當前記錄。Runner 加 `addTaxonToActiveRecord(taxonId, taxon)`：(1) active plot 優先：依 `plot_type` 決定 layer（transect→`'T'` / fixed→`'E1'`），開 `PlotSpeciesValueModal` 讓使用者輸豐度後 `addPlotSpecies` 寫入。(2) 否則 active session：`isTaxonInSession` 重複檢查 → `addRecord` → toast「已加入 ... 前往」action。(3) 無 active：呼叫 `useActiveSession.start()` 自動建一筆新名錄再 addRecord。`useEffect(refreshActiveSession + refreshActivePlot)` 進 runner 即同步最新 active 狀態。`TerminalTaxon` 新增 emerald primary 按鈕 `AddToActiveRecordButton`，依 `addTarget`（'plot'/'session'/'new-session'）切換 label / subtext：「加入目前樣區（下一步輸入豐度）」/「加入目前名錄」/「建立新名錄並加入」。LookupResultSheet 的「加到當前 session」按鈕也接同一個 smart routing。unresolved taxon（KeyTaxonInfo 為 null）路徑早 return，不顯示加入按鈕，避免 ghost record | ✅ |
| 10.9 | 「跳過此條件看候選」野外便利功能（方案 A）：couplet 不確定 / 沒觀察到性狀時可一鍵查看當前以下所有可達物種，直接挑要的。實作 `enumerateReachableTerminals(startCouplet, byNumber, taxonCache)` 純函式 DFS 列舉，每個候選含 `trace: TraceStep[]`（`{coupletNumber, lead, text}`，per-call `visited` set 防 cyclic key）。Runner `useMemo` 計算 `reachable` 不重做。`CoupletView` 右上加灰色 chip「不確定？看候選 (N)」，點開 `CandidatesSheet` bottom modal（80% 高度、SafeArea、handle bar）。候選按 cname/sciname 字典序排列；每筆顯示 cname 粗體 + sciname 斜體 + 科；底下灰底 box 列出**每一步 trace 的特徵描述**（`{coupletNum}{Lead}` 編號 + 全 lead text，numberOfLines=2 截斷過長），讓使用者一眼掃過判斷哪個 terminal 跟手上樣本最像。tap → `jumpToReachable`：自動 expand `state.path` 補入 trace.slice(1) 的 couplet 編號（trace[0] 是當前），設 terminal。回上一步、breadcrumb tap、重來都自然運作（state machine 不變） | ✅ |
| 10.10 | Breadcrumb 視覺強化 + 長按 popup（方案 A）：(a) 首位加灰色 chip「第 N 步」讓使用者隨時知道進度。(b) 當前步用 emerald-500 背景顏色強調（括號 redundant 已移除）。(c) 任意步驟長按 `delayLongPress={300}` → 中央 `CoupletPreviewPopup` modal（fade 動畫、半透明 backdrop tap 關閉、內 Pressable 阻止 propagation），顯示該 couplet 的 A/B lead 描述（A/B 圓型 badge + 全文 selectable）。state 模型沒動，純 UI 強化、無風險。完整 horizontal ScrollView 自動處理過寬路徑 | ✅ |
| 10.11 | KeyListView 搜尋優化：debounce 150ms（query input 跟 filter 解耦，CJK IME 連打不會每 keystroke 重建 FlatList data）+ `useMemo` rows array（FlatList data 穩定引用避免整列重 render）+ `useCallback` toggleRank / clearAllRanks / clearAllFilters / renderRow / handlePickKey（穩定 callback 配 React.memo）+ `React.memo` 包 `RankChip` / `KeyRow` / `SectionHeader`（不相關 row 不重 render）+ FlatList `initialNumToRender:10 / maxToRenderPerBatch:6 / windowSize:5 / removeClippedSubviews`。RankChip 改吃 `rank` prop 由 parent stable callback dispatch，避免每 render 一個新 closure | ✅ |
| 10.12 | 物種搜尋 SearchBox / TaxonomySearchBox 全面優化（242k row TaiCOL 是 app 最肥的查詢）：(a) debounce 150→250ms，CJK IME 連打不會多次觸發 SQL full table scan。(b) Module-scope LRU result cache（key=`${q}|${group}`，FIFO 20 entries），擦字回頭時不重打 SQL。(c) SELECT 改用 `SEARCH_COLUMNS`（33 欄）取代 `SELECT *`（70 欄），JSI marshalling 直接砍半。`search.ts` export `SEARCH_COLUMNS`，`fuzzy.ts` / `searchByTaxonId` / 同物異名 resolve query 全部沿用。(d) `prewarmFuzzyIndex()` public API 加在 `fuzzy.ts`，`DBProvider` `setReady(true)` 後 `setTimeout(0)` off-critical-path 載入 62k cname 索引，第一次中文搜尋不再付 ~200-500ms cold-load 成本。(e) `AutocompleteRow` 用 React.memo 包；FlatList 加 `initialNumToRender / maxToRenderPerBatch / windowSize / removeClippedSubviews` 渲染窗口。TaxonomySearchBox 同步加 debounce 250ms / try-catch / memo / FlatList 窗口設定。註：最初版本有 min 2 字限制，後因芒、櫸、桑等單字植物俗名需求移除 | ✅ |
| 10.13 | Lauraceae 樟科檢索表 Sheets 匯入（spreadsheet `1MuQ...`，source 臺灣維管束植物野外鑑定指南）。10 個 worksheet（1 family + 9 genera + Hernandiaceae）、67 couplets。Dry-run 自動 cross-check TaiCOL 找到 5 個拼字錯誤：(1) `Camphora micranthum` → `micrantha`（屬名陰性、種小名應陰性）。(2) `Cinnamomum burmanii` → `burmannii`（少 n）。(3) `Litsea morrisoensis` → `morrisonensis`（少 n）。(4) `Machilus obovatifolia var. taiwitensis` → `taiwuensis`。(5) `Neolitsea busanensis fo. sutsuoensis` → `buisanensis`（少 i，與同表 3A 拼法不一致）。使用者修 sheet 後重 import，全部對應 TaiCOL accepted name；另補完 Machilus 6A 原本的空 lead，指向 `Machilus zuihoensis var. mushaensis`（青葉楠）。最後 `make mobile-db` 同步至 mobile bundle DB（123MB）+ 重 build cname_fuzzy_index（62,809 cnames） | ✅ |
| 10.14 | Desktop TaiCOL import 加 stale taxon_id 自動檢查（warn-only，無 UI 動）。使用者問題：每次重新匯入 TaiCOL，既有檢索表 KeyCouplet 內的 `lead_*_target_id` 是 VARCHAR 非 FK，可能引用到已被合併 / 刪除 / 升降級的舊 taxon_id，schema 不會壞但 mobile 顯示 terminal 時 join 失敗。`backend/services/taicol_import.py` 新增 `_check_stale_key_taxon_ids()`：CTE SQL 一次掃 `key_couplets.lead_a/b_target_id` + `identification_keys.scope_taxon_id`，找出 `taicol_names` 不存在的 taxon_id，回傳 `{total_stale_couplets, total_stale_scope, by_key: [...]}`。`import_taicol_csv()` 末尾呼叫並把結果加到 return dict 的 `stale_key_taxon_refs`。CLI `__main__` 末尾條件式 print 警告 + 列出受影響 keys 與 couplet（含修補建議：修 sheet → re-import key → make mobile-db）。`admin_api.upload_taicol` response 加 `stale_key_taxon_refs` + `logger.warning` 統計（admin UI 暫不動）。Smoke test 注入 dummy stale 偵測正確、API contract 不破壞 | ✅ |
| 10.15 | 檢索表外包流程準備：(a) 把 backend DB 內維管束植物 (Tracheophyta + 在台 + accepted) 全部 74 個 Order 整理進 IdentKey List sheet (`1m8C...`)。前 8 row（3 class + 4 既有 order）補 taxonID（B2:B8）；70 個新 order append 在 row 10-79，跳過 row 8/9 保留使用者 prefill 的 URL；row 80-1002 prefill row 不動。計數演算法：`phylum=Tracheophyta + is_in_taiwan + usage_status=accepted`，species_number 含種下階層（Subspecies/Variety/Form/Subform/Race），對使用者既有 4 row 數字 (110/100/92/539) 100% match。(b) `backend/scripts/copy_sheet_template.py` helper script：原本要做 `drive.files().copy()` 自動複製 template + transfer ownership，但 GCP service account 對 consumer Gmail 場景無 Drive storage quota（throw `storageQuotaExceeded`），且 cross-domain ownership transfer 不被支援，因此主用途改為 verify mode：給定 sheet ID 印出 owner / SA 權限角色 / worksheet 結構，確認 SA 已被加 Editor、schema 對得上 `key_sheet_import.py`。`--copy` mode 程式碼留供將來 migrate Workspace + Shared Drive 場景用。`requirements.txt` 加 `google-api-python-client==2.196.0` | ✅ |
| 10.16 | PDF → Apiales sheet (1YeOQ...): 15 worksheets, 63 couplets, 0 unresolved (使用者修 Pimpinella tagawai → tagawae 後仍是 TaiCOL orphan record，無 taxon_id 無 status，保留為純 unresolved)。Apiaceae 18 couplets + 7 屬 key, Araliaceae 10 couplets + 5 屬 key, Pittosporum (單屬科改用屬名 worksheet 全簡寫) 5 couplets。PDF typo 已修：Aralia bipinnatata → bipinnata、Hydrocotyle bengtuensis → benguetensis、di-chondroides → dichondroides。Import backend DB (key id 30-44)，1m8C row 5 done=TRUE | ✅ |
| 10.17 | PDF → Pinopsida 松綱 sheet (1lxBK...): 9 worksheets, 31 couplets, 0 unresolved。Pinopsida 科檢索表 4 couplets (5 科入口 + Cycadaceae 1 屬 1 種直接寫成 Cycas taitungensis species terminal)；Cupressaceae 5/Chamaecyparis 1/Juniperus 3, Pinaceae 5/Abies 1/Pinus 5, Podocarpaceae 5, Taxaceae 2。PDF typo 已修：Pinus armandii var. masteriana → mastersiana, ×hayatana (no space) → Pinus × hayatana (spaced ×)。schema 限制：parser 無 class rank，worksheet 名 "Pinopsida" 被識別為 genus，scope_rank 略不準 (本質是 class) 但 import 內容對。Import backend DB (key id 45-53)，make mobile-db sync OK，1m8C row 4 done=TRUE。Pending：Lycopodiopsida 石松綱 (1luQ...) + Polypodiopsida 水龍骨綱 (1gQ1...) source 是另一本書「臺灣石松類與蕨類全圖鑑上下冊」，使用者尚未提供該 PDF | ✅ |
| 10.18 | PDF → 3 個小型 order: (a) Acorales 菖蒲目 (17biMK...) Acorus 1 couplet 2 變種, key id 54; (b) Aquifoliales 冬青目 (1A_hkC...) Ilex 24 couplets 25 種, 修 PDF typo `loniceriifolia` → `lonicerifolia` (Lonicera 屬連接元音雙 i 為 PDF 排版錯誤), 三個單種 family (Cardiopteridaceae/Helwingiaceae/Stemonuraceae) 各 1 屬 1 種無 key 可建跳過, key id 55; (c) Arecales 棕櫚目 (1J839M...) Arecaceae 6 couplets 7 種 (PDF 5 屬 7 種；1m8C 標 52 屬 100 種是 TaiCOL 含 cultured/外來 inflated count，PDF 才是 key authoritative), key id 56。三個都 0 unresolved，make mobile-db sync, 1m8C row 9/11/12 done=TRUE。Pending: Alismatales 9 family / Lamiales 15 family 規模大需另起多輪。Schema gotcha: PDF 對單屬科常見「(屬中文名)」括號註記在 cname 內，sheet 寫入時統一去除避免 cname 過長 | ✅ |
| 10.19 | PDF → 7 個 order (大 + 6 個 tiny): (a) Alismatales 澤瀉目 (1JQ69B...) 20 worksheets 75 couplets, Araceae 20 屬 47 種大科檢索 + 11 個屬內 keys (Sagittaria/Alocasia/Amorphophallus/Arisaema/Colocasia/Epipremnum/Homalomena/Remusatia/Rhaphidophora/Typhonium/Xanthosoma) + Hydrocharitaceae 9 屬 + Blyxa/Halophila/Vallisneria 屬 + Potamogetonaceae/Potamogeton + 單屬 Halodule. 4 個單種科 (Aponogetonaceae/Juncaginaceae/Ruppiaceae/Zosteraceae) 跳過. PDF 10A 「合果芋#」缺 Latin 補 Syngonium podophyllum。(b) Austrobaileyales 木蘭藤目 (1uBJwn...) Schisandraceae + Illicium + Kadsura, 修 typo Kadsura heteroclita → philippinensis (TaiCOL accepted)。(c) Buxales (1kMjEU...) Buxaceae 整合 Buxus 屬內 keys。(d) Ceratophyllales (1kj5SE...) Ceratophyllum 單屬科。(e) Chloranthales (1YuZsU...) Chloranthaceae 整合屬內 keys。(f) Garryales (1MmF2y...) Aucuba 單屬科, 修 typo chinense → chinensis。(g) Zygophyllales (1Ft_Uf...) Tribulus 單屬科. 全 0 unresolved, key id 57-84, sync OK, 1m8C 7 rows done=TRUE | ✅ |
| 10.20 | PDF → 6 個 order: (a) Crossosomatales (1epHls...) Staphylea 4 種, **重要 schema 發現**: TaiCOL 已把 Turpinia + Euscaphis 屬合併到 Staphylea 屬，故 sheet 用單一 worksheet=Staphylea 含 4 種 (取代 PDF 的 Staphyleaceae 科 key + Turpinia 屬 key 雙 worksheet)；修 PDF cname typo 野鴨椿 → 野鴉椿。(b) Cornales (1Q6a7X...) Cornaceae 3 couplets + Hydrangeaceae + Deutzia + Hydrangea 9 couplets (大屬 key); Nyssaceae 1/1 跳過。(c) Nymphaeales (13plQ8...) Cabombaceae + Cabomba + Nymphaeaceae。(d) Pandanales (1n3G2z...) Pandanaceae 1 couplet + Sciaphila (Triuridaceae 單屬) 3 couplets; Cyclanthaceae/Stemonaceae 各 1/1 跳過。(e) Proteales (1iQum8...) Helicia 屬 2 couplets; Nelumbonaceae 1/1 跳過; Sabiaceae 清風藤科 PDF p.328 待補。(f) Celastrales (1icv9X...) Celastraceae 5 couplets + Microtropis 屬 key, **PARTIAL** — 其他屬 keys (Celastrus/Maytenus/Euonymus) 待 PDF p.171 補。Geraniales 跳過: PDF p.222 顯示 partial couplets 1-5 缺中段需 p.223 補完。全 0 unresolved, key id 85-97, sync OK, 1m8C 6 rows done=TRUE。Pending: Boraginales/Dioscoreales/Oxalidales/Santalales/Vitales/Piperales/Geraniales/Sabiaceae/Celastrales 部分屬 keys/Pandanaceae 屬 keys | ✅ |
| 10.21 | PDF → 3 個 medium order: (a) Geraniales (1zWSWb...) Geraniaceae 9 couplets 11 種 (補完 PDF p.222-223)。(b) Dioscoreales (11wpR8...) Burmanniaceae + Burmannia + Thismia (Burmanniaceae 3 屬) + Dioscoreaceae **16 couplets 17 種** (PDF p.384-385 大科 key, 修 synonym 寫法 `Dioscorea collettii (=Dioscorea kaoi)` 簡化為 collettii) + Aletris (Nartheciaceae 單屬)。(c) Oxalidales (1HCp4e...) Connaraceae + Elaeocarpaceae 6 couplets 7 種 + Oxalidaceae 4 couplets 5 種。全 0 unresolved, 9 keys imported (id 98-106), sync OK, 1m8C 3 rows done=TRUE。剩 medium pending: Boraginales (5 fam)/Santalales (6 fam)/Vitales (1 fam 12 屬)/Piperales (3 fam，Piperaceae 3/45 偏大)；Lamiales (15 fam 539 種) 留待用戶決定切分策略 | ✅ |
| 10.22 | PDF → Vitales + Magnoliales: (a) Vitales (13LabU...) Vitaceae 8 屬 27 種 = 8 worksheets (科 key + Ampelopsis/Cayratia/Cissus/Leea/Vitis/Tetrastigma/Nekemias 屬 keys); 修 4 typo: pterocladia→pteroclada, f. → fo., Nekemias cantoniensis var. → Ampelopsis cantoniensis var. (TaiCOL 仍用老屬 Ampelopsis，未跟 Nekemias 新屬合併)。(b) Magnoliales (13NC3T...) Annonaceae 3 屬 4 種 + Magnoliaceae 2 屬 3 種 + Myristicaceae 2 種; 修 Monoon liukiuense → Polyalthia liukiuensis (TaiCOL 仍用 Polyalthia 老屬)。**TaiCOL lag pattern**: 多次 PDF 採用較新分類 (Nekemias, Monoon) 但 TaiCOL 仍停在舊屬 (Ampelopsis, Polyalthia)，sheet 須以 TaiCOL 為準才能 cross-check 通過。全 0 unresolved, 11 keys imported (id 107-117), sync OK, 1m8C 2 rows done=TRUE | ✅ |
| 10.23 | PDF → 5 個 medium-large order: (a) Liliales 百合目 (1VySKI...) 8 worksheets 含 Smilax 大屬 23 couplets 24 種 (Smilacaceae 1 屬 29 種). (b) Zingiberales 薑目 (1SA3-4...) 3 worksheets: Canna/Musaceae/Zingiberaceae 科 key; Heliconiaceae/Strelitziaceae 觀賞栽培 PDF 未列。(c) Saxifragales 虎耳草目 (1KgXKR...) 11 worksheets: Crassulaceae+Bryophyllum/Kalanchoe/**Sedum 20 couplets 30 種**, Daphniphyllaceae, Haloragaceae, Hamamelidaceae, Iteaceae, Saxifragaceae+Astilbe/Chrysosplenium; 修 typo Sedum triangulosepalum→triangulisepalum, truncatistigma→truncatistigmum, Daphniphyllum x lanyuense → × lanyuense (× hybrid 需完整寫 Latin 因 parser 不 prepend default_genus 對非 lowercase 起首)。(d) Solanales 茄目 (1GyAQt...) 7 worksheets: Convolvulaceae partial 8 couplets (屬內 keys pending), **Solanaceae 科 key 12 couplets + Solanum 大屬 24 couplets** + Datura/Lycianthes/Nicotiana/Physalis 屬 keys。(e) Ranunculales 毛茛目 (10npX3O...) 5 worksheets PARTIAL: Berberidaceae 科 key, Lardizabalaceae 完整, Menispermaceae 科 key (修 typo Pericampylus formoxanus→formosanus), Papaveraceae 科 key, Ranunculaceae 科 key 10 couplets。**Schema gotcha**: × hybrid 必須寫完整 `Genus × epithet` (parser 不 prepend) 。全 0 unresolved, 34 keys imported, sync OK, 1m8C 5 rows done=TRUE | ✅ |
| 10.24 | Dead-end 補完: 21 屬 dead-end (target=genus 但無 sub-key) → **3 殘留**。**Ranunculales (12 屬)**: Berberis (13 種), Mahonia (3), Clematis (24, 大屬), Ranunculus (13), Thalictrum (7), Anemone (2), Aconitum (2), Corydalis (11), Fumaria (2), Stephania (7), Cyclea (3), Cocculus (2)。**Celastrales (3 屬)**: Celastrus (4), Euonymus (11, **TaiCOL 已把 Glyptopetalum 併入 Euonymus** sheet 改寫 Latin), Maytenus (2)。**Solanales/Convolvulaceae (4 屬)**: Argyreia (3), Cuscuta (5), Evolvulus (2), Ipomoea (大屬 26 couplets ~28 種); 順便補 Convolvulaceae 科 key 完整 13 couplets 14 屬。**Zingiberales (3 屬)**: Alpinia (大屬 17 couplets, **× hybrid 5 個依 schema rule 寫完整 `Alpinia × xxx`**), Curcuma (2), Zingiber (7)。修 11 typo: Berberis tarokensis→tarokoensis/schaalise→schaaliae/Mahonia morrisoensis→morrisonensis 等。共 39 keys imported, mobile-db synced。**殘留 3 dead-end**: Merremia 4/Jacquemontia 3/Lepistemon 3 (Convolvulaceae 栽培外來屬, PDF 未提供屬 key) | ✅ |
| 10.25 | Lamiales 13/14 family (方案 A 從小到大): **Batch 1** (Mazaceae/Paulowniaceae/Phrymaceae/Lentibulariaceae/Linderniaceae 修 Bonnaya ruelloides→ruellioides/Scrophulariaceae)。**Batch 2** (Verbenaceae/Oleaceae 修 morrsionense→morrisonense+Osmanthus 3B 補 enervius 無脈木犀/Orobanchaceae 14 屬 + Euphrasia/Pedicularis/Striga 屬 keys)。**Batch 3** (Bignoniaceae 2 屬 2 種/Gesneriaceae ~12 屬 + Lysionotus/Rhynchotechum 修 f.→fo./Plantaginaceae partial 15 couplets + Bacopa)。**Batch 4** (Acanthaceae partial 18 couplets 19 屬 + Asystasia/Hemigraphis/Hygrophila/Hypoestes/Justicia 屬 keys，缺 Strobilanthes/Lepidagathis/Ruellia/Thunbergia/Peristrophe/Rungia 屬 keys 後續 PDF 頁待補)。共 33 keys, 0 unresolved (修 6 typo)。Pending: **Lamiaceae 唇形科 7-4** (44 屬 159 種，PDF 229+ 多 page 最大宗，留下輪) | ✅ |
| 10.26 | Mobile UI 細修: (a) **檢索表標題加下階層數**: `src/db/keys.ts` `listIdentificationKeys` SQL 加 `child_count` subquery (family→在台 distinct genus 數, genus→在台 accepted species 含種下數, class/order 與 null), Type `IdentificationKey` 加 `child_count: number \| null`。KeyListView KeyRow + key/[id].tsx screenTitle + Terminal subkey button 都顯示 `(N)`。例：Acanthaceae 爵床科 (32), Abies 冷杉屬 (2)。class scope (Pinopsida) count 為 0 自動 fallback 不顯示括號。(b) **CandidateRow 移除冗餘科名**: app/key/[id].tsx CandidateRow 之前顯示 family_c + family 在 cname/sciname 下，因使用者進入 key 已知 scope，去除 family display 改 numberOfLines。tsc --noEmit 通過 | ✅ |
| 10.27 | Lamiales dead-end 補完: **Lamiaceae 6 屬** (Salvia 11 couplets 13 種 / Scutellaria 7c 9sp / Stachys / Suzukia / Teucrium / Vitex)、**Acanthaceae 7 屬** (Justicia 補完 6c 7sp / Strobilanthes 7c 9sp / Thunbergia / Ruellia / Lepidagathis / Peristrophe / Rungia / Staurogyne)、**Linderniaceae 4 屬** (Lindernia / Torenia 8c 9sp / Vandellia / Yamazakia)、**Plantaginaceae 7 屬** (Callitriche / Deinostema / Digitalis / Limnophila 7c 8sp / Plantago / Veronica 10c 12sp / Veronicastrum)。修 1 typo (Salvia filicifolia → formosana var. matsudae 蕨葉紫花鼠尾草)。共新增 25 屬 keys。Backend 222→229 keys, 1090→1099 couplets。Dead-end (>1 種屬) 0 個。`make mobile-db` synced fuzzy index 62809 cnames | ✅ |
| 10.28 | **Asparagales A1 小科** (Hypoxidaceae/Iridaceae/Asphodelaceae): 1m8C row 28-33 補 taxonID + 修 Orchidaceae typo (Ochidacae→Orchidaceae)、row 40-51 (Caryophyllales) 補 taxonID + genus_number + species_number。Hypoxidaceae 仙茅科 3屬3種 2c (Hypoxis aurea/Curculigo orchioides/Molineria capitulata)、Iridaceae 鳶尾科 3屬7種 6c (Crocosmia × crocosmiiflora 觀音蘭 + Iris 3sp + Sisyrinchium 3sp，三屬全在 family key inline)、Asphodelaceae 阿福花科 PDF 2屬2種 1c (Dianella ensifolia/Hemerocallis fulva var. aurantiaca 橙萱; TaiCOL 5/43 含栽培)。3 sheets 刪 template worksheet。Backend 229→232 keys, 1099→1108 couplets。`make mobile-db` synced | ✅ |
| 10.29 | **Asparagales A2 中科** (Amaryllidaceae/Asparagaceae): Amaryllidaceae 石蒜科 PDF 3屬5種 4c (Crinum/Lycoris + Allium 3sp inline，TaiCOL 16/51 含栽培)。Asparagaceae 天門冬科 PDF 14屬27種 family key 13c + 8 屬 subkey: Agave 4sp 3c (修 PDF typo gigantean→gigantea)、Aspidistra 4sp 3c、Disporopsis 2sp 1c (修 fuscopicota→fuscopicta)、Liriope 3sp 2c、Maianthemum 2sp 1c、Ophiopogon 2sp 1c、Peliosanthes 2sp 1c (修 teta var. humilis→macrostegia, teta var. kaoi→kaoi)、Polygonatum 3sp 2c (修 arisanense var. chingshuishanianum→chingshuishanianum, var. arisanense→odoratum var. pluriflorum; 大屯黃精 TaiCOL 無對應，UNRESOLVED 保留)。Rohdea japonica var. watanabei → fargesii var. watanabei。共 10 keys 31 couplets。Backend 232→242, 1108→1139。Dead-end >1sp 屬: 0 | ✅ |
| 10.30 | **Caryophyllales C1 小科** (7 families): Basellaceae 落葵科 2屬2種 1c (Basella alba/Anredera cordifolia)、Droseraceae 茅膏菜科 PDF 1屬4種 3c (Drosera peltata/indica/spathulata/burmannii，TaiCOL 1/6)、Molluginaceae 粟米草科 3屬4種 3c (Glinus 2sp/Trigastrotheca stricta/Mollugo verticillata，inline)、Nyctaginaceae 紫茉莉科 PDF 3屬8種 family 2c + Pisonia 2sp 1c + Boerhavia 5sp 4c (TaiCOL 4/14)、Phytolaccaceae 商陸科 1屬3種 2c (Phytolacca 3sp)、Plumbaginaceae 藍雪科 PDF 2屬3種 2c (Plumbago zeylanica + Limonium 2sp，TaiCOL 3/7)、Portulacaceae 馬齒莧科 1屬5種 4c (Portulaca 5sp，TaiCOL 1/7)。Droseraceae 因 family scope + 單屬 + 裸種小名 target 改寫成全屬名（parser default_genus 偵測修正）。共 9 keys 22 couplets。Backend 242→251 keys, 1139→1161 couplets。Dead-end 0 | ✅ |
| 10.31 | **KeyListView UI redesign (search-first)**: 移除 grouped 全清單與 rank chip filter。新版只有 search box (bottom sticky, thumb-reachable) + ≤5 個推薦 chip (recent 優先，不足由 child_count 最大的科補滿)。輸入時 chip 隱藏給結果更多空間。效率: (a) module-level LRU cache (`SEARCH_CACHE` Map cap 20, key=lowercase trimmed query), keys 引用變更時清空。(b) lowercase haystack array `useMemo` 一次預建，filter 內層 plain for loop 不存取 IdentificationKey 物件 property。(c) 250ms debounce (從 150 提升避 CJK IME)。(d) 不設 min query length。(e) FlatList initialNumToRender=10 maxToRenderPerBatch=8 windowSize=5 removeClippedSubviews。settings 加 `key_recent_ids: number[]` (cap 10, dedupe + most-recent first)，`pushRecentKey()` 在 `app/key/[id].tsx` mount 時觸發。KeyboardAvoidingView iOS padding / Android undefined。tsc 通過 | ✅ |
| 10.32 | **KeyListView 卡頓修補**: 使用者報「記錄 tab → 物種 tab 檢索表 segment 進去時卡 1-2 s」。Profile 發現 `listIdentificationKeys` SQL 4.6 s (desktop)，主因 `taicol_names.genus` 無 index、每個 genus-scope key 的 child_count 子查詢 full-scan 242k 列。修補: (a) `backend/services/taicol_import.py._create_indexes()` + `backend/scripts/build_mobile_fuzzy_index.py.build()` 都加 `CREATE INDEX IF NOT EXISTS idx_taicol_genus ON taicol_names(genus)`，下次 import / `make mobile-db` 自動補。索引建好後 4.6 s → 1.35 s (3.4x)。(b) `KeyListView.tsx` 加 module-level `CACHED_KEYS` cache + `getCachedKeys()`，bundle DB read-only 整 session 不變，第一次 tab 進去 1.35 s，之後切換瞬間。把 `useFocusEffect(reload)` 改成 `useEffect` 一次 hydrate。tsc 通過 | ✅ |
| 10.33 | **PDF → 8 small order/family field-guide keys**: Aizoaceae 番杏科 2c 3sp / Amaranthaceae 莧科 14 屬 38sp (Achyranthes/Alternanthera/Amaranthus/Atriplex/Celosia/Chenopodium/Deeringia subkeys) / Caryophyllaceae 石竹科 13 屬 36sp (Arenaria/Cerastium/Dianthus/Drymaria/Sagina/Silene/Stellaria subkeys) / Polygonaceae 蓼科 8 屬 51sp (Fagopyrum/Koenigia/Persicaria 33sp/Polygonum/Rumex subkeys) / Commelinales 鴨跖草目 (Commelinaceae 11 屬 27sp + Belosynapsis/Callisia/Commelina/Cyanotis/Murdannia/Pollia/Tradescantia subkeys + Philydraceae 1sp + Pontederiaceae 2sp) / Dipsacales 川續斷目 (Adoxaceae 16c 17sp + Caprifoliaceae 6 屬 18sp + Lonicera/Patrinia/Valeriana subkeys) / Piperales 胡椒目 (Aristolochiaceae 2 屬 22sp + Aristolochia/Isotrema/Asarum subkeys + Piperaceae 2 屬 16sp + Peperomia/Piper subkeys + Saururaceae 2sp) / Santalales 檀香目 (Balanophoraceae 6sp + Loranthaceae/Loranthus/Taxillus + Olacaceae 1sp + Opiliaceae 2sp + Santalaceae/Viscum + Schoepfiaceae 1sp)。修 PDF/拼字 typo (Alternanthera sessile→sessilis, reinckii→reineckii, Chenopodium acuminatum subsp. virginatum→virgatum, Dianthus pygmaeus f.→fo., Silene baccifer→baccifera, Viburnum aboricolum→arboricolum, Taxillus loniceriifolius→lonicerifolius, Fallopia multiflora var. hypoleuca→hypoleucum, Persicaria capitatum→capitata)。Backend 251→306 keys, 1161→1413 couplets。1m8C row 40/41/44/50/55/60/74/79 done=TRUE。`make mobile-db` synced | ✅ |
| 10.34 | **IK pipeline 範圍紀律**: 使用者糾正：先前為了批次轉錄 8 個 sheet 寫了 `backend/scripts/fill_field_guide_keys.py`（590 行硬編資料 + 樣板 boilerplate），實際上重複 `key_pdf_import.py` / `key_sheet_import.py` 既有工具的職責。原則確立 (memory [`project-ik-import-pipeline`](.claude/memory/project_ik_import_pipeline.md))：**永久工具只有 3 支**（`key_pdf_import.py` 自動 / `key_sheet_import.py` 半自動 / `build_mobile_fuzzy_index.py` 建 fuzzy + mobile bundle）+ `copy_sheet_template.py` verify mode。PDF→Sheet 轉錄是**一次性資料工作**，可暫存 `backend/scripts/oneoff/YYYY-MM-DD_<source>.py` 跑完即刪；**禁止留作永久 module**。10.33 跑完後 `fill_field_guide_keys.py` 已刪 | ✅ |
| 10.35 | **既有 IK 直式 meta 整批修正 + post-compact audit memory**: 使用者報「落葵科 meta 填成直的，但檢索表的引用變成 sheets id」。檢查發現 11 個既有 sheet (10.30 C1 6 個 + 10.28/10.29 A1/A2 5 個) 的 `meta` worksheet 都是**直式**（row 1 = `[scope_rank, family]`、row 2 = `[scope_name, Latin]`…），`parse_meta_worksheet` 只讀 row 1 當 header / row 2 當 data，所以 `meta['source']` 是空字串，import 端 fallback 用 `Sheets:<id>#<worksheet>` 當 source。修補：(a) inline gspread 把 11 個 sheet 的 meta 重寫成橫式 `[scope_rank|scope_name|scope_cname|source|notes]`；(b) `key_sheet_import` 重 import 後 dedupe 規則是 `(scope_name, source)` 完全匹配，source 不同無覆寫，所以舊的 22 個 broken row (id 315-336) 也活著 → 直接 SQL `DELETE` 掉；(c) `make mobile-db` 同步。**memory 新增 `feedback-post-compact-audit`**：使用者明確說「下午都還做得好好的，compact 之後就忘記了，要把這個寫進 memory 中」。規則：`/compact` 後先重看 memory + 近期 Plan.md，IK import 必檢 `source` 欄位含書名（query：`source NOT LIKE '%臺灣%' AND source LIKE 'Sheets:%'`） | ✅ |
| 10.36 | **PDF → 4 more orders/family** (Boraginales/Brassicales/Cucurbitales/Cactaceae): inline gspread one-shot 寫 sheet（per memory 紀律不留永久 module）。Cactaceae 仙人掌科 3 屬 3 種 2c (Opuntia/Hylocereus/Cereus inline)。Cucurbitales 葫蘆目 = Cucurbitaceae 16 屬 24 種 14c (family) + Momordica 3sp 2c / Thladiantha 2sp 1c / Trichosanthes 6sp 5c / Zehneria 2sp 1c subkeys + Begoniaceae 22sp 21c (Begonia 一屬，含 4 個雜交 `× chungii / × buimontana / × taipeiensis` + B. nantoensis 純名) + Coriariaceae 單種科。Boraginales 紫草目 = Boraginaceae 8 屬 15 種 7c + Cynoglossum/Trichodesma/Trigonotis subkeys + Coldeniaceae/Cordiaceae/Ehretiaceae/Heliotropiaceae 多家。Brassicales 十字花目 = Brassicaceae 17 屬 35 種 16c + 9 屬 subkey + Capparaceae/Caricaceae/Cleomaceae/Akaniaceae。修 9 個 typo: Momordica charantia var. charantia → charantia (TaiCOL 無此 var.)、Begonia ×chungii→× chungii (TaiCOL 學名有空格)、×buimontana/×taipeiensis 同、×nantoensis→nantoensis (TaiCOL 純名 accepted)、formosana f. albomaculata → fo. albomaculata、Ynshania→Yinshania、Arabidopsis helleri→halleri、Cardamine hirsuta 臺灣碎米薺 → Cardamine scutata var. rotundiloba (TaiCOL accepted)。Backend 306→335 keys, 1413→1530 couplets。1m8C row 36/37/43/58 done=TRUE。`make mobile-db` synced | ✅ |
| 10.37 | **IK SOP 文件化 + cname OCR audit (10.33/10.36 sheet)**：使用者報「Zehneria 馬㾮兒 應為 馬㼎兒（U+3F0E vs U+3FAE 字形相近碼點不同），你之前都會幫我修，後來都沒了」。承認 dry-run 只 resolve sciname、**不檢 cname 字符**。Inline gspread audit 比對 sheet 全部 row 與 TaiCOL accepted `common_name_c` 的 codepoint。發現並修正：(a) **Cucurbitales** 8 個：栝樓→括樓 (栝/括 hand radical 差別，共 6 處 Trichosanthes + family 內 1 處)、馬㾮兒→馬㼎兒、木鱉子→木虌子；(b) **Boraginales** 5 個：細疊子草→細纍子草、臺灣附地草→台灣附地草 (TaiCOL 用 0x53F0)、臺北→台北、長花厚殼樹→長葉厚殼樹（Latin longiflora 但 TaiCOL 名稱用 long-leaf）；(c) **Brassicales** 7 個：凹果薺→凹果菥蓂、水芹菜→水芥菜 (Nasturtium)、拋娘蒿屬→抪娘蒿屬 (0x62CB vs 0x62AA，3 處)、鋸葉筷子芥→齒葉南芥 (Arabis serrata)；(d) **Amaranthaceae** 4 個：留蘭莧→瘤果莧 (Digera muricata)、假千日紅屬→千日紅屬 (Gomphrena)、安旱莧→安旱草 (Philoxerus wrightii)、毛蓮子草→法國莧 (Alternanthera ficoidea — TaiCOL 把 毛蓮子草 給 A. bettzickiana)；(e) **Caryophyllaceae** 4 個：小瓣卷耳→獨子繁縷 (C. parvipetalum，TaiCOL 已轉到 Stellaria monosperma var. japonica)、Cerastium 3 個 cname mismatch；(f) **Polygonaceae** 2 個：黏毛蓼→粘毛蓼、高山蓼→細莖冰島蓼 (Koenigia nepalensis)；(g) **Adoxaceae** 11 個 莢蓮→莢蒾 (Viburnum 整套，蓮 0x84EE vs 蒾 0x84BE)。共修 **41 處** cname。同時把 11.33+10.36 所有 genus subkey worksheet 轉成**裸 epithet 慣例** (`japonica 馬㼎兒` 取代 `Zehneria japonica 馬㼎兒`)。新增三條 memory：(1) `feedback-ik-sheet-conventions`（裸 epithet + cname 必對 TaiCOL）、(2) `project-ik-workflow-full`（8-stage SOP checklist，含後續維護 M1-M4）、(3) `feedback-post-compact-audit` 早已存在。Plan.md / memory 都釐清流程：分類群確認→PDF 解析→Sheet 填→dry-run→cname audit→import→sync→done 標→dead-end | ✅ |
| 10.38 | **Plantaginaceae + Convolvulaceae cname audit (existing 既有 sheet)**：續 10.37 audit 範圍擴到使用者「之前」填的 sheet。Plantaginaceae 4 處 (Veronica 4 sp 水苦蕒→水苦藚，蕒 0x84D2 vs 藚 0x85DA)。Convolvulaceae 26 處：family/genera 多處蘩→欒 (Merremia 菜蘩→菜欒、Xenostegia 戟葉菜蘩→戟葉菜欒)、鱗蕊→鮮蕊 (Lepistemon)、牽牛屬→牽牛花屬 (Ipomoea)、Solanaceae 大本炮→大本泡 (Nicandra)、Lycianthes boninensis 紅頭耳鈎草→小笠原紅絲線、秘魯→祕魯 (Physalis peruviana)、壺→壼 (Solanum rostratum)、毛柱萬桃花→萬桃花 (S. macaonense)、臺→台 (Cuscuta japonica var. formosana)、Ipomoea 4 cname (圓夢→圓萼/野→姬/甘薯→甘藷/番薯藤→番仔藤)、Merremia 整套 8 cname 對齊 TaiCOL (姬旋花→萼龍藤/金鐘藤/菜欒藤)。同 audit 也補完 Convolvulaceae 缺漏的 Jacquemontia/Lepistemon/Merremia subkeys (10.36 中斷)、修正 Taxillus var. lonicerifolius/var. longifolius cname 互換錯。Backend 從 335 → 366 keys (Convolvulaceae 重 import 補新 subkey + Sapindales 即將補)。Memory `feedback-ik-sheet-conventions` 補入「Hybrid 名稱必須完整學名 (`Citrus × aurantium`)，因 parser 只在第一字 isLowercase 時 prepend default_genus，× 符號不觸發」 | ✅ |
| 10.39 | **Sapindales 全 5 family 完整端到端 + Gomphrena dead-end 收尾**：Sapindales 無患子目 5 family/20 keys/77 couplets：Anacardiaceae 6 屬 13 種 (含 Rhus subkey 7 sp + Semecarpus 2sp)、Meliaceae 6 屬 12 種 (Aglaia 3sp/Dysoxylum 4sp/Swietenia 2sp subkey；含 樫木→椌木 (Dysoxylum hongkongense), 紅葉→紅果 cname 修正)、Rutaceae 13 屬 35 種 (Citrus/Clausena/Glycosmis/Melicope/Murraya/Skimmia/Tetradium/Zanthoxylum 8 subkey；Phellodendron aumurense → amurense var. wilsonii 修典；Citrus × aurantium 用完整學名)、Sapindaceae 9 屬 15 種 + Acer/Cardiospermum subkey、Simaroubaceae 3 屬 3 種 inline。**先 pre-query TaiCOL 取所有 cname 再寫 sheet**，0 cname 錯誤。同 turn 補 Gomphrena subkey (book p.113 開頭被忽略，2 sp G. celosioides + G. serrata) 收尾 dead-end。**Real dead-end (>1 sp) = 0**。Backend 335 → 366 keys, 1530 → 1645 couplets。1m8C row 53 done=TRUE | ✅ |
| 10.40 | **Ericales session 1 (10/13 family)**：Actinidiaceae 2屬6sp (Actinidia 5sp subkey)、Balsaminaceae 1屬5sp Impatiens inline、Diapensiaceae 1屬4var Shortia inline、Ebenaceae 1屬10sp Diospyros subkey、Lecythidaceae 1屬2sp inline、Mitrastemonaceae 1屬2var inline、Sapotaceae 2屬3sp inline、Styracaceae 2屬6sp (Styrax 5sp subkey)、Theaceae 4屬20sp (Camellia 13sp + Schima 2sp + Pyrenaria 2sp + Polyspora 1sp subkey；book typo Camellia chinmeii → chinmeiae 修正)、Pentaphylacaceae 5屬24sp (Eurya 16sp + Adinandra 3sp + Cleyera 4sp subkey)。共 18 keys。**Pre-query TaiCOL 後寫 sheet → 0 cname mismatch**（流程 SOP 見效）。Session 2 待補：Ericaceae 11屬42sp (Rhododendron 17sp + Vaccinium 9sp + 8 small genera subkey)、Primulaceae 10屬46sp (Ardisia 19sp + Lysimachia 11sp + 8 subkey)、Symplocaceae 1屬28sp Symplocos 大 subkey。Backend 366 → 384 keys, 1645 → 1717 couplets。1m8C 暫不標 done | ✅ partial |
| 10.41 | **Ericales session 2 (3/13 family + 全 order 完整)**：Ericaceae 11屬42sp (Rhododendron 17sp 大 subkey + Vaccinium 9sp + Chimaphila/Gaultheria/Lyonia/Monotropa/Monotropastrum/Pyrola small subkeys)、Primulaceae 10屬46sp (Ardisia 19sp + Lysimachia 11sp + Anagallis/Embelia/Maesa/Myrsine subkey)、Symplocaceae 1屬28sp Symplocos 大 subkey。共 18 keys。**Pre-query TaiCOL** 修 3 typo: Rhododendron hyptosanthum → hyperythrum (南湖杜鵑)、R. noriakiamum → noriakianum (細葉杜鵑)、Ardisia brevicaudis → brevicaulis (屯鹿紫金牛)。Post-import audit 修 2 處 cname：Rhododendron 杜鵑屬 → 杜鵑花屬、Anagallis 琉璃繁縷屬 → 珍珠菜屬 (TaiCOL 把 Anagallis 列為 珍珠菜屬，現代分類已併入 Lysimachia)。Monotropastrum 屬在 TaiCOL 是 Genus row 但 usage_status=NULL 無 taxon_id (parser warning，但 chain orphan subtree 接 Monotropastrum subkey 後仍可用)。Backend 384 → 402 keys, 1717 → 1831 couplets。Real dead-end (>1 sp) = 0。1m8C row 31 done=TRUE。`make mobile-db` synced | ✅ |
| 10.42 | **Rosales session 1 (5/7 family)**：Cannabaceae 4屬10sp (Celtis 5sp + Trema 3sp subkey)、Elaeagnaceae 1屬9sp Elaeagnus subkey、Rhamnaceae 6屬20sp (Berchemia 5sp + Rhamnus 8sp + Sageretia 3sp + Ventilago 2sp subkey)、Ulmaceae 2屬3sp inline、Moraceae 7屬47sp (含 Ficus 37sp 大 subkey + Fatoua/Broussonetia/Artocarpus 各 2sp subkey)。共 16 keys。**Pre-query TaiCOL** 修 7 typo: Berchemia racemose→racemosa (大黃鱔藤)、Ficus sarmentosa var. niponica→nipponica (珍珠蓮)、Ficus tannoensis var. rhombifolia→fo. rhombifolia (菱葉濱榕)、Ficus fistulosa f.→fo. benguetensis (黃果豬母乳)、Ficus formosana f.→fo. formosana/shimadae (天仙果/細葉天仙果)、Ficus pubenervis→pubinervis (綠島榕)。Post-import audit 修 2 處 cname：Rhamnus chingshuiensis var. chingshuiensis 清水山鼠李→清水鼠李、Moraceae Fatoua 屬 cname 水蛇麻屬→水蛇藤屬 (TaiCOL 屬名用藤但物種用麻 — 跟 TaiCOL)。Backend 402 → 418 keys, 1831 → 1916 couplets。Session 2 待 Urticaceae 23屬70sp (family key 25 couplets + 11 subkey)，Session 3 待 Rosaceae 24屬122sp (Rubus/Photinia/Cotoneaster/Prunus/Potentilla 等大 subkey)。1m8C 暫不標 done | ✅ partial |
| 10.43 | **Rosales session 2 (Urticaceae)**：23 屬 70 種，family key 25 couplets + 10 個 genus subkey: Boehmeria 12sp、Dendrocnide 2、Elatostema 17sp 大 subkey、Gonostegia 3、Laportea 3、Oreocnide 2、Pellionia 2、Pilea 14sp 大 subkey、Pouzolzia 4、Urtica 2 + 13 個單種屬 inline (Poikilospermum/Nanocnide/Girardinia/Debregeasia/Leucosyke/Maoutia/Pipturus/Procris/Parietaira/Lecanthus/Cypholophus/Droguetia/Chamabainia)。共 11 keys。**Pre-query TaiCOL** 修 4 typo: Boehmeria kwaliensis→hwaliensis (花蓮苧麻)、Elatostema lineatum→lineolatum var. majus (冷清草)、Pouzolzia sanguinea→elegans (TaiCOL 用 P. elegans 給 水雞油)、Urtica taiwana→taiwaniana (臺灣蕁麻)。**Post-import audit 0 cname mismatch** (pre-query SOP 又見效)。Backend 418 → 429 keys, 1916 → 1988 couplets。Session 3 待 Rosaceae 24屬122sp (Rubus 30+sp / Photinia 10 / Cotoneaster 10 / Prunus 15 / Potentilla 8 等大 subkey) | ✅ partial |
| 10.44 | **Rosales session 3 (Rosaceae) + Rosales 全完整**：Rosaceae 24 屬 122 種，family key 23 couplets + 11 大 subkey (Spiraea 6 / Cotoneaster 10 / Duchesnea 2 / Eriobotrya 2 / Malus 2 / Osteomeles 2 / Photinia 10 / Potentilla 8 / Prunus 15 / Pyrus 2 / Rhaphiolepis 3 / Rosa 8 / Rubus 38)。共 14 keys。**Pre-query TaiCOL** 修 4 typo: Spiraea hayatae→hayatana (假繡線菊)、Spiraea takataensis→tatakaensis (塔塔加繡線菊)、Eriobotrya deflexa f.→fo. deflexa/buisanensis (山枇杷/武威山枇杷)、Rubus × parvifraxinifolius 用完整學名（hybrid 規則）。Post-import audit 修 13 處 cname (Cotoneaster 鋪→舖 5 處、梅子→栒子 5 處、Cotoneaster 屬名同、Prunus pogonostyla 庭李→庭梅；Rubus niveus 紅刺刺藤 與 R. incanus 同 taxon 但保留書名 — TaiCOL 把 R. niveus 列為 misapplied 指向 incanus)。Backend 429 → 443 keys, 1988 → 2105 couplets。Real dead-end (>1 sp) = 0。1m8C row 50 done=TRUE。Rosales 全 7 family 完整 | ✅ |
| 10.45 | **花藥→花葯 全域取代**：使用者要求用 regex 統一字符。SQL 一次更新 `key_couplets.lead_a_text/lead_b_text` 14 處 花藥→花葯（DB 立即生效，mobile bundle 同步即時）。Sheet 端 inline gspread 掃 84 個 IK sheet 全部 worksheet cell，第一輪遇 ConnectionError 中斷；改成 retry pattern (APIError + ConnError + Timeout，指數退避 sleep)，resume from 20 完成。**7 sheets / 18 cells fixed**：Oxalidales 2 / Caryophyllales-Amaranthaceae 2 / Ericales 2 / Cucurbitales 4 / Austrobaileyales 2 / Geraniales 2 / Lamiales-Lamiaceae 4。DB 端已先 SQL 修，sheet 端對齊後對未來 re-import 也安全 | ✅ |

## Orchidaceae 蘭科 parsing plan

**規模**：107 屬 464 種 (不含雜交種；依 2019 臺灣蘭科植物誌 撰寫)。TaiCOL 過濾栽培後 107 屬 541 種。
**PDF 範圍**：p.418-454（書 p.392-428，~37 頁）。**Sheet ID**：`15H8szFOKhg9sAVnhzoebcSsX5uZcbu5x9q3nqYlXNqs`（1m8C row 33）。

### 6 sessions 切分
| # | 範圍 | 估計 sp | 重點 |
|---|---|---|---|
| 1 | 屬種 master key 1 個 worksheet (~150 couplets, 107 屬識別入口) + ~30 個單種屬 terminal inline | ~30 | 全 107 屬 stub 建好；後續 5 sessions 只填 subkey |
| 2 | Bulbophyllum 豆蘭屬 (~30 sp 大 subkey) + Dendrobium/Pholidota/Coelogyne/Pleione/Eria/Liparis/Malaxis (樹蘭亞科 epiphytes 第一批) | ~70 | Epiphyte cluster I |
| 3 | Vandeae 萬代蘭族 (Phalaenopsis/Vanda/Cleisostoma/Gastrochilus/Thrixspermum/Holcoglossum/Schoenorchis/Acampe/Trichoglottis 等) | ~80 | Epiphyte cluster II |
| 4 | Goodyerinae 鳥巢蘭族 (Anoectochilus/Cheirostylis/Goodyera/Hetaeria/Erythrodes/Kuhlhasseltia/Zeuxine/Myrmechis) + Spiranthes/Tropidia | ~80 | 蘭亞科地生小屬群 |
| 5 | 大型地生屬 (Habenaria/Platanthera/Peristylus/Calanthe/Phaius/Cymbidium/Acanthephippium/Tainia 等) | ~100 | 蘭亞科 + 部分樹蘭亞科地生大屬 |
| 6 | 異營/真菌寄生 (Gastrodia/Galeola/Cyrtosia/Lecanorchis) + 單屬中型 (Bletilla/Spathoglottis/Vanilla/Corybas) + 收尾 + 1m8C done | ~100 | 真菌寄生群 + 散落屬 + cleanup |

### Workflow per session（per memory `project-ik-workflow-full`）
1. 讀對應書頁 (Read PDF pages)
2. **Pre-query TaiCOL** 取所有 sciname 的 cname（catch typo 在 push 前）
3. Inline gspread 寫入 sheet 對應 worksheet（meta 橫式 + bare-epithet 慣例 + hybrid 完整學名）
4. Dry-run 確認 0 UNRESOLVED；修剩餘 typo
5. Real import → DB
6. Post-import audit cname vs TaiCOL → 修 mismatch
7. （Session 1-5）暫不 sync mobile / 不標 done；（Session 6）`make mobile-db` + 1m8C row 33 done=TRUE

### 注意事項
- 蘭科現代分類變化大：許多舊屬名 TaiCOL 列為 not-accepted/misapplied，會 fallback resolve 到新屬。書內 sciname 直接寫，parser fallback 處理。
- "(部分)" 註記：書內 master key 把同一屬切到不同 couplet 區別形態時加 "(部分)"；sheet 內保留 inline 全名（e.g. `Odontochilus (部分)`），parser 仍能 resolve。
- Hybrid 名稱必寫完整學名（per memory `feedback-ik-sheet-conventions`），裸 epithet 不能用於 hybrid。
- 不更新 mobile bundle 直到 session 6 完成（避免 mid-session 卡頓）。

| 10.46 | **Orchidaceae session 1 (master key)**：屬種 master key 117 couplets，107 屬全部 stub 建好（subkey-bound 60+ 屬作 genus terminal、單種屬約 47 個 inline 完整）。Pre-query TaiCOL 修 1 typo (Stigmatodactylus shikokiana→shikokianus 絲柱蘭)。Post-import audit 修 14 處 genus cname：Cymbidium 蕙→蘭蕙(3處)、Liparis 羊耳蘭→羊耳蒜(2處)、Thrixspermum 風鈴蘭→風蘭、Papilionanthe 假萬代→台灣萬代、Pinalia 小精靈→蘋蘭、Anoectochilus 金線蓮→開唇蘭、Cephalantheropsis/Styloglossum→根節蘭(TaiCOL 把多屬合併同 cname)、Acanthephippium 罈→罎、Oeceoclades 南洋芋→僧蘭、Pogonia minor 小髯唇→小鬚唇蘭。Backend 443→444 keys, 2105→2222 couplets。Session 2 起接 genus subkey | ✅ |
| 10.47 | **Orchidaceae session 2 (B–E genus subkeys)**：補 20 屬 subkey ─ Bulbophyllum 31c (32sp+var)、Calanthe 11c (12sp)、Cephalantheropsis 3c (4sp，TaiCOL 已併入 Calanthe，worksheet 名保留 Cephalantheropsis 讓 master 鏈接，target 用 full Calanthe X)、Cheirostylis 12c (14sp，1 dead lead: tortilacinia var. wutaiensis 不在 TaiCOL)、Chiloschista 1c、Cleisostoma 1c、Collabium 1c、Corybas 3c、Crepidium 5c、Cryptostylis 1c、Cymbidium 10c (11sp)、Cypripedium 3c、Cyrtosia 3c、Dendrobium 17c (18sp)、Didymoplexis 1c、Epipactis 1c (PDF E. fascicularis 已併 helleborine)、Epipogium 4c (5sp)、Eria 3c (mixed Eria/Aeridostachya)、Erythrodes 2c、Eulophia 3c。**Pre-query TaiCOL** 修大量 sciname：(a) 拼字 typo: Bulbophyllum aurelobellum→aureolabellum、temuislingue→tenuislinguae、cilisepalum→ciliisepalum、maxii→maxi、Calanthe alpine→alpina、triplicate→triplicata、Cypripedium segawai→segawae、Dendrobium linaviamum→linawianum、Erythrodes aggregatus→aggregata、chinensis var. trianthera→triantherae、Epipogium kentingense→kentingensis、Cheirostylis octodactyla f.→fo. cymbiformes；(b) TaiCOL 重新分類: Bulbophyllum somae→drymoglossum、transarisanense→pectinatum、karenkoensis→hirundinis、karenkoensis var. calvum→hirundinis var. calvum、Cephalantheropsis 4 sp 全→Calanthe、Cheirostylis tortilacinia var. rubrifolius→C. rubrifolius、liukiuensis var. nantouensis→C. nantouensis、monteiroi var. clibborndyeri→cochinchinensis var.、takeoi→chinensis var. takeoi、Dendrobium catenatum→officinale、Epipactis fascicularis→helleborine、Eria herklotsii→gagnepainii、scabrilinguis→corneri、robusta→Aeridostachya robusta；(c) cname 校正: 一枝瘤→烏來捲瓣蘭、圓唇→瘤唇、繖形→傘花、尾葉→尾唇、纖花→細花、綉邊→三板、潤葉→翹距、虎紋隔距蘭→虎紋蘭、涼草→蘭嶼小柱蘭、滿緣→滿綠、金稜邊→金稜邊蘭、四季蘭→建蘭、拜歲→報歲、燕石斛→燕子石斛、木斛→木槲、紅鸝石斛→新竹石斛、鬼蘭→小鬼蘭、泛亞→高士佛、台東芋蘭→短裂芋蘭、金枚→金枝。Header bug：第 1 push 用 'target/couplet'（含 slash）被 parser skip，改成 'target' 重 push。Dry-run 1 expected UNRESOLVED (wutaiensis fall-back 字串)。Backend 444→464 keys, 2222→2338 couplets。Session 3 起接 Vandeae epiphyte | ✅ |
| 10.48 | **Orchidaceae session 3 (A 補 + G–N genus subkeys)**：補 16 屬 subkey ─ Acanthephippium 2c (3sp，TaiCOL 主名用 Acanthophippium 但因 master key 用 e 拼，worksheet 維持 Acanthephippium 讓 synonym lookup 連到 t0033561/2 等)、Anoectochilus 2c (3sp，roxburghii 已併 formosanus 同 tid)、Aphyllorchis 2c (3sp，montana var. rotundatipetala→simplex)、Appendicula 3c (4sp，reflexa var. kotoensis→kotoensis 提升為種、var. reflexa→reflexa)、Brachycorythis 1c、Gastrochilus 8c (10sp)、Gastrodia 22c (24sp，PDF 兩個 3-way 拆成 21/22 couplet)、Goodyera 22c (~22sp)、Habenaria 8c (10sp)、Hayata 1c (var. merrillii 提升為 Hayata merrillii)、Hetaeria 1c、Holcoglossum 1c、Lecanorchis 13c (16sp)、Liparis 27c (30sp)、Luisia 3c (4sp，tristis→cordata、Luisia × lui→Luisia lui)、Neottia 13c (14sp，pseudonipponica cname 假日本→裂唇)。**Pre-query 修 sciname**: Gastrochilus japonicas→japonicus、matsudai→matsudae、matsudai var. hoii→matsudae var. hoi、Habenaria dentate→dentata、Liparis gigantean→gigantea、Gastrodia stapfii→javanica 同 tid (PDF 黃赤箭→TaiCOL 爪哇赤箭)、flavilabella→flabilabella、Goodyera seikomontana→seikoomontana (cname 哥綠/歌綠)、brachystegia→brachiorhynchos、Hayata var. merrillii→merrillii (sp 級)、Aphyllorchis var. rotundatipetala→simplex、Luisia tristis→cordata。**cname 校正**: 罈→罎 (Acanthephippium TaiCOL 用 罎)、紫紋無葉蘭→山林無葉蘭、烏喙→鳥喙、烏嘴→鳥嘴、線瓣玉鳳→狹瓣、毛萼→毛唇、冠毛→叉瓣、鎧鈴蟲蘭→銀鈴蟲蘭、綠唇羊耳蒜→絳唇、紫鈴蟲蘭→尾唇羊耳蘭、羊耳草→大花羊耳蘭、桶後→叢生、紅鈴蟲蘭→紅鈴蟲草、寬唇松蘭 PDF→matsudae、無芒喙→無蕊喙、台灣皿蘭 (臺→台)、牡丹金釵蘭→金釵蘭 (TaiCOL 主名)、釵子股→金釵蘭、假日本雙葉蘭→裂唇雙葉蘭、Aphyllorchis var. rotundatipetala→Aphyllorchis simplex。Dry-run 仍只剩 wutaiensis 1 unresolved。Backend 464→480 keys, 2338→2467 couplets。Session 4 起接 Goodyerinae 補 + Oberonia 大群 + Spiranthes/Tropidia | ✅ |
| 10.49 | **Orchidaceae session 4 (N–Y genus subkeys)**：補 22 屬 subkey ─ Nervilia 12c (13sp+var)、Oberonia 8c (9sp+fo)、Odontochilus 7c (8sp)、Oeceoclades 1c (2sp，pulchra var. pulchra→pulchra)、Oreorchis 5c (6sp，wumana→wumanae)、Paraphaius 1c (2sp，全併 Calanthe)、Peristylus 5c (6sp，formosana→formosanus)、Phaius 1c (2sp，全併 Calanthe mishmensis/tankervilleae)、Phalaenopsis 1c (2sp，aphrodite subsp. formosana→formosana 白蝴蝶蘭)、Phreatia 3c (4sp)、Pinalia 3c (4sp)、Platanthera 13c (14sp+subsp，含 mandarinorum subsp. ophrydioides→ophrydioides 提升為種)、Ponerorchis 4c (5sp，alpestris 仍寫裸 epithet 讓 parser fallback 連到 Amitostigma alpestre 同 tid)、Spiranthes 2c (3sp，suishaensis→× hongkongensis 香港綬草)、Styloglossum 4c (5sp，clavata 不在 TaiCOL UNRESOLVED 保留)、Taeniophyllum 2c、Tainia 2c、Thrixspermum 8c (9sp，merguensis→merguense)、Tipularia 1c、Trichoglottis 1c、Tropidia 5c (6sp)、Yoania 1c (2sp)。**Pre-query 修 sciname**：Nervilia cumberlegii→cumberlegei、taiwaniana→taitoensis、Oberonia formosana fo. viridiflora 不在 TaiCOL (UNRESOLVED 保留)、Odontochilus tortus subsp. inabai→inabai、brevistylus subsp. candidus 保留 (UNRESOLVED)、Oeceoclades pulchra var. pulchra→pulchra、Oreorchis foliosa var. indica→indica、wumana→wumanae、Paraphaius/Phaius 全屬→Calanthe、Peristylus formosana→formosanus、monticola/lacertifer cname mismatch、Phalaenopsis aphrodite subsp. formosana→formosana、Platanthera nantouwulvatica→nantousylvatica、guadricalcarata→quadricalcarata、subsp. pachyglossa/formosana/ophrydioides 升 sp 級、Ponerorchis alpestris→Amitostigma alpestre 同 tid、Spiranthes suishaensis→× hongkongensis、Styloglossum lyroglossum→Calanthe lyroglossa 同 tid、densiflora→densiflorum、Tainia elliptica→Tainia latifolia 同 tid、Thrixspermum merguensis→merguense。**cname 校正**：紫背一點廣→紫花脈葉蘭、四重溪顏葉蘭→四重溪脈葉蘭、鱗唇→鐮唇、二裂萼→二裂唇莪白蘭、二囊→雙囊齒唇蘭、旗唇蘭→紫葉旗唇蘭、大霸山蘭→雙板山蘭、貓鬚蘭→深山闊蕊蘭、細花玉鳳蘭→裂唇闊蕊蘭、白芙樂蘭→臺灣芙樂蘭、蓬萊→寶島芙樂蘭、高山絨蘭→連珠絨蘭、小腳筒→小腳筒蘭、赤色毛花蘭→樹絨蘭、狹瓣→狹唇粉蝶蘭、奇萊紅蘭→紅小蝶蘭、葵蘭→心葉葵蘭、厚葉風鈴蘭→厚葉風蘭、臺灣風鈴蘭→台灣風鈴蘭、異色瓣→金唇風鈴蘭、金唇風鈴蘭→金唇風蘭、鳳尾蘭→短穗毛舌蘭。**Bug 修正**: Ponerorchis 第一次 push 4A 寫 `Amitostigma alpestre` 全名觸發 parser `_detect_default_genus` 規則 1 命中第一個 capitalized cell → default_genus 變成 Amitostigma → 其他 bare epithet (tominagae/taiwanensis/...) 全被 mis-prepend Amitostigma → UNRESOLVED 噴 3 個。改成 bare `alpestris` 讓 worksheet name (Ponerorchis) fallback 起作用，全部 resolve。寫進 workflow memory 警示。Dry-run 4 expected UNRESOLVED (wutaiensis/Oberonia fo. viridiflora/Odontochilus subsp. candidus/Styloglossum clavata 都不在 TaiCOL)。Backend 480→502 keys, 2467→2557 couplets。Session 5 起接 Vandeae 殘餘 (Cleisocentron/Pomatocalpa/Vanda/Acampe/Sunipia/Pholidota/Pleione/Pogonia/Microtatorchis/Listera/Vexillabium/Zeuxine/Kuhlhasseltia/Myrmechis 等小屬 + 收尾) | ✅ |
| 10.50 | **Orchidaceae session 5 (Zeuxine 收尾 + 全 Orchidaceae 完成)**：master key 漏網之最後一屬 ─ Zeuxine 線柱蘭屬 10c (11sp，PDF 有 subkey；TaiCOL 17 sp 但 PDF 簡化版只取 11)。**Pre-query 修**: nervosa cname 芳線柱蘭→臺灣線柱蘭、flava 寬葉→黃花線柱蘭、odorata→odorate (TaiCOL 文法形)。Dry-run 0 unresolved。Backend 502→503 keys, 2557→2567 couplets。Audit master key 107 屬 ─ 58 屬 subkey 全在、47 屬單種 inline 在 master 內、剩 1 屬 dead-end: **Papilionanthe 台灣萬代蘭屬** (TaiCOL 4 sp accepted, PDF 沒 subkey 直接用 master key terminal 即可；維持 dead-end 不擋整體)。`make mobile-db` synced (cname_fuzzy_index 62809)。**1m8C row 33 (Orchidaceae) done=TRUE 已標**。整個 Orchidaceae 蘭科 142 屬 / 679 種完成，從 Session 1 master key 117c → S5 共 60 keys 246 couplets 補完 | ✅ |
| 10.51 | **Orchidaceae post-S5 audit + cleanup**: 跑完整 audit script 抓出 4 大類問題。**Anoectochilus #2 degenerate dichotomy (formosanus/roxburghii 同 t0052597)**: 使用者直接改 google sheet 替換 PDF roxburghii 為 TaiCOL accepted `semiresupinata 半轉位金線蓮` (t0060981)，並重排 1A/1B；驗證 3 sp 都 accepted 後重 import。**Acanthephippium → Acanthophippium**: PDF 用 e 拼但 TaiCOL accepted 是 o 拼 (taicol_names.genus 欄為 Acanthophippium)，導致 mobile findSubkeyForTaxon 不可達。Rename worksheet → 刪舊 DB row id=818 → 重 import 為 scope_name='Acanthophippium' (key id=857)，3 sp (striatum/sylhetense/pictum) 全 link accepted。**Phaius/Paraphaius/Cephalantheropsis 三 worksheet dead** (TaiCOL 全併 Calanthe 同 tid t0023351)：使用者決定維持現狀+memory note，未來 mobile 改 scope_name 直查可恢復。**9 個 master-only single-sp genus** (Acampe/Bletilla/Cephalanthera/Chrysoglossum/Hemipilia/Malaxis/Saccolabiopsis/Vanilla)：建立 `references/Identification_key_misc.md` 紀錄缺口清單，未來新資料補。**Goodyera/Nervilia 3 個 cross-couplet duplicate** (t0053852/t0053856/t0054578)：PDF 區分但 TaiCOL 合併，技術 OK 不擋功能。`make mobile-db` 重 sync。最終 audit: 0 degenerate / 4 UNRESOLVED (PDF only) / 3 cross-couplet duplicate (PDF 設計差異) | ✅ |
| 10.52 | **Malvales 錦葵目** 一次性完成 14 keys (sheet 1btO0qn...): Malvaceae 錦葵科 family key 25c (26 屬 68sp) + 10 個 genus subkey ─ Abelmoschus 3c (4sp), Abutilon 6c (7sp), Corchorus 3c (4sp), Grewia 4c (5sp), Hibiscus 8c (9sp), Malva 2c (3sp), Malvastrum 1c (2sp), Sida 10c (11sp), Triumfetta 3c (4sp), Urena 1c (2sp); Thymelaeaceae 瑞香科 family 2c (3 屬 10sp) + Daphne 3c (4sp+var) + Wikstroemia 4c (5sp)。Bixaceae 0sp 跳、Muntingiaceae 1sp inline 不建 key。**Pre-query 修 sciname**: Pachira aquatic→aquatica、Herritiera→Heritiera、Hibiscus pandurifolius→panduriformis、Helicteres angustifolia→augustifolia、Waltheria americana→indica、Malva cathayensis→sinensis、Sida veronicaefolia→cordata、maderensis→rhombifolia var. maderensis、javensis subsp. javensis→javensis (drop subsp.)、Abelmoschus manihot var. manihot→manihot (drop var.)。**cname 校正**: 臺灣梭欏樹→梭羅樹、苘麻→莔麻 (5 處 Abutilon)、緞葉→椴葉捕魚木、臺薄蕘花→臺灣蕘花。Dry-run 0 unresolved。Backend 503→517 keys, 2567→2642 couplets。`make mobile-db` synced。1m8C row 69 done=TRUE 已標 | ✅ |
| 10.53 | **Myrtales 桃金孃目** 5 family 18 keys (sheet 1O2hgn34...): Combretaceae 1c (2sp), Lythraceae family 5c (6 屬 22sp) + Ammannia 3c (4sp) + Rotala 8c (10sp) + Trapa 5c (6sp); Melastomataceae 11c (11 屬 25sp) + Bredia 5c (6sp) + Medinilla 2c (3sp) + Melastoma 3c (4sp) + Memecylon 1c (2sp) + Osbeckia 1c (2sp) + Sarcopyramis 1c (2sp); Myrtaceae 3c (4 屬 14sp) + Syzygium 10c (11sp); Onagraceae 3c (4 屬 29sp) + Circaea 3c (4sp) + Epilobium 6c (8sp) + Ludwigia 9c (12sp)。**Pre-query 修 sciname**: Cuphea cartagenensis→carthagenensis (TaiCOL spelling), Tashiroea laisherana→Bredia laisherana 來社山布勒德藤 (TaiCOL 重新分類), Syzygium densinervium var. insulare→densinervium (drop var.); Trapa 屬 5 sp 中有 3 sp (bicornis var. taiwanensis/bispinosa/japonica) 在 TaiCOL 全併到 Trapa natans var. bispinosa 同 tid t0055638 → 保留 PDF synonym Latin 讓 dichotomy 描述可見，degenerate 注記入 misc。**cname 校正**: 五蕊豬母乳→五蕊水豬母乳、沼澤水豬母乳→沼澤節節菜、草葉羊角扭→革葉羊角扭、樟花蒲桃→棒花蒲桃、假水丁香→假柳葉菜。**Synonym→accepted 同 tid**: Bredia scandens→hirsuta var. scandens, rotundifolia→hirsuta var. rotundifolia, Melastoma scaberrima→Otanthera scaberrima。Dry-run 0 UNRESOLVED。Backend 517→535 keys, 2642→2722 couplets。`make mobile-db` synced。1m8C row 70 done=TRUE 已標。**Oenothera 在 Onagraceae family key 為 dead-end** (PDF 無 subkey, TaiCOL 8 sp，註記入 misc) | ✅ |
| 10.54 | **Malpighiales 黃褥花目** 12 family 28 keys (sheet 1WHaRDkb...): Calophyllaceae 1c (2sp), Clusiaceae 2c (Garcinia 3sp), Elatinaceae 1c (2sp), **Euphorbiaceae 大戟科 18c family (18 屬 65sp) + 8 屬 subkey** ─ Acalypha 11c (12sp), Croton 2c (3sp), Euphorbia 23c (24sp), Excoecaria 2c (3sp), Macaranga 1c, Mallotus 5c (6sp+var), Triadica 1c, Vernicia 1c; Hypericaceae 13c family+Hypericum 合併 (14sp); Malpighiaceae 2c (3sp/3gen); Passifloraceae 1c family + Passiflora 5c (6sp); **Phyllanthaceae 葉下珠科 8c family (9 屬 31sp) + 6 屬 subkey** ─ Antidesma 2c, Breynia 1c, Bridelia 1c, Flueggea 1c, Glochidion 9c (10sp), Phyllanthus 9c (10sp); Putranjivaceae 2c (3sp); Rhizophoraceae 3c (4sp); Salicaceae 6c family (7 屬) + Salix 8c (9sp); **Violaceae 19c family+Viola 合併** (20sp)。Skip Achariaceae/Chrysobalanaceae/Ochnaceae (0sp), Linaceae (1sp inline)。**Pre-query 修 sciname**: Acalypha matudae→matudai, Mallotus tiliaefolius→tiliifolius, Hypericum geminiflorum var. simpliciflorum→simplicistylum, nagasawai→nagasawae, Antidesma pentandrum→Antidesma montanum (synonym→same tid), Glochidion puber→puberum, ellipticum→Glochidion ovalifolium (TaiCOL 重新分類), Phyllanthus urinaria var. hookeri→Phyllanthus hookeri (升 sp), Bruguiera gymnorrhiza→gymnorhiza (single 'r'), Stigmaphyllon timoriense→Ryssopterys timoriensis (TaiCOL 改屬), Synostemon bacciformis→Sauropus bacciformis, Putranjiva formosana→Liodendron formosanum, Passiflora foetida→vesicaria。**cname 校正**: 白匏仔→白匏子(2處), 白柏→白桕, 茄苳→茄冬, 南投五月茶→日本五月茶, 薄葉嘉賜樹→薄葉嘉賜木, 翠綠菫菜→翠峰菫菜, 廣東菫菜→廣東堇菜, 紅茄苳→紅茄冬, 緞葉野桐→椴葉野桐。**1 expected UNRESOLVED**: Glochidion lanyuense 蘭嶼饅頭果 (TaiCOL 完全沒有此 taxon)。Backend 535→563 keys, 2722→2880 couplets。`make mobile-db` synced。1m8C row 68 done=TRUE 已標 | ✅ |
| 10.55 | **Gentianales 龍膽目** 4 family 38 keys (sheet 19y2og6b...): Apocynaceae 23c family (24 屬 43sp) + 9 屬 subkey (Alyxia/Anodendron/Cynanchum/Urceola/Marsdenia/Rauvolfia/Tabernaemontana/Trachelospermum/Tylophora), Gentianaceae 7c family (8 屬 33sp) + 4 屬 subkey (Centaurium/Gentiana 13c 大/Swertia/Tripterospermum), Loganiaceae 5c (4 屬 6sp), **Rubiaceae 茜草科 44c family 巨型 (44 屬 119sp) + 21 屬 subkey** (Damnacanthus/Diodia/Galium 10c/Hedyotis/Lasianthus 18c 大/Leptopetalum/Morinda/Mussaenda/Neanotis/Nertera/Ophiorrhiza/Paederia/Psychotria/Randia/Richardia/Rubia/Scleromitrion/Spermacoce 7c/Tarenna/Uncaria/Wendlandia)。**Pre-query 大量 TaiCOL 重新分類**: Cynanchum/Tylophora 4-5 sp 全併入 Vincetoxicum (worksheet 用 bare epithet 走 synonym fallback)、Ecdysanthera→Urceola (worksheet 改名 Urceola，utilis→micrantha)、Geophila repens→herbacea、Diplospora dubia→Tricalysia dubia、Serissa serissoides→Buchozia japonica、Spermacoce laevis→Borreria laevis、Leptopetalum strigulosum var. parvifolium→strigulosum、Cephalanthus tetrandra→tetrandrus、Anodendron benthamiana→benthamianum、Lasianthus biflora→biflorus、Ophiorrhiza michelloides→mitchelloides、Paederia cavalerieri→cavaleriei、Galium fukuyamai→fukuyamae、Geniostema rupestre→Geniostoma rupestre (typo)。**Pre-query 修 sciname typo**: Parsonia→Parsonsia, Alyxia sibayanensis→sibuyanensis, Rubia lanceolate→lanceolata。**cname 校正**: 長春花→日日春, 臺/台轉換 (多處), 葡匐→匍匐, 巴西擬鴨舌廣→癀, 嘴葉鉤藤→鉤藤, 鴛鴦湖→TaiCOL 主名等。0 UNRESOLVED。Backend 563→601 keys, 2880→3078 couplets (+38/+198 — 本日最大批)。`make mobile-db` synced。1m8C row 64 done=TRUE 已標 | ✅ |
| 10.56 | **Fabales 豆目** 完成 52 keys (sheet 12LssAM4...): Fabaceae 豆科 83c family key (84 屬 251sp 巨型) + 49 個 genus subkey (Acacia 2c/Aeschynomene 1c/Albizia 4c/Alysicarpus 4c/Astragalus 2c/Bauhinia 2c/Caesalpinia 3c/Cajanus 1c/Callerya 1c/Canavalia 3c/Chamaecrista 3c/Christia 1c/Clitoria 1c/**Crotalaria 22c (25sp 大)**/Dalbergia 1c/Dendrolobium 2c/Derris 3c/Desmanthus 2c/**Desmodium 17c (18sp 大)**/Dumasia 1c/Dunbaria 2c/Entada 2c/Flemingia 3c/Galactia 2c/Glycine 3c/Hylodesmum 4c/**Indigofera 16c (17sp 大)**/Kummerowia 1c/Lespedeza 4c/Lotus 1c/Macroptilium 2c/Medicago 4c/Melilotus 2c/Millettia 2c/Mimosa 2c/Mucuna 4c/Neptunia 2c/Ormosia 1c/Pueraria 2c/Rhynchosia 2c/Senna 6c/Sesbania 2c/Smithia 1c/Sophora 1c/Tephrosia 3c/Trifolium 2c/Uraria 3c/Vicia 3c/Vigna 10c); Polygalaceae 遠志科 2c family (3 屬 8sp) + Polygala 5c (7sp); Surianaceae 1sp inline 不建 key。**大量 TaiCOL 重新分類** (Desmodium 屬被拆成 9 個新屬 Grona/Sohmaea/Polhillides/Pleurolobus/Huangtcia/Puhuaea/Leptodesmia): Bauhinia championii→Phanera, Callerya reticulata→Wisteriopsis, Crotalaria zanzibarica→trichotoma, Derris canarensis→oblonga, Desmanthus leptophyllus→virgatus, Desmodium 10+ sp 改屬 (renifolium→Huangtcia, gangeticum→Pleurolobus, velutinum→Polhillides, gracillimum/zonatum/diffusum/laxiflorum→Sohmaea, microphyllum→Leptodesmia, heterophyllum/triflorum/heterocarpon→Grona, sequax→Puhuaea), Entada phaseoloides subsp. tonkinensis→Entada tonkinensis, Flemingia macrophylla var. philippinensis→Flemingia prostrata, Indigofera pseudo-tinctoria→pseudotinctoria, Lotus corniculatus subsp. japonicus→var., Lotus pacifica→taitungensis, Macroptilium atropurpureus→atropurpureum, Millettia pinnata→Pongamia pinnata, Pueraria lobata subsp. thomsonii→Pueraria montana var. thomsonii, Senna sulfurea→surattensis。**typo 修**: Dendrolobium trianglare→triangulare, Dolichos kosyuensis→kosyunensis, Chamaecrista nictitans subsp. patellaria var. glabrata→nictitans var. glabrata。**cname 修**: 鋪地→舖地, 紫山螞蝗→紫花山螞蝗, 假菜豆→熱帶葛藤, 散生→散花山螞蝗。**Bug 修**: Senna × floribunda 原寫裸 epithet `× floribunda`，parser 不會 prepend genus (× 開頭非 lowercase)，改成全名解決。**1 expected UNRESOLVED**: Desmanthus pernambucanus 合歡草 (PDF only, 不在 TaiCOL)。Backend 601→653 keys, 3078→3336 couplets (+52/+258)。`make mobile-db` synced。1m8C row 62 done=TRUE 已標 | ✅ |

| 10.57 | **Asterales 菊目 S1** 4 keys (sheet 18Nk9ZJb...): **Asteraceae 菊科 103c family key (102 屬 290sp 巨型)**, Campanulaceae 桔梗科 8c family (9 屬 18sp) + Adenophora 沙參屬 2c (3sp), Menyanthaceae 睡菜科 5c (1 屬 Nymphoides 6sp)。Asteraceae 0 UNRESOLVED！(夠幸運，TaiCOL 都對齊) — 但 Asteraceae 102 屬 subkey **未建** (S2/S3 補)。Family key 含跳號 couplet 44B→102 (PDF 設計把 Wollastonia/Sphagneticola/Indocypraea/Melanthera 群放在 102/103 couplet 後段)。Indocypraea & Melanthera 雙屬同 lead 取 Melanthera。Backend 653→657 keys, 3336→3454 couplets (+4/+118)。`make mobile-db` synced。1m8C row 34 暫未標 (待 S2/S3) | 🟡 S1 done |
| 10.58 | **Asterales 菊目 S2 (A 字頭 8 屬 subkey)**: Acmella 4c (5sp), Adenostemma 1c (2var), Ageratina 1c (2sp), Ageratum 1c (2sp), Ainsliaea 8c (10sp，TaiCOL 大合併: kawakamii/reflexa/henryi var. 多 sp 全併入 latifolia subsp. henryi 或 macroclinidioides), Ambrosia 1c (2sp), Anaphalis 3c (5sp), **Artemisia 16c (18sp 大)**。**cname 修**: 印度金鈕扣→印度金鈕釦 (扣→釦), 澤假藿香→澤假藿香薊, 紫花霍香薊→紫花藿香薊, 籟蕭→籟簫 (3 處 Anaphalis)。**3 expected UNRESOLVED** (Ainsliaea apiculata var. acerifolia / latifolia var. taiwanensis / henryi var. subalpina 都不在 TaiCOL)。Backend 657→665 keys, 3454→3489 couplets (+8/+35)。`make mobile-db` synced。剩餘 ~94 屬 subkey 待 S3+。1m8C row 34 仍暫未標 | 🟡 S2 done |
| 10.59 | **Asterales 菊目 S3 (B-Z 字頭 44 屬 subkey)** Asteraceae 完工: Aster 17c(17sp), Bidens 6c(7sp), **Blumea 13c(13sp 大)**, Carpesium 4c(5sp), **Cirsium 12c(13sp 大)**, Conyza 6c(7sp), Cotula/Crepidiastrum/Cotula 1c, Dendranthema 4c(5sp), Eclipta/Elephantopus 1c, Emilia 3c(4sp), Erechtites 2c(3sp), Erigeron 3c(4sp), **Eupatorium 8c(10sp 大)**, Farfugium 1c, Flaveria/Galinsoga 1c, **Gnaphalium 12c(13sp 大)**, Gynura 3c(4sp), Hypochoeris 3c(4sp), Melanthera 3c(4sp，Indocypraea/Melanthera 雙屬合鍵), Ixeridium/Ixeris 2/4c, Lapsanastrum/Ligularia 1/2c, Mikania/Parasenecio/Picris 1c, Pluchea 3c(5sp), Praxelis/Pterocypsela 1/2c, **Saussurea 4c, Senecio 9c(10sp 大)**, Solidago/Soliva/Sonchus 1/1/2c, Sphagneticola/Syneilesis/Taraxacum/Tephroseris 1c, **Vernonia 5c(6sp)**, Wollastonia 1c(2var), Youngia 2c(3sp)。**Pre-query 修**: Picris hieracioides subsp. morrisoensis→morrisonensis, Erechtites hieraciifolia→hieraciifolius (masculine), valerianifolia→valerianifolius, Pterocypsela × mansuensis 必須全 Latin (× 開頭 parser 不 prepend genus), Pterocypsela 結構重組 (couplet 2 缺 lead B 修正)。**6 expected UNRESOLVED** (Blumea chishanensis / Hypochoeris chillensis / Hypochoeris microcephala var. albiflora 都不在 TaiCOL；Ainsliaea 3 var 從 S2 帶)。Backend 665→709 keys, 3489→3644 couplets (+44/+155)。**Asterales 完工** (Asteraceae family 103c + 8+44=52 屬 subkey + Campanulaceae+Adenophora+Menyanthaceae 共 56 keys / 290+sp)。`make mobile-db` synced。**1m8C row 34 done=TRUE 已標** | ✅ |
| 10.60 | **Lycopodiopsida 石松綱**（sheet 1luQCn7S...，源換為《臺灣維管束植物野外鑑定指南》非原 1m8C 標的《臺灣石松類與蕨類全圖鑑》）: 3 科 7 屬, 4+3+5+8+18 = 38 couplets, 5 keys (Lycopodiaceae family 4c + Huperzia 3c + Lycopodium 5c + Phlegmariurus 8c + Selaginellaceae 18c)。Isoetaceae 1sp inline (Isoetes taiwanensis CR), Lycopodiaceae 5屬21sp (Huperzia 4sp / Lycopodium 7sp / Phlegmariurus 9sp / Lycopodiastrum 1sp / Lycopodiella 1sp), Selaginellaceae 1屬19sp。Pre-query 全 41 sp 對到 TaiCOL accepted (Phlegmariurus cryptomerianus 是 synonym 但 parser fallback 解到 tid)。**Cname 異音記**: Huperzia javanica TaiCOL 長柄千層塔 / PDF 千層塔; Selaginella uncinata TaiCOL 翠雲草 / PDF 藍地柏 (兩本通用名異, 不影響 tid 解析)。Sheet 上 backup worksheet 殘留要先 del。Backend 709→714 keys, 3644→3682 couplets (+5/+38)。`make mobile-db` synced。**1m8C row 2 done=TRUE 已標**。剩 row 3 Polypodiopsida 為最後維管束類群 | ✅ |
| 10.61 | **Poales 禾本目 S1 4 小科** (sheet 1LvL1vBj...，PDF 收錄 6 科 161屬605sp，缺 Bromeliaceae 等 2 科即取 1m8C 8/176/720 差異): Eriocaulaceae 穀精草科 6c(7sp 全 Eriocaulon), Juncaceae 燈心草科 1c family(2 屬), Juncus 燈心草屬 9c(10sp), Luzula 地楊梅屬 3c(4sp), Typhaceae 香蒲科 2c(3sp = Sparganium 1+Typha 2)。inline 不建 key: Flagellariaceae 鞭藤科 (Flagellaria indica LC) / Xyridaceae 黃眼草科 (Xyris formosana 桃園草 CR)。**Pre-query 26/26 OK**。Eriocaulaceae family-scope 內僅單屬 Eriocaulon, 起初寫裸 epithet 觸發 7 UNRESOLVED, inline gspread fix 全 prepend Eriocaulon (parser 對 family scope 不自動 fallback default_genus, 維管束 memory 規則已紀錄)。Backend 714→719 keys, 3682→3703 couplets (+5/+21)。`make mobile-db` synced。剩 S2 Cyperaceae 莎草科 (20屬209種), S3+S4 Poaceae 禾本科 (134屬370種 巨型)。1m8C row 79 暫未標 | 🟡 S1 done |
| 10.62 | **Poales S2a Cyperaceae 莎草科 family + 9 小屬** (sheet 1LvL1vBj... 續): Cyperaceae family key 19c (含 7 個 single-sp 屬 inline terminals: Diplacrum/Hypolytrum/Lepironia/Cladium/Gahnia/Actinoscirpus/Trichophorum) + 9 個小屬 subkey: Bolboschoenus 1c(2sp), Bulbostylis 1c(2sp), Fuirena 1c(2sp), Rhynchospora 5c(6sp), Schoenoplectiella 5c(6sp), Schoenoplectus 1c(2sp), Schoenus 2c(3sp), Scirpus 1c(2sp), Scleria 8c(9sp)。**Pre-query 47/47 全 resolve**。**PDF→TaiCOL cname 修正 9 處** (採 TaiCOL accepted name 主名): 蒭→芻 (Lepironia 石龍蒭→石龍芻), 大廡草→大藨草 (Actinoscirpus), 多穗蘩草→多穗藨草 / 扁桿蘩草→扁稈藨草 (Bolboschoenus 屬 cn=塊莖藨草屬 非 PDF 塊莖蘩草屬), 疏桿→疏稈 (Schoenoplectiella multiseta), 大藨草→大莞草 (Scirpus ternatanus), 印度→印尼 (Scleria sumatrensis), 光桿→光果 (Scleria radula), 擬蒿→擬莞 (Schoenoplectiella 擬莞舅屬 / Schoenoplectus 擬莞屬)。Backend 719→729 keys, 3703→3747 couplets (+10/+44)。`make mobile-db` synced。**Dead-end SQL 確認**: 剩 Carex 83sp (S2b), Cyperus 62sp (S2c), Fimbristylis 39sp + Eleocharis 16sp (S2d) — 完全符合預期分段。1m8C row 86 暫未標 (待 S2b/c/d + S3+S4) | 🟡 S2a done |
| 10.63 | **Poales S2b Cyperaceae Carex 薹屬** (sheet 1LvL1vBj... 續): 71 couplets / 72 終端 taxa (含 4 個 var./subsp. infraspecific: grallatoria var. heteroclita / gentilis var. nakaharae / manca subsp. takasagoana / tristachya var. pocilliformis / mitrata var. aristata)，**Pre-query 72/72 全 resolve**。**PDF→TaiCOL cname 採 TaiCOL** (7 處): 斑→班 (TaiCOL 用 U+73ED 而非 U+6591；kiotensis 班囊果薹 / phacota 七星班囊果薹 / maculata 寬囊果薹), 水鳥薹→異型菱果薹 (grallatoria var. heteroclita 用 var. cname), 硬果薹→太平山薹 (sclerocarpa), 球穗薹→南投薹 (oxyandra), 菱果薹→和平菱果薹 (macrandrolepis), 川上氏薹→高山日本薹 (alopecuroides)。**PDF typo 修**: brachyathera → brachyanthera (TaiCOL 正確拼)。Backend 729→730 keys, 3747→3818 couplets (+1/+71)。`make mobile-db` synced。**Dead-end SQL**: Cyperaceae 剩 Cyperus 62 / Fimbristylis 39 / Eleocharis 16 (S2c+S2d 待)。1m8C row 86 暫未標 | 🟡 S2b done |
| 10.64 | **Poales S2c Cyperaceae Cyperus 莎草屬** (sheet 1LvL1vBj... 續): 50 couplets / 51 終端 taxa (含 4 個 subsp.: imbricatus subsp. imbricatus & elongatus / nutans subsp. subprolixus / malaccensis subsp. malaccensis & monophyllus)，**Pre-query 51/51 全 resolve**。**PDF→TaiCOL cname 採 TaiCOL** (2 處): 茳芏→茳茳鹹草 (malaccensis subsp. malaccensis：TaiCOL cn=茳茳鹹草，茳芏 為 alt), 扁穗莎草→沙田草 (compressus：TaiCOL cn=沙田草，扁穗莎草 為 alt)。Backend 730→731 keys, 3818→3868 couplets (+1/+50)。`make mobile-db` synced。**Dead-end SQL**: Cyperaceae 剩 Fimbristylis 39 / Eleocharis 16 (S2d 待)。1m8C row 86 暫未標 | 🟡 S2c done |
| 10.65 | **Poales S2d Cyperaceae Eleocharis + Fimbristylis 完工 → Cyperaceae 整科完成** (sheet 1LvL1vBj... 續): Eleocharis 11c(12 終端，含 3 個 var./subsp.: congesta var. thermalis / congesta subsp. japonica / congesta var. subvivipara) + Fimbristylis 31c(33 終端，含 5 個 var.: littoralis var. ×2 / ferruginea var. ×2 / aestivalis var. ×2 / tristachya var. subbispicata)，**Pre-query 45/45 全 resolve**。**PDF→TaiCOL cname/拼字 採 TaiCOL** (3 處): Fimbristylis umbellaris 繖形飄拂草 → TaiCOL t0033503 主名 **擬二葉飄拂草** (TaiCOL accepted=F. diphylloides, umbellaris 為 misapplied 同 tid), F. miliacea 四稜飄拂草 → TaiCOL **五稜飄拂草** (alt 四稜飄拂草), E. congesta `subsp. subvivipara` (PDF) → TaiCOL **`var. subvivipara`** (t0086789 狹穗荸薺)。**PDF 結構問題紀錄**: Fimbristylis 1B→5 但 couplets 9-31 (23 couplets, ~22 species) 在 PDF 內 orphan，無 incoming arrow，疑為 PDF 印刷遺漏。保留 PDF 原樣 import (mobile UI 列表瀏覽仍可進入)，未來若取得勘誤可由 Sheet 補連結。Backend 731→733 keys, 3868→3910 couplets (+2/+42)。`make mobile-db` synced (cname_fuzzy_index 62809)。**Dead-end SQL**: Cyperaceae **0 dead-end** (Carex/Cyperus/Eleocharis/Fimbristylis 四大屬全有 subkey)。整 Cyperaceae 科 (20 屬 209 種) **211 couplets / 14 keys 完工** (family 19c + 9 小屬 44c + Carex 71c + Cyperus 50c + Eleocharis 11c + Fimbristylis 31c = 226c... 累計增量 161c)。1m8C row 86 仍暫未標 (Poaceae S3+S4 134 屬 370sp 巨型尚未開始) | ✅ Cyperaceae 完工 |
| 10.66 | **物種 tab UX 系列修正 + Rank 顏色 (rainbow palette)**: 五件事一輪修。(a) **分類樹 search-pick 在實機 scrollToIndex 不準** (`taxonomy.tsx`): 原本 `setTimeout(120)` + fallback 到 `averageItemLength × index` 估算 offset，實機 layout 比 simulator 慢 + row 高度差異大 (有/無 stats 行、`paddingLeft = 16 + depth × 14`) 平均值在大 index 誤差被放大。改 `requestAnimationFrame` 雙幀延遲 + `onScrollToIndexFailed` 先粗滾到估算 offset 強迫 FlatList 渲染目標附近 row、250ms 後 retry `scrollToIndex({viewPosition: 0.25})` 精準定位，第二次仍失敗放棄避免無限 loop。(b) **TaxonomySearchBox 點選後建議框沒關** (`TaxonomySearchBox.tsx`): `handlePick` 原本 `onPick(hit) → setQuery('') → setResults([])`，`onPick` 同步觸發 parent 大量 setState (setExpanded/setNodeMap/setChildrenMap/setSpeciesMap/setSetting 寫 SQLite + setTimeout)，實機上 batch 後 child 的 setState 視覺上未生效（input 還顯示 'Lau'，建議框還在）。改順序倒轉：先 `setResults([])` + `setQuery('')` + `inputRef.current?.clear()`（同步 native value）+ `Keyboard.dismiss()`，再 `requestAnimationFrame(() => onPick(hit))` defer parent 工作。(c) **Toast 從 bottom 移 top** (`ToastHost.tsx`): 原 `bottom-24` 會擋住底部搜尋框，改 `top-0` + `edges={['top']}` + `mt-2`。(d) **HitRow 學名 italic 改 rank-aware** (`TaxonomySearchBox.tsx`): 原本 unconditional `<Text className="italic">{hit.name}</Text>` 把 Lauraceae/Laurales/Magnoliopsida 等高階 rank 都斜體化，違反命名法（只 Genus/Species/Subspecies/Variety/Form 才斜體）。加 `ITALIC_RANKS` Set 條件套 italic class。(e) **SpeciesRow 長學名換行不撞徽章** (`taxonomy.tsx`): 原 cname + ScientificName + s.str. 三 sibling Text 用 `flex-row items-baseline` 包，RN 不會把它們當 flowing text 自動換行，超過寬度直接 clip 撞上「特/NLC」徽章 (Castanopsis cuspidata var. carlesii fo. sessilis 案例)。合併成單一 `<Text>` 內含 nested Text 讓 RN 文字引擎原生換行；父 Pressable `items-center → items-start` 讓徽章貼第一行；icon `marginTop: 3` + 徽章群 `marginTop: 2` 對齊 baseline；徽章群包成 flex-row View 修正原本兩者都掛 `ml-2` 在外層 (無 cname 時 redlist 還有 leading gap)。(f) **Rank 顏色 rainbow palette** (`src/lib/rankColors.ts`): 新 helper `rankColor(rank)` 回傳 Tailwind `{bg, text}` class，支援中英 rank label 雙向（界/門/綱/目/科/屬/種/亞種/變種/型 ↔ Kingdom/Phylum/.../Form），未知 rank fallback 灰色。色票（暖→冷）: rose-100/700, orange-100/800, amber-100/800, lime-100/800, teal-100/800, sky-100/800, indigo-100/700, violet-100/700, fuchsia-100/700, pink-100/700。套到 `TaxonRow` rank chip + `SpeciesRow` infraspecific chip（從純文字 → self-start 圓角 chip）+ `HitRow` rank chip。**驗證**: 殼斗、樟、禾本、Isoetales 多深度 path scrollToIndex 實機準確；輸入 Lau 點 Lauraceae 建議框正確關閉 + input 清空 + 鍵盤收起；Castanopsis cuspidata var. carlesii 等長學名正確換行不撞徽章 | ✅ |
| 10.67 | **統一 IUCN 配色 chip + alien badge (侵歸栽圈)**: 全 app 紅皮書 / IUCN 等級顯示統一用官方 IUCN 色票 (per <https://www.iucnredlist.org>)，學名後屬性也加 single-char chip。(a) **新 `src/lib/conservationColors.ts`**: `iucnTone(code)` 自動 strip `N` 前綴 (NCR/CR、NLC/LC 共色)，回傳 `{bg, text, label}` hex 值（避開 NativeWind JIT 動態 class 限制）。色票 — EX `#4C4338` 白字 / EW `#80628A` 白字 / CR `#B53523` 白字 / EN `#E48B47` 白字 / VU `#F6CB47` 深字 / NT `#9FC040` 深字 / LC `#6EBA3F` 白字 / DD `#C3C3C3` 深字 / NE,NA `#E5E5E5` 深字。`alienBadge(alienType, kingdom)` 回傳 `{kind, shortLabel, longLabel, textClass}`：invasive 「侵」red-700 入侵種、naturalized 「歸」rose-500 歸化種、cultured + Animalia 「圈」violet-600 圈養、cultured + 其他 「栽」purple-600 栽培、native return null（特有由 `is_endemic` 另出「特」綠字）。i18n 階段再加英文 label override (V/A/C)。(b) **新 `src/components/ConservationBadge.tsx`**: inline `style={backgroundColor}` 帶 hex + rounded 6px chip，size sm/md。null code 自動 return null。(c) **整合 5 處**: `taxonomy.tsx` SpeciesRow（特+侵歸栽圈+ConservationBadge）、`LookupResultSheet.tsx` 物種狀態 Tag (rose/purple) + 紅皮書/IUCN 改 ConservationBadgeRow（CITES/保育類保留純文字）、`SpeciesDetailSheet.tsx` 同上 + 移除 unused `ALIEN_LABEL`、`SpeciesCard.tsx` 改用 ConservationBadge + 移除 local `statusColor`、`app/key/[id].tsx` tags 拿掉 redlist+IUCN 改 inline ConservationBadge、移除 local `redlistTone`。(d) **SearchResult type 加 `alien_type: string`**: 補在 `search.ts` rowToResult / `fuzzy.ts` rowToResult / `taxonomy.tsx` speciesToSearchResult 三個構造點。type check pass | ✅ |
| 10.68 | **跟隨系統 theme bug fix + 複製功能 (expo-clipboard)**: (a) **NativeWind 4 跟隨系統 theme 點了沒反應**: 根因 — `useThemeSync` `useEffect` 永遠傳具體 `'light'\|'dark'` 給 `setColorScheme`，等於把 NativeWind 鎖在某個值，當使用者選 auto + effective 解析後跟先前同值（dark + OS dark），useEffect dep `[effective]` 不變不 fire，視覺上「沒反應」。NW 4 正確做法是傳 `'system'` 由它自己掛 Appearance listener。修法：`setColorScheme(theme === 'auto' ? 'system' : theme)`，useEffect dep 改 `[theme]`（即使 effective 沒變，theme 變了仍 fire 重新告訴 NW「現在改追 system」）；`effective` 仍由 `resolveScheme(theme, system)` 算給 ThemeProvider + StatusBar 用。(b) **複製功能**: `npx expo install expo-clipboard` + pod install。新 `src/lib/clipboard.ts`: `copyToClipboard(text, label?)` (Clipboard.setStringAsync + toast「已複製：{label}」), `buildSpeciesCopyText(sp, mode)` 4 模式 (sciname/cname/both/full — full 多行含俗名/學名/其他俗名/科/階層/物種狀態/保育狀態/TaiCOL 連結), `speciesCopyActions(sp)` 動態生 ActionSheet 選項（無 cname 跳過該項）, `buildTaxonCopyText` + `taxonCopyActions` 分類群版。整合 4 處: `LookupResultSheet` + `SpeciesDetailSheet` 標題列加 copy icon → ActionSheet 二層（學名/俗名/俗名+學名/完整資訊）、`taxonomy.tsx` SpeciesRow long-press 既有 sheet 加「複製...」進二層、TaxonRow 新增 long-press → ActionSheet（學名/俗名/俗名+學名）。**新 memory `feedback-mobile-theme-nativewind`** 紀錄 NW 4 setColorScheme `'system'` pattern | ✅ |
| 10.69 | **檢索表 prewarm + 搜尋 tab inline detail + 選單清理**: (a) **檢索表 cold tap 慢 1-2s 根除**: `listIdentificationKeys` 對 ~700 把 key 跑 child_count 子查詢掃 242k taicol_names 列。原本只在 `KeyListView.tsx` 內 module-cache（第二次切 tab 才快），第一次按 tab 仍同步付 1-2s。把 cache 上提到 `src/db/keys.ts` 加 `getCachedKeys()` + `prewarmKeys()`，`DBProvider` 在 splash 收完後 `setTimeout(0)` 接在 `prewarmFuzzyIndex()` 後跑，cold cost 移到 idle 不可見處。`KeyListView.tsx` 改用 shared `getCachedKeys`，刪掉 local cache 避免兩份。(b) **搜尋 tab 改 inline detail**（避免 modal 冗餘）: 抽 `src/components/SpeciesDetailPanel.tsx` 從 LookupResultSheet 內容（標題列 + matched_as banner + 物種狀態 + 保育 + 同物異名 + 外部連結 + 加入按鈕），不含 Modal/SafeAreaView/drag handle。`LookupResultSheet.tsx` 重寫為 thin wrapper：保留 Modal + 背景遮罩 + drag handle，內部包 SpeciesDetailPanel（其他用到的入口如分類樹、key 完成頁、session 長按行為不變）。`SpeciesSearchPanel.tsx` 重寫：上方空白區直接 inline 渲染 SpeciesDetailPanel（active 有值時）或顯示提示「下方輸入...選擇結果後在此檢視詳細資訊」（active null 時）；移除原本 `Keyboard.dismiss + setTimeout(150) + Modal mount` 的 iOS 鍵盤競態 hack（不需要 modal 了）；`handleAddToSession` 加入後 `setActive(null)` 清掉 detail 讓「搜尋 → 加入 → 繼續搜尋」一氣呵成。(c) **選單清理**: 移除「物種查詢」menu entry（與物種 tab 搜尋 segment 重複）+ 刪 `app/lookup.tsx` + 移除 `_layout.tsx` 的 `lookup` Stack.Screen 註冊 + 更新 SpeciesSearchPanel docstring。(d) **SearchBox 鍵盤行為 prop**: 新增 `afterSelect: 'refocus' \| 'dismiss'`，預設 'refocus' 保留 session/[id] 與 PlotSpeciesTab 既有「選完繼續打字」流程不變；`SpeciesSearchPanel` 傳 `'dismiss'` — 選完 `inputRef.current?.blur()` + `Keyboard.dismiss()`，鍵盤收起讓 detail 完整可見。**新 memory `feedback-mobile-inline-panel-pattern`** 紀錄抽 panel + 雙 host 模式 | ✅ |
| 10.70 | **Poales S3 Poaceae 禾本科 family key** (sheet 1LvL1vBj... 續，PDF p.430-438): family-scope **121 couplets / ~120 終端** (其中 25 個 single-sp inline + ~85 個 genus pointers + 1 個 subfamily pointer Bambusoideae)。**Pre-query 117/119 resolve** (2 expected unresolved: `Bambusoideae` TaiCOL 有名但 taxon_id NULL，subfamily 級 cross-key reference 用；`Rottboellia exaltata` 已改寫成 TaiCOL accepted `Rottboellia cochinchinensis 羅氏草`)。**PDF→TaiCOL cname/拼字 採 TaiCOL** (10 處): Leptaspis banksia→**banksii** (typo), Glyceria leptolepis 假稻嫦草→**假鼠婦草**, Arrhenatherum elatius `f.`→`fo.` variegatum, Melica onoei 小野草→**小野臭草**, Milium effusum 粟草→**栗草** (粟/栗同音字), Neyraudia reynaudiana 類蘆竹→**類蘆**, Thuarea involuta 蒭蕾草→**芻蕾草** (蒭/芻 字形), Hemarthria compressa 扁鵝牛鞭草→**扁穗牛鞭草** (鵝/穗 OCR 誤), Hackelochloa granularis 玄氏草→**亥氏草**, Garnotia acutigluma 鈍穎葛氏草→**銳穎葛氏草** (鈍/銳 反義誤)。Backend 733→734 keys, 3910→4031 couplets (+1/+121)。`make mobile-db` synced。**新增 dead-ends**: 35+ Poaceae 屬待 S4 補 subkey，最大: Eragrostis 22, Digitaria 17, Paspalum 17, Ischaemum 15, Poa 14, Panicum 13, Microstegium 13。1m8C row 86 仍暫未標 (S4 Bambusoideae+各屬 subkey 待) | 🟡 S3 done |
| 10.71 | **Poales S4a Bambusoideae 竹亞科** (sheet 1LvL1vBj... 續，PDF p.439-442): subfamily-scope (worksheet 名 Bambusoideae，parser 認 genus scope 但 scope_name 正確) **42 couplets / 43 終端** (15 屬竹類: Phyllostachys ×7, Bambusa ×12 含 var., Arundinaria ×4, Dendrocalamus ×3, Schizostachyum ×2, Sinobambusa ×2, Pseudosasa ×2, Chimonobambusa/Shibataea/Yushania/Melocanna/Semiarundinaria/Thyrsostachys/Gigantochloa/Arthrostylidium 各 1)。**Pre-query 43/43 全 resolve**。**PDF→TaiCOL 採 TaiCOL** 2 處: Thyrsostachys siamensis 暹羅竹→**暹邏竹** (字異), Arthrostylidium naibunensis 內門竹→**內文竹** (TaiCOL 主名)。**1 處 PDF 偏離 TaiCOL，保留 PDF**: Bambusa edulis 烏腳綠 — TaiCOL 此 sciname 為 not-accepted 且解到 Phyllostachys edulis (孟宗竹)，與 PDF 意圖完全不同；改寫成 TaiCOL accepted **Bambusa odashimae 烏腳綠** 維持原意。**PDF typo 修**: Bambusa arundinacea PDF 芡竹→**茨竹**, Phyllostachys lithophlia→lithophila (TaiCOL spelling)。Backend 734→735 keys, 4031→4073 couplets (+1/+42)。`make mobile-db` synced。**Poaceae 仍剩 40 個 genus dead-ends** 待 S4b/c/d (Eragrostis 22, Digitaria 17, Paspalum 17, Ischaemum 15, Poa 14, Panicum/Microstegium 13, Agrostis 12, Bromus/Chloris 11, Setaria 10, 等)。1m8C row 86 仍暫未標 | 🟡 S4a done |
| 10.72 | **Poales S4b Poaceae A-D 字頭 24 個 genus subkey** (sheet 1LvL1vBj... 續，PDF p.442-448): **24 keys / 63 couplets / ~86 終端**。涵蓋: Agrostis 7c, Alopecurus 2c, Aniselytron 1c, Anthoxanthum 1c, Arthraxon 1c, Arundinella 2c, Arundo 1c, Avena 1c, Axonopus 1c, Bothriochloa 4c, Brachiaria 2c, Brachypodium 1c, **Bromus 7c**, Capillipedium 3c, Cenchrus 1c, **Chloris 6c**, Chrysopogon 1c, Cynodon 2c, Cyrtococcum 1c, Deschampsia 2c, Deyeuxia 1c, Dichanthium 1c, **Digitaria 13c**, Dimeria 1c。**Pre-query 86/86 全 resolve** (0 UNRESOLVED)。**PDF→TaiCOL 採 TaiCOL** 10 處: Agrostis dimorpholemma 多形翦股穎→**多形翦穎**, Bothriochloa macera→**macra** (spelling), Bothriochloa bladhii var. bladhii (TaiCOL 無 autonym var.)→**bladhii** (species), Capillipedium 硬稃子草→**硬稈子草**, Capillipedium spicigerum (PDF 視為 sp)→**parviflorum var. spicigerum** (TaiCOL var. 形式), Cyrtococcum patens var. patens (TaiCOL 無 autonym)→**patens** (species), Cyrtococcum patens var. latifolium (TaiCOL not-accepted)→**Cyrtococcum accrescens** (accepted), Digitaria heterantha 粗膝馬唐→**粗穗馬唐**, Dimeria 鐮形觸茅→**鐮形觿茅**, Dimeria 觸茅→**觿茅** (觿/觸 字異)。Backend 735→759 keys, 4073→4136 couplets (+24/+63)。`make mobile-db` synced。**Poaceae 剩 40 dead-end genera 全在 E-Z 字頭** 待 S4c/d (Eragrostis 22, Paspalum 17, Ischaemum 15, Poa 14, Panicum/Microstegium 13, Setaria 10, Sporobolus/Sorghum/Isachne 8, Festuca 7 等)。1m8C row 86 仍暫未標 | 🟡 S4b done |
| 10.73 | **Poales S4c Poaceae E-O 字頭 20 個 genus subkey** (sheet 1LvL1vBj... 續，PDF p.448-454): **20 keys / 69 couplets / 86 終端**。涵蓋: Echinochloa 2c, Eleusine 1c, Elymus 1c, Enteropogon 1c, **Eragrostis 19c**, Eremochloa 1c, Eriochloa 1c, Eulalia 2c, Festuca 6c, Isachne 8c, **Ischaemum 7c**, Leptatherum 2c, Leptochloa 2c, Lolium 1c, Melinis 1c, **Microstegium 8c**, Miscanthus 1c, Mnesithea 1c, Oplismenus 3c, Oryza 1c。**Pre-query 86/86 全 resolve** (0 UNRESOLVED)。**PDF→TaiCOL 採 TaiCOL** 16 處 (cname/拼字/scinmae 改寫，含 var. autonym 處理、TaiCOL 重新分類 Leptatherum→Microstegium): Echinochloa frumentacea 穇子→**湖南稷子**, Elymus formosanus 臺灣鵝觀草→**臺灣披鹼草**, Elymus shandongensis 前原鵝觀草→**Agropyron mayebaranum 前原鵝觀草** (TaiCOL accepted), Eragrostis multicaulis 多稈→**多桿畫眉草**, Isachne pulchella 異花柳葉箬→**Isachne dispar** (TaiCOL accepted), Isachne clarkei 本氏柳葉箬 (cn=null)→**Isachne beneckei** (TaiCOL accepted), Ischaemum barbatum 瘤鴨嘴草→**粗毛鴨嘴草**, Ischaemum ciliare 印度鴨嘴草→**細毛鴨嘴草**, Leptatherum nudum 竹葉茅→**Microstegium nudum** (TaiCOL 已併屬), Leptatherum somae 相馬莠竹→**Microstegium somai** (拼字+併屬), Leptochloa panicea 蝦子草→**蟣子草**, Microstegium fauriei var. fauriei→**fauriei** (species 級), Microstegium fauriei var. geniculatum→**fauriei subsp. geniculatum** (TaiCOL subsp. 形式), Mnesithea laevis var. laevis 假蛇尾草→**laevis var. cochinchinensis** (TaiCOL accepted var.), Oplismenus compositus var. compositus 竹葉草→**compositus** (species 級)。Backend 759→779 keys, 4136→4205 couplets (+20/+69)。`make mobile-db` synced。**Poaceae 剩 20 dead-end genera 全在 P-Z 字頭** 待 S4d (Paspalum 17, Poa 14, Panicum 13, Setaria 10, Sporobolus/Sorghum 8, Pennisetum 6, Schizachyrium/Themeda/Zoysia 4, 等)。1m8C row 86 仍暫未標 | 🟡 S4c done |
| 10.74 | **Poales S4d Poaceae P-Z 字頭 20 個 genus subkey → 整 Poales 目完工** (sheet 1LvL1vBj... 續，PDF p.455-461): **20 keys / 76 couplets / 96 終端**。涵蓋: **Panicum 11c**, Paspalidium 1c, **Paspalum 12c**, Pennisetum 4c, Perotis 1c, Phalaris 2c, Phragmites 1c, **Poa 10c**, Pogonatherum 1c, Polypogon 1c, Saccharum 6c, Schizachyrium 1c, **Setaria 9c**, Sorghum 4c, Spodiopogon 2c, Sporobolus 4c, Themeda 1c, Trisetum 1c, Urochloa 1c, Zoysia 3c。**Pre-query 96/96 全 resolve** (0 UNRESOLVED 除 Bambusoideae cross-key reference)。**PDF→TaiCOL 採 TaiCOL** 7 處: Panicum repens 鋪→**舖**地黍, Paspalum virgatum 粗稈→**粗桿**雀稗, Pennisetum clandestinum 鋪→**舖**地狼尾草, Saccharum sinense→**sinensis** 甘蔗 (spelling), Saccharum barberi→**Saccharum × barberi** 細稈甘蔗 (hybrid notation), Sporobolus indicus var. flaccidus 雙茲→**雙蕊**鼠尾粟 (OCR 茲/蕊), Themeda barbata 日本苞子草→**Themeda japonica** (TaiCOL accepted). **Bug 修**: Elymus 因 worksheet 內含 Agropyron mayebaranum (混屬)，parser `_detect_default_genus` 撿到 Agropyron 為 default，把 `formosanus` 誤 prepend 成 Agropyron formosanus → UNRESOLVED。修法：把 Elymus 1A target 寫全名 `Elymus formosanus 臺灣披鹼草`。**Import 流程改善**: Sheets API 60/min 讀取限制，import 65+ worksheets 中間需要 sleep；inline 加 `if idx > 0 and idx % 50 == 0: time.sleep(65)` 解決 (workflow only, 已 revert)。Backend 779→799 keys, 4205→4281 couplets (+20/+76)。`make mobile-db` synced。**Poaceae family-key dead-end 完全清零** (40→0)。**整 Poales 禾本目完工**: 5 S1 小科 + 14 Cyperaceae + 1 Poaceae family + 1 Bambusoideae + 64 Poaceae 屬 subkey = **85 keys / 599 couplets / 600+ sp**。**1m8C row 86 done=TRUE 已標**。**已知 caveat**: (a) Fimbristylis couplet 9-31 (~22sp) 在 PDF 結構上 orphan，無 incoming arrow (PDF 印刷遺漏；mobile UI 列表可進入但 keying 流程 1A/1B→5 後無法回到 9+)；(b) TaiCOL 收 439 個 in-Taiwan Poaceae sp/var.，keys 覆蓋 365 (83%)，缺 74 種主要為 TaiCOL 後續新增、species-vs-autonym 兩層 (PDF 只寫 var. autonym 時 TaiCOL species 級沒被引用)、`'Stripe'` 等竹類栽培品系、TaiCOL 拆種而 PDF 未列。覆蓋 gap 非 dead-end，是 TaiCOL granularity > PDF | ✅ Poales 完工 |
| 10.95 | **TaiCOL 20260424 名錄更新匯入 + import 流程強化 (hierarchy backfill)**：(1) **Import 20260424 release**: 95,994→96,179 distinct taxon_id (+184)、251,540 name rows、22 新植物全進。Backup: `backend/twnamelist.db.preimport-20260424` + 自動 `.bak.{ts}`。Mobile bundle synced (cname_fuzzy_index 62809→62997, +188)。(2) **4 個新 stale IK leads** (TaiCOL 合併重組): Urticaceae 16B Pellionia→Elatostema 樓梯草屬 / Paris 3B taitungensis→lancifolia 高山七葉一枝花 / Angelica 5B nanhutashanensis→morrisonicola 玉山當歸 / Cirsium 12A australe (sciname 同, tid 換 t0087363→t0053017 re-import 該 sheet 即自動 resolve)。**4 raw sciname fallback 新出現** (Ainsliaea 3 var. + Blumea chishanensis), 待 user 手動修。(3) **核心 bug 發現+修補: TaiCOL 對新發表種偶不填高階階層** (e.g. t0124236 Amydrium medium 鈍裂雷公連 kingdom/phylum/class/order/family 全空)，導致 mobile App 搜尋「維管束植物」filter + 分類樹瀏覽都看不到該物種。**全類群通用 fix** (動物/植物/真菌/細菌一視同仁) — 加 import Stage 2b + 2c + Step 4 三段:
- **Stage 2b** `_backfill_hierarchy_from_siblings()`: cross-join 同 genus 內已填的 row 推導缺漏欄 (例 Pollia 8 rows / Serpula 3 / Stilbum 2 自動補完)。SQL `COALESCE(NULLIF(col,''), ?)` 保證不覆蓋已有值。
- **Stage 2c** `_backfill_hierarchy_overrides()`: 對 TaiCOL CSV 全 sibling 都空白的 case (e.g. 2026-04 釋出時 Amydrium / Kallstroemia 屬尚未填高階)，從 `backend/services/taicol_hierarchy_overrides.json` 讀手動 genus→hierarchy mapping。Seed 4 屬: Amydrium (Araceae 天南星科, 鈍裂雷公連) / Kallstroemia (Zygophyllaceae 蒺藜科, 大番蒺藜) / Japanobotrychum (Ophioglossaceae 瓶爾小草科) / Hystrix (Hystricidae 豪豬科, 動物)。
- **Step 4** `_warn_missing_hierarchy()`: 掃 in-Taiwan accepted taxa 仍缺 phylum 但 genus 已填的 row，warn 出 (剩 4: Haemoproteus 動物寄生蟲 / Monomelangium 蕨類但無 species / Symbiothallus×2 細菌)。API response 加 `sibling_filled_rows` / `hierarchy_filled` / `hierarchy_warnings` 三 field。
(4) **手動 cname patch**: Angelica aliensis (t0124223) TaiCOL 漏填俗名，UPDATE 補入「阿禮當歸」。(5) IK 表完全不動 (896 keys / 5076 couplets / 7 aliases / 29 features / 454 taxon-features) — schema 隔離。99.93% IK refs 維持完整 (5636/5640) | ✅ |
| 10.94 | **Berberidaceae 小檗科 多重檢索條件 (multi_access matrix) 完工 + parser 預設行為改動**：(1) **資料填入** (Berberidaceae_m sheet row 15-17): Mahonia oiwakensis 阿里山十大功勞 (Flora of Taiwan 2 ed. 描述) / Mahonia tikushiensis 竹子山十大功勞 (用 Flora "M. japonica" 廣義描述對應, TaiCOL 視為獨立 sp) / Dysosma pleiantha 八角蓮 (草本盾狀單葉、深紫紅花、落葉)。**新值**: 葉形「盾狀」、果形「卵形」、成熟莖「綠色」(草本)。Berberis ravenii (sheet typo: ranvenii→ravenii) 修正。(2) **Parser 預設行為改動** (`backend/services/key_sheet_import.py` `_detect_feature_type`): 移除 `MATRIX_CATEGORICAL_MAX_DISTINCT=8` / `MATRIX_TEXT_RATIO=0.6` 兩條 fallback 到 text 的閾值。原本 12 distinct values 的合理 morphology column (葉形 12 種、成熟莖 11 種) 被誤判為 text → mobile UI 顯示「說明欄位（不參與篩選）」。**新規則**: 非 numeric column 一律 categorical, distinct 全部進 chip palette。text 只回傳給空 column 或 meta `feature_types` `{"分布":"text"}` 明確 override 的特殊欄位。Reason: 多重檢索條件設計意圖是「除學名/俗名外，全 column 都應參與 filter」。(3) **Schema 影響**: Berberidaceae_m 21 features 全 categorical/numeric (從 19 cat/num + 2 text → 21 全 cat/num)，UI feature panel 全可篩。Backend 894→896 keys (Berberidaceae_m mode=multi_access id=2978 新建; 其餘 18 keys 為既有 dichotomous re-import)。`make mobile-db` synced。Mobile UI 冷啟動 (asset bundle DB re-copy) 後 21 features 全顯示為可點選 filter chip | ✅ |
| 10.93 | **檢索表 cross-key navigation: parser rank 後綴 + aliases 欄位 + mobile lead-text fallback** (解 Ident_keys.md §5.1.1 Type A/C 不可達 subkey)。(1) **Parser `_detect_scope_from_name`** 認 ICN 後綴: `*aceae`→family / `*oideae`→subfamily / `*eae`→tribe / else→genus。同步 `_detect_default_genus` 不再對 *oideae/*eae 名 fallback 當 default_genus。(2) **Schema migration**: `identification_keys` 加 `aliases TEXT` (JSON array) (`backend/models/schema.py` + 既有 DB `ALTER TABLE`)。(3) **Meta sheet aliases 支援**: `parse_meta_worksheet` 兼容單行 (spreadsheet-wide) 與多行 `worksheet|aliases` per-worksheet override 兩種 layout；`_aliases_for(meta, ws_name)` helper 處理 comma-separated → JSON array string。(4) **Mobile `findSubkeyByScopeName(token, preferredRank?)`** (`mobile/app/src/db/keys.ts`)：新 helper，`scope_name=? OR EXISTS(json_each(aliases) WHERE value=?)`，rank specificity 排序 (genus>subfamily>family)。**`findSubkeyForTaxon` 加 3 級 fallback**: exact match → any scope_rank match (cover Davalliaceae=Davallia 單屬科命名分歧) → 同 tid 的 not-accepted alt sciname 取 first token (cover Amauropelta→Parathelypteris TaiCOL 屬移)。(5) **`findSubkeyFromLeadText`** lead 第一個 Latin token 試 lookup (cover Bambusoideae 從 Poaceae 跨 key 導覽)。(6) **Key runner 預 cache 修補** (`mobile/app/app/key/[id].tsx`)：subkeyCache pre-fetch 時若 `getKeyTaxonInfo(tid)` 為 null (parser 把 raw sciname fallback 存進 target_id) 改用 `findSubkeyByScopeName(tid)` 再試。(7) **Bambusoideae rank 修正**: UPDATE 既有 entry scope_rank 從 genus→subfamily。(8) **Alias seeds**: Davalliaceae/Nephrolepidaceae/Dioscoreaceae/Aspleniaceae/Woodsiaceae/Selaginellaceae (單屬科) + Bambusoideae (中文「竹亞科」) 各填一筆 aliases。**Cumulative 效果**: §5.1.1 Type A 9 屬 + Type C 中 5 屬 navigation 立即恢復。Test: `_detect_scope_from_name` 4 cases / `_aliases_for` 3 cases / SQL alias lookup 3 cases 全 pass。Mobile type check 通過。`make mobile-db` synced (62809 cnames) | ✅ |
| 10.92 | **Polypodiales S9 Thelypteridaceae 金星蕨科 → 整 Polypodiales 水龍骨目完工** (sheet 1GlL4KWL... 續，PDF p.68-71): **12 keys / 48 couplets / 48sp + 5 inline**。family 16c (11 屬 pointer + 5 inline: Cyclosorus interruptus 毛蕨/Pneumatopteris truncata 稀毛蕨/Ampelopteris prolifera 星毛蕨/Glaphyropteridopsis erubescens 方桿蕨/Coryphopteris japonica 栗柄金星蕨) + Christella 7c/8sp + Cyclogramma 1c/2sp + Macrothelypteris 1c/2sp + Metathelypteris 4c/5sp + Parathelypteris 3c/4sp + Phegopteris 2c/3sp + Pronephrium 6c/7sp + Pseudocyclosorus 1c/2sp + Pseudophegopteris 2c/3sp + Sphaerostephanos 1c/2sp + Stegnogramma 4c/5sp。Pre-query 48/48 全 resolve。**PDF→TaiCOL 採 TaiCOL 17 處**: (a) sciname 改寫 11 — `Christella ensifer`→**ensifera** (typo); `Cyclogramma omeiensis`→**Thelypteris omeiensis** (屬移; PDF 狹基鉤毛蕨→**擬茯蕨**); Parathelypteris 4 sp 全屬移到 Amauropelta/Coryphopteris (beddomei→**Amauropelta beddomei**, angulariloba→**Coryphopteris angulariloba**, grandulligera typo→**Amauropelta glanduligera**, angustifrons→**Amauropelta angustifrons**); Pronephrium 2 sp 屬移 (cuspidatum→**Grypothrix ramosii** cn 頂芽→**琉球**, insularis→**Chrinephrium insulare** cn 變葉→**變葉新月小毛蕨**); `Pseudophegopteris paludosa`→**hirtirachis** (cn 毛紫柄→**毛囊紫柄**); `Stegnogramma totooides`→**Leptogramma tottoides** (拼字+屬移; cn 尾羽→**尾葉**茯蕨); `Stegnogramma pozoi 非洲茯蕨`→**Leptogramma mollissima 毛葉茯蕨** (TaiCOL 無 species 級 pozoi)。(b) cname 採 TaiCOL 6 — Christella papilio 縮羽→**薄葉梳**小毛蕨, Macrothelypteris polypodioides 杪欏→**桫欏**, Phegopteris decursivepinnata 短柄假金星→**短柄卵果**, Phegopteris taiwaniana 台→**臺**, Pronephrium triphyllum 三葉新月→**新月**, Pseudophegopteris levingei 高山→**星毛**紫柄。**Mixed-genus rule** 適用 4 worksheet: Cyclogramma (Thelypteris+Cyclogramma)、Parathelypteris (4 sp 全 Amauropelta/Coryphopteris)、Pronephrium (Pronephrium+Grypothrix+Chrinephrium)、Stegnogramma (Stegnogramma+Leptogramma) 全用完整 Genus。**新 UNRESOLVED warn-only**: family 16A `Parathelypteris 副金星蕨屬` — TaiCOL 屬層 not-accepted (4 sp 全屬移)，類同 Phymatosorus 處理保留 PDF 屬名以維 navigate。Backend 882→894 keys, 5028→5076 couplets (+12/+48)。`make mobile-db` synced。**整 Polypodiales 水龍骨目完工**: 9 segments / **72 keys / 661 couplets** (S1 5/18 + S2 13/86 + S3 3/57 + S4 4/71 + S5 2/22 + S6 7/148 Dryopteridaceae + S7 14/110 Polypodiaceae + S8 12/101 Pteridaceae + S9 12/48 Thelypteridaceae) | ✅ S9 done / 整 Polypodiales 完工 |
| 10.91 | **Polypodiales S8b Pteridaceae Adiantum + Pteris 兩大屬** (sheet 1GlL4KWL... 續，PDF p.59-65): **2 keys / 59 couplets / 59 終端**。Adiantum 17c/17sp + 1 missing (13A PDF 印刷遺漏); Pteris 42c/42sp。Pre-query 全 resolve。**Adiantum 17c**: PDF 1-17 couplets。**PDF→TaiCOL 採 TaiCOL 2 處**: `Adiantum roborowskii var. taiwanianum 臺灣高山鐵線蕨`→**Adiantum taiwanianum 臺灣鐵線蕨** (var. dropped + cn 高山 dropped); `Adiantum roborowskii var. faberi 峨眉鐵線蕨`→**峨嵋鐵線蕨** (眉→嵋)。**Caveat 13A**: PDF couplet 13A "羽片兩面被黑褐色硬質剛毛" target 為空 (PDF 印刷遺漏)；推測為 **Adiantum diaphanum 長尾鐵線蕨** (feature 描述吻合 + TaiCOL 此 sp 存在 + 為 Adiantum 屬唯一未列入 PDF 的 sp)。Sheet 填入 diaphanum 長尾鐵線蕨，並記入 Ident_keys.md。**Pteris 42c**: PDF 1-42 couplets。**PDF→TaiCOL 採 TaiCOL 9 處**: amoena→**tokioi** (TaiCOL accepted; cn 鈴木氏鳳尾蕨 同); fauriei var. minor 小傅氏鳳尾蕨→**Pteris minor 海岸鳳尾蕨** (PDF 重排 couplet 14B 採 P. minor); grevilleana var. ornata→**fo. ornata** (var.→fo.); dimorpha var. dimorpha 二型→**二形**鳳尾蕨; austrotaiwanensis 南臺灣→**南台灣**鳳尾蕨 (臺→台); fauriei var. fauriei→**fauriei** species 級; (3 處 cname 採 TaiCOL: 略)。**新 sp 發現**: PDF p.63 中含 `Pteris pseudowulaiensis 擬烏來鳳尾蕨` (couplet 14B) + `Pteris austrotaiwanensis 南台灣鳳尾蕨` (couplet 18B) 兩 sp 在初次 audit 漏列，書 visual read 後補入。**Cross-couplet duplicate**: 37A `esquirolii 闊葉鳳尾蕨` + 37B `cretica subsp. laeta 粗糙鳳尾蕨` 解到同一 TaiCOL taxon_id t0026508 (PDF 區分 / TaiCOL 合併); 32A/36A `ryukyuensis 琉球鳳尾蕨` 兩 lead 同種。**Sheets API 429 quota 中斷**: Polypodiales sheet 累計 71 worksheets, 60/min read quota 超限，retry loop 誤判 "Quota" 為終止訊號未繼續 import。修法: 等 65s cooldown 後重 import，成功。Backend 880→882 keys, 4969→5028 couplets (+2/+59)。`make mobile-db` synced | ✅ S8b done |
| 10.90 | **Polypodiales S8a Pteridaceae 鳳尾蕨科 family + 9 小/中型屬** (sheet 1GlL4KWL... 續，PDF p.59-65 (book p.59-65)): **10 keys / 42 couplets / 42sp + 6 inline**。family 17c (10 屬 pointer + 6 inline sp: Parahemionitis arifolia 澤瀉蕨/Acrostichum aureum 鹵蕨/Paragymnopteris vestita 金毛裸蕨/Pityrogramma calomelanos 粉葉蕨/Anogramma leptophylla 翠蕨/Doryopteris concolor 黑心蕨) + Aleuritopteris 3c/4sp + Antrophyum 5c/6sp + Ceratopteris 1c/2sp + Cheilanthes 2c/3sp + Coniogramme 3c/4sp + Cryptogramma 1c/2sp + Haplopteris 7c/8sp + Onychium 2c/3sp + Vaginularia 1c/2sp。Pre-query 42/42 全 resolve。**PDF→TaiCOL 採 TaiCOL 13 處**: (a) sciname 改寫 5 — `Antrophyum parvulum`→**immersum** (TaiCOL accepted, PDF "無柄車前蕨(小車前蕨)" 採 TaiCOL 小車前蕨); `Cheilanthus`/`Cheilanthus hirsuta`→**Cheilanthes/Cheilanthes nudiuscula** (TaiCOL accepted spelling + species); `Pteris amoena` 鈴木氏鳳尾蕨→S8b 再處 (Pteris tokioi accepted); (b) cname 採 TaiCOL 8 處 — Antrophyum sessilifolium 蘭嶼→**無柄**車前蕨, A. castaneum 阿里山→**栗色**車前蕨, Ceratopteris gaudichaudii var. vulgaris 姬水蕨→**北方水蕨**, Haplopteris mediosora 細葉→**中孢**書帶蕨, Vaginularia 屬名一條線→**針葉**蕨 ×2 (trichoidea 一條線→針葉蕨, junghuhnii 連孢一條線→連孢針葉蕨)。**Cheilanthus PDF→Cheilanthes 改寫**: PDF 整段用 `Cheilanthus` (拉丁文非標準寫法)，TaiCOL accepted spelling 為 **Cheilanthes**，worksheet 名 + 物種 sciname 全部改 (3 sp: tenuifolia, chusana, nudiuscula)。Backend 870→880 keys, 4927→4969 couplets (+10/+42)。`make mobile-db` synced | ✅ S8a done |
| 10.89 | **Polypodiales S7b Polypodiaceae 水龍骨科 剩 6 屬 → 整 Polypodiaceae 完工** (sheet 1GlL4KWL... 續，PDF p.54-57): **6 keys / 40 couplets / 45sp**。Neocheiropteris 1c/2sp + Oreogrammitis 15c/17sp + Phymatosorus 2c/3sp + Prosaptia 6c/7sp + Pyrrosia 9c/10sp + Selliguea 7c/8sp。Pre-query 45/45 全 resolve。**PDF→TaiCOL 採 TaiCOL 21 處**: (a) sciname 改寫 7 處 — `Neocheiropteris ensata`→**Neolepisorus ensatus** (盾蕨; PDF cn 扇蕨 亦改), `Neocheiropteris fortunei`→**Neolepisorus fortunei**, `Oreogrammitis blechnigrons`→**Oreogrammitis curtisii** (PDF typo), `Oreogrammitis nuda`→**Glabrigrammitis subevenosa** (屬移), `Phymatosorus longissimus`→**Leptochilus longissimus** (屬移), `Phymatosorus membranifolius`→**Leptochilus nigrescens** (屬移 + 種名變), `Phymatosorus scolopendria`→**Microsorum scolopendria** (屬移; PDF cn 海岸擬茀蕨→**海岸星蕨**), `Pyrrosia polydactyla`→**polydactylos** (拼字), `Selliguea taeniata`→**falcatopinnata** (TaiCOL accepted), `Selliguea okamatoi`→**okamotoi** (拼字)。(b) cname 採 TaiCOL 14 處 — Oreogrammitis setigera 剛毛輻禾蕨→**大禾葉蕨**, O. taiwanensis 臺灣輻禾蕨→**臺灣禾葉蕨**, O. moorei 牟氏輻禾蕨→**牟氏禾葉蕨**, O. caespitosa 穴孢濱禾蕨→**穴孢禾葉蕨**, Prosaptia pectinata 蓖齒→**篦齒**穴子蕨, Pyrrosia 韋→葦 (sheareri/matsudae/linearifolia/porosa/lingua 五處主名差異 + porosa PDF 中國石韋→TaiCOL **柔軟石葦** alt 中國石韋)。**Caveat**: (a) Phymatosorus 三 sp 雖屬已 TaiCOL defunct (taxon_id NULL 已知)，但物種 accepted 名分別在 Leptochilus/Microsorum，sheet 寫 TaiCOL accepted 維持資料一致; (b) Neocheiropteris worksheet 名保留以鏈 PDF family pointer，內部物種寫 Neolepisorus 全名 (mixed-genus rule); (c) Pyrrosia matsudae 為 cross-couplet duplicate (3B + 9B 同種, PDF 兩條鍵控路徑)。Backend 864→870 keys, 4887→4927 couplets (+6/+40)。`make mobile-db` synced。**整 Polypodiaceae 完工**: 14 keys / 110 couplets (family 34c + 13 屬 subkey 76c) | ✅ S7b done / Polypodiaceae 完工 |
| 10.88 | **Polypodiales S7a Polypodiaceae 水龍骨科 family + 7 中型屬** (sheet 1GlL4KWL... 續，PDF p.49-53): **8 keys / 70 couplets / 54sp**。family 34c (12 屬 + 4 inline: Platycerium bifurcatum 二叉鹿角蕨/Lemmaphyllum microphyllum 伏石蕨/Lemmaphyllum rostratum 骨牌蕨/Arthromeris lehmanni 肢節蕨/Scleroglossum sulcatum 革舌蕨/Micropolypodium okuboi 梳葉蕨/Xiphopterella devolii 劍羽蕨/Chrysogrammitis glandulosa 金禾蕨/Tomophyllum subfalcatum 虎尾蒿蕨/Dasygrammitis mollicoma 毛禾蕨) + Calymmodon 2c/3sp + Drynaria 2c/3sp + Goniophlebium 6c/7sp + Lepisorus 11c/12sp + Leptochilus 7c/8sp (含 Leptochilus × shintenensis 新店線蕨 hybrid) + Loxogramme 6c/7sp + Microsorium 2c/3sp。Pre-query 54/54 全 resolve。**PDF→TaiCOL 採 TaiCOL 15 處**: Lepisorus 瓦韋→**瓦葦** ×8 (整屬 cname 統一改, Unicode `韋`→`葦`), Platycerium bifurcatum 鹿角蕨→**二叉鹿角蕨**, Tricholepidium buergerianum 波氏星蕨→**Tricholepidium buergerianum 波氏星蕨** (PDF 攀援星蕨 為別名), Micropolypodium okuboi 桅葉蕨→**梳葉蕨**, Chrysogrammitis 擬虎尾蒿蕨→**金禾蕨**, Dasygrammitis 南洋蒿蕨→**毛禾蕨**, Leptochilus insignis 箭星蕨→**箭葉星蕨**。**Transcription 修**: `Lepisorus. kawakamii`/`Leptochilus. pothifolius` 多餘句點 ×2 修正。**Caveat**: (a) Microsorium TaiCOL accepted spelling 為 **Microsorum** (無第二 i)，PDF 仍用 Microsorium；species 透過 `_resolve_taxa` non-accepted fallback OK，subkey worksheet 沿用 PDF 名稱以維持 navigate 一致；mobile UI 顯示時應走 accepted name redirect。(b) Phymatosorus 屬於 TaiCOL 已 defunct (taxon_id NULL, 物種全 not-accepted/misapplied 解到 Microsorum/Selliguea)，family 22A target `Phymatosorus 瘤蕨屬` import UNRESOLVED warn-only，subkey 仍會在 S7b 建以維持 PDF 流程完整。Backend 856→864 keys, 4817→4887 couplets (+8/+70)。`make mobile-db` synced (62809 cnames) | ✅ S7a done |
| 10.87 | **檢索表 runner state 持久化**：使用者報「離開 key 跳到分類樹再回來，無法記住上次檢索到的位置與階段」。實作走現有 `settings` 表（user.db SQLite，跟 `key_recent_ids` / `taxonomy_expanded` 同 pattern）。`src/stores/settings.ts` 新增 `KeyRunnerStateLite` type（`path: number[]` + `terminal` discriminated union，跟 runner 內部 `RunnerState` 同 shape JSON-roundtrip 安全）；`SettingsValues` 加 `key_runner_states: Record<string, KeyRunnerStateLite>` 欄位（key=String(keyId)）；`readAll()` 解析 JSON；新增 `getKeyRunnerState(keyId)` / `setKeyRunnerState(keyId, runner)` module-level helper（同 `pushRecentKey` pattern，無需 React subscribe）。`pushRecentKey()` 加 side effect：當 id 從 recent 10 名擠掉時順手刪掉它的 runner state，避免持久化無限長（連續開超過 10 把 key 時最早那把被清狀態屬可接受 UX）。`app/key/[id].tsx` 替換原本「path 為空就 setState 第一條 couplet」的初始化 effect 為 hydrate effect：`hydratedRef` 一次性 gate，couplets + settings 都載完才執行，讀 persisted 後逐一驗證 path 中 couplet number 都還在 `coupletByNumber`，全 valid 才套用，否則（沒存過 or DB 重 import 後 couplet 重編號）fallback 到第一條 couplet 並覆寫 storage 自我修復；新增 persist effect 在 state 變動即寫 settings（op-sqlite sync write 在這 volume 不用 debounce）；hydratedRef gate 防止 hydrate 前的初始空 state 覆寫 storage。**驗證**: 跑到第 N 步 → 切 tab → 回來仍在第 N 步 + breadcrumb 全在；terminal taxon card 也持久化；kill app 重啟仍記得（資料在 user.db `settings` 表 key='key_runner_states'，「清除所有資料」會一併清掉）；「重來」按鈕回到 #1 後也 persist。type check 通過 | ✅ |
| 10.86 | **分類樹同名 (homonym) 跨 kingdom 串檔 bug 修正**：使用者報「Taiwania 屬可能是植物的台灣杉，也可能是 Pompilidae 蛛蜂科的 Taiwania 屬，分類樹會混在一起」。根因：`getTaxonChildren()` 與 `getSpeciesUnder()` (`src/db/taxonomy.ts`) WHERE 只 filter 直接父層（`genus = 'Taiwania'` 之類），不帶 kingdom/phylum/.../family 等更高階祖先。ICN（植物）與 ICZN（動物）兩套命名法規不互相 enforce uniqueness，homonym 在 genus 層尤其常見（Pieris 杜鵑/粉蝶、Aotus 豆科/夜猴 等）。連帶 `nodeKey = ${rank}:${name}` 也 collide：兩棵 Taiwania 樹共用 expanded/childrenMap/speciesMap 條目，後寫入覆蓋前者。**修法**：(a) `taxonomy.ts` 新增 `Ancestors = Partial<Record<Rank, string>>` type、`nodeKeyFor(node)` helper（產 `kingdom:Plantae\|phylum:Tracheophyta\|...\|genus:Taiwania` 全路徑 key）、`buildAncestorWhere(ancestors, params)`（iterate `RANK_ORDER` 把每個有值 rank 都 AND 進去）。`TaxonNode` 用 `ancestors: Ancestors` 取代舊 `parent_rank/parent_value`。`getTaxonChildren({ rank, ancestors })` + `getSpeciesUnder(ancestors)` 都改吃完整祖先 map，回傳 child rows 都帶 `ancestors`（複用 caller 傳進來的）。(b) `app/(tabs)/taxonomy.tsx`：移除 local `nodeKey(rank,name)` 改用 `nodeKeyFor(node)`，`loadInto(node)` 算 `childAncestors = { ...node.ancestors, [node.rank_key]: node.name }` 傳給 SQL；`handleSearchPick` synthesize node 時第 i 個 path entry 的 ancestors = path[0..i-1] reduce 而成，scrollToIndex targetKey 也用 nodeKeyFor 算；roots 載入也用 nodeKeyFor 入 nodeMap。(c) **舊 persisted `taxonomy_expanded` 副作用**：舊版 key 是 `${rank}:${name}` 格式不含祖先，新版要全路徑才會 match。kingdom 層展開狀態仍 OK（root key 兩版同形），phylum 以下需重新展開一次。Garbage entries 留在 settings 不會 crash 也不會誤展，新展開時會以新格式覆寫，可接受的一次性 UX cost。type check 通過 | ✅ |
| 10.85 | **Polypodiales S6c Dryopteridaceae Polystichum 耳蕨屬 → 整 Dryopteridaceae 完工** (sheet 1GlL4KWL... 續，PDF p.35-38): **1 key / 41 couplets / 42 終端**。Pre-query 41/41 全 resolve。**PDF→TaiCOL 採 TaiCOL 7 處**: temuius→**tenuius** (拼字), × gemmilachenense→**Polystichum lachenense × Polystichum stenophyllum** (TaiCOL accepted hybrid formula), 芽胞→**芽孢**耳蕨/擬芽孢耳蕨 ×2, 長羽芽胞蕨→**長羽芽孢耳蕨**, 鏈葉→**鐮葉**耳蕨, 蝕葉→**蝕蓋**耳蕨。Backend 855→856 keys, 4776→4817 couplets (+1/+41)。`make mobile-db` synced。**整 Dryopteridaceae 完工**: 7 keys / 148 couplets (family 12c + Arachniodes 8c + Bolbitis 8c + Cyrtomium 8c + Elaphoglossum 5c + Dryopteris 66c + Polystichum 41c) | ✅ S6c done / Dryopteridaceae 完工 |
| 10.84 | **Polypodiales S6b Dryopteridaceae Dryopteris 鱗毛蕨屬** (sheet 1GlL4KWL... 續，PDF p.30-35): **1 key / 66 couplets / 67 終端**。Pre-query 67/67 全 resolve。PDF→TaiCOL 採 TaiCOL 4 處: cycadina 杪欏→**桫欏鱗毛蕨**, lepidopoda 厚鱗毛蕨→**厚葉鱗毛蕨**, alpestris 腺鱗蕨→**腺鱗毛蕨**, komarovii 近多→**近多鱗鱗毛蕨**。Backend 854→855 keys, 4710→4776 couplets (+1/+66)。`make mobile-db` synced | ✅ S6b done |
| 10.83 | **Polypodiales S6a Dryopteridaceae 鱗毛蕨科 family + 4 中型屬** (sheet 1GlL4KWL... 續，PDF p.27-29): **5 keys / 41 couplets / 31sp** (+ 3 inline: Pleocnemia winitii/Lastreopsis tenera/Ctenitis 屬 single-sp 終端)。family 12c (9 屬 + 2 inline) + Arachniodes 8c/8sp + Bolbitis 8c/8sp + Cyrtomium 8c/9sp + Elaphoglossum 5c/6sp。Pre-query 33/33 全 resolve。PDF→TaiCOL 採 TaiCOL 4 處: Bolbitis heteroclite→**heteroclita** (拼字), B. sculpturata→**scalpturata** (拼字), B. lianhuachihensis 蓮花池→**蓮華池實蕨**, Bolbitis 7B → 8 (PDF couplet 9 結構漏)。Backend 849→854 keys, 4669→4710 couplets (+5/+41)。`make mobile-db` synced | ✅ S6a done |
| 10.82 | **Polypodiales S5 Tectariaceae 三叉蕨科** (sheet 1GlL4KWL... 續，PDF p.66-68): **2 keys / 22 couplets / 22 sp**。family 2c + **Tectaria 20c/20sp** + Arthropteris 1sp inline + Pteridrys 1sp inline。Pre-query 22/22 全 resolve。PDF→TaiCOL 採 TaiCOL 2 處: Pteridrys cnemidaria 長柄牙蕨→**突齒蕨**, Tectaria simonsii 紫葉→**紫柄三叉蕨**。Backend 847→849 keys, 4647→4669 couplets (+2/+22)。`make mobile-db` synced | ✅ S5 done |
| 10.81 | **Polypodiales S4 Athyriaceae 蹄蓋蕨科** (sheet 1GlL4KWL... 續，PDF p.15-20): **4 keys / 71 couplets / 69 sp**。family 2c + **Athyrium 31c/30sp** + Deparia 7c/8sp + **Diplazium 31c/31sp**。Pre-query 65/69 全 resolve (4 sciname 修正 + 1 TaiCOL cn=null 保留 Diplazium proliferum)。**PDF→TaiCOL 採 TaiCOL 13 處**: Athyrium decurrentialatum var. pilosellum 毛軸貞蕨→**毛葉貞蕨**, Athyrium philippinense→**Cornopteris philippinensis** (移屬), Athyrium niponicum 日本安蕨→**日本蹄蓋蕨**, Athyrium sheareri 棗東→**華東安蕨**, Athyrium oppositipinnum var. oppositipinnum→species 級 (TaiCOL 無 autonym), Deparia lancea 對囊蕨→**單葉對囊蕨**, Deparia petersenii 假鱗蕨→**假蹄蓋蕨**, Deparia longipes 昆明→**逆羽假蹄蓋蕨**, Diplazium metteniam→**mettenianum** (拼字), Diplazium hadijoense→**hachijoense** 薄蓋雙蓋蕨, Diplazium virescens 刺鱗→**刺柄雙蓋蕨**, Diplazium chinense 中華→**華雙蓋蕨**。**Bug 修**: Athyrium 內含 Cornopteris philippinensis 觸發 mixed-genus default_genus bug，parser 取 Cornopteris 為 default 把所有 bare epithet 誤 prepend；修法全 31 個 Athyrium row 寫全名 (per feedback-ik-sheet-conventions rule)。Backend 843→847 keys, 4576→4647 couplets (+4/+71)。`make mobile-db` synced | ✅ S4 done |
| 10.80 | **Polypodiales S3 Aspleniaceae 鐵角蕨科** (sheet 1GlL4KWL... 續，PDF p.10-14): **3 keys / 57 couplets / 51 sp** (PDF 標 52 sp)。family 1c + **Asplenium 48c/42sp** + Hymenasplenium 8c/9sp。Pre-query 51/51 全 resolve。**PDF→TaiCOL 採 TaiCOL 10 處**: Asplenium australasicum 南洋山蘇花→**東洋山蘇花**, Asplenium boreale 北方鋼掛→**北方倒掛鐵角蕨** (PDF typo), A. lobulatum 裂葉→**大蓬萊鐵角蕨**, A. pseudolaserpitiifolium 黑鱗→**大黑柄鐵角蕨**, Hymenasplenium cataractarum 端生→**湍生鐵角蕨**, H. subnormale 小鐵角蕨→**小膜葉鐵角蕨**, H. apogamum 無配→**無配膜葉鐵角蕨**, H. obscurum 綠柄剪葉→**尖峰嶺膜葉鐵角蕨**, H. excisum 剪葉→**剪葉膜葉鐵角蕨**, H. obliquissimum 蔭濕→**陰濕膜葉鐵角蕨**。**Bug 修 (S1 hand-off)**: 第一輪 Asplenium 漏抄 PDF couplet 9 (1 回 vs 2 回+ 分裂)，整個編號從 9 之後 shift；重寫 48 couplets 修正。同時發現 S1 Davalliaceae + Woodsiaceae 單屬 family-scope 用裸 epithet 因 `aceae` 後綴 parser 不 fallback worksheet name 為 default_genus → 全 UNRESOLVED；修法寫全名 (memory feedback-ik-sheet-conventions 已紀錄此 family-scope 規則)。Backend 840→843 keys, 4537→4576 couplets (+3/+39)。`make mobile-db` synced | ✅ S3 done |
| 10.79 | **Polypodiales S2 4 中型家族** (sheet 1GlL4KWL... 續，PDF p.21/23-26/44-46/49-51/70): **13 keys / 86 couplets / 73 sp**。Blechnaceae 10c/11sp + Lindsaeaceae family 3c + Lindsaea 13c + Odontosoria 4c + Osmolindsaea 1c + Tapeinidium 1c (Lindsaeaceae 4 屬 22sp) + Nephrolepidaceae 5c/6sp + Dennstaedtiaceae family 6c + Dennstaedtia 3c + Hypolepis 3c + **Microlepia 17c/18sp** + Monachosorum 1c + Pteridium 1c。Pre-query 69/69 全 resolve。**PDF→TaiCOL 採 TaiCOL 25 處** (Woodwardia 狗脊→狗脊蕨 ×3, Lindsaea/Osmolindsaea 陵齒→鱗始蕨 11 處, 各種 hybrid notation 修正 ×bipinnata→marginata var. bipinnata / Lindsaea heterophylla→×heterophylla / Odontosoria yueyamensis→yaeyamensis / Nephrolepis hipocrepicis→hippocrepicis / Microlepia intramarginalis 去 ×, Microlepia obtusiloba 闊翅→團羽鱗蓋蕨, trapeziformis 針毛→斜方, Pteridium aquilinum subsp. wightianum 鱗大蕨→巒大蕨)。Backend 827→840 keys, 4451→4537 couplets (+13/+86)。`make mobile-db` synced | ✅ S2 done |
| 10.78 | **Polypodiales S1 9 小家族** (sheet 1GlL4KWL...，1m8C row 11，PDF p.22/23/26/43/45-47/66/72): **5 keys / 18 couplets / 23 sp** (+ 4 個 1sp inline 無 key: Diplaziopsidaceae 腸蕨 / Oleandraceae 蓧蕨 / Onocleaceae 東方莢果蕨 / Rhachidosoraceae 軸果蕨)。Cystopteridaceae 5c/6sp + Davalliaceae 8c/9sp + Hypodematiaceae 2c/3sp + Lomariopsidaceae 1c/2sp + Woodsiaceae 2c/3sp。Pre-query 27/27 全 resolve。PDF→TaiCOL 採 TaiCOL 5 處: Acystopteris tenuisecta 粗柄亮毛蕨→**禾稈亮毛蕨**, Davallia griffithiana 杯狀蓋陰石蕨→**杯狀蓋骨碎補**, D. trichomanoides 海州→**海洲骨碎補**, D. cumingii 鱗葉陰石蕨→**陰石蕨**, Leucostegia amplissima 廣大膜蓋蕨→**大大膜蓋蕨**, Lomariopsis honinensis→**boninensis** (拼字)。Backend 822→827 keys, 4433→4451 couplets (+5/+18)。`make mobile-db` synced | ✅ S1 done |
| 10.77 | **Polypodiopsida 9 小型 orders 批次完工** (1m8C rows 5/6/7/8/9/10/12/13/14, PDF p.26/38-42/46-48/58/65-68/72-73): **19 keys / 81 couplets / ~95 終端**。涵蓋: Equisetales 1k (Equisetaceae 1c/2sp), Gleicheniales 4k (Gleicheniaceae 1c family + Dicranopteris 3c/4sp + Diplopterygium 3c/4sp + Dipteridaceae 1c/2sp), **Hymenophyllales 7k 49c** (Hymenophyllaceae 6c family + Abrodictyum 2c + Cephalomanes 1c + Vandenboschia 3c + Didymoglossum 3c + Crepidomanes 12c/14sp + **Hymenophyllum 22c/24sp**), Marattiales 1k (Marattiaceae 4c/5sp), Ophioglossales 2k (Ophioglossaceae 7c family + Ophioglossum 4c/5sp), Osmundales 1k (Osmundaceae 3c/4sp), Psilotales (1sp inline 無 key), Salviniales 1k (Salviniaceae 3c/4sp，Marsileaceae 1sp inline), Schizaeales 2k (Lygodiaceae 1c + Schizaeaceae 1c)。**Pre-query 88/88 全 resolve** (0 UNRESOLVED)。**PDF→TaiCOL 採 TaiCOL 14 處**: Japanobotrychium 阿里山蕨萁→**阿里山陰地蕨**, Ophioglossum petiolatum 鈍頭→**銳頭瓶爾小草**, Azolla caroliniana 卡州滿江紅→**墨西哥滿江紅**, Actinostachys 沙→**莎草蕨** (沙/莎), Abrodictyum obscurum 線片長筒蕨→**線片長片蕨**, Vandenboschia striata 南海蕨→**南海瓶蕨**, V. kalamocarpa 華東瓶蕨→**管苞瓶蕨**, Didymoglossum beccarianum 細柄→**短柄單葉假脈蕨**, Hymenophyllum acutum 疏毛葉膜蕨→**稀毛毛葉蕨**, H. simonsianum 寬卵→**寬片膜蕨**, H. devolii 臺灣膜蕨→**棣氏膜蕨**, H. paniculiflorum 圓錐孢膜蕨→**頂囊蕗蕨**, H. oligosorum 長毛膜蕨→**長毛蕗蕨**, H. semialatum 半圓柄→**半翼柄蕗蕨**。Backend 803→822 keys, 4352→4433 couplets (+19/+81)。`make mobile-db` synced。**1m8C rows 5-10/12-14 done=TRUE** (9 orders) | ✅ 9 orders done |
| 10.78 | **三項使用者回報 bug 修正（搜尋 + 導覽）** 詳見 `Update_log.md` 2026-06-06。(1) **綠底 active bar 導覽迴圈**：`ActiveSessionBar` 是 root stack 之上的 persistent chrome，每頁都顯示，原 onPress 用 `router.push`，已在該記錄頁時再點又疊一份同頁→退出要按很多次返回。改 `usePathname()` 比對：已在目標頁 no-op，否則用 `router.navigate`（pop 回既有實例）。(2) **物種→分類樹搜尋遺失同物異名+模糊**：`searchTaxonomy()` 原是獨立 accepted-only LIKE path，不走主 pipeline。保留 LIKE 高階層比對，附加 `searchWithFuzzyFallback`（含 synonym 解析+Levenshtein fallback），`SearchResult`→`TaxonSearchHit`（path 由接受名階層組出），`rank:name` 去重合併；`TaxonSearchHit` 加 `matched_as`/`fuzzy_match`，HitRow 加橙 `≡`/紫 `~` 標記+「↳你輸入」副行，與主搜尋 SearchBox 視覺統一。(3) **「搜尋限定類群」單選改多選**：`search.ts` 新增共用 `groupFilterClause()`（群內 AND/群間 OR），`SearchOptions.group`→`groups: TaxonGroup[]`；`fuzzy.ts` 同步；`settings.ts` `last_search_group`→`last_search_groups`（JSON，舊 key 孤兒不遷移，升級後首次為「全部類群」）；`TaxonGroupPicker` modal 可複選（tap 切換不關閉/「全部類群」=清空/「完成」鈕關閉），觸發列水平可滑 chip，>5 顯示「N 個分類群」；`SearchBox` state 改陣列。傳 group 的呼叫端只有 SearchBox，其餘包 SearchBox 自動受惠；`batchImport`/`searchByTaxonId`/`KeyMatrixRunner` 不傳 group 不受影響。typecheck pass，未動 native/DB schema | ✅ code done，待實機驗證 |
| 10.79 | **樣區調查擴充 v13（定點計數法 + per-record 座標 + 偵測方式 + 匯出補齊）** 詳見 `Update_log.md` / `Survey_plots_plan.md`。migration v13 (`plot_species_records` 加 lat/lng/accuracy/detection_type；`plot_surveys` 加 point_radius_m，全 additive 無 rebuild)。新增第三調查法 `point_count`（PlotType 加值 + `isStratified`/`usesTrack`/`requiresStaticGps` 統一 ~15 處分支；EnvTab 半徑+起迄時間；不分層走 'T' 桶）。三種樣區皆可逐筆記座標（`updatePlotSpeciesLocation` + modal GPS 鈕）。detection_type（看到/聽到/飛過）。匯出全補齊（session/plot YAML 補 notes+屬性、plot sp.csv 加 detectionType+GPS、`buildPlotPoints` 實作、dwcMapper 補 notes/rank/detection_type term）。**後續 UI 小修**：individuals label 改「個體數」去掉「隻」+ list 加 −/＋ 快速增減 stepper；modal header 學名斜體 + 非分層顯示完整階層 chips（可點按跳分類樹）+ 檢索表鑰匙 chip；穿越線移除 sampleSize 欄。實機測試通過。未跑 make mobile-db（僅 user.db schema） | ✅ |
| 10.80 | **「加入當前記錄」smart-route bug 修正**：物種→分類樹/查詢卡片按「加入當前記錄」原本只加快速名錄、有 active 樣區時反被 single-active 結束另開名錄。抽共用 hook `src/lib/useAddToActiveRecord.tsx`（active plot 優先→開豐度 modal→addPlotSpecies；否則 session），三入口（SpeciesSearchPanel / taxonomy handleQuickAdd / handleAddFromSheet）改用之；LookupResultSheet 加 addButtonLabel 透傳；key runner 已正確不動。實機通過 | ✅ |
| 10.81 | **分類樹跳轉 bug 修正**：(1) 從卡片跳分類樹**永遠定位失敗**—jump 用普通 useEffect 在 requestJump 一更新就消費（taxonomy 仍背景、FlatList 未 layout、scroll 失敗後 clearJump 不再重試）→ 改 `useIsFocused()` gating，focus 後才展開+捲動+clear，對所有跨畫面跳轉一體適用。(2)「搜尋分類群」浮到中間—`TaxonomyJumpChip` 導覽前 `Keyboard.dismiss()` 避免 KeyboardStickyView latch。實機通過 | ✅ |
| 10.76 | **Polypodiopsida Cyatheales 桫欏目** (sheet 1gA641y4...，1m8C row 4，PDF p.21-22+48): **3 keys 13 couplets / 16 終端** (Cibotiaceae 1c/2sp + Cyatheaceae 6c/7sp + Plagiogyriaceae 6c/7sp)。Pre-query 16/16 全 resolve。PDF→TaiCOL 採 TaiCOL 2 處: Alsophila metteniana 臺灣樹蕨→**小黑桫欏** (alt 臺灣樹蕨), Alsophila fenicis 蘭嶼筆筒樹→**蘭嶼桫欏** (alt 蘭嶼筆筒樹)。Backend 800→803 keys, 4339→4352 couplets (+3/+13)。`make mobile-db` synced。**Coverage 16/17 sp** (Plagiogyria pycnophylla 密葉瘤足蕨 在 TaiCOL 但不在 PDF)。**1m8C row 4 done=TRUE 已標** | ✅ Cyatheales 完工 |
| 10.75 | **Polypodiopsida 水龍骨綱 family key (跨綱)** (sheet 1gQ1WXtB...，1m8C row 3，PDF p.27-31 五、石松類及蕨類植物 Lycophytes + Monilophytes): meta scope_rank=class scope_name=Polypodiopsida scope_cname=水龍骨綱，worksheet `Polypodiopsida` 1 key **58 couplets / 38 unique family terminals** (Lycopodiopsida 3 科 + Polypodiopsida 35 科)。**Pre-query 38/38 全 resolve** (0 UNRESOLVED)。**PDF→TaiCOL 採 TaiCOL** 5 處: Marsileaceae 蘋科→**田字草科** (alt 蘋科), Marattiaceae 觀音座蓮舅→**合囊蕨科** (alt 觀音座蓮舅), Cibotiaceae 金狗毛蕨→**金狗毛蕨科** (加科字), Lindsaeaceae 陵齒蕨→**鱗始蕨科** (alt 陵齒蕨), Hypodematiaceae 睡足蕨→**腫足蕨科** (睡/腫 字異)。**1m8C rows 4-14 taxonID 補齊** (Cyatheales t0001546 / Equisetales t0001557 / Gleicheniales t0001566 / Hymenophyllales t0001574 / Marattiales t0001584 / Ophioglossales t0001599 / Osmundales t0001601 / Polypodiales t0001613 / Psilotales t0001621 / Salviniales t0001632 / Schizaeales t0001633)。Backend 799→800 keys, 4281→4339 couplets (+1/+58)。`make mobile-db` synced。**Polypodiopsida 整綱進度**: row 3 family key ✅；rows 4-14 各 order 待後續按 11 段依序進行 (Cyatheales/Equisetales/Gleicheniales/Hymenophyllales/Marattiales/Ophioglossales/Osmundales/Polypodiales/Psilotales/Salviniales/Schizaeales)。其中 **Polypodiales 水龍骨目** 20 科 115 屬 768 sp 為最大段 | 🟡 family key done |
| 11.0 | **地圖 Interactions（Map.md Phase 1）**：地圖 tab 顯示既有記錄 geometry + 點選資訊 + 跳回記錄 + 就地編輯。(a) `src/db/plots.ts` 加 `listPlotSurveysWithMeta()`（`LEFT JOIN projects` + `COUNT(plot_species_records) GROUP BY`，一次取 project_name + species_count，無 N+1；刻意用 LEFT JOIN 異於 listSites inner join 以免漏 project_id=0）。(b) `app/(tabs)/map.tsx` 渲染所有 plot_surveys：fixed/point_count 用 Marker（point_count 加 Circle 畫 point_radius_m），transect 用多段 Polyline；done=紫 #7c3aed / active=洋紅 #db2777，與 sites(藍)/draw(紅) 區分；`useMemo`(plotRenderItems) 在載入時預先 parse+投影 track（非每次 render）。(c) `handlePlotTap` 用 showActionSheet 顯示 plotid/型別/物種數/專案 → 跳回 `/plot/[id]`、跳到此位置(geometryBounds)、編輯位置。(d) 編輯 geometry：`editMode='point'` 復用既有 draggable marker，2-button Alert 確認 → `updatePlotSurvey` 寫 decimal_lat/lng（不碰 status，single-active 不受影響）；useFocusEffect 編輯中 skip reload。**Phase 1D-B transect 頂點編輯**：`editMode='track'` + `editSegmentIndex`；錄製中 transect 擋下編輯（`useTrackRecorder.getState().recordingPlotId` 競態守衛）、多段先 showActionSheet 選段、>200 點先警告、拖動/點頂點刪除、儲存重組 MultiLineString 過濾 <2 點段 → `writePlotTrack`。**Session geometry 上圖**：`listSessions()` 載入 → 統一 sessions 圖層（active=綠 #10b981 / done=青 #0891b2 起點 Marker + 軌跡 Polyline，取代原本只畫 active 的 IIFE，保留 active per-record 琥珀點）→ `handleSessionTap` 跳回 `/session/[id]`。tsc pass + 跨平台 audit 無違規。待實機驗證 | ✅ code done |
| 11.1 | **地圖 NLSC WMTS 圖層（Map.md Phase 2）**：國土測繪中心全圖層可搜尋疊圖。(a) `src/lib/nlscLayers.ts` 從 NLSC GetCapabilities（`wmts.nlsc.gov.tw/wmts/1.0.0/WMTSCapabilities.xml`）解析全部 **220 層**（id+中文標題；已核實全為 GoogleMapsCompatible / EPSG:3857，與 react-native-maps 相容；一次性生成不留永久腳本）。(b) `src/components/LayerSheet.tsx`（取代並刪除 SinicaLayerSheet）：多來源 tab（國土測繪/中研院），各來源獨立 selectedId+opacity+搜尋，`LayerSource[]` 設計易擴充。(c) `settings.ts` MapViewState 加 `nlsc_layer`/`nlsc_opacity`（預設 ''/0.7；靠 `{...DEFAULTS.map_view, ...parsed}` 自動向下相容無需 migration）。(d) `map.tsx` NLSC UrlTile：`https://wmts.nlsc.gov.tw/wmts/{LAYER}/default/GoogleMapsCompatible/{z}/{y}/{x}`（**z/y/x** 順序，異於中研院 z/x/y）；NLSC(zIndex0)+中研院(zIndex1) 可同時疊；圖層 FAB accent 反映任一來源。tsc pass + audit 無違規。待實機驗證 | ✅ code done |

## TODO

### 待修小項（2026-05-13 觀察）

- [ ] **物種詳細頁 → 檢索表 deeplink**：`SpeciesDetailSheet` / 名錄 long-press 看詳細 / 樣區物種卡內，若該物種所屬 genus（或 family）有對應 `identification_keys`，加「對照同屬檢索表」按鈕。實作 = 復用 `findSubkeyForTaxon(taxon_id)` helper（已存在於 `src/db/keys.ts`，原本是 runner 用），匹配到非 null 時顯示按鈕 → `router.push('/key/{id}')`。Step 6 contextual entry points 的一部分
- [ ] **鍵盤遮擋輸入框 / 儲存鈕**：session detail 與 plot detail 頁中，鍵盤打開時 SearchBox / 「完成」按鈕仍有時被遮住一半（見 2026-05-13 IMG_1305）。檢查現有 `KeyboardAvoidingView` 設定 — 可能 `keyboardVerticalOffset` 給的 header height 不準，或 SafeAreaView edges 順序問題。也檢查 BatchImportModal / SaveSiteModal / ProjectEditModal / NotesEditModal 等含輸入的 modal 是否同樣狀況

### MVP 收尾與小修（v0.1 → v0.2）

- [x] 「清除所有資料」實作（drop user 資料表 + 重跑 migration，TaiCOL 不動）
- [x] 結束 session 時若 0 筆紀錄，prompt 「直接刪除」（EndSessionModal isEmpty 模式）
- [x] 隔日 prompt：StaleSessionWatcher 偵測 12+ 小時 active session
- [x] Long-press 物種卡片 → ActionSheet（編輯備註 / 看詳細 / 移除）
- [x] 排序選項：observed / cname / name / family + persist 到 settings.last_record_sort
- [x] Markdown 匯出（含維管束植物 6 類群、autonym s.l./s.str.、保育統計、計畫 header）
- [x] 多選刪除：sessions 列表 long-press 進入多選模式（checkbox + batch delete + 全選）
- [x] EAS Build `eas.json` 設定（development / preview / production profiles + 文件化指令）
- [ ] 重 build Android target 驗證跨平台
- [ ] EAS Build 實際推 dev client 到實機（需 user 跑 `eas login` + `eas build`）
- [ ] Release 設定（簽署、icon 產出、splash screen 換成正式設計）

### Phase 2（地圖、分類樹、照片、進階匯出）

#### Phase 2.0：地圖 MVP（react-native-maps + 中研院 WMTS）

技術選型決定（2026-05-11）：
- 主框架：`react-native-maps`（iOS Apple Maps / Android Google Maps SDK，mobile native loads 免費）
- 中研院 WMTS overlay 疊圖（85 圖層、透明度滑桿，與 web 版一致）
- 預載全臺灣（檔案大小不限制）
- 軌跡錄製為必要功能，使用者可選擇是否啟用

待辦：
- [ ] 地圖 tab 滿版 + Apple/Google 基底 + 多底圖切換
- [ ] 中研院 WMTS overlay（pre-built 85 圖層清單）+ 透明度
- [ ] Map view state 持久化（zoom/center/basemap，存 settings）
- [ ] 樣區 (sites) DB schema（綁 project_id + geometry_geojson）
- [ ] 樣區 CRUD UI + Marker / Polyline / Polygon 互動繪製
- [ ] KML / GPX / GeoJSON / WKT 匯入匯出
- [ ] GPS single_point 模式（session 開始時打點）
- [ ] GPS full_track 模式 + 背景定位 + 電量管理 + persistence
- [ ] Per-record GPS 覆蓋（個別物種補打座標）
- [ ] Permission UI（Always location 說明文案）

#### Phase 2.1：完全離線基底地圖（魯地圖整合）

技術選型決定（2026-05-11）：
- 走「路線 A」：將魯地圖 `taiwan-topo.map` 透過 desktop pipeline 預先 render 成 raster MBTiles
- 預載全臺灣，sizes 不限制（zoom 0-15 估 3-5GB）
- 走 react-native-maps 的 `<UrlTile>` + 自製 local MBTiles loader
- 已聯繫 alpha-rudy 取得使用授權

待辦：
- [ ] Desktop pipeline：Mapsforge `.map` → raster tiles → `.mbtiles`（建議用 docker 包）
- [ ] App 端 MBTiles loader（local HTTP server 或 native bridge）
- [ ] 「下載地圖區域」UI：分區下載 + 進度 + 容量管理
- [ ] 預設打包北中南東四區供首次選擇
- [ ] 切換 online / offline 基底（自動偵測網路 + manual override）
- [ ] 離線地圖更新機制（version 檢查 + diff 下載 if practical）

#### Phase 2.x：其他

- [x] **分類樹 tab**：lazy load 階層（kingdom→phylum→class→order→family→genus→species）、autonym s.str. 標示、tap 開 LookupResultSheet、long-press 加入 session
  - 待補：病毒 realm 階層、展開狀態 persist 到 settings、批次加入（接 BatchAddModal）
- [x] **物種卡片照片**：相機（強制 JPEG + EXIF/UserComment 嵌入 taxon_id/name/cname/family/GPS）/ 相簿多選、寫入 photo_paths JSON array、SpeciesDetailSheet PhotoGrid（tap 全螢幕 viewer + long-press 移除）、SpeciesCard 列表前縮圖 + ×N 角標
- [ ] **匯出時補 metadata**：DB 是 metadata 真相源；匯出/分享 session 時把 record.lat/lng/notes 嵌到複本 JPEG（不動原檔/原相簿 PHAsset）
- [x] **Markdown 匯出**：維管束植物 6 類群分流、Magnoliopsida order 拆單/雙子葉、autonym s.l./s.str.、計畫 header 統計
- [ ] **TaiCOL 資料更新機制**：需 backend public server，啟動 silently check 版本，使用者觸發下載

### Phase 3（植群樣區調查 / 物種豐度）

設計決策（2026-05-11 → 2026-05-12 修訂）：
- 樣區調查走獨立 entity（plot_surveys + plot_species_records），不擴充 sessions schema
- 一物種一 layer（同種跨層 = 多筆 records，列表會有重複）
- ~~Abundance 方法 per-layer（E3 預設 DBH、E0-E2 預設 BB；可改 percent）~~ → **Step C 通用化**：改為 DwC organismQuantity + organismQuantityType，per-record 自由選單位（BB / % cover / individuals / DBH / 自定義）。fixed plot 的 per-layer method 仍存在但僅作「該層預設單位 hint」
- Hard-required for species 輸入：
  - fixed plot: plotid + lat/lng + uncertainty
  - transect plot: plotid + 軌跡曾啟用（start_ts != null）
- DBH 多支幹：JSON array 字串存在 organism_quantity 內，自動算 basal area
- Plot ↔ Site 雙向：capture GPS 時自動建對應 Point site（仍待做）
- **Single active enforcement**：任何時刻最多一筆 active session OR 一個 active plot；建新 record 前 prompt 結束舊的
- **Plot 兩型**：fixed (4-layer 植群) + transect (穿越線 MultiLineString 軌跡)

待辦：
- [x] DB schema v5：plot_surveys + plot_species_records + 索引
- [x] 樣區 tab + plot list + plot detail（Env / Species / Layers 三 tabs）
- [x] Env tab：M 欄位優先 + GPS 一鍵抓 + 進階折疊（elevation/slope/aspect/cover）
- [x] Layers tab：E0-E3 各 cover%/height(cm)/方法 chip
- [x] Species tab 完整：layer focus + records 分組 + ValueModal + lastValue 記憶
- [x] **Transect 軌跡**（migration v6 + TransectTrackControl + TrackPreviewModal + module-level trackRecorder）
- [x] **物種屬性欄位**（migration v8 sex / life_stage / reproductive_condition / leaf_phenology；依 kingdom / class 動態 UI）
- [x] **豐度通用化**（migration v9 DwC organismQuantity + organismQuantityType + 既有遷移；通用 type picker）
- [x] **StalePlotWatcher**（30 分閒置提示）
- [x] **Single active enforcement**
- [x] **資料層級**：選單「地理樣區」改名、`/projects` 顯示 N 名錄 / M 樣區、記錄 tab 支援按專案分組
- [ ] 物種照片：同 checklist 流程 (PhotoGrid + PhotoViewerModal) 接入 plot_species_records.photo_paths
- [ ] Plot ↔ Site 自動連結（capture GPS → 自動建 Point site）
- [ ] Active plot bar（與 ActiveSessionBar 合併為 ActiveRecordBar 已完成）
- [ ] Recorder / protocol / size 偏好記憶（profileStore）
- [x] **匯出 DwC 屬性欄位**（2026-05-22）：YAML / CSV / plot species CSV 補齊 sex / lifeStage / reproductiveCondition / leafPhenology；多值欄用 DwC `|`-separated 慣例。詳見 Update_log.md
- [x] **樣區分層通用化 v12**（2026-05-22）：plot_survey_layers 正規化新表 + layer_count 1-6 stepper + Label 改 E1-E6（苔蘚 / 草本 / 灌木 / 亞喬木 / 主林冠 / 突出）+ EnvTab 併入分層 + env photos grid + 匯出檔案 rename。詳見 Update_log.md
- [ ] 樣區內多重複數調查支援（重複測量 / paired-sample）
- [ ] 名錄端 abundance UI（schema v9 已 ready；目前 deferred，未來真要做時直接接 `<AbundancePickerSheet />` 即可，不需 migration）
- [ ] **v13 drop legacy `plot_surveys.e0_*..e3_*`**（queue，v12 上線 2 週後）

### Phase 3.5（決策完成，2026-05-12）：主導覽列整合 + 檢索表系統

#### 決策結果

| # | 議題 | 決策 | 備註 |
|---|------|---------|------|
| D1 | 主導覽列改 3 tab + 中央 FAB | ✅ 是 | |
| D2 | 實作順序 incremental vs 一次到位 | ✅ incremental + 逐步讓 user 測試 | 每個小段完成即測 |
| D3 | Records 混合列表（icon + color 區分 + 頂部 segmented filter）| ✅ 是 | |
| D4 | iOS 中央 FAB pattern（Strava-like）| ✅ 採用 | |
| D5 | 預設記錄類型設定（profileStore key=`record_type_default`，'session'\|'plot'\|'ask'）| ✅ 是 | 設定頁 radio |
| D6 | 物種 tab 三 segmented（分類樹/檢索表/搜尋），首頁搜尋拉進來 | ✅ 是 | |
| D7 | Key 統一 schema（dichotomous + multi-access 同表）| ✅ 是 | |
| D8 | Subkey chain（科→屬→種自動接續）| ✅ 是 | |
| D9 | 舊版 `references/key_to_sp/` vs 新版 PDF 衝突源 | ✅ user 自行手動整合，最終會給一份完整檔案 | parser 不需處理舊版遷移；只 parse user 整合版 |
| D10 | PDF parser 工具 | ✅ pdfplumber + bbox-based extraction | 樣本：`references/Selaginellaceae.pdf` 已分析；CJK text layer 損壞，必須用 bbox 解析 |
| D11 | Multi-access Sheets schema | ✅ row1=feature, col1=taxa, `;` 分隔多值；UX 需深化 | 避免 iNat 「特徵多時難找」問題，見下節 |
| D12 | Google Sheets service account | ✅ env var: `GLORIA_GOOGLE_CREDENTIALS` | 讀 JSON path 從此 env 載入 |
| D13 | Offline cache 策略 | ✅ lazy fetch + 永久 cache + 設定頁「重新下載」 | |

#### PDF 樣本分析（Selaginellaceae.pdf, 2026-05-12）

**結構（固定 6 欄表格）：**

| Col | 內容 | 範例 |
|-----|------|------|
| 1 | Couplet 編號 或 `-` | `1`, `2`, `-` |
| 2 | Lead 中文描述 | `植株呈矮樹狀，枝葉蓮座狀螺旋發育於粗壯主莖頂` |
| 3 | Next couplet 編號（若非 terminal）| `2` |
| 4 | Terminal 學名（italic）| `Selaginella tamariscina` |
| 5 | 中文俗名 | `萬年松` |
| 6 | IUCN 狀態 | `LC`, `NT`, `EN`, `VU`, `DD`, `NA` |

**Couplet 結構**：`N` row + `-` row 配對；A/B 兩 lead 都可能是 terminal 或 next。

**Title 解析**：`Selaginellaceae 卷柏科 — 1屬 (Selaginella 卷柏屬) 19 種之檢索表`
→ family name + family cname + 屬數 + 屬名 + 種數

**特殊標記（待 user 確認語義）：**
- `*`：擬日本卷柏* / NT → 推測「待確認 / 暫定 / 引用基原問題」
- `#`：藍地柏# / NA → 推測「歸化 / 外來」（與 NA 狀態相符）
- 跨 PDF 是否一致需 user 在整合版中明確定義

**Parser 陷阱：**
- PDF 文字層存在但 **CJK ToUnicode mapping 損壞**，`extract_text()` 結果完全亂序
- 必須用 `pdfplumber.extract_words()` 取得 `(text, x0, y0, x1, y1, fontname)` → 按 y 分群成 row → 按 x 排序成 column → 依 column boundary 切欄
- Italic 偵測：fontname 含 `Italic` / `Oblique` / `BoldItalic` 即為學名
- 跨頁處理：續接時 couplet 編號連續（樣本最大 37）

**Parser 寫作策略：**
1. 先寫 row 切割 + column boundary 自動偵測
2. 對 1 科驗證
3. 加入 subkey 偵測（範例 PDF 是單屬，沒有 subkey；其他多屬科會出現「● Genus 屬檢索表」標題）
4. 寫成 backend `services/key_pdf_import.py` + CLI

#### Multi-access UX 深化（D11 補充）

**iNat 痛點**：特徵多時側邊浮動清單難找、難規劃決策順序。

**設計對策（要進 mobile UI）：**

| 機制 | 解決問題 |
|------|---------|
| 頂部 feature 搜尋框（如「葉」→ 葉形/葉緣/葉脈）| 多特徵找不到 |
| 特徵分類分組（營養器官 / 繁殖器官 / 整體形態，collapsible section）| 視覺壓力 |
| 智能排序（每特徵依對剩餘候選的 entropy 排序，分辨力高者優先）| 順序混亂 |
| 「Help me decide」按鈕：建議下一個最佳特徵 | 不知該選哪個 |
| 已選特徵 chip 列固定頂部（單擊取消、長按改值）| 看不到當前狀態 |
| 候選計數即時更新 + 「剩 N 種」大字 | 不知進度 |
| 「跳過此特徵」（unknown）支援 | 野外無法確認某特徵時不卡住 |

**實作優先級**：先做「分組 + 已選 chip + 候選計數」三項基本款；entropy 排序與「Help me decide」等智能化功能等實際資料進來後再加。

#### 設計提案：主導覽列重構

現行 4 tab（名錄 / 樣區 / 物種 / 設定）→ 3 tab + 中央 FAB：

```
[ 記錄 ]   [ + ]   [ 物種 ]   [ 設定 ]
```

合併現行「名錄」+「樣區」為「記錄」tab：
- 混合列表，icon（📋 名錄 / 🔲 樣區）+ status chip 區分
- 頂部 segmented filter [全部 / 名錄 / 樣區] 做次要切換
- 排序：active 優先 → start_ts desc

中央 FAB：
- 點擊：依 `profileStore.record_type_default` 直接進建立流程；首次顯示選單
- 長按：ActionSheet「快速名錄 / 樣區調查 / ⚙ 改變預設」
- 偏好 key: `record_type_default = 'session' | 'plot' | 'ask'`

物種 tab segmented：
- [分類樹]：現有 lazy-load tree，屬節點旁加 🔑 icon（依 keyStore enabled）
- [檢索表]：屬名搜尋 → key flow
- [搜尋]：把首頁全文 + fuzzy 搜尋拉進來

設定 tab：profile / preferences / 預設記錄類型 / 匯出 / Key 資料更新

#### 設計提案：主導覽列重構

現行 4 tab（名錄 / 樣區 / 物種 / 設定）→ 3 tab + 中央 FAB：

```
[ 記錄 ]   [ + ]   [ 物種 ]   [ 設定 ]
```

合併現行「名錄」+「樣區」為「記錄」tab：
- 混合列表，icon（📋 名錄 / 🔲 樣區）+ status chip 區分
- 頂部 segmented filter [全部 / 名錄 / 樣區] 做次要切換
- 排序：active 優先 → start_ts desc

中央 FAB：
- 點擊：依 `profileStore.record_type_default` 直接進建立流程；首次顯示選單
- 長按：ActionSheet「快速名錄 / 樣區調查 / ⚙ 改變預設」
- 偏好 key: `record_type_default = 'session' | 'plot' | 'ask'`

物種 tab segmented：
- [分類樹]：現有 lazy-load tree，屬節點旁加 🔑 icon（依 keyStore enabled）
- [檢索表]：屬名搜尋 → key flow
- [搜尋]：把首頁全文 + fuzzy 搜尋拉進來

設定 tab：profile / preferences / 預設記錄類型 / 匯出 / Key 資料更新

#### 設計提案：檢索表系統

**資料來源盤點：**

| 來源 | 類型 | 階層 | 狀態 | 處理 |
|------|------|------|------|------|
| `references/key_to_sp/` | dichotomous, 屬內 | 種 | 舊版，623 屬 | **不直接遷移**；user 整合進新版 |
| 新版 PDF（科 + 屬，附 IUCN）| dichotomous, 兩階 | 科→屬→種 | 待 parse | pdfplumber bbox extraction（樣本已驗證可行）|
| Google Sheets matrix | multi-access | 任意 | 範本：Lycopodiaceae | gspread + SA（env: `GLORIA_GOOGLE_CREDENTIALS`）|

**統一資料模型**（backend + mobile SQLite 同 schema）：

```
keys
  id, scope_taxon_id, scope_rank ('family'|'genus'|...),
  title, source, mode ('dichotomous'|'multi_access'|'both'), updated_at

key_couplets                    -- dichotomous
  key_id, number,
  lead_a_text, lead_a_target_type ('couplet'|'taxon'|'subkey'), lead_a_target_id,
  lead_b_text, lead_b_target_type, lead_b_target_id

key_features                    -- multi-access
  key_id, name, type ('categorical'|'numeric'|'boolean'), values_json

key_taxon_features              -- multi-access matrix (可多值)
  key_id, taxon_id, feature_id, value
```

關鍵設計：
- **Subkey chain**：科檢索 lead 終點 type=`subkey` → 自動接續屬檢索（範例 PDF Lycopodiaceae→Huperzia 已驗證需要）
- **Multi-mode**：`mode='both'` 同 taxon scope 可切換兩種 mode
- **保育狀態**：join 既有 taxa 表（redlist/iucn/cites/protected）

**Dichotomous UI**：全螢幕 step-by-step
- 上方 breadcrumb 跨 subkey：`Lycopodiaceae 1▸2 ▸ Huperzia 3▸4`
- 大按鈕（A/B 兩 lead），右側顯示 next couplet 編號或 terminal taxon
- 終點 = species → SpeciesDetailSheet + 「加入 active 記錄」smart routing

**Multi-access UI**：
- 上方 filter 面板（features chip 群）
- 下方候選 taxa 卡片列表（即時計數「剩 N 種」）
- chip 長按「不確定，跳過」
- 點 taxa → SpeciesDetailSheet

**Contextual entry points**：
- 分類樹屬節點 → 🔑 icon（依 keyStore 線上 / 已快取分色）
- SpeciesDetailSheet → 「對照同屬檢索表」按鈕
- 樣區/名錄記錄編輯 → 「不確定？開檢索表」（傳入當前 genus）

**Smart routing（key 定種完成後）**：
- active plot：詢問加到哪 layer（preselect 上次使用 layer）
- active session：直接 append
- 都沒有：「建立記錄並加入」+ 類型選單（複用 FAB 邏輯）

**資料同步策略**：
- Backend endpoint：
  - `GET /api/keys/index?since=<ts>` → 列出有更新的 keys
  - `GET /api/keys/{id}` → 完整內容（couplets + features + taxa）
- Mobile：
  - 進入「檢索表」segment 時背景拉 index 比對 last_sync
  - 點開某 key 時 lazy fetch 完整內容並寫進本地 SQLite，永久 cache
  - Settings 加「重新下載所有檢索表」+ 容量顯示

#### 待辦（依 incremental 順序，每塊完成即測）

**Step 0：資料盤點與確認（user 配合）**
- [ ] User 確認 PDF 中 `*` 與 `#` 標記語義（提供整合版時統一定義）
- [ ] User 設定 `GLORIA_GOOGLE_CREDENTIALS` env var 指向 SA JSON
- [ ] User 把 multi-access Sheet share 給 SA email

**Step 1：Backend schema + 一個 PDF 跑通** ✅ 完成 2026-05-12
- [x] Schema：identification_keys + key_couplets + key_features + key_taxon_features + FK indexes（寫入 `twnamelist.db`）
- [x] PDF parser POC（`backend/services/key_pdf_import.py`）
- [x] 對 `references/Selaginellaceae.pdf` 跑通：15 couplets parsed，15/15 sciname → taxon_id resolve 成功
- [x] CLI: `python -m backend.services.key_pdf_import <pdf> [--dry-run] [--source LABEL]`

**Step 1 解決的 PDF 結構陷阱（重要 for 之後其他 PDF）：**
1. CJK ToUnicode 損壞 → CJK lead text 寫入 `lead_*_text` 但標 garbled，等 user 整合版校正
2. 同視覺行 italic baseline 偏移（391 vs 397）→ best-fit/first-fit 都會錯接，改用 **consecutive y-clustering**（gap ≤ 7 px 同 row）
3. 同 row 內 col4 跨 baseline 排序錯亂 → 用 **`int(top/4)` bucket sort by (bucket, x)**
4. col3 含雜訊（`"` 等假 dash）→ digit-only filter
5. 學名中正體 rank token (`subsp.`/`var.`/`f.`/`×`) 不會被 italic 偵測到 → 顯式列入 RANK_TOKENS 併入 col4
6. PDF 字型 `8` `9` 渲染為 `:` `;` → 保留原始字元供 user 校正

**Step 1 觀察到的內容問題（user 處理，parser 不修）：**
- Selaginellaceae.pdf 標題寫「19 種」，但實際只有 12 個連續 couplets (1–12) + 跳號 35–37。
  9A→32 / 10A→33,34 / 36B→38 都引用到不存在的 couplet。User 確認 PDF 本身就是這樣
  （非 parser bug），整合版時人工補齊 13–34。
- `*` `#` `%` 等 marker 已抽取為 `lead_*_taxon_marker`，語義由 user 整合版定義。
- TaiCOL 對應 27 個 accepted Selaginella taxa（含屬本身），扣除 cultured 3 種 +
  屬本身後約 20–21 個 native/naturalized 種，與 PDF「19 種」吻合。

**Parser 設計原則（明確不修補的）：**
- 保留 orphan refs（couplet 9A→32 即使 32 不存在，也照原樣存）
- 保留 `:` `;` 等 font glyph 誤讀（不猜測 mapping）
- 不嘗試修復 CJK garbled text（不可逆）
- 統一交給 user 後續從整合版校正

**Step 2：Backend endpoints + admin**
- [x] `GET /api/keys` 列出 keys（支援 `since` 增量同步 + `scope_rank` / `scope_name` / `mode` filter）
- [x] `GET /api/keys/{id}` 完整內容（couplets + features + taxon_features + children；taxon lead 自動 join accepted name + 中文俗名 + 保育狀態）
- [x] `POST /api/admin/import-key-pdf` PDF 上傳 → parse → 寫入（同 source_label 自動覆寫）
- [x] `DELETE /api/admin/keys/{id}` 刪除整份 key（cascade couplets/features）
- [ ] Admin 頁加 PDF 上傳介面 + sheets sync 按鈕（web frontend）

**Step 3：Sheets dichotomous key 拉取** ✅ 卷柏屬已跑通 2026-05-13
- [x] `backend/services/key_sheet_import.py` + `gspread` + `google-auth`，service account 走 `GLORIA_GOOGLE_CREDENTIALS` env var 抓 JSON path
- [x] Sheet schema 定義（一個 spreadsheet = 一個 family；每 worksheet = 一份 key）
  - **`meta` worksheet（必有）**：column-orient header 含 `scope_rank | scope_name | scope_cname | source | notes`，第二列即實際資料
  - **每個 key worksheet**：worksheet 名稱即 scope 的 Latin 名（科 `Selaginellaceae` 或屬 `Selaginella` 等；以 `aceae` 結尾自動判 family，否則 genus）；header `id | description | target`（第三欄接受 `target` 或 `couplet`）；同 id 連續 2 row = couplet 的 A/B；同 id 3 row+ 印 warning 只用前兩個
- [x] **target 解析規則**：純數字 → next couplet 編號；含 CJK token → split 出 sciname tokens + 中文俗名（CJK 之前是學名、CJK 之後是俗名）；學名首字小寫 → parser 自動 prepend `default_genus`
- [x] **default_genus 偵測**：(1) target 內第一個首字大寫的 token；(2) fallback：worksheet 名稱本身（適用單屬科，user 只打 epithet 如 `tamariscina 萬年松`）
- [x] **TaiCOL 自動 join**：sciname → `taicol_names.simple_name`（優先 `usage_status='accepted'`），取得 `taxon_id`；不 resolve 印 warning 但不中斷；scope_cname 自動從 `family_c` / `genus_c` 補
- [x] **`source` 標記**：寫入 `IdentificationKey.source = "<meta.source> (Sheets:<sheet_id>#<worksheet_name>)"`，同 spreadsheet 重 import 自動覆寫（cascade 刪舊 couplets）
- [x] 卷柏屬 Selaginella 20 couplets 跑通，21/21 sciname 全部 resolve
- [ ] 多屬科示範（例：石松科 Lycopodiaceae）— 多 worksheet（一屬一個）並含科檢索表 worksheet（terminal 是屬名）
- [ ] **Multi-access** worksheet schema（待設計，例：worksheet 名 `multi:Genus`，row 1 features、col 1 taxa、cell 為值）

CLI：
```bash
export GLORIA_GOOGLE_CREDENTIALS=/path/to/service-account.json
backend/venv/bin/python -m backend.services.key_sheet_import <spreadsheet_id> [--dry-run]
```


**Step 4：Mobile 主導覽列重構（incremental，3 sub-step）** ✅ 完成 2026-05-12
- [x] 4-1. Records 混合列表（不動 FAB）：sessions + plots 同列表，icon 區分 + segmented filter
- [x] 4-2. Tab bar 中央 FAB + 預設記錄類型 setting
- [x] 4-3. 物種 tab segmented + 首頁搜尋拉進來（KeyPlaceholder 等 Step 5）

**Step 5：Mobile 檢索表（incremental）**
- [x] 5-1. Dichotomous key flow（離線版，full-screen + breadcrumb）2026-05-13 完成
- [x] 5-2. Subkey chain UX（科 → 屬自動接續）2026-05-13 完成
- [x] 5-3. Smart routing（key 定種 → 加入 active plot/session）2026-05-13 完成
- [ ] 5-4. Offline cache（SQLite keys 三表）+ 設定頁「重新下載所有 keys」→ **測試**
- [ ] 5-5. Multi-access key UI（基本款：分組 + 已選 chip + 候選計數）→ **測試**
- [ ] 5-6. Multi-access 進階（feature 搜尋、entropy 排序、Help me decide）→ **測試**

**Step 6：Contextual entry points + polish**
- [ ] 分類樹屬節點 → 🔑 icon（線上 / 已快取分色）
- [ ] SpeciesDetailSheet → 「對照同屬檢索表」按鈕
- [ ] 樣區/名錄記錄編輯 → 「不確定？開檢索表」（傳入當前 genus）
- [ ] 「目前僅維管束植物」UI 提示

#### Tradeoffs

主導覽列：
- ✅ 主畫面從 4 tab 縮減至 3 tab + FAB，符合「我要做一筆野外資料」心智模型
- ⚠ iOS 中央 FAB 非 HIG 原生 pattern（Strava/Instagram 已普及，可接受）
- ⚠ 混合列表需強視覺區分（icon + 顏色 + chip）

Key 系統：
- ✅ Dichotomous + multi-access 共用 storage / 入口，使用者不用學兩套
- ✅ Subkey chain 自然呈現「科→屬→種」三段定種
- ⚠ Multi-access 人工建立成本高（先有 schema，內容慢慢累積）
- ⚠ PDF parser 需針對排版客製（先 parse 一兩科驗證再批量）
- ⚠ 舊版 vs 新版 PDF source-of-truth 須釐清，可能需保留舊版作 fallback
- ⚠ 只有維管束植物有 key（昆蟲/鳥/真菌沒有，UI 須清楚標示）

#### 建議實作順序

1. Audit 舊版 `key_to_sp/` 格式 + 看新版 PDF 樣本（確認 parser 複雜度）
2. Backend schema + endpoints
3. PDF parser 試一兩科 + 舊版轉新 schema
4. Mobile：records 混合列表（不動 FAB，先驗證視覺區分）
5. Mobile：tab bar 中央 FAB + 預設記錄類型 setting
6. Mobile：物種 tab segmented + 首頁搜尋拉進來
7. Mobile：dichotomous key flow（線上版）
8. Mobile：subkey chain + smart routing
9. Mobile：offline cache + 設定頁「重新下載」
10. Mobile：multi-access key UI（資料慢慢補）
11. Mobile：contextual entry points

### Phase 3 收尾紀錄（2026-05-12）

完整完成項目：
- ✅ Step A：穿越線軌跡（migration v6 + module-level trackRecorder + MultiLineString + preview modal）
- ✅ Step B：物種屬性欄位（migration v8 sex / lifeStage / reproductive / leaf；依 kingdom + class 動態 UI；reproductive / leaf 可複選）
- ✅ Step C：豐度通用化（migration v9 DwC organismQuantity + organismQuantityType；既有資料遷移；通用 type picker + 自定義）
- ✅ Step D：StalePlotWatcher（30 分閒置提示）
- ✅ 互斥單一 active record（session / plot 不可並存）
- ✅ 資料層級方案 A（選單「地理樣區」、`/projects` 顯示 counts、記錄 tab 按專案分組切換）

Phase 3 Schema 版本：v9。

待開發（不阻塞，可挑優先做）：
- Phase 3 剩餘 todo（見「Phase 3」section）：plot 物種照片、Plot↔Site 自動連結、匯出 DwC CSV
- Phase 3.5 Step 5 mobile keys flow（dichotomous + subkey chain + offline cache + multi-access UI）
- Phase 3.5 Step 6 contextual key entry points

### Phase 4（跨裝置與發布）

- [ ] 跨裝置同步（web ↔ mobile，需設計 conflict resolution）
- [ ] i18n（英文、日文）
- [ ] 多 active session 支援
- [ ] 與 web 版「名錄比較」功能對齊
- [ ] TestFlight 內部測試
- [ ] App Store / Play Store 上架（需 Apple Developer Program $99/年）

### Phase 3.6：完整匯出系統（queue，Step 5-2 之後動工）

**目標**：以專案為單位打包 / 個別記錄匯出 / 使用者資料備份，全 offline-capable、純 JS 無 native deps。

**決策定案**：
- 格式：YAML / CSV / MD / GeoJSON / GPX / KML（**不做 DOCX / XLSX**，bundle size 取捨；要 Office 格式請桌面開 YAML 轉）
- 使用者資料只做**匯出備份**，「還原」列 Phase 2 獨立做（schema migration 相容性議題大）
- 順序：Step 5-2 Subkey chain 之後動工

**新增 npm deps**（全純 JS，無 pod install）：
- `jszip` ~100KB — zip 串流
- `js-yaml` ~50KB — YAML serializer

**X.1 Foundation（~1.5 天）**：
- 新 `src/lib/export/` 模組：純函式 + 一致介面
  - `exportSession(session, records, photos): ExportFile[]` → 回 `[{path, content}]`
  - `exportPlot(plot, records, environment, track, photos): ExportFile[]`
  - `exportSite(site): ExportFile[]`（已有，整併進來）
  - `exportProject(project, sessions[], plots[], sites[]): zip URI`
- Serializers：`toYaml` / `toDwcCsv` / `toMarkdown` / `toGeoJSON` / `toGpx` / `toKml`
- 寫檔：`expo-file-system` Paths.cache → `expo-sharing` Share Sheet

**X.2 個別匯出（~1 天）**：
- session/plot/site 詳細頁加「⋯ → 匯出」（走 `showActionSheet` 選格式）
- 記錄 tab：列項 long-press 加「匯出」action（已有 ActionSheet 框架）
- sites 列表：swipe-right → 匯出（4 格式已就緒，row 6.4）

**X.3 專案打包（~1 天）**：
- projects 頁加「整個專案匯出」按鈕
- 產 `{project_name}_{YYYY-MM-DD}.zip` 結構：
  ```
  README.txt
  project.yml                        # metadata + 統計
  sessions/{name}/{name}.yml/csv/md
  plots/{name}/environment.csv + species.csv + track.gpx
  sites/sites.geojson + .gpx + .kml
  photos/sessions/{session_id}/{taxon_id}_{n}.jpg
  photos/plots/{plot_id}/{record_id}_{n}.jpg
  ```
- 進度 UI（zip 寫入 + 照片 copy 是大頭）
- 超過 500MB warning（30 筆 × 3 張 2MB 照片 ≈ 180MB）
- 照片 zip store-only（不重複壓縮 JPEG）
- 照片打包時 rename 成可讀名（`{taxon_id}_{n}.jpg`），不留 expo-image-picker UUID

**X.4 使用者資料備份（~0.5 天）**：
- 設定頁「備份所有資料」→ 打包 `user.db` + `checklists.db` + `settings.json` 成 zip
- 不做還原（Phase 2）
- 提示「請保管好此檔，遺失後無法復原」

**MVP 總時程**：~4 天

**幾個實作 note**：
- 桌面 backend 已有 `api/export.py` 完整邏輯（pandoc + 模板）；mobile 不能用 pandoc，純 JS reimplement
- `utils/mapper.py` 的 DwC 對應表已寫在 backend，mobile 端 `src/lib/dwcMapper.ts` 已有局部，要補完到 36 欄
- Plot 樣區 environment + species 拆兩個 CSV（不用 XLSX）
- 軌跡（transect）已存 GeoJSON MultiLineString，轉 GPX 走純 JS function（已有 togpx pattern）

### Android 開發環境 + EAS preview build（2026-05-17 完成）

- [x] **Google Maps API key**：GCP 啟用 Maps SDK for Android，建 key 並限制三組 SHA-1（global debug `5C:56:93:90...` / Expo project-local debug `5E:8F:16:06...` / EAS release `20:8D:CD:51:9D...`）+ package `tw.checklister.mobile`。key 透過 `.env`（local dev）+ EAS Secrets `GOOGLE_MAPS_ANDROID_API_KEY`（cloud build）注入，不進 git。詳見 memory `project-android-debug-keystore`。
- [x] `app.json` 改成 `app.config.ts` dynamic config，讀 `process.env.GOOGLE_MAPS_ANDROID_API_KEY`，搭配 `.env` / `.env.example`。
- [x] EAS account + project init（projectId `5841ea3d-e6a9-42d6-805a-962aa55f68fb`）+ EAS-managed release keystore + 手動下載備份。
- [x] EAS preview build profile 跑通：`make build-android-eas` → 雲端 build APK → emulator 裝起來地圖正常 render。
- [x] Android 實機測試跨平台 path（`promptText` / `showActionSheet` / KeyboardAvoidingView / Modal）：iOS + Android edge-to-edge 都過 → 詳見 memory `feedback-keyboard-avoidance`（hybrid wrapper + KeyboardStickyView pattern）。
- [x] vision-camera + vision-camera-plugin-inatvision 全移除（dormant；memory `project-vision-model-dormant`）。
- [x] `mobile/app/Makefile` 加 build / dev shortcuts（`make build-android-dev` / `make build-android-eas` / `make build-ios` 等）。

### Phase 5：Play Store 上架（queue）

預估 1-2 週（含填表 + Google 審核 + 退件修改）。

- [ ] **Google Play Console 帳號**：$25 USD 一次性註冊費，個人開發者帳號
- [ ] **產 production AAB**：`make build-android-prod`（EAS production profile，Play Store 接受的是 AAB 不是 APK）
- [ ] **Play Console 建 app**：填名稱、套件名 `tw.checklister.mobile`、類別、預設語言（zh-TW）、隱私政策 URL（需要自架一個簡單頁面）
- [ ] **填商店素材**：
  - App icon 512×512 PNG
  - Feature graphic 1024×500 PNG
  - Phone screenshots 至少 2 張（建議 4-8 張，每張 16:9 或 9:16，最長邊不超 3840px）
  - 簡短描述 ≤ 80 字
  - 詳細描述 ≤ 4000 字
- [ ] **資料安全宣告**（必填，Google 嚴格審）：
  - 收集了哪些資料（位置 / 照片 / device ID 都要列）
  - 為什麼收集
  - 是否分享給第三方（Google Maps、TaiCOL API 等）
  - 是否加密傳輸
- [ ] **內容分級** 問卷（IARC 互動式問答）→ 自動 generate ESRB / PEGI / CERO 評級
- [ ] **目標受眾與內容**：選 18+ 或包含兒童
- [ ] **新聞 app 申明 / COVID-19 申明 / 政府 app 申明**（皆 No）
- [ ] **發布 track 順序**：
  1. Internal Testing（最多 100 個 email tester，幾乎不審核，24h 內可用）
  2. Closed Testing（外部測試者，需 Google 審 14 天）
  3. Open Testing（公開 beta）
  4. Production
- [ ] **App signing**：Play Console 啟用 Play App Signing（Google 幫保管 release key，避免你弄丟自己的）

待辦延伸思考：
- 隱私政策 URL：可用 GitHub Pages / Notion public page / 自架，但要永遠可訪問
- 商店描述要寫得 Google Play 政策不會擋（避免「最好」「第一」「免費贈送」等敏感字）
- iOS App Store 流程獨立做（Apple Developer Program $99/年 + TestFlight + App Store Connect），預估時程類似但細節不同（用 Apple 自己的 review workflow）

### 已知環境問題

- [ ] Xcode 26 + macOS 25.3 的 Cryptex disk image 機制需要手動 mount runtime 才能用 simulator（已解，文件記錄）
- [ ] Expo CLI 54.0.24 與 Xcode 26 的 `devicectl` JSON format 不相容，無法 `expo run:ios --device`，需從 Xcode 開 workspace build。SDK 升 55+ 應可解
- [ ] `expo-sharing` 必須裝 14.x（SDK 54 對應版本），裝到 55.x 會 build fail（type 不相容）

## 技術棧

| 項目 | 選擇 | 備註 |
|------|------|------|
| Framework | Expo SDK 54 + dev client | 比原 plan 的 SDK 52 更新，CI 與升級維護成本較低 |
| 語言 | TypeScript（strict）| |
| SQLite | `@op-engineering/op-sqlite` 15.x | JSI、`executeSync` 同步 API、效能優於 expo-sqlite |
| Navigation | Expo Router 6（typed routes 開啟）| 採檔案路徑 routing，比 React Navigation 較簡 |
| 樣式 | NativeWind 4 + Tailwind 3.4 | 與 web 版 Tailwind 風格一致 |
| State | Zustand 5 | 輕量、避免 Redux boilerplate |
| Gesture | `react-native-gesture-handler` 2.28 + `react-native-reanimated` 4.1 | Swipeable 移除手勢、bottom sheet 動畫 |
| Safe Area | `react-native-safe-area-context` | Modal 內用 `useSafeAreaInsets()` 手動處理 |
| 平台 | iOS + Android | MVP 只在 iOS Simulator 驗證，Android 待補 |
| Map (Phase 2) | `react-native-maps` + `@maplibre/maplibre-react-native` | 後者處理中研院 WMTS |
| OTA | `expo-updates` | JS 與小資源 OTA，DB 走獨立 download channel |
| Share | `expo-sharing` 14.0.8 | 系統 Share Sheet（必須對應 SDK 版本）|
| YAML | `js-yaml` | 與 backend `yaml.dump()` 兼容 |
| Fuzzy | `fastest-levenshtein` | 純 JS Levenshtein，配合預先 build 的 cname index |

## 資料策略

### TaiCOL 主資料

- **完整 bundle 進 APP**（118MB after VACUUM）
- 首次啟動：copy `assets/db/twnamelist.db` 到 `FileSystem.documentDirectory`，後續可寫
- **資料更新機制**：MVP 不做（無公開 server），Phase 2+ 再加

### 使用者資料

獨立 SQLite (`user.db`)，含 projects、sessions、checklist_records、settings、search_history、schema_version。

### Fuzzy Search Index

Server 端預先 build 候選 index（`backend/scripts/build_mobile_fuzzy_index.py`），存為 `cname_fuzzy_index` 表 bundle 進 TaiCOL DB。Runtime 只做查表 + Levenshtein 排序（62,809 unique cnames）。

## 資料模型 (MVP)

```
projects
├─ id (0 = 「未分類」固定 project)
├─ name
├─ abstract
├─ location_description
├─ notes
├─ created_at / updated_at

sessions
├─ id
├─ name (預設「YYYY-MM-DD HH:mm」可改)
├─ type ('checklist' | 'abundance')   ※ MVP 只實作 checklist
├─ project_id (FK, default 0)
├─ started_at / ended_at (NULL = active)
├─ gps_mode ('off'|'single_point'|'full_track')   Phase 2
├─ start_lat / start_lng                            Phase 2
├─ track_geojson                                    Phase 2
└─ notes

checklist_records
├─ id
├─ session_id (FK)
├─ taxon_id (FK to taicol_names)
├─ observed_at
├─ notes
├─ photo_paths (JSON array)   Phase 2
└─ lat / lng                  Phase 2

abundance_records (Phase 3，先預留)
├─ id, session_id, taxon_id
├─ method ('count'|'cover'|'braun_blanquet'|'domin'|...)
├─ value (REAL)
├─ unit / scale
├─ observed_at, notes, photo_paths, lat, lng

settings (key-value)
├─ language ('zh-TW' MVP only，i18n Phase 2+)
├─ theme ('light'|'dark'|'auto')
├─ undo_duration (5)
├─ card_density ('compact'|'comfortable')
├─ default_count_mode (Phase 3)
├─ last_search_group  ※ TaxonGroupPicker remember last
└─ last_search_query

search_history (recent 10 in 物種查詢頁)
├─ query
└─ searched_at
```

## 搜尋功能對齊清單

與 web 版功能完全對齊（已實作 ✅）：

1. ✅ 台 / 臺自動互換
2. ✅ Accepted-only（non-accepted 自動解析到接受名）
3. ✅ Fuzzy search（Levenshtein 距離 ≤2，預先 build 候選 index）
4. ✅ 排序優先級：cname 精確 → 學名精確 → cname 包含 → alt cname 精確 → alt cname 包含 → prefix → 長度
5. ✅ Nominal infraspecific 去重 + autonym s.l. / s.str. 標示（s.l. 標示用 `markSensuLato` 後處理）
6. ✅ 階層篩選（kingdom / class / order / family / genus）+ 進階篩選（特有 / 外來 / 紅皮書 / CITES / 保育類）
7. ✅ 同俗名替代俗名加括號
8. ✅ 同物異名命中用 `≡` 標示（單行 + tap 展開「你輸入：xxx」）
9. ✅ Fuzzy 命中用 `~` 標示
10. ✅ TaxonGroupPicker（14 類群）+ remember last（存 settings.last_search_group）

## Navigation 結構

### Bottom Bar

- **iOS**：`☰ 地圖(P2) [+] 名錄 分類樹(P2)`（FAB 凸出 +）
- **Android**：同上
- MVP 階段「地圖」「分類樹」disabled 顯示 placeholder

### Drawer-style Menu Tab (☰)

點選單 tab 進入 menu 頁，含：

- 專案管理 ✅
- 物種查詢 ✅（獨立搜尋入口，不歸屬任何 session）
- 匯出 ✅（YAML / CSV）
- 偏好設定 ✅
- 資料更新（Phase 2）
- 關於 ✅

### Active Session 頂部 Bar

有 active session 時固定在所有頁面頂部（用 `useSafeAreaInsets()` 處理動態島）：

```
● 記錄中：YYYY-MM-DD HH:mm
```

Tap 跳到當前 session 詳細頁。MVP 限制單一 active session。

### Stack Routes

| 路徑 | 內容 |
|------|------|
| `(tabs)/menu` | drawer-style 入口 |
| `(tabs)/index` | 名錄 tab（sessions 列表）|
| `(tabs)/map` | Phase 2 placeholder |
| `(tabs)/taxonomy` | Phase 2 placeholder |
| `(tabs)/plus` | redirect / FAB 觸發 |
| `session/[id]` | session 詳細頁 |
| `lookup` | 物種查詢頁 |
| `projects` | 專案管理頁 |
| `settings` | 偏好設定 |
| `about` | 關於 |
| `export` | 匯出（按 session 列表） |

## 主要畫面

### 1. 名錄 tab (Sessions 列表)

- 時間倒序、無分組
- Active session 醒目（綠點 + 「記錄中」tag）
- Row 顯示：時間、名稱（如不同於時間戳）、筆數 + project 名稱
- **Swipe-left → 紅色「刪除」** + confirm prompt（confirm 後刪除整個 session 含 records）
- Tap row → session 詳細頁
- 多選 → Phase 2

### 2. Session 詳細頁

```
┌─────────────────────────────────┐
│ ← 返回   [project name]   [結束]│  ← title 顯示 project（assigned）或時間戳
├─────────────────────────────────┤
│ 📁 蓮華池植物名錄 ▼      6 筆   │  ← 可 tap 開 ProjectAssignSheet
├─────────────────────────────────┤
│ [全部 6] [植物 6] ...           │  chip filter sticky
├─────────────────────────────────┤
│ 物種卡片：                       │
│  [照片] 大葉雀榕             NLC│
│         Ficus caulocarpa Miq.   │
│         桑科 Moraceae            │
│ ...                             │
├─────────────────────────────────┤
│ [▽ 維管束植物]                   │  TaxonGroupPicker
│ [輸入物種/分類群關鍵字...]       │  底部搜尋框
└─────────────────────────────────┘
```

**互動：**
- Tap 卡片 → 開 detail bottom sheet
- **Swipe-left → 紅色「移除」**（自動 + 5 秒 undo toast）
- Swipe-right → Phase 2（加備註 / 照片 / 重點）
- Tap 上方專案標籤 → ProjectAssignSheet（指派 / 新建專案）
- 右上「結束」→ B2 modal

**搜尋互動：**
- Autocomplete 最多 20 筆 scroll
- TaxonGroupPicker（14 類群）+ remember last
- Prefix match 優先
- 同物異名 `≡` 標示
- Fuzzy 命中 `~` 標示
- Tap row → 加入名錄 + Toast「已加入：xxx」5 秒可 undo
- 加入後：清空搜尋框 + 鍵盤保持開 + 焦點留搜尋框
- 搜尋框空字串時：顯示最近 5 筆 recent

### 3. Detail Bottom Sheet (tap 物種卡片)

```
─── (drag handle) ───
大葉雀榕                          [×]
Ficus caulocarpa Miq.
桑科 Moraceae
─────────────────────────────────
物種狀態
  [特有] [原生] [雜交]   棲地
保育狀態
  紅皮書 NLC · IUCN – · CITES – · 保育類 –
同物異名 (n)
  • Ficus xxx ...
此次紀錄
  時間：2026-05-11 09:13
  [編輯備註]    ← E2 全螢幕 modal
  照片  (Phase 2)
外部連結
  TaiCOL · GBIF · iNaturalist · Wikispecies
  植物加：IPNI · POWO
─────────────────────────────────
[ 從名錄移除 ]
```

### 4. 物種查詢頁 (drawer 入口)

獨立 search，不歸屬任何 session：

- 同 session 搜尋 UI
- Tap row → LookupResultSheet（同 detail sheet 但 action 改為「加到當前 session」）
- 沒 active session 時自動建 session 後加入
- 查詢歷史 recent 10 筆，獨立維護

### 5. ProjectAssignSheet（新增於 v0.1）

從 session 詳細頁頂部專案標籤觸發：

```
─── (drag handle) ───
指派專案
─────────────────────────────────
 [+] 新建專案     ← 跳 ProjectEditModal
─────────────────────────────────
📂 未分類 ✓
📁 蓮華池植物名錄
📁 浸水營植物相
...
─────────────────────────────────
```

選擇後立即 update session.project_id + reload + toast 「已更新專案」

### 6. 結束 Session 流程 (B2 modal)

按右上「結束」後跳全螢幕 modal：

```
結束記錄？
共 6 筆 · 歷時 1 小時 23 分鐘

名稱：[2026-05-11 07:10 ____]
專案：[蓮華池植物名錄 ▼]
備註：[____]

[取消]  [結束]
```

未結束的 session 隔日自動 prompt（TODO）

### 7. 偏好設定 (MVP)

- 主題（淺 / 深 / 跟隨系統）
- Toast undo 時長（5 / 8 / 10 秒）
- 物種卡片密度（緊湊 / 寬鬆）
- 清除查詢歷史
- 清除所有資料（雙重 confirm，目前 placeholder）

### 8. Empty States

| 畫面 | 文字 |
|------|------|
| 名錄 tab 無 session | 「還沒有任何記錄。按下方 + 開始第一筆名錄」+ 大 + icon |
| Session 內無物種 | 「按下方搜尋框找物種加入名錄」+ 搜尋 icon |
| Search 無結果 | autocomplete 為空（fuzzy 已嘗試）|

## 互動慣例

| 動作 | 行為 |
|------|------|
| Tap 物種卡片 | 開 detail bottom sheet |
| Long-press 物種卡片 | Phase 2 quick action menu |
| Tap autocomplete row | 加入名錄（明確意圖）|
| **Swipe-left** | **刪除 / 移除（紅 + trash icon + undo toast）** |
| Swipe-right | Phase 2 非破壞性操作 |
| Tap 頂部 active bar | 跳到當前 session |
| Tap session header 專案標籤 | 開 ProjectAssignSheet |
| Tap detail sheet 外部連結 | 開系統瀏覽器 |
| Pull-down on bottom sheet | 關閉 sheet |
| Tap modal 半透明背景 | 關閉 modal |

## App 啟動流程

- **首次啟動**：DBProvider copy TaiCOL DB 到 documentDirectory，runUserMigrations 建表（含預設 project id=0「未分類」），載入 settings → 進主畫面
- **不做 onboarding**：直接進主畫面
- **首次按 +**：直接建 session，預設 project_id = 0
- **之後按 +**：B1 零步驟，直接開 session 進搜尋畫面
- **記住上次 TaxonGroup**：last_search_group 存 settings，SearchBox 載入時恢復

## 匯出

| 格式 | 狀態 | 備註 |
|------|------|------|
| YAML | ✅ MVP | 與 web 版 byte-level 相容（透過 dwcMapper 對應）|
| CSV | ✅ MVP | DwC 36 欄 + UTF-8 BOM |
| Markdown | ✅ MVP | 維管束植物 6 類群分流、autonym s.l./s.str.、保育統計、計畫 header |
| DOCX | **永久 N/A** | pandoc 無法 bundle，請用 web 版開 YAML 轉 |

匯出後透過 `expo-sharing` 開系統 Share Sheet（傳 LINE / email / AirDrop / 存到 Files）。

## 學名 italic 規範

由 `<ScientificName>` 元件統一處理，UI 與 Markdown 兩端規則一致：

| 元素 | Italic | 說明 |
|------|--------|------|
| 屬名（Genus）| ✅ | 例：*Quercus* |
| 種小名（specific epithet）| ✅ | 例：*glauca* |
| 種下小名（subordinate epithet）| ✅ | 例：*amamiana* |
| Rank 縮寫 `var.` `subsp.` `ssp.` `f.` `fo.` `×` | ❌ | 中間斷開斜體 |
| 命名者（author）| ❌ | 例：(Hayata) Hayata |
| 科名拉丁（family）| ❌ | 例：Fagaceae |
| 目 / 綱 / 門 / 界拉丁 | ❌ | |
| 中文俗名 / 中文階層名 | ❌ | 例：殼斗科、被子植物門 |

動物（kingdom = `Animalia` 或 nomenclature = `ICZN`）：trinomial 全 italic（`*Panthera tigris altaica*`），無 rank 縮寫。

植物 / 真菌 / 預設：epithet 級分割 italic（`*Quercus glauca* subsp. *amamiana* Hayata`）。

## 風險與待解問題

1. **TaiCOL DB 體積**：✅ 118MB 可接受，已驗證 simulator 能跑
2. **匯出格式一致性**：✅ YAML / CSV 對齊 backend dwc_field_map
3. **Fuzzy search 效能**：✅ 預先 build cname_fuzzy_index 表，runtime ~10-30ms
4. **iOS / Android UI 差異**：⏰ Android 還沒驗證
5. **沒有公開 server**：⏰ 資料更新、跨裝置同步皆受限
6. **Xcode 26 + Expo CLI 54 不相容**：⏰ `expo run:ios --device` 失敗，目前透過 Xcode workspace build 繞過
7. **免費 Apple ID 簽署 7 天過期**：⏰ 野外長期測試需 Apple Developer Program ($99/年)

## 開發 / Build 速查

```bash
# 開發
cd mobile/app
npx expo start --dev-client --clear     # Metro，加 --clear 清快取
npx expo run:ios                        # 第一次或加新 native module 後重 build

# 加 native module 流程
npx expo install <package>              # 自動裝對應 SDK 版本
cd ios && pod install                   # 安裝 native pods
cd .. && npx expo run:ios               # 重 build（吃約 3-5 分鐘）

# Fuzzy index 重 build（若 TaiCOL 更新）
cd /path/to/checklister-ng
backend/venv/bin/python backend/scripts/build_mobile_fuzzy_index.py mobile/app/assets/db/twnamelist.db

# Type check
cd mobile/app && npx tsc --noEmit
```

## EAS Build（推實機 / 上架用）

`eas.json` 已建好，含 development / development-sim / preview / production 4 個 profile。第一次使用前要：

```bash
# 1. 安裝 EAS CLI（全域）
npm i -g eas-cli

# 2. 登入 Expo 帳號（需要 Expo account）
eas login

# 3. 在 mobile/app 目錄初始化 EAS project（會寫入 app.json extra.eas.projectId）
cd mobile/app
eas init

# 4. 第一次 build dev client 推實機（iPhone）
eas build --profile development --platform ios
# 完成後會給安裝連結 / QR code，iPhone 開瀏覽器掃進去裝

# 5. 之後 Metro 連到 dev client（同 WiFi）
npx expo start --dev-client

# Build production IPA（內測用，不上架）
eas build --profile preview --platform ios

# Production + 自動上 App Store Connect
eas build --profile production --platform ios
eas submit --platform ios
```

**已知限制**：
- 需 Apple Developer Program ($99/年) 才能裝到實機（免費 Apple ID 限 simulator + 7 天 dev cert）
- Free tier EAS 每月 30 build 額度
- `production` profile 的 auto increment build number 會在 EAS server 上計算（appVersionSource: remote）

