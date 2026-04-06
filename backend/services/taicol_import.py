import csv
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

    # 清空 fuzzy 快取
    try:
        from backend.api.search_api import invalidate_cname_cache
        invalidate_cname_cache()
    except ImportError:
        pass

    elapsed = time.time() - start
    return {
        "rows_imported": rows_imported,
        "time_elapsed": round(elapsed, 2),
        "backup_path": backup_path,
    }


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
    if result["backup_path"]:
        print(f"Backup: {result['backup_path']}")
