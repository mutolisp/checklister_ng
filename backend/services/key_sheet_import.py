"""key_sheet_import.py — Import dichotomous key from Google Sheets.

Sheet convention
----------------
* One spreadsheet may carry multiple keys; each *worksheet* is one key.
* Worksheet **name** = scope Latin name (e.g. `Selaginellaceae` → family,
  `Phlegmariurus` → genus). `aceae` suffix decides scope_rank.
* First row is the header `id | description | target`.
* Each subsequent row is a **lead**. Two consecutive rows sharing the same
  `id` form one couplet (first row = lead A, second = lead B). Any rows
  beyond two for the same id emit a warning and are dropped.
* `target`:
    * a pure integer  → "next couplet N"
    * else            → terminal taxon. Splits on the first CJK token:
                        before = sciname tokens, after = vernacular name.
                        If the sciname starts with a lowercase token, the
                        worksheet's `default_genus` is prepended. Default
                        genus is the first capitalized leading token seen
                        in any target cell (or you can spell the genus on
                        the first taxon row to set it).
* status / marker NOT recorded in the sheet — joined from TaiCOL at query
  time. `cname` from sheet is stored verbatim as a display-time override.

Usage
-----
    export GLORIA_GOOGLE_CREDENTIALS=/path/to/service-account.json
    python -m backend.services.key_sheet_import <spreadsheet_id> [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from typing import Optional

import gspread
from google.oauth2.service_account import Credentials
from sqlmodel import Session, select

from backend.db import engine
from backend.models.schema import (
    IdentificationKey,
    KeyCouplet,
    KeyFeature,
    KeyTaxonFeature,
    TaicolName,
)


SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
# Third column may be labelled `target` or `couplet` interchangeably.
EXPECTED_HEADER_PREFIX = ["id", "description"]
TARGET_HEADERS = {"target", "couplet"}
# Worksheets named like these are treated as spreadsheet-level metadata
# and skipped when iterating over key worksheets.
META_SHEET_NAMES = {"meta", "metadata"}
CJK_RE = re.compile(r"[一-鿿]")

# ── multi-access (matrix) key convention ──
# Worksheets ending with this suffix are parsed as multi-access matrices
# instead of dichotomous couplet tables. Same spreadsheet may carry both
# (e.g. `Cyatheaceae` + `Cyatheaceae_m`), producing two IdentificationKey
# rows with different `mode` values pointing at the same scope.
MATRIX_SUFFIX = "_m"
# In-cell separator for multi-value taxon features (e.g. `橫走|短直立`
# means the taxon can exhibit either state).
MATRIX_MULTI_SEP = "|"
# Header columns that hold the taxon's identity (not features).
NAME_HEADERS = {"name", "scientific name", "sciname"}
CNAME_HEADERS = {"中名", "common name", "cname"}
# Numeric range regex — accepts integers, decimals, ranges with `-` / `–` / `~`,
# and open-ended comparators `<5` / `>=3`. Whitespace-tolerant.
NUMERIC_RE = re.compile(
    r"^\s*([<>]=?|=)?\s*-?\d+(?:[.,]\d+)?(?:\s*[-–~]\s*-?\d+(?:[.,]\d+)?)?\s*$"
)
# Auto-detect thresholds (see Step 2 of MAK design discussion).
#   - ≥50% numeric tokens in column            → 'numeric'
#   - distinct values > 8                       → 'text' (too varied for chips)
#   - distinct/taxa-with-value ratio > 0.6      → 'text' (essentially unique per taxon)
#   - else                                      → 'categorical'
MATRIX_NUMERIC_RATIO = 0.5
MATRIX_CATEGORICAL_MAX_DISTINCT = 8
MATRIX_TEXT_RATIO = 0.6


# ── auth ──

def _open_client() -> gspread.Client:
    cred_path = os.environ.get("GLORIA_GOOGLE_CREDENTIALS")
    if not cred_path:
        raise RuntimeError("GLORIA_GOOGLE_CREDENTIALS env var not set")
    if not os.path.isfile(cred_path):
        raise RuntimeError(f"Service account JSON not found at: {cred_path}")
    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return gspread.authorize(creds)


# ── parsing ──

def _detect_scope_from_name(name: str) -> tuple[str, str]:
    # Botanical rank suffix conventions (ICN):
    #   *aceae   → family (e.g. Asteraceae)
    #   *oideae  → subfamily (e.g. Bambusoideae, Faboideae)
    #   *eae     → tribe (e.g. Andropogoneae); checked after oideae
    # Anything else defaults to genus scope.
    if name.endswith("aceae"):
        return "family", name
    if name.endswith("oideae"):
        return "subfamily", name
    if name.endswith("eae"):
        return "tribe", name
    return "genus", name


def _parse_target(cell: str, default_genus: Optional[str]) -> dict:
    s = (cell or "").strip()
    if not s:
        return {"type": "unresolved", "sciname": None, "cname": None, "next": None}

    if s.isdigit():
        return {"type": "couplet", "next": s, "sciname": None, "cname": None}

    tokens = s.split()
    cjk_idx: Optional[int] = None
    for i, t in enumerate(tokens):
        if CJK_RE.search(t):
            cjk_idx = i
            break

    if cjk_idx == 0:
        # Pure CJK with no sciname → unresolved (can't join TaiCOL)
        return {"type": "unresolved", "sciname": None, "cname": s, "next": None}

    if cjk_idx is None:
        sciname_tokens = tokens
        cname: Optional[str] = None
    else:
        sciname_tokens = tokens[:cjk_idx]
        cname = " ".join(tokens[cjk_idx:])

    sciname = " ".join(sciname_tokens).strip()
    if sciname and sciname[0].islower() and default_genus:
        sciname = f"{default_genus} {sciname}"

    return {"type": "taxon", "sciname": sciname, "cname": cname, "next": None}


def _detect_default_genus(target_cells: list[str], worksheet_name: str) -> Optional[str]:
    """Detection order:
       1. First capitalized leading token in any non-numeric target cell
          (covers multi-genus keys where rows like 'Phlegmariurus salvinioides …'
          are written out fully).
       2. Worksheet name itself, when it looks like a genus (first letter
          uppercase, not ending in 'aceae'). Used for single-genus keys where
          all target cells are just epithets (e.g. 'tamariscina 萬年松').
    """
    for cell in target_cells:
        s = (cell or "").strip()
        if not s or s.isdigit():
            continue
        first = s.split()[0]
        if first[:1].isupper():
            return first
    if (
        worksheet_name
        and worksheet_name[:1].isupper()
        and not worksheet_name.endswith("aceae")
        and not worksheet_name.endswith("oideae")
        and not worksheet_name.endswith("eae")
    ):
        return worksheet_name
    return None


# ── multi-access (matrix) parsing ──

def _split_multi(value: str) -> list[str]:
    """Split a matrix cell on the multi-value separator. Trims whitespace,
    drops empties. Returns [] for blank cells."""
    if MATRIX_MULTI_SEP in value:
        return [x.strip() for x in value.split(MATRIX_MULTI_SEP) if x.strip()]
    s = value.strip()
    return [s] if s else []


def _detect_feature_type(col_values: list[str]) -> tuple[str, list[str]]:
    """Auto-detect a feature's type from its column values.

    Returns (type, sorted_distinct_values). Type ∈ {'numeric','categorical','text'}.

    Default policy: every non-Name/中名 column should participate in filter, so
    we collapse to two types in auto-detect:
      - 'numeric' when ≥50% of tokens look numeric (`MATRIX_NUMERIC_RATIO`).
        Distinct values returned as-is; UI parses ranges/comparators at runtime.
      - 'categorical' otherwise — the entire distinct set becomes the chip
        palette, regardless of cardinality. Sheet authors are expected to
        keep morphology vocab small enough to fit; if a column is genuinely
        narrative (a "分布" / 「備註」 free-text field) they can opt out via
        meta-sheet `feature_types` override (e.g. `{"分布":"text"}`).
      - 'text' is only returned for truly empty columns (nothing to filter)
        and via explicit override; the mobile UI treats text features as
        display-only inline info on candidate cards.

    Previous heuristics (`MATRIX_CATEGORICAL_MAX_DISTINCT`, `MATRIX_TEXT_RATIO`)
    are kept as documentation but no longer enforced — they wrongly excluded
    morphology columns like 葉形 / 成熟莖 from filtering once the controlled
    vocab grew past 8 distinct values.
    """
    tokens: list[str] = []
    for v in col_values:
        tokens.extend(_split_multi(v))
    if not tokens:
        return ("text", [])
    numeric_count = sum(1 for t in tokens if NUMERIC_RE.match(t))
    if numeric_count / len(tokens) >= MATRIX_NUMERIC_RATIO:
        return ("numeric", sorted(set(tokens)))
    return ("categorical", sorted(set(tokens)))


def parse_matrix_worksheet(
    ws: gspread.Worksheet, type_overrides: dict[str, str]
) -> Optional[dict]:
    """Parse a multi-access matrix worksheet (suffix `_m`).

    Header row: `Name | 中名 | feature1 | feature2 | ...`
    Data rows:  one taxon per row, feature cells may contain `|`-separated
                multi-values.

    `type_overrides` maps feature name → explicit type (from meta worksheet
    `feature_types` JSON), bypassing auto-detection for edge cases.

    Returns:
      {
        worksheet_name, scope_rank, scope_name, mode: 'multi_access',
        default_genus: None,  # not used for matrix; kept for shape parity
        features: [{name, type, values_json, sort_order, category}],
        taxa:     [{sciname, cname, feature_values: {fname: [v1, v2, ...]}}],
      }
    """
    name = ws.title
    scope_base = name[: -len(MATRIX_SUFFIX)] if name.endswith(MATRIX_SUFFIX) else name
    rank, scope_name = _detect_scope_from_name(scope_base)
    rows = ws.get_all_values()
    if len(rows) < 2:
        print(f"  [skip] '{name}': empty or no data rows")
        return None

    header = rows[0]
    name_idx: Optional[int] = None
    cname_idx: Optional[int] = None
    for i, h in enumerate(header):
        low = h.strip().lower()
        if name_idx is None and low in NAME_HEADERS:
            name_idx = i
        elif cname_idx is None and (low in CNAME_HEADERS or h.strip() in CNAME_HEADERS):
            cname_idx = i
    if name_idx is None:
        print(f"  [skip] '{name}': no 'Name' column in header {header}")
        return None

    feature_cols: list[tuple[int, str]] = []
    for i, h in enumerate(header):
        if i == name_idx or i == cname_idx:
            continue
        fname = h.strip()
        if not fname:
            continue
        feature_cols.append((i, fname))
    if not feature_cols:
        print(f"  [skip] '{name}': no feature columns after Name/中名")
        return None

    data_rows = [r for r in rows[1:] if any(c.strip() for c in r)]
    if not data_rows:
        print(f"  [skip] '{name}': no data rows")
        return None

    features: list[dict] = []
    for sort_order, (col_idx, fname) in enumerate(feature_cols):
        col_values = [r[col_idx] if col_idx < len(r) else "" for r in data_rows]
        if fname in type_overrides:
            ftype = type_overrides[fname]
            tokens: list[str] = []
            for v in col_values:
                tokens.extend(_split_multi(v))
            distinct = sorted(set(tokens))
        else:
            ftype, distinct = _detect_feature_type(col_values)
        features.append({
            "name": fname,
            "type": ftype,
            "values_json": json.dumps(distinct, ensure_ascii=False) if ftype == "categorical" else None,
            "sort_order": sort_order,
            "category": None,
        })

    taxa: list[dict] = []
    for r in data_rows:
        sciname = (r[name_idx] if name_idx < len(r) else "").strip()
        cname = ""
        if cname_idx is not None and cname_idx < len(r):
            cname = r[cname_idx].strip()
        if not sciname:
            continue
        feature_values: dict[str, list[str]] = {}
        for col_idx, fname in feature_cols:
            v = r[col_idx] if col_idx < len(r) else ""
            feature_values[fname] = _split_multi(v)
        taxa.append({
            "sciname": sciname,
            "cname": cname,
            "feature_values": feature_values,
        })

    return {
        "worksheet_name": name,
        "scope_rank": rank,
        "scope_name": scope_name,
        "mode": "multi_access",
        "default_genus": None,
        "features": features,
        "taxa": taxa,
    }


def parse_worksheet(ws: gspread.Worksheet) -> Optional[dict]:
    name = ws.title
    if name.strip().lower() in META_SHEET_NAMES:
        return None  # handled separately by parse_meta_worksheet
    rows = ws.get_all_values()
    if not rows:
        print(f"  [skip] '{name}': empty")
        return None
    header = [c.strip().lower() for c in rows[0][:3]]
    if header[:2] != EXPECTED_HEADER_PREFIX or (len(header) >= 3 and header[2] not in TARGET_HEADERS):
        print(
            f"  [skip] '{name}': header is {header}, expected "
            f"{EXPECTED_HEADER_PREFIX + ['target/couplet']}"
        )
        return None

    scope_rank, scope_name = _detect_scope_from_name(name)

    # Pass 1: harvest rows and detect default_genus
    raw_rows: list[dict] = []
    target_cells: list[str] = []
    for r in rows[1:]:
        if len(r) < 3:
            continue
        rid = (r[0] or "").strip()
        desc = (r[1] or "").strip()
        tgt = (r[2] or "").strip()
        if not rid:
            continue
        raw_rows.append({"id": rid, "description": desc, "target": tgt})
        target_cells.append(tgt)

    default_genus = _detect_default_genus(target_cells, name)

    # Pass 2: parse targets
    parsed_rows: list[dict] = []
    for r in raw_rows:
        try:
            num = int(r["id"])
        except ValueError:
            print(f"  [warn] '{name}': row id '{r['id']}' is not an integer, skipped")
            continue
        target = _parse_target(r["target"], default_genus)
        parsed_rows.append({
            "id": num,
            "description": r["description"],
            "target": target,
        })

    # Group consecutively by id, preserving order.
    grouped: dict[int, list[dict]] = {}
    for r in parsed_rows:
        grouped.setdefault(r["id"], []).append(r)

    couplets: list[dict] = []
    for num in sorted(grouped.keys()):
        leads = grouped[num]
        if len(leads) > 2:
            print(
                f"  [warn] '{name}': couplet {num} has {len(leads)} rows; using the first two only"
            )
        a = leads[0] if len(leads) >= 1 else None
        b = leads[1] if len(leads) >= 2 else None
        if b is None:
            print(f"  [warn] '{name}': couplet {num} has only 1 row (lead B missing)")
        couplets.append({"number": num, "a": a, "b": b})

    # Post-process: chain genus-level terminals into their species-split
    # subtrees when present. See `_chain_orphan_subtrees` doc.
    _chain_orphan_subtrees(couplets, name)

    return {
        "scope_rank": scope_rank,
        "scope_name": scope_name,
        "worksheet_name": name,
        "default_genus": default_genus,
        "couplets": couplets,
    }


def _chain_orphan_subtrees(couplets: list[dict], worksheet_name: str) -> None:
    """Auto-chain genus-level terminals into their species-split subtrees.

    Some small-family keys mix ranks: couplet 1 splits the family into
    genera (terminals 'Alnus 赤楊屬' / 'Carpinus 千金榆屬'), then later
    couplets split each genus into species. The author typically does NOT
    write an explicit forward number on the genus rows. We infer the
    chain post-parse:

      1. Find orphan couplets (no incoming forward arrow, excluding the
         root couplet 1) → these are sub-trees nobody points at yet.
      2. For each orphan, compute reachable taxa. If they all share the
         same first-token (genus), the orphan is that genus's sub-key.
      3. Walk every lead whose target is a single-token sciname (a genus
         terminal) and retarget it to forward into the matching orphan.

    Modifies `couplets` in place. Safe no-op when no genus terminal
    happens to match an orphan.
    """
    if not couplets:
        return

    # Build incoming-edge set: a couplet number is "pointed at" if any lead
    # in the key forwards to it.
    incoming: set[int] = set()
    for c in couplets:
        for lead in (c.get("a"), c.get("b")):
            if not lead:
                continue
            t = lead["target"]
            if t["type"] == "couplet" and t.get("next"):
                try:
                    incoming.add(int(t["next"]))
                except ValueError:
                    continue

    by_num: dict[int, dict] = {c["number"]: c for c in couplets}
    orphans = [c["number"] for c in couplets if c["number"] != 1 and c["number"] not in incoming]
    if not orphans:
        return

    def reachable_scinames(num: int, visited: Optional[set[int]] = None) -> list[str]:
        if visited is None:
            visited = set()
        if num in visited:
            return []
        visited.add(num)
        c = by_num.get(num)
        if not c:
            return []
        out: list[str] = []
        for lead in (c.get("a"), c.get("b")):
            if not lead:
                continue
            t = lead["target"]
            if t["type"] == "taxon" and t.get("sciname"):
                out.append(t["sciname"])
            elif t["type"] == "couplet" and t.get("next"):
                try:
                    out.extend(reachable_scinames(int(t["next"]), visited))
                except ValueError:
                    continue
        return out

    # Map orphan couplet number → common genus (first token) if all its
    # reachable taxa share one. Mixed-genus orphans are left unchained.
    orphan_genus: dict[int, str] = {}
    for num in orphans:
        taxa = reachable_scinames(num)
        if not taxa:
            continue
        first_tokens = {sn.split()[0] for sn in taxa if sn}
        if len(first_tokens) == 1:
            orphan_genus[num] = next(iter(first_tokens))

    if not orphan_genus:
        return

    # Walk every lead targeting a SINGLE-token sciname (i.e. a genus, not
    # a species). Retarget to the matching orphan couplet.
    for c in couplets:
        for label in ("a", "b"):
            lead = c.get(label)
            if not lead:
                continue
            t = lead["target"]
            if t["type"] != "taxon":
                continue
            sn = (t.get("sciname") or "").strip()
            if not sn:
                continue
            tokens = sn.split()
            if len(tokens) != 1:
                continue  # has epithet → species-level, not a genus terminal
            match = next((num for num, gen in orphan_genus.items() if gen == sn), None)
            if match is None:
                continue
            # Preserve the original cname/sciname for traceability in
            # logs but rewrite the target as a forward to the sub-tree.
            print(
                f"  [chain] '{worksheet_name}': couplet {c['number']}.{label.upper()} "
                f"'{sn}' → couplet {match} (auto-detected genus subtree)"
            )
            lead["target"] = {
                "type": "couplet",
                "next": str(match),
                "sciname": None,
                "cname": None,
            }


def parse_meta_worksheet(ws: gspread.Worksheet) -> dict:
    """Spreadsheet-level metadata. Two supported layouts:

    Single-row (spreadsheet-wide):
      | scope_rank | scope_name      | scope_cname | source       | aliases |
      | family     | Selaginellaceae | 卷柏科       | 臺灣石松類…   |          |

    Multi-row (per-worksheet override, requires `worksheet` column):
      | worksheet      | aliases       |
      | Davalliaceae   | Davallia      |
      | Bambusoideae   | 竹亞科         |

    Spreadsheet-wide defaults are returned at top-level. Per-worksheet
    overrides are returned under `_per_worksheet` keyed by worksheet name.
    `aliases` is a comma-separated list at the sheet level; it is read as
    JSON list when written to the DB.
    """
    rows = ws.get_all_values()
    if len(rows) < 2:
        return {}
    header = [c.strip().lower() for c in rows[0]]
    has_ws_col = "worksheet" in header
    out: dict = {}
    per_ws: dict[str, dict] = {}
    for r in rows[1:]:
        entry: dict[str, str] = {}
        for i, h in enumerate(header):
            if i < len(r) and r[i].strip():
                entry[h] = r[i].strip()
        if not entry:
            continue
        ws_name = entry.pop("worksheet", "") if has_ws_col else ""
        if ws_name:
            per_ws[ws_name] = entry
        else:
            # First non-keyed row → spreadsheet-wide default. Later
            # non-keyed rows are ignored (matches single-row legacy).
            if not out:
                out = entry
    if per_ws:
        out["_per_worksheet"] = per_ws
    return out


def _aliases_for(meta: dict, worksheet_name: str) -> Optional[str]:
    """Return JSON array string of aliases for the given worksheet, or None.

    Per-worksheet override wins over spreadsheet-wide default. The cell
    value is comma-separated; we strip and skip blanks.
    """
    per_ws = meta.get("_per_worksheet", {}).get(worksheet_name, {})
    raw = per_ws.get("aliases") or meta.get("aliases") or ""
    if not raw:
        return None
    items = [a.strip() for a in raw.split(",") if a.strip()]
    return json.dumps(items, ensure_ascii=False) if items else None


def _feature_type_overrides_for(meta: dict, worksheet_name: str) -> dict[str, str]:
    """Return {feature_name: forced_type} for a worksheet.

    Reads `feature_types` cell as JSON object. Per-worksheet override (matched
    on `worksheet` column in meta) wins over spreadsheet-wide default. Silently
    drops malformed JSON.
    """
    per_ws = meta.get("_per_worksheet", {}).get(worksheet_name, {})
    raw = per_ws.get("feature_types") or meta.get("feature_types") or ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items()}
    except json.JSONDecodeError:
        pass
    return {}


def parse_spreadsheet(spreadsheet_id: str) -> tuple[dict, list[dict]]:
    client = _open_client()
    sh = client.open_by_key(spreadsheet_id)
    meta: dict = {}
    keys: list[dict] = []
    # First pass: read meta worksheet (overrides require it).
    for ws in sh.worksheets():
        if ws.title.strip().lower() in META_SHEET_NAMES:
            print(f"-- reading meta worksheet: '{ws.title}'")
            meta = parse_meta_worksheet(ws)
            break
    # Second pass: parse key worksheets, dispatch by `_m` suffix.
    for ws in sh.worksheets():
        title = ws.title
        if title.strip().lower() in META_SHEET_NAMES:
            continue
        if title.endswith(MATRIX_SUFFIX):
            print(f"-- reading matrix worksheet: '{title}'")
            overrides = _feature_type_overrides_for(meta, title)
            result = parse_matrix_worksheet(ws, overrides)
        else:
            print(f"-- reading worksheet: '{title}'")
            result = parse_worksheet(ws)
        if result:
            keys.append(result)
    return meta, keys


# ── taxon resolve ──

def _resolve_taxa(parsed_keys: list[dict], session: Session) -> dict[str, Optional[str]]:
    scinames: set[str] = set()
    for k in parsed_keys:
        if k.get("mode") == "multi_access":
            for taxon in k.get("taxa", []):
                if taxon.get("sciname"):
                    scinames.add(taxon["sciname"])
            continue
        for c in k.get("couplets", []):
            for lead in (c.get("a"), c.get("b")):
                if not lead:
                    continue
                t = lead["target"]
                if t["type"] == "taxon" and t["sciname"]:
                    scinames.add(t["sciname"])

    name_to_taxon: dict[str, Optional[str]] = {}
    for sn in scinames:
        row = session.exec(
            select(TaicolName.taxon_id)
            .where(TaicolName.simple_name == sn)
            .where(TaicolName.usage_status == "accepted")
        ).first()
        if row:
            name_to_taxon[sn] = row
            continue
        row = session.exec(
            select(TaicolName.taxon_id).where(TaicolName.simple_name == sn)
        ).first()
        name_to_taxon[sn] = row
    return name_to_taxon


# ── import ──

def import_spreadsheet(spreadsheet_id: str, dry_run: bool = False) -> None:
    meta, parsed_keys = parse_spreadsheet(spreadsheet_id)
    if meta:
        print(f"\nSpreadsheet meta: {meta}")
    print(f"Parsed {len(parsed_keys)} key(s) from spreadsheet {spreadsheet_id}\n")

    if not parsed_keys:
        print("No parseable worksheets found. Check sheet structure / sharing.")
        return

    with Session(engine) as session:
        name_to_taxon = _resolve_taxa(parsed_keys, session)

        for k in parsed_keys:
            if k.get("mode") == "multi_access":
                _print_and_import_matrix(k, meta, name_to_taxon, session, spreadsheet_id, dry_run)
                continue
            print(f"=== {k['worksheet_name']}  ({k['scope_rank']}={k['scope_name']}) ===")
            print(f"   default_genus: {k['default_genus']}")
            print(f"   couplets: {len(k['couplets'])}")

            unresolved: list[str] = []
            for c in k["couplets"]:
                for label, lead in (("A", c.get("a")), ("B", c.get("b"))):
                    if not lead:
                        print(f"   {c['number']:3d} {label}  (missing)")
                        continue
                    t = lead["target"]
                    if t["type"] == "taxon":
                        tid = name_to_taxon.get(t["sciname"])
                        if tid:
                            print(
                                f"   {c['number']:3d} {label}  → {t['sciname']}  "
                                f"\"{t['cname'] or '-'}\"  #{tid}"
                            )
                        else:
                            print(
                                f"   {c['number']:3d} {label}  → {t['sciname']}  "
                                f"\"{t['cname'] or '-'}\"  (UNRESOLVED)"
                            )
                            unresolved.append(t["sciname"])
                    elif t["type"] == "couplet":
                        print(f"   {c['number']:3d} {label}  → couplet {t['next']}")
                    else:
                        print(f"   {c['number']:3d} {label}  (unresolved lead)")
            if unresolved:
                print(f"   [warn] {len(unresolved)} unresolved sciname(s): {sorted(set(unresolved))}")

            if dry_run:
                print("   [dry-run] no DB writes.")
                continue

            source = f"Sheets:{spreadsheet_id}#{k['worksheet_name']}"
            if meta.get("source"):
                source = f"{meta['source']} ({source})"
            existing = session.exec(
                select(IdentificationKey).where(
                    IdentificationKey.scope_name == k["scope_name"],
                    IdentificationKey.source == source,
                )
            ).first()
            if existing:
                for old in session.exec(
                    select(KeyCouplet).where(KeyCouplet.key_id == existing.id)
                ).all():
                    session.delete(old)
                session.delete(existing)
                session.commit()

            # scope_cname: prefer meta override if the worksheet matches that
            # scope, else look it up from TaiCOL by name.
            scope_cname: Optional[str] = None
            if meta.get("scope_cname") and meta.get("scope_name") == k["scope_name"]:
                scope_cname = meta["scope_cname"]
            else:
                if k["scope_rank"] == "family":
                    scope_cname = session.exec(
                        select(TaicolName.family_c).where(TaicolName.family == k["scope_name"])
                    ).first()
                elif k["scope_rank"] == "genus":
                    scope_cname = session.exec(
                        select(TaicolName.genus_c).where(TaicolName.genus == k["scope_name"])
                    ).first()

            key = IdentificationKey(
                scope_taxon_id=None,
                scope_rank=k["scope_rank"],
                scope_name=k["scope_name"],
                scope_cname=scope_cname,
                title=k["scope_name"],
                source=source,
                mode="dichotomous",
                aliases=_aliases_for(meta, k["worksheet_name"]),
                updated_at=int(time.time() * 1000),
            )
            session.add(key)
            session.commit()
            session.refresh(key)

            for c in k["couplets"]:
                la_text, la_type, la_id = _lead_fields(c.get("a"), name_to_taxon)
                lb_text, lb_type, lb_id = _lead_fields(c.get("b"), name_to_taxon)
                session.add(KeyCouplet(
                    key_id=key.id,
                    number=c["number"],
                    lead_a_text=la_text,
                    lead_a_target_type=la_type,
                    lead_a_target_id=la_id,
                    lead_b_text=lb_text,
                    lead_b_target_type=lb_type,
                    lead_b_target_id=lb_id,
                ))
            session.commit()
            print(f"   inserted key id={key.id} with {len(k['couplets'])} couplets\n")


def _lead_fields(lead: Optional[dict], name_to_taxon: dict[str, Optional[str]]):
    if not lead:
        return ("(missing)", "unresolved", None)
    text = lead["description"]
    t = lead["target"]
    if t["type"] == "couplet":
        return (text, "couplet", t["next"])
    if t["type"] == "taxon":
        tid = name_to_taxon.get(t["sciname"])
        target_id = tid or t["sciname"]
        return (text, "taxon", str(target_id))
    return (text, "unresolved", None)


def _print_and_import_matrix(
    k: dict,
    meta: dict,
    name_to_taxon: dict[str, Optional[str]],
    session: Session,
    spreadsheet_id: str,
    dry_run: bool,
) -> None:
    """Render dry-run output + write a multi_access key + features +
    taxon_features rows. Re-import upserts by (scope_name, source) — old
    rows for this scope+source are deleted first so the import is idempotent.
    """
    print(f"=== {k['worksheet_name']}  ({k['scope_rank']}={k['scope_name']}) [matrix] ===")
    print(f"   features: {len(k['features'])}  taxa: {len(k['taxa'])}")
    for f in k["features"]:
        vals: list[str] = json.loads(f["values_json"]) if f["values_json"] else []
        if not vals:
            # numeric/text don't persist values_json; recompute distinct from
            # taxa rows so dry-run output is still informative.
            seen: set[str] = set()
            for taxon in k["taxa"]:
                for v in taxon["feature_values"].get(f["name"], []):
                    seen.add(v)
            vals = sorted(seen)
        vals_repr = ", ".join(vals[:6]) + (f" ... (+{len(vals) - 6})" if len(vals) > 6 else "")
        print(f"     - {f['name']:<20} {f['type']:<12} {vals_repr}")

    unresolved: list[str] = []
    for taxon in k["taxa"]:
        tid = name_to_taxon.get(taxon["sciname"])
        status = f"#{tid}" if tid else "(UNRESOLVED)"
        if not tid:
            unresolved.append(taxon["sciname"])
        n_cells = sum(1 for vs in taxon["feature_values"].values() if vs)
        print(f"     {taxon['sciname']:<35} \"{taxon['cname'] or '-'}\"  {status}  ({n_cells} cells)")

    if unresolved:
        print(f"   [warn] {len(unresolved)} unresolved sciname(s): {sorted(set(unresolved))}")

    if dry_run:
        print("   [dry-run] no DB writes.")
        return

    source = f"Sheets:{spreadsheet_id}#{k['worksheet_name']}"
    if meta.get("source"):
        source = f"{meta['source']} ({source})"

    # Upsert: delete existing key + its features + taxon_features for this scope+source.
    existing = session.exec(
        select(IdentificationKey).where(
            IdentificationKey.scope_name == k["scope_name"],
            IdentificationKey.source == source,
        )
    ).first()
    if existing:
        for old in session.exec(
            select(KeyTaxonFeature).where(KeyTaxonFeature.key_id == existing.id)
        ).all():
            session.delete(old)
        for old in session.exec(
            select(KeyFeature).where(KeyFeature.key_id == existing.id)
        ).all():
            session.delete(old)
        session.delete(existing)
        session.commit()

    scope_cname: Optional[str] = None
    if meta.get("scope_cname") and meta.get("scope_name") == k["scope_name"]:
        scope_cname = meta["scope_cname"]
    else:
        if k["scope_rank"] == "family":
            scope_cname = session.exec(
                select(TaicolName.family_c).where(TaicolName.family == k["scope_name"])
            ).first()
        elif k["scope_rank"] == "genus":
            scope_cname = session.exec(
                select(TaicolName.genus_c).where(TaicolName.genus == k["scope_name"])
            ).first()

    key = IdentificationKey(
        scope_taxon_id=None,
        scope_rank=k["scope_rank"],
        scope_name=k["scope_name"],
        scope_cname=scope_cname,
        title=k["scope_name"],
        source=source,
        mode="multi_access",
        aliases=_aliases_for(meta, k["worksheet_name"]),
        updated_at=int(time.time() * 1000),
    )
    session.add(key)
    session.commit()
    session.refresh(key)

    # Insert features; keep a mapping fname → feature_id for the next loop.
    fname_to_id: dict[str, int] = {}
    for f in k["features"]:
        kf = KeyFeature(
            key_id=key.id,
            name=f["name"],
            type=f["type"],
            values_json=f["values_json"],
            category=f["category"],
            sort_order=f["sort_order"],
        )
        session.add(kf)
        session.commit()
        session.refresh(kf)
        fname_to_id[f["name"]] = kf.id

    n_feature_rows = 0
    for taxon in k["taxa"]:
        tid = name_to_taxon.get(taxon["sciname"])
        # Use accepted taxon_id when resolved; fall back to literal sciname so
        # the row still exists for inspection (mirrors dichotomous fallback).
        target_id = tid or taxon["sciname"]
        for fname, values in taxon["feature_values"].items():
            fid = fname_to_id.get(fname)
            if fid is None or not values:
                continue
            for v in values:
                session.add(KeyTaxonFeature(
                    key_id=key.id,
                    taxon_id=str(target_id),
                    feature_id=fid,
                    value=v,
                ))
                n_feature_rows += 1
    session.commit()
    print(
        f"   inserted key id={key.id} mode=multi_access with "
        f"{len(k['features'])} features, {len(k['taxa'])} taxa, "
        f"{n_feature_rows} taxon_feature rows\n"
    )


def main():
    ap = argparse.ArgumentParser(description="Import dichotomous key from Google Sheets.")
    ap.add_argument("spreadsheet_id", help="Google Spreadsheet ID (the long string from the URL)")
    ap.add_argument("--dry-run", action="store_true", help="Print parse output without writing to DB")
    args = ap.parse_args()
    import_spreadsheet(args.spreadsheet_id, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
