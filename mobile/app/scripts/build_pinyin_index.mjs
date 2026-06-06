// Fill the `pinyin` column of cname_fuzzy_index with toneless pinyin so the
// mobile fuzzy fallback can match homophone garbles from voice dictation
// (e.g. 台灣時力 / 臺灣實例 → 臺灣石櫟, all "tai wan shi li").
//
// Runs AFTER `backend/scripts/build_mobile_fuzzy_index.py` (which builds the
// table + name_ids). Uses pinyin-pro — the SAME lib + options the runtime
// (src/db/fuzzy.ts) uses to convert queries — so build and runtime readings
// stay consistent. Uses Node's built-in node:sqlite (Node >= 22.5, stable in
// Node 24+) so there is no native build dependency.
//
// Usage (from repo root, so MOBILE_DB resolves; pinyin-pro resolved from
// mobile/app/node_modules relative to this script):
//   node mobile/app/scripts/build_pinyin_index.mjs mobile/app/assets/db/twnamelist.db

import { DatabaseSync } from 'node:sqlite';
import { pinyin } from 'pinyin-pro';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: node build_pinyin_index.mjs <twnamelist.db>');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const cols = db.prepare(`PRAGMA table_info(cname_fuzzy_index)`).all();
if (!cols.some((c) => c.name === 'pinyin')) {
  db.exec(`ALTER TABLE cname_fuzzy_index ADD COLUMN pinyin TEXT`);
}

const rows = db.prepare(`SELECT cname FROM cname_fuzzy_index`).all();
const update = db.prepare(`UPDATE cname_fuzzy_index SET pinyin = ? WHERE cname = ?`);

db.exec('BEGIN');
let n = 0;
for (const { cname } of rows) {
  const py = pinyin(cname, { toneType: 'none', type: 'array' }).join(' ');
  update.run(py, cname);
  n++;
}
db.exec('COMMIT');

console.log(`Filled pinyin for ${n} cnames in cname_fuzzy_index`);
db.close();
