import os
import re
import logging
import tempfile
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
             description="接受 TaiCOL 名錄 CSV 檔案，備份資料庫後匯入。")
async def upload_taicol(file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="請上傳 CSV 檔案")

    content = await file.read()

    # 限制上傳大小（200MB）
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="檔案超過 200MB 限制")

    # SQL injection 檢查
    if not _check_csv_safety(content):
        logger.warning(f"CSV upload rejected: suspicious SQL pattern in {file.filename}")
        raise HTTPException(status_code=400, detail="CSV 內容含有可疑的 SQL 語法，已拒絕匯入")

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="wb") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = import_taicol_csv(tmp_path, do_backup=True)
        logger.info(f"TaiCOL import: {result['rows_imported']} rows in {result['time_elapsed']}s")
        return {
            "status": "success",
            "rows_imported": result["rows_imported"],
            "time_elapsed": result["time_elapsed"],
            "backup_path": result["backup_path"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("TaiCOL import failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
