from fastapi import Request, APIRouter, BackgroundTasks
from fastapi.responses import PlainTextResponse, FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from sqlmodel import Session, select
import os
import tempfile
import yaml
import csv
import subprocess
import zipfile
import shutil
from backend.utils.mapper import convert_to_dwc
from backend.db import engine
from backend.models.schema import PlantType, PlantName

from backend.api.formatter import format_scientific_name_markdown
import sys

def _get_base_path():
    if getattr(sys, '_MEIPASS', None):
        return sys._MEIPASS
    return os.path.join(os.path.dirname(__file__), '..', '..')

router = APIRouter()

# ── 各分類群預設階層 ──────────────────────────────────────
# 每個 key 對應物種資料中的 phylum 或 class_name 值
# value 是用於分群的欄位列表（由高到低），最後一層永遠是物種
DEFAULT_HIERARCHIES = {
    "Tracheophyta": ["pt_name", "family"],
    "Bryophyta": ["class_name", "family"],
    "Aves": ["order", "family"],
    "Insecta": ["order", "family"],
    "Mammalia": ["order", "family"],
    "Reptilia": ["order", "family"],
    "Amphibia": ["order", "family"],
    "Actinopteri": ["order", "family"],
    "Arachnida": ["order", "family"],
    "Gastropoda": ["order", "family"],
    "Bivalvia": ["order", "family"],
    "Malacostraca": ["order", "family"],
    "Ascomycota": ["class_name", "order", "family"],
    "Basidiomycota": ["class_name", "order", "family"],
    "Mollusca": ["class_name", "order", "family"],
    "_default": ["class_name", "family"],
}

# 維管束植物 class → 中文顯示名（非 Magnoliopsida 的 class 直接對應）
PLANT_CLASS_NAMES = {
    "Lycopodiopsida": "石松類植物 Lycophytes",
    "Polypodiopsida": "蕨類植物 Monilophytes",
    "Cycadopsida": "裸子植物 Gymnosperms",
    "Ginkgoopsida": "裸子植物 Gymnosperms",
    "Pinopsida": "裸子植物 Gymnosperms",
}

# Magnoliopsida (被子植物) 需用 order 區分單子葉/真雙子葉/姊妹群
MONOCOT_ORDERS = {
    "Acorales", "Alismatales", "Arecales", "Asparagales", "Commelinales",
    "Dioscoreales", "Liliales", "Pandanales", "Petrosaviales", "Poales",
    "Zingiberales",
}
SISTER_EUDICOT_ORDERS = {"Ceratophyllales"}

def _resolve_angiosperm_group(order: str) -> str:
    """Magnoliopsida 用 order 區分單子葉/真雙子葉植物姊妹群/真雙子葉植物"""
    if order in MONOCOT_ORDERS:
        return "單子葉植物 Monocots"
    if order in SISTER_EUDICOT_ORDERS:
        return "真雙子葉植物姊妹群 Sister groups of Eudicots"
    return "真雙子葉植物 Eudicots"

# pt_name 排序值（對應 dao_plant_type.plant_type）
PT_NAME_ORDER = {
    "苔蘚地衣類植物 Mosses and Lichens": 0,
    "石松類植物 Lycophytes": 1,
    "蕨類植物 Monilophytes": 2,
    "裸子植物 Gymnosperms": 3,
    "單子葉植物 Monocots": 4,
    "真雙子葉植物姊妹群 Sister groups of Eudicots": 5,
    "真雙子葉植物 Eudicots": 6,
    "被子植物 Angiosperms": 7,
}

# 從舊表查詢 pt_name 的快取
_pt_name_cache: Optional[dict] = None

def _get_pt_name_for_species(species_name: str) -> str:
    """從 dao_pnamelist_pg 查詢物種的 pt_name"""
    global _pt_name_cache
    if _pt_name_cache is None:
        _pt_name_cache = {}
        try:
            with Session(engine) as session:
                rows = session.exec(
                    select(PlantName.name, PlantType.pt_name)
                    .join(PlantType, PlantName.plant_type == PlantType.plant_type)
                ).all()
                for name, pt_name in rows:
                    _pt_name_cache[name] = pt_name
        except Exception:
            pass
    return _pt_name_cache.get(species_name, "")

# 階層欄位的中文顯示名
LEVEL_LABELS = {
    "kingdom": "界",
    "phylum": "門",
    "class_name": "綱",
    "order": "目",
    "family": "科",
    "genus": "屬",
    "pt_name": "類群",
}

# 分類群顯示順序（偵測到多個分類群時的排列）
GROUP_ORDER = [
    "Tracheophyta", "Bryophyta",  # 植物
    "Ascomycota", "Basidiomycota",  # 真菌
    "Aves", "Mammalia", "Reptilia", "Amphibia", "Actinopteri",  # 脊索
    "Insecta", "Arachnida", "Malacostraca",  # 節肢
    "Gastropoda", "Bivalvia",  # 軟體
]

# 分類群中文名
GROUP_NAMES = {
    "Tracheophyta": "維管束植物",
    "Bryophyta": "苔蘚植物",
    "Aves": "鳥綱",
    "Insecta": "昆蟲綱",
    "Mammalia": "哺乳綱",
    "Reptilia": "爬行綱",
    "Amphibia": "兩生綱",
    "Actinopteri": "輻鰭魚綱",
    "Arachnida": "蛛形綱",
    "Gastropoda": "腹足綱",
    "Bivalvia": "雙殼綱",
    "Malacostraca": "軟甲綱",
    "Ascomycota": "子囊菌門",
    "Basidiomycota": "擔子菌門",
    "Mollusca": "軟體動物門",
}


def _detect_group(item: dict) -> str:
    """從物種資料偵測所屬分類群"""
    # 優先用 class_name，再用 phylum
    cls = item.get("class_name", "")
    phy = item.get("phylum", "")

    if cls in DEFAULT_HIERARCHIES:
        return cls
    if phy in DEFAULT_HIERARCHIES:
        return phy
    # 舊資料可能只有 pt_name（維管束植物）
    if item.get("pt_name", ""):
        return "Tracheophyta"
    return "_default"


def _get_field_display(item: dict, field: str) -> str:
    """取得階層欄位的顯示文字（中文名 + 拉丁名）"""
    if field == "family":
        fc = item.get("family_cname", "") or ""
        fl = item.get("family", "") or ""
        return f"{fc} ({fl})" if fc else fl
    elif field == "pt_name":
        # 維管束植物：嚴格使用石松類/蕨類/裸子/單子葉/真雙子葉姊妹群/真雙子葉
        is_vascular = (item.get("phylum", "") == "Tracheophyta" or
                       "Tracheophyta" in (item.get("pt_name", "") or ""))
        if is_vascular:
            # 1. 先查 dao（最準確）
            name = item.get("name", "") or ""
            pt = _get_pt_name_for_species(name)
            if pt:
                return pt
            # 2. 非 Magnoliopsida 的 class 直接對照
            cls = item.get("class_name", "") or ""
            if cls in PLANT_CLASS_NAMES:
                return PLANT_CLASS_NAMES[cls]
            # 3. Magnoliopsida 用 order 區分單子葉/真雙子葉
            if cls == "Magnoliopsida":
                order = item.get("order", "") or ""
                return _resolve_angiosperm_group(order)
        # 非維管束植物：用原始 pt_name
        pt = item.get("pt_name", "") or ""
        if pt and not pt.startswith("Tracheophyta"):
            return pt
        cls = item.get("class_name", "") or ""
        return cls
    elif field == "class_name":
        cls = item.get("class_name", "") or ""
        if item.get("phylum") == "Tracheophyta" and cls in PLANT_CLASS_NAMES:
            return PLANT_CLASS_NAMES[cls]
        return cls
    elif field == "order":
        return item.get("order", "") or ""
    elif field == "genus":
        gc = item.get("genus_c", "") or ""
        gl = item.get("genus", "") or ""
        return f"{gc} ({gl})" if gc else gl
    elif field == "phylum":
        return item.get("phylum", "") or ""
    elif field == "kingdom":
        return item.get("kingdom", "") or ""
    return item.get(field, "") or ""


def _get_field_sort_key(item: dict, field: str) -> str:
    """取得階層欄位的排序 key"""
    if field == "family":
        return item.get("family", "") or ""
    if field == "pt_name":
        # 用 display 邏輯保持排序一致
        return _get_field_display(item, field)
    return item.get(field, "") or ""


def _generate_markdown(checklist: list[dict], levels_override: Optional[list[str]] = None, metadata: dict = None) -> str:
    """從名錄產生 Markdown 文字，支援多分類群和可配置階層"""
    if metadata is None:
        metadata = {}

    # 偵測分類群並分組
    groups: dict[str, list[dict]] = {}
    for item in checklist:
        g = _detect_group(item)
        groups.setdefault(g, [])
        groups[g].append(item)

    # 排序分類群
    sorted_groups = sorted(groups.keys(), key=lambda g: (
        GROUP_ORDER.index(g) if g in GROUP_ORDER else 999, g
    ))

    total_species = len(checklist)
    total_families = len({(item.get("family", ""), _detect_group(item)) for item in checklist})

    lines = []
    # Header with metadata
    title = metadata.get("project", "") or "物種名錄"
    lines.append(f"# {title}")
    if metadata.get("site"):
        lines.append(f"**樣區：** {metadata['site']}")
    lines.append("")
    lines.append(f"本名錄共有 {total_families} 科、{total_species} 種。"
                 f"\"#\" 代表特有種，\"*\" 代表歸化種，\"†\" 代表栽培種。")
    lines.append("")

    counter = 1
    sp_counter = 1

    for group_key in sorted_groups:
        group_items = groups[group_key]
        group_name = GROUP_NAMES.get(group_key, group_key)

        # 決定階層
        if levels_override:
            levels = levels_override
        else:
            levels = DEFAULT_HIERARCHIES.get(group_key, DEFAULT_HIERARCHIES["_default"])

        # 多分類群時加入分類群標題
        if len(sorted_groups) > 1:
            lines.append("")
            lines.append(f"## {group_name} {group_key}")
            lines.append("")

        # 依階層遞迴分群
        counter, sp_counter = _render_group(
            lines, group_items, levels, 0, counter, sp_counter,
            single_group=(len(sorted_groups) == 1)
        )

    return "\n".join(lines)


def _render_group(
    lines: list[str],
    items: list[dict],
    levels: list[str],
    depth: int,
    counter: int,
    sp_counter: int,
    single_group: bool = False,
) -> tuple[int, int]:
    """遞迴渲染分群結構"""

    if depth >= len(levels):
        # 已到最底層，輸出物種
        sorted_items = sorted(items, key=lambda x: x.get("fullname", ""))
        for item in sorted_items:
            indent = "  " * depth
            parts = [
                f"{indent}{sp_counter}. {item.get('cname', '')}",
                f" {format_scientific_name_markdown(item.get('fullname', ''), item.get('kingdom', ''), item.get('nomenclature_name', ''))} "
            ]
            if item.get("endemic") == 1: parts.append("#")
            if item.get("source") == "歸化": parts.append("*")
            if item.get("source") == "栽培": parts.append("†")
            if item.get("redlist"): parts.append(item["redlist"])
            lines.append(" ".join(parts))
            sp_counter += 1
        return counter, sp_counter

    field = levels[depth]
    is_last_group_level = (depth == len(levels) - 1)

    # 按當前階層分群
    grouped: dict[str, list[dict]] = {}
    for item in items:
        key = _get_field_sort_key(item, field)
        grouped.setdefault(key, [])
        grouped[key].append(item)

    # 排序：pt_name 用 PT_NAME_ORDER，其他按字母
    if field == "pt_name":
        sort_fn = lambda k: PT_NAME_ORDER.get(k, 99)
    else:
        sort_fn = lambda k: k

    for group_key in sorted(grouped.keys(), key=sort_fn):
        group_items = grouped[group_key]
        display = _get_field_display(group_items[0], field)
        species_count = sum(1 for it in group_items if it.get("rank", "Species") in ("Species", "Subspecies", "Variety", "Form", ""))

        if depth == 0 and not is_last_group_level:
            # 頂層非科：用 ## 標題
            heading = f"## {display}" if single_group else f"### {display}"
            lines.append("")
            lines.append(heading)
            lines.append("")
            counter, sp_counter = _render_group(lines, group_items, levels, depth + 1, counter, sp_counter, single_group)
        elif is_last_group_level or (depth > 0 and depth == len(levels) - 1):
            # 最底層分群（通常是科）：用編號列表
            lines.append("")
            lines.append(f"{counter}. **{display}** ({species_count})")
            lines.append("")
            counter += 1
            _, sp_counter = _render_group(lines, group_items, levels, depth + 1, counter, sp_counter, single_group)
        else:
            # 中間層
            lines.append("")
            lines.append(f"{'#' * min(depth + 2, 4)} {display}")
            lines.append("")
            counter, sp_counter = _render_group(lines, group_items, levels, depth + 1, counter, sp_counter, single_group)

    return counter, sp_counter


description = """

## 概要

匯出物種名錄為不同格式（Markdown、DOCX、YAML、CSV）之檔案。
支援多分類群自動偵測，每個分類群套用預設階層。

## Query Parameters

- `format`: markdown（預設）、docx、yaml、csv
- `levels`（可選）: 自訂分群階層，逗號分隔，例如 `levels=order,family`
  可用值：kingdom, phylum, class_name, order, family, genus, pt_name

"""

@router.post("/api/export",
             summary="匯出名錄檔",
             description=description)
async def export(request: Request, background_tasks: BackgroundTasks):
    body = await request.json()
    fmt = request.query_params.get("format", "markdown")
    levels_param = request.query_params.get("levels", "")
    checklist = body.get("checklist", [])

    if not checklist:
        return PlainTextResponse("⚠️ checklist 為空", status_code=400)

    levels_override = [l.strip() for l in levels_param.split(",") if l.strip()] if levels_param else None

    if fmt == "yaml":
        dwc_checklist = [convert_to_dwc(item) for item in checklist]
        yaml_data: dict = {"checklist": dwc_checklist}
        if body.get("project"):
            yaml_data["project"] = body["project"]
        if body.get("site"):
            yaml_data["site"] = body["site"]
        if body.get("footprintWKT"):
            yaml_data["footprintWKT"] = body["footprintWKT"]
        return PlainTextResponse(yaml.dump(yaml_data, allow_unicode=True))

    elif fmt == "csv":
        with tempfile.NamedTemporaryFile(mode="w+", delete=False, newline='', suffix=".csv") as f:
            writer = csv.DictWriter(f, fieldnames=checklist[0].keys())
            writer.writeheader()
            writer.writerows(checklist)
            f.flush()
            return FileResponse(f.name, media_type="text/csv", filename="checklist.csv")

    elif fmt in ["markdown", "docx"]:
        export_metadata = {
            "project": body.get("project", ""),
            "site": body.get("site", ""),
            "footprintWKT": body.get("footprintWKT", ""),
        }
        md_text = _generate_markdown(checklist, levels_override, export_metadata)

        dwc_checklist = [convert_to_dwc(item) for item in checklist]

        with tempfile.TemporaryDirectory() as tmpdir:
            base_path = os.path.join(tmpdir, "checklist")
            md_path = base_path + ".md"
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(md_text)

            yaml_path = base_path + ".yml"
            yaml_data: dict = {"checklist": dwc_checklist}
            if export_metadata.get("project"):
                yaml_data["project"] = export_metadata["project"]
            if export_metadata.get("site"):
                yaml_data["site"] = export_metadata["site"]
            if export_metadata.get("footprintWKT"):
                yaml_data["footprintWKT"] = export_metadata["footprintWKT"]
            with open(yaml_path, "w", encoding="utf-8") as yf:
                yaml.dump(yaml_data, yf, allow_unicode=True)

            timestamp = datetime.now().strftime("%Y%m%d%H%M")
            zip_filename = f"checklist{timestamp}.zip"
            zip_path = os.path.join(tmpdir, zip_filename)

            if fmt == "markdown":
                with zipfile.ZipFile(zip_path, "w") as zipf:
                    zipf.write(md_path, "checklist.md")
                    zipf.write(yaml_path, "checklist.yml")
            elif fmt == "docx":
                docx_path = base_path + ".docx"
                reference_path = os.path.join(_get_base_path(), "backend", "api", "reference.docx")
                # 檢查 pandoc 和 reference.docx 是否存在
                pandoc_cmd = shutil.which("pandoc")
                if not pandoc_cmd:
                    # fallback: 直接檢查 bundle 目錄
                    base = _get_base_path()
                    for name in ["pandoc.exe", "pandoc"]:
                        candidate = os.path.join(base, name)
                        if os.path.isfile(candidate):
                            pandoc_cmd = candidate
                            break
                if not pandoc_cmd:
                    return PlainTextResponse(
                        f"找不到 pandoc。base={_get_base_path()}, PATH={os.environ.get('PATH', '')[:300]}",
                        status_code=500
                    )
                if not os.path.isfile(reference_path):
                    return PlainTextResponse(
                        f"找不到 reference.docx: {reference_path}",
                        status_code=500
                    )
                # Windows console=False 時需要隱藏子程序視窗
                kwargs = {}
                if sys.platform == "win32":
                    si = subprocess.STARTUPINFO()
                    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    si.wShowWindow = 0  # SW_HIDE
                    kwargs["startupinfo"] = si
                # 先測試 pandoc 是否能執行
                try:
                    ver = subprocess.run(
                        [pandoc_cmd, "--version"],
                        capture_output=True, text=True, timeout=10, **kwargs
                    )
                    if ver.returncode != 0:
                        return PlainTextResponse(
                            f"pandoc --version failed (rc={ver.returncode}): stdout={ver.stdout[:200]} stderr={ver.stderr[:200]}",
                            status_code=500
                        )
                except Exception as e:
                    return PlainTextResponse(
                        f"pandoc cannot start {type(e).__name__}: {e}, cmd={pandoc_cmd}",
                        status_code=500
                    )
                try:
                    result = subprocess.run(
                        [pandoc_cmd, md_path, "--reference-doc", reference_path, "-o", docx_path],
                        capture_output=True, text=True, timeout=30, **kwargs
                    )
                except Exception as e:
                    return PlainTextResponse(
                        f"Pandoc exception {type(e).__name__}: {e}",
                        status_code=500
                    )
                if result.returncode != 0:
                    return PlainTextResponse(
                        f"Pandoc conversion failed (rc={result.returncode}): stdout={result.stdout[:200]} stderr={result.stderr[:200]}",
                        status_code=500
                    )
                with zipfile.ZipFile(zip_path, "w") as zipf:
                    zipf.write(docx_path, "checklist.docx")
                    zipf.write(yaml_path, "checklist.yml")

            final_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            shutil.copy(zip_path, final_zip.name)
            final_zip.flush()

            # 回傳後清理 temp file
            background_tasks.add_task(os.unlink, final_zip.name)

            return FileResponse(
                final_zip.name,
                media_type="application/zip",
                filename=zip_filename
            )

    return PlainTextResponse("Unsupported format", status_code=400)
