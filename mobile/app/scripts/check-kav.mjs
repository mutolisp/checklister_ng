#!/usr/bin/env node
/**
 * Guard the KeyboardAvoidingView caller contract.
 *
 * `~/components/KeyboardAvoidingView` puts the caller's className/style on the
 * OUTER measured View and hard-codes `flex: 1` on the inner KAV. So a call site
 * that passes no sizing className leaves that inner KAV inside an auto-sized
 * parent, where `flex: 1` resolves to ZERO height — the sheet renders 0 px
 * tall.
 *
 * Why this is a script and not a comment: the failure is silent and looks like
 * a hang, not a layout bug. AreaSpeciesModal shipped this way and presented as
 * "the map freezes after you finish selecting": a dimmed screen that swallowed
 * every touch, with no visible content and no reachable cancel button. Nothing
 * threw, and the only device logs were Apple Maps noise.
 *
 * Deliberately a text scan, like check-bottom-dock: the failure mode is always
 * "the call site is missing a size", which is visible lexically.
 *
 * Usage: node scripts/check-kav.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'app'];
/** The wrapper itself is where `flex: 1` is applied; it has no caller contract. */
const SELF = 'src/components/KeyboardAvoidingView.tsx';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative('.', file);
    if (rel === SELF) continue;
    const src = readFileSync(file, 'utf8');
    // Each opening tag up to its '>' — attributes may span several lines.
    for (const m of src.matchAll(/<KeyboardAvoidingView\b[^>]*>/g)) {
      const tag = m[0];
      const line = src.slice(0, m.index).split('\n').length;
      const sized = /className=(["'`])[^"'`]*\bflex-1\b/.test(tag) || /\bstyle=\{/.test(tag);
      if (!sized) {
        problems.push(
          `${rel}:${line}  <KeyboardAvoidingView> has no flex-1 className — its inner KAV will render 0 px tall`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error('\n✗ KeyboardAvoidingView caller problems:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s). Give the call site a sizing className, e.g.`);
  console.error('  <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">\n');
  process.exit(1);
}

console.log('✓ every KeyboardAvoidingView call site is sized');
