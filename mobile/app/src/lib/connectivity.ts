/**
 * Tell "you are offline" apart from "the service is down".
 *
 * `fetch` reports both as the same failure, and for a field app the difference
 * decides what the user should do: walk somewhere with signal, or try again
 * later. Getting told the wrong one wastes a trip.
 *
 * Deliberately no `expo-network` / `@react-native-community/netinfo`: either is
 * a native module, and adding one forces a full native rebuild for a single
 * boolean. Instead, when one service fails we probe THE OTHER — both are
 * already services this app talks to, so no new host is contacted and no new
 * dependency is introduced. Both unreachable means the device has no working
 * connection; the other one answering means the first is the problem.
 */
import { ApiError, probe } from './apiFetch';

export type FailureCause =
  /** Neither service could be reached. */
  | 'offline'
  /** The other service answered, so this one is at fault. */
  | 'service'
  /** No answer in time; on a weak signal this is its own thing. */
  | 'timeout'
  | 'aborted'
  | 'unknown';

/** Probed with HEAD, so nothing is downloaded — verified 200 / 0 bytes on both. */
const PROBES = {
  inat: 'https://api.inaturalist.org/v1/taxa/1',
  gbif: 'https://api.gbif.org/v1/species/1',
} as const;

const PROBE_TIMEOUT_MS = 6000;

/**
 * Classify a failed request. Costs at most ONE extra request, and only after
 * something already failed.
 */
export async function classifyFailure(e: unknown, signal?: AbortSignal): Promise<FailureCause> {
  if (!(e instanceof ApiError)) return 'unknown';
  if (e.kind === 'aborted') return 'aborted';
  // An HTTP status or an unreadable body both mean we reached the server, so
  // there is nothing to probe: the connection is fine and the service is not.
  if (e.kind === 'http' || e.kind === 'parse') return 'service';

  const other = e.service === 'inat' ? 'gbif' : 'inat';
  try {
    await probe(other, PROBES[other], signal, PROBE_TIMEOUT_MS);
    return e.kind === 'timeout' ? 'timeout' : 'service';
  } catch {
    // The other service is unreachable too. A timeout on both is still most
    // usefully described as no usable connection.
    return 'offline';
  }
}
