import yaml from 'js-yaml';
import { searchWithFuzzyFallback } from '~/db/fuzzy';
import { searchByTaxonId } from '~/db/search';
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

/** One parsed input item. `taxonId` is set only when the source carried a
 *  TaiCOL id (a checklist .yml export) — those resolve by id, skipping the
 *  name search entirely. */
export type ParsedEntry = { raw: string; taxonId?: string };

/** Keys carrying a taxon id / a name, across the yml shapes we emit:
 *  web export (`checklist:` + DwC terms), mobile session export (`event:` +
 *  `checklist:`), mobile plot export (`plot:` + `species:`). */
const ID_KEYS = ['taxonID', 'taxon_id'];
const NAME_KEYS = ['vernacularName', 'cname', 'common_name_c', 'scientificName', 'name', 'simple_name'];

/** Parse text input — pasted names, or the full contents of an exported .yml —
 *  into entries (one per taxon). */
export function parseInput(text: string): ParsedEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const fromYaml = parseYamlEntries(trimmed);
  if (fromYaml) return fromYaml;

  // Line-by-line
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((raw) => ({ raw }));
}

/** Try to read the text as a checklist yml. Returns null when it isn't one
 *  (plain name lists load as a bare string), so the caller falls back to
 *  line-by-line. */
function parseYamlEntries(text: string): ParsedEntry[] | null {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const entries = collectEntries(doc);
  return entries.length > 0 ? entries : null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function collectEntries(data: unknown): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const taxonId = firstString(obj, ID_KEYS);
    const name = firstString(obj, NAME_KEYS);
    if (taxonId) {
      out.push({ raw: name ?? taxonId, taxonId });
      return;
    }
    if (name) {
      out.push({ raw: name });
      return;
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(data);
  return out;
}

/** For each input item, resolve and categorize. Items carrying a taxon id
 *  resolve by id (exact, no search); the rest route through
 *  `searchWithFuzzyFallback` so misspellings / OS-dictation output resolve via
 *  fuzzy + (when `phonetic`) toneless-pinyin homophone matching. */
export function resolveBatch(
  items: (string | ParsedEntry)[],
  opts?: { phonetic?: boolean },
): CategorizedImport {
  const out: CategorizedImport = { exact: [], ambiguous: [], unmatched: [] };
  for (const item of items) {
    const { raw, taxonId } = typeof item === 'string' ? { raw: item, taxonId: undefined } : item;

    if (taxonId) {
      const hit = searchByTaxonId(taxonId);
      if (hit) {
        out.exact.push({ raw, matches: [hit] });
        continue;
      }
      // id not in this bundle's TaiCOL version — fall back to the name below
    }

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
