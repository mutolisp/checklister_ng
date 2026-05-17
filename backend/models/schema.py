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


class IdentificationKey(SQLModel, table=True):
    """檢索表（科 / 屬 / 任意 scope），可巢狀（parent_key_id 指 subkey 的 root）。

    mode:
      - 'dichotomous'：對偶式
      - 'multi_access'：多進入式（feature matrix）
      - 'both'：兩種資料都有
    """
    __tablename__ = "identification_keys"

    id: Optional[int] = Field(default=None, primary_key=True)
    scope_taxon_id: Optional[str] = Field(default=None, index=True)
    scope_rank: str = Field(index=True)  # 'family' | 'genus' | 'subfamily' | ...
    scope_name: str = Field(index=True)  # latin, e.g. "Selaginellaceae"
    scope_cname: Optional[str] = None    # 卷柏科
    title: str
    source: Optional[str] = None         # 'PDF:filename' | 'Sheets:url' | 'manual'
    mode: str = Field(default="dichotomous")
    parent_key_id: Optional[int] = Field(
        default=None, index=True, foreign_key="identification_keys.id"
    )
    notes: Optional[str] = None
    aliases: Optional[str] = None        # JSON array string, extra names for findSubkey fallback
    updated_at: Optional[int] = None     # epoch ms


class KeyCouplet(SQLModel, table=True):
    """Dichotomous key 的單一 couplet（兩個 lead）。"""
    __tablename__ = "key_couplets"

    id: Optional[int] = Field(default=None, primary_key=True)
    key_id: int = Field(foreign_key="identification_keys.id", index=True)
    number: int  # couplet 編號（key 內唯一）

    lead_a_text: str
    lead_a_target_type: str  # 'couplet' | 'taxon' | 'subkey' | 'unresolved'
    lead_a_target_id: Optional[str] = None  # couplet number / taxon_id / subkey id
    lead_a_taxon_marker: Optional[str] = None  # '*', '#' 等
    lead_a_taxon_status: Optional[str] = None  # IUCN code 快照

    lead_b_text: str
    lead_b_target_type: str
    lead_b_target_id: Optional[str] = None
    lead_b_taxon_marker: Optional[str] = None
    lead_b_taxon_status: Optional[str] = None


class KeyFeature(SQLModel, table=True):
    """Multi-access key 的特徵定義。"""
    __tablename__ = "key_features"

    id: Optional[int] = Field(default=None, primary_key=True)
    key_id: int = Field(foreign_key="identification_keys.id", index=True)
    name: str
    type: str  # 'categorical' | 'numeric' | 'boolean'
    values_json: Optional[str] = None  # JSON array of allowed categorical values
    category: Optional[str] = None     # 分組 e.g. "營養器官"
    sort_order: Optional[int] = None


class KeyTaxonFeature(SQLModel, table=True):
    """Multi-access key 的 taxon × feature 矩陣（同一格可多 row 表多值）。"""
    __tablename__ = "key_taxon_features"

    id: Optional[int] = Field(default=None, primary_key=True)
    key_id: int = Field(foreign_key="identification_keys.id", index=True)
    taxon_id: str = Field(index=True)
    feature_id: int = Field(foreign_key="key_features.id", index=True)
    value: str


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
    kingdom_c: Optional[str] = None
    phylum: Optional[str] = None
    phylum_c: Optional[str] = None
    class_name: Optional[str] = Field(default=None, sa_column_kwargs={"name": "class"})
    class_c: Optional[str] = None
    order: Optional[str] = None
    order_c: Optional[str] = None
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
    protected: Optional[str] = None
    is_hybrid: Optional[str] = None

