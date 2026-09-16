/**
 * Pure payload building for the iNaturalist upload — no Expo, no DB, no i18n
 * (scripts/check-inat-payload.mjs runs this under plain Node; labels arrive
 * already translated).
 *
 * What is sent, verified against https://api.inaturalist.org/v2/api-docs
 * (`ObservationsCreate`) and iNaturalist's Rails `observation_params`:
 *   uuid                 = our occurrence_id, so a retry updates instead of
 *                          duplicating (observations_controller looks the
 *                          observation up by uuid for the same user)
 *   taxon_id             = iNat taxon id when we could match one
 *   species_guess        = always the scientific name, so an unmatched taxon
 *                          still lands as an identifiable observation
 *   observed_on_string   = ISO 8601 with the device's UTC offset
 *   latitude/longitude/positional_accuracy, geoprivacy, description, tag_list
 */

export type Geoprivacy = 'open' | 'obscured' | 'private';

/**
 * degreeOfEstablishment → iNat's boolean. Inlined rather than imported from
 * `dwcAttributes.ts` because that module pulls in `~/i18n`, and this one must
 * stay runnable under plain Node for `scripts/check-inat-payload.mjs` — the
 * same reason `dwcMultiValue.ts` was split out.
 */
function establishmentCaptiveFlag(v: string | null | undefined): boolean | undefined {
  if (v === 'captive' || v === 'cultivated') return true;
  if (v === 'wild') return false;
  return undefined;
}

export const GEOPRIVACY_VALUES: Geoprivacy[] = ['open', 'obscured', 'private'];

/** Where a record's coordinates came from — shown in the upload list. */
export type LocationSource = 'record' | 'plot' | 'site' | 'session';

export type InatLocation = {
  lat: number;
  lng: number;
  /** Metres; null when the source has no uncertainty (a bare session start point). */
  accuracyM: number | null;
  source: LocationSource;
};

export type InatAttribute = { label: string; value: string };

export type InatRecordInput = {
  occurrenceId: string;
  /** The name the record is filed under (already the user's adopted name). */
  scientificName: string;
  localTaxonId: string;
  kingdom: string;
  observedAtMs: number;
  /** Minutes EAST of UTC (i.e. `-new Date().getTimezoneOffset()`); +480 for Taiwan. */
  tzOffsetMin: number;
  location: InatLocation | null;
  /** iNat `place_guess` — a specimen's / plot's free-text locality. */
  placeGuess?: string | null;
  notes: string | null;
  attributes: InatAttribute[];
  /** DwC degreeOfEstablishment: 'wild' | 'captive' | 'cultivated' | null. */
  degreeOfEstablishment?: string | null;
};

export type BatchOptions = {
  tags: string[];
  geoprivacy: Geoprivacy;
};

export type ObservationPayload = {
  uuid: string;
  taxon_id?: number;
  species_guess: string;
  observed_on_string: string;
  latitude?: number;
  longitude?: number;
  positional_accuracy?: number;
  place_guess?: string;
  geoprivacy: Geoprivacy;
  description?: string;
  tag_list?: string;
  /**
   * iNaturalist's 「captive / cultivated」 flag (`ObservationsCreate.observation
   * .captive_flag`, boolean, verified against api.inaturalist.org/v2/api-docs).
   * It is a field, NOT a controlled annotation — hence not in INAT_TERMS.
   *
   * Three-state on our side collapses to boolean-or-absent here: 圈養/栽培 →
   * true, 野生 → an explicit false, 未記錄 → omitted so iNat keeps its default.
   */
  captive_flag?: boolean;
};

/** External taxa minted from iNaturalist carry the iNat id in the local id
 *  (`gi` + id, see src/db/externalTaxa.ts). */
export function inatIdFromLocalTaxonId(taxonId: string): number | null {
  const m = /^gi(\d+)$/.exec(taxonId ?? '');
  return m ? Number(m[1]) : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `2026-09-15T14:03:07+08:00` — unambiguous for iNat's Rails parser whatever
 *  the account's time zone is set to. */
export function formatObservedOnString(ms: number, tzOffsetMin: number): string {
  const d = new Date(ms + tzOffsetMin * 60_000);
  const sign = tzOffsetMin < 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMin);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** Notes first (verbatim), then one `label: value` line per attribute. */
export function buildDescription(notes: string | null | undefined, attributes: InatAttribute[]): string {
  const head = (notes ?? '').trim();
  const lines = attributes
    .filter((a) => a.label.trim() && a.value.trim())
    .map((a) => `${a.label.trim()}: ${a.value.trim()}`);
  if (!head) return lines.join('\n');
  if (lines.length === 0) return head;
  return `${head}\n\n${lines.join('\n')}`;
}

/** Comma / 、 / newline separated, trimmed, de-duplicated, blanks dropped. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text ?? '').split(/[,\n、]/)) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function buildObservationPayload(
  input: InatRecordInput,
  taxonId: number | null,
  batch: BatchOptions,
): ObservationPayload {
  const p: ObservationPayload = {
    uuid: input.occurrenceId,
    species_guess: input.scientificName,
    observed_on_string: formatObservedOnString(input.observedAtMs, input.tzOffsetMin),
    geoprivacy: batch.geoprivacy,
  };
  if (taxonId !== null) p.taxon_id = taxonId;
  const captive = establishmentCaptiveFlag(input.degreeOfEstablishment);
  if (captive !== undefined) p.captive_flag = captive;
  if (input.location) {
    p.latitude = input.location.lat;
    p.longitude = input.location.lng;
    if (input.location.accuracyM !== null && input.location.accuracyM > 0) {
      p.positional_accuracy = Math.round(input.location.accuracyM);
    }
  }
  const place = (input.placeGuess ?? '').trim();
  if (place) p.place_guess = place;
  const description = buildDescription(input.notes, input.attributes);
  if (description) p.description = description;
  if (batch.tags.length > 0) p.tag_list = batch.tags.join(',');
  return p;
}

// ── deterministic photo uuid ────────────────────────────────────────────────

/** FNV-1a 32-bit over a string's UTF-16 code units. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * `observation_photo[uuid]` for the i-th photo of an occurrence.
 *
 * iNat de-duplicates observation photos by uuid ("helps prevent duplication
 * in poor network conditions" — v2 api-docs), so a retry that re-sends photo
 * i must send the SAME uuid. Four salted FNV-1a words give 128 bits that are
 * stable across app versions; version/variant nibbles are forced so the
 * server's uuid format check passes. Not cryptographic, and does not need to
 * be — the only requirement is determinism plus no collision among one
 * user's own photos.
 */
export function photoUuidFor(occurrenceId: string, index: number): string {
  const seed = `${occurrenceId}:photo:${index}`;
  let hex = '';
  for (let k = 0; k < 4; k++) hex += fnv1a32(`${k}|${seed}`).toString(16).padStart(8, '0');
  const chars = hex.split('');
  chars[12] = '4';
  chars[16] = '89ab'[parseInt(chars[16], 16) & 3];
  const h = chars.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── taxon matching ──────────────────────────────────────────────────────────

export type AutocompleteHit = {
  id: number;
  name: string;
  rank?: string;
  is_active?: boolean;
  iconic_taxon_name?: string | null;
};

const RANK_MARKERS = /\b(?:nothosubsp|nothovar|subsp|ssp|subvar|var|forma|fo|f)\.?\s+/g;
const SENSU = /\b(?:s\.\s*l\.|s\.\s*str\.|sensu\s+lato|sensu\s+stricto)/g;

/**
 * iNaturalist writes infraspecific names WITHOUT rank markers
 * (`Ficus formosana shimadae`), TaiCOL with (`Ficus formosana var. shimadae`).
 * Collapse both sides to the same spelling before comparing.
 */
export function normaliseSciName(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(SENSU, ' ')
    .replace(/×/g, ' ')
    .replace(/\s+x\s+/g, ' ')
    .replace(RANK_MARKERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ANIMAL_ICONICS = new Set([
  'Animalia',
  'Aves',
  'Mammalia',
  'Reptilia',
  'Amphibia',
  'Actinopterygii',
  'Insecta',
  'Arachnida',
  'Mollusca',
]);

function iconicConsistent(kingdom: string, iconic: string | null | undefined): boolean {
  if (!iconic) return true; // no data → cannot contradict
  const k = (kingdom ?? '').trim();
  if (k === 'Plantae') return iconic === 'Plantae';
  if (k === 'Fungi') return iconic === 'Fungi';
  if (k === 'Animalia') return ANIMAL_ICONICS.has(iconic);
  if (k === 'Chromista') return iconic === 'Chromista';
  if (k === 'Protozoa') return iconic === 'Protozoa';
  return true;
}

/**
 * Pick the one iNat taxon for a name, or null.
 *
 * Exact (case-insensitive) name first, else the rank-marker-normalised
 * spelling; inactive taxa are dropped when an active one exists; several
 * survivors are narrowed by kingdom ↔ iconic taxon (72 genus names in the
 * bundled checklist are cross-kingdom homonyms). Anything still ambiguous
 * returns null — sending `species_guess` alone and letting iNat's identifiers
 * sort it out beats silently attaching the wrong taxon.
 */
export function pickTaxonMatch(hits: AutocompleteHit[], name: string, kingdom: string): number | null {
  const want = (name ?? '').trim().toLowerCase();
  if (!want) return null;
  let cands = hits.filter((h) => (h.name ?? '').trim().toLowerCase() === want);
  if (cands.length === 0) {
    const norm = normaliseSciName(name);
    if (!norm) return null;
    cands = hits.filter((h) => normaliseSciName(h.name) === norm);
  }
  if (cands.length === 0) return null;
  const active = cands.filter((h) => h.is_active !== false);
  if (active.length > 0) cands = active;
  if (cands.length === 1) return cands[0].id;
  const kept = cands.filter((h) => iconicConsistent(kingdom, h.iconic_taxon_name));
  if (kept.length === 1) return kept[0].id;
  return null;
}

// ── geometry ────────────────────────────────────────────────────────────────

const METRES_PER_DEG_LAT = 111_320;

/**
 * Centre of a point cloud plus the half-diagonal of its bounding box in
 * metres — what `positional_accuracy` means for a record placed at "the
 * site" rather than at a GPS fix. Equirectangular; fine for site-sized
 * shapes. A single point has radius 0.
 */
export function centreAndRadius(points: [number, number][]): { lat: number; lng: number; accuracyM: number } | null {
  if (points.length === 0) return null;
  let minLat = points[0][1];
  let maxLat = points[0][1];
  let minLng = points[0][0];
  let maxLng = points[0][0];
  for (const [lng, lat] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const lat = (minLat + maxLat) / 2;
  const lng = (minLng + maxLng) / 2;
  const dy = ((maxLat - minLat) / 2) * METRES_PER_DEG_LAT;
  const dx = ((maxLng - minLng) / 2) * METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return { lat, lng, accuracyM: Math.round(Math.sqrt(dx * dx + dy * dy)) };
}

// ── annotations (phenology → iNat controlled terms) ─────────────────────────

/**
 * iNaturalist controlled-term ids and their taxon scopes, read from the live
 * endpoint GET https://api.inaturalist.org/v1/controlled_terms on 2026-09-15
 * (scope taxon ids resolved to names via GET /v1/taxa/{ids} the same day):
 *
 *   12 "Flowers and Fruits" (multi; Plantae, values limited to Angiospermae):
 *       13 Flowers · 14 Fruits or Seeds · 15 Flower Buds · 21 No Flowers or Fruits (blocking)
 *   36 "Leaves" (multi; Tracheophyta):
 *       37 Breaking Leaf Buds · 38 Green Leaves · 39 Colored Leaves · 40 No Live Leaves (blocking)
 *    9 "Sex" (Life, except Fungi/Bacteria/Archaea/Viruses, Oligochaeta,
 *       Hirudinea, Nudibranchia, Homo): 10 Female · 11 Male · 20 Cannot Be Determined
 *    1 "Life Stage" (Animalia, except Homo):
 *        2 Adult (Animalia)
 *        4 Pupa (Coleoptera, Neuroptera, Mecoptera, Lepidoptera, Diptera, Hymenoptera,
 *                Trichoptera, Megaloptera, Siphonaptera, Strepsiptera, Raphidioptera)
 *        5 Nymph (Dermaptera, Blattodea, Embioptera, Hemiptera, Odonata, Orthoptera,
 *                 Plecoptera, Ephemeroptera, Mantodea, Notoptera, Phasmida, Psocodea,
 *                 Thysanoptera, Zoraptera)
 *        6 Larva (Amphibia; Coleoptera, Diptera, Hymenoptera, Lepidoptera, Mecoptera,
 *                 Megaloptera, Neuroptera, Raphidioptera, Siphonaptera, Strepsiptera, Trichoptera)
 *        7 Egg (Life, except Theria)   8 Juvenile (Animalia, except Pterygota)
 *        3 Teneral / 16 Subimago — no counterpart in our vocabulary
 *
 * Our DwC vocabularies (dwcAttributes.ts) map onto them below. The scopes are
 * applied HERE, by the record's own class/order, so we never send a value the
 * server would refuse (「幼體」 on a grasshopper is a Nymph, on a beetle a
 * Larva, on a bird nothing at all); anything without an iNat counterpart
 * (sporangia, cones, shedding leaves) is left out rather than approximated.
 * The server still has the last word — a rejected value is a skip, never a
 * failure of the record.
 */
export const INAT_TERMS = {
  FLOWERS_AND_FRUITS: 12,
  FLOWERS: 13,
  FRUITS_OR_SEEDS: 14,
  FLOWER_BUDS: 15,
  LEAVES: 36,
  BREAKING_LEAF_BUDS: 37,
  GREEN_LEAVES: 38,
  COLORED_LEAVES: 39,
  SEX: 9,
  FEMALE: 10,
  MALE: 11,
  SEX_UNDETERMINED: 20,
  LIFE_STAGE: 1,
  ADULT: 2,
  PUPA: 4,
  NYMPH: 5,
  LARVA: 6,
  EGG: 7,
  JUVENILE: 8,
} as const;

export type InatAnnotation = { attribute: number; value: number };

const REPRO_TO_TERM: Record<string, number> = {
  flowering: INAT_TERMS.FLOWERS,
  buddingFlower: INAT_TERMS.FLOWER_BUDS,
  fruiting: INAT_TERMS.FRUITS_OR_SEEDS,
};

const LEAF_TO_TERM: Record<string, number> = {
  buddingLeaf: INAT_TERMS.BREAKING_LEAF_BUDS,
  green: INAT_TERMS.GREEN_LEAVES,
  colored: INAT_TERMS.COLORED_LEAVES,
};

const SEX_TO_TERM: Record<string, number> = {
  female: INAT_TERMS.FEMALE,
  male: INAT_TERMS.MALE,
  unknown: INAT_TERMS.SEX_UNDETERMINED,
};

const NO_SEX_KINGDOMS = new Set(['Fungi', 'Bacteria', 'Archaea', 'Viruses']);

const PUPA_ORDERS = new Set([
  'Coleoptera', 'Neuroptera', 'Mecoptera', 'Lepidoptera', 'Diptera', 'Hymenoptera',
  'Trichoptera', 'Megaloptera', 'Siphonaptera', 'Strepsiptera', 'Raphidioptera',
]);
const NYMPH_ORDERS = new Set([
  'Dermaptera', 'Blattodea', 'Embioptera', 'Hemiptera', 'Odonata', 'Orthoptera', 'Plecoptera',
  'Ephemeroptera', 'Mantodea', 'Notoptera', 'Phasmida', 'Psocodea', 'Thysanoptera', 'Zoraptera',
]);
const LARVA_ORDERS = new Set([
  'Coleoptera', 'Diptera', 'Hymenoptera', 'Lepidoptera', 'Mecoptera', 'Megaloptera',
  'Neuroptera', 'Raphidioptera', 'Siphonaptera', 'Strepsiptera', 'Trichoptera',
]);

function lifeStageTerm(stage: string, cls: string, order: string): number | undefined {
  switch (stage) {
    case 'adult':
    case 'adult_bird':
      return INAT_TERMS.ADULT;
    case 'subadult':
    case 'subadult_bird':
      // iNat excludes winged insects (Pterygota) from Juvenile; our finest
      // rank there is the class, so all Insecta are left out.
      return cls === 'Insecta' ? undefined : INAT_TERMS.JUVENILE;
    case 'egg':
      return cls === 'Mammalia' ? undefined : INAT_TERMS.EGG;
    case 'pupa':
      return PUPA_ORDERS.has(order) ? INAT_TERMS.PUPA : undefined;
    case 'larva':
      if (NYMPH_ORDERS.has(order)) return INAT_TERMS.NYMPH;
      if (cls === 'Amphibia' || LARVA_ORDERS.has(order)) return INAT_TERMS.LARVA;
      return undefined;
    default:
      return undefined;
  }
}

export type AnnotationInput = {
  kingdom: string;
  /** Taxon class / order names (TaiCOL spelling), for the Life Stage scopes. */
  class?: string;
  order?: string;
  sex?: string | null;
  lifeStage?: string | null;
  reproductive: string[];
  leaf: string[];
};

/** Annotations to post for a record's attributes, already filtered to what
 *  iNat accepts for that taxon. */
export function annotationsFor(input: AnnotationInput): InatAnnotation[] {
  const kingdom = (input.kingdom ?? '').trim();
  const cls = (input.class ?? '').trim();
  const order = (input.order ?? '').trim();
  const out: InatAnnotation[] = [];
  const seen = new Set<string>();
  const push = (attribute: number, value: number | undefined) => {
    if (value === undefined) return;
    const key = `${attribute}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ attribute, value });
  };
  if (kingdom === 'Plantae') {
    for (const v of input.reproductive) push(INAT_TERMS.FLOWERS_AND_FRUITS, REPRO_TO_TERM[v]);
    for (const v of input.leaf) push(INAT_TERMS.LEAVES, LEAF_TO_TERM[v]);
  }
  if (input.sex && !NO_SEX_KINGDOMS.has(kingdom) && cls !== 'Clitellata' && order !== 'Nudibranchia') {
    push(INAT_TERMS.SEX, SEX_TO_TERM[input.sex]);
  }
  if (input.lifeStage && kingdom === 'Animalia') {
    push(INAT_TERMS.LIFE_STAGE, lifeStageTerm(input.lifeStage, cls, order));
  }
  return out;
}

// ── sync fingerprint ────────────────────────────────────────────────────────

/**
 * Stable digest of everything a sync would send: the observation payload
 * (taxon name, time, coordinates, place, description), the annotation set and
 * the media count. Stored in `inat_sync_hash` after an upload/sync so the
 * detail sheet can say 「有變更」 without a network round-trip. Same FNV
 * words as `photoUuidFor` — a change detector, not a security primitive.
 */
export function syncFingerprint(input: {
  payload: ObservationPayload;
  annotations: InatAnnotation[];
  mediaCount: number;
}): string {
  const { uuid: _uuid, geoprivacy: _g, tag_list: _t, ...rest } = input.payload;
  const parts = [
    JSON.stringify(rest),
    input.annotations
      .map((a) => `${a.attribute}:${a.value}`)
      .sort()
      .join(','),
    String(input.mediaCount),
  ].join('|');
  let hex = '';
  for (let k = 0; k < 2; k++) hex += fnv1a32(`${k}|${parts}`).toString(16).padStart(8, '0');
  return hex;
}

// ── estimates ───────────────────────────────────────────────────────────────

export type EstimateInput = {
  photos: number;
  audio: number;
  needsTaxon: boolean;
  mediaDone: number;
  hasObservation: boolean;
  /** Annotation requests (0 when the record has no mappable phenology). */
  annotations?: number;
};

/** Requests a batch will make — the number the 1 req/s pacing turns into seconds. */
export function estimateRequests(records: EstimateInput[]): number {
  let n = 0;
  for (const r of records) {
    if (r.needsTaxon) n += 1;
    if (!r.hasObservation) n += 1;
    n += Math.max(0, r.photos + r.audio - r.mediaDone);
    n += r.annotations ?? 0;
  }
  return n;
}

/** MIME for the multipart part; iNat sniffs the file anyway, but a correct
 *  type avoids the "must be JPG, PNG, GIF, HEIC, or HEIF" rejection on HEIC. */
export function photoMimeType(ext: string): string {
  switch ((ext ?? '').toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

export const AUDIO_MIME_TYPE = 'audio/mp4';
