dwc_field_map = {
    "id": "taxonID",
    "name": "scientificName",
    "fullname": "scientificNameAuthorship",
    "cname": "vernacularName",
    "family": "family",
    # Darwin Core uses "vernacular". Fix a long-standing typo here.
    "family_cname": "familyVernacularName",
    "pt_name": "higherClassification",
    "source": "establishmentMeans",
    "iucn_category": "iucnStatus",
    "endemic": "endemic",
    "occurrenceID": "occurrenceID",
    "eventDate": "eventDate",
    "modified": "modified"
}

def convert_to_dwc(obj: dict) -> dict:
    return {dwc_field_map.get(k, k): v for k, v in obj.items()}
