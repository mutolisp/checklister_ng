# 分類資料品質檢核計畫

## 介面設計

Admin 頁面第三個 Tab「資料品質」，以表格呈現各類檢核結果。每個檢核項目一個區塊，展開後顯示問題記錄表格，可點擊 name_id 跳到編輯頁面修正。

```
┌─────────────────────────────────────────────────────┐
│  名錄管理  │  CSV 匯入  │  資料品質  │              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [執行檢核]                                         │
│                                                     │
│  ▼ A1. 缺階層欄位 (327 筆)                          │
│  ┌──────┬──────────────────┬───────┬──────────┐    │
│  │name_id│ simple_name      │ rank  │ 缺少欄位  │    │
│  │123456 │ Abies xxx        │Species│ family    │    │
│  │123457 │ Quercus yyy      │Species│ order     │    │
│  └──────┴──────────────────┴───────┴──────────┘    │
│                                                     │
│  ▼ A3. 孤立 taxon_id (15 筆)                        │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

## 檢核項目

### Phase 1：SQL 可自動檢測（優先實作）

| ID | 檢核名稱 | 說明 | SQL 邏輯 | 嚴重度 |
|----|---------|------|----------|--------|
| A1 | 缺階層欄位 | Species 缺 kingdom/phylum/class/order/family/genus | `WHERE rank='Species' AND (family IS NULL OR family='')` | 高 |
| A2 | 階層斷層 | family 有值但 order 為空（中間層斷掉） | `WHERE family!='' AND (order IS NULL OR order='')` | 高 |
| A3 | 孤立 taxon_id | 只有 not-accepted/misapplied，沒有 accepted name | `GROUP BY taxon_id HAVING SUM(CASE usage_status WHEN 'accepted' THEN 1 ELSE 0 END) = 0` | 高 |
| A4 | 多 accepted | 同 taxon_id 有多筆 accepted | `GROUP BY taxon_id HAVING SUM(CASE usage_status WHEN 'accepted' THEN 1 ELSE 0 END) > 1` | 中 |
| B3 | 重複學名 | 同一 simple_name + name_author 出現多筆 | `GROUP BY simple_name, name_author HAVING COUNT(*) > 1` | 中 |
| B5 | 俗名不一致 | 同 taxon_id 下 accepted 與 synonym 的俗名不同 | 比對 common_name_c 是否一致 | 低 |
| B6 | 空俗名 | accepted name 沒有 common_name_c | `WHERE usage_status='accepted' AND (common_name_c IS NULL OR common_name_c='')` | 中 |
| D1 | 階層值不一致 | 同一 family 但上層 order 值不同 | `GROUP BY family HAVING COUNT(DISTINCT "order") > 1` | 高 |
| D3 | 中文名不一致 | 同一 family 但 family_c 有不同值 | `GROUP BY family HAVING COUNT(DISTINCT family_c) > 1` | 低 |

### Phase 2：需要進階邏輯

| ID | 檢核名稱 | 說明 | 方法 | 嚴重度 |
|----|---------|------|------|--------|
| B1 | 學名拼寫疑似錯誤 | Levenshtein distance 相近的不同學名 | fuzzy matching | 中 |
| B2 | 命名者格式不一致 | 同作者不同寫法 | 正規化比對 | 低 |
| C1 | 循環同物異名 | A→B→A 的 synonym 循環 | 圖形遍歷 | 高 |
| D2 | 分類群名稱變更未同步 | 科名改了但部分 species 還用舊名 | 跨 taxon_id 比對 | 中 |

### Phase 3：研究項目（待定）

| ID | 檢核名稱 | 說明 |
|----|---------|------|
| E1 | is_in_taiwan 多值 | `true,true` 等多值字串 |
| E2 | taxon_id 多值 | 逗號分隔多個 ID |
| E3 | IUCN/紅皮書覆蓋率 | 統計有值比例 |
| F1 | Chresonym 追蹤 | 文獻引用鏈 |
| F2 | Taxon concept 差異 | sensu lato vs sensu stricto |
| F3 | 跨資料庫名稱對齊 | TaiCOL vs GBIF vs YList |

## 後端 API

```
GET /api/admin/qa/run
  回傳所有檢核結果（各項目的 count + 前 100 筆問題記錄）

GET /api/admin/qa/{check_id}?offset=0&limit=100
  回傳特定檢核的完整問題記錄（分頁）
```

## 回傳格式

```json
{
  "checks": [
    {
      "id": "A1",
      "name": "缺階層欄位",
      "severity": "high",
      "count": 327,
      "items": [
        {
          "name_id": 123456,
          "simple_name": "Abies xxx",
          "rank": "Species",
          "detail": "缺少: family, order"
        }
      ]
    }
  ]
}
```

## 前端元件

| 元件 | 說明 |
|------|------|
| admin/+page.svelte | 第三個 TabItem「資料品質」|
| AdminQAPanel.svelte | 檢核結果面板，可展開/收合各項目 |

## 實作順序

1. 後端 `/api/admin/qa/run` — Phase 1 的 9 項 SQL 檢核
2. 後端 `/api/admin/qa/{check_id}` — 分頁查詢
3. 前端 AdminQAPanel — 表格 + 展開/收合 + 點擊跳轉編輯
4. Phase 2 進階檢核（視需求）
