import { getTaicolDb } from './init';
import i18n from '~/i18n';
import { isJpTaxonId, sourceOfTaxonId } from './regions';
import { externalToSearchResult, getExternalTaxon } from './externalTaxa';
import type { TaicolRow, SearchResult, AdvancedFilters, TaxonGroup } from './types';

export const TAXON_GROUP_FILTERS: Record<TaxonGroup, Partial<Record<'kingdom' | 'phylum' | 'class', string>>> = {
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

/**
 * Build an OR-combined taxon-group filter clause for `groups`. Within one
 * group the column conditions (kingdom/phylum/class) are AND-ed; the groups
 * themselves are OR-ed, so picking 「鳥類」+「哺乳類」 returns the union, not
 * the (empty) intersection. Bound values are pushed onto `params`. Returns
 * '' when there are no valid groups (i.e. 全部類群). Shared by `searchSpecies`
 * and the fuzzy fallback so both honour the same multi-select filter.
 */
export function groupFilterClause(
  groups: TaxonGroup[] | undefined,
  params: (string | number)[],
): string {
  if (!groups || groups.length === 0) return '';
  const ors: string[] = [];
  for (const g of groups) {
    const filter = TAXON_GROUP_FILTERS[g];
    if (!filter) continue;
    const ands: string[] = [];
    for (const [field, value] of Object.entries(filter)) {
      ands.push(`"${field}" = ?`);
      params.push(value);
    }
    if (ands.length > 0) ors.push(ands.length > 1 ? `(${ands.join(' AND ')})` : ands[0]);
  }
  return ors.length > 0 ? ` AND (${ors.join(' OR ')})` : '';
}

const ALIEN_TYPE_KEY: Record<string, string> = {
  native: 'alien.native',
  naturalized: 'alien.naturalized',
  invasive: 'alien.naturalized',
};

function mapAlienType(alienType: string, kingdom: string): string {
  if (alienType === 'cultured') return i18n.t(kingdom === 'Animalia' ? 'alien.captive' : 'alien.cultivated');
  return ALIEN_TYPE_KEY[alienType] ? i18n.t(ALIEN_TYPE_KEY[alienType]) : (alienType ?? '');
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
    alien_type: row.alien_type ?? '',
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
    region: (row.taxon_id ?? '').charAt(0) === 'y' ? 'JP' : 'TW',
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
  /** One or more taxon groups to restrict the search to (OR-combined). Empty
   *  / undefined = 全部類群 (no restriction). */
  groups?: TaxonGroup[];
  advanced?: AdvancedFilters;
  limit?: number;
};

/** Lookup a taxon by its TaiCOL taxon_id, returning the full SearchResult
 *  shape so the result fits into existing UI like LookupResultSheet. */
export function searchByTaxonId(taxonId: string): SearchResult | null {
  if (!taxonId) return null;
  // Three namespaces, three homes. External ('g…') taxa live in user.db and
  // have no row in twnamelist.db at all — sending one to taicol_names is
  // exactly the silent-null that regions.ts warns about, and it is what made
  // an externally-added species un-openable and un-addable from 常用名錄.
  if (sourceOfTaxonId(taxonId) === 'external') {
    const ext = getExternalTaxon(taxonId);
    return ext ? externalToSearchResult(ext) : null;
  }
  const db = getTaicolDb();
  // Query the dataset's real table directly by 't…'/'y…' prefix (no UNION
  // view). Prefer the accepted row; fall back to any row so synonyms still
  // surface basic metadata.
  const table = isJpTaxonId(taxonId) ? 'jp_names' : 'taicol_names';
  let res = db.executeSync(
    `SELECT ${SEARCH_COLUMNS} FROM ${table} WHERE taxon_id = ? AND usage_status = 'accepted' LIMIT 1`,
    [taxonId],
  );
  let row = (res.rows ?? [])[0] as TaicolRow | undefined;
  if (!row) {
    res = db.executeSync(`SELECT ${SEARCH_COLUMNS} FROM ${table} WHERE taxon_id = ? LIMIT 1`, [taxonId]);
    row = (res.rows ?? [])[0] as TaicolRow | undefined;
  }
  if (!row) return null;
  return rowToResult(row);
}

/** Explicit column list used by `searchSpecies` / `searchByTaxonId` / fuzzy —
 *  exactly the 33 fields `rowToResult` consumes. Selecting these instead of
 *  `SELECT *` cuts JSI marshalling cost roughly in half (taicol_names has
 *  ~70 columns; many are large nullable text like author / status notes
 *  that we don't need in the autocomplete row). Exported so `fuzzy.ts` can
 *  reuse the same projection. */
export const SEARCH_COLUMNS = [
  'name_id',
  'simple_name',
  'name_author',
  'common_name_c',
  'alternative_name_c',
  'family',
  'family_c',
  'iucn',
  'redlist',
  'is_endemic',
  'alien_type',
  'taxon_id',
  'usage_status',
  'kingdom',
  'kingdom_c',
  'phylum',
  'phylum_c',
  '"class"',
  'class_c',
  '"order"',
  'order_c',
  'genus',
  'genus_c',
  'nomenclature_name',
  'cites',
  'protected',
  'is_hybrid',
  'is_terrestrial',
  'is_freshwater',
  'is_brackish',
  'is_marine',
  'is_fossil',
  'alien_status_note',
  'rank',
].join(', ');

export function searchSpecies({ q, groups, advanced = {}, limit = 30 }: SearchOptions): SearchResult[] {
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

  // 篩選子句與其參數獨立累積，好讓底下的「精確列補抓」套用完全相同的條件。
  const filterParams: (string | number)[] = [];
  let filterSql = groupFilterClause(groups, filterParams);

  if (advanced.rank) {
    if (advanced.rank === 'infraspecies') {
      filterSql += ` AND rank IN ('Subspecies','Variety','Form')`;
    } else {
      filterSql += ` AND rank = ?`;
      filterParams.push(advanced.rank);
    }
  }
  if (advanced.endemic === 'true') {
    filterSql += ` AND is_endemic = 'true'`;
  }
  if (advanced.alien_type) {
    filterSql += ` AND alien_type = ?`;
    filterParams.push(advanced.alien_type);
  }
  if (advanced.family) {
    filterSql += ` AND family = ?`;
    filterParams.push(advanced.family);
  }
  if (advanced.order) {
    filterSql += ` AND "order" = ?`;
    filterParams.push(advanced.order);
  }
  if (advanced.class_name) {
    filterSql += ` AND class = ?`;
    filterParams.push(advanced.class_name);
  }
  if (advanced.genus) {
    filterSql += ` AND genus = ?`;
    filterParams.push(advanced.genus);
  }

  const sql =
    `SELECT ${SEARCH_COLUMNS} FROM taicol_names WHERE (${likePatterns.join(' OR ')}) ` +
    `AND is_in_taiwan LIKE '%true%'${filterSql} LIMIT 100`;

  const res = db.executeSync(sql, [...params, ...filterParams]);
  const likeRows = (res.rows ?? []) as unknown as TaicolRow[];

  // 精確列補抓。上面那道 LIKE 查詢沒有 ORDER BY，命中超過 100 列時，精確匹配
  // 那一列能不能進到這 100 列純粹取決於 SQLite 的掃描順序（實質上是 rowid），
  // 而 rowid 每次重建 bundle DB 就會變 —— 這就是「之前搜得到、換了名錄就搜不到」
  // 的成因：實測 47 個單字俗名中有 7 個（科蓮桃蕨梅貓菱）的精確列被截在 100 外，
  // 排序階段根本看不到它。
  //
  // 不用 ORDER BY 解，是因為排序會強迫 SQLite 走完全部命中列：打單一拉丁字母
  // （輸入學名時每個按鍵都會發生）命中 20 萬列，實測從 ~0ms 變 89ms，在實機上
  // 還會再放大數倍。改成另外發一道等值查詢，走 idx_taicol_common_name /
  // idx_taicol_simple_name，實測 0.1ms 以內。重複的列由下游既有的 taxon_id /
  // name_id 去重吸收。
  const exactPairs = variants.map(() => '(common_name_c = ? OR simple_name = ?)').join(' OR ');
  const exactParams: (string | number)[] = [];
  for (const v of variants) exactParams.push(v, v);
  const exactSql =
    `SELECT ${SEARCH_COLUMNS} FROM taicol_names WHERE (${exactPairs}) ` +
    `AND is_in_taiwan LIKE '%true%'${filterSql} LIMIT 20`;
  const exactRes = db.executeSync(exactSql, [...exactParams, ...filterParams]);
  const exactRows = (exactRes.rows ?? []) as unknown as TaicolRow[];

  const rows = [...exactRows, ...likeRows];

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
      `SELECT ${SEARCH_COLUMNS} FROM taicol_names WHERE taxon_id IN (${placeholders}) AND usage_status='accepted' AND is_in_taiwan LIKE '%true%'`,
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

/** jp_import 在同名的廣義／狹義分類群和名尾端加了「広義」「狹義」以資區別
 *  （共 2,267 筆）。做精確比對時要先剝掉，否則使用者打「コタニワタリ」永遠
 *  等不到「コタニワタリ広義」。只用於比較，顯示仍保留後綴。 */
function stripSensuSuffix(cname: string): string {
  return cname.replace(/(広義|狹義)$/, '');
}

/**
 * wamei 的同義和名存放在 `alternative_name_c`（逗號分隔）而不是像 TaiCOL 那樣
 * 各占一列，因此沒有 `usage_status` 可依循 —— 命中別名時必須自己補上
 * `matched_as`，UI 既有的 `≡` 標記與「你輸入：…」那一行才會出現
 * （`SearchBox` / `SpeciesDetailPanel` 都只看這個欄位）。
 *
 * `acceptedHit` = 查詢字串本身就命中接受和名（Hub name），此時不算同義。
 * `pick` 決定哪個別名算命中：一般搜尋用 `includes`、模糊搜尋用與索引詞相等。
 * 回傳命中的別名，供排序把精確別名往前排。
 *
 * 和名是片假名，`ScientificName` 的 `^[A-Z][a-z-]+` 開頭比對不會命中，
 * 會整串當非斜體輸出 —— 所以沿用既有的 matched_as 渲染不會誤把和名斜體化。
 */
export function markJpAlias(
  result: SearchResult,
  aliasField: unknown,
  acceptedHit: boolean,
  pick: (alias: string) => boolean,
): string | null {
  if (acceptedHit) return null;
  const alias = String(aliasField ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .find(pick);
  if (!alias) return null;
  // status 沿用 TaiCOL 的 'synonym' 字彙，UI 顯示與臺灣側同義詞完全一致。
  result.matched_as = { name: alias, fullname: alias, status: 'synonym' };
  return alias;
}

/**
 * Search the Japan (YList) dataset in `jp_names`. Only called when the Japan
 * region is enabled. Simpler than `searchSpecies`: every row is accepted (wamei
 * 的同義和名是 `alternative_name_c` 欄位而非獨立列，見 `markJpAlias`），no
 * `is_in_taiwan` gate, and no sensu-lato marking. Same column
 * projection + `rowToResult` as TaiCOL, so results slot into the shared UI; the
 * region is inferred from the 'y…' taxon_id by `rowToResult`.
 */
export function searchSpeciesJp({ q, groups, advanced = {}, limit = 30 }: SearchOptions): SearchResult[] {
  const trimmed = q.trim();
  if (!trimmed) return [];

  const db = getTaicolDb();
  const pattern = `%${escapeLike(trimmed)}%`;
  const params: (string | number)[] = [pattern, pattern, pattern, pattern, pattern];

  let sql =
    `SELECT ${SEARCH_COLUMNS} FROM jp_names WHERE (` +
    'common_name_c LIKE ? ESCAPE "\\" OR ' +
    'alternative_name_c LIKE ? ESCAPE "\\" OR ' +
    'simple_name LIKE ? ESCAPE "\\" OR ' +
    'family LIKE ? ESCAPE "\\" OR ' +
    'family_c LIKE ? ESCAPE "\\")';

  const filterParams: (string | number)[] = [];
  let filterSql = groupFilterClause(groups, filterParams);

  if (advanced.rank) {
    if (advanced.rank === 'infraspecies') filterSql += ` AND rank IN ('Subspecies','Variety','Form')`;
    else {
      filterSql += ` AND rank = ?`;
      filterParams.push(advanced.rank);
    }
  }
  if (advanced.endemic === 'true') filterSql += ` AND is_endemic = 'true'`;
  if (advanced.family) {
    filterSql += ` AND family = ?`;
    filterParams.push(advanced.family);
  }
  if (advanced.order) {
    filterSql += ` AND "order" = ?`;
    filterParams.push(advanced.order);
  }
  if (advanced.class_name) {
    filterSql += ` AND class = ?`;
    filterParams.push(advanced.class_name);
  }
  if (advanced.genus) {
    filterSql += ` AND genus = ?`;
    filterParams.push(advanced.genus);
  }

  sql += `${filterSql} LIMIT 100`;

  // 精確列補抓，理由同 searchSpecies。日本側的和名還多一層：jp_import 為了區分
  // 同名的廣義／狹義，在 common_name_c 尾端加了「広義」「狹義」（共 2,267 筆），
  // 所以等值比對要連帶把加了後綴的那兩種寫法一起找，否則打「コタニワタリ」
  // 永遠對不上「コタニワタリ広義」。
  const exactVariants = [trimmed, `${trimmed}広義`, `${trimmed}狹義`];
  const exactSql =
    `SELECT ${SEARCH_COLUMNS} FROM jp_names WHERE (` +
    exactVariants.map(() => 'common_name_c = ?').join(' OR ') +
    ` OR simple_name = ?)${filterSql} LIMIT 20`;
  const exactRes = db.executeSync(exactSql, [...exactVariants, trimmed, ...filterParams]);
  const exactRows = (exactRes.rows ?? []) as unknown as TaicolRow[];

  const res = db.executeSync(sql, [...params, ...filterParams]);
  const rows = [...exactRows, ...((res.rows ?? []) as unknown as TaicolRow[])];

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const row of rows) {
    const key = row.taxon_id ?? String(row.name_id);
    if (seen.has(key)) continue;
    seen.add(key);
    const result = rowToResult(row);
    markJpAlias(result, row.alternative_name_c, (row.common_name_c ?? '').includes(trimmed), (a) =>
      a.includes(trimmed),
    );
    results.push(result);
  }

  // 和名 ranking: exact → prefix → contains → length。別名命中排在同層接受名之後，
  // 但精確別名仍要贏過只是「包含」的接受名，否則異名搜尋會被淹沒在 30 筆之外。
  results.sort((a, b) => {
    const score = (r: SearchResult): number[] => {
      const alias = r.matched_as?.name ?? '';
      const bare = stripSensuSuffix(r._raw_cname);
      return [
        bare === trimmed ? 0 : 1,
        alias === trimmed ? 0 : 1,
        r.name === trimmed ? 0 : 1,
        bare.startsWith(trimmed) ? 0 : 1,
        alias.startsWith(trimmed) ? 0 : 1,
        bare.includes(trimmed) ? 0 : 1,
        bare.length,
      ];
    };
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return a._raw_cname.localeCompare(b._raw_cname);
  });

  return results.slice(0, limit);
}
