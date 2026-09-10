/**
 * Higher-taxon grouping for report analysis.
 *
 * Diversity indices, importance values and richness estimators are only
 * meaningful within a comparable set of organisms. Pooling birds with
 * vascular plants produces a Shannon index that is arithmetically valid and
 * ecologically meaningless: the two are surveyed by different methods, counted
 * in different units, and belong to different species pools. So a report that
 * spans more than one group runs the analysis once per group.
 *
 * The group keys and their precedence mirror `TAXON_GROUP_FILTERS` in
 * `src/db/search.ts`, and the labels reuse the existing `taxonGroup.*` i18n
 * namespace — this is the same vocabulary the search filter already uses, not
 * a second one. It is reimplemented here rather than imported because that
 * module pulls in the database.
 *
 * Pure module.
 */

export type TaxonGroupKey =
  | 'Tracheophyta'
  | 'Plantae'
  | 'Fungi'
  | 'Protozoa'
  | 'Aves'
  | 'Mammalia'
  | 'Reptilia'
  | 'Amphibia'
  | 'Actinopterygii'
  | 'Insecta'
  | 'Arachnida'
  | 'Mollusca'
  | 'Animalia'
  | 'other';

type GroupRule = {
  key: TaxonGroupKey;
  kingdom?: string;
  phylum?: string;
  class?: string;
};

/**
 * Ordered most specific first, because the groups nest: a bird satisfies both
 * `class = Aves` and `kingdom = Animalia`, and a fern satisfies both
 * `phylum = Tracheophyta` and `kingdom = Plantae`. First match wins, so
 * `Plantae` and `Animalia` act as the catch-alls they are in the search
 * filter — non-vascular plants and animals outside the named classes.
 */
const RULES: GroupRule[] = [
  { key: 'Tracheophyta', phylum: 'Tracheophyta' },
  { key: 'Aves', class: 'Aves' },
  { key: 'Mammalia', class: 'Mammalia' },
  { key: 'Reptilia', class: 'Reptilia' },
  { key: 'Amphibia', class: 'Amphibia' },
  { key: 'Actinopterygii', class: 'Actinopterygii' },
  { key: 'Insecta', class: 'Insecta' },
  { key: 'Arachnida', class: 'Arachnida' },
  { key: 'Mollusca', phylum: 'Mollusca' },
  { key: 'Fungi', kingdom: 'Fungi' },
  { key: 'Protozoa', kingdom: 'Protozoa' },
  { key: 'Plantae', kingdom: 'Plantae' },
  { key: 'Animalia', kingdom: 'Animalia' },
];

/** Presentation order — plants, then vertebrates, then invertebrates, then
 *  the rest — so a mixed report reads the same way every time. */
const ORDER: TaxonGroupKey[] = [
  'Tracheophyta',
  'Plantae',
  'Fungi',
  'Aves',
  'Mammalia',
  'Reptilia',
  'Amphibia',
  'Actinopterygii',
  'Insecta',
  'Arachnida',
  'Mollusca',
  'Protozoa',
  'Animalia',
  'other',
];

export type GroupedRecord = {
  kingdom?: string;
  phylum?: string;
  class_name?: string;
  /** Some record shapes carry the class under `class`. */
  class?: string;
};

function classOf(r: GroupedRecord): string {
  return (r.class_name ?? r.class ?? '').trim();
}

export function taxonGroupOf(r: GroupedRecord): TaxonGroupKey {
  const kingdom = (r.kingdom ?? '').trim();
  const phylum = (r.phylum ?? '').trim();
  const klass = classOf(r);
  for (const rule of RULES) {
    if (rule.phylum && phylum !== rule.phylum) continue;
    if (rule.class && klass !== rule.class) continue;
    if (rule.kingdom && kingdom !== rule.kingdom) continue;
    if (!rule.phylum && !rule.class && !rule.kingdom) continue;
    return rule.key;
  }
  return 'other';
}

/** i18n key for a group's label. `other` has no entry in the search filter's
 *  namespace, so it gets its own. */
export function taxonGroupLabelKey(key: TaxonGroupKey): string {
  return key === 'other' ? 'report.groupOther' : `taxonGroup.${key}`;
}

/**
 * Partition records by group, in presentation order. Groups with no records
 * are absent, so the common single-group case yields exactly one entry and
 * callers can treat "length === 1" as "nothing to split".
 */
export function groupRecords<T extends GroupedRecord>(
  records: T[],
): Array<{ key: TaxonGroupKey; records: T[] }> {
  const buckets = new Map<TaxonGroupKey, T[]>();
  for (const r of records) {
    const k = taxonGroupOf(r);
    const cur = buckets.get(k);
    if (cur) cur.push(r);
    else buckets.set(k, [r]);
  }
  return ORDER.filter((k) => buckets.has(k)).map((k) => ({ key: k, records: buckets.get(k)! }));
}
