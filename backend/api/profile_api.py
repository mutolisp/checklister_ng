import json
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select, text

from backend.db import profile_engine, checklists_engine
from backend.models.user_schema import UserPreference, Project, ChecklistItem

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Preferences ──────────────────────────────────────────

@router.get("/api/profile/preferences")
def get_all_preferences():
    """取得所有偏好設定"""
    with Session(profile_engine) as s:
        prefs = s.exec(select(UserPreference)).all()
        return {p.key: p.value for p in prefs}


@router.get("/api/profile/preferences/{key}")
def get_preference(key: str):
    with Session(profile_engine) as s:
        pref = s.get(UserPreference, key)
        if not pref:
            return {"key": key, "value": None}
        return {"key": pref.key, "value": pref.value}


@router.put("/api/profile/preferences/{key}")
def set_preference(key: str, body: dict):
    value = body.get("value", "")
    with Session(profile_engine) as s:
        pref = s.get(UserPreference, key)
        if pref:
            pref.value = value
            pref.updated_at = datetime.now().isoformat()
        else:
            pref = UserPreference(key=key, value=value)
            s.add(pref)
        s.commit()
    return {"key": key, "value": value}


@router.put("/api/profile/preferences")
def set_preferences_bulk(body: dict):
    """批次設定偏好"""
    with Session(profile_engine) as s:
        now = datetime.now().isoformat()
        for key, value in body.items():
            pref = s.get(UserPreference, key)
            if pref:
                pref.value = value if isinstance(value, str) else json.dumps(value)
                pref.updated_at = now
            else:
                s.add(UserPreference(key=key, value=value if isinstance(value, str) else json.dumps(value), updated_at=now))
        s.commit()
    return {"status": "ok", "count": len(body)}


# ── Projects ─────────────────────────────────────────────

@router.get("/api/projects")
def list_projects():
    """列出所有專案"""
    with Session(checklists_engine) as s:
        projects = s.exec(select(Project).order_by(Project.modified_at.desc())).all()
        result = []
        for p in projects:
            item_count = s.exec(
                text("SELECT COUNT(*) FROM checklist_items WHERE project_id = :pid").bindparams(pid=p.id)
            ).one()[0]
            result.append({
                **p.model_dump(),
                "species_count": item_count,
            })
        return result


@router.get("/api/projects/geometries")
def get_all_project_geometries():
    """取得所有有幾何資料的專案（供地圖疊加顯示）"""
    with Session(checklists_engine) as s:
        projects = s.exec(
            select(Project).where(Project.footprint_wkt != "")
        ).all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "site_name": p.site_name,
                "footprint_wkt": p.footprint_wkt,
                "geometries_json": p.geometries_json,
                "species_count": s.exec(
                    text("SELECT COUNT(*) FROM checklist_items WHERE project_id = :pid").bindparams(pid=p.id)
                ).one()[0],
                "modified_at": p.modified_at,
            }
            for p in projects
        ]


@router.get("/api/projects/{project_id}")
def get_project(project_id: int):
    with Session(checklists_engine) as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        items = s.exec(select(ChecklistItem).where(ChecklistItem.project_id == project_id)).all()
        species = [json.loads(it.species_data_json) if it.species_data_json else {} for it in items]
        # 補上 abundance
        for sp, it in zip(species, items):
            sp["abundance"] = it.abundance
        return {
            "project": p.model_dump(),
            "checklist": species,
        }


class ProjectCreate(BaseModel):
    name: str = ""
    abstract: str = ""
    location_description: str = ""
    site_name: str = ""
    notes: str = ""
    footprint_wkt: str = ""
    geometries_json: str = ""


@router.post("/api/projects")
def create_project(body: ProjectCreate):
    with Session(checklists_engine) as s:
        now = datetime.now().isoformat()
        p = Project(
            name=body.name,
            abstract=body.abstract,
            location_description=body.location_description,
            site_name=body.site_name,
            notes=body.notes,
            footprint_wkt=body.footprint_wkt,
            geometries_json=body.geometries_json,
            created_at=now,
            modified_at=now,
        )
        s.add(p)
        s.commit()
        s.refresh(p)
        return {"id": p.id, "status": "created"}


@router.put("/api/projects/{project_id}")
def update_project(project_id: int, body: ProjectCreate):
    with Session(checklists_engine) as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        p.name = body.name
        p.abstract = body.abstract
        p.location_description = body.location_description
        p.site_name = body.site_name
        p.notes = body.notes
        p.footprint_wkt = body.footprint_wkt
        p.geometries_json = body.geometries_json
        p.modified_at = datetime.now().isoformat()
        s.commit()
        return {"id": p.id, "status": "updated"}


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    with Session(checklists_engine) as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        # 刪除所有 checklist items
        s.exec(text("DELETE FROM checklist_items WHERE project_id = :pid").bindparams(pid=project_id))
        s.delete(p)
        s.commit()
        return {"status": "deleted"}


# ── Checklist Items ──────────────────────────────────────

class ChecklistItemCreate(BaseModel):
    taxon_id: str
    species_data_json: str = ""
    abundance: int = 0


@router.post("/api/projects/{project_id}/species")
def add_species_to_project(project_id: int, body: ChecklistItemCreate):
    with Session(checklists_engine) as s:
        # 檢查專案存在
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        # 檢查重複
        existing = s.exec(
            select(ChecklistItem).where(
                ChecklistItem.project_id == project_id,
                ChecklistItem.taxon_id == body.taxon_id,
            )
        ).first()
        if existing:
            return {"status": "exists", "id": existing.id}
        item = ChecklistItem(
            project_id=project_id,
            taxon_id=body.taxon_id,
            species_data_json=body.species_data_json,
            abundance=body.abundance,
        )
        s.add(item)
        p.modified_at = datetime.now().isoformat()
        s.commit()
        s.refresh(item)
        return {"status": "added", "id": item.id}


@router.post("/api/projects/{project_id}/species/bulk")
def add_species_bulk(project_id: int, body: list[ChecklistItemCreate]):
    """批次加入物種"""
    with Session(checklists_engine) as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        existing_ids = {
            r[0] for r in s.exec(
                text("SELECT taxon_id FROM checklist_items WHERE project_id = :pid").bindparams(pid=project_id)
            ).all()
        }
        added = 0
        for item_data in body:
            if item_data.taxon_id in existing_ids:
                continue
            s.add(ChecklistItem(
                project_id=project_id,
                taxon_id=item_data.taxon_id,
                species_data_json=item_data.species_data_json,
                abundance=item_data.abundance,
            ))
            existing_ids.add(item_data.taxon_id)
            added += 1
        p.modified_at = datetime.now().isoformat()
        s.commit()
        return {"status": "ok", "added": added, "skipped": len(body) - added}


@router.delete("/api/projects/{project_id}/species/{taxon_id}")
def remove_species_from_project(project_id: int, taxon_id: str):
    with Session(checklists_engine) as s:
        item = s.exec(
            select(ChecklistItem).where(
                ChecklistItem.project_id == project_id,
                ChecklistItem.taxon_id == taxon_id,
            )
        ).first()
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        s.delete(item)
        p = s.get(Project, project_id)
        if p:
            p.modified_at = datetime.now().isoformat()
        s.commit()
        return {"status": "deleted"}


# ── Profile Export/Import ────────────────────────────────

@router.get("/api/profile/export")
def export_profile():
    """匯出完整 profile（preferences + all projects + checklists）"""
    prefs = {}
    with Session(profile_engine) as s:
        for p in s.exec(select(UserPreference)).all():
            prefs[p.key] = p.value

    projects = []
    with Session(checklists_engine) as s:
        for p in s.exec(select(Project)).all():
            items = s.exec(select(ChecklistItem).where(ChecklistItem.project_id == p.id)).all()
            projects.append({
                "project": p.model_dump(),
                "checklist": [it.model_dump() for it in items],
            })

    return {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "preferences": prefs,
        "projects": projects,
    }


@router.post("/api/profile/import")
async def import_profile(body: dict):
    """匯入 profile"""
    # Preferences
    prefs = body.get("preferences", {})
    if prefs:
        with Session(profile_engine) as s:
            now = datetime.now().isoformat()
            for key, value in prefs.items():
                pref = s.get(UserPreference, key)
                if pref:
                    pref.value = value
                    pref.updated_at = now
                else:
                    s.add(UserPreference(key=key, value=value, updated_at=now))
            s.commit()

    # Projects
    imported_projects = 0
    for proj_data in body.get("projects", []):
        p_info = proj_data.get("project", {})
        items_data = proj_data.get("checklist", [])

        with Session(checklists_engine) as s:
            p = Project(
                name=p_info.get("name", ""),
                abstract=p_info.get("abstract", ""),
                location_description=p_info.get("location_description", ""),
                site_name=p_info.get("site_name", ""),
                notes=p_info.get("notes", ""),
                footprint_wkt=p_info.get("footprint_wkt", ""),
                geometries_json=p_info.get("geometries_json", ""),
                created_at=p_info.get("created_at", datetime.now().isoformat()),
                modified_at=datetime.now().isoformat(),
            )
            s.add(p)
            s.commit()
            s.refresh(p)

            for it in items_data:
                s.add(ChecklistItem(
                    project_id=p.id,
                    taxon_id=it.get("taxon_id", ""),
                    species_data_json=it.get("species_data_json", ""),
                    abundance=it.get("abundance", 0),
                    added_at=it.get("added_at", datetime.now().isoformat()),
                ))
            s.commit()
            imported_projects += 1

    return {"status": "ok", "preferences": len(prefs), "projects": imported_projects}
