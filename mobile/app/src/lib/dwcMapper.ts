/**
 * Internal field names <-> Darwin Core (DwC) terms.
 * Mirrors backend/utils/mapper.py for byte-level export compatibility.
 */
export const DWC_FIELD_MAP: Record<string, string> = {
  taxon_id: 'taxonID',
  name: 'scientificName',
  fullname: 'scientificNameAuthorship',
  cname: 'vernacularName',
  alternative_name_c: 'alternativeVernacularName',
  family: 'family',
  family_cname: 'familyVernacularName',
  family_c: 'familyVernacularName',
  pt_name: 'higherClassification',
  kingdom: 'kingdom',
  kingdom_c: 'kingdomVernacularName',
  phylum: 'phylum',
  phylum_c: 'phylumVernacularName',
  class_name: 'class',
  class_c: 'classVernacularName',
  order: 'order',
  order_c: 'orderVernacularName',
  genus: 'genus',
  genus_c: 'genusVernacularName',
  abundance: 'individualCount',
  source: 'establishmentMeans',
  iucn_category: 'iucnRedListCategory',
  redlist: 'nationalRedListCategory',
  cites: 'CITES',
  protected: 'protectionStatus',
  endemic: 'endemic',
  is_hybrid: 'isHybrid',
  nomenclature_name: 'nomenclaturalCode',
  is_terrestrial: 'isTerrestrial',
  is_freshwater: 'isFreshwater',
  is_brackish: 'isBrackish',
  is_marine: 'isMarine',
  alien_status_note: 'establishmentRemarks',
  occurrenceID: 'occurrenceID',
  occurrence_id: 'occurrenceID',
  eventDate: 'eventDate',
  modified: 'modified',
  // GPS — internal fields → DwC location terms.
  lat: 'decimalLatitude',
  lng: 'decimalLongitude',
  accuracy: 'coordinateUncertaintyInMeters',
  // Abundance (Plot species) — generalised DwC terms.
  simple_name: 'scientificName',
  common_name_c: 'vernacularName',
  organism_quantity: 'organismQuantity',
  organism_quantity_type: 'organismQuantityType',
  // Per-record species attributes. Multi-value fields (reproductive_condition,
  // leaf_phenology) are serialized to DwC's pipe-separated convention by the
  // exporter before reaching this mapper.
  sex: 'sex',
  life_stage: 'lifeStage',
  reproductive_condition: 'reproductiveCondition',
  leaf_phenology: 'leafPhenology',
  // Name usage. `taxonID` is the taxon CONCEPT; `scientificName` is whichever
  // name the recorder filed under, which may be one the checklist calls
  // not-accepted. The other three say so explicitly rather than leaving the
  // reader to assume the name was accepted.
  used_name_id: 'scientificNameID',
  used_status: 'taxonomicStatus',
  accepted_name: 'acceptedNameUsage',
  // DwC requires this to share an identifier space with taxonID — so it is the
  // taxon's own id, NOT a name_id.
  accepted_taxon_id: 'acceptedNameUsageID',
  // Photo filenames inside an export zip's photos/ — pipe-joined, the same
  // multi-value convention as reproductiveCondition. Mobile-only: the desktop
  // backend (backend/utils/mapper.py) has no photos.
  photo_files: 'associatedMedia',
  // Free-text remarks + taxon rank (were previously passed through unmapped).
  notes: 'occurrenceRemarks',
  rank: 'taxonRank',
  // Detection method (point count / animal records). No standard DwC term —
  // use a custom camelCase term, consistent with verbatimVegetationLayer etc.
  detection_type: 'detectionType',
  // Specimen collection (採集). All standard DwC occurrence terms.
  record_number: 'recordNumber',
  basis_of_record: 'basisOfRecord',
  recorded_by: 'recordedBy',
  identified_by: 'identifiedBy',
  locality: 'locality',
};

export function convertToDwc(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[DWC_FIELD_MAP[k] ?? k] = v;
  }
  return out;
}
