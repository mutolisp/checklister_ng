import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TaxonGroup } from '~/db/types';

export const TAXON_GROUP_OPTIONS: Array<{ value: TaxonGroup | ''; label: string }> = [
  { value: '', label: '全部類群' },
  { value: 'Tracheophyta', label: '維管束植物' },
  { value: 'Plantae', label: '植物（含苔蘚）' },
  { value: 'Aves', label: '鳥類' },
  { value: 'Mammalia', label: '哺乳類' },
  { value: 'Reptilia', label: '爬蟲類' },
  { value: 'Amphibia', label: '兩棲類' },
  { value: 'Insecta', label: '昆蟲' },
  { value: 'Arachnida', label: '蜘蛛類' },
  { value: 'Mollusca', label: '軟體動物' },
  { value: 'Actinopterygii', label: '條鰭魚類' },
  { value: 'Fungi', label: '真菌' },
  { value: 'Protozoa', label: '原生動物' },
  { value: 'Animalia', label: '其他動物' },
];

export function getGroupLabel(value: TaxonGroup | ''): string {
  return TAXON_GROUP_OPTIONS.find((o) => o.value === value)?.label ?? '全部類群';
}

type Props = {
  value: TaxonGroup | '';
  onChange: (value: TaxonGroup | '') => void;
};

export function TaxonGroupPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center rounded-full bg-blue-50 px-3 py-1.5 active:bg-blue-100"
      >
        <Ionicons name="filter" size={14} color="#2563eb" />
        <Text className="ml-1 text-xs font-medium text-blue-700">{getGroupLabel(value)}</Text>
        <Ionicons name="chevron-down" size={12} color="#2563eb" />
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} className="flex-1 bg-black/40">
          <Pressable className="mt-auto rounded-t-2xl bg-white pb-6">
            <SafeAreaView edges={['bottom']}>
              <View className="border-b border-gray-200 px-4 py-3">
                <Text className="text-base font-semibold text-gray-900">搜尋限定類群</Text>
                <Text className="mt-0.5 text-xs text-gray-500">選定後，搜尋只會在該類群內查詢</Text>
              </View>
              <ScrollView className="max-h-96">
                {TAXON_GROUP_OPTIONS.map((opt) => {
                  const active = opt.value === value;
                  return (
                    <Pressable
                      key={opt.value || 'all'}
                      onPress={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`flex-row items-center border-b border-gray-100 px-4 py-3 ${active ? 'bg-blue-50' : 'active:bg-gray-50'}`}
                    >
                      <Text className={`flex-1 text-base ${active ? 'font-semibold text-blue-700' : 'text-gray-900'}`}>
                        {opt.label}
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
    </>
  );
}
