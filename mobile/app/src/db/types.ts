export type TaicolRow = {
  name_id: number;
  rank: string | null;
  simple_name: string | null;
  name_author: string | null;
  formatted_name: string | null;
  usage_status: string | null;
  taxon_id: string | null;
  is_in_taiwan: string | null;
  common_name_c: string | null;
  alternative_name_c: string | null;
  is_endemic: string | null;
  alien_type: string | null;
  iucn: string | null;
  redlist: string | null;
  cites: string | null;
  protected: string | null;
  is_hybrid: string | null;
  nomenclature_name: string | null;
  kingdom: string | null;
  kingdom_c: string | null;
  phylum: string | null;
  phylum_c: string | null;
  class: string | null;
  class_c: string | null;
  order: string | null;
  order_c: string | null;
  family: string | null;
  family_c: string | null;
  genus: string | null;
  genus_c: string | null;
  is_terrestrial: string | null;
  is_freshwater: string | null;
  is_brackish: string | null;
  is_marine: string | null;
  is_fossil: string | null;
  alien_status_note: string | null;
};

export type SearchResult = {
  id: number;
  name: string;
  fullname: string;
  cname: string;
  _raw_cname: string;
  family: string;
  family_cname: string;
  iucn_category: string;
  redlist: string;
  endemic: 0 | 1;
  source: string;
  /** Raw alien_type from TaiCOL (native / naturalized / invasive / cultured / ''). */
  alien_type: string;
  pt_name: string;
  taxon_id: string;
  usage_status: string;
  alternative_name_c: string;
  kingdom: string;
  kingdom_c: string;
  phylum: string;
  phylum_c: string;
  class_name: string;
  class_c: string;
  order: string;
  order_c: string;
  genus: string;
  genus_c: string;
  nomenclature_name: string;
  cites: string;
  protected: string;
  is_hybrid: string;
  is_terrestrial: string;
  is_freshwater: string;
  is_brackish: string;
  is_marine: string;
  is_fossil: string;
  alien_status_note: string;
  rank: string;
  is_autonym: boolean;
  is_sensu_lato: boolean;
  /** Source dataset. 'TW' (TaiCOL, default) or 'JP' (YList). Set when the
   *  Japan regional database is enabled; absent ⇒ treat as 'TW'. */
  region?: 'TW' | 'JP';
  matched_as?: { name: string; fullname: string; status: string };
  fuzzy_match?: { query: string; matched: string; score: number };
};

export type AdvancedFilters = {
  rank?: string;
  endemic?: 'true';
  alien_type?: string;
  family?: string;
  order?: string;
  class_name?: string;
  genus?: string;
};

export type TaxonGroup =
  | 'Tracheophyta'
  | 'Plantae'
  | 'Aves'
  | 'Fungi'
  | 'Mammalia'
  | 'Reptilia'
  | 'Insecta'
  | 'Arachnida'
  | 'Mollusca'
  | 'Actinopterygii'
  | 'Amphibia'
  | 'Protozoa'
  | 'Animalia';
