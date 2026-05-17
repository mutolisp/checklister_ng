/**
 * IUCN / Taiwan Red List badge colour mapping + alien-status badge helpers.
 *
 * IUCN palette follows the official IUCN Red List colours; National (Taiwan)
 * codes share the same colour by stripping the leading `N` (e.g. NCR → CR).
 *
 * Hex values are returned for inline `style` use; we avoid Tailwind arbitrary
 * `bg-[#xxx]` because NativeWind's JIT scanner has to find each literal in
 * source, which is brittle when the value is selected dynamically.
 */

export type IUCNTone = {
  bg: string;
  text: string;
  label: string;
};

const IUCN_PALETTE: Record<string, { bg: string; text: 'white' | 'dark' }> = {
  EX: { bg: '#4C4338', text: 'white' },
  EW: { bg: '#80628A', text: 'white' },
  CR: { bg: '#B53523', text: 'white' },
  EN: { bg: '#E48B47', text: 'white' },
  VU: { bg: '#F6CB47', text: 'dark' },
  NT: { bg: '#9FC040', text: 'dark' },
  LC: { bg: '#6EBA3F', text: 'white' },
  DD: { bg: '#C3C3C3', text: 'dark' },
  NE: { bg: '#E5E5E5', text: 'dark' },
  NA: { bg: '#E5E5E5', text: 'dark' },
};

const TEXT_HEX = {
  white: '#FFFFFF',
  dark: '#1F2937', // tailwind gray-800, sits well on the lighter backgrounds
};

/** Returns null when the code is empty / not an IUCN-style code. */
export function iucnTone(code: string | null | undefined): IUCNTone | null {
  if (!code) return null;
  const raw = code.trim().toUpperCase();
  if (!raw) return null;
  const stripped = raw.replace(/^N(?=[A-Z])/, '');
  const entry = IUCN_PALETTE[stripped];
  if (!entry) return null;
  return {
    bg: entry.bg,
    text: TEXT_HEX[entry.text],
    label: raw,
  };
}

export type AlienBadgeKind = 'invasive' | 'naturalized' | 'cultivated' | 'captive';

export type AlienBadge = {
  kind: AlienBadgeKind;
  /** Compact single-char label for list rows. */
  shortLabel: string;
  /** Full label for detail sheets. */
  longLabel: string;
  /** Tailwind text-color class (no bg, follows the bare-text style of 「特」). */
  textClass: string;
};

/**
 * Map (alien_type, kingdom) → badge metadata. `native` returns null because
 * native species don't get a badge here; the endemic「特」badge is rendered
 * separately by callers.
 */
export function alienBadge(
  alienType: string | null | undefined,
  kingdom: string | null | undefined,
): AlienBadge | null {
  const t = (alienType ?? '').toLowerCase();
  const k = (kingdom ?? '').trim();
  if (t === 'invasive') {
    return {
      kind: 'invasive',
      shortLabel: '侵',
      longLabel: '入侵種',
      textClass: 'text-red-700 dark:text-red-400',
    };
  }
  if (t === 'naturalized') {
    return {
      kind: 'naturalized',
      shortLabel: '歸',
      longLabel: '歸化種',
      textClass: 'text-rose-500 dark:text-rose-400',
    };
  }
  if (t === 'cultured') {
    if (k === 'Animalia') {
      return {
        kind: 'captive',
        shortLabel: '圈',
        longLabel: '圈養',
        textClass: 'text-violet-600 dark:text-violet-400',
      };
    }
    return {
      kind: 'cultivated',
      shortLabel: '栽',
      longLabel: '栽培',
      textClass: 'text-purple-600 dark:text-purple-400',
    };
  }
  return null;
}
