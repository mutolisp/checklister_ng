"""Build fuzzy candidate index inside twnamelist.db for mobile bundling.

Adds a cname_fuzzy_index table:
    cname TEXT PRIMARY KEY,
    name_ids TEXT  -- comma-separated name_id list (one cname can map to multiple)

Only includes accepted + in_taiwan rows. The mobile app does
Levenshtein distance scan over this small table at runtime.

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

    conn.commit()
    cur.execute("VACUUM;")
    conn.close()

    print(f"Built cname_fuzzy_index with {len(rows)} unique cnames")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Build fuzzy index for mobile")
    parser.add_argument("db_path", type=Path, help="Path to twnamelist.db")
    args = parser.parse_args(argv)
    build(args.db_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
