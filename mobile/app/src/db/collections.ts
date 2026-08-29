/**
 * Specimen collection (標本採集): a collection trip groups the specimens
 * gathered on one outing, mirroring how `sessions` groups `checklist_records`.
 *
 * ⚠️ Collections deliberately sit OUTSIDE the app-wide single-active invariant.
 * `status` here is collection-local — it only decides which trip an "add to
 * collection" lands in. Nothing in this file touches `sessions` or
 * `plot_surveys`, so starting or reopening a trip never ends an active checklist
 * or plot survey. See `recordCreate.ensureNoConflictingActive` for the invariant
 * that governs those two.
 */
import { getUserDb } from './init';
import { generateUuid } from './plots';
import { defaultSurveyorString } from './surveyors';
import { resolveTaxa, EMPTY_TAXON_FIELDS, type TaxonFields } from './taxonLookup';

export type CollectionTrip = {
  id: number;
  uuid: string;
  name: string;
  project_id: number;
  /** Collection-local only — never gates a session/plot. */
  status: 'active' | 'done';
  started_at: number;
  ended_at: number | null;
  /** DwC recordedBy — comma-separated collector names. Inherited by specimens. */
  recorded_by: string | null;
  locality: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type CollectionTripWithStats = CollectionTrip & {
  specimen_count: number;
  project_name: string;
};

export type Specimen = {
  id: number;
  trip_id: number;
  /** DwC occurrenceID — stable v4 uuid assigned at insert. */
  occurrence_id: string;
  taxon_id: string;
  /** DwC recordNumber — the collector's number, prefix included. Editable. */
  record_number: string;
  /** Numeric tail of `record_number`, or null when the user typed a
   *  non-numeric one. Drives `nextRecordNumber`. */
  record_number_seq: number | null;
  collected_at: number;
  recorded_by: string | null;
  lat: number | null;
  lng: number | null;
  /** GPS horizontal accuracy in metres → DwC coordinateUncertaintyInMeters. */
  accuracy: number | null;
  locality: string | null;
  // DwC species attributes (v20 for sex/life_stage, v19 for the phenology
  // pair). Single-valued enums; the two phenology columns are JSON array
  // strings — see dwcAttributes parse/serializeMultiAttribute.
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  leaf_phenology: string | null;
  notes: string | null;
  photo_paths: string | null;
};

export type SpecimenWithTaxon = Specimen & TaxonFields;

const SPECIMEN_COLS = `id, trip_id, occurrence_id, taxon_id, record_number, record_number_seq,
  collected_at, recorded_by, lat, lng, accuracy, locality,
  sex, life_stage, reproductive_condition, leaf_phenology, notes, photo_paths`;

function defaultTripName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ─────────────────────────────── trips ───────────────────────────────

export function listCollectionTrips(): CollectionTripWithStats[] {
  const db = getUserDb();
  const res = db.executeSync(`
    SELECT c.*,
           p.name AS project_name,
           (SELECT COUNT(*) FROM collection_specimens s WHERE s.trip_id = c.id) AS specimen_count
    FROM collection_trips c
    JOIN projects p ON p.id = c.project_id
    ORDER BY c.started_at DESC
  `);
  return ((res.rows ?? []) as unknown) as CollectionTripWithStats[];
}

export function getCollectionTrip(id: number): CollectionTrip | null {
  const db = getUserDb();
  const res = db.executeSync(`SELECT * FROM collection_trips WHERE id = ?`, [id]);
  return ((res.rows ?? []) as unknown as CollectionTrip[])[0] ?? null;
}

/** The trip an "add to collection" lands in, or null when none is open. */
export function getActiveCollectionTrip(): CollectionTrip | null {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM collection_trips WHERE status = 'active' ORDER BY started_at DESC LIMIT 1`,
  );
  return ((res.rows ?? []) as unknown as CollectionTrip[])[0] ?? null;
}

export type CreateTripInput = {
  name?: string;
  project_id?: number;
  locality?: string | null;
  /** Omit to auto-fill from default surveyors; pass null to force empty. */
  recorded_by?: string | null;
};

export function createCollectionTrip(input: CreateTripInput = {}): number {
  const db = getUserDb();
  const now = Date.now();
  // Only one OPEN trip at a time, so "加入採集" has an unambiguous target.
  // Scoped to collection_trips on purpose — see the file header.
  db.executeSync(
    `UPDATE collection_trips SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE status = 'active'`,
    [now, now],
  );
  const res = db.executeSync(
    `INSERT INTO collection_trips
       (uuid, name, project_id, status, started_at, recorded_by, locality, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [
      generateUuid(),
      input.name ?? defaultTripName(),
      input.project_id ?? 0,
      now,
      input.recorded_by !== undefined ? input.recorded_by : defaultSurveyorString(),
      input.locality ?? null,
      now,
      now,
    ],
  );
  return res.insertId ?? 0;
}

export function endCollectionTrip(id: number): void {
  const db = getUserDb();
  const now = Date.now();
  db.executeSync(
    `UPDATE collection_trips SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

export function reopenCollectionTrip(id: number): void {
  const db = getUserDb();
  const now = Date.now();
  db.executeSync(
    `UPDATE collection_trips SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE status = 'active' AND id != ?`,
    [now, now, id],
  );
  db.executeSync(
    `UPDATE collection_trips SET status = 'active', ended_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id],
  );
}

const TRIP_UPDATABLE_KEYS = new Set([
  'name', 'project_id', 'recorded_by', 'locality', 'notes',
]);

export function updateCollectionTrip(id: number, patch: Partial<CollectionTrip>): void {
  const db = getUserDb();
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!TRIP_UPDATABLE_KEYS.has(k)) continue;
    fields.push(`${k} = ?`);
    params.push(v as string | number | null);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  params.push(Date.now(), id);
  db.executeSync(`UPDATE collection_trips SET ${fields.join(', ')} WHERE id = ?`, params);
}

export function deleteCollectionTrip(id: number): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM collection_trips WHERE id = ?`, [id]);
}

// ───────────────────────── collection numbers ─────────────────────────

/** Read a settings row directly so the DB layer stays decoupled from the React
 *  store — same approach as `regions.getEnabledRegions`. */
function readSetting(key: string): string | null {
  try {
    const res = getUserDb().executeSync(`SELECT value FROM settings WHERE key = ? LIMIT 1`, [key]);
    return ((res.rows ?? [])[0] as { value?: string } | undefined)?.value ?? null;
  } catch {
    return null;
  }
}

/** Trailing digits of a collection number, e.g. "CTL-1042" → 1042. */
export function recordNumberSeq(text: string): number | null {
  const m = text.trim().match(/(\d+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Is this collection number already on another specimen?
 *
 * Checked against the full text (prefix included) and globally, because the
 * series spans trips — `CTL-1042` means one physical gathering no matter which
 * outing it came from. `excludeId` skips the specimen being edited so re-saving
 * an unchanged number doesn't flag itself.
 */
export function isRecordNumberTaken(text: string, excludeId?: number): boolean {
  const value = text.trim();
  if (!value) return false;
  const db = getUserDb();
  const res =
    excludeId === undefined
      ? db.executeSync(`SELECT 1 FROM collection_specimens WHERE record_number = ? LIMIT 1`, [value])
      : db.executeSync(
          `SELECT 1 FROM collection_specimens WHERE record_number = ? AND id != ? LIMIT 1`,
          [value, excludeId],
        );
  return (res.rows?.length ?? 0) > 0;
}

/** Numbers currently carried by more than one specimen, for the ⚠ badge.
 *  One grouped query per reload rather than a per-row lookup. */
export function duplicateRecordNumbers(): Set<string> {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT record_number FROM collection_specimens
      GROUP BY record_number HAVING COUNT(*) > 1`,
  );
  const out = new Set<string>();
  for (const row of (res.rows ?? []) as Array<{ record_number?: string }>) {
    if (row.record_number) out.add(row.record_number);
  }
  return out;
}

/** Hard stop for the scan below. Only reachable with pathological data (tens of
 *  thousands of consecutive numbers already taken); returning the last candidate
 *  is better than hanging the UI thread. */
const MAX_NUMBER_SCAN = 10000;

/**
 * Next free collection number in the collector's global series.
 *
 * Derived from the highest number actually stored rather than a saved cursor,
 * so deleting or importing specimens can't leave the counter drifting. The
 * configured start acts as a floor, which is what lets someone resume an
 * existing career series (set start = 1042 on a fresh install).
 *
 * Occupied numbers are skipped, so every automatic path (new specimen,
 * duplicate, import) is collision-free by construction — a hand-typed number is
 * the only way to create a duplicate, and that path warns.
 */
export function nextRecordNumber(): { text: string; seq: number } {
  const db = getUserDb();
  const res = db.executeSync(`SELECT MAX(record_number_seq) AS m FROM collection_specimens`);
  const maxSeq = Number((res.rows?.[0] as { m?: number | null })?.m ?? 0);
  const start = Number(readSetting('collection_number_start') ?? '1') || 1;
  const prefix = readSetting('collection_number_prefix') ?? '';

  let seq = Math.max(maxSeq + 1, start);
  for (let i = 0; i < MAX_NUMBER_SCAN && isRecordNumberTaken(`${prefix}${seq}`); i++) {
    seq += 1;
  }
  return { text: `${prefix}${seq}`, seq };
}

// ───────────────────────────── specimens ─────────────────────────────

export function listSpecimens(tripId: number): SpecimenWithTaxon[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT ${SPECIMEN_COLS} FROM collection_specimens WHERE trip_id = ? ORDER BY collected_at ASC, id ASC`,
    [tripId],
  );
  const rows = (res.rows ?? []) as unknown as Specimen[];
  if (rows.length === 0) return [];
  const taxa = resolveTaxa(rows.map((r) => r.taxon_id));
  return rows.map((r) => ({ ...r, ...(taxa.get(r.taxon_id) ?? EMPTY_TAXON_FIELDS) }));
}

export function getSpecimen(id: number): SpecimenWithTaxon | null {
  const db = getUserDb();
  const res = db.executeSync(`SELECT ${SPECIMEN_COLS} FROM collection_specimens WHERE id = ?`, [id]);
  const row = ((res.rows ?? []) as unknown as Specimen[])[0];
  if (!row) return null;
  const taxa = resolveTaxa([row.taxon_id]);
  return { ...row, ...(taxa.get(row.taxon_id) ?? EMPTY_TAXON_FIELDS) };
}

export type AddSpecimenInput = {
  trip_id: number;
  taxon_id: string;
  /** Omit to take the next number in the series. */
  record_number?: string;
  collected_at?: number;
  /** Omit to inherit the trip's collectors. */
  recorded_by?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  locality?: string | null;
  notes?: string | null;
};

export function addSpecimen(input: AddSpecimenInput): number {
  const db = getUserDb();
  const now = Date.now();
  const number = input.record_number ?? nextRecordNumber().text;
  const trip = input.recorded_by === undefined ? getCollectionTrip(input.trip_id) : null;
  const res = db.executeSync(
    `INSERT INTO collection_specimens
       (trip_id, occurrence_id, taxon_id, record_number, record_number_seq,
        collected_at, recorded_by, lat, lng, accuracy, locality, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.trip_id,
      generateUuid(),
      input.taxon_id,
      number,
      recordNumberSeq(number),
      input.collected_at ?? now,
      input.recorded_by !== undefined ? input.recorded_by : (trip?.recorded_by ?? null),
      input.lat ?? null,
      input.lng ?? null,
      input.accuracy ?? null,
      input.locality ?? null,
      input.notes ?? null,
      now,
    ],
  );
  return res.insertId ?? 0;
}

// `taxon_id` is updatable on purpose: re-identifying a specimen is routine
// herbarium work, and the collection number identifies the physical gathering,
// not the determination — so the number stays put while the name changes.
const SPECIMEN_UPDATABLE_KEYS = new Set([
  'taxon_id', 'record_number', 'collected_at', 'recorded_by', 'lat', 'lng', 'accuracy',
  'locality', 'sex', 'life_stage', 'reproductive_condition', 'leaf_phenology', 'notes',
]);

export function updateSpecimen(id: number, patch: Partial<Specimen>): void {
  const db = getUserDb();
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!SPECIMEN_UPDATABLE_KEYS.has(k)) continue;
    fields.push(`${k} = ?`);
    params.push(v as string | number | null);
    // Keep the numeric tail in sync so the series continues from a hand-edit.
    if (k === 'record_number') {
      fields.push('record_number_seq = ?');
      params.push(recordNumberSeq(String(v ?? '')));
    }
  }
  if (fields.length === 0) return;
  params.push(id);
  db.executeSync(`UPDATE collection_specimens SET ${fields.join(', ')} WHERE id = ?`, params);
}

export function updateSpecimenLocation(
  id: number,
  lat: number,
  lng: number,
  accuracy: number | null = null,
): void {
  const db = getUserDb();
  db.executeSync(
    `UPDATE collection_specimens SET lat = ?, lng = ?, accuracy = ? WHERE id = ?`,
    [lat, lng, accuracy, id],
  );
}

export function updateSpecimenPhotos(id: number, paths: string[]): void {
  const db = getUserDb();
  const value = paths.length > 0 ? JSON.stringify(paths) : null;
  db.executeSync(`UPDATE collection_specimens SET photo_paths = ? WHERE id = ?`, [value, id]);
}

/**
 * Start a second gathering of the same taxon — the swipe-left 複製 action.
 *
 * Carries the species and the collector only. Locality, coordinates, phenology,
 * notes and photos are deliberately left blank: they describe one physical
 * gathering, and silently inheriting them would attach the previous specimen's
 * description to a different plant. Number and time take their defaults (next
 * free number, now).
 *
 * Returns the new specimen's id, or null if the source is gone.
 */
export function duplicateSpecimen(id: number): number | null {
  const source = getSpecimen(id);
  if (!source) return null;
  return addSpecimen({
    trip_id: source.trip_id,
    taxon_id: source.taxon_id,
    recorded_by: source.recorded_by,
  });
}

export function deleteSpecimen(id: number): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM collection_specimens WHERE id = ?`, [id]);
}
