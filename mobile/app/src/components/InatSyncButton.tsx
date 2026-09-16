/**
 * The single iNaturalist affordance on a record's detail sheet.
 *
 * It used to share the job with an 「已上傳 iNat」 pill in the header, which said
 * the same thing twice: the state is already visible in this row's own label
 * and icon, and the observation id now sits in the record footer. One control
 * that changes wording with the state is easier to read than two.
 */
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text } from 'react-native';

/** What a detail sheet needs to offer 上傳 / 同步 for its record. Built by
 *  the screen that owns the record (it knows the unit id). */
export type InatSheetState = {
  uploaded: boolean;
  /** Fingerprint differs from the last sync — label says 「有變更」. */
  changed: boolean;
  syncing: boolean;
  onPress: () => void;
};

/** 上傳 iNaturalist（未上傳）／同步 iNaturalist（已上傳，變更時標示）—
 *  one row, iNaturalist green. */
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
