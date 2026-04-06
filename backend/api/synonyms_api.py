from fastapi import APIRouter, Query
from sqlmodel import Session, select
from backend.db import engine
from backend.models.schema import TaicolName

router = APIRouter()


@router.get("/api/synonyms",
            summary="查詢同物異名",
            description="依 taxon_id 查詢所有相關學名（含接受名、異名、誤用名）")
def get_synonyms(taxon_id: str = Query(...)):
    if not taxon_id:
        return []

    try:
        with Session(engine) as session:
            stmt = (
                select(TaicolName)
                .where(TaicolName.taxon_id == taxon_id)
                .order_by(TaicolName.usage_status != "accepted", TaicolName.simple_name)
            )
            rows = session.exec(stmt).all()

            return [
                {
                    "scientificName": row.simple_name or "",
                    "authorship": row.name_author or "",
                    "status": row.usage_status or "",
                    "source": "TaiCOL",
                    "commonName": row.common_name_c or "",
                }
                for row in rows
            ]
    except Exception:
        return []
