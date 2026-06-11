import type { SearchResult, TaxonSpecies } from '~/db';
import i18n from '~/i18n';

/** Lift a TaxonSpecies (returned by `getSpeciesUnder` / `getInfraspeciesOf`)
 *  into a SearchResult so it slots into `LookupResultSheet` /
 *  `SpeciesDetailPanel`. TaxonSpecies omits a few SearchResult fields — those
 *  are filled with '' since the detail UI hides empty rows. */
export function taxonSpeciesToSearchResult(sp: TaxonSpecies): SearchResult {
  return {
    id: 0,
    name: sp.simple_name,
    fullname: sp.name_author ? `${sp.simple_name} ${sp.name_author}` : sp.simple_name,
    cname: sp.common_name_c,
    _raw_cname: sp.common_name_c,
    family: sp.family,
    family_cname: sp.family_c,
    iucn_category: sp.iucn,
    redlist: sp.redlist,
    endemic: sp.is_endemic === 'true' ? 1 : 0,
    source:
      sp.alien_type === 'native'
        ? i18n.t('alien.native')
        : sp.alien_type === 'naturalized' || sp.alien_type === 'invasive'
          ? i18n.t('alien.naturalized')
          : sp.alien_type === 'cultured'
            ? i18n.t(sp.kingdom === 'Animalia' ? 'alien.captive' : 'alien.cultivated')
            : '',
    alien_type: sp.alien_type,
    pt_name: '',
    taxon_id: sp.taxon_id,
    usage_status: 'accepted',
    alternative_name_c: sp.alternative_name_c,
    kingdom: sp.kingdom,
    kingdom_c: sp.kingdom_c,
    phylum: sp.phylum,
    phylum_c: sp.phylum_c,
    class_name: sp.class,
    class_c: sp.class_c,
    order: sp.order,
    order_c: sp.order_c,
    genus: sp.genus,
    genus_c: sp.genus_c,
    nomenclature_name: sp.nomenclature_name,
    cites: sp.cites,
    protected: sp.protected,
    is_hybrid: sp.is_hybrid,
    is_terrestrial: '',
    is_freshwater: '',
    is_brackish: '',
    is_marine: '',
    is_fossil: '',
    alien_status_note: sp.alien_status_note,
    rank: sp.rank,
    is_autonym: sp.is_autonym,
    is_sensu_lato: false,
  };
}
