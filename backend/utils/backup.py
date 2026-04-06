import shutil
import os
from datetime import datetime


def backup_db(db_path: str) -> str:
    """備份資料庫，回傳備份檔路徑"""
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    backup_path = f"{db_path}.bak.{timestamp}"
    shutil.copy2(db_path, backup_path)
    return backup_path
