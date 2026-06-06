# 樣區調查設計與現況（Vegetation / fauna survey）

> 本檔原為實作前設計稿，現已更新為「實際實作現況」。Schema 版本與 UI 行為以程式碼為準；
> sprint 細節見 `Plan.md`、踩坑記錄見 `Update_log.md`。

## 調查法（三種，皆已實作）

| 類型 `plot_type` | 中文 | 特性 | GPS / 解鎖物種輸入 |
|---|---|---|---|
| `fixed` | 固定樣區 | 分植群層 E1-E6（1-6 層可調），每層 cover%/height/method | 靜態 GPS（lat/lng/uncertainty 三欄非 null） |
| `transect` | 穿越線 | 錄製軌跡（MultiLineString），不分層，單一 'T' 桶 | 軌跡啟用即 stamp `start_ts` 解鎖 |
| `point_count` | 定點計數法 | 半徑 `point_radius_m` + 起迄時間 + 不分層；鳥/動物常用，隻數 individuals | 靜態 GPS（同 fixed） |

非分層類型（transect / point_count）在物種頁不顯示分層 chips/header，記錄一律歸 `'T'` 桶，靠 `plot_type` 區分語意。分支判斷統一走 `isStratified` / `usesTrack` / `requiresStaticGps`（`src/db/plots.ts`）。

## 資料模型（DB schema 沿革）

### 環境（`plot_surveys`）
- 身份 / 事件：`uuid`、`plotid`(eventID)、`plot_type`、`project_id`、`site_id`、`status`、`start_ts`/`stop_ts`/`resumed_at`
- DwC 定位：`decimal_latitude`/`decimal_longitude`/`coord_uncertainty_m`、`elevation_m`
- 調查協定：`sampling_protocol`、`sample_size_value`/`sample_size_unit`、`point_radius_m`（v13，定點計數半徑）、`total_cover_pct`、`recorded_by`、`locality`、`field_note`
- 地形 / 地表：`slope_deg`/`aspect_deg`/`terrain_position`/`rock_cover_pct`/`gravel_cover_pct`/`bareland_cover_pct`
- 分層數 `layer_count`(1-6, v12)、環境照片 `env_photos_json`(v12)
- 軌跡：`track_geojson`/`track_finalized`（transect）

### 分層（`plot_survey_layers`，v12 正規化表，僅 fixed）
- 一 plot 多 row：`layer_index`(1-6) + `cover_pct` + `height_cm` + `method`(BB/percent/DBH)
- Label 寫死 EUNIS：E1 苔蘚 / E2 草本 / E3 灌木 / E4 亞喬木 / E5 主林冠 / E6 突出
  （注意：舊稿的 E0-E3 已於 v12 整體上移 +1，生態語意不變）

### 物種（`plot_species_records`）
- `taxon_id`（自動對到 TaiCOL）、`layer`('E1'..'E6' | 'T')
- 豐度（v9 通用化）：`organism_quantity` + `organism_quantity_type`
  （內建 Braun-Blanquet / % cover / individuals / DBH(cm) + 自定義；舊 `bb_value`/`percent`/`dbh_values_json` 已遷移、deprecated）
- DwC 屬性（v8）：`sex` / `life_stage`（依 class 動態）/ `reproductive_condition` / `leaf_phenology`（後兩者多值，JSON array）
- **偵測方式 `detection_type`（v13）**：`seen` 看到 / `heard` 聽到 / `flying` 飛過，UI 在定點計數或動物記錄顯示
- **per-record 座標 `lat`/`lng`/`accuracy`（v13）**：三種樣區皆可逐筆記錄（穿越線最常用）
- `notes`、`photo_paths`、`observed_at`

## 輸入流程

1. 建立：FAB → 選樣區類型（固定 / 穿越線 / 定點計數）→ 輸入 plotid → 進環境頁
2. 環境頁先填必填：plotid、專案、GPS（或穿越線軌跡）；point_count 另填半徑 + 起迄時間
3. 物種頁加入物種：搜尋 → 輸入豐度（型別自選）+ 屬性 + 偵測方式（動物/點計數）+ per-record GPS（編輯時）

## 匯出（樣區 + 快速名錄，使用者填的資料皆會匯出）

- 樣區 zip：`{plotid}_env.csv`（環境，含 point_count 半徑）、`{plotid}_sp.csv`（物種，含 sex/lifeStage/reproductiveCondition/leafPhenology/**detectionType**/**decimalLatitude/Longitude/coordinateUncertaintyInMeters**/eventRemarks；point_count 的 verbatimVegetationLayer 留空）、`{base}.yml`（同欄位對稱）、`points.geojson|gpx|kml`（per-record 座標）、`track.*`（穿越線）、`site.*`、`photos/`
- 名錄 session：YAML/CSV/Markdown + env.csv/sp.csv + points/site + photos。YAML 與 CSV 現已補回 `notes` + 四屬性（先前 bundle YAML / 名錄 exporter 會漏）
- DwC 對應（`dwcMapper.ts`）：新增 `notes→occurrenceRemarks`、`rank→taxonRank`、`detection_type→detectionType`（自訂 term，DwC 無標準）
- 多值欄位以 `|` 分隔（沿用 `multiToPipe`/`multiToDwc`）；Markdown 為可讀清單，行尾附「（豐度；備註）」

## 已知取捨

- `point_count` 沿用 `'T'` 桶（避免 layer CHECK rebuild），凡涉 layer 語意處一律配 `plot_type` 判別；匯出時 point_count 的 `verbatimVegetationLayer` 留空。
- `detection_type` 目前僅 `plot_species_records`（名錄 `checklist_records` 未加，需要時再開）。
- 偵測方式 / 屬性的英文 enum 為匯出真相源，UI 顯示中文 label。
