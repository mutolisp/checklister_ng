from fastapi import APIRouter, Query, Depends
from typing import Optional
from sqlmodel import Session, select
from backend.db import get_session
from backend.models.schema import PlantName, PlantType

router = APIRouter()

@router.get("/api/resolve_name")
def resolve_name(q: Optional[str] = Query(None), session: Session = Depends(get_session)):
    if not q or len(q.strip()) == 0:
        return []

    query = (
        select(PlantName, PlantType)
        .join(PlantType, PlantName.plant_type == PlantType.plant_type)
        .where(PlantName.cname.like(f"%{q}%"))
        .limit(10)
    )
    results = session.exec(query).all()
    return [
        {
            "id": plant.id,
            "name": plant.name,
            "fullname": plant.fullname,
            "cname": plant.cname,
            "family": plant.family,
            "family_cname": plant.family_cname,
            "pt_name": ptype.pt_name,
            "establishmentMeans": plant.source,
            "threatStatus": plant.iucn_category,
            "endemic": plant.endemic
        }
        for plant, ptype in results
    ]
