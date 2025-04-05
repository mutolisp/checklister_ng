from fastapi import APIRouter, Query
from typing import Optional
from sqlmodel import select, or_
from backend.models.schema import PlantName, PlantType
from backend.db import get_session

router = APIRouter()

@router.get("/api/search")
def search_species(q: Optional[str] = Query(None)):
    if not q or len(q.strip()) == 0:
        return []
    with get_session() as session:
        stmt = (
            select(PlantName, PlantType)
            .join(PlantType, PlantName.plant_type == PlantType.plant_type)
            .where(
                or_(
                    PlantName.name.like(f"%{q}%"),
                    PlantName.fullname.like(f"%{q}%"),
                    PlantName.cname.like(f"%{q}%"),
                    PlantName.family.like(f"%{q}%"),
                    PlantName.family_cname.like(f"%{q}%"),
                )
            )
            .limit(30)
        )
        results = session.exec(stmt).all()
        return [
            {
                "id": plant.id,
                "fullname": plant.fullname,
                "cname": plant.cname,
                "family": plant.family,
                "family_cname": plant.family_cname,
                "iucn_category": plant.iucn_category,
                "endemic": plant.endemic,
                "source": plant.source,
                "pt_name": ptype.pt_name
            }
            for plant, ptype in results
        ]

@router.get("/api/debug")
def debug_sample():
    from backend.models.schema import PlantName
    from backend.db import get_session
    with get_session() as session:
        stmt = select(PlantName).limit(5)
        results = session.exec(stmt).all()
        return [r.dict() for r in results]

