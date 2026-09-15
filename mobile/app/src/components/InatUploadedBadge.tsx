/**
 * 「已上傳 iNat」 pill for a record's detail header. Tapping opens the
 * observation on inaturalist.org. Rendered only when the row carries
 * `inat_uploaded_at` (migrations.ts v30) — the same fact that tints list rows.
 */
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, Text } from 'react-native';
import { observationWebUrl } from '~/lib/inatApi';

/** What a detail sheet needs to offer 上傳 / 同步 for its record. Built by
 *  the screen that owns the record (it knows the unit id). */
export type InatSheetState = {
  uploaded: boolean;
  /** Fingerprint differs from the last sync — label says 「有變更」. */
  changed: boolean;
  syncing: boolean;
  onPress: () => void;
};

/** 上傳到 iNat（未上傳）／同步 iNat（已上傳，變更時標示）— one row, iNat green. */
export function InatSyncButton({ state }: { state: InatSheetState }) {
  const { t } = useTranslation();
  const label = state.syncing
    ? t('inat.syncing')
    : !state.uploaded
      ? t('inat.uploadButton')
      : state.changed
        ? t('inat.syncChanged')
        : t('inat.syncButton');
  return (
    <Pressable
      onPress={state.onPress}
      disabled={state.syncing}
      className="mt-2 flex-row items-center rounded-lg border border-[#74AB00] px-3 py-2 active:bg-lime-50 dark:active:bg-lime-900/30"
    >
      <Ionicons name={state.uploaded ? 'sync-outline' : 'cloud-upload-outline'} size={18} color="#74AB00" />
      <Text className="ml-2 flex-1 text-sm text-lime-700 dark:text-lime-300">{label}</Text>
      {state.syncing ? <ActivityIndicator size="small" color="#74AB00" /> : <Ionicons name="chevron-forward" size={16} color="#9ca3af" />}
    </Pressable>
  );
}

export function InatUploadedBadge({ observationId }: { observationId: number }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => void Linking.openURL(observationWebUrl(observationId))}
      hitSlop={6}
      accessibilityRole="link"
      className="flex-row items-center rounded-full bg-lime-100 dark:bg-lime-900/40 px-2 py-0.5 active:opacity-70"
    >
      <Ionicons name="cloud-done-outline" size={13} color="#74AB00" />
      <Text className="ml-1 text-[11px] font-medium text-lime-700 dark:text-lime-300">{t('inat.uploadedBadge')}</Text>
      <Ionicons name="open-outline" size={11} color="#74AB00" style={{ marginLeft: 3 }} />
    </Pressable>
  );
}
