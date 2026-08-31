/**
 * One vocabulary for external-service failures.
 *
 * `apiFetch.ts` says it exists so "failure has a single vocabulary"; this is
 * the other half — turning an `ApiError` into something a person standing in
 * a forest can act on. Shared by the area-species query and the search box's
 * GBIF fallback so the two never drift into describing the same outage
 * differently.
 */
import { ApiError } from './apiFetch';
import { classifyFailure } from './connectivity';
import i18n from '~/i18n';

export async function apiErrorMessage(e: unknown): Promise<string> {
  if (!(e instanceof ApiError)) return String((e as Error)?.message ?? e);
  if (e.kind === 'aborted') return i18n.t('areaSpecies.errAborted');
  if (e.kind === 'rate_limit') return i18n.t('areaSpecies.errRateLimit');
  if (e.kind === 'http') {
    // GBIF's 400s name the actual problem; passing that through beats a bare
    // status the user can do nothing with.
    return e.detail
      ? i18n.t('areaSpecies.errServerDetail', { status: e.status ?? '?', detail: e.detail })
      : i18n.t('areaSpecies.errServer', { status: e.status ?? '?' });
  }
  // One probe of the OTHER service turns "request failed" into something the
  // user can act on: go find signal, or come back later.
  const cause = await classifyFailure(e);
  if (cause === 'offline') return i18n.t('areaSpecies.errOffline');
  if (cause === 'timeout') return i18n.t('areaSpecies.errTimeout');
  if (cause === 'service') return i18n.t('areaSpecies.errService');
  return i18n.t('areaSpecies.errParse');
}
