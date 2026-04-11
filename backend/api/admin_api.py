import os
import re
import logging
import tempfile
from typing import Optional
from fastapi import APIRouter, UploadFile, File, HTTPException
from backend.services.taicol_import import import_taicol_csv

logger = logging.getLogger(__name__)

router = APIRouter()

# SQL injection 偵測 pattern
_SQL_INJECTION_PATTERN = re.compile(
    r"(?:--|;|\b(?:DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|UNION|SELECT)\b\s)",
    re.IGNORECASE,
)


def _check_csv_safety(content: bytes, sample_size: int = 50000) -> bool:
    """抽樣檢查 CSV 內容是否含有可疑的 SQL injection pattern"""
    try:
        text = content[:sample_size].decode("utf-8", errors="ignore")
        if _SQL_INJECTION_PATTERN.search(text):
            return False
    except Exception:
        pass
    return True


@router.post("/api/admin/import-taicol",
             summary="上傳並匯入 TaiCOL 名錄 CSV",
             description="接受 TaiCOL name CSV + taxon CSV，備份資料庫後匯入。"
                         "name_file 為必要（name CSV），taxon_file 為選填（taxon CSV，補齊 common names 等）。"
                         "若未上傳 taxon CSV，會嘗試從 name CSV 同目錄自動偵測。")
async def upload_taicol(
    name_file: UploadFile = File(..., description="TaiCOL name CSV（必要）"),
    taxon_file: Optional[UploadFile] = File(None, description="TaiCOL taxon CSV（選填，補齊 common names / 保育狀態）"),
):
    if not name_file.filename or not name_file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="請上傳 CSV 檔案")

    name_content = await name_file.read()

    # 限制上傳大小（200MB）
    if len(name_content) > 200 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Name CSV 超過 200MB 限制")

    # SQL injection 檢查
    if not _check_csv_safety(name_content):
        logger.warning(f"CSV upload rejected: suspicious SQL pattern in {name_file.filename}")
        raise HTTPException(status_code=400, detail="CSV 內容含有可疑的 SQL 語法，已拒絕匯入")

    name_tmp_path = ""
    taxon_tmp_path = ""
    try:
        # 寫入 name CSV 暫存檔
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="wb") as tmp:
            tmp.write(name_content)
            name_tmp_path = tmp.name

        # 寫入 taxon CSV 暫存檔（若有上傳）
        if taxon_file and taxon_file.filename:
            if not taxon_file.filename.endswith(".csv"):
                raise HTTPException(status_code=400, detail="Taxon 檔案請上傳 CSV 格式")
            taxon_content = await taxon_file.read()
            if len(taxon_content) > 200 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Taxon CSV 超過 200MB 限制")
            if not _check_csv_safety(taxon_content):
                raise HTTPException(status_code=400, detail="Taxon CSV 含有可疑的 SQL 語法")
            with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="wb") as tmp:
                tmp.write(taxon_content)
                taxon_tmp_path = tmp.name

        result = import_taicol_csv(
            name_csv_path=name_tmp_path,
            taxon_csv_path=taxon_tmp_path or None,
            do_backup=True,
        )
        logger.info(
            f"TaiCOL import: {result['rows_imported']} rows, "
            f"backfilled {result['backfilled_records']} from taxon CSV "
            f"({result.get('taxon_csv', 'none')}) in {result['time_elapsed']}s"
        )
        return {
            "status": "success",
            "rows_imported": result["rows_imported"],
            "backfilled_records": result["backfilled_records"],
            "taxon_csv": result.get("taxon_csv"),
            "time_elapsed": result["time_elapsed"],
            "backup_path": result["backup_path"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("TaiCOL import failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if name_tmp_path and os.path.exists(name_tmp_path):
            os.unlink(name_tmp_path)
        if taxon_tmp_path and os.path.exists(taxon_tmp_path):
            os.unlink(taxon_tmp_path)
