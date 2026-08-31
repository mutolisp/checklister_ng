/**
 * Session (名錄) round-trip import — the yml half.
 *
 * Reads the document emitted by `buildSessionEntries` (src/lib/bundleExport.ts):
 * an `event:` block in DwC camelCase, a top-level `project` / `site:`, and a
 * `checklist:` array of DwC occurrence items. Produces an `ImportedSession`
 * for `importSession` (src/db/sessions.ts).
 *
 * Pure, like `plotImport.ts` — no DB, no i18n, no file IO.
 */
import yaml from 'js-yaml';
import { ImportError } from './importError';
import { num, parseSiteBlock, pipeToJson, pipeToList, str } from './plotImport';
import type { ImportedSession, ImportedSessionRecord } from '~/db';

/**
 * ISO-8601 (with local offset, as `localIso` writes it) → epoch ms.
 *
 * Accepts a Date too: YAML 1.1 has a timestamp type, so an *unquoted*
 * `startedAt: 2026-01-02T08:00:00+08:00` — which is what a hand-edited file or
 * another tool produces — comes back from js-yaml already parsed. Our own dump
 * quotes it (it round-trips as a string), so both forms are in the wild.
 */
function isoToMs(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number' && Number.isFinite(v)) return v; // tolerate raw ms
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function parseSessionYaml(text: string): ImportedSession {
  const doc = yaml.load(text) as Record<string, unknown> | null;
  return sessionFromDoc(doc);
}

export function sessionFromDoc(doc: Record<string, unknown> | null): ImportedSession {
  const ev = (doc?.event ?? null) as Record<string, unknown> | null;
  const checklist = Array.isArray(doc?.checklist)
    ? (doc!.checklist as Record<string, unknown>[])
    : null;
  if (!doc || (!ev && !checklist)) throw new ImportError('invalidYml');

  const name = str(ev?.eventID) ?? str(doc.project) ?? '';
  if (!name) throw new ImportError('missingFields');

  const startedAt = isoToMs(ev?.startedAt) ?? isoToMs(ev?.eventDate) ?? Date.now();

  const records: ImportedSessionRecord[] = (checklist ?? [])
    .map((r) => ({
      occurrence_id: str(r.occurrenceID),
      taxon_id: String(r.taxonID ?? ''),
      name: str(r.scientificName),
      family: str(r.family),
      observed_at: isoToMs(r.eventDate),
      notes: str(r.occurrenceRemarks),
      lat: num(r.decimalLatitude),
      lng: num(r.decimalLongitude),
      accuracy: num(r.coordinateUncertaintyInMeters),
      organism_quantity: str(r.organismQuantity),
      organism_quantity_type: str(r.organismQuantityType),
      sex: str(r.sex),
      life_stage: str(r.lifeStage),
      reproductive_condition: pipeToJson(r.reproductiveCondition),
      leaf_phenology: pipeToJson(r.leafPhenology),
      photo_files: pipeToList(r.associatedMedia),
    }))
    .filter((r) => r.taxon_id);

  const gpsMode = str(ev?.gpsMode);

  return {
    // Pre-v27 exports carry no uuid; the caller mints one (import as new).
    uuid: str(ev?.eventUUID) ?? '',
    name,
    type: ev?.eventType === 'abundance' ? 'abundance' : 'checklist',
    project_name: str(doc.project),
    started_at: startedAt,
    ended_at: isoToMs(ev?.endedAt),
    recorded_by: str(ev?.recordedBy),
    notes: str(ev?.eventRemarks),
    start_lat: num(ev?.decimalLatitude),
    start_lng: num(ev?.decimalLongitude),
    gps_mode:
      gpsMode === 'off' || gpsMode === 'single_point' || gpsMode === 'full_track' ? gpsMode : null,
    track_geojson: str(ev?.trackGeoJSON),
    site: parseSiteBlock(doc.site),
    records,
  };
}
