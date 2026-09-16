/**
 * 上一筆／下一筆調查記錄 —— a slim footer on a record detail screen that steps
 * to the neighbouring record without going back to the list first.
 *
 * Two deliberate choices:
 *
 * - **Neighbours are of the same kind.** 名錄 / 樣區 / 採集 are three different
 *   screens with different chrome; stepping from a 樣區 into a 名錄 would swap
 *   the whole UI under the user's thumb. Order is `listRecords(kind)`'s —
 *   active first, then newest — i.e. what the records tab shows.
 * - **`router.replace`, not `push`.** Walking ten records must not leave ten
 *   screens on the back stack; 返回 still means "back to the list".
 *
 * Placement matters: this bar has to sit ABOVE any `KeyboardStickyView` dock on
 * the screen. Chrome below a dock is exactly what `offset.opened` compensates
 * for, and putting it underneath would shove the search box behind the keyboard
 * (see scripts/check-bottom-dock.mjs).
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listRecords, type RecordItem, type RecordKind } from '~/db/records_list';

const ROUTE: Record<RecordKind, string> = {
  session: '/session',
  plot: '/plot',
  collection: '/collection',
};

type Neighbours = {
  prev: RecordItem | null;
  next: RecordItem | null;
  index: number;
  total: number;
};

const NONE: Neighbours = { prev: null, next: null, index: -1, total: 0 };

export function RecordStepBar({ kind, id }: { kind: RecordKind; id: number }) {
  const router = useRouter();
  const [n, setN] = useState<Neighbours>(NONE);

  // Recomputed on focus rather than memoised on [kind, id]: a record renamed or
  // ended elsewhere would otherwise leave a stale title on the button.
  useFocusEffect(
    useCallback(() => {
      const list = listRecords(kind);
      const index = list.findIndex((r) => r.id === id);
      setN(
        index < 0
          ? NONE
          : {
              prev: index > 0 ? list[index - 1] : null,
              next: index < list.length - 1 ? list[index + 1] : null,
              index,
              total: list.length,
            },
      );
    }, [kind, id]),
  );

  if (n.total <= 1 || n.index < 0) return null;

  const go = (item: RecordItem | null) => {
    if (item) router.replace(`${ROUTE[kind]}/${item.id}` as Href);
  };

  return (
    <View className="flex-row items-center border-t border-gray-200 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900">
      <StepButton item={n.prev} dir="prev" onPress={() => go(n.prev)} />
      <Text
        style={{ fontVariant: ['tabular-nums'] }}
        className="px-2 text-xs text-gray-400 dark:text-gray-500"
      >
        {n.index + 1} / {n.total}
      </Text>
      <StepButton item={n.next} dir="next" onPress={() => go(n.next)} />
    </View>
  );
}

function StepButton({
  item,
  dir,
  onPress,
}: {
  item: RecordItem | null;
  dir: 'prev' | 'next';
  onPress: () => void;
}) {
  const next = dir === 'next';
  return (
    <Pressable
      onPress={onPress}
      disabled={!item}
      accessibilityRole="button"
      accessibilityLabel={item?.title}
      className={`flex-1 flex-row items-center ${next ? 'justify-end' : 'justify-start'} px-2 py-1 active:opacity-60`}
    >
      {next ? null : (
        <Ionicons name="chevron-back" size={16} color={item ? '#6b7280' : '#d1d5db'} />
      )}
      <Text
        numberOfLines={1}
        className={`mx-1 flex-1 text-xs ${next ? 'text-right' : ''} ${
          item ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-gray-700'
        }`}
      >
        {item?.title ?? ''}
      </Text>
      {next ? (
        <Ionicons name="chevron-forward" size={16} color={item ? '#6b7280' : '#d1d5db'} />
      ) : null}
    </Pressable>
  );
}
