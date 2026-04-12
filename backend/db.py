import os
import sys
import shutil
from sqlmodel import create_engine, Session


def _get_data_dir() -> str:
    """決定使用者資料目錄

    - 打包模式（PyInstaller）：使用者 app data 目錄
    - 開發模式：backend/ 目錄
    """
    if getattr(sys, '_MEIPASS', None):
        # 打包模式
        if sys.platform == 'darwin':
            base = os.path.expanduser('~/Library/Application Support/checklister-ng')
        elif sys.platform == 'win32':
            base = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'checklister-ng')
        else:
            base = os.path.expanduser('~/.checklister-ng')
        os.makedirs(base, exist_ok=True)
        return base
    else:
        # 開發模式
        return os.path.dirname(__file__)


def _ensure_user_dbs(data_dir: str):
    """確保 user_profile.db 和 checklists.db 存在（首次啟動時建立）"""
    for db_name in ['user_profile.db', 'checklists.db']:
        db_path = os.path.join(data_dir, db_name)
        if not os.path.exists(db_path):
            # 建立空 DB（schema 由 SQLModel 建立）
            pass  # create_all 在 init_user_dbs() 處理


# ── TaiCOL 參考資料 DB（唯讀）──
sqlite_file_path = os.environ.get(
    "CHECKLISTER_DB_PATH",
    os.path.join(os.path.dirname(__file__), "twnamelist.db")
)
sqlite_url = f"sqlite:///{sqlite_file_path}"
engine = create_engine(sqlite_url, echo=False)

# ── 使用者資料目錄 ──
user_data_dir = _get_data_dir()

# ── User Profile DB ──
profile_db_path = os.path.join(user_data_dir, "user_profile.db")
profile_engine = create_engine(f"sqlite:///{profile_db_path}", echo=False)

# ── Checklists DB ──
checklists_db_path = os.path.join(user_data_dir, "checklists.db")
checklists_engine = create_engine(f"sqlite:///{checklists_db_path}", echo=False)


def init_user_dbs():
    """初始化 user_profile 和 checklists 的 schema（啟動時呼叫）"""
    from backend.models.user_schema import UserPreference, Project, ChecklistItem
    from sqlmodel import SQLModel

    # 只建立 user_schema 的表到對應的 engine
    SQLModel.metadata.create_all(
        profile_engine,
        tables=[UserPreference.__table__]
    )
    SQLModel.metadata.create_all(
        checklists_engine,
        tables=[Project.__table__, ChecklistItem.__table__]
    )


def get_session():
    return Session(engine)


def get_profile_session():
    return Session(profile_engine)


def get_checklists_session():
    return Session(checklists_engine)
