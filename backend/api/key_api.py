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


# 啟動時建立可用屬名集合（大小寫敏感）
_available_genera: set[str] | None = None


def _load_genera():
    global _available_genera
    key_dir = _get_key_dir()
    if os.path.isdir(key_dir):
        _available_genera = {
            f for f in os.listdir(key_dir)
            if os.path.isfile(os.path.join(key_dir, f))
        }
    else:
        _available_genera = set()


@router.get("/api/key/{genus}")
async def get_key(genus: str):
    """取得指定屬的檢索表"""
    # 安全檢查：屬名只能是英文字母
    if not re.match(r'^[A-Za-z]+$', genus):
        return PlainTextResponse("Invalid genus name", status_code=400)

    if _available_genera is None:
        _load_genera()

    # 首字大寫
    genus_normalized = genus[0].upper() + genus[1:].lower() if len(genus) > 1 else genus.upper()

    if genus_normalized not in _available_genera:
        return PlainTextResponse("", status_code=404)

    key_path = os.path.join(_get_key_dir(), genus_normalized)
    with open(key_path, "r", encoding="utf-8") as f:
        content = f.read()

    return PlainTextResponse(content)


@router.get("/api/key")
async def list_genera():
    """列出所有有檢索表的屬名"""
    if _available_genera is None:
        _load_genera()
    return sorted(_available_genera)
