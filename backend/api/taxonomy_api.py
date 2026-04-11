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


@router.get("/api/taxonomy/children",
            summary="取得分類樹子節點",
            description="Lazy-load 分類階層的子節點及統計")
def get_children(
    rank: str = Query(..., description="要查詢的階層: kingdom, phylum, class, order, family, genus, species"),
    parent_rank: Optional[str] = Query(None),
    parent_value: Optional[str] = Query(None),
):
    try:
        with Session(engine) as session:
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

            # 統計子層級數量
            stats_cols = []
            rank_idx = RANK_ORDER.index(rank)
            for r in RANK_ORDER[rank_idx + 1:]:
                r_col = '"order"' if r == "order" else '"class"' if r == "class" else r
                stats_cols.append(f'COUNT(DISTINCT {r_col}) as {r}_count')
            stats_cols.append("COUNT(*) as species_count")

            # common name 欄位 — 直接從 DB 取
            c_col = RANK_C_COL.get(rank, "")
            extra_cols = f", MAX({c_col}) as name_c" if c_col else ""

            where = "WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank='Species'"
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

            # 下一層 rank
            child_rank = RANK_ORDER[rank_idx + 1] if rank_idx + 1 < len(RANK_ORDER) else "species"

            results = []
            for row in rows:
                row_dict = dict(row._mapping)
                name = row_dict["name"]

                # 統計
                stats = {}
                for r in RANK_ORDER[rank_idx + 1:]:
                    count_key = f"{r}_count"
                    if count_key in row_dict:
                        stats[f"{RANK_LABELS.get(r, r)}"] = row_dict[count_key]
                stats["種"] = row_dict.get("species_count", 0)

                # common name 直接從查詢結果取
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


@router.get("/api/taxonomy/search",
            summary="分類樹搜尋",
            description="搜尋分類名稱，回傳匹配結果及其分類路徑")
def taxonomy_search(q: str = Query(..., max_length=512)):
    if not q or len(q.strip()) < 2:
        return []

    q = q.strip()
    # 台/臺互換
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

                # 顯示名稱
                if cname:
                    display = f"{cname} ({sname})"
                else:
                    display = sname

                # 分類路徑（用於前端逐層展開）
                path = []
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
    where = "WHERE usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank='Species'"
    params = {}
    for col, val in parent_filters.items():
        safe_col = f'"{col}"' if col in ("order", "class") else col
        where += f" AND {safe_col} = :parent_{col}"
        params[f"parent_{col}"] = val

    sql = f"""
        SELECT simple_name, name_author, common_name_c, iucn, redlist,
               is_endemic, alien_type, taxon_id, protected
        FROM taicol_names
        {where}
        ORDER BY simple_name
        LIMIT 500
    """
    rows = session.exec(text(sql).bindparams(**params)).all()

    return [
        {
            "name": row.simple_name,
            "author": row.name_author or "",
            "cname": row.common_name_c or "",
            "iucn": row.redlist or row.iucn or "",
            "endemic": row.is_endemic == "true",
            "alien_type": row.alien_type or "",
            "taxon_id": row.taxon_id or "",
            "protected": row.protected or "",
        }
        for row in rows
    ]
