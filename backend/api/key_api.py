import os
import re
import sys
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

router = APIRouter()


def _get_base_path():
    if getattr(sys, '_MEIPASS', None):
        return sys._MEIPASS
    return os.path.join(os.path.dirname(__file__), '..', '..')


def _get_key_dir():
    return os.path.join(_get_base_path(), "references", "key_to_sp")


# 可用屬名集合（每次查詢時重新掃描目錄，確保新增檔案可即時偵測）
def _load_genera() -> set[str]:
    key_dir = _get_key_dir()
    if os.path.isdir(key_dir):
        return {
            f for f in os.listdir(key_dir)
            if os.path.isfile(os.path.join(key_dir, f))
        }
    return set()


@router.get("/api/key/{genus}")
async def get_key(genus: str):
    """取得指定屬的檢索表"""
    # 安全檢查：屬名只能是英文字母
    if not re.match(r'^[A-Za-z]+$', genus):
        return PlainTextResponse("Invalid genus name", status_code=400)

    available = _load_genera()

    # 首字大寫
    genus_normalized = genus[0].upper() + genus[1:].lower() if len(genus) > 1 else genus.upper()

    if genus_normalized not in available:
        return PlainTextResponse("", status_code=404)

    key_path = os.path.join(_get_key_dir(), genus_normalized)
    with open(key_path, "r", encoding="utf-8") as f:
        content = f.read()

    return PlainTextResponse(content)


@router.get("/api/key")
async def list_genera():
    """列出所有有檢索表的屬名"""
    return sorted(_load_genera())
