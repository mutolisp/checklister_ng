import yaml from 'js-yaml';
import { searchWithFuzzyFallback } from '~/db/fuzzy';
import type { SearchResult } from '~/db/types';

export type ImportEntry = {
  raw: string;          // original input line
  matches: SearchResult[];  // search results
};

export type CategorizedImport = {
  exact: ImportEntry[];        // exactly 1 match
  ambiguous: ImportEntry[];    // 2+ matches
  unmatched: ImportEntry[];    // 0 matches
};

/** Parse various text inputs into a list of name strings (one per line). */
export function parseInput(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try YAML first (checklister-ng .yml format)
  if (trimmed.startsWith('checklist:') || trimmed.startsWith('- ')) {
    try {
      const parsed = yaml.load(trimmed) as unknown;
      const names = extractNamesFromYaml(parsed);
      if (names.length > 0) return names;
    } catch {
      // fallthrough to line-by-line
    }
  }

  // Line-by-line
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function extractNamesFromYaml(data: unknown): string[] {
  const names: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      // Pull common name / scientific name fields used by web export
      const candidates = ['vernacularName', 'cname', 'scientificName', 'name', 'simple_name'];
      for (const k of candidates) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) {
          names.push(v.trim());
          return;
        }
      }
      for (const v of Object.values(obj)) visit(v);
    }
  };
  visit(data);
  return names;
}

/** For each input name, search and categorize. Routes through
 *  `searchWithFuzzyFallback` so misspellings / OS-dictation output resolve via
 *  fuzzy + (when `phonetic`) toneless-pinyin homophone matching. */
export function resolveBatch(
  names: string[],
  opts?: { phonetic?: boolean },
): CategorizedImport {
  const out: CategorizedImport = { exact: [], ambiguous: [], unmatched: [] };
  for (const raw of names) {
    const matches = searchWithFuzzyFallback({ q: raw, phonetic: opts?.phonetic }).slice(0, 5);
    const entry: ImportEntry = { raw, matches };
    if (matches.length === 0) out.unmatched.push(entry);
    else if (matches.length === 1) out.exact.push(entry);
    else {
      // Auto-promote to exact if a perfect cname / name match exists
      const perfect = matches.find(
        (m) => m._raw_cname === raw || m.name === raw,
      );
      if (perfect) {
        out.exact.push({ raw, matches: [perfect] });
      } else {
        out.ambiguous.push(entry);
      }
    }
  }
  return out;
}
