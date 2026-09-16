/**
 * The identity footer of a record detail sheet: its DwC occurrenceID and when
 * the user last changed it.
 *
 * Sits at the bottom of the scrolling content, above the action buttons, in all
 * three detail sheets (名錄物種 / 樣區物種 / 採集標本) so the same record always
 * exposes the same two facts in the same place.
 *
 * The uuid is `selectable` rather than a copy button: it is there to be read
 * off or quoted when reconciling against an exported file or an iNaturalist
 * observation, and a Text selection needs no new permission or dependency.
 *
 * `uuid` and `iNaturalist ID` are deliberately NOT translated: they name identifiers
 * that appear verbatim in exports and in iNaturalist's own API, so a localised
 * label would only obscure what the value beside it actually is.
 */
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text, View } from 'react-native';
import { observationWebUrl } from '~/lib/inatApi';

/** `YYYY-MM-DD HH:mm` in the device's own timezone — the wall clock the
 *  surveyor was looking at, not UTC. Seconds are noise at this altitude. */
function formatStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

export function RecordMetaFooter({
  occurrenceId,
  updatedAt,
  inatObservationId,
}: {
  occurrenceId: string | null;
  /** Null only for a row written before v32 and never re-saved since. */
  updatedAt: number | null;
  /** Shown only once the record is actually on iNaturalist — callers pass the
   *  id gated the same way the external link is, so the two never disagree. */
  inatObservationId?: number | null;
}) {
  const { t } = useTranslation();
  if (!occurrenceId && updatedAt == null && inatObservationId == null) return null;
  return (
    <View className="mt-4 border-t border-gray-100 dark:border-gray-800 px-4 pt-3">
      {occurrenceId ? (
        <View className="flex-row">
          <Text className="w-28 text-[11px] text-gray-400 dark:text-gray-500">uuid</Text>
          <Text selectable className="flex-1 text-[11px] text-gray-500 dark:text-gray-400">
            {occurrenceId}
          </Text>
        </View>
      ) : null}
      {inatObservationId != null ? (
        <View className="mt-1 flex-row">
          <Text className="w-28 text-[11px] text-gray-400 dark:text-gray-500">iNaturalist ID</Text>
          <Pressable
            onPress={() => void Linking.openURL(observationWebUrl(inatObservationId))}
            hitSlop={6}
            accessibilityRole="link"
            className="flex-1 flex-row items-center active:opacity-60"
          >
            <Text className="text-[11px] text-blue-600 underline dark:text-blue-400">
              {inatObservationId}
            </Text>
            <Ionicons name="open-outline" size={11} color="#2563eb" style={{ marginLeft: 4 }} />
          </Pressable>
        </View>
      ) : null}
      {updatedAt != null ? (
        <View className="mt-1 flex-row">
          <Text className="w-28 text-[11px] text-gray-400 dark:text-gray-500">
            {t('record.lastUpdated')}
          </Text>
          <Text className="flex-1 text-[11px] text-gray-500 dark:text-gray-400">
            {formatStamp(updatedAt)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
