import { getTaicolDb } from './init';
import type { TaicolRow, SearchResult, AdvancedFilters, TaxonGroup } from './types';

const TAXON_GROUP_FILTERS: Record<TaxonGroup, Partial<Record<'kingdom' | 'phylum' | 'class', string>>> = {
  Tracheophyta: { phylum: 'Tracheophyta' },
  Plantae: { kingdom: 'Plantae' },
  Aves: { class: 'Aves' },
  Fungi: { kingdom: 'Fungi' },
  Mammalia: { class: 'Mammalia' },
  Reptilia: { class: 'Reptilia' },
  Insecta: { class: 'Insecta' },
  Arachnida: { class: 'Arachnida' },
  Mollusca: { phylum: 'Mollusca' },
  Actinopterygii: { class: 'Actinopterygii' },
  Amphibia: { class: 'Amphibia' },
  Protozoa: { kingdom: 'Protozoa' },
  Animalia: { kingdom: 'Animalia' },
};

const ALIEN_TYPE_MAP: Record<string, string> = {
  native: '原生',
  naturalized: '歸化',
  invasive: '歸化',
};

function mapAlienType(alienType: string, kingdom: string): string {
  if (alienType === 'cultured') return kingdom === 'Animalia' ? '圈養' : '栽培';
  return ALIEN_TYPE_MAP[alienType] ?? alienType ?? '';
}

function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizeTw(q: string): string[] {
  const variants = [q];
  if (q.includes('台')) variants.push(q.replaceAll('台', '臺'));
  else if (q.includes('臺')) variants.push(q.replaceAll('臺', '台'));
  return variants;
}

function isAutonym(simpleName: string, rank: string): boolean {
  if (!['Subspecies', 'Variety', 'Form'].includes(rank)) return false;
  const parts = simpleName.split(/\s+/);
  return parts.length >= 3 && parts[1] === parts[parts.length - 1];
}

function buildPtName(row: TaicolRow): string {
  const parts: string[] = [];
  if (row.phylum) parts.push(row.phylum);
  if (row.class) parts.push(row.class);
  return parts.length > 0 ? parts.join(' > ') : row.kingdom ?? '';
}

function rowToResult(
  row: TaicolRow,
  displayCname: string = '',
  matchedRow: TaicolRow | null = null,
): SearchResult {
  const fullname = row.name_author ? `${row.simple_name ?? ''} ${row.name_author}` : (row.simple_name ?? '');

  const result: SearchResult = {
    id: row.name_id,
    name: row.simple_name ?? '',
    fullname,
    cname: displayCname || (row.common_name_c ?? ''),
    _raw_cname: row.common_name_c ?? '',
    family: row.family ?? '',
    family_cname: row.family_c ?? '',
    iucn_category: row.iucn ?? '',
    redlist: row.redlist ?? '',
    endemic: row.is_endemic === 'true' ? 1 : 0,
    source: mapAlienType(row.alien_type ?? '', row.kingdom ?? ''),
    pt_name: buildPtName(row),
    taxon_id: row.taxon_id ?? '',
    usage_status: 'accepted',
    alternative_name_c: row.alternative_name_c ?? '',
    kingdom: row.kingdom ?? '',
    kingdom_c: row.kingdom_c ?? '',
    phylum: row.phylum ?? '',
    phylum_c: row.phylum_c ?? '',
    class_name: row.class ?? '',
    class_c: row.class_c ?? '',
    order: row.order ?? '',
    order_c: row.order_c ?? '',
    genus: row.genus ?? '',
    genus_c: row.genus_c ?? '',
    nomenclature_name: row.nomenclature_name ?? '',
    cites: row.cites ?? '',
    protected: row.protected ?? '',
    is_hybrid: row.is_hybrid ?? '',
    is_terrestrial: row.is_terrestrial ?? '',
    is_freshwater: row.is_freshwater ?? '',
    is_brackish: row.is_brackish ?? '',
    is_marine: row.is_marine ?? '',
    is_fossil: row.is_fossil ?? '',
    alien_status_note: row.alien_status_note ?? '',
    rank: row.rank ?? '',
    is_autonym: isAutonym(row.simple_name ?? '', row.rank ?? ''),
    is_sensu_lato: false,
  };

  if (matchedRow && matchedRow.usage_status !== 'accepted') {
    const matchedFullname = matchedRow.name_author
      ? `${matchedRow.simple_name ?? ''} ${matchedRow.name_author}`
      : (matchedRow.simple_name ?? '');
    result.matched_as = {
      name: matchedRow.simple_name ?? '',
      fullname: matchedFullname,
      status: matchedRow.usage_status ?? '',
    };
  }

  return result;
}

function markSensuLato(results: SearchResult[]): SearchResult[] {
  const db = getTaicolDb();
  const speciesNames = results
    .filter((r) => r.usage_status === 'accepted' && !r.is_autonym && r.name && r.name.split(' ').length === 2)
    .map((r) => r.name);
  if (speciesNames.length === 0) return results;

  const slSpecies = new Set<string>();
  for (const sp of speciesNames) {
    const res = db.executeSync(
      `SELECT 1 FROM taicol_names WHERE simple_name LIKE ? AND usage_status='accepted' AND is_in_taiwan LIKE '%true%' AND rank IN ('Subspecies','Variety','Form') LIMIT 1`,
      [`${sp} %`],
    );
    if ((res.rows?.length ?? 0) > 0) slSpecies.add(sp);
  }

  return results.map((r) => (slSpecies.has(r.name) ? { ...r, is_sensu_lato: true } : r));
}

export type SearchOptions = {
  q: string;
  group?: TaxonGroup;
  advanced?: AdvancedFilters;
  limit?: number;
};

export function searchSpecies({ q, group, advanced = {}, limit = 30 }: SearchOptions): SearchResult[] {
  const trimmed = q.trim();
  if (!trimmed) return [];

  const db = getTaicolDb();
  const variants = normalizeTw(trimmed);

  const likePatterns: string[] = [];
  const params: (string | number)[] = [];

  for (const v of variants) {
    const pattern = `%${escapeLike(v)}%`;
    likePatterns.push(
      'common_name_c LIKE ? ESCAPE "\\"',
      'alternative_name_c LIKE ? ESCAPE "\\"',
      'simple_name LIKE ? ESCAPE "\\"',
      'family LIKE ? ESCAPE "\\"',
      'family_c LIKE ? ESCAPE "\\"',
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  let sql = `SELECT * FROM taicol_names WHERE (${likePatterns.join(' OR ')}) AND is_in_taiwan LIKE '%true%'`;

  if (group && TAXON_GROUP_FILTERS[group]) {
    for (const [field, value] of Object.entries(TAXON_GROUP_FILTERS[group])) {
      sql += ` AND "${field}" = ?`;
      params.push(value);
    }
  }

  if (advanced.rank) {
    if (advanced.rank === 'infraspecies') {
      sql += ` AND rank IN ('Subspecies','Variety','Form')`;
    } else {
      sql += ` AND rank = ?`;
      params.push(advanced.rank);
    }
  }
  if (advanced.endemic === 'true') {
    sql += ` AND is_endemic = 'true'`;
  }
  if (advanced.alien_type) {
    sql += ` AND alien_type = ?`;
    params.push(advanced.alien_type);
  }
  if (advanced.family) {
    sql += ` AND family = ?`;
    params.push(advanced.family);
  }
  if (advanced.order) {
    sql += ` AND "order" = ?`;
    params.push(advanced.order);
  }
  if (advanced.class_name) {
    sql += ` AND class = ?`;
    params.push(advanced.class_name);
  }
  if (advanced.genus) {
    sql += ` AND genus = ?`;
    params.push(advanced.genus);
  }

  sql += ` LIMIT 100`;

  const res = db.executeSync(sql, params);
  const rows = (res.rows ?? []) as unknown as TaicolRow[];

  const acceptedEntries: Array<[TaicolRow, TaicolRow | null]> = [];
  const nonAccepted: TaicolRow[] = [];
  for (const row of rows) {
    if (row.usage_status === 'accepted') acceptedEntries.push([row, null]);
    else if (row.taxon_id) nonAccepted.push(row);
  }

  const seenTaxonIds = new Set(acceptedEntries.map(([r]) => r.taxon_id).filter(Boolean) as string[]);
  const needResolve = new Map<string, TaicolRow>();
  for (const row of nonAccepted) {
    if (row.taxon_id && !seenTaxonIds.has(row.taxon_id) && !needResolve.has(row.taxon_id)) {
      needResolve.set(row.taxon_id, row);
    }
  }

  if (needResolve.size > 0) {
    const ids = Array.from(needResolve.keys());
    const placeholders = ids.map(() => '?').join(',');
    const resolved = db.executeSync(
      `SELECT * FROM taicol_names WHERE taxon_id IN (${placeholders}) AND usage_status='accepted' AND is_in_taiwan LIKE '%true%'`,
      ids,
    );
    for (const accRow of (resolved.rows ?? []) as unknown as TaicolRow[]) {
      acceptedEntries.push([accRow, needResolve.get(accRow.taxon_id ?? '') ?? null]);
    }
  }

  const seen = new Set<string | number>();
  const unique: Array<[TaicolRow, TaicolRow | null]> = [];
  for (const [accRow, matched] of acceptedEntries) {
    const key = accRow.taxon_id || accRow.name_id;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push([accRow, matched]);
  }

  // 同俗名的 Species + nominal infraspecific 去重
  const cnameSpeciesMap = new Map<string, string>();
  for (const [row] of unique) {
    if (row.common_name_c && row.rank === 'Species') {
      cnameSpeciesMap.set(row.common_name_c, row.simple_name ?? '');
    }
  }
  const filteredUnique = unique.filter(([row]) => {
    const cn = row.common_name_c ?? '';
    if (cn && ['Form', 'Variety', 'Subspecies'].includes(row.rank ?? '') && cnameSpeciesMap.has(cn)) {
      const spName = cnameSpeciesMap.get(cn)!;
      if ((row.simple_name ?? '').startsWith(spName)) return false;
    }
    return true;
  });

  const matchIsAltName = (row: TaicolRow): boolean => {
    const cn = row.common_name_c ?? '';
    const alt = row.alternative_name_c ?? '';
    for (const v of variants) {
      if (cn.includes(v)) return false;
      if (alt.includes(v)) return true;
    }
    return false;
  };

  const cnameCounts = new Map<string, number>();
  for (const [row] of filteredUnique) {
    const cn = row.common_name_c ?? '';
    if (cn) cnameCounts.set(cn, (cnameCounts.get(cn) ?? 0) + 1);
  }

  const results: SearchResult[] = [];
  for (const [accRow, matchedNonAcc] of filteredUnique) {
    const cn = accRow.common_name_c ?? '';
    let displayCname = cn;

    if (matchIsAltName(accRow) && cn) {
      const alt = accRow.alternative_name_c ?? '';
      let matchedAlt = '';
      for (const v of variants) {
        for (const a of alt.split(',')) {
          if (a.trim().includes(v)) {
            matchedAlt = a.trim();
            break;
          }
        }
        if (matchedAlt) break;
      }
      if (matchedAlt && matchedAlt !== cn) displayCname = `${matchedAlt}(${cn})`;
    } else if (cn && (cnameCounts.get(cn) ?? 0) > 1) {
      const alt = accRow.alternative_name_c ?? '';
      const firstAlt = alt ? alt.split(',')[0].trim() : '';
      if (firstAlt) displayCname = `${cn}(${firstAlt})`;
    }

    results.push(rowToResult(accRow, displayCname, matchedNonAcc));
  }

  results.sort((a, b) => {
    const score = (r: SearchResult): number[] => [
      r._raw_cname === trimmed ? 0 : 1,
      r.name === trimmed ? 0 : 1,
      r._raw_cname.includes(trimmed) ? 0 : 1,
      r.alternative_name_c.split(',').some((x) => x.trim() === trimmed) ? 0 : 1,
      r.alternative_name_c.includes(trimmed) ? 0 : 1,
      r._raw_cname.startsWith(trimmed) ? 0 : 1,
      r._raw_cname.length,
    ];
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sa[i] - sb[i];
    }
    return a._raw_cname.localeCompare(b._raw_cname);
  });

  const top = results.slice(0, limit);
  return markSensuLato(top);
}
