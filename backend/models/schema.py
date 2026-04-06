from typing import Optional
from sqlmodel import SQLModel, Field, Relationship


class PlantType(SQLModel, table=True):
    __tablename__ = "dao_plant_type"

    plant_type: int = Field(primary_key=True)
    pt_name: str

    plants: list["PlantName"] = Relationship(back_populates="plant_type_obj")


class PlantName(SQLModel, table=True):
    __tablename__ = "dao_pnamelist_pg"

    id: Optional[int] = Field(default=None, primary_key=True)
    family: str
    family_cname: str
    cname: str
    name: str
    fullname: str
    plant_type: int = Field(foreign_key="dao_plant_type.plant_type")
    endemic: Optional[int]  # 0 or 1
    iucn_category: Optional[str]
    source: Optional[str]

    plant_type_obj: Optional[PlantType] = Relationship(back_populates="plants")

