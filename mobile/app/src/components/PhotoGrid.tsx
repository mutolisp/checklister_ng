/**
 * Photo thumbnail grid + full-screen viewer modal. Used by SpeciesDetailSheet
 * (session record detail) and PlotSpeciesValueModal (plot species detail).
 *
 * `PhotoGrid` renders a 88×88 thumbnail per URI plus a trailing "+ 加照片"
 * tile. Tap → onView(idx); long-press → confirm-remove.
 * `PhotoViewerModal` is a horizontally pagable full-bleed image viewer.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, FlatList, Modal, Pressable, Text, View } from 'react-native';

export function PhotoGrid({
  photos,
  onAdd,
  onView,
  onRemove,
}: {
  photos: string[];
  onAdd: () => void;
  onView?: (index: number) => void;
  onRemove?: (uri: string) => void;
}) {
  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {photos.map((uri, idx) => (
        <Pressable
          key={uri}
          onPress={onView ? () => onView(idx) : undefined}
          onLongPress={
            onRemove
              ? () => {
                  Alert.alert('照片', undefined, [
                    { text: '取消', style: 'cancel' },
                    { text: '移除', style: 'destructive', onPress: () => onRemove(uri) },
                  ]);
                }
              : undefined
          }
          className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
          style={{ width: 88, height: 88 }}
        >
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        </Pressable>
      ))}
      <Pressable
        onPress={onAdd}
        className="items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 active:bg-gray-100 dark:active:bg-gray-700"
        style={{ width: 88, height: 88 }}
      >
        <Ionicons name="camera-outline" size={24} color="#6b7280" />
        <Text className="mt-1 text-xs text-gray-600 dark:text-gray-400">加照片</Text>
      </Pressable>
    </View>
  );
}

export function PhotoViewerModal({
  photos,
  index,
  onClose,
}: {
  photos: string[];
  index: number | null;
  onClose: () => void;
}) {
  const listRef = useRef<FlatList<string>>(null);
  const [current, setCurrent] = useState(index ?? 0);
  const { width, height } = Dimensions.get('window');

  useEffect(() => {
    if (index !== null) setCurrent(index);
  }, [index]);

  if (index === null || photos.length === 0) return null;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(uri) => uri}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / width);
            setCurrent(idx);
          }}
          renderItem={({ item }) => (
            <Pressable
              onPress={onClose}
              style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
            >
              <Image source={{ uri: item }} style={{ width, height: height * 0.85 }} contentFit="contain" />
            </Pressable>
          )}
        />
        <Pressable onPress={onClose} hitSlop={12} style={{ position: 'absolute', top: 56, right: 20 }}>
          <Ionicons name="close" size={32} color="#fff" />
        </Pressable>
        {photos.length > 1 ? (
          <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0 }} className="items-center">
            <View className="rounded-full bg-black/60 px-3 py-1">
              <Text className="text-sm text-white">
                {current + 1} / {photos.length}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
