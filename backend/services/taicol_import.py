import csv
import os
import time
import sqlite3
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

    elapsed = time.time() - start
    return {
        "rows_imported": rows_imported,
        "backfilled_records": backfilled,
        "taxon_csv": os.path.basename(resolved_taxon_csv) if resolved_taxon_csv else None,
        "time_elapsed": round(elapsed, 2),
        "backup_path": backup_path,
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
