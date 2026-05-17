/**
 * Clipboard helpers — write text to system clipboard + show a confirmation
 * toast. The text builders here generate the actual copy payloads from a
 * SearchResult / RecordWithTaxon / TaxonNode so call sites just pick the mode.
 */
import * as Clipboard from 'expo-clipboard';
import { useToast } from '~/stores/toast';
import { alienBadge, iucnTone } from './conservationColors';
import type { SearchResult } from '~/db/types';
import type { RecordWithTaxon } from '~/db/records';
import type { TaxonNode } from '~/db/taxonomy';

/** Write `text` to clipboard and toast「已複製：{label}」. Safe to await or fire-and-forget. */
export async function copyToClipboard(text: string, label?: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  const toast = useToast.getState().show;
  toast(label ? `已複製：${label}` : '已複製到剪貼簿');
}

export type SpeciesCopyMode = 'sciname' | 'cname' | 'both' | 'full';

/** A loose superset of fields the species text builders need. */
type SpeciesLike = {
  simple_name?: string;
  name?: string;
  fullname?: string;
  name_author?: string;
  common_name_c?: string;
  cname?: string;
  alternative_name_c?: string;
  family?: string;
  family_c?: string;
  family_cname?: string;
  rank?: string;
  is_endemic?: string;
  endemic?: number;
  alien_type?: string;
  is_hybrid?: string;
  redlist?: string;
  iucn?: string;
  iucn_category?: string;
  cites?: string;
  protected?: string;
  kingdom?: string;
  taxon_id?: string;
};

function pick<T>(...candidates: (T | undefined | null)[]): T | '' {
  for (const c of candidates) if (c != null && c !== '') return c;
  return '' as T;
}

function speciesSciname(sp: SpeciesLike): string {
  const base = (sp.simple_name || sp.name || '').trim();
  const author = (sp.name_author || '').trim();
  if (author) return `${base} ${author}`.trim();
  // SearchResult exposes `fullname` which already concatenates name + author.
  if (sp.fullname && sp.fullname !== base) return sp.fullname;
  return base;
}

function speciesCname(sp: SpeciesLike): string {
  return (sp.common_name_c || sp.cname || '').trim();
}

export function buildSpeciesCopyText(sp: SpeciesLike, mode: SpeciesCopyMode): string {
  const sciname = speciesSciname(sp);
  const cname = speciesCname(sp);
  const family = pick(sp.family_c, sp.family_cname);
  const familyLatin = sp.family ?? '';

  if (mode === 'sciname') return sciname;
  if (mode === 'cname') return cname || sciname;
  if (mode === 'both') return cname ? `${cname} ${sciname}` : sciname;

  // mode === 'full' — multi-line dossier
  const lines: string[] = [];
  if (cname) lines.push(cname);
  if (sciname) lines.push(sciname);
  if (sp.alternative_name_c) {
    const alts = sp.alternative_name_c.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
    if (alts.length > 0) lines.push(`其他俗名：${alts.join('、')}`);
  }
  if (family || familyLatin) {
    const parts = [family, familyLatin].filter(Boolean);
    lines.push(`科：${parts.join(' ')}`);
  }
  if (sp.rank) lines.push(`階層：${sp.rank}`);

  const statusBits: string[] = [];
  const isEndemic = sp.is_endemic === 'true' || sp.endemic === 1;
  if (isEndemic) statusBits.push('特有種');
  const ab = alienBadge(sp.alien_type, sp.kingdom);
  if (ab) statusBits.push(ab.longLabel);
  if (sp.is_hybrid === 'true') statusBits.push('雜交');
  if (statusBits.length > 0) lines.push(`物種狀態：${statusBits.join('、')}`);

  const consBits: string[] = [];
  const redlistTone = iucnTone(sp.redlist);
  if (redlistTone) consBits.push(`紅皮書 ${redlistTone.label}`);
  const iucnCode = sp.iucn ?? sp.iucn_category;
  const iucnToneVal = iucnTone(iucnCode);
  if (iucnToneVal) consBits.push(`IUCN ${iucnToneVal.label}`);
  if (sp.cites) consBits.push(`CITES ${sp.cites}`);
  if (sp.protected) consBits.push(`保育類 ${sp.protected}`);
  if (consBits.length > 0) lines.push(`保育狀態：${consBits.join('、')}`);

  if (sp.taxon_id) lines.push(`TaiCOL：https://taicol.tw/zh-hant/taxon/${sp.taxon_id}`);

  return lines.join('\n');
}

export type SpeciesActionLabel = { label: string; mode: SpeciesCopyMode };

/** Standard action sheet options for copying a species in the order most users
 *  reach for: scientific first (lab use), then Chinese, both, then full dump. */
export function speciesCopyActions(sp: SpeciesLike): SpeciesActionLabel[] {
  const has = (m: SpeciesCopyMode) => buildSpeciesCopyText(sp, m).length > 0;
  const out: SpeciesActionLabel[] = [];
  if (has('sciname')) out.push({ label: '複製學名', mode: 'sciname' });
  if (speciesCname(sp)) out.push({ label: '複製俗名', mode: 'cname' });
  if (speciesCname(sp) && speciesSciname(sp)) out.push({ label: '複製俗名 + 學名', mode: 'both' });
  out.push({ label: '複製完整資訊', mode: 'full' });
  return out;
}

export type TaxonCopyMode = 'sciname' | 'cname' | 'both' | 'path';

export function buildTaxonCopyText(
  node: { name: string; name_c?: string; rank?: string },
  mode: TaxonCopyMode,
  pathSegments?: string[],
): string {
  const sci = (node.name || '').trim();
  const cn = (node.name_c || '').trim();
  if (mode === 'sciname') return sci;
  if (mode === 'cname') return cn || sci;
  if (mode === 'both') return cn ? `${cn} ${sci}` : sci;
  // mode === 'path'
  if (pathSegments && pathSegments.length > 0) return pathSegments.join(' > ');
  return cn ? `${cn} ${sci}` : sci;
}

export function taxonCopyActions(node: { name: string; name_c?: string }): Array<{ label: string; mode: TaxonCopyMode }> {
  const out: Array<{ label: string; mode: TaxonCopyMode }> = [];
  out.push({ label: '複製學名', mode: 'sciname' });
  if (node.name_c) {
    out.push({ label: '複製俗名', mode: 'cname' });
    out.push({ label: '複製俗名 + 學名', mode: 'both' });
  }
  return out;
}

// Re-export concrete record types for callers that want stricter typing.
export type { SearchResult, RecordWithTaxon, TaxonNode };
