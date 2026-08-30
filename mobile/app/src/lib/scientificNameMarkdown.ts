/**
 * Format scientific name for Markdown.
 * ICN/ICNP/ICVCN (plants/fungi/prokaryotes/viruses): *Genus species* var. *epithet* Author
 * ICZN (animals): *Genus species epithet* (Author, Year)
 *
 * Mirrors backend/api/formatter.py.
 */

function isZoologicalFormat(nomenclatureName: string, kingdom: string): boolean {
  if (nomenclatureName) return nomenclatureName.toUpperCase() === 'ICZN';
  return (kingdom || '') === 'Animalia';
}

const RANK_PATTERN = /^(.*?)\s?(subsp\.|var\.|f\.|fo\.)\s([a-z-]+)\s?/;

function formatBotanical(fullname: string): string {
  let remaining = fullname.trim();
  let formatted = '';

  const mainMatch = remaining.match(/^([A-Z][a-z]+ [a-z-]+)/);
  if (!mainMatch) return fullname;

  const main = mainMatch[1];
  formatted += `*${main}*`;
  remaining = remaining.slice(main.length).trim();

  // Recursively handle subsp./var./f./fo.
  while (true) {
    const m = remaining.match(RANK_PATTERN);
    if (!m) break;
    const beforeRank = m[1].trim();
    const rank = m[2];
    const epithet = m[3];

    if (beforeRank) formatted += ` ${beforeRank}`;
    formatted += ` ${rank} *${epithet}*`;
    remaining = remaining.slice(m[0].length).trim();
  }

  if (remaining) formatted += ` ${remaining}`;
  return formatted;
}

function formatAnimal(fullname: string): string {
  const remaining = fullname.trim();
  const m = remaining.match(/^([A-Z][a-z]+(?:\s+[a-z-]+)+)\s*(.*)/);
  if (!m) return fullname;

  const namePart = m[1];
  const authorPart = m[2].trim();
  let formatted = `*${namePart}*`;
  if (authorPart) formatted += ` ${authorPart}`;
  return formatted;
}

export function formatScientificNameMarkdown(
  fullname: string,
  kingdom: string = '',
  nomenclatureName: string = '',
): string {
  const trimmed = fullname.trim();
  if (!trimmed) return fullname;
  if (isZoologicalFormat(nomenclatureName, kingdom)) return formatAnimal(trimmed);
  return formatBotanical(trimmed);
}
