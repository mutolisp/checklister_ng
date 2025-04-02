# from typing import Optional, List
# from sqlmodel import SQLModel, Field, Relationship
# 
# 
# class PlantType(SQLModel, table=True):
#     id: int = Field(primary_key=True)
#     name_zh: str
#     name_en: str
# 
#     plants: List["PlantName"] = Relationship(back_populates="plant_type_obj")
# 
# 
# class PlantName(SQLModel, table=True):
#     id: Optional[int] = Field(default=None, primary_key=True)
#     family: str
#     family_cname: str
#     cname: str
#     name: str                          # 正規化學名（用 gnparser 處理）
#     fullname: str                      # 含命名人的完整學名
#     plant_type: int = Field(foreign_key="planttype.id")
#     endemic: Optional[bool] = False
#     iucn_category: Optional[str] = None
#     source: Optional[str] = None
# 
#     plant_type_obj: Optional[PlantType] = Relationship(back_populates="plants")
# 
# backend/models/schema.py

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

