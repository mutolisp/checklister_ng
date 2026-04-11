"""資料品質檢核 API"""
import csv
import io
import logging
import os
import subprocess
import shutil
import sys
import tempfile
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Query, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse
from sqlmodel import Session, text
from backend.db import engine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/qa")


def _run_check(session, check_id: str, offset: int = 0, limit: int = 100):
    """執行單項檢核，回傳 count + items"""
    checks = {
        "A1": _check_a1,
        "A2": _check_a2,
        "A3": _check_a3,
        "A4": _check_a4,
        "B3": _check_b3,
        "B5": _check_b5,
        "B6": _check_b6,
        "D1": _check_d1,
        "D3": _check_d3,
    }
    fn = checks.get(check_id)
    if not fn:
        return None
    return fn(session, offset, limit)


# ── A1: 缺階層欄位 ──────────────────────────────────────

def _check_a1(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM taicol_names
        WHERE rank IN ('Species','Subspecies','Variety','Form','Forma')
          AND usage_status = 'accepted'
          AND (
            kingdom IS NULL OR kingdom = '' OR
            phylum IS NULL OR phylum = '' OR
            [class] IS NULL OR [class] = '' OR
            "order" IS NULL OR "order" = '' OR
            family IS NULL OR family = '' OR
            genus IS NULL OR genus = ''
          )
    """
    items_sql = f"""
        SELECT name_id, simple_name, rank, kingdom, phylum, [class], "order", family, genus
        FROM taicol_names
        WHERE rank IN ('Species','Subspecies','Variety','Form','Forma')
          AND usage_status = 'accepted'
          AND (
            kingdom IS NULL OR kingdom = '' OR
            phylum IS NULL OR phylum = '' OR
            [class] IS NULL OR [class] = '' OR
            "order" IS NULL OR "order" = '' OR
            family IS NULL OR family = '' OR
            genus IS NULL OR genus = ''
          )
        ORDER BY name_id
        LIMIT :lim OFFSET :off
    """
    count = session.exec(text(count_sql)).fetchone()[0]
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()

    items = []
    for r in rows:
        missing = []
        fields = [("kingdom", r[3]), ("phylum", r[4]), ("class", r[5]),
                  ("order", r[6]), ("family", r[7]), ("genus", r[8])]
        for fname, val in fields:
            if not val:
                missing.append(fname)
        items.append({
            "name_id": r[0], "simple_name": r[1], "rank": r[2],
            "detail": f"缺少: {', '.join(missing)}",
        })

    return {"id": "A1", "name": "缺階層欄位", "severity": "high",
            "description": "Species 及以下層級缺少 kingdom/phylum/class/order/family/genus",
            "count": count, "items": items}


# ── A2: 階層斷層 ──────────────────────────────────────

def _check_a2(session, offset, limit):
    # family 有值但 order 空、order 有值但 class 空 ...
    count_sql = """
        SELECT COUNT(*) FROM taicol_names
        WHERE usage_status = 'accepted' AND (
            (family != '' AND family IS NOT NULL AND ("order" IS NULL OR "order" = '')) OR
            ("order" != '' AND "order" IS NOT NULL AND ([class] IS NULL OR [class] = '')) OR
            ([class] != '' AND [class] IS NOT NULL AND (phylum IS NULL OR phylum = '')) OR
            (phylum != '' AND phylum IS NOT NULL AND (kingdom IS NULL OR kingdom = ''))
        )
    """
    items_sql = f"""
        SELECT name_id, simple_name, rank, kingdom, phylum, [class], "order", family
        FROM taicol_names
        WHERE usage_status = 'accepted' AND (
            (family != '' AND family IS NOT NULL AND ("order" IS NULL OR "order" = '')) OR
            ("order" != '' AND "order" IS NOT NULL AND ([class] IS NULL OR [class] = '')) OR
            ([class] != '' AND [class] IS NOT NULL AND (phylum IS NULL OR phylum = '')) OR
            (phylum != '' AND phylum IS NOT NULL AND (kingdom IS NULL OR kingdom = ''))
        )
        ORDER BY name_id
        LIMIT :lim OFFSET :off
    """
    count = session.exec(text(count_sql)).fetchone()[0]
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()

    items = []
    for r in rows:
        gaps = []
        if r[7] and not r[6]: gaps.append("family→order 斷層")
        if r[6] and not r[5]: gaps.append("order→class 斷層")
        if r[5] and not r[4]: gaps.append("class→phylum 斷層")
        if r[4] and not r[3]: gaps.append("phylum→kingdom 斷層")
        items.append({
            "name_id": r[0], "simple_name": r[1], "rank": r[2],
            "detail": "; ".join(gaps),
        })

    return {"id": "A2", "name": "階層斷層", "severity": "high",
            "description": "下層有值但上層為空（如 family 有值但 order 為空）",
            "count": count, "items": items}


# ── A3: 孤立 taxon_id ──────────────────────────────────

def _check_a3(session, offset, limit):
    count_sql = """
        SELECT COUNT(DISTINCT taxon_id) FROM taicol_names
        WHERE taxon_id != '' AND taxon_id IS NOT NULL
        GROUP BY taxon_id
        HAVING SUM(CASE WHEN usage_status = 'accepted' THEN 1 ELSE 0 END) = 0
    """
    # 用子查詢取 count
    count = session.exec(text(f"SELECT COUNT(*) FROM ({count_sql})")).fetchone()[0]

    items_sql = f"""
        SELECT taxon_id, GROUP_CONCAT(name_id), GROUP_CONCAT(simple_name), GROUP_CONCAT(usage_status)
        FROM taicol_names
        WHERE taxon_id IN (
            SELECT taxon_id FROM taicol_names
            WHERE taxon_id != '' AND taxon_id IS NOT NULL
            GROUP BY taxon_id
            HAVING SUM(CASE WHEN usage_status = 'accepted' THEN 1 ELSE 0 END) = 0
        )
        GROUP BY taxon_id
        ORDER BY taxon_id
        LIMIT :lim OFFSET :off
    """
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": 0, "simple_name": r[2], "rank": "",
        "detail": f"taxon_id={r[0]}, name_ids=[{r[1]}], statuses=[{r[3]}]",
    } for r in rows]

    return {"id": "A3", "name": "孤立 taxon_id", "severity": "high",
            "description": "taxon_id 底下沒有 accepted name（只有 synonym/misapplied）",
            "count": count, "items": items}


# ── A4: 多 accepted ──────────────────────────────────

def _check_a4(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM (
            SELECT taxon_id FROM taicol_names
            WHERE usage_status = 'accepted' AND taxon_id != '' AND taxon_id IS NOT NULL
            GROUP BY taxon_id
            HAVING COUNT(*) > 1
        )
    """
    count = session.exec(text(count_sql)).fetchone()[0]

    items_sql = f"""
        SELECT taxon_id, COUNT(*) as cnt, GROUP_CONCAT(name_id), GROUP_CONCAT(simple_name, ' | ')
        FROM taicol_names
        WHERE usage_status = 'accepted' AND taxon_id != '' AND taxon_id IS NOT NULL
        GROUP BY taxon_id
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT :lim OFFSET :off
    """
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": 0, "simple_name": r[3][:80], "rank": "",
        "detail": f"taxon_id={r[0]}, {r[1]} 筆 accepted, name_ids=[{r[2]}]",
    } for r in rows]

    return {"id": "A4", "name": "多 accepted", "severity": "medium",
            "description": "同一 taxon_id 有多筆 accepted name",
            "count": count, "items": items}


# ── B3: 重複學名 ──────────────────────────────────

def _check_b3(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM (
            SELECT simple_name, name_author FROM taicol_names
            WHERE simple_name != '' AND simple_name IS NOT NULL
            GROUP BY simple_name, name_author
            HAVING COUNT(*) > 1
        )
    """
    count = session.exec(text(count_sql)).fetchone()[0]

    items_sql = f"""
        SELECT simple_name, name_author, COUNT(*) as cnt, GROUP_CONCAT(name_id)
        FROM taicol_names
        WHERE simple_name != '' AND simple_name IS NOT NULL
        GROUP BY simple_name, name_author
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT :lim OFFSET :off
    """
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": 0, "simple_name": f"{r[0]} {r[1] or ''}", "rank": "",
        "detail": f"{r[2]} 筆重複, name_ids=[{r[3]}]",
    } for r in rows]

    return {"id": "B3", "name": "重複學名", "severity": "medium",
            "description": "同一 simple_name + name_author 出現多筆",
            "count": count, "items": items}


# ── B5: 俗名不一致 ──────────────────────────────────

def _check_b5(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM (
            SELECT taxon_id FROM taicol_names
            WHERE taxon_id != '' AND common_name_c != '' AND common_name_c IS NOT NULL
            GROUP BY taxon_id
            HAVING COUNT(DISTINCT common_name_c) > 1
        )
    """
    count = session.exec(text(count_sql)).fetchone()[0]

    items_sql = f"""
        SELECT taxon_id, GROUP_CONCAT(DISTINCT common_name_c), COUNT(DISTINCT common_name_c)
        FROM taicol_names
        WHERE taxon_id != '' AND common_name_c != '' AND common_name_c IS NOT NULL
        GROUP BY taxon_id
        HAVING COUNT(DISTINCT common_name_c) > 1
        ORDER BY taxon_id
        LIMIT :lim OFFSET :off
    """
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": 0, "simple_name": "", "rank": "",
        "detail": f"taxon_id={r[0]}, 俗名: {r[1]}",
    } for r in rows]

    return {"id": "B5", "name": "俗名不一致", "severity": "low",
            "description": "同 taxon_id 下不同 name 有不同俗名",
            "count": count, "items": items}


# ── B6: 空俗名 ──────────────────────────────────

def _check_b6(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM taicol_names
        WHERE usage_status = 'accepted'
          AND rank IN ('Species','Subspecies','Variety','Form','Forma')
          AND (common_name_c IS NULL OR common_name_c = '')
    """
    items_sql = f"""
        SELECT name_id, simple_name, rank, family, taxon_id
        FROM taicol_names
        WHERE usage_status = 'accepted'
          AND rank IN ('Species','Subspecies','Variety','Form','Forma')
          AND (common_name_c IS NULL OR common_name_c = '')
        ORDER BY family, simple_name
        LIMIT :lim OFFSET :off
    """
    count = session.exec(text(count_sql)).fetchone()[0]
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": r[0], "simple_name": r[1], "rank": r[2],
        "detail": f"family={r[3]}, taxon_id={r[4]}",
    } for r in rows]

    return {"id": "B6", "name": "空俗名", "severity": "medium",
            "description": "accepted 的 Species 及以下層級缺少俗名 (common_name_c)",
            "count": count, "items": items}


# ── D1: 階層值不一致 ──────────────────────────────────

def _check_d1(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM (
            SELECT family FROM taicol_names
            WHERE family != '' AND family IS NOT NULL
              AND "order" != '' AND "order" IS NOT NULL
            GROUP BY family
            HAVING COUNT(DISTINCT "order") > 1
        )
    """
    count = session.exec(text(count_sql)).fetchone()[0]

    items_sql = f"""
        SELECT family, GROUP_CONCAT(DISTINCT "order"), COUNT(DISTINCT "order")
        FROM taicol_names
        WHERE family != '' AND family IS NOT NULL
          AND "order" != '' AND "order" IS NOT NULL
        GROUP BY family
        HAVING COUNT(DISTINCT "order") > 1
        ORDER BY family
        LIMIT :lim OFFSET :off
    """
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": 0, "simple_name": r[0], "rank": "Family",
        "detail": f"不同的 order 值: {r[1]}",
    } for r in rows]

    return {"id": "D1", "name": "階層值不一致", "severity": "high",
            "description": "同一 family 底下有不同的 order 值",
            "count": count, "items": items}


# ── D3: 中文名不一致 ──────────────────────────────────

def _check_d3(session, offset, limit):
    count_sql = """
        SELECT COUNT(*) FROM (
            SELECT family FROM taicol_names
            WHERE family != '' AND family IS NOT NULL
              AND family_c != '' AND family_c IS NOT NULL
            GROUP BY family
            HAVING COUNT(DISTINCT family_c) > 1
        )
    """
    count = session.exec(text(count_sql)).fetchone()[0]

    items_sql = f"""
        SELECT family, GROUP_CONCAT(DISTINCT family_c), COUNT(DISTINCT family_c)
        FROM taicol_names
        WHERE family != '' AND family IS NOT NULL
          AND family_c != '' AND family_c IS NOT NULL
        GROUP BY family
        HAVING COUNT(DISTINCT family_c) > 1
        ORDER BY family
        LIMIT :lim OFFSET :off
    """
    rows = session.exec(text(items_sql).bindparams(lim=limit, off=offset)).fetchall()
    items = [{
        "name_id": 0, "simple_name": r[0], "rank": "Family",
        "detail": f"不同的中文名: {r[1]}",
    } for r in rows]

    return {"id": "D3", "name": "中文名不一致", "severity": "low",
            "description": "同一 family 有不同的 family_c 值",
            "count": count, "items": items}


# ── API Endpoints ──────────────────────────────────

CHECK_META = [
    {"id": "A1", "name": "缺階層欄位", "severity": "high"},
    {"id": "A2", "name": "階層斷層", "severity": "high"},
    {"id": "A3", "name": "孤立 taxon_id", "severity": "high"},
    {"id": "A4", "name": "多 accepted", "severity": "medium"},
    {"id": "B3", "name": "重複學名", "severity": "medium"},
    {"id": "B5", "name": "俗名不一致", "severity": "low"},
    {"id": "B6", "name": "空俗名", "severity": "medium"},
    {"id": "D1", "name": "階層值不一致", "severity": "high"},
    {"id": "D3", "name": "中文名不一致", "severity": "low"},
]


@router.get("/run")
async def run_all_checks():
    """執行所有檢核，回傳各項的 count + 前 20 筆"""
    with Session(engine) as session:
        results = []
        for meta in CHECK_META:
            try:
                result = _run_check(session, meta["id"], offset=0, limit=20)
                if result:
                    results.append(result)
            except Exception as e:
                logger.exception(f"QA check {meta['id']} failed")
                results.append({
                    "id": meta["id"], "name": meta["name"],
                    "severity": meta["severity"],
                    "count": -1, "items": [],
                    "error": str(e),
                })
        return {"checks": results}


@router.get("/{check_id}")
async def get_check_detail(
    check_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """取得特定檢核的完整問題記錄（分頁）"""
    with Session(engine) as session:
        result = _run_check(session, check_id, offset=offset, limit=limit)
        if not result:
            return JSONResponse({"error": f"Unknown check: {check_id}"}, status_code=404)
        return result


def _get_base_path():
    if getattr(sys, '_MEIPASS', None):
        return sys._MEIPASS
    return os.path.join(os.path.dirname(__file__), '..', '..')


@router.get("/export/csv/{check_id}")
async def export_check_csv(check_id: str, background_tasks: BackgroundTasks):
    """匯出特定檢核的所有問題記錄為 CSV"""
    with Session(engine) as session:
        result = _run_check(session, check_id, offset=0, limit=50000)
        if not result:
            return JSONResponse({"error": f"Unknown check: {check_id}"}, status_code=404)
        if result["count"] == 0:
            return PlainTextResponse("此檢核項目無問題記錄", status_code=200)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode='w',
                                       encoding='utf-8-sig', newline='')
    writer = csv.writer(tmp)
    writer.writerow(["name_id", "simple_name", "rank", "detail"])
    for item in result["items"]:
        writer.writerow([item["name_id"], item["simple_name"], item["rank"], item["detail"]])
    tmp.flush()
    tmp.close()

    background_tasks.add_task(os.unlink, tmp.name)
    return FileResponse(
        tmp.name,
        media_type="text/csv",
        filename=f"qa_{check_id}_{datetime.now().strftime('%Y%m%d')}.csv",
    )


@router.get("/export/docx")
async def export_all_docx(background_tasks: BackgroundTasks):
    """匯出全部檢核報告為 DOCX"""
    with Session(engine) as session:
        all_results = []
        for meta in CHECK_META:
            try:
                result = _run_check(session, meta["id"], offset=0, limit=50000)
                if result:
                    all_results.append(result)
            except Exception:
                pass

    # 產生 Markdown
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# 資料品質檢核報告", f"", f"產生時間: {now}", ""]

    severity_label = {"high": "🔴 高", "medium": "🟡 中", "low": "🟢 低"}
    total_issues = sum(r["count"] for r in all_results if r["count"] > 0)
    lines.append(f"## 摘要")
    lines.append(f"")
    lines.append(f"共 {len(all_results)} 項檢核，{total_issues} 筆問題")
    lines.append("")
    lines.append("| ID | 檢核名稱 | 嚴重度 | 問題筆數 |")
    lines.append("|:---|:---------|:-------|--------:|")
    for r in all_results:
        sev = severity_label.get(r["severity"], r["severity"])
        cnt = str(r["count"]) if r["count"] > 0 else "✓"
        lines.append(f"| {r['id']} | {r['name']} | {sev} | {cnt} |")
    lines.append("")

    for r in all_results:
        if r["count"] == 0:
            continue
        lines.append(f"## {r['id']}. {r['name']}")
        lines.append(f"")
        if r.get("description"):
            lines.append(f"{r['description']}")
            lines.append("")
        lines.append(f"問題筆數: {r['count']}")
        lines.append("")
        lines.append("| name_id | 學名 | rank | 問題說明 |")
        lines.append("|:--------|:-----|:-----|:---------|")
        for item in r["items"][:500]:
            nid = str(item["name_id"]) if item["name_id"] > 0 else "—"
            sn = item["simple_name"][:50] or ""
            rk = item["rank"] or ""
            dt = item["detail"][:60] or ""
            lines.append(f"| {nid} | {sn} | {rk} | {dt} |")
        if r["count"] > 500:
            lines.append(f"| ... | 共 {r['count']} 筆，僅顯示前 500 筆 | | |")
        lines.append("")

    md_content = "\n".join(lines)

    # 寫暫存 Markdown
    with tempfile.NamedTemporaryFile(delete=False, suffix=".md", mode='w', encoding='utf-8') as f:
        f.write(md_content)
        md_path = f.name

    # 用 Pandoc 轉 DOCX
    docx_path = md_path.replace(".md", ".docx")
    pandoc_cmd = shutil.which("pandoc")
    if not pandoc_cmd:
        base = _get_base_path()
        for name in ["pandoc.exe", "pandoc"]:
            p = os.path.join(base, name)
            if os.path.isfile(p):
                pandoc_cmd = p
                break
    if not pandoc_cmd:
        # fallback: 回傳 Markdown
        background_tasks.add_task(os.unlink, md_path)
        return FileResponse(
            md_path, media_type="text/markdown",
            filename=f"qa_report_{datetime.now().strftime('%Y%m%d')}.md",
        )

    kwargs = {}
    if sys.platform == "win32":
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0
        kwargs["startupinfo"] = si

    result = subprocess.run(
        [pandoc_cmd, md_path, "-o", docx_path],
        capture_output=True, text=True, timeout=30, **kwargs,
    )

    background_tasks.add_task(os.unlink, md_path)

    if result.returncode != 0:
        return PlainTextResponse(f"Pandoc 轉換失敗: {result.stderr}", status_code=500)

    background_tasks.add_task(os.unlink, docx_path)
    return FileResponse(
        docx_path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"qa_report_{datetime.now().strftime('%Y%m%d')}.docx",
    )
