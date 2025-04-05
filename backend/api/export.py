from fastapi import Request, APIRouter
from fastapi.responses import PlainTextResponse, FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os
import tempfile
import yaml
import csv
import subprocess
import zipfile
import shutil
from backend.utils.mapper import convert_to_dwc

from backend.api.formatter import format_scientific_name_markdown # 格式化學名

router = APIRouter()

class SpeciesItem(BaseModel):
    id: int
    name: str
    fullname: str
    cname: str
    family: str
    family_cname: str
    iucn_category: Optional[str]
    endemic: int
    source: str
    pt_name: str


class ExportRequest(BaseModel):
    checklist: list[SpeciesItem]


# def formatScientificNameMarkdown(fullname: str) -> str:
#     import re
#     match = re.match(r"^([A-Z][a-z]+ [a-z\-]+)", fullname)
#     if not match:
#         return fullname
#     main = match[1]
#     rest = fullname[len(main):].strip()
#     return f"*{main}* {rest}"


# @router.post("/api/export")
# async def export(request: Request):
#     body = await request.json()
#     fmt = request.query_params.get("format", "markdown")
#     checklist = body.get("checklist", [])
# 
#     if fmt == "yaml":
#         return PlainTextResponse(yaml.dump({"checklist": checklist}, allow_unicode=True))
# 
#     elif fmt == "csv":
#         with tempfile.NamedTemporaryFile(mode="w+", delete=False, newline='', suffix=".csv") as f:
#             writer = csv.DictWriter(f, fieldnames=checklist[0].keys())
#             writer.writeheader()
#             writer.writerows(checklist)
#             f.flush()
#             return FileResponse(f.name, media_type="text/csv", filename="checklist.csv")
# 
#     elif fmt == "markdown" or fmt == "docx":
#         # group and format markdown
#         lines = []
#         grouped = {}
#         for item in checklist:
#             pt = item["pt_name"]
#             fam = item["family"]
#             grouped.setdefault(pt, {}).setdefault(fam, []).append(item)
# 
#         for pt in sorted(grouped.keys()):
#             lines.append(f"## {pt}")
#             for fam in sorted(grouped[pt].keys()):
#                 key_name = "name" if "name" in checklist[0] else "fullname"
#                 species_list = sorted(grouped[pt][fam], key=lambda x: x.get(key_name, ""))
#                 lines.append(f"  - **{species_list[0]['family_cname']} ({fam})** ({len(species_list)})")
#                 for item in species_list:
#                     parts = [
#                         f"    - {item['cname']}",
#                         f"({format_scientific_name_markdown(item['fullname'])})"
#                     ]
#                     if item.get("endemic") == 1: parts.append("#")
#                     if item.get("source") == "歸化": parts.append("*")
#                     if item.get("source") == "栽培": parts.append("†")
#                     if item.get("iucn_category"): parts.append(item["iucn_category"])
#                     lines.append(" ".join(parts))
#         md_text = "\n".join(lines)
# 
#         if fmt == "markdown":
#             return PlainTextResponse(md_text, media_type="text/markdown")
# 
#         # convert to docx using pandoc
#         with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".md") as mdfile:
#             mdfile.write(md_text)
#             mdfile.flush()
#             docx_path = mdfile.name.replace(".md", ".docx")
#             subprocess.run(["pandoc", mdfile.name, "-o", docx_path])
#             return FileResponse(docx_path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename="checklist.docx")
# 
#     return PlainTextResponse("Unsupported format", status_code=400)
# 

description = """

## 概要

匯出植物名錄為不同格式（Markdown、DOCX、YAML、CSV）之檔案。
此 API 適用於名錄產生工具，可將使用者選擇的物種清單依指定格式匯出。

1. 所有匯出皆會自動排序（高階類群 → 科名 → 學名）
2. Markdown/DOCX 中包含統計摘要（物種總數、科別總數）
3. YAML 會自動轉換成 Darwin Core 欄位名稱
4. DOCX 使用自訂樣式（reference.docx）美化輸出
5. 回傳的 ZIP 檔名稱包含時間戳記（例如 checklist202504051239.zip）

## Request format

- Method：POST
- Content-Type：application/json
- Query String：
  - format (選填)：
    - "markdown"（預設，也會同時產出 yaml 的名錄之壓縮檔）
    - "docx"（Word 檔，內含 checklist.md 與 checklist.yml 的壓縮檔）
    - "yaml"（單一 checklist.yml 檔）
    - "csv"（單一 CSV 檔）
- Body (JSON)：
  ```json
  {
    "checklist": [
      {
        "id": 123,
        "name": "Pinus taiwanensis",
        "fullname": "Pinus taiwanensis Hayata",
        "cname": "臺灣二葉松",
        "family": "Pinaceae",
        "family_cname": "松科",
        "iucn_category": "LC",
        "endemic": 1,
        "source": "原生",
        "pt_name": "裸子植物 Gymnosperms"
      },
      ...
    ]
  }
```

## 名錄格式說明

每筆物種資訊應包含：

| 欄位名稱      | 說明                       |
| ------------- | -------------------------- |
| id	        | 唯一 ID 編號               |
| name	        | 學名（不含作者）           |
| fullname	| 完整學名（含作者）         |
| cname	        | 中文名稱                   |
| family	| 科名（拉丁文）             |
| family_cname	| 科名（中文）               |
| pt_name	| 高階類群                   |
| endemic	| 是否特有（1 為特有）       |
| source	| 來源（原生、歸化、栽培）   |
| iucn_category	| IUCN 保育狀態（LC、VU 等） |

## Return

- format=markdown：
 - 回傳壓縮檔（ZIP），內含 checklist.md 及 checklist.yml

- format=docx：
 - 回傳壓縮檔（ZIP），內含 checklist.docx（由 Pandoc 轉換）與 checklist.yml

- format=yaml：
 - 直接回傳 YAML 格式名錄（含 Darwin Core 欄位名稱）

- format=csv：
 - 回傳 CSV 檔案(尚未實作)

"""

@router.post("/api/export",
             summary="匯出名錄檔",
             description=description)
async def export(request: Request):
    body = await request.json()
    fmt = request.query_params.get("format", "markdown")
    checklist = body.get("checklist", [])

    if not checklist:
        return PlainTextResponse("⚠️ checklist 為空", status_code=400)

    if fmt == "yaml":
        dwc_checklist = [convert_to_dwc(item) for item in checklist]
        return PlainTextResponse(yaml.dump({"checklist": dwc_checklist}, allow_unicode=True))

    elif fmt == "csv":
        with tempfile.NamedTemporaryFile(mode="w+", delete=False, newline='', suffix=".csv") as f:
            writer = csv.DictWriter(f, fieldnames=checklist[0].keys())
            writer.writeheader()
            writer.writerows(checklist)
            f.flush()
            return FileResponse(f.name, media_type="text/csv", filename="checklist.csv")

    elif fmt in ["markdown", "docx"]:
        # 高階類群順序
        type_order = {
            "苔蘚地衣類植物 Mosses and Lichens": 0,
            "石松類植物 Lycophytes": 1,
            "蕨類植物 Monilophytes": 2,
            "裸子植物 Gymnosperms": 3,
            "單子葉植物 Monocots": 4,
            "真雙子葉植物姊妹群 Sister groups of Eudicots": 5,
            "真雙子葉植物 Eudicots": 6
        }

        lines = []
        grouped = {}
        total_species = 0
        family_set = set()

        # 分群
        for item in checklist:
            pt = item["pt_name"]
            fam = item["family"]
            grouped.setdefault(pt, {}).setdefault(fam, []).append(item)
            total_species += 1
            family_set.add((pt, fam))

        # 說明 header
        lines.append("# 維管束植物名錄")
        lines.append(f"本名錄中共有 {len(family_set)} 科、{total_species} 種，科名後括弧內為該科之物種總數。\"#\" 代表特有種，\"*\" 代表歸化種，\"†\" 代表栽培種。")
        lines.append("中名後面括號內的縮寫代表依照「2017臺灣維管束植物紅皮書名錄」中依照 IUCN 瀕危物種所評估等級：EX: 滅絕、EW: 野外滅絕、RE: 區域性滅絕、CR: 嚴重瀕臨滅絕、EN: 瀕臨滅絕、VU: 易受害、NT: 接近威脅、DD: 資料不足、LC: 安全。")
        lines.append("")

        pt_sorted = sorted(grouped.keys(), key=lambda k: type_order.get(k, 99))
        counter = 1
        sp_counter = 1
        for pt in pt_sorted:
            lines.append("")
            lines.append(f"## {pt}")
            lines.append("")
            for fam in sorted(grouped[pt].keys()):
                lines.append("")
                species_list = sorted(grouped[pt][fam], key=lambda x: x["fullname"])
                lines.append(f"{counter}. **{species_list[0]['family_cname']} ({fam})** ({len(species_list)})")
                lines.append("")
                for idx, item in enumerate(species_list):
                    parts = [
                        f"    {sp_counter}. {item['cname']}",
                        f" {format_scientific_name_markdown(item['fullname'])} "
                    ]
                    if item.get("endemic") == 1: parts.append("#")
                    if item.get("source") == "歸化": parts.append("*")
                    if item.get("source") == "栽培": parts.append("†")
                    if item.get("iucn_category"): parts.append(item["iucn_category"])
                    lines.append(" ".join(parts))
                    sp_counter +=1
                lines.append("")
                counter += 1

        md_text = "\n".join(lines)

        dwc_checklist = [convert_to_dwc(item) for item in checklist]
        # export checklist.yml
        #with open(tempfile., "w", encoding="utf-8") as yf:
        #    yaml.dump({"checklist": dwc_checklist}, yf, allow_unicode=True)


        # Converting markdown to docx with pandoc 
        #with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".md") as mdfile:
        with tempfile.TemporaryDirectory() as tmpdir:
            base_path = os.path.join(tmpdir, "checklist")
            md_path = base_path + ".md"
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(md_text)

            # YAML 輸出
            yaml_path = base_path + ".yml"
            with open(yaml_path, "w", encoding="utf-8") as yf:
                yaml.dump({"checklist": dwc_checklist}, yf, allow_unicode=True)

            # compress zip
            timestamp = datetime.now().strftime("%Y%m%d%H%M")
            zip_filename = f"checklist{timestamp}.zip"
            zip_path = os.path.join(tmpdir, zip_filename)

            if fmt == "markdown":
                with zipfile.ZipFile(zip_path, "w") as zipf:
                    zipf.write(md_path, "checklist.md")
                    zipf.write(yaml_path, "checklist.yml")
            elif fmt == "docx":
                docx_path = base_path + ".docx"
                reference_path = os.path.join(os.path.dirname(__file__), "reference.docx")
                subprocess.run([
                    "pandoc", md_path,
                    "--reference-doc", reference_path,
                    "-o", docx_path
                ])
                with zipfile.ZipFile(zip_path, "w") as zipf:
                    zipf.write(docx_path, "checklist.docx")
                    zipf.write(yaml_path, "checklist.yml")

            final_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            shutil.copy(zip_path, final_zip.name)
            final_zip.flush()

            return FileResponse(
                final_zip.name,
                media_type="application/zip",
                filename=zip_filename
            )
            #return FileResponse(docx_path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename="checklist.docx")

    return PlainTextResponse("Unsupported format", status_code=400)
