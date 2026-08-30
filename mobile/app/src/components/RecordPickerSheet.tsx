/**
 * Multi-select picker over existing records (名錄 / 樣區 / 標本).
 *
 * `showActionSheet` can only return one index, so anything multi-select needs
 * its own sheet. Layout mirrors `SurveyorAssignSheet` (the other multi-select
 * sheet): manual `insets.top` margin plus `SafeAreaView edges={['bottom']}`,
 * because a RN Modal has no safe-area provider context of its own.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RecordItem, RecordKind } from '~/db';

const KIND_LABEL: Record<RecordKind, string> = {
  session: 'favorites.kindSession',
  plot: 'favorites.kindPlot',
  collection: 'favorites.kindCollection',
};

type Props = {
  visible: boolean;
  records: RecordItem[];
  onCancel: () => void;
  onConfirm: (selected: RecordItem[]) => void;
};

export function RecordPickerSheet({ visible, records, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Fresh selection every time the sheet opens.
  useEffect(() => {
    if (visible) setSelected(new Set());
  }, [visible]);

  // kind+id, because ids are only unique within a kind.
  const keyOf = (r: RecordItem) => `${r.kind}:${r.id}`;
  const allSelected = records.length > 0 && selected.size === records.length;

  const toggle = (r: RecordItem) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(r);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(records.map(keyOf)));

  const totalSpecies = records
    .filter((r) => selected.has(keyOf(r)))
    .reduce((sum, r) => sum + r.recordCount, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 justify-end">
        <Pressable
          onPress={onCancel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        <View
          style={{ marginTop: insets.top + 16 }}
          className="flex-1 rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="flex-1">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>

            <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
              <Pressable onPress={onCancel} hitSlop={8}>
                <Text className="text-base text-gray-500 dark:text-gray-400">{t('common.cancel')}</Text>
              </Pressable>
              <View className="flex-1 px-3">
                <Text className="text-center text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t('favorites.importFromRecord')}
                </Text>
                <Text className="mt-0.5 text-center text-xs text-gray-500 dark:text-gray-400">
                  {t('favorites.pickerSummary', { records: selected.size, species: totalSpecies })}
                </Text>
              </View>
              <Pressable
                onPress={() => onConfirm(records.filter((r) => selected.has(keyOf(r))))}
                disabled={selected.size === 0}
                hitSlop={8}
              >
                <Text
                  className={`text-base font-semibold ${
                    selected.size === 0
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {t('common.done')}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={toggleAll}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-2 active:bg-gray-50 dark:active:bg-gray-800"
            >
              <Ionicons
                name={allSelected ? 'checkbox' : 'square-outline'}
                size={20}
                color={allSelected ? '#2563eb' : '#9ca3af'}
              />
              <Text className="ml-3 text-sm text-gray-700 dark:text-gray-300">
                {allSelected ? t('favorites.deselectAll') : t('favorites.selectAll')}
              </Text>
            </Pressable>

            <FlatList
              data={records}
              keyExtractor={keyOf}
              renderItem={({ item }) => {
                const on = selected.has(keyOf(item));
                return (
                  <Pressable
                    onPress={() => toggle(item)}
                    className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
                  >
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={on ? '#2563eb' : '#9ca3af'}
                    />
                    <View className="ml-3 flex-1">
                      <Text className="text-sm text-gray-900 dark:text-gray-100" numberOfLines={1}>
                        <Text className="text-gray-500 dark:text-gray-400">
                          [{t(KIND_LABEL[item.kind])}]{' '}
                        </Text>
                        {item.title}
                      </Text>
                      <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                        {item.projectName}
                      </Text>
                    </View>
                    <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      {t('favorites.count', { count: item.recordCount })}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
