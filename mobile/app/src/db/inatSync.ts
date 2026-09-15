/**
 * iNaturalist upload bookkeeping on the three record tables (v30 columns).
 *
 * Three writes, in the order the upload driver reaches them, so a crash at any
 * point leaves a row that says exactly how far it got:
 *   markInatObservation → the observation exists on the server (id known)
 *   markInatMediaDone   → the first n media items were accepted
 *   markInatUploaded    → everything is up
 *
 * Table names come from the literal map below, never from input — the same
 * justification as `columnsOf` in migrations.ts.
 */
import { getUserDb } from './init';
import type { RecordKind } from './records_list';

const TABLE: Record<RecordKind, string> = {
  session: 'checklist_records',
  plot: 'plot_species_records',
  collection: 'collection_specimens',
};

export function markInatObservation(kind: RecordKind, id: number, observationId: number): void {
  getUserDb().executeSync(
    `UPDATE ${TABLE[kind]} SET inat_observation_id = ?, inat_media_done = 0, inat_uploaded_at = NULL WHERE id = ?`,
    [observationId, id],
  );
}

export function markInatMediaDone(kind: RecordKind, id: number, n: number): void {
  getUserDb().executeSync(`UPDATE ${TABLE[kind]} SET inat_media_done = ? WHERE id = ?`, [n, id]);
}

export function markInatUploaded(kind: RecordKind, id: number, syncHash: string | null = null): void {
  getUserDb().executeSync(`UPDATE ${TABLE[kind]} SET inat_uploaded_at = ?, inat_sync_hash = ? WHERE id = ?`, [
    Date.now(),
    syncHash,
    id,
  ]);
}
