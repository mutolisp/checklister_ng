"""【已停用】舊版日本名錄匯入器 —— 請改用 `backend/services/jp_import.py`。

2026-08-29 起日本側改為「wamei 和名チェックリスト ver.1.10 + dao_jp_ylist」合併，
產出 `jp_names`（25,839 筆）取代本檔的 `ylist_names`（20,103 筆）。本檔的 `build()`
若再執行會 **DROP 掉合併結果並回退成純 YList**，因此 CLI 入口已封死；保留本檔僅因
`jp_import` 沿用其中的共用函式（sci_norm / parse_genus / derive_rank /
load_family_backbone / TAICOL_COLUMNS / backup_db）。

以下為原始說明（僅供理解共用函式的行為）：

把使用者整理的日本植物名錄 `dao_jp_ylist` 轉成查詢就緒的 `ylist_names`。

設計脈絡見 plans/區域名錄整合：mobile 以台灣 TaiCOL 為基底，偏好設定可開啟
「區域名錄」（先做日本）。本腳本在 twnamelist.db 內做純 SQL 轉換，產出：

  1. ylist_names  — 欄位對齊 taicol_names（taicol 專屬欄填 NULL）+ region='JP'。
                    taxon_id 用 'y'+pad、name_id 加偏移避免與 taicol 整數撞。
  2. species_xref — (taxon_id, region, sci_norm, common_name_c) 涵蓋 taicol
                    accepted + ylist，sci_norm 建索引；同 sci_norm 跨區 = 共有種。
                    帶 common_name_c 讓跨區俗名查詢只需自我 join（不碰大表/view）。
  3. all_names    — taicol_names ∪ ylist_names view，僅供分類樹的「掃描+GROUP BY」
                    查詢用（~85ms）。⚠ 絕不可放進 JOIN 內側（會物化 ~270k 列、
                    數秒）。記錄/匯出解析 taxon_id 一律直接查實表（t…/y…）。

階層補齊：
  - genus 由學名第一 token 解析（dao_jp_ylist 無 genus 欄）。
  - phylum/class/order 由 family 經 GBIF backbone 參考檔回填
    （references/JP/YList/ylist_family_backbone.csv，已對齊 TaiCOL 慣例：
     單子葉 class Liliopsida→Magnoliopsida）。dao_jp_ylist 只有 family。
  - plant_type（0蘚苔/1蕨類/2裸子/3雙子葉/4單子葉）僅作交叉檢核 log。

只收接受名（dao_jp_ylist 本就無 synonym）。

CLI（專案根目錄）：
    backend/venv/bin/python -m backend.services.ylist_import [db_path]
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from pathlib import Path

from backend.db import sqlite_file_path
from backend.utils.backup import backup_db

# name_id 偏移：避免 ylist 的整數 name_id 與 taicol（~251k）相撞
YLIST_NAME_ID_OFFSET = 90_000_000

BACKBONE_CSV = (
    Path(__file__).resolve().parents[2]
    / "references" / "JP" / "YList" / "ylist_family_backbone.csv"
)

# taicol_names 完整欄位順序（ylist_names 對齊；region 另外加在最後）
TAICOL_COLUMNS = [
    "name_id", "rank", "simple_name", "name_author", "formatted_name",
    "usage_status", "taxon_id", "taxon_id_all", "is_in_taiwan",
    "common_name_c", "alternative_name_c", "is_endemic", "alien_type",
    "iucn", "redlist", "kingdom", "kingdom_c", "phylum", "phylum_c",
    "class", "class_c", "order", "order_c", "family", "family_c",
    "genus", "genus_c", "nomenclature_name", "cites", "is_fossil",
    "is_terrestrial", "is_freshwater", "is_brackish", "is_marine",
    "alien_status_note", "protected", "is_hybrid",
]

_WS = re.compile(r"\s+")
_HYBRID_TOKEN = {"x", "×", "X"}


def load_family_backbone() -> dict[str, tuple[str, str, str]]:
    """family → (phylum, class_after_remap, order)，來源 GBIF backbone 參考檔。"""
    if not BACKBONE_CSV.exists():
        raise FileNotFoundError(
            f"找不到科階層參考檔：{BACKBONE_CSV}（見腳本 docstring）"
        )
    out: dict[str, tuple[str, str, str]] = {}
    with BACKBONE_CSV.open(encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if not row or row[0].startswith("#") or row[0] == "family":
                continue
            family, phylum, klass, order = (c.strip() for c in row[:4])
            # 對齊 TaiCOL：單子葉 class 一律 Magnoliopsida（用 order 區分單/雙子葉）
            if klass == "Liliopsida":
                klass = "Magnoliopsida"
            out[family] = (phylum or None, klass or None, order or None)
    return out


def sci_norm(name: str) -> str:
    """正規化學名作跨區比對鍵：小寫、收斂空白、雜交記號統一為 x。"""
    s = _WS.sub(" ", (name or "").strip()).lower()
    return s.replace("×", "x")


def parse_genus(name: str) -> str | None:
    toks = _WS.sub(" ", (name or "").strip()).split(" ")
    if not toks:
        return None
    first = toks[0].lstrip("×").strip()
    if first in _HYBRID_TOKEN or first == "":
        # 雜交記號獨立成 token（× Genus）→ 取下一個
        return toks[1].lstrip("×").strip() if len(toks) > 1 else None
    return first


def derive_rank(name: str) -> str:
    low = f" {name.lower()} "
    if " var. " in low:
        return "Variety"
    if " subsp. " in low or " ssp. " in low:
        return "Subspecies"
    if " f. " in low or " fo. " in low:
        return "Form"
    toks = name.split()
    return "Species" if len(toks) >= 2 else "Genus"


def split_author(name: str, fullname: str) -> str | None:
    """fullname 以 `name + 空白` 開頭時取其餘為 author（種階層適用）；
    種下名 author 散在中間 → 回傳 None，由 formatted_name=fullname 保全。"""
    if not fullname:
        return None
    prefix = name + " "
    if fullname.startswith(prefix):
        return _WS.sub(" ", fullname[len(prefix):].strip()) or None
    return None


def transform_rows(
    src: list[sqlite3.Row], backbone: dict[str, tuple[str, str, str]]
) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    audit = {
        "total": 0, "genus_null": 0, "order_null": 0, "family_no_backbone": set(),
        "hybrid": 0, "ptype_class_mismatch": [],
    }
    for r in src:
        audit["total"] += 1
        name = (r["name"] or "").strip()
        # 來源 fullname 種下名常有雙空白（"Spruce  var."）→ 收斂
        fullname = _WS.sub(" ", (r["fullname"] or "").strip())
        family = (r["family"] or "").strip()
        genus = parse_genus(name)
        if not genus:
            audit["genus_null"] += 1

        phylum = klass = order = None
        if family in backbone:
            phylum, klass, order = backbone[family]
        elif family:
            audit["family_no_backbone"].add(family)
        if not order:
            audit["order_null"] += 1

        is_hybrid = "true" if ("×" in name or " x " in f" {name} ") else None
        if is_hybrid:
            audit["hybrid"] += 1

        rows.append({
            "name_id": YLIST_NAME_ID_OFFSET + int(r["id"]),
            "rank": derive_rank(name),
            "simple_name": name,
            "name_author": split_author(name, fullname),
            "formatted_name": fullname or name,
            "usage_status": "accepted",
            "taxon_id": f"y{int(r['id']):07d}",
            "taxon_id_all": f"y{int(r['id']):07d}",
            "is_in_taiwan": None,
            "common_name_c": (r["cname"] or None),
            "alternative_name_c": None,
            "is_endemic": "true" if r["endemic"] else "false",
            "alien_type": None,
            "iucn": (r["iucn_category"] or None),
            "redlist": None,
            "kingdom": "Plantae",
            "kingdom_c": "植物界",
            "phylum": phylum,
            "phylum_c": None,
            "class": klass,
            "class_c": None,
            "order": order,
            "order_c": None,
            "family": family or None,
            "family_c": (r["family_cname"] or None),
            "genus": genus,
            "genus_c": None,
            "nomenclature_name": None,
            "cites": None,
            "is_fossil": None,
            "is_terrestrial": None,
            "is_freshwater": None,
            "is_brackish": None,
            "is_marine": None,
            "alien_status_note": (r["source"] or None),
            "protected": None,
            "is_hybrid": is_hybrid,
            "region": "JP",
        })
    return rows, audit


def build(db_path: Path) -> None:
    if not db_path.exists():
        raise FileNotFoundError(db_path)

    backbone = load_family_backbone()
    backup_path = backup_db(str(db_path))
    print(f"已備份資料庫 → {backup_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    src = cur.execute("SELECT * FROM dao_jp_ylist;").fetchall()
    rows, audit = transform_rows(src, backbone)

    # ── ylist_names（欄位順序對齊 taicol_names + region）──
    cols = TAICOL_COLUMNS + ["region"]
    col_defs = ",\n  ".join(
        f'"{c}" INTEGER PRIMARY KEY' if c == "name_id"
        else f'"{c}" VARCHAR'
        for c in cols
    )
    cur.execute("DROP TABLE IF EXISTS ylist_names;")
    cur.execute(f"CREATE TABLE ylist_names (\n  {col_defs}\n);")
    placeholders = ", ".join("?" for _ in cols)
    cur.executemany(
        f'INSERT INTO ylist_names ({", ".join(chr(34)+c+chr(34) for c in cols)}) '
        f"VALUES ({placeholders});",
        [tuple(row[c] for c in cols) for row in rows],
    )

    for col in ("common_name_c", "simple_name", "family", "genus", "taxon_id"):
        cur.execute(
            f'CREATE INDEX idx_ylist_{col} ON ylist_names("{col}");'
        )
    cur.execute('CREATE INDEX idx_ylist_order ON ylist_names("order");')

    # ── species_xref：taicol accepted + ylist 的跨區比對表 ──
    # 帶 common_name_c，讓跨區俗名查詢只需 species_xref 自我 join（小表、全索引），
    # 完全不必碰 taicol_names/ylist_names（避免 view 物化造成的數秒級延遲）。
    cur.execute("DROP TABLE IF EXISTS species_xref;")
    cur.execute(
        "CREATE TABLE species_xref ("
        "taxon_id TEXT PRIMARY KEY, region TEXT, sci_norm TEXT, common_name_c TEXT);"
    )
    xref: list[tuple[str, str, str, str | None]] = []
    seen_tx: set[str] = set()
    tw = cur.execute(
        "SELECT taxon_id, simple_name, common_name_c FROM taicol_names "
        "WHERE usage_status='accepted' AND taxon_id IS NOT NULL "
        "GROUP BY taxon_id;"
    ).fetchall()
    for row in tw:
        tx = row["taxon_id"]
        if tx in seen_tx:
            continue
        seen_tx.add(tx)
        xref.append((tx, "TW", sci_norm(row["simple_name"]), row["common_name_c"]))
    for row in rows:
        xref.append((row["taxon_id"], "JP", sci_norm(row["simple_name"]), row["common_name_c"]))
    cur.executemany(
        "INSERT OR IGNORE INTO species_xref (taxon_id, region, sci_norm, common_name_c) "
        "VALUES (?, ?, ?, ?);",
        xref,
    )
    cur.execute("CREATE INDEX idx_xref_sci_norm ON species_xref(sci_norm);")

    # ── all_names view：taicol ∪ ylist（含 region）──
    # 只給「掃描 + GROUP BY」型查詢用（分類樹），那種用法 SQLite 會用
    # idx_taicol_usage_status 走 co-routine，~85ms 可接受。
    # ⚠ 絕不要把這個 view 放進 JOIN 的內側（如跨區俗名查詢）——會物化 ~270k
    # 列並建 automatic index，單次數秒。跨區俗名一律走 species_xref 自我 join；
    # 記錄/匯出解析 taxon_id 一律直接查 taicol_names / ylist_names（'t…'/'y…'）。
    view_cols = TAICOL_COLUMNS
    sel = ", ".join(f'"{c}"' for c in view_cols)
    cur.execute("DROP VIEW IF EXISTS all_names;")
    cur.execute(
        f"CREATE VIEW all_names AS "
        f"SELECT {sel}, 'TW' AS region FROM taicol_names "
        f"UNION ALL "
        f"SELECT {sel}, region FROM ylist_names;"
    )

    conn.commit()

    # ── audit ──
    shared = cur.execute(
        "SELECT count(*) FROM species_xref WHERE region='TW' AND sci_norm IN "
        "(SELECT sci_norm FROM species_xref WHERE region='JP');"
    ).fetchone()[0]
    cur.execute("VACUUM;")
    conn.close()

    print(f"ylist_names 匯入 {len(rows)} 筆（來源 dao_jp_ylist）")
    print(f"  genus 解析失敗：{audit['genus_null']}")
    print(f"  order 缺漏：{audit['order_null']}（預期為無 backbone 的科）")
    print(f"  雜交種標記：{audit['hybrid']}")
    if audit["family_no_backbone"]:
        miss = sorted(audit["family_no_backbone"])
        print(f"  ⚠ {len(miss)} 個科無 backbone：{miss[:20]}")
    print(f"  與 TaiCOL 共有種（同 sci_norm）：{shared}")
    print("species_xref（含 common_name_c）+ all_names view 已建立")


def main(argv: list[str]) -> int:
    # 封死入口：build() 會 DROP TABLE ylist_names 並重建 species_xref/all_names，
    # 在合併後的資料庫上執行等於把 wamei 那 5,736 個分類群與 30,340 個和名全部丟掉。
    print(
        "此匯入器已停用。日本名錄請執行：\n"
        "  python -m backend.services.jp_import\n"
        "（合併 wamei 和名チェックリスト + dao_jp_ylist → jp_names）",
        file=sys.stderr,
    )
    return 2


def _main_legacy(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="dao_jp_ylist → ylist_names + species_xref + all_names"
    )
    parser.add_argument(
        "db_path", nargs="?", type=Path, default=Path(sqlite_file_path),
        help=f"twnamelist.db 路徑（預設 {sqlite_file_path}）",
    )
    args = parser.parse_args(argv)
    build(args.db_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
