"""Build fuzzy candidate index inside twnamelist.db for mobile bundling.

Adds a cname_fuzzy_index table (TaiCOL / Taiwan, primary):
    cname TEXT PRIMARY KEY,
    name_ids TEXT  -- comma-separated name_id list (one cname can map to multiple)

Only includes accepted + in_taiwan rows. The mobile app does
Levenshtein distance scan over this small table at runtime.

Also builds cname_fuzzy_index_jp (YList / Japan 和名) when jp_names exists,
so the regional-checklist feature can fuzzy-match katakana. Same schema; no
pinyin column (pinyin is Mandarin-only and N/A for Japanese).

Run from project root:
    python -m backend.scripts.build_mobile_fuzzy_index path/to/twnamelist.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path


def build(db_path: Path) -> None:
    if not db_path.exists():
        raise FileNotFoundError(db_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS cname_fuzzy_index;")
    cur.execute(
        """
        CREATE TABLE cname_fuzzy_index (
            cname TEXT PRIMARY KEY,
            name_ids TEXT NOT NULL
        );
        """
    )

    cur.execute(
        """
        SELECT common_name_c, name_id
        FROM taicol_names
        WHERE common_name_c IS NOT NULL
          AND common_name_c != ''
          AND is_in_taiwan LIKE '%true%'
          AND usage_status = 'accepted'
        """
    )

    bucket: dict[str, list[int]] = defaultdict(list)
    for cname, name_id in cur.fetchall():
        bucket[cname].append(int(name_id))

    rows = [(cname, ",".join(str(nid) for nid in nids)) for cname, nids in bucket.items()]
    cur.executemany("INSERT INTO cname_fuzzy_index (cname, name_ids) VALUES (?, ?);", rows)

    # Index used by KeyListView's child_count subquery (genus-scope keys).
    # Without it, each of ~80 genus keys full-scans taicol_names (~242k rows),
    # blowing up keys-tab cold start to multi-second territory on mobile.
    cur.execute("CREATE INDEX IF NOT EXISTS idx_taicol_genus ON taicol_names(genus);")

    jp_count = _build_jp_index(cur)

    conn.commit()
    cur.execute("VACUUM;")
    conn.close()

    print(f"Built cname_fuzzy_index with {len(rows)} unique cnames")
    if jp_count is not None:
        print(f"Built cname_fuzzy_index_jp with {jp_count} unique 和名")


def _build_jp_index(cur: sqlite3.Cursor) -> int | None:
    """Build cname_fuzzy_index_jp from jp_names (和名). Returns None if absent."""
    exists = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='jp_names';"
    ).fetchone()
    if not exists:
        return None

    cur.execute("DROP TABLE IF EXISTS cname_fuzzy_index_jp;")
    cur.execute(
        """
        CREATE TABLE cname_fuzzy_index_jp (
            cname TEXT PRIMARY KEY,
            name_ids TEXT NOT NULL
        );
        """
    )
    # wamei 的同義和名放在 alternative_name_c（逗號分隔）而非獨立列，一併入索引，
    # 否則使用者打異名時模糊比對完全命不中（wamei 30,340 個和名裡約三分之一是異名）。
    cur.execute(
        """
        SELECT common_name_c, alternative_name_c, name_id
        FROM jp_names
        WHERE common_name_c IS NOT NULL AND common_name_c != ''
        """
    )
    bucket: dict[str, list[int]] = defaultdict(list)
    for cname, alt, name_id in cur.fetchall():
        nid = int(name_id)
        bucket[cname].append(nid)
        for alias in (alt or "").split(","):
            alias = alias.strip()
            # 別名可能與其他分類群的接受和名同字（1,381 組異物同名），
            # 同一個 bucket 收多個 name_id 是正常的，去重只需避免自我重複。
            if alias and nid not in bucket[alias]:
                bucket[alias].append(nid)
    rows = [(c, ",".join(str(n) for n in nids)) for c, nids in bucket.items()]
    cur.executemany(
        "INSERT INTO cname_fuzzy_index_jp (cname, name_ids) VALUES (?, ?);", rows
    )
    return len(rows)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build fuzzy index for mobile")
    parser.add_argument("db_path", type=Path, help="Path to twnamelist.db")
    args = parser.parse_args(argv)
    build(args.db_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
