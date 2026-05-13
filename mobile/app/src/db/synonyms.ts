import { getTaicolDb } from './init';

export type Synonym = {
  scientificName: string;
  authorship: string;
  status: string;
  source: 'TaiCOL';
  commonName: string;
};

export function getSynonyms(taxonId: string): Synonym[] {
  if (!taxonId) return [];

  const db = getTaicolDb();
  const res = db.executeSync(
    `SELECT simple_name, name_author, usage_status, common_name_c
     FROM taicol_names
     WHERE taxon_id = ?
     ORDER BY (usage_status != 'accepted'), simple_name`,
    [taxonId],
  );

  return ((res.rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    scientificName: (row.simple_name as string) ?? '',
    authorship: (row.name_author as string) ?? '',
    status: (row.usage_status as string) ?? '',
    source: 'TaiCOL' as const,
    commonName: (row.common_name_c as string) ?? '',
  }));
}
