from fastapi import APIRouter, Query
from typing import Optional
import logging
import threading
from sqlmodel import Session, select, or_, col, text
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
                    .where(TaicolName.is_in_taiwan.like("%true%"))
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

# alien_type → source 映射（cultured 依 kingdom 區分栽培/圈養）
ALIEN_TYPE_MAP = {
    "native": "原生",
    "naturalized": "歸化",
    "invasive": "歸化",
}

def _map_alien_type(alien_type: str, kingdom: str) -> str:
    if alien_type == "cultured":
        return "圈養" if kingdom == "Animalia" else "栽培"
    return ALIEN_TYPE_MAP.get(alien_type or "", alien_type or "")


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


def _is_autonym(simple_name: str, rank: str) -> bool:
    """判斷是否為 autonym（infraspecific epithet == specific epithet）"""
    if rank not in ("Subspecies", "Variety", "Form"):
        return False
    parts = simple_name.split()
    return len(parts) >= 3 and parts[1] == parts[-1]


def _mark_sensu_lato(results: list[dict]) -> list[dict]:
    """標記 sensu lato：Species rank 且 DB 中有 accepted infraspecific taxa"""
    species_names = [r["name"] for r in results if r.get("usage_status") == "accepted"
                     and not r.get("is_autonym") and r["name"] and " " in r["name"]
                     and r["name"].count(" ") == 1]  # binomial only
    if not species_names:
        return results

    # 批次查 DB：哪些 species 有 accepted infraspecific taxa
    with Session(engine) as session:
        sl_species = set()
        for sp_name in species_names:
            cnt = session.exec(text(
                "SELECT COUNT(*) FROM taicol_names "
                "WHERE simple_name LIKE :prefix AND usage_status='accepted' "
                "AND is_in_taiwan LIKE '%true%' "
                "AND rank IN ('Subspecies','Variety','Form')"
            ).bindparams(prefix=f"{sp_name} %")).one()
            if cnt[0] > 0:
                sl_species.add(sp_name)

    for r in results:
        if r["name"] in sl_species:
            r["is_sensu_lato"] = True

    return results


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
        "_raw_cname": row.common_name_c or "",  # 排序用，不含括號區分
        "family": row.family or "",
        "family_cname": row.family_c or "",
        "iucn_category": row.iucn or "",
        "redlist": row.redlist or "",
        "endemic": 1 if row.is_endemic == "true" else 0,
        "source": _map_alien_type(row.alien_type or "", row.kingdom or ""),
        "pt_name": _build_pt_name(row),
        "taxon_id": row.taxon_id or "",
        "usage_status": "accepted",
        "alternative_name_c": row.alternative_name_c or "",
        "kingdom": row.kingdom or "",
        "kingdom_c": getattr(row, "kingdom_c", "") or "",
        "phylum": row.phylum or "",
        "phylum_c": getattr(row, "phylum_c", "") or "",
        "class_name": row.class_name or "",
        "class_c": getattr(row, "class_c", "") or "",
        "order": row.order or "",
        "order_c": getattr(row, "order_c", "") or "",
        "genus": row.genus or "",
        "genus_c": row.genus_c or "",
        "nomenclature_name": getattr(row, "nomenclature_name", "") or "",
        "cites": getattr(row, "cites", "") or "",
        "is_fossil": getattr(row, "is_fossil", "") or "",
        "is_terrestrial": getattr(row, "is_terrestrial", "") or "",
        "is_freshwater": getattr(row, "is_freshwater", "") or "",
        "is_brackish": getattr(row, "is_brackish", "") or "",
        "is_marine": getattr(row, "is_marine", "") or "",
        "alien_status_note": getattr(row, "alien_status_note", "") or "",
        "protected": getattr(row, "protected", "") or "",
        "is_hybrid": getattr(row, "is_hybrid", "") or "",
        "rank": row.rank or "",
        "is_autonym": _is_autonym(row.simple_name or "", row.rank or ""),
        "is_sensu_lato": False,  # 由後處理填入
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
    rank_filter: Optional[str] = Query(None, max_length=20),
    endemic: Optional[str] = Query(None, max_length=10),
    alien_type: Optional[str] = Query(None, max_length=20),
    family_filter: Optional[str] = Query(None, max_length=100),
    order_filter: Optional[str] = Query(None, max_length=100),
    class_filter: Optional[str] = Query(None, max_length=100),
    genus_filter: Optional[str] = Query(None, max_length=100),
):
    if not q or len(q.strip()) == 0:
        return []

    q = q.strip()

    # 組裝進階篩選
    adv_filters = {}
    if rank_filter:
        adv_filters["rank"] = rank_filter
    if endemic == "true":
        adv_filters["is_endemic"] = "true"
    if alien_type:
        adv_filters["alien_type"] = alien_type
    if family_filter:
        adv_filters["family"] = family_filter
    if order_filter:
        adv_filters["order"] = order_filter
    if class_filter:
        adv_filters["class_name"] = class_filter
    if genus_filter:
        adv_filters["genus"] = genus_filter

    # 優先搜尋 TaiCOL 表
    if _check_taicol_table_exists():
        results = _search_taicol(q, group, adv_filters)

        # 結果不足時啟動 fuzzy match（只在無進階篩選時）
        if len(results) < 5 and not adv_filters:
            fuzzy_results = _fuzzy_search(q, group, exclude_ids={r["id"] for r in results})
            results.extend(fuzzy_results)

        if results:
            return _mark_sensu_lato(results[:30])

    # Fallback: 搜尋舊的 dao_pnamelist_pg（向下相容）
    if not group:
        return _search_legacy(q)

    return []


def _search_taicol(q: str, group: Optional[str], adv_filters: dict = None) -> list[dict]:
    """搜尋 TaiCOL 名錄。

    顯示邏輯：
    1. accepted name 直接顯示：俗名 (學名) 科名
    2. 透過 alternative_name_c 匹配：搜尋詞(主要俗名) (學名) 科名
    3. non-accepted name 匹配：顯示異名資訊 [non-accepted] → 接受名，選擇後加入的是 accepted
    """
    if adv_filters is None:
        adv_filters = {}

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
            .where(TaicolName.is_in_taiwan.like("%true%"))
            .limit(100)
        )

        # 分類群篩選
        if group and group in TAXON_GROUP_FILTERS:
            filters = TAXON_GROUP_FILTERS[group]
            for field, value in filters.items():
                stmt = stmt.where(getattr(TaicolName, field) == value)

        # 進階篩選
        if "rank" in adv_filters:
            rank_val = adv_filters["rank"]
            if rank_val == "infraspecies":
                stmt = stmt.where(TaicolName.rank.in_(["Subspecies", "Variety", "Form"]))
            else:
                stmt = stmt.where(TaicolName.rank == rank_val)
        if "is_endemic" in adv_filters:
            stmt = stmt.where(TaicolName.is_endemic == adv_filters["is_endemic"])
        if "alien_type" in adv_filters:
            stmt = stmt.where(TaicolName.alien_type == adv_filters["alien_type"])
        if "family" in adv_filters:
            stmt = stmt.where(TaicolName.family == adv_filters["family"])
        if "order" in adv_filters:
            stmt = stmt.where(TaicolName.order == adv_filters["order"])
        if "class_name" in adv_filters:
            stmt = stmt.where(TaicolName.class_name == adv_filters["class_name"])
        if "genus" in adv_filters:
            stmt = stmt.where(TaicolName.genus == adv_filters["genus"])

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
                .where(TaicolName.is_in_taiwan.like("%true%"))
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

            # 同俗名多物種區分：只在有替代俗名時加括號
            elif cn and cname_counts.get(cn, 0) > 1:
                alt = acc_row.alternative_name_c or ""
                first_alt = alt.split(",")[0].strip() if alt else ""
                if first_alt:
                    display_cname = f"{cn}({first_alt})"

            results.append(_taicol_to_response(acc_row, display_cname, matched_non_acc))

        # 排序：精確匹配優先 → 前綴匹配 → 其他
        def _sort_key(r):
            raw_cname = r.get("_raw_cname", "")
            alt_names = r.get("alternative_name_c", "") or ""
            name = r.get("name", "")
            # 1. common_name_c 精確匹配
            exact_cname = 0 if raw_cname == q else 1
            # 2. scientific name 精確匹配
            exact_name = 0 if name == q else 1
            # 3. common_name_c 包含搜尋詞
            cname_contains = 0 if q in raw_cname else 1
            # 4. alternative_name_c 精確匹配（某個 alt name 等於搜尋詞）
            alt_exact = 0 if any(a.strip() == q for a in alt_names.split(",")) else 1
            # 5. alternative_name_c 包含搜尋詞
            alt_contains = 0 if q in alt_names else 1
            # 6. cname 以搜尋詞開頭
            prefix = 0 if raw_cname.startswith(q) else 1
            # 7. 名稱長度（短的更相關）
            return (exact_cname, exact_name, cname_contains, alt_exact, alt_contains, prefix, len(raw_cname), raw_cname)

        results.sort(key=_sort_key)
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


@router.get("/api/search/rank")
def search_by_rank(
    q: str = Query(..., max_length=512),
    rank: str = Query(..., max_length=20),
    group: Optional[str] = Query(None, max_length=50),
):
    """篩選面板用：依指定 rank 搜尋，回傳簡單結果"""
    if not q or len(q.strip()) < 1:
        return []

    q = q.strip()
    variants = _normalize_tw(q)

    with Session(engine) as session:
        like_conditions = []
        for v in variants:
            pattern = f"%{_escape_like(v)}%"
            like_conditions.extend([
                TaicolName.common_name_c.like(pattern),
                TaicolName.simple_name.like(pattern),
            ])
            if rank == "Family":
                like_conditions.append(TaicolName.family_c.like(pattern))
                like_conditions.append(TaicolName.family.like(pattern))
            if rank == "Genus":
                like_conditions.append(TaicolName.genus_c.like(pattern))

        stmt = (
            select(TaicolName)
            .where(or_(*like_conditions))
            .where(TaicolName.is_in_taiwan.like("%true%"))
            .where(TaicolName.usage_status == "accepted")
            .where(TaicolName.rank == rank)
            .limit(20)
        )

        if group and group in TAXON_GROUP_FILTERS:
            for field, value in TAXON_GROUP_FILTERS[group].items():
                stmt = stmt.where(getattr(TaicolName, field) == value)

        rows = session.exec(stmt).all()

        seen = set()
        results = []
        for row in rows:
            key = row.simple_name
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "name": row.simple_name or "",
                "cname": row.common_name_c or "",
                "family": row.family or "",
                "family_cname": row.family_c or "",
                "genus": row.genus or "",
                "genus_c": row.genus_c or "",
                "order": row.order or "",
                "order_c": getattr(row, "order_c", "") or "",
                "class_name": row.class_name or "",
                "class_c": getattr(row, "class_c", "") or "",
                "kingdom": row.kingdom or "",
                "kingdom_c": getattr(row, "kingdom_c", "") or "",
                "phylum": row.phylum or "",
                "phylum_c": getattr(row, "phylum_c", "") or "",
            })
        return results


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
