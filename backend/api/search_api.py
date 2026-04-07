from fastapi import APIRouter, Query
from typing import Optional
import logging
import threading
from sqlmodel import Session, select, or_, col
from rapidfuzz import process, fuzz
from backend.models.schema import PlantName, PlantType, TaicolName
from backend.db import engine, get_session

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Fuzzy 俗名快取 ──────────────────────────────────────
_cname_cache: Optional[dict[str, list[int]]] = None  # {common_name_c: [name_id, ...]}
_cache_lock = threading.Lock()


def _get_cname_cache() -> dict[str, list[int]]:
    """Lazy load 俗名快取（accepted + in_taiwan）"""
    global _cname_cache
    if _cname_cache is not None:
        return _cname_cache

    with _cache_lock:
        if _cname_cache is not None:
            return _cname_cache

        cache: dict[str, list[int]] = {}
        try:
            with Session(engine) as session:
                rows = session.exec(
                    select(TaicolName.common_name_c, TaicolName.name_id)
                    .where(TaicolName.common_name_c != "")
                    .where(TaicolName.common_name_c.is_not(None))
                    .where(TaicolName.is_in_taiwan == "true")
                    .where(TaicolName.usage_status == "accepted")
                ).all()
                for cname, name_id in rows:
                    if cname not in cache:
                        cache[cname] = []
                    cache[cname].append(name_id)
        except Exception:
            logger.exception("Failed to load cname cache")

        _cname_cache = cache
        return _cname_cache


def invalidate_cname_cache():
    """TaiCOL 匯入後呼叫，清空快取"""
    global _cname_cache
    _cname_cache = None

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


def _escape_like(s: str) -> str:
    """跳脫 SQL LIKE 的特殊字元 % 和 _"""
    return s.replace("%", r"\%").replace("_", r"\_")


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
        "kingdom": row.kingdom or "",
        "phylum": row.phylum or "",
        "class_name": row.class_name or "",
        "order": row.order or "",
        "genus": row.genus or "",
        "genus_c": row.genus_c or "",
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


_dao_pt_name_cache: Optional[dict] = None

def _get_dao_pt_name(species_name: str) -> str:
    """從 dao_pnamelist_pg 查詢正確的中文 pt_name"""
    global _dao_pt_name_cache
    if _dao_pt_name_cache is None:
        _dao_pt_name_cache = {}
        try:
            with Session(engine) as session:
                rows = session.exec(
                    select(PlantName.name, PlantType.pt_name)
                    .join(PlantType, PlantName.plant_type == PlantType.plant_type)
                ).all()
                for name, pt_name in rows:
                    _dao_pt_name_cache[name] = pt_name
        except Exception:
            logger.exception("Failed to load dao pt_name cache")
    return _dao_pt_name_cache.get(species_name, "")


def _build_pt_name(row: TaicolName) -> str:
    """從分類階層組合 pt_name 顯示

    維管束植物優先從 dao_pnamelist_pg 查中文 pt_name（石松類植物、裸子植物等）
    """
    # 維管束植物：查舊表的中文 pt_name
    if row.phylum == "Tracheophyta" and row.simple_name:
        dao_pt = _get_dao_pt_name(row.simple_name)
        if dao_pt:
            return dao_pt

    # 其他類群：phylum > class
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
    q: Optional[str] = Query(None, max_length=512),
    group: Optional[str] = Query(None, max_length=50),
):
    if not q or len(q.strip()) == 0:
        return []

    q = q.strip()

    # 優先搜尋 TaiCOL 表
    if _check_taicol_table_exists():
        results = _search_taicol(q, group)

        # 結果不足時啟動 fuzzy match
        if len(results) < 5:
            fuzzy_results = _fuzzy_search(q, group, exclude_ids={r["id"] for r in results})
            results.extend(fuzzy_results)

        if results:
            return results[:30]

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
            pattern = f"%{_escape_like(v)}%"
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

        # 過濾：同俗名的 Species + nominal infraspecific 只保留 Species
        # 例如 玉山石竹 Dianthus pygmaeus (Species) vs Dianthus pygmaeus fo. pygmaeus (Form)
        cname_species_map: dict[str, str] = {}  # cname → simple_name of Species rank
        for row, _ in unique_entries:
            cn = row.common_name_c or ""
            if cn and row.rank == "Species":
                cname_species_map[cn] = row.simple_name or ""

        filtered_entries = []
        for acc_row, matched in unique_entries:
            cn = acc_row.common_name_c or ""
            rank = acc_row.rank or ""
            if cn and rank in ("Form", "Variety", "Subspecies") and cn in cname_species_map:
                sp_name = cname_species_map[cn]
                # 如果是 nominal infraspecific（學名以 Species 學名開頭），跳過
                if (acc_row.simple_name or "").startswith(sp_name):
                    continue
            filtered_entries.append((acc_row, matched))

        unique_entries = filtered_entries

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


def _fuzzy_search(q: str, group: Optional[str], exclude_ids: set[int] = None) -> list[dict]:
    """模糊比對搜尋：用 Levenshtein distance 對俗名快取做近似匹配

    策略：
    - 先找 edit distance ≤ 1 的候選（~11ms for 62k entries）
    - 若不足再放寬到 distance ≤ 2
    - 依 distance 排序，同 distance 按字串長度接近度排序
    """
    from rapidfuzz.distance import Levenshtein

    if not q or len(q) < 2:
        return []

    cache = _get_cname_cache()
    if not cache:
        return []

    names = list(cache.keys())

    # 第一輪：distance ≤ 1
    matches = [(n, Levenshtein.distance(q, n)) for n in names if Levenshtein.distance(q, n) <= 1]

    # 不足則放寬到 distance ≤ 2
    if len(matches) < 3 and len(q) >= 3:
        matches = [(n, Levenshtein.distance(q, n)) for n in names if Levenshtein.distance(q, n) <= 2]

    if not matches:
        return []

    # 排序：distance 小 → 長度接近 → 字母序
    matches.sort(key=lambda x: (x[1], abs(len(x[0]) - len(q)), x[0]))

    # 收集 name_id，去重
    matched_name_ids = []
    fuzzy_info = {}
    for matched_cname, dist in matches[:15]:
        for name_id in cache[matched_cname]:
            if exclude_ids and name_id in exclude_ids:
                continue
            if name_id not in fuzzy_info:
                matched_name_ids.append(name_id)
                fuzzy_info[name_id] = (q, matched_cname, dist)

    if not matched_name_ids:
        return []

    with Session(engine) as session:
        stmt = select(TaicolName).where(TaicolName.name_id.in_(matched_name_ids))

        if group and group in TAXON_GROUP_FILTERS:
            filters = TAXON_GROUP_FILTERS[group]
            for field, value in filters.items():
                stmt = stmt.where(getattr(TaicolName, field) == value)

        rows = session.exec(stmt).all()

        results = []
        for row in rows:
            resp = _taicol_to_response(row)
            fq, fc, fd = fuzzy_info.get(row.name_id, (q, "", 99))
            resp["fuzzy_match"] = {"query": fq, "matched": fc, "score": fd}
            results.append(resp)

        results.sort(key=lambda r: r.get("fuzzy_match", {}).get("score", 99))
        return results[:10]


def _search_legacy(q: str) -> list[dict]:
    """搜尋舊的 dao_pnamelist_pg 表（向下相容）"""
    with get_session() as session:
        stmt = (
            select(PlantName, PlantType)
            .join(PlantType, PlantName.plant_type == PlantType.plant_type)
            .where(
                or_(
                    PlantName.name.like(f"%{_escape_like(q)}%"),
                    PlantName.fullname.like(f"%{_escape_like(q)}%"),
                    PlantName.cname.like(f"%{_escape_like(q)}%"),
                    PlantName.family.like(f"%{_escape_like(q)}%"),
                    PlantName.family_cname.like(f"%{_escape_like(q)}%"),
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
