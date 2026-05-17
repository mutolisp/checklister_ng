# Identification keys — 待辦與改進清單

## 🐛 ACTIVE BUG (2026-05-17) — 續查 subordinate subkey 按鈕未渲染

**症狀**: 在 Fagaceae 殼斗科 dichotomous key 跑到屬層 terminal (e.g. couplet 2A → Quercus 櫟屬 t0024667) 時, **沒有顯示「續查屬內檢索表」藍底按鈕**, 即使 Quercus 屬 subkey (id=6, dichotomous, 30 sp) 確實存在。

**重現步驟**:
1. 進入 Fagaceae 殼斗科 key (id=3)
2. couplet 1 選 1B (子葉不出土) → couplet 2
3. couplet 2 選 2A (雄蕊 3-6) → 應到達 Quercus 屬 terminal
4. **預期**: 看到「Quercus 櫟屬」物種卡 + 藍底「續查屬內檢索表 Quercus 櫟屬 (30)」按鈕
5. **實際**: 沒有藍底按鈕

**已驗證資料正確 (mobile bundle DB)**:
- `t0024667` accepted row: `simple_name=Quercus, rank=Genus, family=Fagaceae` ✓
- `identification_keys` 有 `(id=6, scope_rank=genus, scope_name=Quercus, mode=dichotomous)` ✓
- SQL 模擬 `findSubkeysByScopeName('Quercus','genus')` 直接 query 確實回傳 id=6 row, child_count=30 ✓
- `RANK_TO_SCOPE['Genus']='genus'` 對應正確 ✓
- 同樣 case Castanopsis (t0023404, key id=4) / Lithocarpus (t0024178, key id=5) 結構相同

**已驗證 mobile code logic (`mobile/app/app/key/[id].tsx`, `src/db/keys.ts`)**:
- `findSubkeysForTaxon(taxonId)` 內部呼叫 `findSubkeysByScopeName(simple_name, scope)` plural variant 回傳 `IdentificationKey[]`
- key runner pre-cache `useEffect` 對每個 lead target tid 跑 `findSubkeysForTaxon(tid)` + fallback `findSubkeysByScopeName(tid)`, 然後 `sCache.set(tid, subs.filter(s => s.id !== keyId))`
- `TerminalTaxon` component (line 826) 接收 `subkeys: IdentificationKey[]`, 在 taxon-not-null 分支 line 948 用 `{subkeys.map(...)} → SubkeyButton`
- `npx tsc --noEmit` 無錯

**已嘗試的修法 (none 確定有效)**: 無
**Working theory**: 環境問題, 非 code bug
1. Mobile bundle DB 沒被 re-copy: `ensureTaicolDb` 用 `asset.hash` 偵測, **冷啟動才會觸發**; Metro hot-reload (`r`) 只 reload JS, 不 re-copy native asset
2. Metro 沒重 build JS bundle (cached); 需要 `npx expo start --clear`

但 **session context 滿了, 我除錯能力下降**, 不能 100% 排除是 code/data bug 我漏看。下次 session 從清新 context 重看。

**Next session 接手 checklist**:
1. 先請 user 冷啟動 app + Metro `--clear` 看是否解決
2. 若仍壞: 加 debug log 到 `key/[id].tsx` pre-cache + TerminalTaxon, 看 subs.length 實際是多少
3. 也要確認 user 用的是 dev client 還是已 build 的 app — EAS dev client 可能用 cached 不會 pick up 新 code
4. 若 subs.length 在 runtime 真的是 0, 對比 SQL simulation 結果, 找出 mobile runtime vs sqlite3 CLI 差異
5. 不要被 DB 顯示正確誤導 — bug 可能在 op-sqlite query 結果處理 (e.g. row 為 array 而非 object?)

**相關背景**:
- 本 session 跑了 TaiCOL 20260424 import + Stage 2b sibling backfill + Stage 2c override config + Stage 5 stale tid auto-remap (詳見 Plan.md 10.95)
- 用 git 確認 [id].tsx / keys.ts **沒有未 commit 的改動** (d9b773b 之後沒新 commit)
- mobile DB `make mobile-db` synced 過 (cname_fuzzy_index 62997)
- backup: `backend/twnamelist.db.preimport-20260424` 可 rollback

---

本檔記錄檢索表 (IK) 系統的：
- **PDF 結構問題** (印刷遺漏、不可達 subkey)
- **未解析 leads** (PDF 名稱在 TaiCOL 不存在)
- **Master key dead-ends** (無 subkey 也未 inline)
- **覆蓋率 gap** (TaiCOL > PDF)
- **待補分類群** (尚未進 keys 的 order/family)
- **Mobile UI 整合 TODO**
- **Pipeline 維護建議**

關聯 SOP：`project-ik-workflow-full` (memory)、`feedback-ik-sheet-conventions`、`project-mobile-bundle-db`。
詳細逐家族缺口紀錄：`references/Identification_key_misc.md`。

---

## 狀態總覽 (截至 2026-05-16)

| 指標 | 數值 |
|---|---|
| Backend `identification_keys` 總數 | **894** |
| Backend `key_couplets` 總數 | **5076** |
| Mobile bundle DB `cname_fuzzy_index` | 62809 |
| 完整 order 完工 | ~31 個 (含 Poales + **Polypodiales** 整目) |
| 部分 order | Caryophyllales 7/12 families |
| Class 完工 | Pinopsida, Lycopodiopsida |
| Class 部分 | Polypodiopsida (約 35 科 168 屬 892 sp 待補) |

---

## 1. PDF 結構問題 (印刷遺漏 / 設計缺陷)

### 1.1 Fimbristylis 飄拂草屬 orphan couplets 9-31

- **檔案**: Poales sheet 1LvL1vBj... `Fimbristylis` worksheet
- **問題**: PDF couplet 1B → 5 (依 PDF p.379 確認)，但 couplet 9 (葉具葉身 / 葉不具葉身) 起的 23 couplets / ~22 species 在 PDF 內**完全沒有 incoming arrow**
- **影響**: 從 family key 走入 Fimbristylis subkey 後沿 1A/1B→5 路徑只能到 couplet 5-8 終端 (squarrosa, ovata, sericea, cymosa, spathacea)；要到 9-31 需從 mobile UI 列表頁直接跳入特定 couplet
- **處置**: 保留 PDF 原樣 import，未來如取得勘誤可由 Sheet 補 1B → ?? 連結
- **疑似原意**: 可能 1B 應 → 9 (round-stem 主分支)，5-8 由其他位置 (如 8B → 5) 進入；無權威來源不擅自修

### 1.2 Orchidaceae 不可達 subkey (TaiCOL 屬合併造成)

詳見 `references/Identification_key_misc.md` Orchidaceae section。

| Worksheet | 實際 TaiCOL genus 欄 | 漏的 sp |
|---|---|---|
| Phaius | Calanthe | mishmensis, tankervilleae |
| Paraphaius | Calanthe | woodfordii, takeoi |
| Cephalantheropsis | Calanthe | kooshunensis, obcordata, dolichopoda, longipes |

- **影響**: Mobile `findSubkeyForTaxon` 透過 `taicol_names.genus` 欄查 → 三個 worksheet 不可達；click 進去會跳到 Calanthe subkey (不含這 8 sp)
- **可能解決**: Mobile 改成支援 scope_name 直接查 (而非 taxon_id → genus 欄)，原本不可達 worksheet 會自動恢復

---

## 2. 未解析 leads (PDF 名稱不在 TaiCOL)

保留 PDF 字串作為 lead 文字，`target_id` 存原始 sciname。Mobile UI 顯示 lead 但無 taxon 連結。

### Orchidaceae
- `Cheirostylis tortilacinia var. wutaiensis 擬紅衣指柱蘭` (Cheirostylis #10B)
- `Oberonia formosana fo. viridiflora 綠花台灣莪白蘭` (Oberonia #8B)
- `Odontochilus brevistylus subsp. candidus 白齒唇蘭` (Odontochilus #7A)
- `Styloglossum clavata 樺葉根節蘭` (Styloglossum #3B)
- `Polygonatum arisanense var. formosanum 大屯黃精` (Asparagaceae)

### Malpighiales
- `Glochidion lanyuense 蘭嶼饅頭果` (Phyllanthaceae Glochidion #5A)

### Fabales
- `Desmanthus pernambucanus 合歡草` (Fabaceae Desmanthus #2B)

### Poales / Poaceae
- 0 unresolved (S4d 已全部對齊 TaiCOL accepted)

### Polypodiales / Polypodiaceae
- `Phymatosorus 瘤蕨屬` (Polypodiaceae family #22A, S7a)：TaiCOL 屬層 taxon_id NULL，物種全 not-accepted/misapplied 解到 Microsorum 或 Selliguea。S7b 仍會建 Phymatosorus subkey 保留 PDF 流程；import 時 warn-only 不擋。

### Polypodiales / Thelypteridaceae
- `Parathelypteris 副金星蕨屬` (Thelypteridaceae family #16A, S9)：TaiCOL 屬層 not-accepted (4 sp 全屬移到 Amauropelta/Coryphopteris)。Subkey worksheet 保留 PDF 屬名以維 navigate 流程；species lead 內部寫 TaiCOL accepted Amauropelta/Coryphopteris 全名。Import warn-only。
- **Adiantum #13A 印刷遺漏** (Pteridaceae S8b)：PDF couplet 13A "羽片兩面被黑褐色硬質剛毛" target 欄為空 (PDF 印刷誤)。Sheet 填入 **Adiantum diaphanum 長尾鐵線蕨** (feature 描述吻合 + TaiCOL 此 sp 確存 + 為 Adiantum 屬唯一 PDF 未列入的 sp，推測為原 PDF 應收。建議向作者確認)。

### Athyriaceae (S4 既有)
- `Diplazium proliferum 多生菜蕨` (Athyriaceae #2B)：TaiCOL 此 species cn/taxon_id 皆 null，accepted 為 misapplied 狀態。保留 PDF 字串。

---

## 2.5 TaiCOL 拼字差異需 fallback (Microsorium / Microsorum)

- **Polypodiaceae Microsorium 星蕨屬** (S7a)：PDF 用 `Microsorium` (兩個 i)，TaiCOL accepted 為 `Microsorum` (單 i)。所有 species 在 TaiCOL 同時存在兩種拼字，`Microsorium` 全為 `not-accepted` 重複入口。`key_sheet_import._resolve_taxa` 透過 non-accepted fallback 把 species lead 解到正確 taxon_id (t0026845/846/848)，subkey worksheet 沿用 PDF 名稱維持 navigate 一致。**Mobile UI** 顯示時應走 accepted name redirect (TaiCOL taxon page 自動 redirect)。

---

## 3. Master key dead-ends (無 subkey 也未 inline)

PDF family key 列出 genus terminal 但無對應 subkey，且該 genus 有多 sp 在 Taiwan。

| Family | Genus | TaiCOL sp 數 | 備註 |
|---|---|---|---|
| Orchidaceae | Papilionanthe 台灣萬代蘭屬 | 4 | PDF 無 subkey；master terminal 直接跳 genus |
| Onagraceae | Oenothera 待肯草屬 | 8 | TaiCOL 8 sp accepted；PDF 未建 subkey |

未來如取得補充資料 (期刊文章、TaiCOL 後續更新) 可建 subkey。

---

## 4. 覆蓋率 gap (TaiCOL granularity > PDF)

### 4.1 Poaceae 禾本科 (Poales)
- **TaiCOL in-Taiwan 物種**: 439 sp/var.
- **Keys 覆蓋**: 365 (83%)
- **缺 74 種類型**:
  - 竹類栽培品系 (如 `Bambusa dolichoclada 'Stripe'` 條紋長枝竹)
  - TaiCOL 拆種 (如 `Bromus remotiflorus var. piananensis` 卑南雀麥)
  - species-vs-autonym 重複引用 (PDF 寫 `var. infirma`，TaiCOL 同時保留 species `Agrostis infirma`)
  - 新歸化種 (PDF 出版後新增，如 `Bromus secalinus` 歐雀麥)

→ **非 dead-end，無需補；TaiCOL granularity > PDF**

### 4.2 Orchidaceae 蘭科 (Asparagales)
Master key 漏 sp 的 genus (PDF 用 1 sp inline 但 TaiCOL ≥ 2 sp)：

| Genus | Master inline 用 | TaiCOL sp 數 |
|---|---|---|
| Acampe | Aerides rigida | 2 |
| Bletilla | Bletia formosana | 2 |
| Cephalanthera | Cephalanthera alpicola | 2 |
| Chrysoglossum | Chrysoglossum ornatum | 2 |
| Hemipilia | Hemipilia cordifolia | 2 |
| Malaxis | Ophrys monophyllos | 2 |
| Saccolabiopsis | Saccolabiopsis taiwaniana | 2 |
| Vanilla | Vanilla somae | 2 |

### 4.3 Myrtales / Trapa degenerate
PDF 5 sp 用果型/角度特徵區分，TaiCOL 合併到 3 個 taxon。Trapa worksheet couplet 2A/4A/4B 在 mobile UI 都顯示 `Trapa natans var. bispinosa 菱` (同一 taxon)。Lead 文字保留 PDF 區分但 drilldown 終點相同。

### 4.4 Cross-couplet duplicate terminals
PDF 不同特徵走到同一 TaiCOL taxon (PDF 區分 / TaiCOL 合併)：

| Worksheet | Couplets | TaiCOL taxon |
|---|---|---|
| Goodyera | 12A, 13B | schlechtendaliana 斑葉蘭 |
| Goodyera | 3A, 18A | procera 穗花斑葉蘭 |
| Nervilia | 6A, 12A | taitoensis 單花脈葉蘭 |

不影響功能，UI 兩條路徑跳到同種。

---

## 5. 待補分類群 (尚未進 keys)

依 1m8C master index sheet `1m8CWHxQF_8IkDEQLxS7JRVDJHm1eyU5XMOrvVq_Dvc0`：

### 5.1 Polypodiopsida 水龍骨綱 (大部完工)
- **Polypodiales 整目完工** (72 keys / 661 couplets，9 segments S1-S9)
- **小型 orders 完工**: Cyatheales / Equisetales / Gleicheniales / Hymenophyllales / Marattiales / Ophioglossales / Osmundales / Polypodiales / Psilotales / Salviniales / Schizaeales (全部以《野外鑑定指南》PDF 為準)
- 殘留 gap 見下方 **5.1.1 Polypodiales 屬層 dead-end 三類分**

### 5.1.1 Polypodiales 屬層 dead-end 分類 (TaiCOL 對齊 audit 2026-05-16)

跑 `taicol_names.order='Polypodiales' AND rank='Species' AND usage_status='accepted' AND is_in_taiwan LIKE '%true%'` 比對既有 IK keys 覆蓋，發現以下三類 gap。**全部非 PDF 漏列，但 TaiCOL/mobile UI 需處理**。

#### Type A — TaiCOL 屬移後 lag (species 已 import 但 worksheet 名仍是 PDF 舊屬名)

PDF 收的 sciname 在 TaiCOL 已 not-accepted (屬被拆分/合併)，sheet 中已寫成 TaiCOL accepted 全名 (mixed-genus rule)，但 mobile `findSubkeyForTaxon(genus_name)` 用 TaiCOL 新屬名查不到 subkey (subkey worksheet 仍掛在 PDF 舊屬名下)。

| TaiCOL 新屬 (sp 數) | 落腳於哪個 subkey worksheet | 原 PDF 屬名 |
|---|---|---|
| Amauropelta (3) | Parathelypteris | Parathelypteris |
| Coryphopteris (3) | Parathelypteris (1 sp) + family 16B inline (1 sp Coryphopteris japonica) | Parathelypteris |
| Grypothrix (2) | Pronephrium (含 G. ramosii) | Pronephrium |
| Chrinephrium (隱 1+) | Pronephrium (含 C. insulare) | Pronephrium |
| Leptogramma (2) | Stegnogramma (含 L. tottoides + L. mollissima) | Stegnogramma |
| Thelypteris (3) | Cyclogramma (含 T. omeiensis) | Cyclogramma |
| Neolepisorus (3) | Neocheiropteris (含 N. ensatus + N. fortunei) | Neocheiropteris |
| Microsorum (5) | Microsorium (3 sp covered) — TaiCOL 多 2 sp 為後續新增 (Type B 重疊) | Microsorium |
| Cyclosorus (2) | Thelypteridaceae family 4B inline (cover C. interruptus 1 sp) — TaiCOL 多 1 sp | (family inline) |

**修法 (Mobile UI 端)**: `findSubkeyForTaxon` 改 fallback 邏輯 — 若用 TaiCOL accepted genus 找不到 worksheet, 用 taxon 的 not-accepted alt sciname 第一個 token 試 (即 PDF 舊屬名)。或讓 sheet meta 明確標 alias genus list。

#### Type B — TaiCOL granularity > PDF (PDF 未列入的 sp)

PDF《野外鑑定指南》出版 (2022) 後 TaiCOL 新增/拆出/重新接受的 sp，PDF 沒寫。**非錯誤，是覆蓋 gap**。

| 屬 | 多出 sp 數 | 備註 |
|---|---|---|
| Polypodium | 3 | PDF 完全未提此屬 (檢 PDF p.49-57 確認) |
| Tomophyllum | 1 | PDF cover subfalcatum 1 sp inline，TaiCOL 多 1 |
| Microsorum | 2 | PDF cover 3 sp，TaiCOL 多 2 (與 Type A 重疊) |
| Neolepisorus | 1 | PDF cover 2 sp (透過 Neocheiropteris)，TaiCOL 多 1 |
| Leptogramma | 0 | (補 audit) |

**處置**: 等取得補充資料 (期刊文章/TaiCOL 後續修訂版/作者勘誤) 再補。Mobile UI 不會顯示這些 sp 為 dead-end，但分類樹瀏覽會看到沒對應 key。

#### Type C — PDF 真實缺口 (≥2 sp 但 PDF 完全無 subkey)

PDF 自身就沒寫 subkey 的屬。需另尋資料來源補。

| 科 | 屬 (sp 數) | 備註 |
|---|---|---|
| Blechnaceae | Woodwardia (5) | 烏毛蕨屬，PDF family key 未深入 |
| Cystopteridaceae | Acystopteris (2), Cystopteris (3), Gymnocarpium (3) | 全科 8 sp，PDF family key 5c 只 cover 一部分 |
| Davalliaceae | Davallia (9) | PDF family key 8c 即等同 Davallia 內鍵 (單屬科)，**worksheet 命名為 Davalliaceae 而非 Davallia**，mobile `findSubkeyForTaxon('Davallia')` 找不到。**Type C 與 mobile UI 命名問題重疊** |
| Dennstaedtiaceae | Paesia (2) | 鱗蓋蕨屬 |
| Dryopteridaceae | Ctenitis (2), Ctenitopsis (2) | PDF S6a 將 Ctenitis 屬列為 inline (假設 1 sp)，TaiCOL 各 2 sp |
| Hypodematiaceae | Hypodematium (3), Leucostegia (2) | PDF family key 2c 只 cover 一部分 |
| Lomariopsidaceae | Lomariopsis (2) | PDF family key 1c 只 cover 一部分 |
| Nephrolepidaceae | Nephrolepis (7) | PDF family key 5c 即等同 Nephrolepis 內鍵 (單屬科)，**同 Davallia 命名問題** |
| Woodsiaceae | Woodsia (4) | PDF family key 2c 只 cover 2 sp |

**短期處置**:
1. **Davalliaceae + Nephrolepidaceae 修法**: 為 mobile UI 加 alias 機制 (worksheet meta 寫 `alt_scope_names: ["Davallia"]`)，或在 sheet 額外建 Davallia/Nephrolepis worksheet 直接複製 family key 內容 (兩份冗餘但 navigate OK)。
2. **其他真實 dead-end**: 留待補充資料。記入 master 進度。

#### 影響範圍評估 (Polypodiales 整目)

- TaiCOL Polypodiales in-Taiwan accepted sp: **701**
- IK keys cover: ~600 sp (PDF list 約 700+ sp)
- 真實 dead-end 估計 < 30 sp (Type C 真實 + Type B 後續新增)

**結論**: Polypodiales 整目以 PDF 為 source 已**完整完工**，剩餘 gap 須等補充資料 / mobile UI fallback 機制。

### 5.2 Caryophyllales 石竹目 (進行中 7/12)
**未完家族** (估計 couplets):
- Aizoaceae 番杏科 (18/31 sp)
- Amaranthaceae 莧科 (21/55 sp)
- Cactaceae 仙人掌科 (70/168 sp, 栽培外來多)
- Caryophyllaceae 石竹科 (19/74 sp)
- Polygonaceae 蓼科 (10/65 sp)

### 5.3 其他 order (約 25 個)
1m8C master index 中 done=FALSE 的 order rows，使用者前期 append 未配 URL。需先建 spreadsheet template 再 parse。

### 5.4 已知小缺口
- Sabiaceae 清風藤科 (Proteales 一部分，PDF p.328 待補)
- Pandanaceae Pandanus 屬內 sub-key (Pandanales)

---

## 6. Mobile UI 整合 TODO

### 6.1 Contextual entry points (Step 6)
- [ ] **物種詳細頁 → 檢索表 deeplink**: `SpeciesDetailSheet` / 名錄 long-press 看詳細 / 樣區物種卡內，若該物種所屬 genus (或 family) 有對應 `identification_keys`，加「對照同屬檢索表」按鈕
  - 實作: 復用 `findSubkeyForTaxon(taxon_id)` helper (已存在於 `src/db/keys.ts`)
  - 匹配到非 null 時顯示按鈕 → `router.push('/key/{id}')`
- [ ] **樣區/名錄記錄編輯 → 「不確定？開檢索表」**: 傳入當前 genus

### 6.2 findSubkeyForTaxon 改進 ✅ (2026-05-16 done, Plan.md 10.93)
- [x] **TaiCOL 屬移 fallback** — `findSubkeyForTaxon` 加同 tid not-accepted alt sciname 第一個 token 重試。涵蓋 Amauropelta/Coryphopteris/Grypothrix/Chrinephrium/Leptogramma/Thelypteris(omeiensis)/Neolepisorus 等 §5.1.1 Type A 全部
- [x] **單屬科 alias** — `identification_keys.aliases` 欄位 + `findSubkeyByScopeName` `EXISTS(json_each(aliases) WHERE value=?)` 查詢。Seeded Davalliaceae=Davallia / Nephrolepidaceae=Nephrolepis / Dioscoreaceae=Dioscorea / Aspleniaceae=Asplenium / Woodsiaceae=Woodsia / Selaginellaceae=Selaginella / Bambusoideae=竹亞科
- [x] **Lead-text fallback** — `findSubkeyFromLeadText` 解 lead 第一個 Latin token + Key runner 預 cache 修補處理 `target_id` 為 raw sciname fallback 的 case (e.g. Poaceae key 內 lead `Bambusoideae 竹亞科` 自動跳 Bambusoideae subkey)
- [x] **Parser `_detect_scope_from_name`** 認 ICN 後綴 (`*oideae`→subfamily / `*eae`→tribe)，未來 import 自動分類
- [x] **Bambusoideae scope_rank** 既有 entry 修正從 genus→subfamily
- [ ] 改成支援 scope_name 直接查 (而非 taxon_id → taicol_names.genus 欄) — 已透過 (1) findSubkeyByScopeName 部分覆蓋；原本 Phaius/Paraphaius/Cephalantheropsis (Calanthe 屬合併) 可否恢復需驗證

### 6.3 檢索表更新提示 (Step 5)
- [ ] 進入「檢索表」segment 時背景拉 index 比對 last_sync
- [ ] Settings 加「重新下載所有檢索表」+ 容量顯示

---

## 7. Pipeline / 維護 TODO

### 7.1 工具紀律 (per memory `project-ik-import-pipeline`)
**永久工具** (只能用這些):
- `backend/services/key_pdf_import.py` — PDF bbox 抽 couplet
- `backend/services/key_sheet_import.py` — Sheets → backend DB，內建 dry-run + dedupe
- `backend/scripts/build_mobile_fuzzy_index.py` — 透過 `make mobile-db` 觸發

**禁止**:
- 把 PDF 內容轉錄硬編成永久 `.py` module (資料應留在 Sheets)
- inline 包裝既有 `key_sheet_import.py`

### 7.2 已知 Sheets API 限制
- 60 read / min per user
- Import 65+ worksheets 時中間需要 sleep 65s 避免 quota；目前是 ad-hoc retry，未來如固定要 ≥50 worksheets 可在 `parse_spreadsheet` 加 throttle

### 7.3 Bundle DB 更新 SOP
每次 backend DB 變動後**必須**跑 `make mobile-db`，否則 mobile 端的 `idx_taicol_genus` / `cname_fuzzy_index` 落後，KeyListView 慢且中文搜尋會 crash Hermes (per memory `project-mobile-bundle-db`)。

### 7.4 TaiCOL 重 import 後 audit
`taicol_import.py` 末段自動跑 `_check_stale_key_taxon_ids()` 列出引用到不存在 taxon_id 的 keys。每個被列出的 key 都要:
1. 修 sheet 內的 sciname → 對齊新版 TaiCOL accepted name
2. 重 import

手動跑:
```bash
backend/venv/bin/python -c "
from backend.services.taicol_import import _check_stale_key_taxon_ids
import json; print(json.dumps(_check_stale_key_taxon_ids(), indent=2, ensure_ascii=False))"
```

### 7.5 定期 cname audit
- 建議季度跑一次
- 對所有 IK keys 抽樣或全跑 cname vs TaiCOL `common_name_c` 比對
- 發現字形/拼字錯誤就 inline gspread 修 sheet → 重 import

### 7.6 PDF OCR (未來新資料源)
- [ ] PDF OCR 解析二分法檢索表 (post-2025 修訂版若出現)
- 既有 `key_pdf_import.py` (pdfplumber bbox) 對結構乾淨的 PDF 可用；本書 (野外鑑定指南) OCR 噪訊太大不適用，已採用 Read tool 人工讀 + inline gspread 填入

---

## 8. PDF→TaiCOL 對應修正表

詳見 memory `project-taiwan-vascular-keys-progress.md` 內的「TaiCOL 拼字 / 名稱對應錯誤紀錄」section (~80 entries 跨 Orchidaceae / Asparagaceae / Cyperaceae / Poaceae 等)。

**重要 categories**:
- TaiCOL 字異 (蒭/芻、稈/桿、邏/羅、班/斑) — 採 TaiCOL 主名
- PDF typo (lithophlia→lithophila, brachyathera→brachyanthera, banksia→banksii) — 採 TaiCOL 拼字
- TaiCOL 屬合併 (Cephalantheropsis→Calanthe, Phaius→Calanthe, Leptatherum→Microstegium 部分)
- TaiCOL not-accepted sciname 改寫 (Rottboellia exaltata→cochinchinensis, Themeda barbata→japonica, Saccharum sinense→sinensis, Bambusa edulis→Bambusa odashimae, Elymus shandongensis→Agropyron mayebaranum, Isachne pulchella→dispar, Isachne clarkei→beneckei)
- Var. autonym 不存在 (PDF `var. xxx`，TaiCOL 只到 species 級) — 改 species 形式
- f./fo. 形式差異 (Arrhenatherum elatius f.→fo.)

---

## 9. 維護紀錄頻率

| 項目 | 頻率 | 觸發條件 |
|---|---|---|
| 1m8C master index 更新 | 每完成 1 order/family | Stage 7 mark done=TRUE |
| Plan.md 10.XX row | 每完成 1 段 | Stage 8 |
| memory `project-taiwan-vascular-keys-progress` | 每完成 1 段 | Stage 8 |
| `make mobile-db` | 每完 import | Stage 6 |
| Dead-end SQL 檢查 | 每完 import | Stage 8 |
| Cname audit | 季度 | M3 (memory M3) |
| TaiCOL stale check | TaiCOL 重 import 後 | M2 |
| 本檔 (Ident_keys.md) 更新 | 每發現新 caveat / 完成新 order | 隨時 |
