#!/usr/bin/env node
/**
 * Guard the bottom-sticky search dock invariant.
 *
 * `KeyboardStickyView`'s `offset.opened` must equal the chrome sitting BELOW
 * the dock, because that chrome is what pushes the dock up out of the keyboard's
 * way. Two valid pairings exist in this app:
 *
 *   offset={{ opened: insets.bottom }}  ⟺  screen root is <SafeAreaView edges={['bottom']}>
 *   offset={{ opened: tabBarHeight }}   ⟺  screen is inside the bottom tab navigator
 *
 * Copy one half without the other and the box is shoved *behind* the keyboard.
 * That has shipped three times now (KeyListView 2026-05-14, favorites 2026-06-07,
 * collection 2026-08-29), each time by copying a working screen's offset onto a
 * screen with different chrome — so the pairing is checked rather than just
 * documented in CLAUDE.md / memory.
 *
 * Deliberately a text check, not an AST one: the failure mode is always
 * "the two halves disagree", which is visible lexically per file.
 *
 * Usage: node scripts/check-bottom-dock.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'app'];
const SELF = 'src/components/KeyboardAvoidingView.tsx'; // re-export site, not a caller

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative('.', file);
    if (rel === SELF) continue;
    const src = readFileSync(file, 'utf8');
    if (!/<KeyboardStickyView/.test(src)) continue;

    const usesInsets = /offset=\{\{\s*opened:\s*insets\.bottom\s*\}\}/.test(src);
    const usesTabBar = /offset=\{\{\s*opened:\s*tabBarHeight\s*\}\}/.test(src);

    if (usesInsets && !/edges=\{\['bottom'\]\}/.test(src)) {
      problems.push(
        `${rel}\n    offset={{ opened: insets.bottom }} but no <SafeAreaView edges={['bottom']}>.\n` +
          `    Nothing to compensate for → the dock is pushed ~insets.bottom BEHIND the keyboard.\n` +
          `    Fix: make the screen root <SafeAreaView edges={['bottom']}> (see app/session/[id].tsx).`,
      );
    }
    if (usesTabBar && !/useBottomTabBarHeight/.test(src)) {
      problems.push(
        `${rel}\n    offset={{ opened: tabBarHeight }} without useBottomTabBarHeight().`,
      );
    }
    if (!usesInsets && !usesTabBar) {
      problems.push(
        `${rel}\n    <KeyboardStickyView> with an unrecognised offset. The two supported\n` +
          `    pairings are insets.bottom (+ SafeAreaView edges) and tabBarHeight (+ tab screen).\n` +
          `    If this dock genuinely has no chrome below it, use offset={{ opened: 0 }} and say why.`,
      );
    }
  }
}

if (problems.length) {
  console.error('✗ bottom-dock invariant violated:\n');
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
console.log('✓ bottom-dock invariant holds for every KeyboardStickyView caller');
