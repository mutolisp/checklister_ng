import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { parsePhotoPaths, type RecordWithTaxon } from '~/db';
import { alienBadge } from '~/lib/conservationColors';
import { ConservationBadge } from './ConservationBadge';
import { ScientificName } from './ScientificName';
import { SynonymStatusBadge } from './CollapsibleSection';

type Props = {
  record: RecordWithTaxon;
  onPress: () => void;
  onLongPress?: () => void;
};

export function SpeciesCard({ record, onPress, onLongPress }: Props) {
  const { t } = useTranslation();
  const isEndemic = record.is_endemic === 'true';
  const ab = alienBadge(record.alien_type, record.kingdom);
  const photos = parsePhotoPaths(record.photo_paths);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      {photos.length > 0 ? (
        <View className="mr-3 h-14 w-14 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
          <Image
            source={{ uri: photos[0] }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
          {photos.length > 1 ? (
            <View
              className="absolute bottom-0 right-0 flex-row items-center rounded-tl-md bg-black/60 px-1 py-0.5"
            >
              <Text className="text-[10px] font-semibold text-white">×{photos.length}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View className="mr-3 h-14 w-14 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800" />
      )}
      <View className="flex-1">
        <Text className="font-medium text-gray-900 dark:text-gray-100" numberOfLines={1}>
          {record.common_name_c || t('species.noChineseName')}
        </Text>
        <View className="mt-0.5 flex-row items-center">
          <ScientificName
            name={record.simple_name}
            author={record.name_author}
            kingdom={record.kingdom}
            className="flex-shrink text-sm text-gray-700 dark:text-gray-300"
            numberOfLines={1}
          />
          {/* This record was filed under a name the checklist does not treat as
              accepted — without the badge the name looks like a data error
              rather than the recorder's decision. */}
          {record.used_status && record.used_status !== 'accepted' ? (
            <SynonymStatusBadge status={record.used_status} />
          ) : null}
        </View>
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {record.family_c} {record.family}
        </Text>
      </View>
      <View className="ml-2 items-end justify-start">
        <View className="flex-row items-center">
          {isEndemic ? (
            <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('species.endemicShort')}</Text>
          ) : null}
          {ab ? (
            <Text className={`${isEndemic ? 'ml-1.5' : ''} text-xs font-medium ${ab.textClass}`}>
              {ab.shortLabel}
            </Text>
          ) : null}
        </View>
        {record.redlist ? (
          <View className="mt-1">
            <ConservationBadge code={record.redlist} />
          </View>
        ) : null}
        {record.protected ? (
          <Text className="mt-1 text-xs italic text-gray-600 dark:text-gray-400">{record.protected}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
