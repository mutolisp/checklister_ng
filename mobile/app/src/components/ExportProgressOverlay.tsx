import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExportProgress } from '~/lib/bundleExport';

/**
 * Full-screen, non-dismissable overlay shown while an export bundle is being
 * built + zipped. Replaces the single-line toast so the user sees the current
 * stage (準備中 / 處理照片 / 壓縮中…) and a progress bar when a count is known.
 */
export function ExportProgressOverlay({ progress }: { progress: ExportProgress | null }) {
  const { t } = useTranslation();
  const visible = progress != null;
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center bg-black/40 px-10">
        <View className="w-full max-w-xs rounded-2xl bg-white dark:bg-gray-900 px-6 py-6">
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text className="mt-4 text-center text-base font-medium text-gray-900 dark:text-gray-100">
            {progress?.label ?? t('export.exporting')}
          </Text>
          {total > 0 ? (
            <>
              <View className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <View className="h-2 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
              </View>
              <Text className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                {done} / {total}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
