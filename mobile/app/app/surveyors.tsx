import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import { promptText } from '~/components/TextPromptModal';
import { SwipeRow } from '~/components/SwipeRow';
import { BackHeaderLeft } from '~/lib/goBack';
import { useSurveyors } from '~/stores/surveyors';
import type { Surveyor } from '~/db';

export default function SurveyorsScreen() {
  const { t } = useTranslation();
  const items = useSurveyors((s) => s.items);
  const refresh = useSurveyors((s) => s.refresh);
  const add = useSurveyors((s) => s.add);
  const rename = useSurveyors((s) => s.rename);
  const remove = useSurveyors((s) => s.remove);
  const toggleDefault = useSurveyors((s) => s.toggleDefault);
  const reorder = useSurveyors((s) => s.reorder);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  const handleAdd = async () => {
    const name = await promptText({
      title: t('surveyors.addTitle'),
      placeholder: t('surveyors.namePlaceholder'),
      confirmText: t('surveyors.create'),
      autoCapitalize: 'words',
    });
    if (name?.trim()) add(name);
  };

  const handleRename = async (id: number, current: string) => {
    const name = await promptText({
      title: t('surveyors.renameTitle'),
      defaultValue: current,
      confirmText: t('common.save'),
      autoCapitalize: 'words',
    });
    if (name?.trim()) rename(id, name);
  };

  const renderItem = ({ item, drag, isActive }: RenderItemParams<Surveyor>) => (
    <ScaleDecorator>
      <SwipeRow onDelete={() => remove(item.id)} label={t('common.delete')}>
        <View
          className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 ${isActive ? 'opacity-90' : ''}`}
        >
          <Pressable
            onPress={() => toggleDefault(item.id, !item.is_default)}
            hitSlop={10}
            className="mr-3 py-3"
          >
            <Ionicons
              name={item.is_default ? 'star' : 'star-outline'}
              size={20}
              color={item.is_default ? '#d97706' : '#9ca3af'}
            />
          </Pressable>
          <Pressable
            onPress={() => handleRename(item.id, item.name)}
            className="flex-1 py-3 active:opacity-60"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">{item.name}</Text>
          </Pressable>
          {item.is_default ? (
            <Text className="mr-3 text-xs font-medium text-amber-700 dark:text-amber-300">{t('surveyors.default')}</Text>
          ) : null}
          {/* Drag handle — long-press to pick up and reorder. */}
          <Pressable onLongPress={drag} delayLongPress={120} hitSlop={10} className="py-3 pl-1">
            <Ionicons name="reorder-three" size={24} color="#9ca3af" />
          </Pressable>
        </View>
      </SwipeRow>
    </ScaleDecorator>
  );

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: t('nav.surveyors'),
          headerLeft: BackHeaderLeft,
          headerRight: () => (
            <Pressable onPress={handleAdd} hitSlop={8}>
              <Ionicons name="add" size={26} color="#2563eb" />
            </Pressable>
          ),
        }}
      />
      <View className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-2">
        <Text className="text-xs text-gray-500 dark:text-gray-400">
          {t('surveyors.hint')}
        </Text>
      </View>
      <DraggableFlatList
        data={items}
        keyExtractor={(s) => String(s.id)}
        onDragEnd={({ data }) => reorder(data)}
        containerStyle={{ flex: 1 }}
        ListEmptyComponent={
          <View className="px-4 py-16">
            <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
              {t('surveyors.empty')}
            </Text>
          </View>
        }
        renderItem={renderItem}
      />
    </SafeAreaView>
  );
}
