/**
 * Options shared by the three record-duplication helpers.
 *
 * Duplicating is "start the next one from this one" — the next plot in a
 * series, the next visit to the same site. It carries the setup, not the
 * observations: a copy that silently inherited the previous survey's counts,
 * photos, GPS fix and track would be a fabricated record. That is the same
 * reasoning `duplicateSpecimen` (src/db/collections.ts) already follows.
 *
 * A byte-for-byte copy is a different operation and already exists: export the
 * record and re-import it with 另存新副本.
 */
export type DuplicateRecordOptions = {
  /** plotid / session name / trip name for the copy. Caller pre-fills it with
   *  `nextRecordName` and is responsible for the collision warning. */
  name: string;
  /** Survey setup + environmental values (layers, subplots, cover, terrain…). */
  includeEnv: boolean;
  /** The species LIST only — taxon plus its layer / subplot slot. */
  includeSpecies: boolean;
  /** Leave the copy open for recording (and close whatever was open before). */
  activate: boolean;
};
