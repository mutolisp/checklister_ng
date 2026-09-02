# 更新紀錄

## 2026-09-02：Mobile — 採用名選單顯示 `{{typed}}` 字面；check:i18n 補兩個洞

> mobile app（`mobile/app/`）。

昨天上線的採用名選單，第三個選項渲染成 `用「{{typed}}」，並認定它就是「Digitaria heterantha」`。misapplied 版本的字串寫 `{{typed}}`，呼叫端傳的卻是 `{ name, accepted }`（非 misapplied 版本用 `{{name}}` 所以正常，選單說明文字用 `{{typed}}` 且確實有傳，也正常）。i18next 遇到沒有對應參數的 placeholder 就原樣輸出，不報錯也不走 fallback。字串改成 `{{name}}`，與同組其他四個選項一致。

### check:i18n 看不到這種錯，已擴充

它原本只驗「key 在兩份 locale 都存在」——而這個 bug 兩份都有 key、值也是合法字串，完全隱形。新增一個 pass **比對每個 `t()` 呼叫傳的參數與字串裡的 placeholder**，把 bug 放回去會直接指名 `src/lib/adoptName.ts:83` 與缺的那個 `{{typed}}`。只在「字串要的參數沒傳」時失敗；多傳不用的參數不報（好幾處呼叫端本來就一個物件餵兩個相鄰 key），`{...opts}` 這種無法靜態判斷的則列進 advisory 而非誤判。

擴充時發現**第二個洞**：原本兩條 line-based regex 都不匹配 `t(cond ? 'a.b' : 'c.d')`——第一個引數不是引號開頭，KEY_RE 不中；後面接 `?` 而不是 `,` 或 `)`，DYNAMIC_RE 也不中。也就是說前一天新增的那組三元鍵**從頭到尾沒被驗證過存不存在**，只是剛好兩個都有寫進 locale。新的 pass 改用括號配對取出整串引數（會跳過字串與樣板字面內的括號），三元的兩個 key 都會檢查。全庫掃完沒有其他遺漏，990 個 key 全數到齊。

---

## 2026-09-01：Mobile — 使用者可採用自己的分類見解（synonym / misapplied）

> mobile app（`mobile/app/`）。

TaiCOL 說某個名字是 synonym 或 misapplied，不代表使用者同意——分類見解本來就會分歧。以前 app 默默替他決定了：搜尋異名直接解析到接受名，記錄只存接受名的 `taxon_id`，使用者輸入的名字在搜尋列閃過一行就消失，匯出也看不出這筆鑑定原本用的是哪個名字。

### 關鍵事實

實測 bundle DB：269,824 列、**269,824 個相異 `name_id`**、96,677 個相異 `taxon_id`——`taxon_id` 是分類概念、`name_id` 是名字，**27.7% 的分類群有異名**。所以採用一個本地異名根本不需要 GBIF，那個名字在本地就有 id；而 `name_id` 是 `INTEGER PRIMARY KEY`（rowid），查它是最快的查法，不必加索引也不必重建 bundle DB。

### 做法（migration v28）

三張記錄表加 `used_name_id` + `used_scientific_name`（皆可 NULL＝沿用接受名，既有資料零回填），`taxon_id` 不變所以統計與匯出分群不分裂。搜尋結果的 `≡ 你輸入：X` 那行變成可點，開選單：用接受名／用 X 但仍歸同一分類群／用 X 作為獨立分類群（查 GBIF 取完整階層）／改歸到本地另一個分類群（misapplied 跨兩個概念的 451 列）。

**存兩欄而不是一欄**：拿兩個真實 TaiCOL 版本逐列比對後知道，242,282 個共同 name_id 裡有 13 個改了學名、3 個消失、277 個換了 taxon_id、283 個換了 usage_status。id 穩定但不完美，字串是自我描述的。**狀態刻意不存**——TaiCOL 會改變主意，使用者的選擇才是要持久化的東西。

匯出新增四個此前全 repo 沒用過的 DwC term：`scientificNameID`、`taxonomicStatus`、`acceptedNameUsage`、`acceptedNameUsageID`（用 taxon_id，DwC 要求與 `taxonID` 同一識別碼空間），並同步到 `backend/utils/mapper.py`。沒有採用名的記錄一個欄位都不會多。

### 一併修掉的既有缺陷

- **`sciMatch` 的 `usage_status LIKE '%accepted%'` 會命中 `'not-accepted'`**（子字串）——批次匯入與學名比對一直可能把異名當接受名用。
- **`externalToSearchResult` 寫死 `usage_status: 'accepted'`**，每筆外部物種都自稱接受名。
- **GBIF 查名連做兩次靜默的名稱替換**（GBIF 異名→接受名→本地分類群）並跳過確認畫面，`sciMatch` 算出的「本地把它視為什麼」當場丟掉。現在會把「你選的」與「本地有的」並排顯示再讓使用者決定。
- **markdown 以 taxon_id 去重**會把同一分類群下的兩個採用名折成一列。
- 三條會靜默吞掉採用名的路徑（匯入、複製記錄、批次匯入）都補上了。

### check:roundtrip 原本抓不到這類遺漏

它的欄位涵蓋斷言**從來沒跑過記錄層**——加一個記錄欄位卻忘了改匯出照樣綠燈。已補上，並把 `resolveTaxa` join 上來的衍生欄位排除，否則雜訊會淹掉真訊號。

另外資料檢查新增一項：TaiCOL 改版後採用名與現行名錄對不上的筆數（半年內有 527 個非接受名換了所屬概念）——**只報不改**，記錄仍顯示使用者當初選的名字。

---

## 2026-08-31：Mobile — 記錄匯入還原、複製記錄、GBIF 查名

> 以下皆為 mobile app（`mobile/app/`）。詳細的架構決策與待辦見 `mobile/Plan.md`。

### 名錄／樣區 yml 完整還原匯入

- **名錄（session）原本完全沒有匯入路徑**：唯一會讀 session yml 的 `BatchImportModal` 只抽 taxonID 加物種到既有名錄，`event:` 區塊、時間、調查者、豐度、GPS、屬性、備註全部丟掉。新增 `importSession` + `sessionImport.ts`，`sessions` 與 `checklist_records` 全欄位還原。
- **樣區匯入補齊**：site 綁定、照片、`env_photos_json`、`track_finalized`；`project` 查無即建立（原本靜默落到未分類）。
- **yml schema 兩邊一起長**：樣區加 `site:`／`env_photo_files`／`track_finalized`／`species[].photo_files`；名錄 `event:` 加 `eventUUID`／`eventType`／`eventRemarks`／`decimalLatitude,Longitude`／`gpsMode`／`trackGeoJSON`，checklist 加 `associatedMedia`。
- **yml 為權威來源**，zip 內的 `track.*` / `site.*`（gpx/kml/geojson）只在 yml 缺該幾何時作為 fallback。
- **照片還原到 Photos.app**（與拍照同一條 `createAssetAsync` 路徑）。覆蓋既有記錄且該記錄已有照片時詢問「沿用既有／重新匯入」——Photos.app 的資產無法被覆寫，這是能誠實提供的選項。
- 修掉**照片檔名撞名互相覆蓋**：`{taxonID}_{label}_{n}` 的序號原本是單筆記錄內索引，同一次匯出中同物種兩列會產生同名 entry 而被靜默覆蓋（匯出當下就在掉照片）。
- 修掉**覆蓋匯入的資料遺失**：原本先刪舊記錄再逐列 insert，中途遇到 legacy `E0`（違反 CHECK）就炸，舊的沒了、新的半套。改為 `withTransaction`（op-sqlite 的 `db.transaction()` 是 async，包不了 `executeSync`，故用顯式 BEGIN/COMMIT）＋ layer 值 clamp。
- 多筆打包 zip 原本會靜默匯入其中一筆 → 明確拒絕；第一次有功能從 zip 寫檔，加上 zip-slip 防護。
- **schema v27**：`sessions.uuid`（加欄 → 回填 → unique index，三步皆可重跑），讓名錄有 round-trip 的 upsert key。

### 批次匯入選 .zip 會失敗

「從檔案讀入」用純文字讀檔，拿到 zip 直接丟出 iOS 原文 `the text encoding of its contents can't be determined`。改為 `readRecordYamlText()`（`.yml` 直接讀、`.zip` 解出裡面的 record yml），錯誤訊息統一走 `importErrorMessage()`。

### 記錄列表：複製記錄、存進常用名錄

- 滑動列新增**複製**（複製／匯出／刪除）。可選是否帶入環境（調查設定＋環境數值）與物種（只帶清單與分層／小區位置），可自訂新名稱，並可選「複製後直接開始調查」。
- **名稱自動遞增**：`JP-EH-12` → `JP-EH-13`，補零保留（`PLOT_009` → `PLOT_010`），沒有數字就加日期，並跳過已存在的名稱。重名採警告不擋——固定樣區隔年複查本來就沿用同一個 plotid。
- 多選模式新增**存進常用名錄**（可一次多筆），沿用既有的 `importFromRecord`。
- **採集不複製標本**：採集號取自全域生涯序號且由已存在的列推導、刪不回來，預先配發等於憑空燒掉真實編號。

### 常用名錄畫完範圍後跳到別的畫面

`router.back()` 的假設不成立——`/favorites` 疊在 `(tabs)` 上面，進地圖後 favorites 已不在後方。改為顯式 `router.navigate('/favorites?folder=N')`，並讓常用名錄頁接收 `folder` param 回到原本那份名錄。

### 本地查無物種 → GBIF 查名，可加入本機名錄

- 搜尋框查無結果時顯示「到 GBIF 查詢」按鈕（**點才查**，野外沒訊號不白等，也不會每個按鍵打一次 API）。候選列顯示學名／作者／rank／階層／GBIF 俗名／異名標記。
- 選定後**先用 GBIF 給的接受名回頭比對本地名錄**，命中就回本地 id——臺灣的物種不可以拿到 GBIF id，否則同種兩個身分。本地真的沒有才鑄造 `g{usageKey}` 外部物種，中文俗名預填 GBIF 的 vernacularName（中文優先），沒有就讓使用者自行輸入。
- 批次匯入的「找不到」清單每列可點，走同一個視窗。
- **前置修正**：`searchByTaxonId` 原本不認得 `g…`（會被送去查 TaiCOL 表然後回 null），導致常用名錄裡的外部物種點不開、加不進記錄、被 `importFromRecord` 當 unresolved 丟棄——一次解掉七個既有壞點。`external_taxa` 原本也不在搜尋路徑上（在 user.db，名錄在 twnamelist.db，全 app 沒有 ATTACH），加入後再搜同一個名字仍查無結果。
- 一併修掉：`findExternalTaxonIdByName` 只比名字不看界（bundle DB 有 72 個屬名跨界同名，會讓兩個不同生物 collapse 成同一個 `taxon_id`）；`upsertExternalTaxon` 更新 `source` 卻不更新 `source_key`（會讓列宣稱自己是某個無關的 GBIF taxon，而索引還把這個謊言建進去）。

### 新增的自動檢查

- `npm run check:roundtrip`：DB 形狀 fixture → yml → parser 逐欄比對，外加欄位涵蓋檢查（新增欄位卻忘了改匯出會失敗）。當場抓到 js-yaml 會把未加引號的 `startedAt` 解析成 `Date`。
- `npm run check:names`：命名遞增規則。當場抓到預設名錄名 `YYYY-MM-DD HH:MM` 會被「遞增」成 `14:60`。
- `npm run check:gbif`：GBIF 回應解析（俗名語言優先序、rank 過濾、異名接受名、畸形回應），不打真的 API。

---

## 2026-08-30：Mobile — 技術債清理、接 iNaturalist / GBIF、常用名錄管理、標本館標籤

### 技術債清理（以使用者真實 `user.db` 917 列／16 表驗證，逐表零變動）

- **`clearAllUserData()` 會讓 app 永久磚化**（最嚴重）：它只 DROP 16 張表中的 8 張，接著從 v1 重跑 migration，而 `ADD COLUMN` 沒有存在性檢查 → v6 拋 `duplicate column name` → `schema_version` 卡在 5、程式碼是 v22 → 下次開機被紅色「初始化失敗」畫面取代，**而該畫面沒有路徑走到備份還原**，只能重裝。改成刪檔重建（比照已驗證的 `restoreBackup`），30 處 `ADD COLUMN` 全部改走 `addColumnIfMissing()`。
- **刪除計畫會讓樣點與採集記錄「消失」**：`deleteProject` 漏了 4 張 FK 表中的 2 張，而那兩者的列表查詢是 INNER JOIN → 資料還在 DB 卻從清單消失。三處一起修（補齊 + 改 LEFT JOIN + 孤兒修復）。
- **開啟 `PRAGMA foreign_keys = ON`**：在此之前 schema 裡每一個 `ON DELETE CASCADE` 都是失效的。順序有講究：migration 期間 OFF（否則 v3 的 `ALTER TABLE sites RENAME` 會觸發 cascade 清掉所有 plot 的 `site_id`）、cleanup 期間 OFF（否則待修的懸空參照會拋錯而非被治好）、之後才 ON。
- **UUID 收斂到 SQLite CSPRNG**：兩份位元組相同的 `Math.random` 實作被用來產 DwC `occurrenceID`；Hermes 的 `Math.random()` 是非密碼學 PRNG 且 seeding 未定義。改用 `randomblob`，runtime 與 migration 終於一致。20,000 次抽樣零重複。
- **自動安全備份**：會改寫既有列的修復執行前自動 `VACUUM INTO` 留快照，並在備份頁補上還原入口——快照在 app 私有目錄，沒有入口等於備份存在卻無法還原。
- 新增 `npm run check:i18n`（833 key 與兩份 locale 對比）。lint error 1 → 0。

### 接 iNaturalist / GBIF：地圖範圍 → 物種名錄

App 的**第一個網路功能**（在此之前整棵 mobile 零 HTTP）。分四階段，前兩階段刻意不碰網路先拆架構風險。

- **身分規則三段式，優先序不可顛倒**：TaiCOL `t…` → 日本 `y…` → 都沒有才鑄外部 `g…`／`gi…`。同一物種永遠優先綁本地 id，否則同種兩個身分，記錄、匯出、統計全部分裂。
- migration **v23**（兩層常用名錄）、**v24**（`external_taxa`，放 user.db 而非 bundle DB——後者 hash 一變就整個重 copy）、**v25**（名錄記住來源範圍）。
- 實測比對率：陽明山 97%、墾丁 98%、Kinabalu 17%。
- **`/species/match` 的實際價值與規劃不同**：規劃假設它能把異名解析回本地名錄，實測 211 個未比對名稱**救回 0 個**（Phase 2 已先走過 TaiCOL 自己的異名列）；它真正的價值是取得識別碼，211/211 全取得。UI 文案據此改寫，不宣稱一件量出來是 0 的事。
- **連線偵測不加原生模組**：改用兩個服務互相 HEAD 探測，兩邊都不通才說離線。
- 踩過的坑：RN 的 `URLSearchParams` 沒有 copy constructor（bbox 被靜默丟掉變成全球查詢）；`LOWER(simple_name) = ?` 吃不到索引（67ms/名 → 改 `IN (?,?,?)` 後 0.09ms，**774 倍**）；GBIF 幾何 400（改成永遠退回外接矩形並明說）；GBIF **HTTP 429** 實測踩到（併發下修、加退避重試）。
- 新增 `npm run check:kav`：`KeyboardAvoidingView` 呼叫端沒給 sizing className 會解析成 0 高度，畫面變暗、吞掉所有觸控、沒有可按的取消。

### 常用名錄管理 + 標本館標籤（.docx）

- 常用名錄清單層加左滑刪除／多選刪除／匯出（docx / csv）。預設名錄不可刪——它是快速加入的落點。
- 匯出是**重用**而非另寫：從 `recordToMarkdownItem` 抽出「不含觀察資訊的那半邊」，走完全相同的 `generateMarkdown` → `markdownToDocx` 管線。
- **所有 docx 改成 A4**（原本吐空的 `sectPr`，等於繼承 Word 的 US Letter 預設）。驗證方式是把改動前後各自編出來餵同一份 Markdown，比對解壓後的 `document.xml`——`sectPr` 以外**每個位元都相同**。
- 標本館標籤：A4 2 欄 × 5 列共 10 張、虛線裁切線，**沒有引入新相依**（`docx.ts` 本來就是手寫的 OOXML writer）。migration **v26** 加 `identified_by`（DwC `identifiedBy`）；舊標本保持 NULL 不回填採集者——那等於替某人主張一個他沒做過的鑑定。
- **一頁只排到 4 列**（實機回報）：行高原本 `lineRule="auto"` 由字型決定，而那台機器沒有標楷體，替代字型的行高比例不同就把列撐開。修法不是再猜一個數字，而是讓行高不再取決於字型（每個字級各釘一個 `atLeast` 明確值）。
- 採集號**不能字串比較**（`DAO0010` 會排在 `DAO0009` 前面），改用既有的數字尾碼欄位。

---

## 2026-08-29：Mobile — 標本採集記錄、照片 EXIF 修復、名錄更新、搜尋排序

### 標本採集（Collection）第三種記錄

名錄／樣區之外的第三種記錄，含採集號序列、採集者／鑑定者、明細頁可編輯（日期時間拆兩欄、座標誤差、改名、複製、更換物種）。**採集刻意不在 app 層 single-active 之內**——開始採集不該結束進行中的名錄或樣區。

- **採集號重複檢查**（原本完全沒有）：所有自動路徑結構上不可能撞號，手打是唯一途徑，而那條路會警告並提供下一個可用號。**不加 UNIQUE 約束**——複份標本共用號碼、匯入舊資料含重複都是合理情境。
- **複製標本只承接物種與採集者**：地點、座標、物候、備註、照片刻意留空——那些描述的是某一次實體採集，靜默繼承會把上一份的描述貼到不同植株上。

### 照片 EXIF 修復（iOS-only，影響名錄 + 樣區既有照片）

使用者報「照片 metadata 和用相機拍的有差異，鏡頭資訊、焦距都變空白」。讀 `expo-image-picker` 的 iOS 原始碼確認：`quality < 1` 會讓它走 `UIImage.jpegData()`，**產出的 JPEG 完全不帶 EXIF**——Make／Model／LensModel／FocalLength／ISO／DateTimeOriginal 在我們的 piexif 看到檔案之前就沒了。Android 不受影響（該平台有 `copyExifData`）。

修法是把 picker 本來就回傳、但整個 codebase 從未讀過的 `asset.exif` 注回 piexif dict。**只補不覆蓋**，所以在 Android 自動變 no-op，不需要 `Platform.OS` 分支。順帶修好樣區環境照（原本完全沒過 piexif，先前被記為「已知限制」，實為同一個 bug）。

### 日本名錄改用 JBIF 和名チェックリスト（合併，非取代）

`ylist_names` 20,103 → **`jp_names` 25,839** 列；同義和名 0 → **6,711 個分類群**。

使用者原話是「用 wamei 取代 YList」，但 wamei 只收維管束植物、不帶保育／來源屬性；純取代會靜默損失苔蘚 1,909 筆、特有 786、IUCN 1,719、外來註記 8,780。改成 wamei 當和名層、YList 補苔蘚與屬性欄。換來的好處是 wamei 為 **CC BY 4.0**（YList 那份授權不明）。

**硬性要求：19,851 個舊 taxon_id 一個都不能掉**——記錄都持久化 taxon_id，而解析失敗時是靜默顯示空白，使用者不會知道自己的舊記錄壞了。第一次試跑就以 `sci_norm` 去重吃掉 252 個 id，改用 taxon_id 判斷後全數保留。**這條只有逐一比對匯入前的 id 清單才驗得出來**——總列數是增加的，看總數完全看不出有東西掉了。

### TaiCOL 更新至 2026-08-26 版（251,540 → 269,824 列）

匯入程式**先 DROP 表並 commit，才第一次開啟 CSV**，所以事前把三種**靜默**失效全部排除（BOM 會讓匯入 0 列不報錯、欄位改名會讓該欄 25 萬列變 NULL、值域改變會讓 20+ 處寫死的查詢全部回 0 列）。

過程中發現 **`LIKE 't00%'` 盲區**：檢索表 taxon_id 的自動修復寫在 id 還都是 `t00xxxxx` 的年代，而現在最大 id 已是 `t0124636`——5,800 個引用中有 161 個**會被警告但永遠不會被修好**。改用 `GLOB 't[0-9]*'`。

### 精確俗名優先 + 分類樹定位

- **主搜尋的 `LIMIT 100` 沒有 `ORDER BY`**：精確列進不進得來取決於 SQLite 的掃描順序，也就是 rowid——而 rowid 每次重建 bundle DB 就會變。這正是「之前搜得到、現在搜不到」的機制。實測 47 個單字俗名有 7 個被截在 100 列外。**沒有用 `ORDER BY` 解**（量過代價：單一拉丁字母命中 20 萬列，0ms → 89ms），改成另發一道走索引的等值查詢補抓，0.1ms 以內。
- **`getItemLayout` 不是純函式**：它累加一個會被每列 `onLayout` 改動的 Map，而 RN 要求它對 `(data, index)` 純粹。行高又刻意估低，誤差是每列系統性偏差乘上目標 index——所以展開得越多偏得越離譜，「修好了又壞」。改成前綴和 + `useMemo`，順帶把 O(n²) 變 O(1)。
- **但真正的症狀是定位目標本身就錯**：`RANK_ORDER` 只到 genus，所以捲動目標是**屬節點**；而 `Carex` 有 550 種、`カンスゲ` 排第 300，停在屬節點當然只看得到前面幾種。**教訓：捲動類 bug 要分開確認「數學正確」與「目標正確」。**

### 置底搜尋框被鍵盤遮住 —— 第三次，所以改用程式擋

`KeyboardStickyView` 的 offset 是用來抵銷 dock 下方既有的 chrome。抄了別的畫面的 `insets.bottom` 卻沒抄它的 `SafeAreaView` 根容器，於是那個值直接把搜尋框**往下推進鍵盤裡**（比不設更糟）。memory 早就逐字寫過這個錯法，**文件寫對了但擋不住**——新增 `npm run check:dock` 檢查 offset 與 chrome 是否配對，並把兩次歷史錯誤植回程式碼確認都抓得到。

---

## 2026-06-12：Mobile — UI 多語系（en / zh-TW）、記錄詳情 inline 可編輯小地圖

- **i18n 全面遷移**（~55 檔）：`i18next` + `react-i18next`，803 key 兩語系完全對等。資料標籤從 `const` 改成回傳 `i18n.t()` 的函式，才能在切換語言時更新。日期一律 ISO 8601（語言中性），取代寫死 `'zh-TW'` 的 `toLocaleString`。
- **匯出內容刻意不隨 UI 語言變**：靜態確認 `markdown.ts` / `bundleExport.ts` 有 0 個 i18n 引用。
- 踩過的坑：`expo-localization` 啟動崩潰 → 改用 RN 核心模組偵測 device locale（**不要用** Hermes 的 `Intl.resolvedOptions().locale`，某些 build 固定回 `en-US`）；分類樹的「界」切語言後仍是英文，因為 `i18n.t()` 被烤進常駐快取 → 資料層只存語言中性 key，render 時才翻。
- **inline 可編輯小地圖**：記錄詳情與樣區物種輸入頁直接編修座標，不必跳主地圖頁；含 zoom／定位／底圖切換／全螢幕。
- 踩過的坑：**`SafeAreaView` 在 `Modal` 內取不到 inset**（Modal 是獨立原生 view 階層，拿不到 provider context），header 貼 y=0 被瀏海蓋住。**通則：Modal 內要安全區一律用 `useSafeAreaInsets` 手動套。**

---

## 2026-06-07：Mobile — 小區(subplot)、樣區匯入 round-trip、匯出設定與 docx、常用名錄與備份

- **小區 subplot**（migration **v18**）：分層定義在 plot 層共用，小區只填 cover/height 與物種。subplot 是 plot 內部維度，**不搶 single-active**。匯出加 `eventID`／`parentEventID` 與 `subplots.csv`。
- **樣區 round-trip 匯入**：plot yml 從三個欄位擴成完整 schema（uuid + 全 metadata + 座標/地形/覆蓋/軌跡 + layers + subplots + species），依 uuid 覆蓋或另存新副本，匯入的樣區一律 `status='done'` 不搶 active。
- **匯出設定**：分類階層與保育狀態欄位可選（同桌面版）；docx 中文標楷體 + 英文 Times New Roman、各階層縮排、高階層俗名（「鴿形目 (Columbiformes)」）。
- **匯出進度 UI**：全螢幕 overlay 取代單行 toast，壓縮前先讓它畫出來再凍結。踩到的坑：overlay 是 Modal，**share sheet 無法在 Modal dismiss 中 present**（iOS 靜默不跳）→ 等 450ms 再 share。
- **常用名錄 + 備份還原**（v14）：常用物種清單、DB 備份與回復（`VACUUM INTO` + `reloadAppAsync`）。
- **常用調查者**（v15）：偏好設定建清單，建立記錄時自動帶入 `recordedBy`。
- **每筆物種記錄加 `occurrenceID`**（v16，uuid）；層高 per-layer cm/m 切換（v17，canonical 仍存 cm）。

---

## 2026-06-06：Mobile — 定點計數法(v13)、語音批次匯入、搜尋與導覽修正

- **第三種調查法 point_count**（migration **v13**，全 additive）：靜態 GPS + 半徑，物種用「個體數」，沿用 `'T'` 桶。抽出 `isStratified` / `usesTrack` / `requiresStaticGps` 三個 helper 統一約 15 處 plot_type 分支。
- **per-record 座標與偵測方式**（看到／聽到／飛過）；匯出補齊——使用者填的都能匯出（yml 補 notes 與 4 個 DwC 屬性、sp.csv 加 detectionType 與座標、plot `points.geojson` 實作）。
- **語音快速輸入名錄** + 拼音諧音層（`pinyin-pro`），語音辨識常把不常見的名字聽成同音字，phonetic 旗標只給語音批次用。
- **「加入當前記錄」的 smart-route bug**：物種卡片按「加入當前記錄」只會加進快速名錄；有 active 樣區時反而**被 single-active 結束、另開名錄**。抽共用 hook `useAddToActiveRecord`（active plot 優先），三個入口改用之。
- **分類樹跳轉永遠定位失敗**：jump 在 taxonomy 還在背景時就被消費（FlatList 未 layout，scroll 失敗後就清掉不再重試）。改成 `useIsFocused()` 之後才消費。跳轉前先 `Keyboard.dismiss()`，避免 `KeyboardStickyView` latch 在鍵盤高度。

---

## 2026-05-22：Mobile — 樣區分層通用化（1–6 層）、環境照片、DwC 屬性匯出

- **migration v12**：新表 `plot_survey_layers`（每層 cover/height/method）、`layer_count` 1–6 stepper、`env_photos_json`。`plot_species_records.layer` 的 CHECK 從 `E0–E3` 改為 `E1–E6`，整表重建並把舊值整體 +1（E0 苔蘚 → E1，生態語意不變）。
- Label 寫死 E1 苔蘚／E2 草本／E3 灌木／E4 亞喬木／E5 主林冠／E6 突出層。
- 樣區頁 tab 從三個（環境／物種／分層）收成兩個，分層併入環境。
- **環境照片**：拍照／相簿／全螢幕檢視，匯出時 rename 為 `${plotid}_YYYYMMDD_env-${N}`。
- **P0：DwC 屬性補進所有匯出格式**（sex / lifeStage / reproductiveCondition / leafPhenology）。
- 舊的 `e0_*..e3_*` 欄位刻意留著當 rollback 視窗（v13 才 drop）。

---

## 2026-05-11 – 05-21：Mobile — v0.1 初版（MVP → 植群樣區調查）

Mobile 是與桌面版**獨立的 codebase**（Expo SDK 54 + React Native 0.81 + TypeScript strict + Expo Router + NativeWind + Zustand + op-sqlite），架構、UI 慣例、build pipeline 都不同。以下為初版一路到 Phase 3 的重點；逐 sprint 細節見 `mobile/Plan.md`，踩過的坑見 `mobile/Update_log.md`。

### 資料層與搜尋

TaiCOL 名錄以 bundle DB 隨 app 出貨（首次啟動從 asset copy 到 documentDirectory，依 Metro 的 `asset.hash` 判斷是否重 copy），搜尋／模糊比對／同物異名全部 port 自桌面版並離線可用。台/臺自動互換、精確俗名優先、`≡` 同物異名與 `~` 模糊比對標記。

### 記錄

- **名錄（session）**：輕量物種記錄，含備註、照片、排序、多選刪除、隔日提示、結束後可重新啟用。
- **樣區（plot survey）**：固定樣區（分層 cover/height/method）與穿越線（GPS 軌跡，module-level watch 讓切 tab 不中斷）。**豐度通用化**為 DwC `organismQuantity` / `organismQuantityType`（BB／% cover／個體數／DBH／自訂），**DwC 物種屬性**依 kingdom / class 動態顯示。
- **single-active 不變式**：全 app 任何時刻最多一筆進行中的記錄，UI 有 gate、DB 層有 safety net、啟動時還有一次 cleanup。

### 地圖與地理樣區

滿版地圖（iOS Apple Maps / Android Google Maps）、多底圖、中研院 WMTS 85 圖層、地址搜尋、繪製點／線／面存成「地理樣區」（v2/v3，含 Multi\* 幾何）、GeoJSON／KML／GPX／WKT 匯入匯出、名錄可綁定地理樣區。

### 照片

拍照時把物種資訊嵌進 EXIF/IPTC（ImageDescription + UserComment JSON），存進 Photos.app，URI 存 `photo_paths`。UTF-8→Latin1 byte trick 解決中文變 `????`。

### 分類樹與檢索表

界→門→綱→目→科→屬→種 lazy load、展開狀態持久化、搜尋後自動展開並捲到該列；離線二歧式檢索表 runner（breadcrumb + 逐步 couplet + 終端物種卡）。

### 跨平台鐵則（此時期定案）

`Alert.prompt` 與 `ActionSheetIOS` 都是 iOS-only，統一走 `promptText()` / `showActionSheet()` 兩個 imperative API + 掛在 root 的 host 元件；**禁止用 `Platform.OS === 'ios'` if/else 寫多平台分支**（先前的 `Alert.alert` fallback 多次被發現在 Android 上選項數或功能退化）。

### 兩次值得記的事故

- **iOS 巢狀 Modal**：三層 Modal 會 hang；present 與 dismiss 撞在同一個 tick 會直接崩潰。定案為 dismiss → 等動畫 → present。
- **中文輸入搜尋讓 Hermes GC 崩潰**（`EXC_BAD_ACCESS`）：根因是 bundle DB 更新時漏 build `cname_fuzzy_index`，每次查詢都 throw `no such table`，未捕獲例外在 debounce 的 `setTimeout` 內反覆觸發直到 GC 崩。修法是補 index、`fuzzy.ts` 加缺表偵測優雅退場，並把「更新 bundle DB 必須一併重 build fuzzy index」寫進 `make mobile-db` 與 `CLAUDE.md`。

---

## 2026-04-11：名錄管理介面、資料品質檢核、物種欄位擴充、檢索表

### 名錄管理介面（`/admin` → 名錄管理 Tab）

- **搜尋 + 編輯**：搜尋俗名/學名 → 載入完整記錄 → 編輯（diff 預覽 + 確認 popup）→ 寫入 audit log
- **Cascade 連動**：usage_status 改為 accepted 時，自動偵測原 accepted name → popup 讓使用者選 not-accepted 或 misapplied → 原子性更新
- **新增分類群**：四步驟 modal：(0) 比對確認（精確+模糊）→ (1) 基本資訊（自動解析學名、依字尾判斷 rank）→ (2) 分類階層（聯動 autocomplete + 自動填入上層）→ (3) 俗名、狀態、參考文獻
- **分類群搬移**：嫁接功能，預覽影響範圍 → 確認 → 批次更新所有子記錄階層欄位
- **參考文獻**：`name_references` 表，用 name_id 關聯。CRUD API + 物種詳細頁顯示
- **Rank autocomplete**：42 個 rank，可搜尋
- **欄位條件顯示**：科中文名僅 Family rank、屬中文名僅 Genus rank、保育欄位僅 Species 以下
- **現存於臺灣鎖定**：底下有臺灣分類群時 checkbox 灰色不可修改
- **分類階層超連結**：每層可點擊跳到該分類群編輯

### 資料品質檢核（`/admin` → 資料品質 Tab）

- **9 項自動檢核**：缺階層欄位(15)、階層斷層(0)、孤立 taxon_id(1)、多 accepted(0)、重複學名(80)、俗名不一致(0)、空俗名(20,531)、階層值不一致(0)、中文名不一致(0)
- **匯出**：單項 CSV 下載 + 全部報告 DOCX
- **跳轉**：點 name_id 直接跳到名錄編輯

### 物種欄位擴充（從 TaiCOL CSV 補入）

- `nomenclature_name`：命名法規（ICN/ICZN/ICNP/ICVCN），用於匯出格式判斷
- `cites`：CITES 附錄（5,789 筆）
- `is_fossil`/`is_terrestrial`/`is_freshwater`/`is_brackish`/`is_marine`：棲地標籤
- `alien_status_note`：來源參考文獻（以表格呈現，`|` 分隔多筆）
- 前端物種詳細頁 + admin 編輯器同步顯示

### 物種詳細頁重新設計

- **Block 1 — 物種狀態**：原生/特有 badge + 棲地標籤 + 來源參考文獻（表格）+ 命名法規
- **Block 2 — 保育狀態**：臺灣紅皮書 + IUCN + CITES（IUCN 官方色系）
- **參考文獻區塊**：位於檢索表與外部連結之間
- **IUCN 色系**：EX(黑)、EW(紫)、CR(紅)、EN(橘)、VU(黃)、NT(黃綠)、LC(綠)、DD(灰)。國內紅皮書 N 前綴自動去除配色

### 檢索表（`references/key_to_sp/`）

- 623 屬、7,060 行二歧式檢索表
- `GET /api/key/{genus}` 回傳文字；`GET /api/key` 列表
- 物種詳細頁：同物異名與外部連結之間顯示
- PyInstaller 打包包含

### 匯出格式依命名法規區分

- ICN/ICNP/ICVCN → 植物式：`*Genus species* var. *epithet* Author`
- ICZN → 動物式：`*Genus species epithet* (Author, Year)`（種下不加縮寫）
- Markdown/DOCX 匯出改用 `redlist`（臺灣紅皮書）

### Code Review Skill

- `/checklister-code-review`：35 項全面性檢核（API、路由、格式化、DB model、安全性）

---

## 2026-04-09：System Tray、Icon 更新、API 文件修正、Pandoc 打包修正

### System Tray Icon（`run.py`）

- 打包後的 app（PyInstaller）現在會顯示 **system tray icon**（Windows 工作列 / macOS 選單列）。
- 右鍵選單：「開啟 Checklister-NG」（開瀏覽器）、「結束」（關閉 server）。
- 雙擊 tray icon 開啟瀏覽器。
- 開發模式（`python run.py`）不受影響，tray 只在 PyInstaller bundle 內啟用。
- `--no-tray` 旗標可強制停用。
- 新增依賴：`pystray==0.19.5`、`Pillow==11.1.0`。

### App Icon 更新

- 新 app icon（`icons/checklister-ng_icons.png`）與單色 tray icon（`icons/checklister-ng_trayicon.png`）。
- `icons/gen_icons.py`：從來源圖產生 `.ico`（Windows）、`.icns`（macOS）、預先縮放的 tray PNG（16/22/32/44/64px）。
- `make icon`：執行 `gen_icons.py`。
- Windows exe 現在有 app icon（`checklister-ng.ico`）；macOS app 使用 `checklister-ng.icns`。
- Tray icon 使用各平台精確尺寸的 PNG（Windows: 32px, macOS: 44px @2x），避免模糊。

### API 文件修正（`backend/main.py`）

- **根本原因**：SPA catch-all route（`/{full_path:path}`）和 `BaseHTTPMiddleware` 攔截了 `/openapi.json` 與 `/docs`，回傳前端 `index.html` 而非 Swagger UI。
- **修正**：移除 catch-all route 和 `BaseHTTPMiddleware`，改用：
  - `app.mount("/", StaticFiles(...))` 處理前端靜態檔（優先級低於 FastAPI 路由）。
  - `@app.exception_handler(404)` 做 SPA fallback（只在真正 404 時觸發，不影響 `/docs`/`/openapi.json`）。
- `/documentation` 頁面：移除重複的 navbar（頁面自帶 navbar 與 layout 共用 navbar 重疊）。

### Pandoc 打包修正（Windows）

從前一條目移入——併入此次 release：

## 2026-04-09：Windows DOCX 匯出修正（Pandoc 打包問題）

### Pandoc 打包修正（`checklister_win32.spec`）

- **根本原因**：GitHub Actions CI 用 `choco install pandoc`（Chocolatey）安裝。`shutil.which('pandoc')` 回傳的是 Chocolatey 的 shim（`C:\ProgramData\chocolatey\bin\pandoc.exe`，約 50KB 轉導程式），不是真正的 pandoc binary（約 80MB）。shim 被 PyInstaller 解壓後無法找到實際執行檔，導致 DOCX 匯出失敗。本機用 `winget install JohnMacFarlane.Pandoc` 安裝到 `%LOCALAPPDATA%\Pandoc\` 則無此問題。
- **修正**：新增 `_find_real_pandoc()` 函式，依序搜尋已知路徑（`chocolatey/lib/pandoc/tools/`、`%LOCALAPPDATA%\Pandoc\`、`C:\Program Files\Pandoc\`），以檔案大小（>1MB）區分真正的 binary 與 shim。同時涵蓋 CI（Chocolatey）與本機（winget）兩種情境。
- Build 時印出 pandoc 路徑與大小，方便 CI 除錯。

### Windows Subprocess 修正（`backend/api/export.py`）

- Windows `console=False` 模式下，pandoc subprocess 加上 `STARTUPINFO`（`SW_HIDE`），避免 windowed app 呼叫 console 程式時出錯。

### CI 驗證（`.github/workflows/build.yml`）

- Chocolatey 安裝後加上 `where pandoc` + `pandoc --version`，在 CI log 中驗證 pandoc 可用性。

---

## 2026-04-09：搜尋排序修正、Taxon CSV 補齊、is_in_taiwan 與 Windows 修正

### 俗名補齊（Taxon CSV Backfill）

- TaiCOL name CSV 約 30% 的 accepted 物種缺少 `common_name_c`，但 taxon CSV 有。
- `taicol_import.py` 匯入後自動從同目錄的 taxon CSV（`TaiCOL_taxon_*.csv`）補齊缺少的俗名，以 `taxon_id` 對照。
- 範例：`Sedum morrisonense`（玉山佛甲草）在 name CSV 中無俗名，taxon CSV 有。
- 匯入輸出新增 `backfilled_names` 計數。

### is_in_taiwan 多值修正

- 部分記錄的 `is_in_taiwan` 為 `true,true`（多個 taxon_id）。搜尋查詢從 `== 'true'` 改為 `LIKE '%true%'`，套用於 `search_api.py` 和 `taxonomy_api.py`。

### 搜尋排序優先級修正

- 排序改用原始 `common_name_c` 而非顯示用的 `cname`（後者可能含括號區分）。
- 新優先級：common_name_c 精確 → 學名精確 → common_name_c 包含 → alternative_name_c 精確 → alternative_name_c 包含 → 前綴 → 長度。
- 修正：搜「玉山佛甲草」現在 `Sedum morrisonense` 排第一（原本被 `Sedum cryptomerioides` 透過 alt name 搶先）。

### 分類資訊補齊擴展

- `_backfill_common_names()` 現在補齊所有缺失的分類欄位（family, family_c, kingdom, phylum, class, order, genus, genus_c, is_endemic, alien_type, iucn, redlist），使用 `COALESCE(NULLIF(...))`。
- 修正 42,349 筆缺少科名/界/門的記錄。

### RWD z-index 修正

- 搜尋建議列表：`z-10` → `z-[9999]`，避免手機版被物種詳細頁元件蓋住。
- Sticky 工具列：`z-30` → `z-[100]`。

### Windows PyInstaller 修正

- `run.py`：Windows `console=False` 時 `sys.stdout`/`sys.stderr` 為 None 會崩潰，重導向到 `os.devnull`。
- 同時檢查 `pandoc` 和 `pandoc.exe` 路徑。
- `uvicorn` log level 設為 `"warning"`。

---

## 2026-04-08：名錄比較、批次匯入改寫、搜尋排序與 YAML 修正

### 名錄比較（`/compare`）

- 新頁面，支援 2-10 份名錄並排比較。
- **輸入**：加入當前名錄 及/或 上傳多個 YAML 檔。
- **有無指數**：物種數、共同種、獨有種、Sørensen / Jaccard 相似度矩陣。
- **豐度指數**（有數量資料時）：Shannon-Wiener H'、Simpson D、Evenness J'。
- **物種矩陣**：所有物種 × 名錄，✓/✗ 顯示，可篩選共同種/獨有種/至少 N 個。
- **匯出**：CSV 報告（含矩陣 + 指數）。
- **數量欄位**：SpeciesTable 新增 inline 可編輯「數量」欄。DwC 對應：`abundance → individualCount`。

### 批次匯入改寫

- 「批次匯入」改為 modal，可貼上名稱列表（換行或逗號分隔）+ 檔案上傳。
- **三階段處理**：
  1. 精確匹配（俗名或學名完全一致）→ 自動加入
  2. 多筆匹配 → modal 內列出讓使用者選擇（可跳過、全部跳過）
  3. 查無資料 → modal 內列出，每筆可選「放入未收錄」或「忽略」（含批次按鈕）
- 全部成功時自動關閉 modal。
- 按鈕文字：「開始比對」→「開始匯入」。

### 搜尋排序修正

- 搜尋結果排序：精確匹配優先 → 前綴匹配 → 名稱長度（短的更相關）。
- 範例：搜「芒」→「芒 (Miscanthus sinensis)」排第一（原本被「三芒耳稃草」擠到後面）。

### YAML 解析修正

- `parseChecklistYAML()` 現在處理 `checklister-ng:` 包裹層（巢狀 YAML 結構）。
- 修正比較頁面無法解析匯出的 YAML 檔的問題。

### YAML 匯出：WKT 只在 YAML

- Markdown/DOCX header 不再包含原始 WKT 字串（只有計畫名稱和樣區名稱）。
- WKT 包含在 ZIP 內的 `.yml` 檔及獨立 YAML 匯出中。

---

## 2026-04-08：地圖編輯器、鍵盤快捷鍵、匯出 metadata 與植物分類修正

### 地圖編輯器（`/map`）

- 完整 Leaflet 地圖編輯器：支援 Marker/Polyline/Polygon/Rectangle 繪製。
- **匯入**：GPX、KML、WKT、GeoJSON 檔案（使用 `@tmcw/togeojson` 和 `terraformer-wkt-parser`）。
- **匯出**：下載為 WKT、GPX（`togpx`）、KML（`tokml`）、GeoJSON。
- 計畫 metadata 表單：計畫名稱 + 樣區名稱（持久化至 localStorage 的 `metadataStore`）。
- 幾何資料自動存入 `metadataStore.geometries`（GeoJSON）和 `metadataStore.footprintWKT`（WKT）。
- 地點搜尋（Nominatim geocoding）。
- 修正：Leaflet marker icon 路徑及 `draw:created` 事件字串（ESM 動態 import 相容性）。

### 地圖預覽（主頁面）

- 工具列「地圖」按鈕開啟 pop-up Modal，內嵌只讀地圖預覽（Leaflet lazy load）。
- 顯示 WKT 片段及「前往編輯」連結至 `/map`。
- 有幾何資料時按鈕轉綠色。

### YAML 幾何連動

- **匯出**：YAML 自動含 `project`、`site`、`footprintWKT` 欄位。
- **匯入**：`importer.ts` 讀取 YAML 中的 `footprintWKT`、`project`、`site` 存入 `metadataStore`。
- **Markdown/DOCX 匯出**：header 自動帶入計畫名稱（作標題）、樣區名稱、WKT。

### 鍵盤快捷鍵

- **SearchBox**：`↑`/`↓` 瀏覽建議（藍色高亮）、`Enter` 加入物種、`Esc` 關閉。
- **SpeciesTable**：`Delete`/`Backspace` 刪除已勾選物種（附確認）。輸入框中不觸發。
- **SpeciesSidebar（詳細頁）**：`Delete`/`Backspace` 刪除當前選中物種（附確認），刪除後自動切換。

### Sidebar 搜尋篩選

- 詳細頁 sidebar「返回名錄」上方新增篩選輸入框，即時過濾物種列表。

### 維管束植物分類修正

- **嚴格 6 類群排序**：石松類→蕨類→裸子→單子葉→真雙子葉姊妹群→真雙子葉。
- **Magnoliopsida 用 order 判斷**：建立 `MONOCOT_ORDERS`（11 目）和 `SISTER_EUDICOT_ORDERS`（Ceratophyllales）對照表，其餘 → 真雙子葉植物。
- 移除「被子植物 Angiosperms」fallback。
- 匯出 `_get_field_display()` 一律走 dao lookup → class 對照 → order 判斷。

### 同俗名區分修正

- 無 `alternative_name_c` 時不再顯示括號內的學名。

### 搜尋結果 Badge

- 搜尋建議列表顯示原生（綠）、歸化（黃）、栽培（藍）、臺灣特有（紫）、IUCN（灰）標籤。

### 統一進階篩選

- 合併為單一「篩選」modal：Emoji icon 分類群按鈕 + 階層搜尋（auto-complete）+ 特有性/原生外來。
- 切換分類群清空限定分類群（附確認）。
- 篩選 auto-complete 最低 1 字觸發。

---

## 2026-04-07：分類樹、進階篩選、UI 調整

### 分類樹瀏覽器

- 新增 `/taxonomy` 路由，可開合的階層瀏覽器（界→門→綱→目→科→屬→種）。
- 透過 `GET /api/taxonomy/children` lazy-load 子節點，每個節點顯示統計（X門 X綱 X目 X科 X屬 X種）。
- 不同階層用不同顏色 badge（界=紅, 門=黃, 綱=綠, 目=藍, 科=紫, 屬=灰）。
- 物種列表顯示特有/原生/歸化/入侵/栽培標籤及 IUCN 狀態。
- 分類樹內搜尋（`GET /api/taxonomy/search`）：輸入名稱 → auto-complete → 選取後自動逐層展開並高亮。
- 「全部收合」按鈕。植物界/動物界/真菌界快捷按鈕。

### 共用 Navbar

- Navbar 從 `+page.svelte` 搬到 `+layout.svelte`，所有頁面（Home, Taxonomy, Docs, Admin）共用同一導覽列，當前頁面自動標記 active。

### 統一進階篩選

- 將原本的分類群下拉和階層下拉合併為單一「篩選」按鈕，開啟統一篩選 modal。
- 篩選 modal 內容：
  - **高階分類群 icon 按鈕**：Emoji 圖示（🌿維管束植物, 🐦鳥綱, 🍄真菌界 等），選中藍色高亮。
  - **限定特定分類群**：選階層（綱/目/科/屬）→ 輸入名稱（auto-complete）→ 選取。
  - **特有性**：僅特有種 checkbox。
  - **原生/外來**：原生/歸化/入侵/栽培下拉。
- 階層搜尋使用專用 `GET /api/search/rank` API。
- 切換高階分類群時清空已選的限定分類群（附確認提示）。
- 啟用的篩選以 badge 顯示於搜尋列下方；「清除篩選」一鍵重置。

### UI 調整（SpeciesTable）

- 搜尋+科別篩選移到表格上方獨立行。
- 刪除按鈕移到表格右上角，縮小為「刪除 (n)」。
- 每頁筆數選單移到表格下方與分頁並排：「顯示 [10▼] 筆/頁，共 N 筆」。
- 每頁選項擴展為 10/20/50/100。

### 搜尋修正

- 篩選 auto-complete 最低輸入從 2 字改為 1 字（支援單個中文字如菊、蘭、松）。
- 屬層級搜尋加入 `genus_c`（屬中文名）查詢。
- 同俗名 Species + nominal infraspecific 去重。

---

## 2026-04-07：安全強化與程式碼品質

### 安全修復

- **LIKE 注入跳脫**：所有 SQL `LIKE` 查詢透過 `_escape_like()` 跳脫使用者輸入中的 `%` 和 `_` 萬用字元。套用於 `search_api.py` 和 `resolve_name.py`。
- **CORS 中介層**：新增 `CORSMiddleware`，允許 `localhost:5173` 和 `localhost:8964`。
- **速率限制**：新增 `slowapi`，預設每 IP 每分鐘 60 次請求。
- **XSS 防護**：`formatter.ts` 的 `formatScientificName()` 在建構斜體標籤前先跳脫 HTML 實體（`<`、`>`、`&`、`"`），防止資料庫被污染時的 stored XSS。
- **CSV SQL 注入檢查**：Admin CSV 上傳（`/api/admin/import-taicol`）掃描上傳內容中的可疑 SQL 語法（`DROP`、`DELETE`、`INSERT`、`UNION` 等），偵測到即拒絕。
- **查詢長度限制**：搜尋 `q` 限制 512 字元，`taxon_id` 限制 20 字元。
- **上傳大小限制**：CSV 上傳限制 200MB。

### 程式碼品質

- **日誌**：`main.py` 新增 `logging.basicConfig()`。所有 `except Exception: pass` 改為 `logger.exception()` 以正確記錄錯誤。
- **暫存檔清理**：匯出 API 使用 `BackgroundTasks` 在回應送出後刪除暫存 ZIP 檔案。

### 依賴

- 新增 `slowapi` 至 `requirements.txt`。

---

## 2026-04-07：匯出修正、RWD、外部連結與資料校正

### 匯出修正

- **植物高階層名稱**：維管束植物匯出嚴格使用中文類群名（石松類植物、蕨類植物、裸子植物、單子葉植物、真雙子葉植物姊妹群、真雙子葉植物），透過 `dao_pnamelist_pg` 查詢正確的 `pt_name`。蘇鐵/銀杏/松綱全部歸入裸子植物。
- **植物階層排序**：依 `dao_plant_type.plant_type` 順序排列（苔蘚→石松→蕨類→裸子→單子葉→姊妹群→真雙子葉）。
- **Markdown 斜體修正**：物種項目縮排從 8 空格改為 4 空格，避免 Pandoc 將 `*斜體*` 當成 code block 直接輸出星號。
- **種下名義亞種去重**：同俗名的 Species 和其 nominal infraspecific（如 `fo. pygmaeus`）只保留 Species 層級。
- **同物異名斜體修正**：移除同物異名列表的外層 `italic` class，rank 縮寫（var./subsp./fo.）現在正確顯示為正體。

### RWD：手機版物種詳細頁

- 桌面版（md 以上）：左側邊欄固定顯示。
- 手機版（md 以下）：側邊欄隱藏，詳細頁頂部顯示「物種列表」按鈕。點擊後從左側滑出 drawer（附半透明背景遮罩），選擇物種後自動關閉。

### 外部連結

- **TaiCOL**：修正為只取第一個俗名（去掉括號內的第二俗名）。
- **植物專用連結**（僅植物界顯示）：IPNI、POWO、台灣植物資訊整合查詢系統。
- **所有類群新增**：Wikispecies、NCBI Taxonomy。

### 資料校正

- `Pinus armandii var. masteriana`（name_id=133788）：`usage_status` 從 `accepted` 改為 `not-accepted`。此為 TaiCOL 原始資料的拼寫錯誤，正確接受名為 `Pinus armandii var. mastersiana`（name_id=61488）。

### 搜尋 API：pt_name 查詢

- 維管束植物的 `_build_pt_name()` 改為查詢 `dao_pnamelist_pg` 取得正確的中文 `pt_name`（如「真雙子葉植物 Eudicots」），而非回傳 `Tracheophyta > Magnoliopsida`。

---

## 2026-04-06：多分類群匯出與可配置階層

### 多分類群匯出

- **自動偵測分類群**：匯出時自動依物種的 `kingdom`、`phylum`、`class_name` 欄位偵測分類群（維管束植物、鳥綱、昆蟲綱、真菌等）。
- **各分類群預設階層**：
  - 維管束植物：類群(pt_name) → 科(family) → 物種
  - 鳥類/昆蟲/哺乳類/爬行類/兩棲類：目(order) → 科(family) → 物種
  - 真菌：門(phylum) → 綱(class) → 科(family) → 物種
  - 軟體動物：綱(class) → 目(order) → 科(family) → 物種
- **混合名錄**：名錄同時包含多個分類群的物種時，匯出自動分段，各段套用各自的預設階層。
- **Markdown 標題**：從硬編碼的「維管束植物名錄」改為動態的「物種名錄」，統計數字正確反映實際內容。

### 可配置匯出階層

- **`levels` 查詢參數**：`POST /api/export?format=markdown&levels=order,family` 可覆蓋預設階層。
- **前端「匯出設定」按鈕**：開啟 modal，提供 6 個 checkbox（界、門、綱、目、科、屬）自訂匯出階層。
- **未勾選時**：使用各分類群的預設階層。
- 注：Superfamily（總科）、Subfamily（亞科）、Tribe（族）第一版不支援（TaiCOL 中為 rank 值而非物種欄位），留待後續版本。

### 搜尋 API：完整分類階層欄位

- 搜尋結果新增：`kingdom`、`phylum`、`class_name`、`order`、`genus`、`genus_c`。
- 這些欄位會存入 species store，供匯出系統使用。

### DwC Mapper

- 新增 `kingdom`、`phylum`、`class`（對應 `class_name`）、`order`、`genus`、`taxon_id` 至 Darwin Core 欄位對應。

### 新建/修改檔案

| 檔案 | 修改內容 |
|------|---------|
| `backend/api/export.py` | 全面改寫：多分類群偵測、預設階層定義、遞迴分群渲染、`levels` 參數 |
| `backend/api/search_api.py` | 回傳完整分類階層欄位（kingdom 到 genus） |
| `backend/utils/mapper.py` | DwC mapping 新增分類階層欄位 |
| `frontend/src/lib/ExportSettings.svelte` | 新建：匯出階層勾選 modal |
| `frontend/src/routes/+page.svelte` | 整合 ExportSettings，匯出時傳遞 levels 參數 |

---

## 2026-04-06：TaiCOL 整合、模糊搜尋與搜尋體驗改進

### TaiCOL 資料庫整合

- 匯入 TaiCOL 物種名錄 CSV（242,285 筆，涵蓋臺灣所有生物類群）至新的 `taicol_names` SQLite 資料表。
- 對搜尋常用欄位建立索引：`common_name_c`、`alternative_name_c`、`simple_name`、`family`、`family_c`、`taxon_id`、`usage_status`、`(kingdom, phylum)`、`class`。
- 多值 `taxon_id`（433 筆含逗號分隔 ID）取第一個為主要值，原始值保留於 `taxon_id_all`。
- CSV 中重複的 `name_id` 自動跳過。
- 每次匯入前自動備份資料庫。

### 搜尋 API 改寫

- **`GET /api/search?q=&group=`**：改查 `taicol_names` 表，LIKE 搜尋 5 個欄位（`common_name_c`、`alternative_name_c`、`simple_name`、`family`、`family_c`），並保留舊 `dao_pnamelist_pg` 表作為 fallback。
- **替代俗名搜尋**：輸入任何俗名（主要或替代）皆可找到物種。例如「過山龍」、「台灣鹹蝦花」、「臺灣鹹蝦花」都找到 *Vernonia gratiosa*。
- **台/臺自動互換**：搜尋時自動產生台↔臺的查詢變體。
- **接受名優先排序**：`usage_status = 'accepted'` 的結果排在異名和誤用名之前。
- **`is_in_taiwan` 篩選**：只回傳存在於臺灣的物種。
- **分類群篩選器**：新增 `group` 查詢參數（見前端章節）。
- 回應新增 `taxon_id` 和 `usage_status` 欄位。

### 同物異名 API

- **`GET /api/synonyms?taxon_id={id}`**（`backend/api/synonyms_api.py`）：回傳同一 `taxon_id` 的所有學名，含狀態標記（`accepted`、`not-accepted`、`misapplied`）、命名者及俗名。

### 管理匯入 API

- **`POST /api/admin/import-taicol`**（`backend/api/admin_api.py`）：接受 TaiCOL CSV 檔案上傳（multipart），備份資料庫後清空重建 `taicol_names`，以每 5,000 筆為單位批次匯入，完成後重建索引。回傳匯入統計（筆數、耗時）。
- 需要 `python-multipart` 套件（已新增至 `requirements.txt`）。

### 前端：分類群篩選器

- `SearchBox.svelte` 新增下拉篩選器，包含 13 個分類群與「所有類群」：
  - 維管束植物、植物界、鳥綱、真菌界、哺乳類、爬行類、昆蟲綱、蛛形綱、軟體動物、輻鰭魚類、兩棲類、原生生物、所有動物。
- 搜尋結果中非接受名顯示 `usage_status` 標籤。

### 前端：同物異名顯示

- `SpeciesDetailPanel.svelte` C2 區塊現在會自動從 `/api/synonyms?taxon_id=` 載入同物異名資料。
- 以科學名、命名者、俗名和色彩標籤（綠=接受名、紅=誤用名、深灰=異名）顯示。

### 前端：管理頁面

- 新增 `/admin` 路由（`frontend/src/routes/admin/+page.svelte`）：提供 TaiCOL CSV 檔案上傳介面。
- 顯示上傳進度、匯入統計（筆數、耗時）及錯誤訊息。
- 導覽列新增 Admin 連結。

### Makefile

- 新增 `make taicol` target：自動找到最新的 `references/TaiCOL_name_*.csv`，備份資料庫並匯入。支援自訂路徑：`make taicol CSV=path/to/file.csv`。

### 新建檔案

| 檔案 | 用途 |
|------|------|
| `backend/models/schema.py`（修改） | 新增 `TaicolName` model 對應 `taicol_names` 表 |
| `backend/services/taicol_import.py` | CSV 匯入服務（批次插入 + 索引建立） |
| `backend/services/__init__.py` | 套件初始化 |
| `backend/utils/backup.py` | 資料庫備份工具 |
| `backend/api/admin_api.py` | TaiCOL CSV 上傳端點 |
| `backend/api/synonyms_api.py` | 同物異名查詢端點 |
| `frontend/src/routes/admin/+page.svelte` | 管理上傳頁面 |

### 模糊比對搜尋（Levenshtein Distance）

- 新增 `rapidfuzz` 依賴，實作打字容錯搜尋。
- **記憶體快取**：62,658 個不重複 accepted 俗名於首次搜尋時載入（~0.2 秒），常駐記憶體（~2-3MB）。Thread-safe lazy loading，TaiCOL 重新匯入後自動清空。
- **兩階段搜尋**：先做 LIKE 精確搜尋，結果不足 5 筆時啟動 fuzzy fallback，以 Levenshtein distance ≤ 1 掃描快取（62k 筆約 11ms），不足再放寬到 distance ≤ 2。
- 範例：「香南」→ 找到「香楠」（dist=1）；「舗地黍」→ 找到「舖地黍」（dist=1）。
- 含 fuzzy 的整體搜尋時間 < 130ms。

### 搜尋體驗改進

- **只顯示接受名**：搜尋下拉選單只顯示 accepted name，非接受名自動解析到對應的接受名。
- **非接受名顯示**：使用者輸入異名（如 `Lycopodium cernuum`）時，下拉顯示：`俗名 (異名學名) [not-accepted] → 接受學名`。
- **同俗名區分**：多個物種共用相同俗名時，以替代俗名加括號區分，例如「過山龍(台灣鹹蝦花)」vs「過山龍(垂穗石松)」。
- **替代俗名匹配**：透過 `alternative_name_c` 匹配時，顯示格式為：`替代俗名(主要俗名) (學名) 科名`。
- **模糊結果提示**：fuzzy 結果以橘色顯示「≈ 您是否在找？」標記。
- **物種詳細頁**：分類資訊科名上方新增「其他俗名」欄位（來自 `alternative_name_c`）。同物異名列表移除俗名，只顯示學名 + 命名者 + 狀態標籤。

### 修改檔案

| 檔案 | 修改內容 |
|------|---------|
| `backend/api/search_api.py` | 全面改寫：TaiCOL 搜尋、分類群篩選、台/臺互換、只顯示接受名並自動解析異名、同俗名區分、Levenshtein 模糊快取搜尋 |
| `backend/main.py` | 註冊 synonyms_api 和 admin_api router |
| `backend/services/taicol_import.py` | 匯入後清空 fuzzy 快取 |
| `frontend/src/lib/SearchBox.svelte` | 分類群下拉選單、非接受名顯示、模糊提示 |
| `frontend/src/lib/SpeciesDetailPanel.svelte` | 自動載入同物異名、顯示其他俗名、移除同物異名中的俗名 |
| `Makefile` | 新增 `taicol` target |
| `requirements.txt` | 新增 `python-multipart`、`rapidfuzz` |

---

## 2026-04-06：架構重構與物種詳細頁

### 移除項目

- **Electron app**（`electron-app/`）：移除整個 Electron wrapper。它沒有使用任何原生功能，僅開啟瀏覽器視窗，卻增加 584MB 的 `node_modules`。相同功能已由 `run.py` 的 `webbrowser.open()` 實現。
- **死碼**（`backend/api/main.py`）：移除未被使用的舊版主程式檔案，該檔案從未被 import 且包含壞掉的 router 引用。
- **註解程式碼**：清除 `backend/main.py`、`backend/api/export.py`、`backend/models/schema.py` 中約 100 行的註解程式碼。
- **未使用的依賴**：從 `requirements.txt` 移除 `python-docx` 和 `lxml`（程式碼使用 Pandoc 轉換 DOCX，並非 python-docx）。

### 後端變更

- **可配置的資料庫路徑**（`backend/db.py`）：資料庫路徑現可透過 `CHECKLISTER_DB_PATH` 環境變數設定，預設仍為 `backend/twnamelist.db`。
- **搜尋 API**（`backend/api/search_api.py`）：新增 `name` 欄位（不含命名者的學名）至搜尋回應。先前僅回傳 `fullname`（含命名者）。
- **匯出類群排序**（`backend/api/export.py`）：名錄匯出的高階類群排序改從 `dao_plant_type` 資料庫表讀取，不再寫死於程式碼中。新增至資料庫的分類群將自動反映在匯出結果。
- **Pandoc 錯誤處理**（`backend/api/export.py`）：Pandoc subprocess 呼叫新增 `capture_output`、回傳碼檢查及 30 秒 timeout。先前 Pandoc 失敗時不會回報任何錯誤。
- **靜態檔案服務**（`backend/main.py`）：FastAPI 現在直接 serve 前端 build 產物作為靜態檔案，並提供 catch-all route 支援 SPA 客戶端路由。前端目錄可透過 `CHECKLISTER_FRONTEND_DIR` 設定。
- **設定腳本**（`backend/setup.sh`）：修正 shebang（`sh` → `bash`）、加入 `set -e`、改從 `requirements.txt` 安裝而非手動列出套件。

### 前端變更

- **靜態 adapter**（`frontend/svelte.config.js`）：從 `adapter-auto` 改為 `adapter-static`，以正確產出靜態網站。
- **佈局設定**（`frontend/src/routes/+layout.ts`）：新增 `prerender = true` 和 `ssr = false` 以配合靜態 build。
- **可排序表格**（`frontend/src/lib/SpeciesTable.svelte`）：所有表格欄位（ID、科名、俗名、學名、來源、特有）皆可點擊排序。俗名依中文筆畫排序（使用 `Intl.Collator('zh-Hant', { collation: 'stroke' })`）。科名依拉丁名字母排序，顯示格式為「中文名 (拉丁名)」。
- **點擊列開啟詳細頁**（`frontend/src/lib/SpeciesTable.svelte`）：新增 `onRowClick` prop，點擊物種列（非勾選框）即開啟物種詳細頁面。
- **物種詳細頁**（新檔案）：
  - `SpeciesDetailView.svelte`：容器，flex 佈局配置側邊欄與詳細面板。
  - `SpeciesSidebar.svelte`：左側邊欄，依筆畫排序的物種清單及「返回名錄」按鈕。
  - `SpeciesDetailPanel.svelte`：右側面板，包含三個區塊：
    - C1：物種資訊（學名、俗名、科名、高階類群、來源/特有/IUCN 標籤）。
    - C2：同物異名（UI 已就緒，等待資料串接）。
    - C3：外部連結至 GBIF、TaiCOL 及 iNaturalist。
- **固定工具列**（`frontend/src/routes/+page.svelte`）：搜尋列、匯入按鈕、匯出控制項及物種數量標籤現在固定於頁面頂部（sticky），捲動時不會離開視野。
- **視圖切換**（`frontend/src/routes/+page.svelte`）：新增 `viewMode` 狀態（`'table'` | `'detail'`），在名錄表格與物種詳細頁之間切換。
- **資料遷移**（`frontend/src/stores/speciesStore.ts`）：從 localStorage 載入資料時，缺少 `name` 欄位的項目會自動透過 `extractName()` 補齊。此函式可從 `fullname` 欄位解析學名（包含 subsp.、var.、f. 等種下階層格式）。

### 外部 API 連結

- **GBIF**：`https://www.gbif.org/species/search?q={scientificName}`
- **TaiCOL API**：`https://api.taicol.tw/v2/taxon?scientific_name={scientificName}`（注意：domain 為 `api.taicol.tw`，非 `taicol.tw/api`）
- **TaiCOL 網頁**：`https://taicol.tw/zh-hant/search?name={scientificName}`
- **iNaturalist**：`https://www.inaturalist.org/taxa/search?q={scientificName}`

所有 URL 使用 `name` 欄位（不含命名者），以 `encodeURIComponent()` 編碼。

### 打包

- **Makefile**：新增 `Makefile`，提供目標：`make`、`make run`、`make dev`、`make pkg`、`make pkg-dmg`、`make pkg-win`、`make clean`。
- **PyInstaller 改進**（`run.py`、`checklister.spec`）：
  - `run.py` 使用 `sys._MEIPASS` 在 PyInstaller 環境中定位打包資源。
  - `wait_for_server()` 以 socket 輪詢 server 就緒後才開啟瀏覽器，修復「localhost refused to connect」的 race condition。
  - 環境變數（`CHECKLISTER_DB_PATH`、`CHECKLISTER_FRONTEND_DIR`）在 import app 模組之前設定。
  - 前端 build 產物現已包含於 PyInstaller bundle 中。
  - Pandoc binary 已打包於 app 內（透過 `which pandoc` 自動偵測），使用者無需額外安裝 Pandoc。
  - 排除不必要的套件（PIL、numpy、IPython、jedi、pygments、zmq 等）以縮小 bundle 體積。
  - 預設 port 改為 8964。
- **DMG 打包**：`make pkg-dmg` 建立 macOS DMG，內含 `.app` bundle 和 Applications 捷徑，支援拖拉安裝。
- **Windows spec**（`checklister_win32.spec`）：新增 Windows 單檔執行檔打包設定。
