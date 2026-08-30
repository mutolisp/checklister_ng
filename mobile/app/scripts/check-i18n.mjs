#!/usr/bin/env node
/**
 * Guard i18n key coverage.
 *
 * Every `t('some.key')` / `tr('some.key')` referenced in src/ or app/ must
 * exist in BOTH locale files, and the two locales must stay structurally
 * identical.
 *
 * Why this is a script and not documentation: four keys (favorites.add /
 * remove / removed / addFail) shipped missing from both locales, so the
 * long-press action sheet rendered the raw string `favorites.add` as a button
 * label. Nothing failed loudly — `fallbackLng: 'zh-TW'` cannot help when the
 * key is absent there too, so i18next just emits the key itself.
 *
 * Deliberately a text scan, not an AST walk: the failure mode is always "the
 * key literal has no matching entry", which is visible lexically.
 *
 * Keys built at runtime — t(MAP[kind]), t(`a.${x}`) — cannot be resolved this
 * way, so they are a genuine blind spot: a missing one passes this check and
 * shows up as a raw key on screen. They are therefore REPORTED (not failed) so
 * a human knows exactly where to verify by hand. That hole is not theoretical:
 * RecordPickerSheet's t(KIND_LABEL[item.kind]) was written after this script
 * existed and its three keys were invisible to it.
 *
 * Usage: node scripts/check-i18n.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'app'];
const LOCALES = ['src/i18n/locales/zh-TW.json', 'src/i18n/locales/en.json'];

/** Matches t('a.b'), tr("a.b"), i18n.t('a.b') — single/double quotes only, so
 *  a backtick template literal is skipped rather than half-parsed. */
const KEY_RE = /\b(?:i18n\.)?tr?\(\s*(['"])([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\1/g;

/** t(...) whose first argument is NOT a plain quoted literal: an identifier, a
 *  member access, or a template literal. These cannot be checked statically.
 *
 *  The trailing (?=[,)]) is load-bearing: it requires the expression to END the
 *  argument. A bare "not followed by (" lookahead does NOT reject a call like
 *  t(foo(x)) — the regex just backtracks one character and matches "fo", which
 *  reports a name that does not exist in the source. */
const DYNAMIC_RE =
  /\b(?:i18n\.)?tr?\(\s*(?!['"])(`[^`]*`|[A-Za-z_$][\w$]*(?:\([^()]*\))?(?:\.[\w$]+|\[[^\]]*\])*)\s*(?=[,)])/g;

/** A t(...) argument containing a quoted literal is not a runtime-built key:
 *  it is either a ternary over two literal keys, or an inner t('literal') whose
 *  key KEY_RE already checked. Filtering on that is what lets the pattern above
 *  allow one call segment — needed for t(basemapMeta(x).labelKey) — without
 *  re-reporting every t(tr('some.key')) as dynamic. */
const hasLiteral = (expr) => /['"]/.test(expr);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Flatten {a:{b:'x'}} → Set{'a.b'} */
function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

const locales = LOCALES.map((f) => ({
  file: f,
  keys: flatten(JSON.parse(readFileSync(f, 'utf8'))),
}));

// Structural drift between locales.
const problems = [];
for (const a of locales) {
  for (const b of locales) {
    if (a === b) continue;
    for (const k of a.keys) {
      if (!b.keys.has(k)) problems.push(`${b.file}: missing "${k}" (present in ${a.file})`);
    }
  }
}

// Keys referenced in code but absent from a locale.
const referenced = new Map(); // key -> first "file:line"
const dynamic = []; // { where, expr } for keys built at runtime
const dynSeen = new Set(); // dedupe repeats on one line (ternaries call t twice)
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(KEY_RE)) {
        const key = m[2];
        if (!referenced.has(key)) referenced.set(key, `${relative('.', file)}:${i + 1}`);
      }
      for (const m of lines[i].matchAll(DYNAMIC_RE)) {
        // Best-effort, and knowingly imperfect: `t` is also the name of the
        // toast function in a few files, so some hits are not translations at
        // all. That is acceptable for an advisory list — the cost of a stray
        // line is a glance, the cost of a missed dynamic key is a raw string
        // shipped on screen.
        if (hasLiteral(m[1])) continue;
        const key = `${relative('.', file)}:${i + 1}|${m[1]}`;
        if (!dynSeen.has(key)) {
          dynSeen.add(key);
          dynamic.push({ where: `${relative('.', file)}:${i + 1}`, expr: m[1] });
        }
      }
    }
  }
}

for (const [key, where] of referenced) {
  for (const { file, keys } of locales) {
    if (!keys.has(key)) problems.push(`${file}: missing "${key}"  (used at ${where})`);
  }
}

if (problems.length > 0) {
  console.error('\n✗ i18n key problems:\n');
  for (const p of [...new Set(problems)].sort()) console.error(`  ${p}`);
  console.error(`\n${new Set(problems).size} problem(s).\n`);
  process.exit(1);
}

if (dynamic.length > 0) {
  console.log(`\nℹ  ${dynamic.length} runtime-built key(s) — NOT checked, verify by hand:`);
  for (const d of dynamic) console.log(`   ${d.where}  t(${d.expr})`);
  console.log('');
}

console.log(`✓ i18n: ${referenced.size} referenced keys all present in ${locales.length} locales`);
