import csv
import os
import time
from sqlmodel import Session, text
from backend.db import engine, sqlite_file_path
from backend.models.schema import TaicolName
from backend.utils.backup import backup_db


BATCH_SIZE = 5000

# CSV 欄位 → model 欄位映射
FIELD_MAP = {
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
    "phylum": "phylum",
    "class": "class_name",
    "order": "order",
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
}


def import_taicol_csv(csv_path: str, do_backup: bool = True) -> dict:
    """匯入 TaiCOL CSV 到 taicol_names 表

    Returns:
        dict with keys: rows_imported, time_elapsed, backup_path
    """
    start = time.time()

    # 備份
    backup_path = None
    if do_backup:
        backup_path = backup_db(sqlite_file_path)

    # 清空並重建表（用 raw connection 確保 DROP 生效）
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS taicol_names"))
        conn.commit()

    from sqlmodel import SQLModel
    SQLModel.metadata.create_all(engine, tables=[TaicolName.__table__])

    # 讀取 CSV 並批次插入
    rows_imported = 0
    seen_ids = set()
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        batch = []

        for row in reader:
            record = {}
            for csv_col, model_col in FIELD_MAP.items():
                record[model_col] = row.get(csv_col, "") or None

            # 處理 name_id 為整數，跳過重複
            try:
                record["name_id"] = int(record["name_id"])
            except (ValueError, TypeError):
                continue
            if record["name_id"] in seen_ids:
                continue
            seen_ids.add(record["name_id"])

            # 處理 multi-value taxon_id：保留原始值，取第一個為主要值
            raw_taxon_id = record.get("taxon_id", "") or ""
            if "," in raw_taxon_id:
                record["taxon_id_all"] = raw_taxon_id
                record["taxon_id"] = raw_taxon_id.split(",")[0].strip()
            else:
                record["taxon_id_all"] = None

            # 處理 multi-value usage_status：取第一個
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

        # 剩餘的
        if batch:
            with Session(engine) as session:
                session.add_all(batch)
                session.commit()

    # 建立索引
    _create_indexes()

    # 從 taxon CSV 補齊缺少的俗名
    backfilled = _backfill_common_names(csv_path)

    # 清空 fuzzy 快取
    try:
        from backend.api.search_api import invalidate_cname_cache
        invalidate_cname_cache()
    except ImportError:
        pass

    elapsed = time.time() - start
    return {
        "rows_imported": rows_imported,
        "backfilled_names": backfilled,
        "time_elapsed": round(elapsed, 2),
        "backup_path": backup_path,
    }


def _backfill_common_names(name_csv_path: str) -> int:
    """從 taxon CSV 補齊 name CSV 中缺少的俗名

    TaiCOL name CSV 有些物種沒有 common_name_c，但同目錄下的 taxon CSV 有。
    用 taxon_id 對照補齊。
    """
    import sqlite3

    # 找 taxon CSV：跟 name CSV 同目錄，檔名為 TaiCOL_taxon_*.csv
    csv_dir = os.path.dirname(name_csv_path)
    taxon_csvs = sorted(
        [f for f in os.listdir(csv_dir) if f.startswith("TaiCOL_taxon") and f.endswith(".csv")],
        reverse=True,
    )
    if not taxon_csvs:
        return 0

    taxon_csv_path = os.path.join(csv_dir, taxon_csvs[0])

    # 讀取 taxon CSV 的 taxon_id → 完整資料對照
    taxon_data = {}
    try:
        with open(taxon_csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                tid = row.get("taxon_id", "")
                if tid:
                    taxon_data[tid] = {
                        "common_name_c": row.get("common_name_c", ""),
                        "kingdom": row.get("kingdom", ""),
                        "phylum": row.get("phylum", ""),
                        "class": row.get("class", ""),
                        "order": row.get("order", ""),
                        "family": row.get("family", ""),
                        "family_c": row.get("family_c", ""),
                        "genus": row.get("genus", ""),
                        "genus_c": row.get("genus_c", ""),
                        "is_endemic": row.get("is_endemic", ""),
                        "alien_type": row.get("alien_type", ""),
                        "iucn": row.get("iucn", ""),
                        "redlist": row.get("redlist", ""),
                    }
    except Exception:
        return 0

    if not taxon_data:
        return 0

    # 用 sqlite3 直接更新
    db_path = sqlite_file_path
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 找所有缺少俗名或分類資訊的記錄
    cur.execute("""
        SELECT name_id, taxon_id FROM taicol_names
        WHERE (common_name_c IS NULL OR common_name_c = ''
               OR family IS NULL OR family = '')
        AND taxon_id IS NOT NULL AND taxon_id != ''
    """)
    rows = cur.fetchall()

    updated = 0
    for name_id, taxon_id in rows:
        tid = taxon_id.split(",")[0].strip()
        td = taxon_data.get(tid)
        if not td:
            continue

        # 組裝要更新的欄位（只補空值）
        updates = []
        params = []

        for db_col, td_key in [
            ("common_name_c", "common_name_c"),
            ("kingdom", "kingdom"),
            ("phylum", "phylum"),
            ('"class"', "class"),
            ('"order"', "order"),
            ("family", "family"),
            ("family_c", "family_c"),
            ("genus", "genus"),
            ("genus_c", "genus_c"),
            ("is_endemic", "is_endemic"),
            ("alien_type", "alien_type"),
            ("iucn", "iucn"),
            ("redlist", "redlist"),
        ]:
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
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "references/TaiCOL_name_20260224.csv"
    print(f"Importing {csv_path}...")
    result = import_taicol_csv(csv_path)
    print(f"Done: {result['rows_imported']} rows in {result['time_elapsed']}s")
    print(f"Backfilled common names: {result.get('backfilled_names', 0)}")
    if result["backup_path"]:
        print(f"Backup: {result['backup_path']}")
