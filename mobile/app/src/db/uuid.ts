/**
 * RFC-4122 v4 UUIDs backed by SQLite's CSPRNG.
 *
 * Replaces two byte-identical `Math.random()` implementations that lived in
 * `plots.ts` and `photoCapture.ts`. Entropy was not really the problem — the
 * problem is that Hermes' `Math.random()` is a non-cryptographic PRNG with
 * unspecified seeding, and these values become DwC `occurrenceID`s that get
 * published in exports and are meant to be globally unique forever.
 *
 * `randomblob()` is the same source the v16 backfill already used to mint
 * occurrence_ids for legacy rows (`migrations.ts`), so runtime and migration
 * now agree instead of the migration being the stronger of the two. It also
 * avoids adding a native module (expo-crypto), which would force another
 * native rebuild.
 */
import { getUserDb } from './init';

/** Variant bits are fixed to 8/9/a/b and version to 4, per RFC 4122 §4.4. */
const UUID_EXPR = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
  substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' ||
  hex(randomblob(6))
)`;

export function generateUuid(): string {
  const res = getUserDb().executeSync(`SELECT ${UUID_EXPR} AS u;`);
  const u = (res.rows?.[0] as { u?: string } | undefined)?.u;
  if (!u) throw new Error('generateUuid: SQLite returned no value');
  return u;
}
