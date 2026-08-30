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
 * key literal has no matching entry", which is visible lexically. Dynamic keys
 * (template literals, variables) are skipped — see DYNAMIC below.
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
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(KEY_RE)) {
        const key = m[2];
        if (!referenced.has(key)) referenced.set(key, `${relative('.', file)}:${i + 1}`);
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

console.log(`✓ i18n: ${referenced.size} referenced keys all present in ${locales.length} locales`);
