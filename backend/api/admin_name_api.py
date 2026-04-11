"""名錄管理 API — 編輯/新增物種名錄記錄"""
import logging
from typing import Optional
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, text
from backend.db import engine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin")

# 可編輯的欄位白名單
EDITABLE_FIELDS = {
    "simple_name", "name_author", "formatted_name", "rank", "usage_status",
    "common_name_c", "alternative_name_c", "family_c", "genus_c",
    "is_in_taiwan", "is_endemic", "alien_type", "iucn", "redlist",
    "nomenclature_name", "cites", "protected", "is_hybrid", "is_fossil",
    "is_terrestrial", "is_freshwater", "is_brackish", "is_marine",
    "alien_status_note",
}

# 所有欄位（用於 SELECT）
ALL_COLUMNS = [
    "name_id", "rank", "simple_name", "name_author", "formatted_name",
    "usage_status", "taxon_id", "taxon_id_all", "is_in_taiwan",
    "common_name_c", "alternative_name_c",
    "is_endemic", "alien_type", "iucn", "redlist",
    "kingdom", "kingdom_c", "phylum", "phylum_c", 'class', "class_c", '"order"', "order_c", "family", "family_c",
    "genus", "genus_c",
    "nomenclature_name", "cites", "protected", "is_hybrid", "is_fossil",
    "is_terrestrial", "is_freshwater", "is_brackish", "is_marine",
    "alien_status_note",
]

# SQL 安全的欄位名
_SQL_COL_MAP = {
    "class": "[class]",
    "order": '"order"',
}


def _sql_col(field: str) -> str:
    return _SQL_COL_MAP.get(field, field)


def _row_to_dict(row, columns) -> dict:
    """將 SQL row 轉成 dict，清理欄位名"""
    d = {}
    for col, val in zip(columns, row):
        key = col.strip('"').strip('[]')
        d[key] = val
    return d


# ---------- GET /api/admin/name/search ----------
# 必須在 /name/{name_id} 之前註冊，避免 "search" 被當成 name_id

@router.get("/name/search")
async def search_name(q: str = Query(..., min_length=1, max_length=200)):
    """管理用搜尋，回傳含 name_id 的記錄"""
    like_q = f"%{q}%"
    sql = """
        SELECT name_id, simple_name, name_author, usage_status, rank,
               common_name_c, taxon_id, family, family_c
        FROM taicol_names
        WHERE common_name_c LIKE :q
           OR alternative_name_c LIKE :q
           OR simple_name LIKE :q
        ORDER BY
            CASE usage_status WHEN 'accepted' THEN 0 ELSE 1 END,
            CASE WHEN common_name_c = :exact THEN 0
                 WHEN simple_name = :exact THEN 1
                 ELSE 2 END,
            length(simple_name)
        LIMIT 30
    """
    with Session(engine) as session:
        result = session.exec(text(sql).bindparams(q=like_q, exact=q))
        rows = result.fetchall()
        return [
            {
                "name_id": r[0],
                "simple_name": r[1],
                "name_author": r[2],
                "usage_status": r[3],
                "rank": r[4],
                "common_name_c": r[5],
                "taxon_id": r[6],
                "family": r[7],
                "family_c": r[8],
            }
            for r in rows
        ]


# ---------- GET /api/admin/name/check-similar ----------
# 必須在 /name/{name_id} 之前註冊

@router.get("/name/check-similar")
async def check_similar(q: str = Query(..., min_length=2, max_length=300)):
    """新增前比對：精確 + 模糊搜尋相似學名"""
    with Session(engine) as session:
        results = []

        # 1. 精確比對 simple_name
        exact = session.exec(text("""
            SELECT name_id, simple_name, name_author, usage_status, common_name_c, taxon_id
            FROM taicol_names WHERE simple_name = :q
            ORDER BY CASE usage_status WHEN 'accepted' THEN 0 ELSE 1 END
            LIMIT 10
        """).bindparams(q=q)).fetchall()
        for r in exact:
            results.append({
                "name_id": r[0], "simple_name": r[1], "name_author": r[2],
                "usage_status": r[3], "common_name_c": r[4], "taxon_id": r[5],
                "match_type": "exact",
            })

        # 2. LIKE 包含比對
        if len(results) < 10:
            like_q = f"%{q}%"
            like_rows = session.exec(text("""
                SELECT name_id, simple_name, name_author, usage_status, common_name_c, taxon_id
                FROM taicol_names WHERE simple_name LIKE :q AND simple_name != :exact
                ORDER BY length(simple_name)
                LIMIT 10
            """).bindparams(q=like_q, exact=q)).fetchall()
            for r in like_rows:
                results.append({
                    "name_id": r[0], "simple_name": r[1], "name_author": r[2],
                    "usage_status": r[3], "common_name_c": r[4], "taxon_id": r[5],
                    "match_type": "contains",
                })

        # 3. 模糊比對（Levenshtein）
        if len(results) < 10:
            try:
                from rapidfuzz import fuzz, process
                all_names = session.exec(text(
                    "SELECT DISTINCT simple_name FROM taicol_names WHERE simple_name != '' LIMIT 50000"
                )).fetchall()
                name_list = [r[0] for r in all_names]
                existing_names = {r["simple_name"] for r in results}

                fuzzy_matches = process.extract(q, name_list, scorer=fuzz.ratio, limit=10)
                for match_name, score, _ in fuzzy_matches:
                    if score >= 70 and match_name not in existing_names and match_name != q:
                        row = session.exec(text("""
                            SELECT name_id, simple_name, name_author, usage_status, common_name_c, taxon_id
                            FROM taicol_names WHERE simple_name = :sn
                            ORDER BY CASE usage_status WHEN 'accepted' THEN 0 ELSE 1 END
                            LIMIT 1
                        """).bindparams(sn=match_name)).fetchone()
                        if row:
                            results.append({
                                "name_id": row[0], "simple_name": row[1], "name_author": row[2],
                                "usage_status": row[3], "common_name_c": row[4], "taxon_id": row[5],
                                "match_type": "fuzzy", "score": score,
                            })
            except ImportError:
                pass

        return results


# ---------- GET /api/admin/name/{name_id} ----------

# rank → 用哪個欄位查子分類群
_RANK_TO_COLUMN = {
    "Kingdom": "kingdom",
    "Subkingdom": "kingdom",
    "Infrakingdom": "kingdom",
    "Superkingdom": "kingdom",
    "Realm": "kingdom",
    "Phylum": "phylum",
    "Subphylum": "phylum",
    "Infraphylum": "phylum",
    "Superphylum": "phylum",
    "Class": "[class]",
    "Subclass": "[class]",
    "Infraclass": "[class]",
    "Megaclass": "[class]",
    "Superclass": "[class]",
    "Order": '"order"',
    "Suborder": '"order"',
    "Infraorder": '"order"',
    "Superorder": '"order"',
    "Family": "family",
    "Subfamily": "family",
    "Superfamily": "family",
    "Epifamily": "family",
    "Tribe": "family",
    "Subtribe": "family",
    "Genus": "genus",
    "Subgenus": "genus",
    "Section": "genus",
    "Subsection": "genus",
}


def _check_has_taiwan_children(session, record: dict) -> bool:
    """檢查該分類群底下是否有 is_in_taiwan 的子記錄"""
    rank = record.get("rank", "")
    col = _RANK_TO_COLUMN.get(rank)
    if not col:
        return False

    # 取得該欄位的值（用來查子分類群）
    clean_col = col.strip('"').strip('[]')
    val = record.get(clean_col) or record.get("class") or ""
    if not val:
        return False

    sql = f"""
        SELECT COUNT(*) FROM taicol_names
        WHERE {col} = :val
          AND is_in_taiwan LIKE '%true%'
          AND name_id != :nid
    """
    count = session.exec(text(sql).bindparams(val=val, nid=record.get("name_id", 0))).fetchone()
    return (count[0] or 0) > 0


@router.get("/name/{name_id}")
async def get_name(name_id: int):
    """取得單筆 name 完整記錄"""
    col_str = ", ".join(ALL_COLUMNS)
    sql = f"SELECT {col_str} FROM taicol_names WHERE name_id = :nid"
    with Session(engine) as session:
        result = session.exec(text(sql).bindparams(nid=name_id))
        row = result.fetchone()
        if not row:
            return JSONResponse({"error": "Name not found"}, status_code=404)
        d = _row_to_dict(row, ALL_COLUMNS)
        d["has_taiwan_children"] = _check_has_taiwan_children(session, d)
        return d


# ---------- GET /api/admin/taxon/{taxon_id}/names ----------

@router.get("/taxon/{taxon_id}/names")
async def get_taxon_names(taxon_id: str):
    """取得某 taxon 下所有 names（同物異名清單）"""
    sql = """
        SELECT name_id, simple_name, name_author, usage_status, rank, common_name_c
        FROM taicol_names
        WHERE taxon_id = :tid
        ORDER BY
            CASE usage_status WHEN 'accepted' THEN 0 ELSE 1 END,
            name_id
    """
    with Session(engine) as session:
        result = session.exec(text(sql).bindparams(tid=taxon_id))
        rows = result.fetchall()
        return [
            {
                "name_id": r[0],
                "simple_name": r[1],
                "name_author": r[2],
                "usage_status": r[3],
                "rank": r[4],
                "common_name_c": r[5],
            }
            for r in rows
        ]


# ---------- PUT /api/admin/name/{name_id} ----------

class NameUpdate(BaseModel):
    changes: dict  # {field: new_value, ...}
    # 當 usage_status 改為 accepted 時，連動降級原 accepted name
    cascade_old_accepted: Optional[str] = None  # "not-accepted" | "misapplied"


def _do_update(session, name_id: int, changes: dict) -> dict:
    """執行單筆 UPDATE + audit log，回傳 actual_changes dict"""
    col_str = ", ".join(ALL_COLUMNS)
    current = session.exec(
        text(f"SELECT {col_str} FROM taicol_names WHERE name_id = :nid")
        .bindparams(nid=name_id)
    ).fetchone()

    if not current:
        return {}

    current_dict = _row_to_dict(current, ALL_COLUMNS)

    actual_changes = {}
    for field, new_val in changes.items():
        old_val = current_dict.get(field, "")
        if str(new_val or "") != str(old_val or ""):
            actual_changes[field] = {"old": old_val, "new": new_val}

    if not actual_changes:
        return {}

    set_clauses = []
    params = {"nid": name_id}
    for i, (field, vals) in enumerate(actual_changes.items()):
        param_name = f"v{i}"
        set_clauses.append(f"{_sql_col(field)} = :{param_name}")
        params[param_name] = vals["new"]

    session.exec(text(
        f"UPDATE taicol_names SET {', '.join(set_clauses)} WHERE name_id = :nid"
    ).bindparams(**params))

    for field, vals in actual_changes.items():
        session.exec(text("""
            INSERT INTO admin_audit (action, name_id, field, old_value, new_value)
            VALUES ('update', :nid, :field, :old, :new)
        """).bindparams(
            nid=name_id, field=field,
            old=str(vals["old"] or ""), new=str(vals["new"] or ""),
        ))

    return actual_changes


@router.put("/name/{name_id}")
async def update_name(name_id: int, body: NameUpdate):
    """更新單筆 name，只更新有變更的欄位，寫入 audit log。
    若 usage_status 改為 accepted 且提供 cascade_old_accepted，
    同時將同 taxon 原 accepted name 降級。"""
    changes = body.changes

    # 驗證欄位白名單
    invalid = set(changes.keys()) - EDITABLE_FIELDS
    if invalid:
        return JSONResponse(
            {"error": f"不可編輯的欄位: {', '.join(invalid)}"},
            status_code=400,
        )

    if not changes:
        return JSONResponse({"error": "無變更"}, status_code=400)

    with Session(engine) as session:
        # 先確認目標記錄存在
        col_str = ", ".join(ALL_COLUMNS)
        current = session.exec(
            text(f"SELECT {col_str} FROM taicol_names WHERE name_id = :nid")
            .bindparams(nid=name_id)
        ).fetchone()

        if not current:
            return JSONResponse({"error": "Name not found"}, status_code=404)

        current_dict = _row_to_dict(current, ALL_COLUMNS)

        # 檢查是否需要連動降級
        cascade_result = None
        is_promoting = (
            changes.get("usage_status") == "accepted"
            and current_dict.get("usage_status") != "accepted"
        )

        if is_promoting:
            taxon_id = current_dict.get("taxon_id")
            if not body.cascade_old_accepted:
                # 查看是否有現存 accepted name
                old_accepted = session.exec(text("""
                    SELECT name_id, simple_name, name_author
                    FROM taicol_names
                    WHERE taxon_id = :tid AND usage_status = 'accepted' AND name_id != :nid
                """).bindparams(tid=taxon_id, nid=name_id)).fetchone()

                if old_accepted:
                    return JSONResponse({
                        "error": "cascade_required",
                        "message": f"此 taxon 已有 accepted name: {old_accepted[1]} {old_accepted[2]} (name_id={old_accepted[0]})，請指定 cascade_old_accepted",
                        "old_accepted": {
                            "name_id": old_accepted[0],
                            "simple_name": old_accepted[1],
                            "name_author": old_accepted[2],
                        },
                    }, status_code=409)
            else:
                # 執行連動降級
                new_status = body.cascade_old_accepted
                if new_status not in ("not-accepted", "misapplied"):
                    return JSONResponse(
                        {"error": f"cascade_old_accepted 只能是 not-accepted 或 misapplied"},
                        status_code=400,
                    )

                old_accepted = session.exec(text("""
                    SELECT name_id FROM taicol_names
                    WHERE taxon_id = :tid AND usage_status = 'accepted' AND name_id != :nid
                """).bindparams(tid=current_dict["taxon_id"], nid=name_id)).fetchone()

                if old_accepted:
                    cascade_changes = _do_update(
                        session, old_accepted[0],
                        {"usage_status": new_status},
                    )
                    if cascade_changes:
                        cascade_result = {
                            "name_id": old_accepted[0],
                            "changes": cascade_changes,
                        }

        # 執行主記錄更新
        actual_changes = _do_update(session, name_id, changes)

        if not actual_changes and not cascade_result:
            return {"status": "no_change", "message": "無實際變更"}

        session.commit()

        result = {
            "status": "updated",
            "name_id": name_id,
            "changes": actual_changes,
        }
        if cascade_result:
            result["cascade"] = cascade_result

        return result


# ---------- POST /api/admin/taxonomy/move/preview ----------

class TaxonMoveRequest(BaseModel):
    source_rank: str       # 要搬移的層級: genus/family/order/class/phylum
    source_name: str       # 要搬移的分類群名稱
    target_rank: str       # 目標父層級
    target_name: str       # 目標父分類群名稱


# rank → SQL column
_MOVE_COL = {
    "kingdom": "kingdom",
    "phylum": "phylum",
    "class": "[class]",
    "order": '"order"',
    "family": "family",
    "genus": "genus",
}

# rank 的階層順序（低→高）
_RANK_LEVELS = ["genus", "family", "order", "class", "phylum", "kingdom"]


@router.post("/taxonomy/move/preview")
async def move_preview(body: TaxonMoveRequest):
    """預覽搬移影響範圍：會影響多少筆記錄"""
    src_col = _MOVE_COL.get(body.source_rank)
    tgt_col = _MOVE_COL.get(body.target_rank)
    if not src_col or not tgt_col:
        return JSONResponse({"error": "Invalid rank"}, status_code=400)

    # source_rank 必須低於 target_rank
    src_idx = _RANK_LEVELS.index(body.source_rank) if body.source_rank in _RANK_LEVELS else -1
    tgt_idx = _RANK_LEVELS.index(body.target_rank) if body.target_rank in _RANK_LEVELS else -1
    if src_idx < 0 or tgt_idx < 0 or src_idx >= tgt_idx:
        return JSONResponse(
            {"error": f"source_rank ({body.source_rank}) 必須低於 target_rank ({body.target_rank})"},
            status_code=400,
        )

    with Session(engine) as session:
        # 計算影響筆數
        count = session.exec(text(
            f"SELECT COUNT(*) FROM taicol_names WHERE {src_col} = :src"
        ).bindparams(src=body.source_name)).fetchone()[0]

        if count == 0:
            return JSONResponse({"error": f"找不到 {body.source_rank}={body.source_name}"}, status_code=404)

        # 查看目標分類群是否存在，以及它的完整階層
        tgt_row = session.exec(text(f"""
            SELECT DISTINCT kingdom, phylum, [class], "order", family, family_c, genus, genus_c
            FROM taicol_names WHERE {tgt_col} = :tgt LIMIT 1
        """).bindparams(tgt=body.target_name)).fetchone()

        if not tgt_row:
            return JSONResponse({"error": f"目標分類群不存在: {body.target_rank}={body.target_name}"}, status_code=404)

        target_hierarchy = {
            "kingdom": tgt_row[0] or "",
            "phylum": tgt_row[1] or "",
            "class": tgt_row[2] or "",
            "order": tgt_row[3] or "",
            "family": tgt_row[4] or "",
            "family_c": tgt_row[5] or "",
            "genus": tgt_row[6] or "",
            "genus_c": tgt_row[7] or "",
        }

        # 查看來源的目前階層
        src_row = session.exec(text(f"""
            SELECT DISTINCT kingdom, phylum, [class], "order", family, family_c, genus, genus_c
            FROM taicol_names WHERE {src_col} = :src LIMIT 1
        """).bindparams(src=body.source_name)).fetchone()

        source_hierarchy = {
            "kingdom": src_row[0] or "",
            "phylum": src_row[1] or "",
            "class": src_row[2] or "",
            "order": src_row[3] or "",
            "family": src_row[4] or "",
            "family_c": src_row[5] or "",
            "genus": src_row[6] or "",
            "genus_c": src_row[7] or "",
        }

        # 計算哪些欄位會被變更
        changes = {}
        for r in _RANK_LEVELS:
            if _RANK_LEVELS.index(r) > src_idx:
                # 高於 source 的層級要更新為目標的值
                key = "class" if r == "class" else r
                old_val = source_hierarchy.get(key, "")
                new_val = target_hierarchy.get(key, "")
                if old_val != new_val:
                    changes[r] = {"old": old_val, "new": new_val}

        return {
            "affected_count": count,
            "source": {"rank": body.source_rank, "name": body.source_name},
            "target": {"rank": body.target_rank, "name": body.target_name},
            "source_hierarchy": source_hierarchy,
            "target_hierarchy": target_hierarchy,
            "changes": changes,
        }


@router.post("/taxonomy/move/execute")
async def move_execute(body: TaxonMoveRequest):
    """執行搬移：更新所有受影響記錄的階層欄位"""
    src_col = _MOVE_COL.get(body.source_rank)
    tgt_col = _MOVE_COL.get(body.target_rank)
    if not src_col or not tgt_col:
        return JSONResponse({"error": "Invalid rank"}, status_code=400)

    src_idx = _RANK_LEVELS.index(body.source_rank) if body.source_rank in _RANK_LEVELS else -1
    tgt_idx = _RANK_LEVELS.index(body.target_rank) if body.target_rank in _RANK_LEVELS else -1
    if src_idx < 0 or tgt_idx < 0 or src_idx >= tgt_idx:
        return JSONResponse({"error": "rank 順序不正確"}, status_code=400)

    with Session(engine) as session:
        # 取得目標階層
        tgt_row = session.exec(text(f"""
            SELECT DISTINCT kingdom, phylum, [class], "order", family, family_c, genus, genus_c
            FROM taicol_names WHERE {tgt_col} = :tgt LIMIT 1
        """).bindparams(tgt=body.target_name)).fetchone()

        if not tgt_row:
            return JSONResponse({"error": f"目標不存在: {body.target_name}"}, status_code=404)

        target = {
            "kingdom": tgt_row[0] or "", "phylum": tgt_row[1] or "",
            "class": tgt_row[2] or "", "order": tgt_row[3] or "",
            "family": tgt_row[4] or "", "family_c": tgt_row[5] or "",
            "genus": tgt_row[6] or "", "genus_c": tgt_row[7] or "",
        }

        # 取得來源目前階層（用於 audit log）
        src_row = session.exec(text(f"""
            SELECT DISTINCT kingdom, phylum, [class], "order", family, family_c
            FROM taicol_names WHERE {src_col} = :src LIMIT 1
        """).bindparams(src=body.source_name)).fetchone()

        if not src_row:
            return JSONResponse({"error": f"來源不存在: {body.source_name}"}, status_code=404)

        # 組裝 SET 子句：更新高於 source_rank 的所有欄位
        set_parts = []
        params = {"src": body.source_name}
        audit_fields = []

        rank_to_db = {"kingdom": "kingdom", "phylum": "phylum", "class": "[class]",
                      "order": '"order"', "family": "family"}
        rank_to_key = {"kingdom": "kingdom", "phylum": "phylum", "class": "class",
                       "order": "order", "family": "family"}

        for r in _RANK_LEVELS:
            if _RANK_LEVELS.index(r) > src_idx:
                db_col = rank_to_db.get(r)
                key = rank_to_key.get(r)
                if db_col and key:
                    new_val = target.get(key, "")
                    param_name = f"new_{key}"
                    set_parts.append(f"{db_col} = :{param_name}")
                    params[param_name] = new_val
                    audit_fields.append((key, new_val))

        # 也更新 family_c（如果搬移涉及 family 以上）
        if _RANK_LEVELS.index("family") > src_idx and target.get("family_c"):
            set_parts.append("family_c = :new_family_c")
            params["new_family_c"] = target["family_c"]

        if not set_parts:
            return {"status": "no_change", "message": "無需變更的欄位"}

        # 執行批次更新
        update_sql = f"UPDATE taicol_names SET {', '.join(set_parts)} WHERE {src_col} = :src"
        session.exec(text(update_sql).bindparams(**params))

        # 計算影響筆數
        count = session.exec(text(
            f"SELECT changes()"
        )).fetchone()[0]

        # Audit log
        session.exec(text("""
            INSERT INTO admin_audit (action, name_id, field, old_value, new_value)
            VALUES ('move', 0, :field, :old, :new)
        """).bindparams(
            field=f"{body.source_rank}:{body.source_name}",
            old=f"under {body.target_rank} (old)",
            new=f"under {body.target_rank}:{body.target_name}",
        ))

        session.commit()

        return {
            "status": "moved",
            "affected_count": count,
            "source": {"rank": body.source_rank, "name": body.source_name},
            "target": {"rank": body.target_rank, "name": body.target_name},
        }


# ---------- GET /api/admin/taxonomy/lookup ----------

@router.get("/taxonomy/lookup")
async def taxonomy_lookup(
    rank: str = Query(..., description="genus/family/order/class/phylum"),
    name: str = Query(..., min_length=1, max_length=200),
):
    """給定某階層的名稱，回傳完整上層階層"""
    rank_col_map = {
        "genus": "genus",
        "family": "family",
        "order": '"order"',
        "class": "[class]",
        "phylum": "phylum",
        "kingdom": "kingdom",
    }
    col = rank_col_map.get(rank)
    if not col:
        return JSONResponse({"error": f"Invalid rank: {rank}"}, status_code=400)

    sql = f"""
        SELECT DISTINCT kingdom, phylum, [class], "order", family, family_c, genus, genus_c
        FROM taicol_names
        WHERE {col} = :name
        LIMIT 1
    """
    with Session(engine) as session:
        row = session.exec(text(sql).bindparams(name=name)).fetchone()
        if not row:
            return {}
        return {
            "kingdom": row[0] or "",
            "phylum": row[1] or "",
            "class": row[2] or "",
            "order": row[3] or "",
            "family": row[4] or "",
            "family_c": row[5] or "",
            "genus": row[6] or "",
            "genus_c": row[7] or "",
        }


# ---------- GET /api/admin/taxonomy/options ----------

@router.get("/taxonomy/options")
async def taxonomy_options(
    rank: str = Query(..., description="要查詢的階層: kingdom/phylum/class/order/family/genus"),
    kingdom: Optional[str] = None,
    phylum: Optional[str] = None,
    class_name: Optional[str] = None,
    order: Optional[str] = None,
    family: Optional[str] = None,
):
    """聯動下拉：取得某階層在指定上層下的所有選項"""
    rank_col_map = {
        "kingdom": "kingdom",
        "phylum": "phylum",
        "class": "[class]",
        "order": '"order"',
        "family": "family",
        "genus": "genus",
    }
    col = rank_col_map.get(rank)
    if not col:
        return JSONResponse({"error": f"Invalid rank: {rank}"}, status_code=400)

    conditions = []
    params = {}
    if kingdom:
        conditions.append("kingdom = :kingdom")
        params["kingdom"] = kingdom
    if phylum:
        conditions.append("phylum = :phylum")
        params["phylum"] = phylum
    if class_name:
        conditions.append("[class] = :cls")
        params["cls"] = class_name
    if order:
        conditions.append('"order" = :ord')
        params["ord"] = order
    if family:
        conditions.append("family = :family")
        params["family"] = family

    where = " AND ".join(conditions) if conditions else "1=1"
    sql = f"SELECT DISTINCT {col} FROM taicol_names WHERE {where} AND {col} != '' AND {col} IS NOT NULL ORDER BY {col} LIMIT 500"

    with Session(engine) as session:
        rows = session.exec(text(sql).bindparams(**params)).fetchall()
        return [r[0] for r in rows]


# ---------- POST /api/admin/name ----------

class NameCreate(BaseModel):
    simple_name: str
    name_author: Optional[str] = ""
    rank: str
    usage_status: str  # accepted / not-accepted / misapplied
    taxon_id: Optional[str] = None  # 若 synonym/misapplied 需指定
    common_name_c: Optional[str] = ""
    alternative_name_c: Optional[str] = ""
    is_in_taiwan: Optional[str] = ""
    is_endemic: Optional[str] = ""
    alien_type: Optional[str] = ""
    iucn: Optional[str] = ""
    redlist: Optional[str] = ""
    kingdom: Optional[str] = ""
    phylum: Optional[str] = ""
    class_name: Optional[str] = ""
    order_name: Optional[str] = ""
    family: Optional[str] = ""
    family_c: Optional[str] = ""
    genus: Optional[str] = ""
    genus_c: Optional[str] = ""


@router.post("/name")
async def create_name(body: NameCreate):
    """新增一筆 name 記錄"""
    with Session(engine) as session:
        # 檢查學名是否重複
        dup = session.exec(text(
            "SELECT name_id FROM taicol_names WHERE simple_name = :sn AND name_author = :au LIMIT 1"
        ).bindparams(sn=body.simple_name, au=body.name_author or "")).fetchone()
        if dup:
            return JSONResponse(
                {"error": f"學名已存在: {body.simple_name} {body.name_author} (name_id={dup[0]})"},
                status_code=409,
            )

        # 產生 name_id
        max_nid = session.exec(text("SELECT MAX(name_id) FROM taicol_names")).fetchone()[0] or 0
        new_name_id = max_nid + 1

        # 產生或使用 taxon_id
        if body.usage_status == "accepted":
            if body.taxon_id:
                new_taxon_id = body.taxon_id
            else:
                max_tid = session.exec(text(
                    "SELECT MAX(CAST(SUBSTR(taxon_id, 2) AS INTEGER)) FROM taicol_names "
                    "WHERE taxon_id LIKE 't0%'"
                )).fetchone()[0] or 0
                new_taxon_id = f"t{max_tid + 1:07d}"
        else:
            # synonym / misapplied 必須指定 taxon_id
            if not body.taxon_id:
                return JSONResponse(
                    {"error": "non-accepted name 必須指定 taxon_id"},
                    status_code=400,
                )
            # 驗證 taxon_id 存在
            exists = session.exec(text(
                "SELECT COUNT(*) FROM taicol_names WHERE taxon_id = :tid"
            ).bindparams(tid=body.taxon_id)).fetchone()[0]
            if not exists:
                return JSONResponse(
                    {"error": f"taxon_id {body.taxon_id} 不存在"},
                    status_code=400,
                )
            new_taxon_id = body.taxon_id

        # 組裝 formatted_name
        formatted = f"<i>{body.simple_name}</i>"

        # INSERT
        session.exec(text("""
            INSERT INTO taicol_names (
                name_id, rank, simple_name, name_author, formatted_name,
                usage_status, taxon_id, is_in_taiwan,
                common_name_c, alternative_name_c,
                is_endemic, alien_type, iucn, redlist,
                kingdom, phylum, [class], "order", family, family_c, genus, genus_c
            ) VALUES (
                :name_id, :rank, :simple_name, :name_author, :formatted_name,
                :usage_status, :taxon_id, :is_in_taiwan,
                :common_name_c, :alternative_name_c,
                :is_endemic, :alien_type, :iucn, :redlist,
                :kingdom, :phylum, :class_name, :order_name, :family, :family_c, :genus, :genus_c
            )
        """).bindparams(
            name_id=new_name_id,
            rank=body.rank,
            simple_name=body.simple_name,
            name_author=body.name_author or "",
            formatted_name=formatted,
            usage_status=body.usage_status,
            taxon_id=new_taxon_id,
            is_in_taiwan=body.is_in_taiwan or "",
            common_name_c=body.common_name_c or "",
            alternative_name_c=body.alternative_name_c or "",
            is_endemic=body.is_endemic or "",
            alien_type=body.alien_type or "",
            iucn=body.iucn or "",
            redlist=body.redlist or "",
            kingdom=body.kingdom or "",
            phylum=body.phylum or "",
            class_name=body.class_name or "",
            order_name=body.order_name or "",
            family=body.family or "",
            family_c=body.family_c or "",
            genus=body.genus or "",
            genus_c=body.genus_c or "",
        ))

        # Audit log
        session.exec(text("""
            INSERT INTO admin_audit (action, name_id, field, old_value, new_value)
            VALUES ('create', :nid, 'simple_name', '', :sn)
        """).bindparams(nid=new_name_id, sn=body.simple_name))

        session.commit()

        return {
            "status": "created",
            "name_id": new_name_id,
            "taxon_id": new_taxon_id,
        }



# ---------- References CRUD ----------

class ReferenceCreate(BaseModel):
    name_id: int
    citation: str
    doi: Optional[str] = ""
    url: Optional[str] = ""
    note: Optional[str] = ""


@router.get("/references/{name_id}")
async def get_references(name_id: int):
    """取得某 name_id 的所有參考文獻"""
    with Session(engine) as session:
        rows = session.exec(text(
            "SELECT id, name_id, citation, doi, url, note, created_at "
            "FROM name_references WHERE name_id = :nid ORDER BY id"
        ).bindparams(nid=name_id)).fetchall()
        return [
            {"id": r[0], "name_id": r[1], "citation": r[2], "doi": r[3],
             "url": r[4], "note": r[5], "created_at": r[6]}
            for r in rows
        ]


@router.post("/references")
async def add_reference(body: ReferenceCreate):
    """新增參考文獻"""
    with Session(engine) as session:
        session.exec(text("""
            INSERT INTO name_references (name_id, citation, doi, url, note, created_at)
            VALUES (:nid, :citation, :doi, :url, :note, datetime('now'))
        """).bindparams(
            nid=body.name_id, citation=body.citation,
            doi=body.doi or "", url=body.url or "", note=body.note or "",
        ))
        session.commit()
        # 取得新 ID
        last = session.exec(text("SELECT last_insert_rowid()")).fetchone()
        return {"status": "created", "id": last[0]}


@router.delete("/references/{ref_id}")
async def delete_reference(ref_id: int):
    """刪除參考文獻"""
    with Session(engine) as session:
        session.exec(text("DELETE FROM name_references WHERE id = :rid").bindparams(rid=ref_id))
        session.commit()
        return {"status": "deleted"}
