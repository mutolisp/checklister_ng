from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class UserPreference(SQLModel, table=True):
    """使用者偏好設定（key/value store）"""
    __tablename__ = "user_preferences"

    key: str = Field(primary_key=True)
    value: str = ""
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class Project(SQLModel, table=True):
    """名錄專案"""
    __tablename__ = "projects"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = ""
    abstract: str = ""
    location_description: str = ""
    site_name: str = ""
    notes: str = ""
    footprint_wkt: str = ""
    geometries_json: str = ""  # GeoJSON FeatureCollection as JSON string
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    modified_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class ChecklistItem(SQLModel, table=True):
    """名錄中的物種"""
    __tablename__ = "checklist_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="projects.id", index=True)
    taxon_id: str = ""
    species_data_json: str = ""  # 完整物種資料 JSON（與 search API 回傳格式一致）
    abundance: int = 0
    added_at: str = Field(default_factory=lambda: datetime.now().isoformat())
