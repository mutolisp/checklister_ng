dwc_field_map = {
    "taxon_id": "taxonID",
    # 名稱使用（mobile v28 起）。taxonID 是分類概念，scientificName 是這筆記錄
    # 實際採用的名字——可能是本地名錄視為 not-accepted / misapplied 的名字，
    # 因為分類見解本來就會分歧。後三個欄位把這件事寫明，而不是讓讀的人誤以為
    # 用的是接受名。acceptedNameUsageID 依 DwC 規定與 taxonID 同一個識別碼空間。
    "used_name_id": "scientificNameID",
    "used_status": "taxonomicStatus",
    "accepted_name": "acceptedNameUsage",
    "accepted_taxon_id": "acceptedNameUsageID",
    "name": "scientificName",
    "fullname": "scientificNameAuthorship",
    "cname": "vernacularName",
    "alternative_name_c": "alternativeVernacularName",
    "family": "family",
    "family_cname": "familyVernacularName",
    "family_c": "familyVernacularName",
    "pt_name": "higherClassification",
    "kingdom": "kingdom",
    "kingdom_c": "kingdomVernacularName",
    "phylum": "phylum",
    "phylum_c": "phylumVernacularName",
    "class_name": "class",
    "class_c": "classVernacularName",
    "order": "order",
    "order_c": "orderVernacularName",
    "genus": "genus",
    "genus_c": "genusVernacularName",
    "abundance": "individualCount",
    "source": "establishmentMeans",
    "iucn_category": "iucnRedListCategory",
    "redlist": "nationalRedListCategory",
    "cites": "CITES",
    "protected": "protectionStatus",
    "endemic": "endemic",
    "is_hybrid": "isHybrid",
    "nomenclature_name": "nomenclaturalCode",
    "is_terrestrial": "isTerrestrial",
    "is_freshwater": "isFreshwater",
    "is_brackish": "isBrackish",
    "is_marine": "isMarine",
    "alien_status_note": "establishmentRemarks",
    "occurrenceID": "occurrenceID",
    "eventDate": "eventDate",
    "modified": "modified",
}

def convert_to_dwc(obj: dict) -> dict:
    return {dwc_field_map.get(k, k): v for k, v in obj.items()}
