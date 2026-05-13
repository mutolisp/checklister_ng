import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { SINICA_LAYERS } from '~/lib/sinicaLayers';

type Props = {
  visible: boolean;
  selectedId: string;
  opacity: number;
  onClose: () => void;
  onSelect: (id: string) => void;
  onOpacityChange: (v: number) => void;
};

export function SinicaLayerSheet({ visible, selectedId, opacity, onClose, onSelect, onOpacityChange }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return SINICA_LAYERS;
    return SINICA_LAYERS.filter((l) => l.title.includes(q) || l.id.toLowerCase().includes(q.toLowerCase()));
  }, [query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '75%', paddingBottom: insets.bottom }}
          className="rounded-t-2xl bg-white"
        >
          <View className="items-center pt-2">
            <View className="h-1 w-12 rounded-full bg-gray-300" />
          </View>

          <View className="flex-row items-center justify-between border-b border-gray-100 px-4 py-3">
            <Text className="text-base font-semibold text-gray-900">中研院 WMTS 圖層</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#6b7280" />
            </Pressable>
          </View>

          {selectedId ? (
            <View className="border-b border-gray-100 bg-blue-50 px-4 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-xs font-medium text-blue-900" numberOfLines={1}>
                  目前疊圖：{SINICA_LAYERS.find((l) => l.id === selectedId)?.title ?? selectedId}
                </Text>
                <Pressable onPress={() => onSelect('')} hitSlop={6} className="ml-2">
                  <Text className="text-xs font-medium text-red-600">移除</Text>
                </Pressable>
              </View>
              <View className="mt-2 flex-row items-center">
                <Text className="w-12 text-xs text-blue-900">不透明</Text>
                <Slider
                  style={{ flex: 1, height: 30 }}
                  value={opacity}
                  minimumValue={0.1}
                  maximumValue={1}
                  step={0.05}
                  minimumTrackTintColor="#2563eb"
                  onValueChange={onOpacityChange}
                />
                <Text className="w-10 text-right text-xs text-blue-900">{Math.round(opacity * 100)}%</Text>
              </View>
            </View>
          ) : null}

          <View className="border-b border-gray-100 px-3 py-2">
            <View className="flex-row items-center rounded-full bg-gray-100 px-3 py-2">
              <Ionicons name="search" size={16} color="#6b7280" />
              <TextInput
                className="ml-2 flex-1 text-sm text-gray-900"
                placeholder={`搜尋 ${SINICA_LAYERS.length} 個圖層`}
                placeholderTextColor="#9ca3af"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={6}>
                  <Ionicons name="close-circle" size={16} color="#9ca3af" />
                </Pressable>
              ) : null}
            </View>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(l) => l.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const active = item.id === selectedId;
              return (
                <Pressable
                  onPress={() => onSelect(item.id)}
                  className={`flex-row items-center border-b border-gray-100 px-4 py-2.5 ${active ? 'bg-blue-50' : 'active:bg-gray-50'}`}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={16}
                    color={active ? '#2563eb' : '#9ca3af'}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    className={`flex-1 text-sm ${active ? 'font-medium text-blue-700' : 'text-gray-800'}`}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View className="px-4 py-8">
                <Text className="text-center text-sm text-gray-500">沒有符合的圖層</Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}
