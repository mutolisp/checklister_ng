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

/** Flatten {a:{b:'x'}} → Map{'a.b' => 'x'} — the values, for placeholder checks. */
function flattenValues(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenValues(v, key, out);
    else if (typeof v === 'string') out.set(key, v);
  }
  return out;
}

/** `{{name}}` / `{{- name}}` / `{{obj.field}}` → the root param name i18next
 *  needs supplied. */
const PLACEHOLDER_RE = /\{\{\s*-?\s*([\w.]+)\s*\}\}/g;
function placeholdersOf(value) {
  const out = new Set();
  for (const m of value.matchAll(PLACEHOLDER_RE)) out.add(m[1].split('.')[0]);
  return out;
}

const KEY_SHAPE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

/** Walk from an opening delimiter to its match, skipping over string and
 *  template literals so a brace or paren inside a quoted string cannot end the
 *  scan early. Returns the index of the closing delimiter, or -1. */
function matchDelim(src, open) {
  const PAIRS = { '(': ')', '{': '}', '[': ']' };
  const stack = [PAIRS[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === quote) break;
        else if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          const end = matchDelim(src, i + 1);
          if (end < 0) return -1;
          i = end;
        }
      }
      continue;
    }
    if (PAIRS[c]) stack.push(PAIRS[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Split an argument list on top-level commas (same literal-skipping rules). */
function splitArgs(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote) break;
      }
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((a) => a.trim());
}

/** Top-level property names of an object literal: `{a: 1, b, c: {d: 2}}` →
 *  {a, b, c}. Returns null when the object spreads (`...opts`), because the
 *  supplied params are then not statically knowable. */
function objectKeys(text) {
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  const inner = text.slice(1, -1);
  const out = new Set();
  for (const part of splitArgs(inner)) {
    if (!part) continue;
    if (part.startsWith('...')) return null;
    const m = /^(?:\.\.\.)?['"]?([A-Za-z_$][\w$]*)['"]?\s*(?::|$)/.exec(part);
    if (!m) return null;
    out.add(m[1]);
  }
  return out;
}

/** Every t(...) / tr(...) / i18n.t(...) call, with its arguments split. Unlike
 *  KEY_RE this brace-matches the call, so `t(cond ? 'a.b' : 'c.d', {…})` is
 *  visible — that form matches NEITHER of the line regexes above, so its keys
 *  were never checked at all until this pass existed. */
const CALL_RE = /\b(?:i18n\.)?(tr?)\(/g;
function* callSites(src) {
  for (const m of src.matchAll(CALL_RE)) {
    const open = m.index + m[0].length - 1;
    const close = matchDelim(src, open);
    if (close < 0) continue;
    const args = splitArgs(src.slice(open + 1, close));
    const keys = [...args[0].matchAll(/['"]([^'"]+)['"]/g)]
      .map((k) => k[1])
      .filter((k) => KEY_SHAPE.test(k));
    if (keys.length === 0) continue;
    yield { index: m.index, keys, params: args.length > 1 ? objectKeys(args[1]) : new Set() };
  }
}

const locales = LOCALES.map((f) => {
  const json = JSON.parse(readFileSync(f, 'utf8'));
  return { file: f, keys: flatten(json), values: flattenValues(json) };
});

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

// Placeholders a string needs vs. what the call site supplies. i18next leaves
// an unsatisfied `{{x}}` in the output verbatim, so this ships as literal
// braces on screen: `useMineSameTaxonMisapplied` was authored with {{typed}}
// while its caller passed { name, accepted }, and the action sheet rendered
// 用「{{typed}}」. Nothing above could see it — both locales had the key, and
// its value was a perfectly valid string.
//
// Only unsatisfied placeholders fail. An extra unused param is not reported:
// it is harmless, and several call sites legitimately pass one object to two
// sibling keys.
const unchecked = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const lineAt = (i) => src.slice(0, i).split('\n').length;
    for (const { index, keys, params } of callSites(src)) {
      const where = `${relative('.', file)}:${lineAt(index)}`;
      for (const key of keys) {
        for (const { file: lf, keys: lk, values } of locales) {
          if (!lk.has(key)) {
            problems.push(`${lf}: missing "${key}"  (used at ${where})`);
            continue;
          }
          const value = values.get(key);
          if (!value) continue;
          const needed = placeholdersOf(value);
          if (needed.size === 0) continue;
          if (params === null) {
            unchecked.push(`${where}  t('${key}') — params spread, not checked`);
            continue;
          }
          for (const n of needed) {
            if (!params.has(n)) {
              problems.push(
                `${lf}: "${key}" needs {{${n}}} but ${where} passes ` +
                  `{${[...params].join(', ') || ''}}`,
              );
            }
          }
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error('\n✗ i18n key problems:\n');
  for (const p of [...new Set(problems)].sort()) console.error(`  ${p}`);
  console.error(`\n${new Set(problems).size} problem(s).\n`);
  process.exit(1);
}

if (unchecked.length > 0) {
  console.log(`\nℹ  ${unchecked.length} call(s) with spread params — placeholders NOT checked:`);
  for (const u of unchecked) console.log(`   ${u}`);
  console.log('');
}

if (dynamic.length > 0) {
  console.log(`\nℹ  ${dynamic.length} runtime-built key(s) — NOT checked, verify by hand:`);
  for (const d of dynamic) console.log(`   ${d.where}  t(${d.expr})`);
  console.log('');
}

console.log(`✓ i18n: ${referenced.size} referenced keys all present in ${locales.length} locales`);
