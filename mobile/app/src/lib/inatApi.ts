/**
 * iNaturalist WRITE client — the app's first authenticated network calls.
 *
 * Everything here takes the JWT as a parameter; obtaining and refreshing it
 * is `inatAuth.ts`'s job, so this module has no state and no UI. Endpoints
 * and field names are verified against https://api.inaturalist.org/v2/api-docs
 * (see the plan / Update_log for the table); the Node API wants the raw JWT in
 * the `Authorization` header — no `Bearer` prefix, exactly as inaturalistjs
 * sends it.
 *
 * Multipart uploads go through `uploadAsync` from `expo-file-system/legacy`
 * (the same module gbifDownload.ts uses for byte-progress downloads): React
 * Native's fetch cannot stream a file body. That import is why this lives
 * apart from apiFetch.ts, which must stay loadable under plain Node for
 * `npm run check:gbif`.
 */
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { ApiError, getJson, postJson, qs, sendJson, USER_AGENT } from './apiFetch';
import { pickTaxonMatch, type AutocompleteHit, type ObservationPayload } from './inatPayload';

const API_V1 = 'https://api.inaturalist.org/v1';
const API_V2 = 'https://api.inaturalist.org/v2';

/** Media transfers get a longer leash than JSON calls: a 4 MB HEIC on a
 *  field connection can legitimately take a minute. */
const MEDIA_TIMEOUT_MS = 120_000;

function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: jwt, 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

/** `results[0].login` of the token's owner — shown on the account page and
 *  the cheapest way to prove a pasted token actually works. */
export async function fetchMe(jwt: string, signal?: AbortSignal): Promise<{ login: string; id: number }> {
  const json = await getJson('inat', `${API_V1}/users/me`, signal, undefined, 0, authHeaders(jwt));
  const me = ((json.results as Record<string, unknown>[] | undefined) ?? [])[0];
  if (!me || typeof me.login !== 'string') throw new ApiError('inat', 'parse', 'users/me: no login in response');
  return { login: me.login, id: Number(me.id ?? 0) };
}

/** Resolve a scientific name to an iNat taxon id, or null when there is no
 *  unambiguous match. Unauthenticated; one request per distinct name. */
export async function lookupTaxonId(name: string, kingdom: string, signal?: AbortSignal): Promise<number | null> {
  const q = name.trim();
  if (!q) return null;
  const json = await getJson('inat', `${API_V1}/taxa/autocomplete?${qs({ q, per_page: '30' })}`, signal);
  const hits = ((json.results as Record<string, unknown>[] | undefined) ?? []).map(
    (r): AutocompleteHit => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      rank: typeof r.rank === 'string' ? r.rank : undefined,
      is_active: typeof r.is_active === 'boolean' ? r.is_active : undefined,
      iconic_taxon_name: typeof r.iconic_taxon_name === 'string' ? r.iconic_taxon_name : null,
    }),
  );
  return pickTaxonMatch(hits, q, kingdom);
}

/**
 * POST /v2/observations. `fields` is required to get anything back — v2
 * answers with the uuid alone otherwise. The response shape for creates has
 * not been observed in the wild yet, so both `{ results: [obs] }` and a bare
 * observation object are accepted.
 */
export async function createObservation(
  jwt: string,
  payload: ObservationPayload,
  signal?: AbortSignal,
): Promise<{ id: number; uuid: string }> {
  const json = await postJson(
    'inat',
    `${API_V2}/observations`,
    { fields: 'id,uuid', observation: payload },
    { headers: authHeaders(jwt), signal },
  );
  const results = json.results as Record<string, unknown>[] | undefined;
  const obs = (Array.isArray(results) ? results[0] : undefined) ?? json;
  const id = Number(obs.id);
  const uuid = typeof obs.uuid === 'string' ? obs.uuid : payload.uuid;
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('inat', 'parse', 'observations: no id in response', undefined, JSON.stringify(json).slice(0, 300));
  }
  return { id, uuid };
}

type MultipartOpts = {
  jwt: string;
  url: string;
  fileUri: string;
  mimeType: string;
  parameters: Record<string, string>;
};

/**
 * One multipart POST with the file under the `file` field (the name both
 * observation_photos and observation_sounds expect). `uploadAsync` cannot be
 * aborted mid-transfer, so the timeout races it and the transfer is simply
 * abandoned on the way out.
 */
async function postMultipart({ jwt, url, fileUri, mimeType, parameters }: MultipartOpts): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ApiError('inat', 'timeout', `timed out after ${MEDIA_TIMEOUT_MS} ms`)),
      MEDIA_TIMEOUT_MS,
    );
  });
  try {
    const res = await Promise.race([
      uploadAsync(url, fileUri, {
        httpMethod: 'POST',
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType,
        parameters,
        headers: authHeaders(jwt),
      }).catch((e: unknown) => {
        throw new ApiError('inat', 'network', String((e as Error)?.message ?? e));
      }),
      timeout,
    ]);
    if (res.status < 200 || res.status >= 300) {
      const detail = (res.body ?? '').trim().slice(0, 300) || undefined;
      if (res.status === 429) throw new ApiError('inat', 'rate_limit', 'HTTP 429', 429, detail);
      throw new ApiError('inat', 'http', `HTTP ${res.status}`, res.status, detail);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** POST /v2/observation_photos. `photoUuid` is what makes a retry replace
 *  instead of duplicate (see `photoUuidFor`). */
export async function uploadPhoto(
  jwt: string,
  observationUuid: string,
  fileUri: string,
  photoUuid: string,
  mimeType: string,
): Promise<void> {
  await postMultipart({
    jwt,
    url: `${API_V2}/observation_photos`,
    fileUri,
    mimeType,
    parameters: {
      'observation_photo[observation_id]': observationUuid,
      'observation_photo[uuid]': photoUuid,
    },
  });
}

/** POST /v2/observation_sounds. No uuid field exists for sounds in v2 — the
 *  driver's `inat_media_done` cursor is the only duplicate guard. */
export async function uploadSound(jwt: string, observationUuid: string, fileUri: string, mimeType: string): Promise<void> {
  await postMultipart({
    jwt,
    url: `${API_V2}/observation_sounds`,
    fileUri,
    mimeType,
    parameters: { 'observation_sound[observation_id]': observationUuid },
  });
}

/**
 * POST /v2/annotations — one controlled-term value on an observation
 * (`AnnotationsCreate`: resource_type, resource_id = observation UUID,
 * controlled_attribute_id, controlled_value_id; nothing else allowed).
 * Rejections (a value outside the taxon's scope, a duplicate on retry) come
 * back as 4xx and are the caller's to ignore.
 */
export async function createAnnotation(
  jwt: string,
  observationUuid: string,
  attributeId: number,
  valueId: number,
  signal?: AbortSignal,
): Promise<void> {
  await postJson(
    'inat',
    `${API_V2}/annotations`,
    {
      resource_type: 'Observation',
      resource_id: observationUuid,
      controlled_attribute_id: attributeId,
      controlled_value_id: valueId,
    },
    { headers: authHeaders(jwt), signal },
  );
}

/** PUT /v2/observations/{uuid} (`ObservationsUpdate`). `ignore_photos: true`
 *  is what keeps the existing photos — the schema warns that `false` removes
 *  them all. Fields not sent are left as they are on the server. */
export async function updateObservation(
  jwt: string,
  observationUuid: string,
  observation: Omit<ObservationPayload, 'uuid' | 'geoprivacy' | 'tag_list'> & { geoprivacy?: string; tag_list?: string },
  signal?: AbortSignal,
): Promise<void> {
  await sendJson(
    'inat',
    'PUT',
    `${API_V2}/observations/${observationUuid}`,
    { ignore_photos: true, fields: 'id,uuid', observation },
    { headers: authHeaders(jwt), signal },
  );
}

export type RemoteAnnotation = {
  uuid: string;
  controlled_attribute_id: number;
  controlled_value_id: number;
  user_id: number | null;
};

/** The annotations currently on an observation (GET /v2/observations/{uuid}
 *  with `fields=all`, the documented way to get nested resources). */
export async function fetchObservationAnnotations(
  jwt: string,
  observationUuid: string,
  signal?: AbortSignal,
): Promise<RemoteAnnotation[]> {
  const json = await getJson('inat', `${API_V2}/observations/${observationUuid}?fields=all`, signal, undefined, 0, authHeaders(jwt));
  const obs = ((json.results as Record<string, unknown>[] | undefined) ?? [])[0];
  const raw = (obs?.annotations as Record<string, unknown>[] | undefined) ?? [];
  return raw
    .map((a) => ({
      uuid: String(a.uuid ?? ''),
      controlled_attribute_id: Number(a.controlled_attribute_id),
      controlled_value_id: Number(a.controlled_value_id),
      user_id: typeof a.user_id === 'number' ? a.user_id : Number((a.user as Record<string, unknown> | undefined)?.id ?? NaN) || null,
    }))
    .filter((a) => a.uuid && Number.isFinite(a.controlled_attribute_id) && Number.isFinite(a.controlled_value_id));
}

/** DELETE /v2/annotations/{uuid}. */
export async function deleteAnnotation(jwt: string, annotationUuid: string, signal?: AbortSignal): Promise<void> {
  await sendJson('inat', 'DELETE', `${API_V2}/annotations/${annotationUuid}`, undefined, { headers: authHeaders(jwt), signal });
}

export function observationWebUrl(observationId: number): string {
  return `https://www.inaturalist.org/observations/${observationId}`;
}
