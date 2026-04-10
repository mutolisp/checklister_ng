# YList 日本維管束植物名錄整合計畫

## 決策

- **架構**：B 方案（分離表 `ylist_names`），與 `taicol_names` 各自獨立
- **分類系統**：一律使用 APG IV（不用 Cronquist / Engler）
- **搜尋範圍**：完全切換，不混資料庫
- **資料來源**：PostgreSQL `nvdimp_legacy.jp_ylist`（已整理過的資料）

---

## Phase 1：資料庫與匯入模板

### 1.1 `ylist_names` 表 schema

```sql
CREATE TABLE ylist_names (
    name_id         INTEGER PRIMARY KEY,
    rank            VARCHAR,          -- species / subspecies / variety / forma
    simple_name     VARCHAR,          -- 學名（不含 author）
    name_author     VARCHAR,          -- author
    fullname        VARCHAR,          -- 學名 withAuthor 原始值
    common_name_jp  VARCHAR,          -- 和名
    alternative_name_jp VARCHAR,      -- 別名
    usage_status    VARCHAR,          -- accepted / synonym / sensu-lato / sensu-stricto / alternative-classification
    family          VARCHAR,          -- APG IV 科名（英文）
    family_jp       VARCHAR,          -- APG IV 科名（日文）
    order_name      VARCHAR,          -- APG IV 目名
    class_name      VARCHAR,          -- 綱名（若有）
    phylum          VARCHAR,          -- 門（Tracheophyta）
    kingdom         VARCHAR,          -- 界（Plantae）
    genus           VARCHAR,          -- 屬名
    genus_jp        VARCHAR,          -- 屬名（日文，若有）
    ecology         VARCHAR,          -- 生態（原欄位：生態）
    published_year  VARCHAR,          -- 発表年
    modified_date   VARCHAR,          -- 修正日
    ylist_id        VARCHAR           -- YList 原始 ID
);
```

注意事項：
- `family` 和 `order_name` 統一用 APG IV，從原始資料的 LAPG 欄位對應
- `kingdom`/`phylum` 全部為 Plantae / Tracheophyta（YList 只收維管束植物）
- `class_name` 需從 order 反推（Magnoliopsida / Liliopsida / Polypodiopsida 等）

### 1.2 狀態映射

| YList ステータス | 語意 | 正規化 `usage_status` | 搜尋時是否視為有效名 |
|-----------------|------|----------------------|-------------------|
| 標準 | accepted name | `accepted` | ✓ |
| synonym | 同物異名 | `synonym` | ✗（解析到 accepted） |
| 広義 | sensu lato | `sensu-lato` | ✓ |
| 狹義 | sensu stricto | `sensu-stricto` | ✓ |
| 異分類 | 不同分類處理 | `alternative-classification` | ✗ |

広義/狹義的處理邏輯：
- 同一和名可能同時有「標準」和「広義」兩筆，需以和名對應
- 搜尋結果顯示時，広義標註「(広義)」、狹義標註「(狹義)」以資區分

### 1.3 匯入服務 `backend/services/ylist_import.py`

```
輸入：CSV 匯出自 nvdimp_legacy.jp_ylist
流程：
  1. 備份資料庫
  2. DROP + CREATE ylist_names 表
  3. 讀取 CSV，欄位映射
  4. 批次 INSERT（5000 筆/批）
  5. 建立索引（common_name_jp, simple_name, family, usage_status）
  6. 回傳統計
```

需要的欄位映射（PostgreSQL → SQLite）：

```
nvdimp_legacy.jp_ylist 欄位    →    ylist_names 欄位
─────────────────────────────────────────────────
（待確認 PostgreSQL 表結構後填入）
```

### 1.4 `admin_api.py` 擴充

新增端點：

```
POST /api/admin/import-ylist
```

- 接受 CSV 上傳（同 import-taicol 的安全檢查）
- 呼叫 `ylist_import.py` 匯入
- 前端 `/admin` 頁面新增 YList 匯入區塊

---

## Phase 2：前端資料庫切換

### 2.1 Dataset Store + Selector

新增 `frontend/src/stores/datasetStore.ts`：

```typescript
export type Dataset = 'taicol' | 'ylist';
// persisted to localStorage
// 預設 'taicol'
```

Navbar 或 SearchBox 加 dataset selector：

```
[🇹🇼 TaiCOL 臺灣物種名錄] ▼
 🇹🇼 TaiCOL 臺灣物種名錄 (242k)
 🇯🇵 YList 日本維管束植物
```

切換時：
- 清空搜尋結果（不清空已加入的名錄）
- 所有 API 呼叫帶上 `?dataset=taicol|ylist`

### 2.2 Search API 抽象化

`search_api.py` 新增 `dataset` 查詢參數：

```
GET /api/search?q=サクラ&dataset=ylist
GET /api/search?q=芒&dataset=taicol   （預設）
```

- `dataset=taicol` → 搜尋 `taicol_names`（現有邏輯不動）
- `dataset=ylist` → 搜尋 `ylist_names`

YList 搜尋邏輯：
- 搜尋欄位：`common_name_jp`（和名）、`alternative_name_jp`（別名）、`simple_name`（學名）、`family`、`family_jp`
- accepted-only：非 accepted 自動解析到 accepted（用和名對應）
- 回傳格式統一（`cname` ← `common_name_jp`，`family_cname` ← `family_jp`）

### 2.3 其他 API 適配

需要帶 `dataset` 參數的 API：
- `GET /api/search` — 搜尋
- `GET /api/search/rank` — 篩選面板
- `GET /api/synonyms` — 同物異名（YList 用和名對應而非 taxon_id）
- `POST /api/export` — 匯出（YList 用 APG IV order 做分類群排序）
- `GET /api/taxonomy/children` — 分類樹
- `GET /api/taxonomy/search` — 分類樹搜尋

### 2.4 匯出適配

YList 匯出時：
- 分類群排序用 APG IV order（與 TaiCOL 維管束植物相同邏輯）
- header 顯示「日本維管束植物名錄」
- 和名取代俗名欄位
- 無 `is_in_taiwan`、`is_endemic`、`alien_type` 等臺灣特有欄位
- 有 `ecology`（生態）欄位可額外顯示

---

## Phase 3：YList 資料清理

### 3.1 從 PostgreSQL 匯出

```bash
psql nvdimp_legacy -c "COPY (SELECT * FROM jp_ylist) TO STDOUT WITH CSV HEADER" > references/ylist_export.csv
```

### 3.2 清理項目

- [ ] 確認 `nvdimp_legacy.jp_ylist` 表結構（COLUMN 名稱與型態）
- [ ] 確認 APG IV 科名/目名欄位是否完整（原始 YList 有 LAPG，需確認是否等同 APG IV）
- [ ] 從 `学名 withAuthor` 拆出 `simple_name`（去掉 author）
- [ ] 正規化 `ステータス` → `usage_status`
- [ ] 處理広義/狹義名稱的對應關係
- [ ] 補齊 `class_name`（從 order 反推：MONOCOT_ORDERS → Liliopsida 等）
- [ ] 確認資料筆數與覆蓋範圍

### 3.3 LAPG vs APG IV

YList 原始資料用 LAPG (Linear APG) 編號系統，這是 APG 系統的線性排列版本：
- LAPG ≈ APG III 的線性版
- LAPGII ≈ APG IV 的線性版（較新）

**結論**：優先使用 LAPGII 欄位（`LAPGII::LAPG Family狭義`、`LAPGII::LAPG Order`），這最接近 APG IV。

---

## 待確認事項

- [ ] `nvdimp_legacy.jp_ylist` 的完整表結構（`\d jp_ylist`）
- [ ] `nvdimp_legacy.jp_ylist_name` 是否也需要？兩個表的關係？
- [ ] YList 是否有 taxon_id 類似的概念可做同物異名串連？
- [ ] 広義/狹義在搜尋結果中如何呈現給使用者？
- [ ] YList 資料的授權條款（是否可自由使用？）

---

## 實作順序

```
Phase 1.1  ylist_names schema + SQLModel model
Phase 1.2  狀態映射
Phase 1.3  ylist_import.py
Phase 1.4  admin_api.py 擴充
  ↕ （可平行）
Phase 3    資料清理 + PostgreSQL 匯出
  ↓
Phase 2.1  datasetStore + selector UI
Phase 2.2  search_api.py dataset 參數
Phase 2.3  其他 API 適配
Phase 2.4  匯出適配
```
