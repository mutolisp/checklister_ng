/**
 * One-shot DB cleanup tasks run from `initDb()` after migrations.
 *
 * Today this is just `enforceSingleActiveOnStartup`, which mops up any
 * leftover multi-active records from before single-active-enforcement was
 * added. Idempotent — running on a clean DB is a no-op.
 */
import { getUserDb } from './init';

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
