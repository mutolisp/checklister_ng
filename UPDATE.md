# Update Log

## 2026-09-02: Mobile — Literal `{{typed}}` in the Name Chooser; Two Holes Closed in check:i18n

> Mobile app (`mobile/app/`).

The name chooser shipped yesterday rendered its third option as `用「{{typed}}」，並認定它就是「Digitaria heterantha」`. The misapplied variant of the string was authored with `{{typed}}` while its caller passed `{ name, accepted }` (the non-misapplied variant uses `{{name}}` and was fine; so was the chooser's body text, which uses `{{typed}}` and is actually given it). i18next emits an unsatisfied placeholder verbatim — no error, no fallback. The string now uses `{{name}}`, matching its four sibling options.

### check:i18n could not see this, so it was extended

It only verified that a key exists in both locales — and here both locales had the key, holding a perfectly valid string. A new pass **compares the params each `t()` call passes against the placeholders in the string**; reintroducing the bug names `src/lib/adoptName.ts:83` and the missing `{{typed}}` outright. Only unsatisfied placeholders fail: an extra unused param is not reported (several call sites legitimately feed one object to two sibling keys), and `{...opts}` spreads, which cannot be resolved statically, go to an advisory list rather than a false positive.

Writing it surfaced **a second hole**: neither line regex matched `t(cond ? 'a.b' : 'c.d')` — the first argument does not open with a quote (so KEY_RE misses) and is followed by `?` rather than `,` or `)` (so DYNAMIC_RE misses too). The ternary keys added the day before had therefore **never been checked for existence at all**; both happened to be present. The new pass brace-matches the whole argument list instead (skipping parens inside string and template literals), so both branches of a ternary are checked. Sweeping the repo turned up no other gap: all 990 referenced keys are present.

---

## 2026-09-01: Mobile — Recording Under Your Own Taxonomic Opinion

> Mobile app (`mobile/app/`).

TaiCOL calling a name a synonym or misapplied does not mean the recorder agrees — taxonomic opinion legitimately differs. The app used to decide for them: searching a synonym resolved straight to the accepted name, the record stored only the accepted `taxon_id`, the name they typed flashed past in one search-row line and was gone, and the export gave no sign of which name the determination had actually used.

### The fact the design turns on

Measured on the bundled DB: 269,824 rows, **269,824 distinct `name_id`**, 96,677 distinct `taxon_id` — `taxon_id` is the taxon *concept* and `name_id` is the *name*, and **27.7% of concepts carry a synonym**. So adopting a local synonym needs no GBIF at all: the name already has an id locally. And `name_id` is `INTEGER PRIMARY KEY` (the rowid), so looking it up is the cheapest query SQLite has — no index to add, no bundle rebuild.

### What shipped (migration v28)

The three record tables gain `used_name_id` + `used_scientific_name` (both NULL = the accepted name, so no backfill and no change to existing rows), while `taxon_id` stays put so statistics and export grouping never split. The `≡ you typed: X` line in search results is now tappable, opening a chooser: use the accepted name / use X but keep the same taxon / use X as its own taxon (fetching the full hierarchy from GBIF) / file under the other local taxon (the 451 rows where a misapplied name spans two concepts).

**Two columns rather than one**: comparing two real TaiCOL releases row by row, of 242,282 shared name_ids, 13 changed scientific name, 3 disappeared, 277 moved to a different taxon and 283 changed status. The id is stable but not perfect; the string is self-describing. **The status is deliberately not stored** — TaiCOL changes its mind, and the recorder's choice is the part worth persisting.

Export adds four DwC terms previously unused anywhere in the repo: `scientificNameID`, `taxonomicStatus`, `acceptedNameUsage` and `acceptedNameUsageID` (the taxon_id — DwC requires it to share an identifier space with `taxonID`), mirrored into `backend/utils/mapper.py`. Records without an adopted name gain no fields at all.

### Existing defects fixed along the way

- **`sciMatch`'s `usage_status LIKE '%accepted%'` also matches `'not-accepted'`** (substring) — batch import and scientific-name matching could already treat a synonym as accepted.
- **`externalToSearchResult` hardcoded `usage_status: 'accepted'`**, so every externally sourced name claimed a status nobody had checked.
- **The GBIF lookup performed two silent name substitutions** (GBIF synonym → accepted → local taxon) and skipped its own confirmation step, discarding what `sciMatch` had computed about the local checklist's view. It now shows what you picked next to what the checklist has, and lets you decide.
- **Markdown deduped by taxon_id**, collapsing two deliberately different names under one concept into a single line.
- Three paths that silently swallowed an adopted name — import, duplicate-record, batch import — were all closed.

### check:roundtrip could not have caught this class of loss

Its field-coverage assertion had **never been run against record-level rows**: adding a record column and forgetting the exporter passed the check. It now covers them, with the fields `resolveTaxa` joins on excluded so the real signal is not drowned out.

The data-check screen also gains one line: how many adopted names no longer match the current checklist (527 non-accepted names changed concept within six months) — **reported, never rewritten**; the record still shows the name its recorder chose.

---

## 2026-08-31: Mobile — Record Import/Restore, Duplicate Record, GBIF Name Lookup

> All of the below is the mobile app (`mobile/app/`). Architecture notes and TODOs live in `mobile/Plan.md`.

### Full round-trip import for checklist / plot `.yml`

- **Checklist (session) had no import path at all**: the only reader of a session yml, `BatchImportModal`, pulled taxonIDs into an *existing* checklist and dropped the `event:` block, times, surveyor, quantities, GPS, attributes and remarks. Added `importSession` + `sessionImport.ts`, restoring every column of `sessions` and `checklist_records`.
- **Plot import completed**: bound site, photos, `env_photos_json`, `track_finalized`; an unknown `project` is now created instead of silently collapsing into 未分類.
- **The yml schema grew on both sides**: plot gains `site:` / `env_photo_files` / `track_finalized` / `species[].photo_files`; session `event:` gains `eventUUID` / `eventType` / `eventRemarks` / `decimalLatitude,Longitude` / `gpsMode` / `trackGeoJSON`, and checklist items gain `associatedMedia`.
- **The yml is authoritative**; the zip's `track.*` / `site.*` (gpx/kml/geojson) are consulted only when the yml lacks that geometry.
- **Photos restore into Photos.app** (the same `createAssetAsync` path a capture takes). When overwriting a record that already has photos, the user is asked to keep the existing ones or import again — Photos.app assets cannot be overwritten, so those are the only honest options.
- Fixed **photo filename collisions**: the `{taxonID}_{label}_{n}` counter was per-record, so two rows of the same taxon in one export produced identical entries and one was silently overwritten — photos were being lost at export time.
- Fixed **data loss on overwrite import**: the old copy was deleted before the species loop, which could then throw on a legacy `E0` layer (CHECK violation), leaving neither record. Now wrapped in `withTransaction` (op-sqlite's `db.transaction()` is async and cannot wrap the synchronous `executeSync` layer, hence explicit BEGIN/COMMIT) with layer coercion.
- A multi-record bundle zip used to import an arbitrary one of its records — now refused; zip-slip guard added for the first feature that writes files out of a zip.
- **Schema v27**: `sessions.uuid` (add column → backfill → unique index, each step re-runnable), giving checklists the upsert key a round trip needs.

### Batch import failed on a `.zip`

"Read from file" read the picked file as text, so a zip produced iOS's raw `the text encoding of its contents can't be determined`. Now goes through `readRecordYamlText()` (reads a `.yml`, or extracts the record yml from a `.zip`), with errors mapped through `importErrorMessage()`.

### Records list: duplicate a record, save species to favourites

- New **Duplicate** swipe action (duplicate / export / delete). Choose whether to carry the setup (survey settings + environmental values) and the species (list plus layer/subplot slot only), name the copy, and optionally start recording in it immediately.
- **Names auto-advance**: `JP-EH-12` → `JP-EH-13`, zero padding preserved (`PLOT_009` → `PLOT_010`), a date appended when there is no number, and taken names skipped. A collision warns rather than blocks — re-surveying a permanent plot next season keeps the same plotid on purpose.
- Multi-select mode gains **save to favourites** (several records at once), reusing the existing `importFromRecord`.
- **Collection trips do not copy specimens**: collection numbers come from the collector's global career series, derived from stored rows and unreclaimable, so pre-issuing them would burn real numbers on gatherings nobody made.

### Drawing a favourites-list area landed on the wrong screen

`router.back()`'s assumption did not hold — `/favorites` sits *above* `(tabs)` in the root stack, so once the map is open the favourites route is no longer behind us. Now navigates explicitly to `/favorites?folder=N`, and the favourites screen reopens that folder.

### Species not in the local checklists → look it up on GBIF

- When a search finds nothing locally, a **"Look up on GBIF" button** appears (on demand — no per-keystroke API traffic, and nothing to wait on in the field with no signal). Candidates show scientific name, author, rank, hierarchy, GBIF vernacular name and synonym status.
- On pick, **the accepted name GBIF returns is matched against the local checklists first**; a hit keeps the local id, because a Taiwanese species must never carry a GBIF id or the same organism ends up with two identities. Only a genuine miss mints a `g{usageKey}` external taxon, with the Chinese common name prefilled from GBIF's vernacular names (Chinese preferred) and editable when GBIF has none.
- The batch importer's "not found" list is tappable into the same flow.
- **Prerequisite fixes**: `searchByTaxonId` did not understand `g…` ids (they were queried against the TaiCOL table and returned null), so an external taxon in a favourites list could not be opened or added to a record and `importFromRecord` discarded it as unresolved — seven existing breakages fixed at once. `external_taxa` was also absent from the search path (it lives in user.db while the checklists live in twnamelist.db, and the app never ATTACHes), so a species the user had just added still could not be found.
- Also fixed: `findExternalTaxonIdByName` matched on name alone (the bundled DB holds 72 cross-kingdom genus homonyms, so two different organisms could collapse onto one `taxon_id`); `upsertExternalTaxon` updated `source` without `source_key`, leaving rows claiming to be an unrelated GBIF taxon — with the index built over that claim.

### New automated checks

- `npm run check:roundtrip` — DB-shaped fixture → yml → parser, compared field by field, plus a coverage assertion (adding a column and forgetting the exporter fails it). It immediately caught js-yaml parsing an unquoted `startedAt` into a `Date`.
- `npm run check:names` — the name-increment rule. It immediately caught the default checklist name `YYYY-MM-DD HH:MM` being "incremented" to `14:60`.
- `npm run check:gbif` — GBIF response parsing (vernacular language priority, rank filtering, synonym accepted names, malformed bodies), with no network.

---

## 2026-08-30: Mobile — Tech Debt, iNaturalist/GBIF, Favourites Management, Herbarium Labels

### Tech debt (verified against the user's real `user.db` — 917 rows / 16 tables, zero drift per table)

- **`clearAllUserData()` bricked the app permanently** (worst of the batch): it DROPped 8 of 16 tables, then replayed migrations from v1 — and no `ADD COLUMN` had an existence check, so v6 threw `duplicate column name`, `schema_version` stuck at 5 against v22 code, and the next launch showed a red "initialisation failed" screen **with no path to backup restore**. Reinstall was the only way out. Replaced with delete-the-file-and-rebuild (the already-proven `restoreBackup` route); all 30 `ADD COLUMN` statements now go through `addColumnIfMissing()`.
- **Deleting a project made sites and collection trips "disappear"**: `deleteProject` covered 2 of the 4 tables with an FK to projects, and those two list queries use an INNER JOIN — so the data was still in the DB but gone from the lists. Fixed in three places (complete the reassignment, LEFT JOIN, orphan repair).
- **Turned `PRAGMA foreign_keys = ON`**: until now every `ON DELETE CASCADE` in the schema was inert. Ordering matters: OFF during migrations (v3's `ALTER TABLE sites RENAME` would otherwise cascade away every plot's `site_id`), OFF during cleanup (dangling references would throw instead of being repaired), ON afterwards.
- **UUIDs moved to SQLite's CSPRNG**: two byte-identical `Math.random` implementations were minting DwC `occurrenceID`s, and Hermes' `Math.random()` is a non-cryptographic PRNG with unspecified seeding. Runtime and migration now use the same `randomblob` source. 20,000 samples, zero collisions.
- **Automatic safety backup** before any repair that rewrites existing rows (`VACUUM INTO`), plus a restore entry in the backup screen — the snapshot lives in the app's private directory, so without that entry the backup exists but cannot be restored.
- Added `npm run check:i18n` (833 keys against both locales). Lint errors 1 → 0.

### iNaturalist / GBIF: draw an area → species list

The app's **first network feature** (zero HTTP anywhere in mobile before this). Four phases; the first two deliberately touch no network, to retire the architectural risk first.

- **Identity rule, three tiers, order not negotiable**: TaiCOL `t…` → Japan `y…` → only then mint an external `g…`/`gi…`. The same species always keeps the local id, or one organism ends up with two identities and records, exports and statistics split.
- Migrations **v23** (two-level favourites), **v24** (`external_taxa`, in user.db rather than the bundle DB — the latter is re-copied wholesale whenever its hash changes), **v25** (a list remembers the area it came from).
- Measured match rates: Yangmingshan 97%, Kenting 98%, Kinabalu 17%.
- **`/species/match` turned out to be worth something other than planned**: the plan assumed it would resolve synonyms back into the local checklist; measured over 211 unmatched names it rescued **zero** (phase 2 already walks TaiCOL's own synonym rows). Its real value is supplying identifiers — 211/211. The UI copy was rewritten rather than claim something measured at zero.
- **Connectivity detection without a native module**: the two services HEAD-probe each other; only if both fail do we say "offline".
- Potholes: RN's `URLSearchParams` has no copy constructor (the bbox was silently dropped, turning it into a global query); `LOWER(simple_name) = ?` cannot use an index (67 ms/name → `IN (?,?,?)` at 0.09 ms, **774×**); GBIF geometry 400s (now always falls back to the bounding box and says so); GBIF **HTTP 429** actually hit (concurrency lowered, backoff added).
- Added `npm run check:kav`: a `KeyboardAvoidingView` call site without a sizing className resolves to zero height — the screen dims, swallows every touch, and offers no cancel.

### Favourites management + herbarium labels (.docx)

- Swipe-delete, multi-select delete and export (docx / csv) at the list level. The default list cannot be deleted — it is where quick-add lands.
- Export **reuses** rather than reimplements: the half of `recordToMarkdownItem` that carries no observation data was extracted, so favourites run the identical `generateMarkdown` → `markdownToDocx` pipeline.
- **All docx output switched to A4** (an empty `sectPr` had been inheriting Word's US Letter default). Verified by compiling before and after, feeding both the same Markdown, and diffing the unzipped `document.xml` — **every byte outside `sectPr` identical**.
- Herbarium labels: A4, 2 columns × 5 rows, dashed cut lines, and **no new dependency** (`docx.ts` was already a hand-written OOXML writer). Migration **v26** adds `identified_by` (DwC `identifiedBy`); existing specimens stay NULL rather than inheriting the collector — that would assert a determination somebody never made.
- **Only 4 labels per page on device**: row height was `lineRule="auto"`, i.e. font-determined, and that machine has no 標楷體; the substitute font's line ratio pushed each row past its budget. The fix was not another guessed number but making height independent of the font (an explicit `atLeast` value per size).
- Collection numbers **cannot be compared as strings** (`DAO0010` sorts before `DAO0009`) — sorting now uses the existing numeric-tail column.

---

## 2026-08-29: Mobile — Specimen Collection, EXIF Repair, Checklist Updates, Search Ranking

### Specimen collection — a third kind of record

Alongside checklists and plot surveys: collection-number series, collector / determiner, and an editable detail sheet (date and time split into two fields, coordinate accuracy, rename, duplicate, re-identify). **Collection deliberately sits outside the app-wide single-active invariant** — starting one must never end a checklist or plot survey in progress.

- **Duplicate collection-number detection** (there was none): every automatic path is now collision-free by construction, so typing one by hand is the only way in — and that path warns and offers the next free number. **No UNIQUE constraint**: duplicate sheets sharing a number, and imports of legacy data, are both legitimate.
- **Duplicating a specimen carries only the taxon and the collector**: locality, coordinates, phenology, remarks and photos are deliberately blank — they describe one physical gathering, and inheriting them silently would attach the previous specimen's description to a different plant.

### Photo EXIF repair (iOS-only; affected existing checklist and plot photos too)

Reported as "photo metadata differs from the camera's — lens and focal length are blank". Confirmed by reading `expo-image-picker`'s iOS source: `quality < 1` routes through `UIImage.jpegData()`, **which produces a JPEG with no EXIF at all** — Make / Model / LensModel / FocalLength / ISO / DateTimeOriginal were gone before our piexif ever saw the file. Android was unaffected (it has `copyExifData`).

The fix feeds back `asset.exif`, which the picker had been returning all along and the codebase had never read. It **only fills gaps, never overwrites**, which makes it a no-op on Android with no `Platform.OS` branch. Plot environment photos were fixed at the same time (they had never gone through piexif at all — previously logged as a "known limitation", actually the same bug).

### Japan checklist switched to the JBIF wamei checklist (merged, not replaced)

`ylist_names` 20,103 → **`jp_names` 25,839** rows; synonymous Japanese names 0 → **6,711 taxa**.

The request was "replace YList with wamei", but wamei covers vascular plants only and carries no conservation or origin attributes; a straight replacement would have silently lost 1,909 bryophytes, 786 endemics, 1,719 IUCN and 8,780 naturalisation notes. So wamei became the Japanese-name layer with YList filling in bryophytes and the attribute columns. The payoff: wamei is **CC BY 4.0** (the YList copy's licence was unclear).

**Hard requirement: not one of the 19,851 existing taxon_ids may be lost** — records persist taxon_id, and a failed lookup renders blank rather than erroring, so the user would never know their old records had broken. The first dry run deduplicated by `sci_norm` and ate 252 ids; switching the second pass to compare by taxon_id preserved all of them. **Only a row-by-row comparison against the pre-import id list catches this** — the total row count went *up*.

### TaiCOL updated to the 2026-08-26 release (251,540 → 269,824 rows)

The importer **DROPs the table and commits before it opens the CSV for the first time**, so three *silent* failure modes were ruled out beforehand: a BOM would import 0 rows without an error; a renamed column would turn 250k rows of that field into NULL; a changed value domain would make 20+ hard-coded queries return nothing.

Along the way: a **`LIKE 't00%'` blind spot**. The auto-repair for identification-key taxon_ids was written when every TaiCOL id was `t00xxxxx`; the largest is now `t0124636`, so 161 of 5,800 references **were warned about but could never be repaired**. Changed to `GLOB 't[0-9]*'`.

### Exact vernacular matches first + taxonomy-tree scrolling

- **The main search's `LIMIT 100` had no `ORDER BY`**: whether the exact row made the cut depended on SQLite's scan order, i.e. rowid — which changes every time the bundle DB is rebuilt. That is the mechanism behind "it used to find this and now it doesn't". 7 of 47 single-character vernacular names were being truncated away. **Not fixed with `ORDER BY`** (measured: a single Latin letter matches 200k rows, 0 ms → 89 ms); a second index-served equality query fetches the exact rows in under 0.1 ms.
- **`getItemLayout` was not pure**: it summed a Map that every row's `onLayout` mutated, while RN requires it to be pure in `(data, index)`. Row heights were also deliberately underestimated, so the error was a per-row bias multiplied by the target index — the more the tree was expanded, the further off it landed, which is what made this "fixed, then broken again". Replaced with a memoised prefix-sum table (also turning O(n²) into O(1)).
- **But the real symptom was that the scroll target itself was wrong**: `RANK_ORDER` stopped at genus, so the target was the *genus* node — and with 550 species under `Carex`, a name sitting at #300 was never going to be visible. **Lesson: scroll bugs need "the maths is right" and "the target is right" verified separately.**

### The bottom search box under the keyboard — third time, so it is now enforced in code

`KeyboardStickyView`'s offset exists to cancel out the chrome *below* the dock. Copying another screen's `insets.bottom` without also copying its `SafeAreaView` root meant that value pushed the search box **down into the keyboard** — worse than not setting it. The memory file already described this exact mistake verbatim: **the documentation was right and did not prevent it.** Added `npm run check:dock`, which checks that each offset is paired with the chrome that justifies it, and both historical mistakes were replanted to confirm the check catches them.

---

## 2026-06-12: Mobile — UI i18n (en / zh-TW), Inline Editable Location Map

- **Full i18n migration** (~55 files): `i18next` + `react-i18next`, 803 keys at parity across both locales. Data labels changed from `const` to functions returning `i18n.t()` so they update when the language switches. Dates are ISO 8601 throughout (language-neutral), replacing `toLocaleString` hard-coded to `'zh-TW'`.
- **Export content deliberately does not follow the UI language**: statically confirmed that `markdown.ts` and `bundleExport.ts` contain zero i18n references.
- Potholes: `expo-localization` crashed at startup → device locale now read from RN core modules (**do not** use Hermes' `Intl.resolvedOptions().locale`; some builds always return `en-US`). The taxonomy tree's "Kingdom" stayed English after switching, because `i18n.t()` had been baked into a long-lived cache → the data layer now stores language-neutral keys and translates at render.
- **Inline editable map** in the record detail and plot species screens, so a coordinate can be corrected without a trip to the map tab; zoom / locate / basemap / fullscreen.
- Pothole: **`SafeAreaView` reports zero inset inside a `Modal`** (a Modal is its own native view hierarchy and cannot see the provider), so the header sat under the notch. **Rule: inside a Modal, always apply insets manually via `useSafeAreaInsets`.**

---

## 2026-06-07: Mobile — Subplots, Plot Round-trip Import, Export Settings & docx, Favourites & Backup

- **Subplots** (migration **v18**): the layer definition stays shared at plot level; a subplot only carries cover/height and species. A subplot is an internal dimension of a plot and **does not compete for the single-active slot**. Export gains `eventID` / `parentEventID` and a `subplots.csv`.
- **Plot round-trip import**: the plot yml grew from three fields to a full schema (uuid + all metadata + coordinates/terrain/cover/track + layers + subplots + species), with overwrite-by-uuid or save-as-new; an imported plot always lands `status='done'` so it cannot hijack the active record.
- **Export settings**: selectable classification levels and conservation columns (matching desktop); docx uses 標楷體 for Chinese and Times New Roman for English, indents per level, and prints higher-rank vernacular names ("鴿形目 (Columbiformes)").
- **Export progress UI**: a full-screen overlay replaces a one-line toast, drawn before the synchronous zip freezes the thread. Pothole: the overlay is a Modal, and **a share sheet cannot be presented while a Modal is dismissing** (silently no-ops on iOS) → wait 450 ms.
- **Favourites + backup/restore** (v14): a favourite-species list, plus DB backup and restore (`VACUUM INTO` + `reloadAppAsync`).
- **Default surveyors** (v15): maintained in preferences and filled into `recordedBy` at record creation.
- **`occurrenceID` per species record** (v16, uuid); per-layer cm/m height unit (v17, canonical storage stays cm).

---

## 2026-06-06: Mobile — Point-count Surveys (v13), Voice Batch Import, Search & Navigation Fixes

- **A third survey method, point_count** (migration **v13**, fully additive): static GPS + radius, individual counts, reusing the `'T'` bucket. Three helpers (`isStratified` / `usesTrack` / `requiresStaticGps`) replaced roughly 15 scattered `plot_type` branches.
- **Per-record coordinates and detection type** (seen / heard / flying), plus export completion — everything the user can enter is now exported (notes and the four DwC attributes in yml, detectionType and coordinates in sp.csv, plot `points.geojson` implemented).
- **Voice batch entry** with a toneless-pinyin homophone layer (`pinyin-pro`) — dictation mangles uncommon names into homophones, and the phonetic flag is enabled only for the voice path.
- **"Add to current record" routed wrongly**: the species card's add button always landed in a quick checklist, and with an active plot survey it **ended that survey via single-active and opened a checklist instead**. Extracted a shared `useAddToActiveRecord` hook (active plot wins) and moved all three entry points onto it.
- **Taxonomy jumps never landed**: the jump was consumed while the taxonomy screen was still in the background (the FlatList had not laid out, and the failed scroll cleared the request without retrying). Now consumed only after `useIsFocused()`, and the keyboard is dismissed before navigating so `KeyboardStickyView` does not latch at keyboard height.

---

## 2026-05-22: Mobile — Plot Layers Generalised (1–6), Environment Photos, DwC Attribute Export

- **Migration v12**: a new `plot_survey_layers` table (per-layer cover/height/method), a 1–6 `layer_count` stepper, and `env_photos_json`. `plot_species_records.layer`'s CHECK moved from `E0–E3` to `E1–E6`, rebuilding the table and shifting existing values up by one (E0 moss → E1); the ecological meaning is unchanged.
- Labels fixed as E1 moss / E2 herb / E3 shrub / E4 understory tree / E5 main canopy / E6 emergent.
- The plot screen's three tabs (environment / species / layers) collapsed to two, with layers folded into environment.
- **Environment photos**: camera, library and a fullscreen viewer; renamed to `${plotid}_YYYYMMDD_env-${N}` on export.
- **DwC attributes added to every export format** (sex / lifeStage / reproductiveCondition / leafPhenology).
- The legacy `e0_*..e3_*` columns were kept deliberately as a rollback window (dropped in v13).

---

## 2026-05-11 – 05-21: Mobile — v0.1 (MVP → vegetation plot surveys)

Mobile is a **separate codebase** from the desktop app (Expo SDK 54 + React Native 0.81 + TypeScript strict + Expo Router + NativeWind + Zustand + op-sqlite) with its own architecture, UI conventions and build pipeline. What follows is the initial build through phase 3; per-sprint detail is in `mobile/Plan.md`, and the potholes in `mobile/Update_log.md`.

### Data layer and search

The TaiCOL checklist ships as a bundled DB (copied from the asset into documentDirectory on first launch, re-copied when Metro's `asset.hash` changes), with search, fuzzy matching and synonym resolution ported from desktop and working entirely offline. Includes the 台/臺 swap, exact-vernacular-first ranking, and the `≡` (synonym) / `~` (fuzzy) markers.

### Records

- **Checklist (session)**: lightweight species records with remarks, photos, sorting, multi-select delete, a stale-session prompt the next day, and reopening after ending.
- **Plot survey**: fixed plots (per-layer cover/height/method) and transects (GPS track, with the watch at module level so switching tabs never interrupts it). **Abundance was generalised** to DwC `organismQuantity` / `organismQuantityType` (Braun-Blanquet / % cover / individuals / DBH / custom), and **DwC species attributes** are shown per kingdom and class.
- **Single-active invariant**: at most one record in progress app-wide, with a UI gate, a DB-layer safety net, and a cleanup pass at startup.

### Map and geographic sites

Full-bleed map (Apple Maps on iOS, Google Maps on Android), multiple basemaps, 85 Academia Sinica WMTS overlays, address search, drawing points/lines/polygons as "geographic sites" (v2/v3, including Multi\* geometry), GeoJSON / KML / GPX / WKT import and export, and binding a checklist to a site.

### Photos

Species metadata is embedded into EXIF/IPTC at capture (ImageDescription + a UserComment JSON blob), saved to Photos.app, with the URI stored in `photo_paths`. A UTF-8→Latin1 byte trick fixes Chinese turning into `????`.

### Taxonomy tree and identification keys

Kingdom → phylum → class → order → family → genus → species with lazy loading, persisted expansion state, and auto-expand-and-scroll after a search; plus an offline dichotomous-key runner (breadcrumb, step-by-step couplets, terminal taxon card).

### The cross-platform rule, settled here

`Alert.prompt` and `ActionSheetIOS` are both iOS-only, so everything goes through two imperative APIs (`promptText()` / `showActionSheet()`) backed by host components mounted at the root. **Writing platform branches with `Platform.OS === 'ios'` is forbidden** — the earlier `Alert.alert` fallbacks were repeatedly found to have fewer options or degraded behaviour on Android.

### Two incidents worth recording

- **Nested Modals on iOS**: three levels hang, and colliding a present with a dismiss in the same tick crashes outright. Settled on dismiss → await the animation → present.
- **Chinese input crashed Hermes' GC** (`EXC_BAD_ACCESS`): the root cause was a bundle DB update that skipped rebuilding `cname_fuzzy_index`, so every query threw `no such table` and the uncaught exception fired repeatedly inside the debounce `setTimeout` until GC fell over. Fixed by rebuilding the index, having `fuzzy.ts` detect the missing table and degrade gracefully, and writing "updating the bundle DB means rebuilding the fuzzy index" into `make mobile-db` and `CLAUDE.md`.

---

## 2026-04-12b: User Profile DB, Project Management, Table Filters

### User Profile + Checklist DB
- **Triple DB architecture**: `twnamelist.db` (TaiCOL, read-only) + `user_profile.db` (preferences) + `checklists.db` (multi-project checklists)
- **Storage**: dev mode → `backend/`, packaged → user app data dir (macOS `~/Library/Application Support/`, Windows `%LOCALAPPDATA%/`)
- **`db.py`**: `_get_data_dir()` auto-detects, `init_user_dbs()` creates schema on startup
- **`user_schema.py`**: `UserPreference` (key/value), `Project` (name/abstract/location/site/notes/WKT/GeoJSON), `ChecklistItem` (project_id FK + taxon_id + species_data_json + abundance)
- **`profile_api.py`**: Full CRUD — preferences get/set/bulk, projects CRUD, species add/bulk/delete, profile export/import (JSON), project geometries for map

### Project Management UI
- **Navbar project menu**: Dropdown with current project name, new/edit/save/load/delete
- **ProjectEditModal.svelte**: Popup for new/edit project metadata (name/abstract/location/site/notes), z-index fix for map page
- **`projectStore.ts`**: createProject, saveProject (diff sync), loadProject, newProject, deleteProject
- **`profileStore.ts`**: setPreference (localStorage + DB), getPreference, syncPreferencesFromDB, exportProfile/importProfile
- Map page "細節" tab changed to read-only display (edit from navbar)

### SpeciesTable Enhancements
- **Rank column**: New toggleable column showing Species/Subspecies/Variety/Form
- **Rank filter**: Dropdown to filter by taxonomic rank
- **Group filter**: Filter by kingdom/class/order (with common names), cascading to family filter
- **Family filter**: Shows `Lauraceae (樟科)` format (Latin + common name)
- **Placeholders**: "選擇高階分類群" / "選擇科別" / "全部階層"

### Batch Import Progress
- LoadYAMLButton: Progress bar during batch text import (N/M with %)
- `await setTimeout(0)` yield for UI re-render between items
- Fixed `entry.id` → `entry.taxon_id`

## 2026-04-12: Map Overhaul, Batch Add, Autonym s.l./s.str., Type Cleanup

### Map Editor Redesign
- **Full-screen layout**: Map fills `calc(100vh - 64px)`, no page chrome
- **Right-side panel**: Hamburger menu (☰) → tabbed panel (細節/底圖/匯入/匯出), replaces all Modals (z-index issues with Leaflet)
- **Basemap selection**: OSM / 衛星影像 (Esri) / 衛星+地名標註 Hybrid (Esri)
- **Academia Sinica WMTS overlay**: 85 historical maps as transparent overlay (not basemap replacement), with opacity slider (0-100%), searchable list. Uses RESTful tile URL (`file-exists.php?img={LAYER}-png-{z}-{x}-{y}`), not KVP WMTS (returns 500). Layer list pre-built as static `sinicaLayers.ts`
- **View state persistence**: Map center/zoom/basemap/overlay/opacity saved to localStorage (`map_view`), restored on page revisit
- **Metadata fields**: Added projectAbstract, locationDescription, siteNotes to metadataStore (persisted to localStorage)

### Batch Add to Checklist
- **`GET /api/taxonomy/species_count`**: Count species under a taxon group with filters
- **`GET /api/taxonomy/species_under`**: Full species data (same format as search API) for batch add
- **Filters**: endemic, alien_type, redlist, cites, protected
- **BatchAddModal.svelte**: Confirmation flow — >500 warns, >5000 shows limit notice. Progress bar. Dedup via taxon_id Set
- **Taxonomy tree**: "+批次加入" button on hover for all non-species nodes
- **SearchBox**: "+批次加入" button when "限定特定分類群" is set

### Autonym s.l./s.str. Labels
- **Backend**: `_is_autonym()` detects infraspecific epithet == specific epithet; `_mark_sensu_lato()` batch-checks DB for species with infraspecific taxa
- **Search API**: Returns `is_autonym`, `is_sensu_lato`, `rank` fields
- **Taxonomy tree**: Species with infraspecific → "s.l. (廣義)"; autonym → "s.str. (狹義)". Removed opacity-50 autonym styling
- **Export**: s.l./s.str. in italic after scientific name (`*s.l.*` / `*s.str.*`)
- **SpeciesDetailPanel**: Labels shown after scientific name

### Export Fixes
- **Pandoc compatibility**: Species use flat ordered list (no nested markdown lists). Family uses bold paragraph `**1. 科名** (N)`
- **Indent**: 4-space indent for species under family groups
- **Levels auto-sort**: `LEVEL_ORDER` enforces correct hierarchy regardless of user selection order
- **Multi-group dedup**: When levels include the same rank as group detection (e.g. class_name + Aves group), skip duplicate level

### ChecklistItem Type Cleanup
- Redefined `ChecklistItem` to snake_case matching search API response
- Removed `addSpecies()` dead code
- Removed 5 `as any` type workarounds
- DwC camelCase only in dwcMapper for export

### Regression Test Suite
- `tests/regression_species.json`: 54 species (8 groups × 5 + 7 special attributes × 2)
- `tests/test_regression.py`: 15 pytest tests (search/export/taxonomy/data integrity)
- `make test` in Makefile
- SQLite VACUUM added to taicol_import.py post-import

### Development Rules
- Added scope guidance rule to CLAUDE.md + memory
- Added venv path rule to memory
- Added export strictness rule to memory

## 2026-04-11e: Export Overhaul, Admin UX, cultured→圈養

### Export Format Changes
- **Species order**: 學名 → 俗名 → 特有性/來源 → 保育狀態（was 俗名 → 學名）
- **Conservation separator**: 分號分隔 `NLC; IUCN:LC; CITES:II; 保育類:III`（was 空格）
- **圈養 symbol**: 動物 `cultured` → `‡`（圈養），植物 → `†`（栽培）。Header 加「‡ 代表圈養種」
- **Conservation stats in header**: 自動統計物種屬性（特有種/原生/歸化/栽培/圈養）+ 保育統計（依勾選：紅皮書/IUCN/CITES/保育類），排除 LC/NLC/NE/NA 安全等級
- **CSV export**: 新增「匯出 CSV (DwC)」選項，欄位名用 Darwin Core terms（UTF-8 BOM）
- **`_enrich_checklist()`**: 匯出前統一從 DB 補齊舊資料缺少的 `*_c` common name 欄位（所有格式：YAML/CSV/MD/DOCX）

### Backend Mapper (mapper.py)
- Expanded to 36 DwC field mappings: `kingdom_c→kingdomVernacularName`, `phylum_c→phylumVernacularName`, `class_c→classVernacularName`, `order_c→orderVernacularName`, `cites→CITES`, `protected→protectionStatus`, `is_hybrid→isHybrid`, `alien_status_note→establishmentRemarks` etc.

### Search API — cultured → 圈養/栽培
- `_map_alien_type()`: `cultured` + `kingdom=Animalia` → `圈養`，otherwise `栽培`
- Frontend: SearchBox, SpeciesDetailPanel, TaxonTreeNode, TaxonSpeciesPopup all handle `圈養` badge

### TaiCOL URL
- SpeciesDetailPanel: TaiCOL link changed from keyword search to direct taxon URL `taicol.tw/zh-hant/taxon/{taxon_id}` (fallback to keyword search if no taxon_id)

### Admin Editor UX
- **CITES**: Changed from text `<Input>` to `<Select>` dropdown: I (禁止商業貿易), II (限制貿易), III (個別國家列入), I/II, NC (非列入)
- **alien_status_note**: Changed from single text input to list-based management — dropdown (native/naturalized/invasive/cultured) + citation input + 「新增」button. Listed below with delete ✕. Type validates against species' `alien_type` (mismatch shows warning). Stored as `type: citation|type: citation` format
- **Alt name drag-and-drop**: Drag alt name → drop on primary name field to swap. Drag between alt names to reorder. Drag handle `⠿` with blue highlight feedback
- **Select placeholders**: All dropdown selects (原生/歸化, 紅皮書, IUCN, CITES, 保育類) removed empty `—` option, use `placeholder="選擇..."` instead
- **AdminAddModal step 2**: Taxonomy levels filtered by rank — creating a Family only shows Kingdom→Order (not Genus). `RANK_TO_LEVEL` mapping handles sub-ranks (Subfamily→family, Suborder→order etc.)

### Key API
- `_load_genera()`: Scans directory on every call (no cache) — new key files detected without server restart
- Key popup + SpeciesDetailPanel: Added attribution「資料來源：臺灣維管束植物簡誌」

## 2026-04-11d: Taxonomy Tree — Virus Realm Hierarchy, Autonym, Key Popup

### Virus Realm Hierarchy
- Top-level taxonomy now shows viruses as a single "病毒 Viruses" node (`rank_key=viruses`)
- Expanding viruses shows 6 Realm nodes (Duplodnaviria, Monodnaviria, Riboviria, Ribozyviria, Varidnaviria, Viruses realm incertae sedis)
- Expanding a Realm shows its Kingdom children, then normal hierarchy (phylum → class → order → family → genus)
- `VIRUS_KINGDOM_TO_REALM` mapping table in taxonomy_api.py
- Taxonomy search path includes Viruses → Realm prefix for virus species

### Infraspecific Taxa + Autonym Handling
- Taxonomy tree species list now includes Subspecies, Variety, Form (was Species-only)
- Stats count: "N種 M種下" — species_count uses `rank='Species'` only, infraspecific_count separate
- Autonym detection: infraspecific epithet == specific epithet → marked `is_autonym: true`
- Frontend: autonym rows displayed at `opacity-50` with "(Variety, autonym)" label
- Search API already had nominal infraspecific dedup (line 376-392), no change needed

### Identification Key Popup
- `KeyPopup.svelte` (new): centered popup showing dichotomous key text from `/api/key/{genus}`
- `keyStore.ts` (new): fetches `/api/key` (623 genera) once, stores as `availableKeys: Set<string>`
- Genus nodes with available keys show amber "檢索表" badge button
- Popup uses flexbox centering (`fixed inset-0 flex items-center justify-center`)

### Popup Centering Fix
- `TaxonSpeciesPopup.svelte` and `KeyPopup.svelte` changed from `translate-x/y` to flexbox wrapper for reliable centering regardless of DOM nesting depth

### Node Display Cleanup
- Removed redundant rank label text from node names (rank already shown in Badge)

## 2026-04-11c: Taxonomy Tree Enhancements

### Taxonomy Tree — Species Popup + Add to Checklist
- **TaxonSpeciesPopup.svelte** (new): Click any species in taxonomy tree → centered popup with full detail (fetched via `/api/search` + `/api/synonyms`): species status badges, conservation status (redlist/IUCN/CITES/protected with IUCN colors), taxonomy info, synonyms list. Bottom sticky button: "加入名錄" or "已在名錄中"
- **Quick add**: Hover on species row → "＋加入" button appears (right-aligned, opacity transition). Directly searches API and adds to store without opening popup
- **Checklist indicator**: Species already in checklist show green "✓ 已加入" (always visible, reactive to `$selectedSpecies` store)
- **Protected badge**: Added `protected` badge display in species list rows

### Taxonomy Tree — Search Scroll-to-Target
- Search result selection now **scrolls to the target node** after expanding the path (`scrollIntoView({ behavior: 'smooth', block: 'center' })`)
- New `scrollTarget` prop passed through tree hierarchy, triggers scroll when matching node renders

### Taxonomy Tree — Persistent Expanded State
- **taxonomyStore.ts** (new store): `expandedNodes: Set<string>` backed by localStorage (`taxonomy_expanded` key)
- Each node checks `$expandedNodes` on mount → auto-expands if previously opened
- `toggle()` calls `markExpanded()` / `markCollapsed()` to persist state
- "全部收合" button clears localStorage via `clearAll()`
- Children cache preserved on collapse (re-expand doesn't re-fetch)
- Navigating away and back restores full tree state

### Backend — Taxonomy API
- `taxonomy_api.py`: Removed hardcoded dictionaries (KINGDOM_NAMES, PHYLUM_NAMES, PLANT_CLASS_NAMES), now reads `kingdom_c`, `phylum_c`, `class_c`, `order_c` directly from DB via `RANK_C_COL` mapping + `MAX()` aggregate
- `_get_species_list()`: Added `protected` field to response
- `taxonomy_search()`: SELECT now includes `kingdom_c`, `phylum_c`, `class_c`, `order_c`

## 2026-04-11b: Species Table Overhaul, Conservation Status, TaiCOL Import Redesign

### Species Table (SpeciesTable.svelte)
- **ID → TaxonID**: All components now use `taxon_id` (TaiCOL taxon ID) instead of `id` (internal name_id)
- **Column visibility**: User-configurable columns via dropdown (persisted to localStorage)
- **Conservation columns**: 臺灣紅皮書 (redlist), IUCN, CITES, 保育類 (protected) — each with colored badges
- **Compact layout**: Reduced padding (`px-2 py-1`), `text-xs`, `overflow-x-auto`

### Conservation Status
- **Admin editor**: Fixed redlist options (EX/EW/RE/NCR/NEN/NVU/NNT/NLC/DD/NA/NE), IUCN options (EX/EW/RE/CR/EN/VU/NT/LC/DD/NA/NE), new `protected` dropdown (I/II/III/文資法)
- **New field: `protected`** (保育類等級 I/II/III + 文資法珍貴稀有植物 `1`). Full stack: schema → DB → import → search API → admin → table → detail panel → export
- **New field: `is_hybrid`** (雜交種). Full stack same as above
- **Export settings**: Conservation status checkboxes (redlist/IUCN/CITES/protected) control what appears in Markdown/DOCX export

### TaiCOL Import Redesign (taicol_import.py)
- **Two-file import**: Now accepts both name CSV (primary) and taxon CSV (supplementary). Taxon CSV auto-detected from same directory if not explicitly provided
- **API change**: `POST /api/admin/import-taicol` now accepts `name_file` (required) + `taxon_file` (optional) as multipart form fields
- **Admin UI**: Two file upload inputs (name CSV + taxon CSV) with separate descriptions
- **Backfill**: `_backfill_from_taxon_csv()` uses `taxon_id` as foreign key to fill 21 fields (common names, taxonomy hierarchy common names, conservation status, etc.)
- **New DB fields**: `kingdom_c`, `phylum_c`, `class_c`, `order_c`, `protected`, `is_hybrid`
- **NAME_FIELD_MAP**: 36 fields mapped from name CSV columns to model fields

### Taxonomy Common Names
- **New fields**: `kingdom_c`, `phylum_c`, `class_c` (from name CSV + taxon CSV backfill)
- **taxonomy_api.py**: Removed hardcoded dictionaries (KINGDOM_NAMES, PHYLUM_NAMES, PLANT_CLASS_NAMES), now reads `*_c` columns directly from DB via `MAX()` aggregate
- **export.py**: `_get_field_display()` outputs "common name (Latin name)" format for all hierarchy levels (kingdom/phylum/class/order/family/genus)
- **Coverage**: kingdom_c: 8, phylum_c: 71, class_c: 197, order_c: 786 distinct values

### External Links
- `isPlant` check simplified to `kingdom === 'Plantae'` only (was also checking phylum/pt_name)
- Non-plant species no longer show IPNI, POWO, 台灣植物資訊整合查詢

### Old YAML Compatibility
- `dwcMapper.ts`: `taxon_id ↔ taxonID` mapping (was `id ↔ taxonID`). Auto-detects legacy numeric IDs
- `importer.ts`: `migrateLegacyItems()` searches by scientific name, auto-migrates exact matches, shows `MigrationSelector` popup for ambiguous matches
- `importState.ts`: New `migrationStore` for migration state

### Naming Convention
- `_backfill_common_names` → `_backfill_from_taxon_csv` (reflects actual scope)
- `_get_chinese_name` removed (was hardcoded, now reads from DB)
- Comments use "common name" instead of "中文名" in function-level documentation

## 2026-04-11: Admin DB Management, QA Checks, Species Fields, Identification Keys

### Admin Name Management (`/admin` → 名錄管理 Tab)

- **Search + Edit**: Search by common/scientific name → load full record → edit with diff preview + confirmation popup → audit log (`admin_audit` table)
- **Cascade**: Changing `usage_status` to `accepted` auto-detects existing accepted name → popup to choose `not-accepted` or `misapplied` for the old one → atomic update
- **Add New**: 4-step modal: (0) check-similar (exact + fuzzy matching) → (1) basic info (auto-parse scientific name + rank from suffix) → (2) taxonomy hierarchy (cascade autocomplete + auto-fill parent levels) → (3) vernacular name + status + references
- **Taxonomy Move**: Graft a taxon under a different parent (e.g., move genus from family A to family B). Preview affected records → confirm → batch update all child records' hierarchy fields
- **References**: `name_references` table linked by `name_id`. CRUD API + display in species detail panel
- **Rank autocomplete**: 42 ranks from DB, searchable input
- **Field visibility**: Family Chinese name only shown at Family rank; Genus Chinese name only at Genus rank; conservation fields only at Species level and below
- **is_in_taiwan lock**: If a taxon has children present in Taiwan, the "現存於臺灣" checkbox is locked (greyed out)
- **Taxonomy breadcrumb links**: Each level in the hierarchy path is clickable → navigates to that taxon's edit page

### Data Quality Checks (`/admin` → 資料品質 Tab)

- **9 automated checks** (Phase 1):
  - A1: Missing hierarchy fields (15 records)
  - A2: Hierarchy gaps (0)
  - A3: Orphan taxon_id — no accepted name (1)
  - A4: Multiple accepted per taxon (0)
  - B3: Duplicate scientific names (80)
  - B5: Inconsistent common names (0)
  - B6: Empty common names for accepted species (20,531)
  - D1: Inconsistent hierarchy values (0)
  - D3: Inconsistent Chinese family names (0)
- **Export**: Per-check CSV download + full report DOCX (via Pandoc)
- **Navigation**: Click `name_id` in QA results → jump to name editor

### New Species Fields (from TaiCOL CSV)

- `nomenclature_name`: ICN / ICZN / ICNP / ICVCN — used for export formatting (ICZN → zoological trinomial, others → botanical with var./subsp.)
- `cites`: CITES appendix I/II/III (5,789 records)
- `is_fossil`, `is_terrestrial`, `is_freshwater`, `is_brackish`, `is_marine`: habitat tags
- `alien_status_note`: source references for alien type determination (displayed as table, split by `|`)
- All fields displayed in species detail panel + editable in admin

### Species Detail Panel Redesign

- **Block 1 — 物種狀態**: Native/endemic badges + habitat tags + source references (tabular) + nomenclature code
- **Block 2 — 保育狀態**: Taiwan Redlist + IUCN + CITES (separate badges with official IUCN color scheme)
- **References section**: Between identification key and external links
- **IUCN color scheme**: EX(black), EW(purple), CR(red), EN(orange), VU(yellow), NT(yellow-green), LC(green), DD(grey). Taiwan redlist N-prefix auto-stripped for color matching (NVU→VU color, but NT kept as NT)

### Identification Keys (`references/key_to_sp/`)

- 623 genera, 7,060 lines of dichotomous keys
- `GET /api/key/{genus}` — returns key text; `GET /api/key` — lists all genera
- Displayed in species detail panel between synonyms and external links
- Bundled in PyInstaller packages

### Export Format by Nomenclature Code

- `format_scientific_name_markdown()` now accepts `nomenclature_name` parameter
- ICN/ICNP/ICVCN → botanical: `*Genus species* var. *epithet* Author`
- ICZN → zoological: `*Genus species epithet* (Author, Year)` (no infraspecific rank abbreviation)
- Markdown/DOCX export uses `redlist` (Taiwan) instead of `iucn_category`

### Code Review Skill

- `/checklister-code-review` — 35-check comprehensive review covering all API endpoints, routes, formatter, DB model consistency, and security

---

## 2026-04-09: System Tray, Icon Refresh, API Docs Fix, Pandoc Bundling

### System Tray Icon (`run.py`)

- Packaged app (PyInstaller) now shows a **system tray icon** (Windows taskbar / macOS menu bar).
- Right-click menu: "開啟 Checklister-NG" (open browser), "結束" (quit server).
- Double-click tray icon opens browser.
- Development mode (`python run.py`) is unaffected; tray only activates inside PyInstaller bundle.
- `--no-tray` flag to force disable.
- Dependencies added: `pystray==0.19.5`, `Pillow==11.1.0`.

### App Icon Refresh

- New app icon (`icons/checklister-ng_icons.png`) and monochrome tray icon (`icons/checklister-ng_trayicon.png`).
- `icons/gen_icons.py`: Generates `.ico` (Windows), `.icns` (macOS), and pre-scaled tray PNGs (16/22/32/44/64px) from source images.
- `make icon`: Runs `gen_icons.py`.
- Windows exe now has app icon (`checklister-ng.ico`); macOS app uses `checklister-ng.icns`.
- Tray icon uses platform-specific pre-scaled PNGs (Windows: 32px, macOS: 44px @2x) for crisp rendering.

### API Documentation Fix (`backend/main.py`)

- **Root cause**: The SPA catch-all route (`/{full_path:path}`) and `BaseHTTPMiddleware` intercepted `/openapi.json` and `/docs`, returning the frontend `index.html` instead of Swagger UI.
- **Fix**: Removed catch-all route and `BaseHTTPMiddleware`. Replaced with:
  - `app.mount("/", StaticFiles(...))` for frontend static files (lower priority than FastAPI routes).
  - `@app.exception_handler(404)` for SPA fallback (only triggers on true 404, not on `/docs`/`/openapi.json`).
- `/documentation` page: Removed duplicate navbar (page had its own navbar on top of the shared layout navbar).

### Pandoc Bundling Fix (Windows)

Moved from previous entry — now part of this release:

## 2026-04-09: Windows DOCX Export Fix (Pandoc Bundling)

### Pandoc Bundling Fix (`checklister_win32.spec`)

- **Root cause**: GitHub Actions CI uses `choco install pandoc` (Chocolatey). `shutil.which('pandoc')` returns the Chocolatey shim (~50KB redirect launcher), not the real pandoc binary (~80MB). The shim doesn't work inside PyInstaller bundle because it can't locate the actual executable. Local builds with `winget install JohnMacFarlane.Pandoc` install to `%LOCALAPPDATA%\Pandoc\` and don't have this issue.
- **Fix**: New `_find_real_pandoc()` resolves the actual binary by searching known paths (`chocolatey/lib/pandoc/tools/`, `%LOCALAPPDATA%\Pandoc\`, `C:\Program Files\Pandoc\`) and filtering by file size (>1MB) to distinguish real binary from shim. Covers both CI (Chocolatey) and local (winget) scenarios.
- Build-time log now prints the bundled pandoc path and size for verification.

### Windows Subprocess Fix (`backend/api/export.py`)

- Added `STARTUPINFO` with `SW_HIDE` for pandoc subprocess on Windows `console=False` mode, preventing potential failures when a windowed app spawns a console process.

### CI Verification (`.github/workflows/build.yml`)

- Added `where pandoc` + `pandoc --version` after Chocolatey install to verify pandoc availability in CI logs.

---

## 2026-04-09: Search Sort Fix, Taxon CSV Backfill, is_in_taiwan & Windows Fix

### Common Name Backfill from Taxon CSV

- TaiCOL name CSV has ~30% of accepted species without `common_name_c`, but the taxon CSV has them.
- `taicol_import.py` now auto-backfills missing common names from the taxon CSV (`TaiCOL_taxon_*.csv` in the same directory) after import, using `taxon_id` to match.
- Example: `Sedum morrisonense` (玉山佛甲草) was missing in name CSV but present in taxon CSV.
- Import output now reports `backfilled_names` count.

### is_in_taiwan Multi-value Fix

- Some records have `is_in_taiwan = 'true,true'` (multiple taxon_ids). Search queries changed from `== 'true'` to `LIKE '%true%'` across `search_api.py` and `taxonomy_api.py` to match these records.

### Search Sort Priority Fix

- Sort now uses raw `common_name_c` instead of display `cname` (which may include parenthesized alt names).
- New priority: common_name_c exact → scientific name exact → common_name_c contains → alternative_name_c exact → alternative_name_c contains → prefix → name length.
- Fixes: searching "玉山佛甲草" returns `Sedum morrisonense` first, not `Sedum cryptomerioides` (which has it as alt name).

### Taxonomy Backfill Expanded

- `_backfill_common_names()` now fills ALL missing taxonomy fields (family, family_c, kingdom, phylum, class, order, genus, genus_c, is_endemic, alien_type, iucn, redlist) from taxon CSV using `COALESCE(NULLIF(...))`.
- Fixes 42,349 records that had empty family/kingdom/phylum.

### RWD z-index Fix

- Search suggestion dropdown: `z-10` → `z-[9999]` to prevent being covered by detail view components on mobile.
- Sticky toolbar: `z-30` → `z-[100]`.

### Windows PyInstaller Fix

- `run.py`: Redirect `sys.stdout`/`sys.stderr` to `os.devnull` when `None` (Windows `console=False` crash fix).
- Check both `pandoc` and `pandoc.exe` for bundled binary path.
- `uvicorn` log level set to `"warning"` to reduce output.

---

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
