"""key_pdf_import.py

從 PDF 檢索表抽取結構骨架，寫入 identification_keys + key_couplets。

PDF CID 對應損壞使 CJK 完全亂碼，parser 只保證可靠抽取下列「Latin 結構骨架」：
  * Couplet 編號（col 1 數字）
  * Next couplet 編號（col 3 數字）
  * 學名（col 4 italic Latin 詞串，跨 row 接續會自動合併）
  * 狀態碼（col 6 LC/NT/VU/EN/CR/DD/NA/NE/EX/EW）
  * Marker（col 6 左側 * # % † ‡）

CJK lead 描述會以 garbled 形式存入 lead_*_text，使用者後續從整合版手動校正。

CLI:
    python -m backend.services.key_pdf_import <pdf> [--dry-run] [--source LABEL]
"""

from __future__ import annotations

import argparse
import os
import re
import time
from typing import Optional

import pdfplumber
from sqlmodel import Session, select

from backend.db import engine
from backend.models.schema import IdentificationKey, KeyCouplet, TaicolName


# Column boundaries (px) for NTU 維管束植物野外鑑定指南 排版。
COL1_MAX_X = 82
COL2_X = (82, 255)
COL3_X = (255, 280)
COL4_X = (282, 365)
COL5_X = (358, 408)
COL6_MARK_X = (385, 410)
COL6_STATUS_X = (410, 460)

# Best-fit y-clustering tolerance。實測 7 px 對 NTU 排版剛好涵蓋同視覺行的
# baseline jitter（italic vs upright），又不會把鄰近 lead 的 italic 接續行誤併。
ROW_Y_TOL = 7

# 學名格式中通常以正體呈現的 rank 縮寫（不會被 italic 偵測捕捉）。
RANK_TOKENS = {
    "subsp.", "var.", "f.", "fo.", "ssp.", "subvar.",
    "subgen.", "subg.", "sect.", "ser.", "×",
}

STATUS_CODES = {
    "LC", "NT", "VU", "EN", "CR", "DD", "NA", "NE", "EX", "EW", "NLC",
}
MARKERS = {"*", "#", "%", "†", "‡", "§"}
DIGIT_RE = re.compile(r"^\d+$")
DIGIT_LIKE_RE = re.compile(r"^[\d:;]+$")  # `:` `;` 可能為 8/9 之 font glyph 誤讀
DASH_GLYPHS = {"-", "−", "–", "—", "/", '"', "'"}


# ── Word/row helpers ──

def _is_italic(w) -> bool:
    fn = (w.get("fontname") or "")
    return "Italic" in fn or "Oblique" in fn


def _extract_words(page):
    words = page.extract_words(extra_attrs=["fontname", "size"])
    for w in words:
        w["italic"] = _is_italic(w)
    return words


def _cluster_rows(words, y_tol: int = ROW_Y_TOL):
    """Consecutive y-clustering：依 top 排序後，gap 至上一 word 的 top ≤ y_tol 即同 row。

    比 first-fit / best-fit 穩定，因為 italic baseline 偏移（同視覺行的 italic 學名
    與正體 anchor/status 之間 baseline 落差約 5-7 px）會被自然 absorb，而不會
    因為第一個 word 太早形成 row anchor 而把後到的同行 word 排擠出去。"""
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: w["top"])
    rows: list[list] = [[sorted_words[0]]]
    for w in sorted_words[1:]:
        prev_top = rows[-1][-1]["top"]
        if w["top"] - prev_top <= y_tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    for r in rows:
        r.sort(key=lambda w: w["x0"])
    return rows


def _classify_row(row):
    """欄位內按 (top, x) 排序：同 baseline 用 x 順序、跨 baseline 用 top 順序。
    這對 col4 sciname assembly 至關重要：當一個 row 包含多個視覺行的 italic
    片段時（如 'Sel helvetica' top=391 + 'subsp. pseudonipponica' top=402），
    不能只按 x 排，否則 'subsp.'(x=288) 會排到 'helvetica'(x=318) 之前。"""
    # 4-px top bucket：同視覺行內 italic baseline 抖動（最大約 3 px）會被歸到同 bucket，
    # 跨視覺行（baseline 差 ≥ 8 px）則分桶。這樣 sciname assembly 不論同行或跨行都能
    # 維持「先依視覺行 top，再依 x」的閱讀順序。
    by_top_x = lambda w: (int(w["top"] / 4), w["x0"])
    return {
        "top": min(w["top"] for w in row),
        "col1": sorted([w for w in row if w["x0"] < COL1_MAX_X], key=by_top_x),
        "col2": sorted([w for w in row if COL2_X[0] <= w["x0"] < COL2_X[1]], key=by_top_x),
        "col3": sorted([w for w in row if COL3_X[0] <= w["x0"] < COL3_X[1]], key=by_top_x),
        "col4": sorted([w for w in row
                        if COL4_X[0] <= w["x0"] < COL4_X[1]
                        and (w.get("italic") or w["text"].lower() in RANK_TOKENS)],
                       key=by_top_x),
        "col5": sorted([w for w in row if COL5_X[0] <= w["x0"] < COL5_X[1]
                        and not w.get("italic")], key=by_top_x),
        "col6_mark": sorted([w for w in row
                             if COL6_MARK_X[0] <= w["x0"] < COL6_MARK_X[1]
                             and w["text"] in MARKERS], key=by_top_x),
        "col6_status": sorted([w for w in row
                               if COL6_STATUS_X[0] <= w["x0"]
                               and w["text"].upper() in STATUS_CODES], key=by_top_x),
    }


def _has_anchor(c) -> bool:
    return any(DIGIT_RE.match(w["text"]) or w["text"] in DASH_GLYPHS for w in c["col1"])


def _parse_anchor(c) -> tuple[Optional[int], bool]:
    for w in c["col1"]:
        if DIGIT_RE.match(w["text"]):
            return int(w["text"]), False
        if w["text"] in DASH_GLYPHS:
            return None, True
    return None, False


def _parse_next(c) -> Optional[str]:
    """col3 可能混入非數字字元（如 dash glyph 落在邊界、CJK 標點誤入）；
    這裡先過濾掉非數字 token，再 join 剩下的 digit-like tokens 作為 next 值。"""
    if not c["col3"]:
        return None
    digits = [w["text"] for w in c["col3"] if DIGIT_LIKE_RE.match(w["text"])]
    if not digits:
        return None
    return "".join(digits).strip() or None


# ── Two-pass lead extraction ──

def _is_primary(c) -> bool:
    """PRIMARY = lead 主行（含 anchor / next / status / 同行 terminal sciname）。"""
    if _has_anchor(c):
        return True
    if _parse_next(c) is not None:
        return True
    if c["col6_status"]:
        return True
    if c["col4"] and c["col2"]:
        # 同行有 lead text + sciname：B lead with same-row terminal
        return True
    return False


def _is_continuation(c) -> bool:
    """CONTINUATION = 僅 italic sciname 的接續行（換行的 sciname/subsp.）。"""
    if _has_anchor(c) or _parse_next(c) is not None or c["col6_status"]:
        return False
    return bool(c["col4"]) and not c["col2"]


def _build_leads(rows):
    """從 rows 建出 leads list。每個 lead 含完整的 sciname（合併 above/below 的 italic 接續）。"""
    classified = [_classify_row(r) for r in rows]

    primaries = [(i, c) for i, c in enumerate(classified) if _is_primary(c)]
    continuations = [(i, c) for i, c in enumerate(classified) if _is_continuation(c)]

    leads = []
    for _, c in primaries:
        leads.append({
            "top": c["top"],
            "anchor": _parse_anchor(c),
            "next": _parse_next(c),
            "col4_words": list(c["col4"]),
            "above_sci": [],   # CONTINUATION rows above this primary
            "below_sci": [],   # CONTINUATION rows below this primary
            "marker": ("".join(w["text"] for w in c["col6_mark"]) or None),
            "status": ("".join(w["text"] for w in c["col6_status"]).upper() or None),
            "garbled_text": " ".join(w["text"] for w in c["col2"]).strip(),
        })

    # 把 CONTINUATION 接到最近的 primary
    for _, cc in continuations:
        if not leads:
            continue
        best = min(leads, key=lambda L: abs(L["top"] - cc["top"]))
        if cc["top"] < best["top"]:
            best["above_sci"].append(cc)
        else:
            best["below_sci"].append(cc)

    # 組裝完整 sciname：above (sorted asc by top) + col4_words + below (sorted asc by top)
    for L in leads:
        seq = []
        for cc in sorted(L["above_sci"], key=lambda x: x["top"]):
            seq.extend(cc["col4"])
        seq.extend(L["col4_words"])
        for cc in sorted(L["below_sci"], key=lambda x: x["top"]):
            seq.extend(cc["col4"])
        L["sciname"] = " ".join(w["text"] for w in seq).strip() if seq else None

    return leads


# ── PDF → leads → couplets ──

def parse_pdf(pdf_path: str) -> dict:
    leads_all = []
    title_hint: Optional[str] = None

    with pdfplumber.open(pdf_path) as pdf:
        for pi, page in enumerate(pdf.pages):
            words = _extract_words(page)
            rows = _cluster_rows(words)

            if pi == 0 and rows:
                latin = [w["text"] for w in rows[0]
                         if re.match(r"^[A-Za-z]{3,}$", w["text"])]
                if latin:
                    title_hint = latin[0]

            page_leads = _build_leads(rows)
            for L in page_leads:
                L["page"] = pi
            leads_all.extend(page_leads)

    # Pair leads → couplets
    couplets = []
    cur = None
    for L in leads_all:
        anchor_n, _is_dash = L["anchor"]
        if anchor_n is not None:
            if cur is not None:
                couplets.append(cur)
            cur = {"number": anchor_n,
                   "lead_a": _to_lead_dict(L),
                   "lead_b": None}
        else:
            if cur is None:
                continue
            if cur["lead_b"] is None:
                cur["lead_b"] = _to_lead_dict(L)
                couplets.append(cur)
                cur = None
    if cur is not None:
        couplets.append(cur)

    return {
        "title_hint": title_hint,
        "couplets": couplets,
        "lead_count": len(leads_all),
    }


def _to_lead_dict(L) -> dict:
    if L["sciname"]:
        return {
            "target_type": "taxon",
            "target_id": L["sciname"],
            "taxon_marker": L["marker"],
            "taxon_status": L["status"],
            "text_garbled": L["garbled_text"],
        }
    if L["next"]:
        return {
            "target_type": "couplet",
            "target_id": L["next"],
            "taxon_marker": None,
            "taxon_status": None,
            "text_garbled": L["garbled_text"],
        }
    return {
        "target_type": "unresolved",
        "target_id": None,
        "taxon_marker": None,
        "taxon_status": None,
        "text_garbled": L["garbled_text"],
    }


# ── Taxon resolve ──

def _resolve_taxon_ids(couplets, session: Session):
    scinames: set[str] = set()
    for c in couplets:
        for k in ("lead_a", "lead_b"):
            l = c.get(k)
            if l and l["target_type"] == "taxon" and l["target_id"]:
                scinames.add(l["target_id"])

    name_to_taxon: dict[str, Optional[str]] = {}
    for sn in scinames:
        row = session.exec(
            select(TaicolName.taxon_id).where(TaicolName.simple_name == sn)
        ).first()
        if row:
            name_to_taxon[sn] = row
            continue
        short = " ".join(sn.split()[:2])
        if short != sn:
            row = session.exec(
                select(TaicolName.taxon_id).where(TaicolName.simple_name == short)
            ).first()
            if row:
                name_to_taxon[sn] = row
                continue
        name_to_taxon[sn] = None

    for c in couplets:
        for k in ("lead_a", "lead_b"):
            l = c.get(k)
            if l and l["target_type"] == "taxon" and l["target_id"]:
                l["taxon_id_resolved"] = name_to_taxon.get(l["target_id"])
    return name_to_taxon


def _detect_scope(pdf_path: str) -> tuple[str, str]:
    return _detect_scope_from_name(os.path.basename(pdf_path))


def _detect_scope_from_name(filename: str) -> tuple[str, str]:
    base = os.path.splitext(filename)[0]
    if base.endswith("aceae"):
        return "family", base
    return "genus", base


# ── Import ──

def import_pdf(pdf_path: str, source_label: Optional[str] = None,
               dry_run: bool = False, mode: str = "dichotomous",
               scope_name_override: Optional[str] = None) -> int:
    """Import a key PDF.

    scope_name_override: 當 caller 已知正確的 family/genus 名稱（如 API upload
    時 PDF 存到 tmp 路徑、檔名被改），可以直接指定，避免 _detect_scope() 從
    tmp path 取錯。
    """
    parsed = parse_pdf(pdf_path)
    if scope_name_override:
        scope_rank, scope_name = _detect_scope_from_name(scope_name_override)
    else:
        scope_rank, scope_name = _detect_scope(pdf_path)
    source_label = source_label or f"PDF:{scope_name}.pdf"

    print(f"  scope: {scope_rank}={scope_name}")
    print(f"  title_hint: {parsed['title_hint']}")
    print(f"  leads: {parsed['lead_count']}, couplets: {len(parsed['couplets'])}")

    with Session(engine) as session:
        name_to_taxon = _resolve_taxon_ids(parsed["couplets"], session)
        resolved = sum(1 for v in name_to_taxon.values() if v)
        print(f"  taxa resolved: {resolved}/{len(name_to_taxon)}\n")
        for c in parsed["couplets"]:
            print(f"  {c['number']:3d}  A {_fmt_lead(c['lead_a']):60s}  B {_fmt_lead(c['lead_b'])}")

        if dry_run:
            print("\n  [dry-run] no DB writes.")
            return 0

        existing = session.exec(
            select(IdentificationKey).where(
                IdentificationKey.scope_name == scope_name,
                IdentificationKey.source == source_label,
            )
        ).first()
        if existing:
            for old in session.exec(
                select(KeyCouplet).where(KeyCouplet.key_id == existing.id)
            ).all():
                session.delete(old)
            session.delete(existing)
            session.commit()

        title = parsed["title_hint"] or scope_name
        key = IdentificationKey(
            scope_taxon_id=None,
            scope_rank=scope_rank,
            scope_name=scope_name,
            scope_cname=None,
            title=title,
            source=source_label,
            mode=mode,
            updated_at=int(time.time() * 1000),
        )
        session.add(key)
        session.commit()
        session.refresh(key)
        print(f"\n  inserted key id={key.id}")

        for c in parsed["couplets"]:
            la_text, la_type, la_id, la_mk, la_st = _lead_fields(c["lead_a"])
            lb_text, lb_type, lb_id, lb_mk, lb_st = _lead_fields(c["lead_b"])
            session.add(KeyCouplet(
                key_id=key.id,
                number=c["number"],
                lead_a_text=la_text,
                lead_a_target_type=la_type,
                lead_a_target_id=la_id,
                lead_a_taxon_marker=la_mk,
                lead_a_taxon_status=la_st,
                lead_b_text=lb_text,
                lead_b_target_type=lb_type,
                lead_b_target_id=lb_id,
                lead_b_taxon_marker=lb_mk,
                lead_b_taxon_status=lb_st,
            ))
        session.commit()
        print(f"  inserted {len(parsed['couplets'])} couplets")
        return key.id


def _fmt_lead(l) -> str:
    if l is None:
        return "(missing)"
    if l["target_type"] == "taxon":
        sn = l["target_id"]
        tid = l.get("taxon_id_resolved")
        st = l.get("taxon_status") or ""
        mk = l.get("taxon_marker") or ""
        tag = f"#{tid}" if tid else "(unresolved)"
        return f"→ {sn}{mk} {st} {tag}"
    if l["target_type"] == "couplet":
        return f"→ couplet {l['target_id']}"
    return "(unresolved lead)"


def _lead_fields(l):
    if l is None:
        return ("(missing)", "unresolved", None, None, None)
    if l["target_type"] == "taxon":
        target_id = l.get("taxon_id_resolved") or l["target_id"]
    else:
        target_id = l.get("target_id")
    return (
        l.get("text_garbled") or "",
        l["target_type"],
        str(target_id) if target_id is not None else None,
        l.get("taxon_marker"),
        l.get("taxon_status"),
    )


def main():
    ap = argparse.ArgumentParser(description="Import dichotomous key PDF.")
    ap.add_argument("pdf_path")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source", default=None,
                    help="Source label (default: PDF:filename)")
    args = ap.parse_args()
    import_pdf(args.pdf_path, source_label=args.source, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
