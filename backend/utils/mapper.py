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
    # scientificNameAuthorship 依 TDWG 定義是「命名者資訊」，範例為
    # `(Torr.) J.T. Howell`——只有命名者。顯示用的 fullname（學名+命名者）
    # 過去對應到這裡，導致每一格命名者欄都重複整個學名。
    "name_author": "scientificNameAuthorship",
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
    # 臺灣紅皮書 → Distribution 擴充的 threatStatus（http://iucn.org/terms/threatStatus）。
    # 全球 IUCN 維持自訂欄名：兩者同時存在，扁平 CSV 放不下兩個 threatStatus。
    "redlist": "threatStatus",
    # GBIF Distribution 擴充詞彙（rs.gbif.org/terms/1.0/appendixCITES）；
    # 原本的 "CITES" 全大寫既非 DwC 也不合 camelCase 慣例。
    "cites": "appendixCITES",
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

# 僅供文件排版/排序的欄位，沒有 DwC 詞彙，不可原樣變成欄位
# （未對應的 key 會原樣穿透）。
DISPLAY_ONLY = {"fullname"}


def convert_to_dwc(obj: dict) -> dict:
    return {
        dwc_field_map.get(k, k): v
        for k, v in obj.items()
        if k not in DISPLAY_ONLY
    }
