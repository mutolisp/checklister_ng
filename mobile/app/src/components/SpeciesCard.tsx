import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import { parsePhotoPaths, type RecordWithTaxon } from '~/db';
import { ScientificName } from './ScientificName';

type Props = {
  record: RecordWithTaxon;
  onPress: () => void;
  onLongPress?: () => void;
};

function statusColor(redlist: string): string {
  if (!redlist) return 'bg-gray-200 text-gray-600';
  if (['CR', 'EN', 'VU'].includes(redlist)) return 'bg-red-100 text-red-700';
  if (['NT', 'NEN'].includes(redlist)) return 'bg-orange-100 text-orange-700';
  if (['LC', 'NLC'].includes(redlist)) return 'bg-emerald-100 text-emerald-700';
  return 'bg-gray-100 text-gray-700';
}

export function SpeciesCard({ record, onPress, onLongPress }: Props) {
  const isEndemic = record.is_endemic === 'true';
  const statusCls = statusColor(record.redlist);
  const photos = parsePhotoPaths(record.photo_paths);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row border-b border-gray-100 bg-white px-4 py-3 active:bg-gray-50"
    >
      {photos.length > 0 ? (
        <View className="mr-3 h-14 w-14 overflow-hidden rounded-md bg-gray-100">
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
        <View className="mr-3 h-14 w-14 items-center justify-center rounded-md bg-gray-100" />
      )}
      <View className="flex-1">
        <Text className="font-medium text-gray-900" numberOfLines={1}>
          {record.common_name_c || '(無中文名)'}
        </Text>
        <ScientificName
          name={record.simple_name}
          author={record.name_author}
          kingdom={record.kingdom}
          className="mt-0.5 text-sm text-gray-700"
          numberOfLines={1}
        />
        <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
          {record.family_c} {record.family}
        </Text>
      </View>
      <View className="ml-2 items-end justify-start">
        {isEndemic ? <Text className="text-xs text-emerald-700">特有</Text> : null}
        {record.redlist ? (
          <View className={`mt-1 rounded-full px-2 py-0.5 ${statusCls.split(' ')[0]}`}>
            <Text className={`text-xs font-medium ${statusCls.split(' ')[1]}`}>{record.redlist}</Text>
          </View>
        ) : null}
        {record.protected ? (
          <Text className="mt-1 text-xs italic text-gray-600">{record.protected}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
