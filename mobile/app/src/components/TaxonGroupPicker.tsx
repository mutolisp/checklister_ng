import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '~/i18n';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TaxonGroup } from '~/db/types';

export const TAXON_GROUP_OPTIONS: Array<{ value: TaxonGroup | '' }> = [
  { value: '' },
  { value: 'Tracheophyta' },
  { value: 'Plantae' },
  { value: 'Aves' },
  { value: 'Mammalia' },
  { value: 'Reptilia' },
  { value: 'Amphibia' },
  { value: 'Insecta' },
  { value: 'Arachnida' },
  { value: 'Mollusca' },
  { value: 'Actinopterygii' },
  { value: 'Fungi' },
  { value: 'Protozoa' },
  { value: 'Animalia' },
];

export function getGroupLabel(value: TaxonGroup | ''): string {
  return i18n.t('taxonGroup.' + (value || 'all'));
}

/** Above this count we collapse the selected-chips strip into a single
 *  「N 個分類群」 summary to keep the search toolbar compact. */
const MAX_INLINE_CHIPS = 5;

type Props = {
  /** Currently selected groups. Empty = 全部類群 (no restriction). */
  value: TaxonGroup[];
  onChange: (value: TaxonGroup[]) => void;
};

export function TaxonGroupPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const toggle = (g: TaxonGroup) => {
    if (value.includes(g)) onChange(value.filter((x) => x !== g));
    else onChange([...value, g]);
  };

  return (
    <View className="flex-1 flex-row items-center">
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center rounded-full bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 active:bg-blue-100 dark:active:bg-blue-900/60"
      >
        <Ionicons name="filter" size={14} color="#2563eb" />
        <Ionicons name="chevron-down" size={12} color="#2563eb" style={{ marginLeft: 2 }} />
      </Pressable>

      {value.length === 0 ? (
        <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400">{t('taxonGroup.all')}</Text>
      ) : value.length > MAX_INLINE_CHIPS ? (
        <Pressable onPress={() => setOpen(true)} className="ml-2">
          <Text className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {t('taxonGroup.selectedGroups', { count: value.length })}
          </Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          className="ml-2 flex-1"
          contentContainerStyle={{ alignItems: 'center', gap: 6, paddingRight: 4 }}
        >
          {value.map((g) => (
            <Pressable
              key={g}
              onPress={() => toggle(g)}
              className="flex-row items-center rounded-full bg-blue-100 dark:bg-blue-900/60 px-2 py-1 active:bg-blue-200 dark:active:bg-blue-800"
            >
              <Text className="text-xs font-medium text-blue-700 dark:text-blue-300">
                {getGroupLabel(g)}
              </Text>
              <Ionicons name="close" size={12} color="#2563eb" style={{ marginLeft: 2 }} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} className="flex-1 bg-black/40">
          <Pressable className="mt-auto rounded-t-2xl bg-white dark:bg-gray-900 pb-6">
            <SafeAreaView edges={['bottom']}>
              <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                <View className="flex-1">
                  <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('taxonGroup.limitTitle')}</Text>
                  <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {t('taxonGroup.limitHint')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setOpen(false)}
                  className="ml-3 rounded-full bg-blue-600 px-4 py-1.5 active:bg-blue-700"
                >
                  <Text className="text-sm font-medium text-white">{t('common.done')}</Text>
                </Pressable>
              </View>
              <ScrollView className="max-h-96">
                {TAXON_GROUP_OPTIONS.map((opt) => {
                  const isAll = opt.value === '';
                  const active = isAll ? value.length === 0 : value.includes(opt.value as TaxonGroup);
                  return (
                    <Pressable
                      key={opt.value || 'all'}
                      onPress={() => {
                        if (isAll) onChange([]);
                        else toggle(opt.value as TaxonGroup);
                      }}
                      className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
                    >
                      <Text className={`flex-1 text-base ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}>
                        {getGroupLabel(opt.value)}
                      </Text>
                      {active ? <Ionicons name="checkmark" size={20} color="#2563eb" /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
