/**
 * One-shot DB cleanup tasks run from `initDb()` after migrations.
 *
 * `enforceSingleActiveOnStartup` mops up leftover multi-active records from
 * before single-active-enforcement was added; `purgeOrphanRows` clears child
 * rows stranded by deletes that relied on an inert ON DELETE CASCADE.
 * Both idempotent — running on a clean DB is a no-op.
 */
import { File, Paths } from 'expo-file-system';
import { getTaicolDb, getUserDb } from './init';

/**
 * Enforce the single-active invariant at app start.
 *
 * Steps:
 *   1. Per-kind: keep the most recently started active record; force-end
 *      every other open session / plot.
 *   2. Cross-kind: if both a session AND a plot are still active, end the
 *      one with the older start time.
 *
 * Run idempotently — second invocation on the same data ends nothing.
 */
export function enforceSingleActiveOnStartup(): void {
  const db = getUserDb();
  const now = Date.now();

  // ── Step 1a: keep latest active session ────────────────────────────────
  db.executeSync(
    `UPDATE sessions
        SET ended_at = ?
      WHERE ended_at IS NULL
        AND id NOT IN (
          SELECT id FROM sessions
           WHERE ended_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
        )`,
    [now],
  );

  // ── Step 1b: keep latest active plot ───────────────────────────────────
  db.executeSync(
    `UPDATE plot_surveys
        SET status = 'done',
            stop_ts = COALESCE(stop_ts, ?),
            updated_at = ?
      WHERE status = 'active'
        AND id NOT IN (
          SELECT id FROM plot_surveys
           WHERE status = 'active'
           ORDER BY COALESCE(start_ts, created_at) DESC
           LIMIT 1
        )`,
    [now, now],
  );

  // ── Step 2: cross-kind exclusion ───────────────────────────────────────
  const sessRes = db.executeSync(
    `SELECT id, started_at FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  );
  const sessRow = (sessRes.rows?.[0] ?? null) as { id: number; started_at: number } | null;

  const plotRes = db.executeSync(
    `SELECT id, COALESCE(start_ts, created_at) AS ts FROM plot_surveys WHERE status = 'active' ORDER BY ts DESC LIMIT 1`,
  );
  const plotRow = (plotRes.rows?.[0] ?? null) as { id: number; ts: number } | null;

  if (!sessRow || !plotRow) return;

  if (sessRow.started_at >= plotRow.ts) {
    // Session is newer → end the plot.
    db.executeSync(
      `UPDATE plot_surveys SET status = 'done', stop_ts = COALESCE(stop_ts, ?), updated_at = ? WHERE id = ?`,
      [now, now, plotRow.id],
    );
  } else {
    // Plot is newer → end the session.
    db.executeSync(`UPDATE sessions SET ended_at = ? WHERE id = ?`, [now, sessRow.id]);
  }
}

/** Prefix for the automatic pre-repair snapshots. */
const SAFETY_PREFIX = 'safety-backup-';

/**
 * Consistent snapshot of user.db, written next to it in the document dir.
 *
 * Uses `VACUUM INTO` rather than `createBackup()` for two reasons: that helper
 * lives in `~/lib/backup` which imports from `~/db` (circular from here), and
 * it base64s the whole DB into a JS string — far too heavy for the cold-start
 * path (see the field-use constraints: nothing expensive on startup).
 *
 * Returns the file name, or null if the snapshot could not be taken — a failed
 * snapshot must never block the repair, but the caller logs it.
 */
function createSafetySnapshot(): string | null {
  try {
    const name = `${SAFETY_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const dest = new File(Paths.document, name);
    if (dest.exists) dest.delete();
    // VACUUM INTO needs a plain filesystem path, not a file:// URI.
    getUserDb().executeSync('VACUUM INTO ?;', [dest.uri.replace(/^file:\/\//, '')]);
    return name;
  } catch (e) {
    if (__DEV__) console.warn('[cleanup] safety snapshot failed:', e);
    return null;
  }
}

/** Snapshots taken before an automatic repair, newest first. */
export function listSafetyBackups(): { name: string; uri: string; size: number }[] {
  try {
    return Paths.document
      .list()
      .filter((f): f is File => f instanceof File && f.name.startsWith(SAFETY_PREFIX))
      .map((f) => ({ name: f.name, uri: f.uri, size: f.size ?? 0 }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/**
 * Delete child rows whose parent is gone, and null out dangling references.
 *
 * Why these exist: every `ON DELETE CASCADE` in the schema is inert, because
 * `PRAGMA foreign_keys` is never set when the connection opens and op-sqlite
 * does not define `SQLITE_DEFAULT_FOREIGN_KEYS`, so SQLite uses its default of
 * OFF. Deleting a trip / session / plot therefore left every child row behind.
 * The delete helpers now remove children explicitly, but rows stranded by
 * earlier builds are still sitting in existing users' databases.
 *
 * The visible symptom this fixes: orphaned `collection_specimens` still count
 * toward `maxRecordNumberSeq()` and `isRecordNumberTaken()`, so collection
 * numbers kept climbing past specimens the user had already deleted, and the
 * number could not be reset back down.
 *
 * Idempotent: a second run finds nothing.
 */
export function purgeOrphanRows(): void {
  const db = getUserDb();

  // Declared ON DELETE CASCADE → the parent is gone, so the child must go too.
  const orphanDeletes: Array<[string, string]> = [
    ['collection_specimens', 'trip_id NOT IN (SELECT id FROM collection_trips)'],
    ['checklist_records', 'session_id NOT IN (SELECT id FROM sessions)'],
    ['plot_species_records', 'plot_survey_id NOT IN (SELECT id FROM plot_surveys)'],
    ['plot_survey_layers', 'plot_survey_id NOT IN (SELECT id FROM plot_surveys)'],
    ['subplot_layers', 'subplot_id NOT IN (SELECT id FROM plot_subplots)'],
    ['plot_subplots', 'plot_survey_id NOT IN (SELECT id FROM plot_surveys)'],
  ];
  for (const [table, where] of orphanDeletes) {
    // subplot_layers is listed before plot_subplots so it is evaluated against
    // the still-populated parent table, matching the delete order elsewhere.
    db.executeSync(`DELETE FROM ${table} WHERE ${where};`);
  }

  // Declared ON DELETE SET NULL → keep the row, drop the dangling pointer.
  db.executeSync(
    `UPDATE sessions SET site_id = NULL
       WHERE site_id IS NOT NULL AND site_id NOT IN (SELECT id FROM sites);`,
  );
  db.executeSync(
    `UPDATE plot_surveys SET site_id = NULL
       WHERE site_id IS NOT NULL AND site_id NOT IN (SELECT id FROM sites);`,
  );
  // No FK is declared on this one, but a pointer to a deleted subplot is just
  // as wrong — null it so the record falls back to plot-level scope.
  db.executeSync(
    `UPDATE plot_species_records SET subplot_id = NULL
       WHERE subplot_id IS NOT NULL AND subplot_id NOT IN (SELECT id FROM plot_subplots);`,
  );

  repairDanglingProjectIds(db);
}

/** Tables carrying a FK to `projects`. `deleteProject` used to reassign only
 *  the first two, stranding the other two. */
const PROJECT_FK_TABLES = ['sessions', 'plot_surveys', 'sites', 'collection_trips'];

/**
 * Reassign rows whose `project_id` points at a deleted project back to 0 (未分類).
 *
 * This is data RECOVERY, not cleanup: `listSites` and `listCollectionTrips`
 * inner-joined `projects`, so after a project was deleted its 樣點 and 採集記錄
 * vanished from the lists while the rows sat in the DB. Those queries are now
 * LEFT JOINs, and this pass repoints the orphaned rows so they land back under
 * 未分類 instead of showing a blank project.
 *
 * Takes an automatic snapshot first — this is the only pass that rewrites a
 * column on rows the user can see. Gated on there actually being something to
 * repair, so a healthy DB pays nothing at startup.
 */
function repairDanglingProjectIds(db: ReturnType<typeof getUserDb>): void {
  const where = `project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)`;
  const counts = PROJECT_FK_TABLES.map((t) => {
    const res = db.executeSync(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where};`);
    return { table: t, n: Number((res.rows?.[0] as { n?: number })?.n ?? 0) };
  }).filter((c) => c.n > 0);

  if (counts.length === 0) return;

  const snapshot = createSafetySnapshot();
  if (__DEV__) {
    console.warn(
      `[cleanup] repairing dangling project_id: ` +
        counts.map((c) => `${c.table}=${c.n}`).join(', ') +
        ` (snapshot: ${snapshot ?? 'FAILED'})`,
    );
  }
  for (const { table } of counts) {
    db.executeSync(`UPDATE ${table} SET project_id = 0 WHERE ${where};`);
  }
}

/** Read-only integrity report. Counts only — never modifies anything. */
export type IntegrityReport = {
  duplicateOccurrenceIds: { table: string; groups: number; rows: number }[];
  orphanRows: { table: string; n: number }[];
  danglingProjectIds: { table: string; n: number }[];
  fkViolations: number;
  /** Records whose deliberately adopted name no longer checks out against the
   *  bundled checklist. Between the 2026-02 and 2026-04 TaiCOL releases 527
   *  non-accepted names moved to a different taxon and 3 name_ids disappeared,
   *  so this drifts on its own — and it is the user's call, not ours, whether
   *  a record should follow. Reported, never rewritten. */
  staleAdoptedNames: { table: string; n: number }[];
};

/**
 * Count the things a repair *could* fix, without fixing anything.
 *
 * Exists because duplicate `occurrence_id`s are deliberately left alone: they
 * are published DwC identifiers, so re-minting them would break any export
 * already handed over. The user needs the actual numbers to decide.
 */
const ADOPTION_TABLES = ['checklist_records', 'plot_species_records', 'collection_specimens'];

/**
 * Rows whose stored adopted name the checklist no longer confirms — the id is
 * gone, now spells something else, or has moved to another taxon.
 *
 * The record still displays the name the recorder chose (the stored string is
 * authoritative for display); this only surfaces that the checklist has since
 * disagreed, so the user can revisit those determinations if they want to.
 */
function countStaleAdoptions(table: string): number {
  const userDb = getUserDb();
  const res = userDb.executeSync(
    `SELECT taxon_id, used_name_id, used_scientific_name FROM ${table}
      WHERE used_name_id IS NOT NULL`,
  );
  const rows = (res.rows ?? []) as Array<{
    taxon_id?: string;
    used_name_id?: number;
    used_scientific_name?: string;
  }>;
  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.used_name_id).filter((v): v is number => typeof v === 'number');
  const ph = ids.map(() => '?').join(',');
  const namesRes = getTaicolDb().executeSync(
    `SELECT name_id, simple_name, taxon_id FROM taicol_names WHERE name_id IN (${ph})`,
    ids,
  );
  const live = new Map<number, { simple_name: string; taxon_id: string }>();
  for (const r of (namesRes.rows ?? []) as Array<Record<string, unknown>>) {
    live.set(Number(r.name_id), {
      simple_name: (r.simple_name as string) ?? '',
      taxon_id: (r.taxon_id as string) ?? '',
    });
  }

  let stale = 0;
  for (const r of rows) {
    const hit = r.used_name_id != null ? live.get(r.used_name_id) : undefined;
    if (!hit) {
      stale += 1; // the name_id is gone from this checklist release
      continue;
    }
    const stored = (r.used_scientific_name ?? '').trim();
    if (stored && hit.simple_name !== stored) stale += 1; // renamed under us
    else if (hit.taxon_id && r.taxon_id && hit.taxon_id !== r.taxon_id) stale += 1; // moved taxon
  }
  return stale;
}

export function checkIntegrity(): IntegrityReport {
  const db = getUserDb();
  const num = (sql: string): number => {
    const r = db.executeSync(sql);
    return Number((r.rows?.[0] as { n?: number })?.n ?? 0);
  };

  const OCC_TABLES = ['checklist_records', 'plot_species_records', 'collection_specimens'];
  const duplicateOccurrenceIds = OCC_TABLES.map((table) => {
    const dup = `SELECT occurrence_id, COUNT(*) AS c FROM ${table}
                 WHERE occurrence_id IS NOT NULL AND occurrence_id != ''
                 GROUP BY occurrence_id HAVING c > 1`;
    return {
      table,
      groups: num(`SELECT COUNT(*) AS n FROM (${dup})`),
      rows: num(`SELECT COALESCE(SUM(c), 0) AS n FROM (${dup})`),
    };
  }).filter((d) => d.groups > 0);

  // The adopted name is checked against the checklist, which lives in the OTHER
  // database handle — so this is counted per table in JS rather than joined.
  const staleAdoptedNames = ADOPTION_TABLES.map((table) => ({
    table,
    n: countStaleAdoptions(table),
  })).filter((a) => a.n > 0);

  const orphanRows = [
    ['collection_specimens', 'trip_id NOT IN (SELECT id FROM collection_trips)'],
    ['checklist_records', 'session_id NOT IN (SELECT id FROM sessions)'],
    ['plot_species_records', 'plot_survey_id NOT IN (SELECT id FROM plot_surveys)'],
    ['plot_survey_layers', 'plot_survey_id NOT IN (SELECT id FROM plot_surveys)'],
    ['subplot_layers', 'subplot_id NOT IN (SELECT id FROM plot_subplots)'],
    ['plot_subplots', 'plot_survey_id NOT IN (SELECT id FROM plot_surveys)'],
  ]
    .map(([table, where]) => ({ table, n: num(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`) }))
    .filter((o) => o.n > 0);

  const danglingProjectIds = PROJECT_FK_TABLES.map((table) => ({
    table,
    n: num(
      `SELECT COUNT(*) AS n FROM ${table}
        WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)`,
    ),
  })).filter((d) => d.n > 0);

  return {
    duplicateOccurrenceIds,
    orphanRows,
    danglingProjectIds,
    staleAdoptedNames,
    fkViolations: db.executeSync('PRAGMA foreign_key_check;').rows?.length ?? 0,
  };
}
