import os
import tempfile
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from backend.services.taicol_import import import_taicol_csv

router = APIRouter()


@router.post("/api/admin/import-taicol",
             summary="上傳並匯入 TaiCOL 名錄 CSV",
             description="接受 TaiCOL 名錄 CSV 檔案，備份資料庫後匯入。")
async def upload_taicol(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        return JSONResponse({"error": "請上傳 CSV 檔案"}, status_code=400)

    # 存到暫存檔
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="wb") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = import_taicol_csv(tmp_path, do_backup=True)
        return {
            "status": "success",
            "rows_imported": result["rows_imported"],
            "time_elapsed": result["time_elapsed"],
            "backup_path": result["backup_path"],
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        os.unlink(tmp_path)
