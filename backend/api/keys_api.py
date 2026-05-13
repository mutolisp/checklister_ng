"""keys_api.py — 統一檢索表 API（新版 identification_keys schema）。

舊版 `key_api.py` 直接讀 `references/key_to_sp/<Genus>` plain-text 檔案，
為向下相容仍保留；新版改走 DB schema，支援科 / 屬巢狀 subkey、IUCN
狀態、multi-access feature matrix 等。
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlmodel import Session, select, text as sa_text

from backend.db import engine
from backend.models.schema import (
    IdentificationKey,
    KeyCouplet,
    KeyFeature,
    KeyTaxonFeature,
    TaicolName,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── helpers ──

def _accepted_taxon(session: Session, taxon_id: str) -> Optional[dict]:
    """回傳該 taxon_id 對應的 accepted name + cname + 保育狀態（給前端顯示用）。"""
    row = session.exec(
        select(TaicolName).where(
            TaicolName.taxon_id == taxon_id,
            TaicolName.usage_status == "accepted",
        )
    ).first()
    if not row:
        # fallback：取任意一筆（即使 not-accepted），以免完全失蹤
        row = session.exec(
            select(TaicolName).where(TaicolName.taxon_id == taxon_id)
        ).first()
    if not row:
        return None
    return {
        "taxon_id": row.taxon_id,
        "name": row.simple_name,
        "name_author": row.name_author,
        "formatted_name": row.formatted_name,
        "common_name_c": row.common_name_c,
        "alternative_name_c": row.alternative_name_c,
        "family": row.family,
        "family_c": row.family_c,
        "genus": row.genus,
        "kingdom": row.kingdom,
        "redlist": row.redlist,
        "iucn": row.iucn,
        "cites": row.cites,
        "protected": row.protected,
        "is_endemic": row.is_endemic,
        "alien_type": row.alien_type,
        "usage_status": row.usage_status,
    }


def _serialize_lead(session: Session, target_type: str, target_id: Optional[str],
                    marker: Optional[str], status: Optional[str], text: str) -> dict:
    out: dict = {
        "text": text or "",
        "target_type": target_type,
        "target_id": target_id,
        "marker": marker,
        "status": status,
    }
    if target_type == "taxon" and target_id:
        out["taxon"] = _accepted_taxon(session, target_id)
    return out


def _serialize_key_summary(k: IdentificationKey) -> dict:
    return {
        "id": k.id,
        "scope_taxon_id": k.scope_taxon_id,
        "scope_rank": k.scope_rank,
        "scope_name": k.scope_name,
        "scope_cname": k.scope_cname,
        "title": k.title,
        "source": k.source,
        "mode": k.mode,
        "parent_key_id": k.parent_key_id,
        "updated_at": k.updated_at,
    }


# ── List / detail ──

@router.get("/api/keys", summary="列出所有檢索表（支援 since 增量同步）")
async def list_keys(
    since: Optional[int] = Query(None, description="只回傳 updated_at >= since 的 keys（epoch ms）"),
    scope_rank: Optional[str] = Query(None, description="filter by family|genus|..."),
    scope_name: Optional[str] = Query(None, description="filter by exact scope name"),
    mode: Optional[str] = Query(None, description="filter by dichotomous|multi_access|both"),
):
    with Session(engine) as session:
        stmt = select(IdentificationKey)
        if since is not None:
            stmt = stmt.where(IdentificationKey.updated_at >= since)
        if scope_rank:
            stmt = stmt.where(IdentificationKey.scope_rank == scope_rank)
        if scope_name:
            stmt = stmt.where(IdentificationKey.scope_name == scope_name)
        if mode:
            stmt = stmt.where(IdentificationKey.mode == mode)
        rows = session.exec(stmt.order_by(IdentificationKey.scope_name)).all()
        return [_serialize_key_summary(r) for r in rows]


@router.get("/api/keys/{key_id}", summary="取得單一檢索表完整內容（couplets + features）")
async def get_key(key_id: int):
    with Session(engine) as session:
        k = session.get(IdentificationKey, key_id)
        if not k:
            raise HTTPException(status_code=404, detail="key not found")

        out = _serialize_key_summary(k)

        # Couplets (dichotomous)
        couplet_rows = session.exec(
            select(KeyCouplet).where(KeyCouplet.key_id == k.id)
            .order_by(KeyCouplet.number)
        ).all()
        out["couplets"] = [
            {
                "number": c.number,
                "lead_a": _serialize_lead(
                    session, c.lead_a_target_type, c.lead_a_target_id,
                    c.lead_a_taxon_marker, c.lead_a_taxon_status, c.lead_a_text,
                ),
                "lead_b": _serialize_lead(
                    session, c.lead_b_target_type, c.lead_b_target_id,
                    c.lead_b_taxon_marker, c.lead_b_taxon_status, c.lead_b_text,
                ),
            }
            for c in couplet_rows
        ]

        # Features (multi-access)
        feat_rows = session.exec(
            select(KeyFeature).where(KeyFeature.key_id == k.id)
            .order_by(KeyFeature.sort_order, KeyFeature.id)
        ).all()
        out["features"] = [
            {
                "id": f.id,
                "name": f.name,
                "type": f.type,
                "values_json": f.values_json,
                "category": f.category,
                "sort_order": f.sort_order,
            }
            for f in feat_rows
        ]

        # Taxon×feature matrix
        tfeat_rows = session.exec(
            select(KeyTaxonFeature).where(KeyTaxonFeature.key_id == k.id)
        ).all()
        out["taxon_features"] = [
            {
                "taxon_id": tf.taxon_id,
                "feature_id": tf.feature_id,
                "value": tf.value,
            }
            for tf in tfeat_rows
        ]

        # Child keys（subkey chain 用）
        children = session.exec(
            select(IdentificationKey).where(IdentificationKey.parent_key_id == k.id)
        ).all()
        out["children"] = [_serialize_key_summary(c) for c in children]

        # 解析 couplet 中 target_type='subkey' 的指向（mobile 可直接跳轉）
        return out


# ── Admin: import PDF ──

@router.post("/api/admin/import-key-pdf",
             summary="上傳 PDF 檢索表並 parse 寫入",
             description="接受 dichotomous key PDF（NTU 維管束植物野外鑑定指南排版），"
                         "用 pdfplumber bbox extraction 抽取 couplets / terminal 學名 / "
                         "IUCN 狀態 / marker，taxa 自動 join 到 taicol_names。")
async def import_key_pdf(
    pdf_file: UploadFile = File(..., description="PDF 檔（NTU 排版的科 / 屬檢索表）"),
    source_label: Optional[str] = Query(None, description="Source label, default=PDF:filename"),
):
    if not pdf_file.filename or not pdf_file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="請上傳 .pdf 檔案")

    content = await pdf_file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF 超過 50MB 限制")

    tmp_path = ""
    try:
        original_name = os.path.basename(pdf_file.filename)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", mode="wb") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from backend.services.key_pdf_import import import_pdf
        key_id = import_pdf(
            tmp_path,
            source_label=source_label,
            scope_name_override=original_name,
            dry_run=False,
        )

        # 回傳 summary
        with Session(engine) as session:
            k = session.get(IdentificationKey, key_id)
            cs = session.exec(
                select(KeyCouplet).where(KeyCouplet.key_id == key_id)
            ).all()
            taxa_resolved = sum(
                (1 if c.lead_a_target_type == "taxon" and c.lead_a_target_id else 0)
                + (1 if c.lead_b_target_type == "taxon" and c.lead_b_target_id else 0)
                for c in cs
            )
            return {
                "key_id": key_id,
                "scope_rank": k.scope_rank,
                "scope_name": k.scope_name,
                "title": k.title,
                "couplets": len(cs),
                "leads_with_taxon": taxa_resolved,
            }
    except Exception as e:
        logger.exception("import_key_pdf failed")
        raise HTTPException(status_code=500, detail=f"匯入失敗: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ── Admin: delete ──

@router.delete("/api/admin/keys/{key_id}", summary="刪除一份檢索表（含 couplets / features）")
async def delete_key(key_id: int):
    with Session(engine) as session:
        k = session.get(IdentificationKey, key_id)
        if not k:
            raise HTTPException(status_code=404, detail="key not found")
        # 手動 cascade
        for old in session.exec(select(KeyCouplet).where(KeyCouplet.key_id == key_id)).all():
            session.delete(old)
        for old in session.exec(select(KeyTaxonFeature).where(KeyTaxonFeature.key_id == key_id)).all():
            session.delete(old)
        for old in session.exec(select(KeyFeature).where(KeyFeature.key_id == key_id)).all():
            session.delete(old)
        session.delete(k)
        session.commit()
        return {"deleted": key_id}
