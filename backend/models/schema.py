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


class TaicolName(SQLModel, table=True):
    __tablename__ = "taicol_names"

    name_id: int = Field(primary_key=True)
    rank: Optional[str] = None
    simple_name: Optional[str] = None
    name_author: Optional[str] = None
    formatted_name: Optional[str] = None
    usage_status: Optional[str] = None
    taxon_id: Optional[str] = None
    taxon_id_all: Optional[str] = None  # 原始多值 taxon_id
    is_in_taiwan: Optional[str] = None
    common_name_c: Optional[str] = None
    alternative_name_c: Optional[str] = None
    is_endemic: Optional[str] = None
    alien_type: Optional[str] = None
    iucn: Optional[str] = None
    redlist: Optional[str] = None
    kingdom: Optional[str] = None
    phylum: Optional[str] = None
    class_name: Optional[str] = Field(default=None, sa_column_kwargs={"name": "class"})
    order: Optional[str] = None
    family: Optional[str] = None
    family_c: Optional[str] = None
    genus: Optional[str] = None
    genus_c: Optional[str] = None
    nomenclature_name: Optional[str] = None
    cites: Optional[str] = None
    is_fossil: Optional[str] = None
    is_terrestrial: Optional[str] = None
    is_freshwater: Optional[str] = None
    is_brackish: Optional[str] = None
    is_marine: Optional[str] = None
    alien_status_note: Optional[str] = None

