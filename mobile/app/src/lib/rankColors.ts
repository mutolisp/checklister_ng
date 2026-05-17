/**
 * Rank → soft rainbow color mapping for the rank chip / badge.
 * Accepts either English ("Kingdom" / "kingdom" / "Subspecies") or
 * Traditional Chinese ("界" / "亞種" / "變種") rank labels.
 */

export type RankColor = {
  bg: string;
  text: string;
};

const FALLBACK: RankColor = {
  bg: 'bg-gray-100 dark:bg-gray-800',
  text: 'text-gray-600 dark:text-gray-400',
};

const COLORS: Record<string, RankColor> = {
  kingdom: {
    bg: 'bg-rose-100 dark:bg-rose-900/40',
    text: 'text-rose-700 dark:text-rose-300',
  },
  phylum: {
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    text: 'text-orange-800 dark:text-orange-300',
  },
  class: {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-800 dark:text-amber-300',
  },
  order: {
    bg: 'bg-lime-100 dark:bg-lime-900/40',
    text: 'text-lime-800 dark:text-lime-300',
  },
  family: {
    bg: 'bg-teal-100 dark:bg-teal-900/40',
    text: 'text-teal-800 dark:text-teal-300',
  },
  genus: {
    bg: 'bg-sky-100 dark:bg-sky-900/40',
    text: 'text-sky-800 dark:text-sky-300',
  },
  species: {
    bg: 'bg-indigo-100 dark:bg-indigo-900/40',
    text: 'text-indigo-700 dark:text-indigo-300',
  },
  subspecies: {
    bg: 'bg-violet-100 dark:bg-violet-900/40',
    text: 'text-violet-700 dark:text-violet-300',
  },
  variety: {
    bg: 'bg-fuchsia-100 dark:bg-fuchsia-900/40',
    text: 'text-fuchsia-700 dark:text-fuchsia-300',
  },
  form: {
    bg: 'bg-pink-100 dark:bg-pink-900/40',
    text: 'text-pink-700 dark:text-pink-300',
  },
};

const ZH_TO_EN: Record<string, string> = {
  域: 'kingdom',
  界: 'kingdom',
  門: 'phylum',
  亞門: 'phylum',
  綱: 'class',
  亞綱: 'class',
  目: 'order',
  亞目: 'order',
  科: 'family',
  亞科: 'family',
  族: 'family',
  屬: 'genus',
  亞屬: 'genus',
  種: 'species',
  亞種: 'subspecies',
  變種: 'variety',
  品型: 'form',
  型: 'form',
};

export function rankColor(rank: string | null | undefined): RankColor {
  if (!rank) return FALLBACK;
  const trimmed = rank.trim();
  if (!trimmed) return FALLBACK;
  const lower = trimmed.toLowerCase();
  if (lower in COLORS) return COLORS[lower];
  const en = ZH_TO_EN[trimmed];
  if (en && en in COLORS) return COLORS[en];
  return FALLBACK;
}
