import csv
import os
import time
import sqlite3
from typing import Optional
from sqlmodel import Session, text
from backend.db import engine, sqlite_file_path
from backend.models.schema import TaicolName
from backend.utils.backup import backup_db


BATCH_SIZE = 5000

# Name CSV 欄位 → model 欄位映射
NAME_FIELD_MAP = {
    "name_id": "name_id",
    "rank": "rank",
    "simple_name": "simple_name",
    "name_author": "name_author",
    "formatted_name": "formatted_name",
    "usage_status": "usage_status",
    "taxon_id": "taxon_id",
    "is_in_taiwan": "is_in_taiwan",
    "common_name_c": "common_name_c",
    "alternative_name_c": "alternative_name_c",
    "is_endemic": "is_endemic",
    "alien_type": "alien_type",
    "iucn": "iucn",
    "redlist": "redlist",
    "kingdom": "kingdom",
    "kingdom_c": "kingdom_c",
    "phylum": "phylum",
    "phylum_c": "phylum_c",
    "class": "class_name",
    "class_c": "class_c",
    "order": "order",
    "order_c": "order_c",
    "family": "family",
    "family_c": "family_c",
    "genus": "genus",
    "genus_c": "genus_c",
    "nomenclature_name": "nomenclature_name",
    "cites": "cites",
    "is_fossil": "is_fossil",
    "is_terrestrial": "is_terrestrial",
    "is_freshwater": "is_freshwater",
    "is_brackish": "is_brackish",
    "is_marine": "is_marine",
    "alien_status_note": "alien_status_note",
    "protected": "protected",
    "is_hybrid": "is_hybrid",
}

# Taxon CSV 中用於補齊的欄位：(DB 欄位名, taxon CSV 欄位名)
TAXON_BACKFILL_FIELDS = [
    ("common_name_c", "common_name_c"),
    ("alternative_name_c", "alternative_name_c"),
    ("kingdom", "kingdom"),
    ("kingdom_c", "kingdom_c"),
    ("phylum", "phylum"),
    ("phylum_c", "phylum_c"),
    ('"class"', "class"),
    ("class_c", "class_c"),
    ('"order"', "order"),
    ("order_c", "order_c"),
    ("family", "family"),
    ("family_c", "family_c"),
    ("genus", "genus"),
    ("genus_c", "genus_c"),
    ("is_endemic", "is_endemic"),
    ("alien_type", "alien_type"),
    ("iucn", "iucn"),
    ("redlist", "redlist"),
    ("cites", "cites"),
    ("protected", "protected"),
    ("is_hybrid", "is_hybrid"),
]


def _find_taxon_csv(name_csv_path: str, taxon_csv_path: str = None) -> str | None:
    """找到對應的 taxon CSV。優先使用明確指定的路徑，否則從 name CSV 同目錄自動偵測。"""
    if taxon_csv_path and os.path.isfile(taxon_csv_path):
        return taxon_csv_path

    csv_dir = os.path.dirname(name_csv_path) or "."
    candidates = sorted(
        [f for f in os.listdir(csv_dir) if f.startswith("TaiCOL_taxon") and f.endswith(".csv")],
        reverse=True,
    )
    if candidates:
        return os.path.join(csv_dir, candidates[0])
    return None


def import_taicol_csv(
    name_csv_path: str,
    taxon_csv_path: str = None,
    do_backup: bool = True,
) -> dict:
    """匯入 TaiCOL name CSV + taxon CSV 到 taicol_names 表

    Args:
        name_csv_path: TaiCOL name CSV 路徑（主要資料來源）
        taxon_csv_path: TaiCOL taxon CSV 路徑（補齊用，若未指定則自動從同目錄偵測）
        do_backup: 是否備份資料庫

    Returns:
        dict with keys: rows_imported, backfilled_records, taxon_csv, time_elapsed, backup_path
    """
    start = time.time()

    # 找 taxon CSV
    resolved_taxon_csv = _find_taxon_csv(name_csv_path, taxon_csv_path)

    # 備份
    backup_path = None
    if do_backup:
        backup_path = backup_db(sqlite_file_path)

    # 清空並重建表
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS taicol_names"))
        conn.commit()

    from sqlmodel import SQLModel
    SQLModel.metadata.create_all(engine, tables=[TaicolName.__table__])

    # ── Step 1: 從 name CSV 匯入所有 name 記錄 ──
    rows_imported = _import_name_csv(name_csv_path)

    # 建立索引（在 backfill 前建，加速 UPDATE）
    _create_indexes()

    # ── Step 2: 從 taxon CSV 補齊缺少的欄位 ──
    backfilled = 0
    if resolved_taxon_csv:
        backfilled = _backfill_from_taxon_csv(resolved_taxon_csv)

    # ── Step 2b: Sibling-genus cross-join backfill ──
    # 對所有 rank+界域類群一律: DB 內缺 kingdom/.../family 但 genus 已填的 row,
    # 從同 genus 內其他已有該欄資料的 row 推導 (cross-join, 不限定 in-Taiwan 或
    # 維管束植物)。涵蓋 TaiCOL CSV 部分 row 有填、部分留空的情況，所有界域類群通用。
    sibling_filled = _backfill_hierarchy_from_siblings()

    # ── Step 2c: Manual override config (TaiCOL 全 sibling 都空白時的最後手段) ──
    # 對於 TaiCOL CSV 內所有同屬 row 都沒填 hierarchy 的 case (e.g. 2026-04 釋出
    # 的 Amydrium 屬尚未填高階分類), 用 `taicol_hierarchy_overrides.json` 補齊。
    hierarchy_filled = _backfill_hierarchy_overrides()

    # ── Step 3: VACUUM 重整資料庫 ──
    try:
        conn = sqlite3.connect(sqlite_file_path)
        conn.execute("VACUUM")
        conn.close()
    except Exception:
        pass

    # 清空 fuzzy 快取
    try:
        from backend.api.search_api import invalidate_cname_cache
        invalidate_cname_cache()
    except ImportError:
        pass

    # 檢查既有檢索表是否引用到不存在的 taxon_id（stale references）
    stale = _check_stale_key_taxon_ids()

    # ── Step 5: 自動 remap stale IK tids ──
    # TaiCOL 物種合併/拆分時 old tid 可能變 not-accepted 或從 DB 消失。
    # 如能用 backup DB 撈出 old sciname → 在新 DB 查同 sciname 的 (not-accepted)
    # row → 取其 taxon_id 為 remap 對象。
    remap_summary = _remap_stale_ik_tids(backup_path)

    # ── Step 4: Warn 仍有空 hierarchy 的 in-Taiwan 維管束植物候選 (genus 已填) ──
    hierarchy_warnings = _warn_missing_hierarchy()

    elapsed = time.time() - start
    return {
        "rows_imported": rows_imported,
        "backfilled_records": backfilled,
        "sibling_filled_rows": sibling_filled,
        "hierarchy_filled": hierarchy_filled,
        "hierarchy_warnings": hierarchy_warnings,
        "stale_remap": remap_summary,
        "taxon_csv": os.path.basename(resolved_taxon_csv) if resolved_taxon_csv else None,
        "time_elapsed": round(elapsed, 2),
        "backup_path": backup_path,
        "stale_key_taxon_refs": stale,
    }


def _remap_stale_ik_tids(backup_db_path: Optional[str]) -> dict:
    """對 IK 內 stale (TaiCOL 已合併刪除的) taxon_id 自動 remap 到新 tid。

    流程:
      1. 比對 IK target_id ∩ 新 taicol_names — 找出 stale tids
      2. 從 backup DB 用 stale tid 查歷史 accepted sciname (備份保存 import 前狀態)
      3. 在新 DB 用 sciname 查任一 row (accepted 優先, 否則 not-accepted)
         → 取其 taxon_id 作為 remap target
      4. SQL UPDATE key_couplets.lead_*_target_id / identification_keys.scope_taxon_id /
         key_taxon_features.taxon_id 從 old → new

    Returns: {'remapped_pairs': [(old, new, sciname)], 'updates': int, 'unresolved': [old, ...]}

    Backup DB 取得不到時 (`backup_db_path` None) 退回不 remap, 由
    _check_stale_key_taxon_ids() 的 warn-only 結果由 user 手動處理。
    """
    if not backup_db_path or not os.path.isfile(backup_db_path):
        return {"remapped_pairs": [], "updates": 0, "unresolved": [], "skipped": "no backup"}

    new_conn = sqlite3.connect(sqlite_file_path)
    new_cur = new_conn.cursor()

    # Stale tids in IK after this import.
    #
    # The GLOB keeps raw scientific-name targets (`Bambusoideae`,
    # `Styloglossum clavata`, …) out — those are legitimately unresolved and
    # must not be "remapped". It used to be `LIKE 't00%'`, which also silently
    # excluded every id from t0100000 onward: TaiCOL passed that mark (max id
    # is t0124636 as of the 2026-08 release), so 161 of 5,800 key references
    # had become invisible to this remap while `_check_stale_key_taxon_ids`
    # still reported them — stale refs that were warned about but never fixed.
    new_cur.execute("""
    SELECT DISTINCT lead_a_target_id FROM key_couplets
     WHERE lead_a_target_type='taxon' AND lead_a_target_id GLOB 't[0-9]*'
    UNION
    SELECT DISTINCT lead_b_target_id FROM key_couplets
     WHERE lead_b_target_type='taxon' AND lead_b_target_id GLOB 't[0-9]*'
    UNION
    SELECT DISTINCT scope_taxon_id FROM identification_keys
     WHERE scope_taxon_id GLOB 't[0-9]*'
    UNION
    SELECT DISTINCT taxon_id FROM key_taxon_features
     WHERE taxon_id GLOB 't[0-9]*'
    """)
    ik_tids = {r[0] for r in new_cur.fetchall() if r[0]}
    new_cur.execute(
        "SELECT DISTINCT taxon_id FROM taicol_names "
        "WHERE taxon_id IS NOT NULL AND taxon_id != ''"
    )
    new_tids = {r[0] for r in new_cur.fetchall()}
    stale = sorted(ik_tids - new_tids)
    if not stale:
        new_conn.close()
        return {"remapped_pairs": [], "updates": 0, "unresolved": []}

    # Read backup DB read-only via URI
    old_conn = sqlite3.connect(f"file:{backup_db_path}?mode=ro", uri=True)
    old_cur = old_conn.cursor()

    remap: list[tuple[str, str, str]] = []
    unresolved: list[str] = []
    for old_tid in stale:
        old_cur.execute(
            "SELECT simple_name, common_name_c FROM taicol_names "
            "WHERE taxon_id=? AND usage_status='accepted' LIMIT 1",
            (old_tid,),
        )
        r = old_cur.fetchone()
        if not r:
            unresolved.append(old_tid)
            continue
        sn, cn = r
        new_cur.execute(
            """
            SELECT taxon_id FROM taicol_names
             WHERE simple_name = ?
             ORDER BY CASE usage_status WHEN 'accepted' THEN 0
                                        WHEN 'not-accepted' THEN 1
                                        ELSE 2 END
             LIMIT 1
            """,
            (sn,),
        )
        nr = new_cur.fetchone()
        if not nr or nr[0] == old_tid:
            unresolved.append(old_tid)
            continue
        remap.append((old_tid, nr[0], sn))

    old_conn.close()

    if not remap:
        new_conn.close()
        return {"remapped_pairs": [], "updates": 0, "unresolved": unresolved}

    total = 0
    for old_tid, new_tid, sn in remap:
        for sql in (
            "UPDATE key_couplets SET lead_a_target_id=? WHERE lead_a_target_id=?",
            "UPDATE key_couplets SET lead_b_target_id=? WHERE lead_b_target_id=?",
            "UPDATE identification_keys SET scope_taxon_id=? WHERE scope_taxon_id=?",
            "UPDATE key_taxon_features SET taxon_id=? WHERE taxon_id=?",
        ):
            new_cur.execute(sql, (new_tid, old_tid))
            total += new_cur.rowcount
        print(f"[stale-remap] {old_tid} ({sn}) → {new_tid}")
    new_conn.commit()
    new_conn.close()
    print(f"[stale-remap] {len(remap)} tids remapped, {total} IK refs updated")
    return {"remapped_pairs": remap, "updates": total, "unresolved": unresolved}


def _backfill_hierarchy_from_siblings() -> int:
    """對 DB 內缺高階階層的 row, 從**同 (kingdom, genus) 配對**的其他 row 推導。

    覆蓋所有界域 (動植物、真菌、原生生物、細菌、古菌) — 不只維管束植物。

    Homonym safety: 同 genus 名可能跨多個 kingdom (e.g. `Taiwania` 既是
    植物紅檜屬 Cupressaceae 也是動物蛛蜂屬 Pompilidae; 經 DB 確認跨界
    homonym 至少有 20+ 屬: Acmella/Ficus/Donax/Chloris/Breynia 等)。
    **Sample + UPDATE 兩步都用 (kingdom, genus) 為 key**, 避免跨界污染。

    流程:
      1. 建 `(kingdom, genus)` index 加速 lookup
      2. CREATE TEMP TABLE 一次性算每對 (kingdom, genus) 的 10 個 hierarchy
         欄位樣本 (MAX(CASE non-empty)) — GROUP BY 自動切割同名異界
      3. 單一 UPDATE 用 correlated subquery 從 temp table 一次補齊全表

    **若 target row 的 kingdom 自身為空 → 不處理** (無法判斷該歸哪邊;
    走 Step 2c override 或留 warn)。

    COALESCE(NULLIF(col,''), ?) 保證不覆蓋已有值。
    """
    conn = sqlite3.connect(sqlite_file_path)
    cur = conn.cursor()

    # 1. compound index for fast (kingdom, genus) lookup
    cur.execute("CREATE INDEX IF NOT EXISTS idx_taicol_kingdom_genus ON taicol_names(kingdom, genus)")

    # 2. Build per-pair sample table. Note SQLite reserved words `class`/`order`
    #    can't be column names in our temp table (CREATE TEMP TABLE AS preserves
    #    aliases) so we rename to sample_class / sample_order.
    cur.execute("DROP TABLE IF EXISTS _hier_sample")
    cur.execute("""
        CREATE TEMP TABLE _hier_sample AS
        SELECT kingdom AS k, genus AS g,
          MAX(CASE WHEN kingdom_c != '' THEN kingdom_c END) AS kingdom_c,
          MAX(CASE WHEN phylum != '' THEN phylum END) AS phylum,
          MAX(CASE WHEN phylum_c != '' THEN phylum_c END) AS phylum_c,
          MAX(CASE WHEN class != '' THEN class END) AS sample_class,
          MAX(CASE WHEN class_c != '' THEN class_c END) AS class_c,
          MAX(CASE WHEN "order" != '' THEN "order" END) AS sample_order,
          MAX(CASE WHEN order_c != '' THEN order_c END) AS order_c,
          MAX(CASE WHEN family != '' THEN family END) AS family,
          MAX(CASE WHEN family_c != '' THEN family_c END) AS family_c
        FROM taicol_names
        WHERE kingdom IS NOT NULL AND kingdom != ''
          AND genus IS NOT NULL AND genus != ''
        GROUP BY kingdom, genus
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_hier_sample_kg ON _hier_sample(k, g)")
    cur.execute("SELECT COUNT(*) FROM _hier_sample")
    n_pairs = cur.fetchone()[0]

    # 3. Single-UPDATE filling all 9 hierarchy cols (kingdom 已是 join key, 不填自己)
    cur.execute("""
        UPDATE taicol_names
        SET
          kingdom_c = COALESCE(NULLIF(kingdom_c, ''),
            (SELECT s.kingdom_c FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          phylum = COALESCE(NULLIF(phylum, ''),
            (SELECT s.phylum FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          phylum_c = COALESCE(NULLIF(phylum_c, ''),
            (SELECT s.phylum_c FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          "class" = COALESCE(NULLIF("class", ''),
            (SELECT s.sample_class FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          class_c = COALESCE(NULLIF(class_c, ''),
            (SELECT s.class_c FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          "order" = COALESCE(NULLIF("order", ''),
            (SELECT s.sample_order FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          order_c = COALESCE(NULLIF(order_c, ''),
            (SELECT s.order_c FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          family = COALESCE(NULLIF(family, ''),
            (SELECT s.family FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus)),
          family_c = COALESCE(NULLIF(family_c, ''),
            (SELECT s.family_c FROM _hier_sample s WHERE s.k=taicol_names.kingdom AND s.g=taicol_names.genus))
        WHERE kingdom IS NOT NULL AND kingdom != ''
          AND genus IS NOT NULL AND genus != ''
          AND (kingdom_c IS NULL OR kingdom_c='' OR phylum IS NULL OR phylum=''
               OR phylum_c IS NULL OR phylum_c='' OR "class" IS NULL OR "class"=''
               OR class_c IS NULL OR class_c='' OR "order" IS NULL OR "order"=''
               OR order_c IS NULL OR order_c='' OR family IS NULL OR family=''
               OR family_c IS NULL OR family_c='')
    """)
    total = cur.rowcount
    conn.commit()
    cur.execute("DROP TABLE IF EXISTS _hier_sample")
    conn.commit()
    conn.close()

    if total:
        print(
            f"[sibling-fill] cross-joined hierarchy into {total} rows "
            f"(homonym-safe by (kingdom, genus); {n_pairs} pairs sampled)"
        )
    return total


def _backfill_hierarchy_overrides() -> int:
    """從 taicol_hierarchy_overrides.json 補齊 TaiCOL 漏填的 kingdom/phylum/.../family。

    Config 路徑與本檔同層。Schema: { "<genus>": {kingdom, kingdom_c, phylum, ..., family_c} }。
    SQL 用 COALESCE 保留現有值, 只填空欄位。新 TaiCOL 版本如不再缺即無 effect。
    """
    import json
    config_path = os.path.join(os.path.dirname(__file__), "taicol_hierarchy_overrides.json")
    if not os.path.isfile(config_path):
        return 0
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            overrides = json.load(f)
    except Exception as e:
        print(f"[warn] hierarchy overrides config load failed: {e}")
        return 0

    cols = ("kingdom","kingdom_c","phylum","phylum_c","class","class_c","order","order_c","family","family_c")
    conn = sqlite3.connect(sqlite_file_path)
    cur = conn.cursor()
    total = 0
    for genus, fields in overrides.items():
        if genus.startswith("_"):
            continue  # skip metadata keys
        if not isinstance(fields, dict):
            continue
        sets, params = [], []
        for c in cols:
            if c in fields and fields[c]:
                # SQLite reserved word `order` and `class` need quoting
                qc = f'"{c}"' if c in ("order", "class") else c
                sets.append(f"{qc}=COALESCE(NULLIF({qc},''), ?)")
                params.append(fields[c])
        if not sets:
            continue
        params.append(genus)
        cur.execute(
            f"UPDATE taicol_names SET {', '.join(sets)} WHERE genus = ?",
            params,
        )
        if cur.rowcount:
            total += cur.rowcount
            print(f"[hierarchy] {genus}: filled {cur.rowcount} row(s)")
    conn.commit()
    conn.close()
    if total:
        print(f"[hierarchy] backfilled {total} rows via overrides config")
    return total


def _warn_missing_hierarchy() -> list:
    """掃 in-Taiwan accepted taxa, 找出仍缺 phylum 但 genus 已填的 row。

    Returns list of dicts; logger 可上層處理。Mobile UI 「維管束植物」filter 用
    `phylum='Tracheophyta'`, 缺 phylum 的 taxa 會 silently 從搜尋與分類樹中消失,
    為減少 surprise 主動 warn。
    """
    conn = sqlite3.connect(sqlite_file_path)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT taxon_id, simple_name, common_name_c, rank, genus
        FROM taicol_names
        WHERE usage_status='accepted'
          AND is_in_taiwan LIKE '%true%'
          AND (phylum IS NULL OR phylum='')
          AND genus IS NOT NULL AND genus != ''
        ORDER BY genus, taxon_id
        """
    )
    rows = cur.fetchall()
    conn.close()
    warnings = []
    if rows:
        print(f"\n[hierarchy warn] {len(rows)} in-Taiwan accepted taxa still missing phylum (genus filled):")
        for tid, sn, cn, rank, genus in rows:
            warnings.append({"taxon_id": tid, "simple_name": sn, "common_name_c": cn or "", "rank": rank, "genus": genus})
            print(f"  {tid}  genus={genus:<20s} {sn} ({cn or '-'}) [{rank}]")
        print(
            "  → 補法: 在 taicol_hierarchy_overrides.json 加 genus → hierarchy mapping, "
            "重 import 或手動 SQL UPDATE。"
        )
    return warnings


def _check_stale_key_taxon_ids() -> dict:
    """掃描 identification_keys / key_couplets 內引用到 taicol_names 已不存在的 taxon_id。

    TaiCOL 重新匯入後，部分檢索表 terminal 的 taxon_id 可能因合併 / 刪除 / 升降級
    而對不上新版 taicol_names。stale 引用不會破壞 schema（target_id 是 VARCHAR
    非 FK），但 mobile / desktop 顯示 terminal 時 join 失敗，會缺俗名 / 保育狀態 /
    分類路徑。本函式 warn-only，由 caller 決定如何處理。

    Returns:
        {
            'total_stale_couplets': int,
            'total_stale_scope': int,
            'by_key': [
                {
                    'key_id': int,
                    'scope_name': str,
                    'scope_cname': str | None,
                    'source': str | None,
                    'stale_couplets': [
                        {'number': int, 'lead': 'A'|'B', 'taxon_id': str},
                        ...
                    ],
                    'stale_scope_taxon_id': str | None,
                },
                ...
            ]
        }
    """
    sql = """
    WITH known AS (
        SELECT DISTINCT taxon_id FROM taicol_names WHERE taxon_id IS NOT NULL
    ),
    couplet_stale AS (
        SELECT c.key_id, c.number, 'A' AS lead, c.lead_a_target_id AS taxon_id
        FROM key_couplets c
        WHERE c.lead_a_target_type = 'taxon'
          AND c.lead_a_target_id IS NOT NULL
          AND c.lead_a_target_id NOT IN (SELECT taxon_id FROM known)
        UNION ALL
        SELECT c.key_id, c.number, 'B' AS lead, c.lead_b_target_id AS taxon_id
        FROM key_couplets c
        WHERE c.lead_b_target_type = 'taxon'
          AND c.lead_b_target_id IS NOT NULL
          AND c.lead_b_target_id NOT IN (SELECT taxon_id FROM known)
    )
    SELECT k.id AS key_id, k.scope_name, k.scope_cname, k.source,
           cs.number, cs.lead, cs.taxon_id,
           CASE WHEN k.scope_taxon_id IS NOT NULL
                     AND k.scope_taxon_id NOT IN (SELECT taxon_id FROM known)
                THEN k.scope_taxon_id END AS stale_scope_taxon_id
    FROM identification_keys k
    LEFT JOIN couplet_stale cs ON cs.key_id = k.id
    WHERE cs.key_id IS NOT NULL
       OR (k.scope_taxon_id IS NOT NULL
           AND k.scope_taxon_id NOT IN (SELECT taxon_id FROM known))
    ORDER BY k.id, cs.number, cs.lead
    """
    by_key: dict[int, dict] = {}
    total_couplets = 0
    total_scope = 0
    with Session(engine) as session:
        rows = session.exec(text(sql)).all()
        for r in rows:
            key_id = r.key_id
            if key_id not in by_key:
                by_key[key_id] = {
                    "key_id": key_id,
                    "scope_name": r.scope_name,
                    "scope_cname": r.scope_cname,
                    "source": r.source,
                    "stale_couplets": [],
                    "stale_scope_taxon_id": r.stale_scope_taxon_id,
                }
                if r.stale_scope_taxon_id:
                    total_scope += 1
            if r.number is not None and r.lead is not None:
                by_key[key_id]["stale_couplets"].append(
                    {"number": r.number, "lead": r.lead, "taxon_id": r.taxon_id}
                )
                total_couplets += 1
    return {
        "total_stale_couplets": total_couplets,
        "total_stale_scope": total_scope,
        "by_key": list(by_key.values()),
    }


def _import_name_csv(csv_path: str) -> int:
    """從 name CSV 匯入所有記錄"""
    rows_imported = 0
    seen_ids = set()

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        batch = []

        for row in reader:
            record = {}
            for csv_col, model_col in NAME_FIELD_MAP.items():
                record[model_col] = row.get(csv_col, "") or None

            # name_id 為整數，跳過重複
            try:
                record["name_id"] = int(record["name_id"])
            except (ValueError, TypeError):
                continue
            if record["name_id"] in seen_ids:
                continue
            seen_ids.add(record["name_id"])

            # multi-value taxon_id：保留原始值，取第一個為主要值
            raw_taxon_id = record.get("taxon_id", "") or ""
            if "," in raw_taxon_id:
                record["taxon_id_all"] = raw_taxon_id
                record["taxon_id"] = raw_taxon_id.split(",")[0].strip()
            else:
                record["taxon_id_all"] = None

            # multi-value usage_status：取第一個
            raw_status = record.get("usage_status", "") or ""
            if "," in raw_status:
                record["usage_status"] = raw_status.split(",")[0].strip()

            batch.append(TaicolName(**record))
            rows_imported += 1

            if len(batch) >= BATCH_SIZE:
                with Session(engine) as session:
                    session.add_all(batch)
                    session.commit()
                batch = []

        if batch:
            with Session(engine) as session:
                session.add_all(batch)
                session.commit()

    return rows_imported


def _backfill_from_taxon_csv(taxon_csv_path: str) -> int:
    """從 taxon CSV 補齊 name 記錄中缺少的欄位

    Taxon CSV 以 taxon_id 為單位，包含完整的分類階層 common names、
    保育狀態等資訊。用 taxon_id 做為 foreign key，對 name 記錄逐筆補齊空欄位。
    """
    # 讀取 taxon CSV → taxon_id 對照表
    taxon_data = {}
    try:
        with open(taxon_csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                tid = row.get("taxon_id", "")
                if tid:
                    entry = {}
                    for _, csv_key in TAXON_BACKFILL_FIELDS:
                        entry[csv_key] = row.get(csv_key, "")
                    taxon_data[tid] = entry
    except Exception:
        return 0

    if not taxon_data:
        return 0

    # 用 sqlite3 直接 UPDATE（比 ORM 快很多）
    conn = sqlite3.connect(sqlite_file_path)
    cur = conn.cursor()

    cur.execute("""
        SELECT name_id, taxon_id FROM taicol_names
        WHERE taxon_id IS NOT NULL AND taxon_id != ''
    """)
    rows = cur.fetchall()

    updated = 0
    for name_id, taxon_id in rows:
        tid = taxon_id.split(",")[0].strip()
        td = taxon_data.get(tid)
        if not td:
            continue

        # 只補空值，不覆蓋 name CSV 已有的值
        updates = []
        params = []
        for db_col, td_key in TAXON_BACKFILL_FIELDS:
            val = td.get(td_key, "")
            if val:
                updates.append(f"{db_col} = COALESCE(NULLIF({db_col}, ''), ?)")
                params.append(val)

        if updates:
            sql = f"UPDATE taicol_names SET {', '.join(updates)} WHERE name_id = ?"
            params.append(name_id)
            cur.execute(sql, params)
            updated += 1

    conn.commit()
    conn.close()
    return updated


def _create_indexes():
    """建立搜尋用索引"""
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_taicol_common_name ON taicol_names(common_name_c)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_simple_name ON taicol_names(simple_name)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_family ON taicol_names(family)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_family_c ON taicol_names(family_c)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_genus ON taicol_names(genus)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_taxon_id ON taicol_names(taxon_id)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_usage_status ON taicol_names(usage_status)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_kingdom_phylum ON taicol_names(kingdom, phylum)",
        "CREATE INDEX IF NOT EXISTS idx_taicol_class ON taicol_names(class)",
    ]
    with Session(engine) as session:
        for idx_sql in indexes:
            session.exec(text(idx_sql))
        session.commit()


if __name__ == "__main__":
    import sys
    name_csv = sys.argv[1] if len(sys.argv) > 1 else "references/TaiCOL_name_20260224.csv"
    taxon_csv = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"Importing name CSV: {name_csv}")
    if taxon_csv:
        print(f"Taxon CSV: {taxon_csv}")
    else:
        print("Taxon CSV: auto-detect from same directory")
    result = import_taicol_csv(name_csv, taxon_csv)
    print(f"Done: {result['rows_imported']} rows in {result['time_elapsed']}s")
    print(f"Taxon CSV used: {result.get('taxon_csv', 'none')}")
    print(f"Backfilled records: {result.get('backfilled_records', 0)}")
    if result["backup_path"]:
        print(f"Backup: {result['backup_path']}")

    stale = result.get("stale_key_taxon_refs") or {}
    total_couplets = stale.get("total_stale_couplets", 0)
    total_scope = stale.get("total_stale_scope", 0)
    if total_couplets or total_scope:
        print()
        print(
            f"[WARN] 檢索表發現 {total_couplets} 個 couplet lead + "
            f"{total_scope} 個 key scope 引用到不存在的 taxon_id："
        )
        for entry in stale.get("by_key", []):
            scope_label = entry.get("scope_cname") or entry.get("scope_name")
            print(
                f"  key_id={entry['key_id']} ({scope_label})"
                f"  source={entry.get('source') or '-'}"
            )
            if entry.get("stale_scope_taxon_id"):
                print(f"    scope_taxon_id stale: {entry['stale_scope_taxon_id']}")
            for cp in entry["stale_couplets"]:
                print(f"    couplet {cp['number']}{cp['lead']} → {cp['taxon_id']}")
        print()
        print(
            "建議：到對應 sheet 修正學名後，跑 "
            "`python -m backend.services.key_sheet_import <spreadsheet_id>` "
            "重新匯入，再 `make mobile-db` 同步。"
        )
    else:
        print("檢索表 taxon_id 引用全部對應到新版 TaiCOL，無 stale 參照。")
