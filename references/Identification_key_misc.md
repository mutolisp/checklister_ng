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

## 後續維護建議

1. 若 PDF 修訂版 (2025+) 出現，可重新 parse 補完 master key。
2. 若 TaiCOL 重新分類 (Calanthe / Phaius / Cephalantheropsis 等)，重 audit 時需檢查 worksheet → taxon_id → genus 欄一致性。
3. Mobile findSubkeyForTaxon 若改用 scope_name 直查，原本不可達的 worksheet（Phaius/Paraphaius/Cephalantheropsis）會自動恢復可達。
