/**
 * App-owned media files live under documentDirectory/photos/ (library picks,
 * see photoCapture.persistPickedPhoto) and documentDirectory/audio/
 * (recordings). Their DB rows store the ABSOLUTE file:// URI — and on iOS the
 * absolute path contains the app container UUID, which changes on every
 * reinstall (a new dev-client build, a TestFlight update…). The files survive
 * (Documents is migrated), the stored path does not, and every thumbnail of a
 * picked photo goes blank while camera shots (`ph://` references) keep
 * working. Measured on 2026-09-15 after the native rebuild for expo-audio.
 *
 * So every READ of such a URI goes through this: re-anchor the trailing
 * `photos/<name>` / `audio/<name>` onto the current container. Android's
 * files dir is stable, so it is a no-op there; writes keep storing the
 * absolute URI, which stays correct for the current container and readable
 * by older builds.
 */
import { documentDirectory } from 'expo-file-system/legacy';

const APP_FILE_RE = /\/(photos|audio)\/([^/]+)$/;

export function rebaseAppFileUri(uri: string): string {
  if (!documentDirectory || !uri.startsWith('file:') || uri.startsWith(documentDirectory)) return uri;
  const m = APP_FILE_RE.exec(uri);
  return m ? `${documentDirectory}${m[1]}/${m[2]}` : uri;
}
