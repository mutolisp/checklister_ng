import { getUserDb, getTaicolDb } from './init';

export type ChecklistRecord = {
  id: number;
  session_id: number;
  taxon_id: string;
  observed_at: number;
  notes: string | null;
  photo_paths: string | null;
  lat: number | null;
  lng: number | null;
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
  phylum: string;
  class: string;
  order: string;
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
       (session_id, taxon_id, observed_at, notes, lat, lng,
        organism_quantity, organism_quantity_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.session_id,
      input.taxon_id,
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
): void {
  const db = getUserDb();
  db.executeSync(`UPDATE checklist_records SET lat = ?, lng = ? WHERE id = ?`, [lat, lng, id]);
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
    `SELECT id, session_id, taxon_id, observed_at, notes, photo_paths, lat, lng,
            sex, life_stage, reproductive_condition, leaf_phenology,
            organism_quantity, organism_quantity_type
     FROM checklist_records WHERE session_id = ? ORDER BY observed_at ASC`,
    [sessionId],
  );
  const records = (recordsRes.rows ?? []) as unknown as ChecklistRecord[];
  if (records.length === 0) return [];

  const taxonIds = records.map((r) => r.taxon_id);
  const placeholders = taxonIds.map(() => '?').join(',');
  const taxaRes = taicolDb.executeSync(
    `SELECT taxon_id, simple_name, name_author, common_name_c, alternative_name_c,
            family, family_c, rank,
            is_endemic, alien_type, redlist, iucn, cites, protected, is_hybrid,
            kingdom, phylum, class, "order"
     FROM taicol_names
     WHERE taxon_id IN (${placeholders}) AND usage_status = 'accepted'`,
    taxonIds,
  );
  const taxonMap = new Map<string, Record<string, unknown>>();
  for (const row of (taxaRes.rows ?? []) as Array<Record<string, unknown>>) {
    taxonMap.set(row.taxon_id as string, row);
  }

  return records.map((r) => {
    const t = taxonMap.get(r.taxon_id) ?? {};
    return {
      ...r,
      simple_name: (t.simple_name as string) ?? '',
      name_author: (t.name_author as string) ?? '',
      common_name_c: (t.common_name_c as string) ?? '',
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
      phylum: (t.phylum as string) ?? '',
      class: (t.class as string) ?? '',
      order: (t.order as string) ?? '',
    };
  });
}

export function isTaxonInSession(sessionId: number, taxonId: string): boolean {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT 1 FROM checklist_records WHERE session_id = ? AND taxon_id = ? LIMIT 1`,
    [sessionId, taxonId],
  );
  return (res.rows?.length ?? 0) > 0;
}
