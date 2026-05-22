# Identification Key 雜項補完待辦

記錄已知缺口、待補資料、PDF/TaiCOL 不一致處的雜項清單，未來有時間或新資料來源時補完。

## Orchidaceae 蘭科

### Master key 漏 sp 的 genus（PDF 無 subkey 但 TaiCOL accepted ≥ 2 sp）

| Genus | Master key inline 用 | TaiCOL accepted sp 數 | 漏的 sp |
|-------|---------------------|---------------------|---------|
| Acampe | Aerides rigida (= Acampe rigida) | 2 | 待查 |
| Bletilla | Bletia formosana (= Bletilla formosana) | 2 | 待查 |
| Cephalanthera | Cephalanthera alpicola | 2 | 待查 |
| Chrysoglossum | Chrysoglossum ornatum | 2 | 待查 |
| Hemipilia | Hemipilia cordifolia | 2 | 待查 |
| Malaxis | Ophrys monophyllos (= Malaxis monophyllos) | 2 | 待查 |
| Saccolabiopsis | Saccolabiopsis taiwaniana | 2 | 待查 |
| Vanilla | Vanilla somae | 2 | 待查 |

備註：Amitostigma 的第 2 sp `alpestre` 已透過 Ponerorchis subkey #4A (Ponerorchis alpestris synonym fallback) 連到，路徑不直觀但有覆蓋，不算漏。

### 不可達 subkey（mobile findSubkeyForTaxon 透過 taicol_names.genus 欄查，這幾屬已被 TaiCOL 合併）

| Worksheet | TaiCOL tid | 實際 genus 欄 | 漏的 sp |
|-----------|-----------|--------------|--------|
| Phaius | t0023351 (= Calanthe 根節蘭屬) | Calanthe | mishmensis、tankervilleae |
| Paraphaius | t0023351 (= Calanthe) | Calanthe | woodfordii、takeoi |
| Cephalantheropsis | t0023351 (= Calanthe) | Calanthe | kooshunensis、obcordata、dolichopoda、longipes |

決策（2026-05-15）：維持現狀 + 此處 note 限制。Mobile click 進去會跳到 Calanthe subkey（不含這 8 sp）。未來若 mobile 改成支援 scope_name 直接查（而非走 taxon_id → genus 欄），可恢復可達。

### Master key dead-end（無 subkey 也未 inline）

| Genus | TaiCOL accepted sp 數 | 備註 |
|-------|---------------------|------|
| Papilionanthe 台灣萬代蘭屬 | 4 (taiwaniana, teres, pseudotaiwaniana, vandarum) | PDF 無 subkey；master 直接用 genus terminal，drilldown 失效 |

### UNRESOLVED leads（PDF 名稱完全不在 TaiCOL）

| Worksheet | Couplet | 名稱 | 備註 |
|-----------|---------|------|------|
| Cheirostylis | #10B | Cheirostylis tortilacinia var. wutaiensis 擬紅衣指柱蘭 | TaiCOL 無此 taxon；PDF 從 var. rubrifolius 分出 |
| Oberonia | #8B | Oberonia formosana fo. viridiflora 綠花台灣莪白蘭 | TaiCOL 只到 species 級 |
| Odontochilus | #7A | Odontochilus brevistylus subsp. candidus 白齒唇蘭 | TaiCOL 主名 Odontochilus brevistylus 短柱齒唇蘭，PDF subsp. 不存在 |
| Styloglossum | #3B | Styloglossum clavata 樺葉根節蘭 | TaiCOL 無此 taxon |

Mobile UI 顯示 lead 文字但無 taxon 連結。

### Cross-couplet duplicate terminals（PDF 區分 / TaiCOL 合併）

| Worksheet | Couplets | TaiCOL 同一 taxon | 備註 |
|-----------|---------|--------------------|------|
| Goodyera | 12A, 13B | t0053852 schlechtendaliana 斑葉蘭 | PDF 用方格網紋 vs 方格塊斑分；TaiCOL 已合併 kwangtungensis |
| Goodyera | 3A, 18A | t0053856 procera 穗花斑葉蘭 | PDF 兩處不同特徵都到 procera |
| Nervilia | 6A, 12A | t0054578 taitoensis 單花脈葉蘭 | PDF 不同葉特徵都到 taiwaniana → TaiCOL accepted taitoensis |

不影響功能，UI 兩條路徑會跳到同種。

## Myrtales 桃金孃目

### Trapa 菱屬 degenerate（PDF 5 sp 但 TaiCOL 合併 3 → 1）
PDF 區分 5 sp 用果型/角度特徵，TaiCOL 把以下 3 個 PDF 名稱全部 lump 到同一 accepted taxon：
| PDF 名稱 | TaiCOL accepted | tid |
|---------|----------------|-----|
| Trapa bicornis var. taiwanensis 臺灣菱 | Trapa natans var. bispinosa 菱 | t0055638 |
| Trapa bispinosa 二角菱 | Trapa natans var. bispinosa 菱 | t0055638 |
| Trapa japonica 日本菱 | Trapa natans var. bispinosa 菱 | t0055638 |
| Trapa pseudoincisa 格菱 | Trapa natans var. complana 格菱 | t0069662 |
| Trapa maximowiczii 鬼菱 | Trapa natans var. japonica 鬼菱 | t0055639 |
| Trapa incisa 小果菱 | Trapa incisa 小果菱 (本來就 accepted) | t0055637 |

Trapa worksheet couplet 2A、4A、4B 在 mobile UI 都會顯示 `Trapa natans var. bispinosa 菱`（同一 taxon）。保留 PDF synonym Latin 讓 lead 描述可區分，但實際 drilldown 終點相同。

### Onagraceae Oenothera dead-end
PDF Onagraceae family key 列 Oenothera 待肯草屬為 genus terminal 但無 subkey。TaiCOL 8 sp accepted (biennis 月見草、drummondii 海濱月見草、glazioviana 黃花月見草、laciniata 裂葉月見草、rosea 粉花月見草、stricta 待宵草、tetraptera 四翅月見草、speciosa 美麗月見草)。未來如有外部資料可建 subkey。

## Malpighiales 黃褥花目

### Glochidion lanyuense 蘭嶼饅頭果 UNRESOLVED
PDF Phyllanthaceae Glochidion subkey couplet 5A 為 Glochidion lanyuense 蘭嶼饅頭果，但 TaiCOL 完全沒有此 taxon (lanyuense / lanyuensis 都查無)。保留 PDF 字串作為 lead 文字，target_id 存原始 sciname。

### 跳過家族（0sp 或 1sp inline）
- Achariaceae 鐘花科 (1 gen, 0 sp accepted)
- Chrysobalanaceae 可可李科 (1 gen, 0 sp accepted)
- Ochnaceae 金蓮木科 (1 gen, 0 sp accepted)
- Linaceae 亞麻科 (1 sp inline，PDF 無 key)

## Fabales 豆目

### Desmanthus pernambucanus 合歡草 UNRESOLVED
PDF Fabaceae Desmanthus subkey couplet 2B 為 Desmanthus pernambucanus 合歡草，但 TaiCOL 完全沒有此 taxon。保留 PDF 字串。

### Desmodium 屬大規模 TaiCOL 重新分類 (Grona/Sohmaea/Polhillides 等 9 個新屬)
TaiCOL 把 Desmodium 屬大幅拆分。worksheet 名仍用 Desmodium、bare epithet 仍走 synonym fallback：mobile UI 會顯示新屬名 (Grona heterocarpa 假地豆、Pleurolobus gangeticus 大葉山螞蝗 等)。功能 OK，視覺差異而已。

## 2026-04-24 TaiCOL 更新後手動修正清單

備份：`backend/twnamelist.db.preimport-20260424`、`backend/twnamelist.db.bak.20260517202603`

### A. 需手動改 Google Sheet 的 4 條 raw sciname fallback ✅ 2026-05-22 完成

TaiCOL 沒有對應 accepted name，import 後保留為 raw sciname。已透過 Sheets API 修 sheet → 重 import → `make mobile-db`。Sheet：`18Nk9ZJbCzdV4c_I4TaIoVTJcMdL3MA9rcWctgFqc7VM`（IdentKey::Asterales）。

| # | Worksheet!Cell | 修前 | 修後 | TaiCOL 對應 |
|---|---|---|---|---|
| 1 | Ainsliaea!C4 (2A) | `apiculata var. acerifolia 中原氏鬼督郵` | `secundiflora 中原氏鬼督郵` | t0052546 Ainsliaea secundiflora |
| 2 | Ainsliaea!C12 (6A) | `Ainsliaea latifolia var. taiwanensis 臺寬葉兔兒風` | `latifolia 臺灣鬼督郵` | t0060886 Ainsliaea latifolia |
| 3 | Ainsliaea!C17 (8B) | `henryi var. subalpina 玉山鬼督郵` | `latifolia subsp. henryi 臺灣鬼督郵` | t0033661 Ainsliaea latifolia subsp. henryi（與 8A var. henryi 合併為 degenerate dichotomy；TaiCOL 已合併無法區分） |
| 4 | Blumea!C25 (12B) | `chishanensis 池上艾納香` | `chishangensis 池上艾納香` | t0099236 Blumea chishangensis（PDF 純拼字錯） |

驗證：`_check_stale_key_taxon_ids()` 從 19→15 條，A 組 4 條全部清除。

### B. 4 個變動屬（只需 re-import sheet 即可自動 resolve，不需改 sheet 內容）

TaiCOL 把屬合併 / 升降級 / tid 換號，但 sheet 原文 sciname 還能透過 synonym 反查連到新 tid。以下這 4 個 sheet 跑一次 re-import 就會用新 sciname 連到正確 tid。

| # | Worksheet | Couplet | 變動內容 | 操作 |
|---|----------|---------|---------|------|
| 1 | Urticaceae | **16B** | `Pellionia` 整屬併入 `Elatostema` 樓梯草屬 (t0023758)。Re-import 後 16A/16B 都會指向同一個 t0023758 → dichotomy degenerate | 重 import 後檢視 16 是否要重設 / 刪除，或把 Pellionia 的種拆成 Elatostema 種級下層 |
| 2 | Paris | **3B** | `Paris taitungensis` (now not-accepted) → 對到 t0058696 高山七葉一枝花 (= `Paris polyphylla var. stenophylla` / `Paris lanceolata`) | sheet 原 sciname 改寫成 `Paris lanceolata` 或保留 taitungensis，re-import 自動 resolve |
| 3 | Angelica | **5B** | `Angelica nanhutashanensis` (var. now not-accepted) → 對到 t0086617，建議 promote 到 nominal `Angelica morrisonicola` (t0060968 玉山當歸) | sheet 改成 `Angelica morrisonicola` |
| 4 | Cirsium | **12A** | `Cirsium japonicum var. australe` 南國小薊 sciname 不變，但 tid 由 t0087363 → t0053017 | sciname 不需改，re-import sheet 自動拿新 tid |

### 操作步驟（每組改完跑一次）

```bash
# 1. 在 Google Sheet 對應 row 改學名
# 2. Re-import 該 spreadsheet
backend/venv/bin/python -m backend.services.key_sheet_import <SPREADSHEET_ID>

# 3. 同步 mobile bundle DB
make mobile-db

# 4. 驗證 stale check 不再列出該 lead
backend/venv/bin/python -c "from backend.services.taicol_import import _check_stale_key_taxon_ids; import json; print(json.dumps(_check_stale_key_taxon_ids(), ensure_ascii=False, indent=2))"
```

## 後續維護建議

1. 若 PDF 修訂版 (2025+) 出現，可重新 parse 補完 master key。
2. 若 TaiCOL 重新分類 (Calanthe / Phaius / Cephalantheropsis 等)，重 audit 時需檢查 worksheet → taxon_id → genus 欄一致性。
3. Mobile findSubkeyForTaxon 若改用 scope_name 直查，原本不可達的 worksheet（Phaius/Paraphaius/Cephalantheropsis）會自動恢復可達。
4. 每次 TaiCOL 大更新後，跑 `_check_stale_key_taxon_ids()` + 比對 `raw_sciname_fallback` 數量變化，新增的就是要手動處理的清單（區分 A. raw sciname 需改 sheet vs B. tid 換號只需 re-import）。
