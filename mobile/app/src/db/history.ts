import { getUserDb } from './init';

const MAX_HISTORY = 10;

export type SearchHistoryEntry = {
  id: number;
  query: string;
  searched_at: number;
};

export function addSearchHistory(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const db = getUserDb();
  db.executeSync(`DELETE FROM search_history WHERE query = ?`, [trimmed]);
  db.executeSync(`INSERT INTO search_history (query, searched_at) VALUES (?, ?)`, [trimmed, Date.now()]);
  db.executeSync(
    `DELETE FROM search_history WHERE id NOT IN (
       SELECT id FROM search_history ORDER BY searched_at DESC LIMIT ?
     )`,
    [MAX_HISTORY],
  );
}

export function listSearchHistory(limit: number = MAX_HISTORY): SearchHistoryEntry[] {
  const db = getUserDb();
  const res = db.executeSync(
    `SELECT * FROM search_history ORDER BY searched_at DESC LIMIT ?`,
    [limit],
  );
  return ((res.rows ?? []) as unknown) as SearchHistoryEntry[];
}

export function clearSearchHistory(): void {
  const db = getUserDb();
  db.executeSync(`DELETE FROM search_history`);
}
