/**
 * Naming the copy of a record.
 *
 * Field numbering runs in series — JP-EH-12 is followed by JP-EH-13 — so the
 * duplicate dialog pre-fills the next name rather than making the user retype
 * one. Nothing in the schema enforces uniqueness (`plot_surveys.plotid`,
 * `sessions.name` and `collection_trips.name` are all plain TEXT), so the
 * candidate skips names already in use and the dialog warns if the user types
 * one back in.
 */
import { isoDate } from './datetime';

/** Trailing digit group, with whatever follows it (`JP-EH-12`, `A-9 (南)`). */
const TAIL_NUMBER = /^(.*?)(\d+)(\D*)$/;

/**
 * A name ending in a date or a date+time, which must never be "incremented".
 *
 * Two ways in: the default 名錄 / 採集 name is `YYYY-MM-DD HH:MM` (so the tail
 * digits are the minutes — `14:59` would become `14:60`), and this function's
 * own dateless output ends in a date, so duplicating a copy would produce
 * `2026-08-32`. Both get the `(2)` treatment instead.
 */
const TAIL_DATE = /\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

/** `JP-EH-12` → `JP-EH-13`; zero padding is preserved (`PLOT_009` → `PLOT_010`,
 *  and a number that outgrows the padding just gets longer). */
function bump(name: string): string | null {
  const m = name.match(TAIL_NUMBER);
  if (!m) return null;
  const [, head, digits, tail] = m;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${head}${next}${tail}`;
}

/**
 * The name to pre-fill for a copy of `base`.
 *
 * Ends in a number → +1. No number → today's date appended, since "福山調查"
 * copied on another day is most usefully "福山調查 2026-08-31". Either way the
 * result keeps advancing until it is free.
 */
export function nextRecordName(base: string, taken: Set<string>, today: Date = new Date()): string {
  const trimmed = base.trim();
  // 999 is far past any real series; the cap just keeps this total.
  const LIMIT = 999;

  const bumped = TAIL_DATE.test(trimmed) ? null : bump(trimmed);
  if (bumped !== null) {
    let candidate = bumped;
    for (let i = 0; i < LIMIT && taken.has(candidate); i++) {
      candidate = bump(candidate) as string; // still ends in the same digits
    }
    return candidate;
  }

  // No number to advance — or a date, which must not be advanced.
  const alreadyDated = TAIL_DATE.test(trimmed);
  const dated = alreadyDated ? trimmed : `${trimmed} ${isoDate(today.getTime())}`;
  // Appending today's date already makes the name differ from its source; a
  // name that IS a date does not, so that one starts at "(2)".
  let n = alreadyDated ? 2 : 1;
  let candidate = n === 1 ? dated : `${dated} (${n})`;
  while (n < LIMIT && taken.has(candidate)) {
    n += 1;
    candidate = `${dated} (${n})`;
  }
  return candidate;
}
