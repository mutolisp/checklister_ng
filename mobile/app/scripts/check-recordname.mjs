/**
 * Locks down the duplicate-name rule (src/lib/recordName.ts).
 *
 * The increment is a user-visible promise — "JP-EH-12 的複本叫 JP-EH-13" — and
 * its edge cases (zero padding, no digits at all, a candidate that is already
 * taken) are exactly the kind that regress silently. Pure function, so it runs
 * here rather than needing a device.
 *
 * Run: npm run check:names
 */
import { nextRecordName } from '../src/lib/recordName.ts';

const TODAY = new Date('2026-08-31T09:00:00');
let failures = 0;
const eq = (label, got, want) => {
  if (got !== want) {
    failures += 1;
    console.error(`  ✗ ${label}: got "${got}", expected "${want}"`);
  }
};

const none = new Set();

console.log('check:names');

// Trailing number → +1
eq('JP-EH-12', nextRecordName('JP-EH-12', none, TODAY), 'JP-EH-13');
eq('A-9 → A-10', nextRecordName('A-9', none, TODAY), 'A-10');
// Zero padding preserved, and only widened when the number outgrows it
eq('PLOT_009', nextRecordName('PLOT_009', none, TODAY), 'PLOT_010');
eq('PLOT_099', nextRecordName('PLOT_099', none, TODAY), 'PLOT_100');
// Digits followed by a suffix
eq('A-12 (南)', nextRecordName('A-12 (南)', none, TODAY), 'A-13 (南)');
// No digits → date
eq('no digits', nextRecordName('福山調查', none, TODAY), '福山調查 2026-08-31');
// Whitespace is trimmed before anything else
eq('trims', nextRecordName('  JP-EH-12  ', none, TODAY), 'JP-EH-13');

// A trailing date/time is never "incremented" — the default 名錄 name is
// `YYYY-MM-DD HH:MM`, whose tail digits are the minutes.
eq('default session name', nextRecordName('2026-08-30 14:59', none, TODAY), '2026-08-30 14:59 (2)');
eq('date only', nextRecordName('2026-01-31', none, TODAY), '2026-01-31 (2)');
// Duplicating a copy: the dated form must not roll into an invalid date.
eq(
  'copy of a dated copy',
  nextRecordName('福山調查 2026-08-31', none, TODAY),
  '福山調查 2026-08-31 (2)',
);
eq(
  'copy of a dated copy, taken',
  nextRecordName('福山調查 2026-08-31', new Set(['福山調查 2026-08-31 (2)']), TODAY),
  '福山調查 2026-08-31 (3)',
);

// Taken names are skipped
eq(
  'skips taken',
  nextRecordName('JP-EH-12', new Set(['JP-EH-13', 'JP-EH-14']), TODAY),
  'JP-EH-15',
);
// A dateless name whose dated form is taken falls back to (2), (3)
eq(
  'dateless collision',
  nextRecordName('福山調查', new Set(['福山調查 2026-08-31']), TODAY),
  '福山調查 2026-08-31 (2)',
);
eq(
  'dateless collision twice',
  nextRecordName('福山調查', new Set(['福山調查 2026-08-31', '福山調查 2026-08-31 (2)']), TODAY),
  '福山調查 2026-08-31 (3)',
);
// The source name itself being taken is the normal case — it always is.
eq('source taken', nextRecordName('JP-EH-12', new Set(['JP-EH-12']), TODAY), 'JP-EH-13');

if (failures > 0) {
  console.error(`\n✗ record naming: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ record naming: 遞增 / 補零 / 無數字加日期 / 跳過重名 都正確');
