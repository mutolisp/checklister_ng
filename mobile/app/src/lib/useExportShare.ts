/**
 * Shared export flow: size guard → bundle → share sheet, with progress state.
 *
 * Extracted verbatim from app/(tabs)/index.tsx so the project export screens
 * can reuse the exact same behaviour (including the iOS quirk below) instead
 * of copying it. The records tab and the project screens both render
 * `<ExportProgressOverlay progress={progress} />` themselves.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { ExportProgress } from '~/lib/bundleExport';
import { formatBytes } from '~/lib/exportSize';
import { useToast } from '~/stores/toast';

export function useExportShare() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);

  const onProgress = useCallback((p: ExportProgress) => setProgress(p), []);

  const shareBundle = useCallback(
    async (
      bundleFn: () => Promise<{
        uri: string;
        filename: string;
        mimeType: string;
        /** iOS type identifier. Optional — the share sheet infers one from the
         *  extension — but naming it is what makes "Open in Word" appear
         *  first rather than a generic file handler. */
        UTI?: string;
      }>,
    ) => {
      if (busy) return;
      setBusy(true);
      setProgress({ label: t('export.preparing') });
      try {
        const file = await bundleFn();
        // Dismiss the progress Modal AND wait for it to finish animating out.
        // iOS can't present the native share sheet on top of a Modal that is
        // still on screen / mid-dismiss, so the sheet would silently never show.
        setProgress(null);
        await new Promise((r) => setTimeout(r, 450));
        const ok = await Sharing.isAvailableAsync();
        if (!ok) {
          Alert.alert(t('export.shareUnavailable'), t('export.fileGenerated', { uri: file.uri }));
        } else {
          await Sharing.shareAsync(file.uri, {
            mimeType: file.mimeType,
            ...(file.UTI ? { UTI: file.UTI } : {}),
            dialogTitle: file.filename,
          });
        }
        toast(t('export.done', { filename: file.filename }));
      } catch (e) {
        Alert.alert(t('export.failed'), e instanceof Error ? e.message : String(e));
      } finally {
        setProgress(null);
        setBusy(false);
      }
    },
    [busy, t, toast],
  );

  const confirmIfLarge = useCallback(
    (bytes: number): Promise<boolean> => {
      return new Promise((resolve) => {
        if (bytes < 100 * 1024 * 1024) {
          resolve(true);
          return;
        }
        if (bytes >= 500 * 1024 * 1024) {
          Alert.alert(
            t('export.veryLargeTitle'),
            t('export.veryLargeMsg', { size: formatBytes(bytes) }),
            [
              { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('export.exportAnyway'), style: 'destructive', onPress: () => resolve(true) },
            ],
          );
          return;
        }
        Alert.alert(
          t('export.largeTitle'),
          t('export.largeMsg', { size: formatBytes(bytes) }),
          [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('common.continue'), onPress: () => resolve(true) },
          ],
        );
      });
    },
    [t],
  );

  return { busy, progress, onProgress, shareBundle, confirmIfLarge };
}
