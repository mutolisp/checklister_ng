# 名錄管理介面實作計畫

## 一、介面佈局

```
┌──────────────────────────────────────────────────────────┐
│  搜尋列：[搜尋欄 (俗名/學名)]                    [新增]  │
├──────────────────────┬───────────────────────────────────┤
│  左面板：編輯表單      │  右面板：同物異名選單             │
│                      │                                   │
│  Taxon ID: t0052518  │  ● 26074 Abies kawakamii         │
│  Name ID:  26074     │    (Hayata) Ito [accepted]       │
│                      │  ○ 25921 Abies mariesii var.     │
│  分類階層（唯讀）      │    kawakamii Hayata [not-accepted]│
│  Plantae > ... > Abies│                                  │
│                      │                                   │
│  [可編輯欄位]         │                                   │
│  俗名: 臺灣冷杉      │                                   │
│  別名: 台灣冷杉      │                                   │
│  現存於臺灣: ✓       │                                   │
│  特有性: ✓（Species↓）│                                   │
│  原生/歸化: native   │                                   │
│  國內紅皮書: NLC     │                                   │
│  IUCN: NT            │                                   │
│                      │                                   │
│  [儲存] [取消]       │                                   │
└──────────────────────┴───────────────────────────────────┘
```

## 二、操作流程

### 流程 A：編輯現有記錄

1. 搜尋欄輸入 → 下拉建議
2. 選取物種 → 用 taxon_id 查出所有 name_id
3. 右面板列出同物異名清單（accepted 排前，預設選 accepted）
4. 左面板載入該 name_id 完整欄位
5. 修改欄位
6. 點「儲存」→ 確認 popup（顯示變更 diff）
7. 確認後 PUT /api/admin/name/{name_id}

### 流程 B：新增記錄（以 taxon 為基礎）

1. 點「新增」→ Modal
2. Step 1: 學名、命名者、Rank
3. Step 2: 分類階層（聯動下拉）
4. Step 3: 俗名、狀態、保育等級
5. 預覽 → 確認 → POST /api/admin/name

## 三、後端 API

| 端點 | 方法 | 說明 |
|------|------|------|
| `GET /api/admin/name/search?q=` | GET | 管理用搜尋（含 name_id） |
| `GET /api/admin/name/{name_id}` | GET | 單筆完整記錄 |
| `PUT /api/admin/name/{name_id}` | PUT | 更新（送 diff，寫 audit log） |
| `POST /api/admin/name` | POST | 新增（自動 name_id，驗證必填） |
| `GET /api/admin/taxon/{taxon_id}/names` | GET | 同 taxon 下所有 names |
| `GET /api/admin/taxonomy/options?rank=&parent=` | GET | 聯動下拉選項 |

### 安全機制

- PUT 只更新有變更的欄位，回傳 before/after
- 寫入 `admin_audit` 審計表
- 不提供 DELETE（太危險）
- 分類階層編輯時唯讀，只有新增時可設定
- 每 session 第一筆修改前自動備份資料庫

## 四、`admin_audit` 審計表

```sql
CREATE TABLE IF NOT EXISTS admin_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT DEFAULT (datetime('now')),
    action      TEXT,       -- 'update' / 'create'
    name_id     INTEGER,
    field       TEXT,
    old_value   TEXT,
    new_value   TEXT
);
```

## 五、欄位分類

| 欄位 | 編輯模式 | 新增模式 | 條件 |
|------|----------|----------|------|
| name_id | 唯讀 | 自動 | — |
| taxon_id | 唯讀 | 自動/指定 | synonym 需指定已有 taxon_id |
| simple_name | ✓ | ✓ | — |
| name_author | ✓ | ✓ | — |
| rank | ✓ | ✓ | — |
| usage_status | ✓ | ✓ | — |
| kingdom~genus | 唯讀 | ✓ | 編輯時鎖定 |
| family_c, genus_c | ✓ | ✓ | — |
| common_name_c | ✓ | ✓ | — |
| alternative_name_c | ✓ | ✓ | — |
| is_in_taiwan | ✓ | ✓ | 顯示為「現存於臺灣」 |
| is_endemic | ✓ | ✓ | rank=Species 以下才顯示 |
| alien_type | ✓ | ✓ | rank=Species 以下才顯示 |
| redlist | ✓ | ✓ | rank=Species 以下才顯示 |
| iucn | ✓ | ✓ | rank=Species 以下才顯示 |

## 六、前端元件

| 元件 | 說明 |
|------|------|
| `admin/+page.svelte` | 加 Tab：「CSV 匯入」/「名錄管理」 |
| `AdminNameEditor.svelte` | 左面板編輯表單 |
| `AdminNameList.svelte` | 右面板同物異名清單 |
| `AdminAddModal.svelte` | 新增 Modal（三步驟） |
| `AdminConfirmDialog.svelte` | 儲存確認 popup（diff） |

## 七、實作步驟

### Phase 1：編輯功能（先做）
1. 建立 `admin_audit` 表
2. 後端 API：GET name, GET taxon names, PUT name
3. 前端：搜尋 + 編輯表單 + 同物異名面板 + 確認 popup
4. 驗證：用虛擬測試資料確認完整流程

### Phase 2：新增功能（後做）
1. 後端 API：POST name, GET taxonomy options
2. 前端：新增 Modal（聯動下拉）
3. taxon_id 自動產生邏輯
