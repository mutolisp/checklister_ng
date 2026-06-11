import { getUserDb, getTaicolDb } from './init';
import { generateUuid } from './plots';
import {
  getEnabledRegions,
  isJpTaxonId,
  regionOfTaxonId,
  crossRegionVernacular,
  composeVernacular,
} from './regions';

export type ChecklistRecord = {
  id: number;
  session_id: number;
  taxon_id: string;
  /** DwC occurrenceID — stable v4 uuid assigned at insert. */
  occurrence_id: string;
  observed_at: number;
  notes: string | null;
  photo_paths: string | null;
  lat: number | null;
  lng: number | null;
  /** GPS horizontal accuracy in metres, from `Location.getCurrentPositionAsync`.
   *  Maps to DwC `coordinateUncertaintyInMeters` on export. */
  accuracy: number | null;
  // DwC species attributes (v8). Persisted as enum strings; UI maps to 中文.
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
  // DwC abundance generalization (v9).
  organism_quantity: string | null;
  organism_quantity_type: string | null;
};

export type RecordWithTaxon = ChecklistRecord & {
  simple_name: string;
  name_author: string;
  common_name_c: string;
  alternative_name_c: string;
  family: string;
  family_c: string;
  rank: string;
  is_endemic: string;
  alien_type: string;
  redlist: string;
  iucn: string;
  cites: string;
  protected: string;
  is_hybrid: string;
  kingdom: string;
  kingdom_c: string;
  phylum: string;
  phylum_c: string;
  class: string;
  class_c: string;
  order: string;
  order_c: string;
  genus: string;
  genus_c: string;
  is_terrestrial: string;
  is_freshwater: string;
  is_brackish: string;
  is_marine: string;
  is_fossil: string;
};

export type CreateRecordInput = {
  session_id: number;
  taxon_id: string;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  organism_quantity?: string | null;
  organism_quantity_type?: string | null;
};

export function addRecord(input: CreateRecordInput): number {
  const db = getUserDb();
  const res = db.executeSync(
    `INSERT INTO checklist_records
       (session_id, taxon_id, occurrence_id, observed_at, notes, lat, lng,
        organism_quantity, organism_quantity_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.session_id,
      input.taxon_id,
      generateUuid(),
      Date.now(),
      input.notes ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.organism_quantity ?? null,
      input.organism_quantity_type ?? null,
    ],
  );
  return res.insertId ?? 0;
}

export function updateRecordQuantity(
  id: number,
  quantity: string | null,
  type: string | null,
): void {
  const db = getUserDb();
  db.executeSync(
    `UPDATE checklist_records SET organism_quantity = ?, organism_quantity_type = ? WHERE id = ?`,
    [quantity, type, id],
  );
}

export function deleteRecord(id: number): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM checklist_records WHERE id = ?`, [id]);
}

export function updateRecordNotes(id: number, notes: string | null): void {
  const db = getUserDb();
  db.executeSync(`UPDATE checklist_records SET notes = ? WHERE id = ?`, [notes, id]);
}

export function updateRecordLocation(
  id: number,
  lat: number | null,
  lng: number | null,
  accuracy: number | null = null,
): void {
  const db = getUserDb();
  db.executeSync(
    `UPDATE checklist_records SET lat = ?, lng = ?, accuracy = ? WHERE id = ?`,
    [lat, lng, accuracy, id],
  );
}

export type RecordAttributePatch = Partial<{
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
}>;

const ATTR_COLS = ['sex', 'life_stage', 'reproductive_condition', 'leaf_phenology'] as const;

export function updateRecordAttributes(id: number, patch: RecordAttributePatch): void {
  const db = getUserDb();
  const sets: string[] = [];
  const args: (string | null)[] = [];
  for (const c of ATTR_COLS) {
    if (c in patch) {
      sets.push(`${c} = ?`);
      args.push(patch[c] ?? null);
    }
  }
  if (sets.length === 0) return;
  db.executeSync(`UPDATE checklist_records SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
}

export function parsePhotoPaths(s: string | null): string[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    // ignore
  }
  return [];
}

export function updateRecordPhotos(id: number, paths: string[]): void {
  const db = getUserDb();
  const value = paths.length > 0 ? JSON.stringify(paths) : null;
  db.executeSync(`UPDATE checklist_records SET photo_paths = ? WHERE id = ?`, [value, id]);
}

export function listSessionRecords(sessionId: number): RecordWithTaxon[] {
  const userDb = getUserDb();
  const taicolDb = getTaicolDb();

  const recordsRes = userDb.executeSync(
    `SELECT id, session_id, taxon_id, occurrence_id, observed_at, notes, photo_paths, lat, lng, accuracy,
            sex, life_stage, reproductive_condition, leaf_phenology,
            organism_quantity, organism_quantity_type
     FROM checklist_records WHERE session_id = ? ORDER BY observed_at ASC`,
    [sessionId],
  );
  const records = (recordsRes.rows ?? []) as unknown as ChecklistRecord[];
  if (records.length === 0) return [];

  const taxonIds = records.map((r) => r.taxon_id);
  // Resolve names by querying each dataset's real table directly (indexed on
  // taxon_id) — split by the 't…'/'y…' prefix. We deliberately avoid a
  // taicol∪ylist UNION view: joining/scanning it materializes ~270k rows and
  // costs seconds. All-Taiwan sessions only touch taicol_names (unchanged).
  const TAXON_COLS = `taxon_id, simple_name, name_author, common_name_c, alternative_name_c,
            family, family_c, rank,
            is_endemic, alien_type, redlist, iucn, cites, protected, is_hybrid,
            kingdom, kingdom_c, phylum, phylum_c, class, class_c, "order", order_c, genus, genus_c,
            is_terrestrial, is_freshwater, is_brackish, is_marine, is_fossil`;
  const taxonMap = new Map<string, Record<string, unknown>>();
  const fillFrom = (tbl: string, ids: string[]) => {
    if (ids.length === 0) return;
    const ph = ids.map(() => '?').join(',');
    const res = taicolDb.executeSync(
      `SELECT ${TAXON_COLS} FROM ${tbl} WHERE taxon_id IN (${ph}) AND usage_status = 'accepted'`,
      ids,
    );
    for (const row of (res.rows ?? []) as Array<Record<string, unknown>>) {
      taxonMap.set(row.taxon_id as string, row);
    }
  };
  fillFrom('taicol_names', taxonIds.filter((id) => !isJpTaxonId(id)));
  fillFrom('ylist_names', taxonIds.filter(isJpTaxonId));

  // When Japan is enabled, merge the cross-region vernacular into common_name_c
  // so every downstream display + export shows e.g. "糯米條 / タイワンツクバネウツギ"
  // for shared species, or the lone 和名 for Japan-only ones. Skipped entirely
  // when only ['TW'] is enabled — common_name_c stays exactly as TaiCOL has it.
  const regions = getEnabledRegions();
  const cross = regions.includes('JP')
    ? crossRegionVernacular(taxonIds, regions)
    : null;

  return records.map((r) => {
    const t = taxonMap.get(r.taxon_id) ?? {};
    const ownCname = (t.common_name_c as string) ?? '';
    const common_name_c = cross
      ? composeVernacular(ownCname, regionOfTaxonId(r.taxon_id), cross.get(r.taxon_id), regions)
      : ownCname;
    return {
      ...r,
      simple_name: (t.simple_name as string) ?? '',
      name_author: (t.name_author as string) ?? '',
      common_name_c,
      alternative_name_c: (t.alternative_name_c as string) ?? '',
      family: (t.family as string) ?? '',
      family_c: (t.family_c as string) ?? '',
      rank: (t.rank as string) ?? '',
      is_endemic: (t.is_endemic as string) ?? '',
      alien_type: (t.alien_type as string) ?? '',
      redlist: (t.redlist as string) ?? '',
      iucn: (t.iucn as string) ?? '',
      cites: (t.cites as string) ?? '',
      protected: (t.protected as string) ?? '',
      is_hybrid: (t.is_hybrid as string) ?? '',
      kingdom: (t.kingdom as string) ?? '',
      kingdom_c: (t.kingdom_c as string) ?? '',
      phylum: (t.phylum as string) ?? '',
      phylum_c: (t.phylum_c as string) ?? '',
      class: (t.class as string) ?? '',
      class_c: (t.class_c as string) ?? '',
      order: (t.order as string) ?? '',
      order_c: (t.order_c as string) ?? '',
      genus: (t.genus as string) ?? '',
      genus_c: (t.genus_c as string) ?? '',
      is_terrestrial: (t.is_terrestrial as string) ?? '',
      is_freshwater: (t.is_freshwater as string) ?? '',
      is_brackish: (t.is_brackish as string) ?? '',
      is_marine: (t.is_marine as string) ?? '',
      is_fossil: (t.is_fossil as string) ?? '',
    };
  });
}

/** Most recent `observed_at` (Date.now() millis) of any record in the
 *  session, or null if the session has no records. Used by
 *  `StaleSessionWatcher` to compute the activity baseline. */
export function latestSessionActivityAt(sessionId: number): number | null {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT MAX(observed_at) AS ts FROM checklist_records WHERE session_id = ?`,
    [sessionId],
  );
  const row = (res.rows ?? [])[0] as { ts: number | null } | undefined;
  return row?.ts ?? null;
}

export function isTaxonInSession(sessionId: number, taxonId: string): boolean {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT 1 FROM checklist_records WHERE session_id = ? AND taxon_id = ? LIMIT 1`,
    [sessionId, taxonId],
  );
  return (res.rows?.length ?? 0) > 0;
}
