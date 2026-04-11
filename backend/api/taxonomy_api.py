import logging
from typing import Optional
from fastapi import APIRouter, Query
from sqlmodel import Session, text
from backend.db import engine

logger = logging.getLogger(__name__)

router = APIRouter()

# 階層順序
RANK_ORDER = ["kingdom", "phylum", "class", "order", "family", "genus"]
RANK_LABELS = {
    "kingdom": "界",
    "phylum": "門",
    "class": "綱",
    "order": "目",
    "family": "科",
    "genus": "屬",
    "species": "種",
    "realm": "病毒域",
}

# 各階層對應的 common name 欄位
RANK_C_COL = {
    "kingdom": "kingdom_c",
    "phylum": "phylum_c",
    "class": "class_c",
    "order": "order_c",
    "family": "family_c",
    "genus": "genus_c",
}

# ── 病毒處理 ──
# 病毒 kingdom 值 → 所屬 Realm（TaiCOL API 查得）
VIRUS_KINGDOM_TO_REALM = {
    "Bamfordvirae": "Varidnaviria",
    "Heunggongvirae": "Duplodnaviria",
    "Orthornavirae": "Riboviria",
    "Pararnavirae": "Riboviria",
    "Shotokuvirae": "Monodnaviria",
}

# 所有病毒 kingdom 值（含 incertae sedis）
VIRUS_KINGDOMS = set(VIRUS_KINGDOM_TO_REALM.keys()) | {
    "Ribozyviria kingdom incertae sedis",
    "Viruses kingdom incertae sedis",
}

# Realm 列表（含 incertae sedis）
VIRUS_REALMS = {
    "Duplodnaviria", "Monodnaviria", "Riboviria",
    "Ribozyviria", "Varidnaviria",
    "Viruses realm incertae sedis",
}

def _is_virus_kingdom(name: str) -> bool:
    return name in VIRUS_KINGDOMS


def _build_stats_sql(rank_idx: int) -> list[str]:
    """建構子層級統計欄位"""
    stats_cols = []
    for r in RANK_ORDER[rank_idx + 1:]:
        r_col = '"order"' if r == "order" else '"class"' if r == "class" else r
        stats_cols.append(f'COUNT(DISTINCT {r_col}) as {r}_count')
    stats_cols.append("SUM(CASE WHEN rank='Species' THEN 1 ELSE 0 END) as species_count")
    stats_cols.append("SUM(CASE WHEN rank IN ('Subspecies','Variety','Form') THEN 1 ELSE 0 END) as infraspecific_count")
    return stats_cols


def _build_stats_dict(row_dict: dict, rank_idx: int) -> dict:
    """從查詢結果組裝 stats"""
    stats = {}
    for r in RANK_ORDER[rank_idx + 1:]:
        count_key = f"{r}_count"
        if count_key in row_dict:
            stats[RANK_LABELS.get(r, r)] = row_dict[count_key]
    stats["種"] = row_dict.get("species_count", 0)
    infra = row_dict.get("infraspecific_count", 0)
    if infra:
        stats["種下"] = infra
    return stats


@router.get("/api/taxonomy/children",
            summary="取得分類樹子節點",
            description="Lazy-load 分類階層的子節點及統計")
def get_children(
    rank: str = Query(..., description="要查詢的階層: kingdom, realm, phylum, class, order, family, genus, species"),
    parent_rank: Optional[str] = Query(None),
    parent_value: Optional[str] = Query(None),
):
    try:
        with Session(engine) as session:
            # ── 頂層 kingdom 查詢：拆分非病毒 + 病毒頂層 ──
            if rank == "kingdom" and not parent_rank:
                return _get_top_level(session)

            # ── 病毒: realm → kingdom ──
            if rank == "realm":
                return _get_virus_realms(session)

            if rank == "virus_kingdom" and parent_rank == "realm":
                return _get_virus_kingdoms_in_realm(session, parent_value or "")

            # 建構 parent filter
            parent_filters = {}
            if parent_rank and parent_value and isinstance(parent_rank, str):
                db_col = "class" if parent_rank == "class" else parent_rank
                parent_filters[db_col] = parent_value

            # Species 層：回傳物種列表
            if rank == "species":
                return _get_species_list(session, parent_filters)

            # 其他層：分群統計
            db_rank_col = '"order"' if rank == "order" else '"class"' if rank == "class" else rank

            stats_cols = _build_stats_sql(RANK_ORDER.index(rank))

            c_col = RANK_C_COL.get(rank, "")
            extra_cols = f", MAX({c_col}) as name_c" if c_col else ""

            where = "WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank IN ('Species','Subspecies','Variety','Form')"
            for col, val in parent_filters.items():
                safe_col = f'"{col}"' if col in ("order", "class") else col
                where += f" AND {safe_col} = :parent_{col}"

            sql = f"""
                SELECT {db_rank_col} as name, {', '.join(stats_cols)} {extra_cols}
                FROM taicol_names
                {where}
                GROUP BY {db_rank_col}
                HAVING name IS NOT NULL AND name != ''
                ORDER BY name
            """

            params = {f"parent_{col}": val for col, val in parent_filters.items()}
            rows = session.exec(text(sql).bindparams(**params)).all()

            rank_idx = RANK_ORDER.index(rank)
            child_rank = RANK_ORDER[rank_idx + 1] if rank_idx + 1 < len(RANK_ORDER) else "species"

            results = []
            for row in rows:
                row_dict = dict(row._mapping)
                name = row_dict["name"]

                stats = _build_stats_dict(row_dict, rank_idx)
                name_c = row_dict.get("name_c", "") or ""

                results.append({
                    "name": name,
                    "name_c": name_c,
                    "rank": RANK_LABELS.get(rank, rank),
                    "rank_key": rank,
                    "child_rank": child_rank,
                    "stats": stats,
                })

            return results

    except Exception:
        logger.exception(f"Taxonomy children query failed: rank={rank}")
        return []


def _get_top_level(session) -> list:
    """頂層：非病毒 kingdom + 病毒虛擬頂層節點"""
    # 非病毒 kingdom
    virus_kingdom_list = ", ".join(f"'{k}'" for k in VIRUS_KINGDOMS)

    stats_cols = _build_stats_sql(0)
    c_col = RANK_C_COL["kingdom"]

    sql = f"""
        SELECT kingdom as name, {', '.join(stats_cols)}, MAX({c_col}) as name_c
        FROM taicol_names
        WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%'
        AND rank IN ('Species','Subspecies','Variety','Form')
        AND kingdom NOT IN ({virus_kingdom_list})
        GROUP BY kingdom
        HAVING name IS NOT NULL AND name != ''
        ORDER BY name
    """
    rows = session.exec(text(sql)).all()

    results = []
    for row in rows:
        row_dict = dict(row._mapping)
        results.append({
            "name": row_dict["name"],
            "name_c": row_dict.get("name_c", "") or "",
            "rank": "界",
            "rank_key": "kingdom",
            "child_rank": "phylum",
            "stats": _build_stats_dict(row_dict, 0),
        })

    # 病毒虛擬頂層
    virus_sql = f"""
        SELECT {', '.join(stats_cols)}
        FROM taicol_names
        WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%'
        AND rank IN ('Species','Subspecies','Variety','Form')
        AND kingdom IN ({virus_kingdom_list})
    """
    vrow = session.exec(text(virus_sql)).first()
    if vrow:
        vd = dict(vrow._mapping)
        virus_stats = _build_stats_dict(vd, 0)
        # 加 realm 數
        virus_stats = {"病毒域": len(VIRUS_REALMS) - 1, **virus_stats}  # -1 因為 incertae sedis 合併
        results.append({
            "name": "Viruses",
            "name_c": "病毒",
            "rank": "未定",
            "rank_key": "viruses",
            "child_rank": "realm",
            "stats": virus_stats,
        })

    return results


def _get_virus_realms(session) -> list:
    """病毒: Realm 層"""
    # 每個 realm 底下有哪些 kingdom
    realm_kingdoms: dict[str, list[str]] = {}
    for k, r in VIRUS_KINGDOM_TO_REALM.items():
        realm_kingdoms.setdefault(r, []).append(k)
    # incertae sedis kingdoms
    incertae_kingdoms = [k for k in VIRUS_KINGDOMS if "incertae" in k]

    results = []
    stats_cols = _build_stats_sql(0)

    for realm_name in sorted(VIRUS_REALMS):
        if realm_name == "Viruses realm incertae sedis":
            kingdoms = incertae_kingdoms
        else:
            kingdoms = realm_kingdoms.get(realm_name, [])
            # Ribozyviria realm 底下沒有 kingdom mapping，但有 incertae sedis
            ribo_inc = [k for k in VIRUS_KINGDOMS if k.startswith(realm_name) and "incertae" in k]
            kingdoms = kingdoms + ribo_inc

        if not kingdoms:
            continue

        k_list = ", ".join(f"'{k}'" for k in kingdoms)
        sql = f"""
            SELECT {', '.join(stats_cols)},
                   COUNT(DISTINCT kingdom) as kingdom_count
            FROM taicol_names
            WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%'
            AND rank IN ('Species','Subspecies','Variety','Form')
            AND kingdom IN ({k_list})
        """
        row = session.exec(text(sql)).first()
        if not row:
            continue
        rd = dict(row._mapping)
        if rd.get("species_count", 0) == 0:
            continue

        stats = {"界": rd.get("kingdom_count", 0)}
        stats.update(_build_stats_dict(rd, 0))

        results.append({
            "name": realm_name,
            "name_c": "",
            "rank": "病毒域",
            "rank_key": "realm",
            "child_rank": "virus_kingdom",
            "stats": stats,
        })

    return results


def _get_virus_kingdoms_in_realm(session, realm_name: str) -> list:
    """病毒: 特定 Realm 底下的 Kingdom"""
    if realm_name == "Viruses realm incertae sedis":
        kingdoms = [k for k in VIRUS_KINGDOMS if "incertae" in k]
    else:
        kingdoms = [k for k, r in VIRUS_KINGDOM_TO_REALM.items() if r == realm_name]
        ribo_inc = [k for k in VIRUS_KINGDOMS if k.startswith(realm_name) and "incertae" in k]
        kingdoms = kingdoms + ribo_inc

    if not kingdoms:
        return []

    stats_cols = _build_stats_sql(0)
    c_col = RANK_C_COL["kingdom"]
    k_list = ", ".join(f"'{k}'" for k in kingdoms)

    sql = f"""
        SELECT kingdom as name, {', '.join(stats_cols)}, MAX({c_col}) as name_c
        FROM taicol_names
        WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%'
        AND rank IN ('Species','Subspecies','Variety','Form')
        AND kingdom IN ({k_list})
        GROUP BY kingdom
        HAVING name IS NOT NULL AND name != ''
        ORDER BY name
    """
    rows = session.exec(text(sql)).all()

    results = []
    for row in rows:
        rd = dict(row._mapping)
        results.append({
            "name": rd["name"],
            "name_c": rd.get("name_c", "") or "",
            "rank": "界",
            "rank_key": "kingdom",
            "child_rank": "phylum",
            "stats": _build_stats_dict(rd, 0),
        })
    return results


@router.get("/api/taxonomy/search",
            summary="分類樹搜尋",
            description="搜尋分類名稱，回傳匹配結果及其分類路徑")
def taxonomy_search(q: str = Query(..., max_length=512)):
    if not q or len(q.strip()) < 2:
        return []

    q = q.strip()
    variants = [q]
    if "台" in q:
        variants.append(q.replace("台", "臺"))
    elif "臺" in q:
        variants.append(q.replace("臺", "台"))

    try:
        with Session(engine) as session:
            like_conditions = []
            params = {}
            for i, v in enumerate(variants):
                like_conditions.append(f"common_name_c LIKE :q{i}")
                like_conditions.append(f"simple_name LIKE :q{i}")
                like_conditions.append(f"family_c LIKE :q{i}")
                like_conditions.append(f"family LIKE :q{i}")
                like_conditions.append(f"genus LIKE :q{i}")
                like_conditions.append(f"genus_c LIKE :q{i}")
                params[f"q{i}"] = f"%{v}%"

            sql = f"""
                SELECT DISTINCT simple_name, common_name_c, rank,
                       kingdom, kingdom_c, phylum, phylum_c,
                       class as class_name, class_c,
                       "order", order_c,
                       family, family_c, genus, genus_c,
                       name_author
                FROM taicol_names
                WHERE ({' OR '.join(like_conditions)})
                AND usage_status='accepted' AND is_in_taiwan LIKE '%true%'
                AND rank IN ('Species', 'Subspecies', 'Variety', 'Genus', 'Family', 'Order', 'Class', 'Phylum')
                ORDER BY
                    CASE rank
                        WHEN 'Phylum' THEN 1
                        WHEN 'Class' THEN 2
                        WHEN 'Order' THEN 3
                        WHEN 'Family' THEN 4
                        WHEN 'Genus' THEN 5
                        ELSE 6
                    END,
                    simple_name
                LIMIT 20
            """

            rows = session.exec(text(sql).bindparams(**params)).all()

            results = []
            for row in rows:
                r = dict(row._mapping)
                cname = r.get("common_name_c", "") or ""
                sname = r.get("simple_name", "") or ""
                rank = r.get("rank", "") or ""

                if cname:
                    display = f"{cname} ({sname})"
                else:
                    display = sname

                # 分類路徑
                path = []
                kingdom = r.get("kingdom", "") or ""

                # 病毒需要加 Viruses → Realm 前綴
                if _is_virus_kingdom(kingdom):
                    path.append({"rank": "viruses", "value": "Viruses"})
                    realm = VIRUS_KINGDOM_TO_REALM.get(kingdom, "")
                    if not realm and "incertae" in kingdom:
                        realm = "Viruses realm incertae sedis"
                    if realm:
                        path.append({"rank": "realm", "value": realm})

                for level in ["kingdom", "phylum", "class", "order", "family", "genus"]:
                    db_key = "class_name" if level == "class" else level
                    val = r.get(db_key, "") or ""
                    if val:
                        path.append({"rank": level, "value": val})

                results.append({
                    "display": display,
                    "name": sname,
                    "cname": cname,
                    "rank": rank,
                    "author": r.get("name_author", "") or "",
                    "path": path,
                })

            return results
    except Exception:
        logger.exception(f"Taxonomy search failed: q={q}")
        return []


def _get_species_list(session, parent_filters: dict) -> list:
    """取得物種列表"""
    where = "WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank IN ('Species','Subspecies','Variety','Form')"
    params = {}
    for col, val in parent_filters.items():
        safe_col = f'"{col}"' if col in ("order", "class") else col
        where += f" AND {safe_col} = :parent_{col}"
        params[f"parent_{col}"] = val

    sql = f"""
        SELECT simple_name, name_author, common_name_c, rank, iucn, redlist,
               is_endemic, alien_type, taxon_id, protected, kingdom
        FROM taicol_names
        {where}
        ORDER BY simple_name
        LIMIT 500
    """
    rows = session.exec(text(sql).bindparams(**params)).all()

    results = []
    for row in rows:
        name = row.simple_name or ""
        rank = row.rank or "Species"

        is_autonym = False
        if rank in ("Subspecies", "Variety", "Form"):
            parts = name.split()
            if len(parts) >= 3:
                is_autonym = (parts[1] == parts[-1])

        results.append({
            "name": name,
            "author": row.name_author or "",
            "cname": row.common_name_c or "",
            "rank": rank,
            "is_autonym": is_autonym,
            "iucn": row.redlist or row.iucn or "",
            "endemic": row.is_endemic == "true",
            "alien_type": row.alien_type or "",
            "taxon_id": row.taxon_id or "",
            "protected": row.protected or "",
            "kingdom": row.kingdom or "",
        })
    return results
