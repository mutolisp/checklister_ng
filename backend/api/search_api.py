from fastapi import APIRouter, Query
from typing import Optional
from sqlmodel import Session, select, or_, col
from backend.models.schema import PlantName, PlantType, TaicolName
from backend.db import engine, get_session

router = APIRouter()

# 分類群篩選器對照表
TAXON_GROUP_FILTERS = {
    "Tracheophyta": {"phylum": "Tracheophyta"},
    "Plantae": {"kingdom": "Plantae"},
    "Aves": {"class_name": "Aves"},
    "Fungi": {"kingdom": "Fungi"},
    "Mammalia": {"class_name": "Mammalia"},
    "Reptilia": {"class_name": "Reptilia"},
    "Insecta": {"class_name": "Insecta"},
    "Arachnida": {"class_name": "Arachnida"},
    "Mollusca": {"phylum": "Mollusca"},
    "Actinopterygii": {"class_name": "Actinopterygii"},
    "Amphibia": {"class_name": "Amphibia"},
    "Protozoa": {"kingdom": "Protozoa"},
    "Animalia": {"kingdom": "Animalia"},
}

# alien_type → source 映射
ALIEN_TYPE_MAP = {
    "native": "原生",
    "naturalized": "歸化",
    "invasive": "歸化",
    "cultured": "栽培",
}


def _normalize_tw(q: str) -> list[str]:
    """台/臺自動互換，回傳查詢變體"""
    variants = [q]
    if "台" in q:
        variants.append(q.replace("台", "臺"))
    elif "臺" in q:
        variants.append(q.replace("臺", "台"))
    return variants


def _taicol_to_response(
    row: TaicolName,
    display_cname: str = "",
    matched_row: TaicolName = None,
) -> dict:
    """TaicolName → 前端相容的回應格式

    Args:
        row: accepted name 的資料（加入名錄用）
        display_cname: 顯示用俗名（含括號區分）
        matched_row: 原始匹配到的 row（若為 non-accepted，用來顯示異名資訊）
    """
    fullname = row.simple_name or ""
    if row.name_author:
        fullname = f"{row.simple_name} {row.name_author}"

    result = {
        "id": row.name_id,
        "name": row.simple_name,
        "fullname": fullname,
        "cname": display_cname or row.common_name_c or "",
        "family": row.family or "",
        "family_cname": row.family_c or "",
        "iucn_category": row.redlist or row.iucn or "",
        "endemic": 1 if row.is_endemic == "true" else 0,
        "source": ALIEN_TYPE_MAP.get(row.alien_type or "", row.alien_type or ""),
        "pt_name": _build_pt_name(row),
        "taxon_id": row.taxon_id or "",
        "usage_status": "accepted",
        "alternative_name_c": row.alternative_name_c or "",
    }

    # 若原始匹配是 non-accepted，附上異名資訊供前端顯示
    if matched_row and matched_row.usage_status != "accepted":
        matched_fullname = matched_row.simple_name or ""
        if matched_row.name_author:
            matched_fullname = f"{matched_row.simple_name} {matched_row.name_author}"
        result["matched_as"] = {
            "name": matched_row.simple_name,
            "fullname": matched_fullname,
            "status": matched_row.usage_status,
        }

    return result


def _build_pt_name(row: TaicolName) -> str:
    """從分類階層組合 pt_name 顯示"""
    parts = []
    if row.phylum:
        parts.append(row.phylum)
    if row.class_name:
        parts.append(row.class_name)
    return " > ".join(parts) if parts else row.kingdom or ""


def _check_taicol_table_exists() -> bool:
    """檢查 taicol_names 表是否存在"""
    try:
        with Session(engine) as session:
            session.exec(select(TaicolName).limit(1)).first()
            return True
    except Exception:
        return False


@router.get("/api/search")
def search_species(
    q: Optional[str] = Query(None),
    group: Optional[str] = Query(None),
):
    if not q or len(q.strip()) == 0:
        return []

    q = q.strip()

    # 優先搜尋 TaiCOL 表
    if _check_taicol_table_exists():
        results = _search_taicol(q, group)
        if results:
            return results

    # Fallback: 搜尋舊的 dao_pnamelist_pg（向下相容）
    if not group:
        return _search_legacy(q)

    return []


def _search_taicol(q: str, group: Optional[str]) -> list[dict]:
    """搜尋 TaiCOL 名錄。

    顯示邏輯：
    1. accepted name 直接顯示：俗名 (學名) 科名
    2. 透過 alternative_name_c 匹配：搜尋詞(主要俗名) (學名) 科名
    3. non-accepted name 匹配：顯示異名資訊 [non-accepted] → 接受名，選擇後加入的是 accepted
    """
    variants = _normalize_tw(q)

    with Session(engine) as session:
        # 建構 LIKE 條件（含台/臺互換）
        like_conditions = []
        for v in variants:
            pattern = f"%{v}%"
            like_conditions.extend([
                TaicolName.common_name_c.like(pattern),
                TaicolName.alternative_name_c.like(pattern),
                TaicolName.simple_name.like(pattern),
                TaicolName.family.like(pattern),
                TaicolName.family_c.like(pattern),
            ])

        stmt = (
            select(TaicolName)
            .where(or_(*like_conditions))
            .where(TaicolName.is_in_taiwan == "true")
            .limit(100)
        )

        # 分類群篩選
        if group and group in TAXON_GROUP_FILTERS:
            filters = TAXON_GROUP_FILTERS[group]
            for field, value in filters.items():
                stmt = stmt.where(getattr(TaicolName, field) == value)

        rows = session.exec(stmt).all()

        # 分類：accepted vs non-accepted
        accepted_rows: list[tuple[TaicolName, TaicolName | None]] = []  # (accepted_row, matched_non_accepted_row)
        non_accepted_rows: list[TaicolName] = []

        for row in rows:
            if row.usage_status == "accepted":
                accepted_rows.append((row, None))
            elif row.taxon_id:
                non_accepted_rows.append(row)

        # 解析 non-accepted → accepted name
        seen_taxon_ids = {r.taxon_id for r, _ in accepted_rows if r.taxon_id}
        need_resolve = {}
        for row in non_accepted_rows:
            if row.taxon_id not in seen_taxon_ids and row.taxon_id not in need_resolve:
                need_resolve[row.taxon_id] = row  # 保留原始 non-accepted row

        if need_resolve:
            resolved = session.exec(
                select(TaicolName)
                .where(TaicolName.taxon_id.in_(list(need_resolve.keys())))
                .where(TaicolName.usage_status == "accepted")
                .where(TaicolName.is_in_taiwan == "true")
            ).all()
            for acc_row in resolved:
                matched_non_acc = need_resolve.get(acc_row.taxon_id)
                accepted_rows.append((acc_row, matched_non_acc))

        # 去重（同一個 taxon_id 只留一筆，優先保留直接 accepted match）
        seen = set()
        unique_entries: list[tuple[TaicolName, TaicolName | None]] = []
        for acc_row, matched in accepted_rows:
            key = acc_row.taxon_id or acc_row.name_id
            if key not in seen:
                seen.add(key)
                unique_entries.append((acc_row, matched))

        # 判斷俗名是透過 common_name_c 還是 alternative_name_c 匹配
        def _match_is_alt_name(row: TaicolName) -> bool:
            cn = row.common_name_c or ""
            alt = row.alternative_name_c or ""
            for v in variants:
                if v in cn:
                    return False
                if v in alt:
                    return True
            return False

        # 同俗名統計（用於區分同俗名不同物種）
        cname_counts: dict[str, int] = {}
        for row, _ in unique_entries:
            cn = row.common_name_c or ""
            if cn:
                cname_counts[cn] = cname_counts.get(cn, 0) + 1

        # 組裝結果
        results = []
        for acc_row, matched_non_acc in unique_entries:
            cn = acc_row.common_name_c or ""
            display_cname = cn

            # 情境 2：透過 alternative_name_c 匹配 → 搜尋詞(主要俗名)
            if _match_is_alt_name(acc_row) and cn:
                # 找出匹配到的 alt name
                alt = acc_row.alternative_name_c or ""
                matched_alt = ""
                for v in variants:
                    for a in alt.split(","):
                        if v in a.strip():
                            matched_alt = a.strip()
                            break
                    if matched_alt:
                        break
                if matched_alt and matched_alt != cn:
                    display_cname = f"{matched_alt}({cn})"

            # 同俗名多物種區分
            elif cn and cname_counts.get(cn, 0) > 1:
                alt = acc_row.alternative_name_c or ""
                first_alt = alt.split(",")[0].strip() if alt else ""
                if first_alt:
                    display_cname = f"{cn}({first_alt})"
                else:
                    display_cname = f"{cn}({acc_row.simple_name})"

            results.append(_taicol_to_response(acc_row, display_cname, matched_non_acc))

        results.sort(key=lambda r: (not r["cname"], r["cname"]))
        return results[:30]


def _search_legacy(q: str) -> list[dict]:
    """搜尋舊的 dao_pnamelist_pg 表（向下相容）"""
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
                "name": plant.name,
                "fullname": plant.fullname,
                "cname": plant.cname,
                "family": plant.family,
                "family_cname": plant.family_cname,
                "iucn_category": plant.iucn_category,
                "endemic": plant.endemic,
                "source": plant.source,
                "pt_name": ptype.pt_name,
                "taxon_id": "",
                "usage_status": "accepted",
            }
            for plant, ptype in results
        ]
