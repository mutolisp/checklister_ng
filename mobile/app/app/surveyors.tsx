import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { promptText } from '~/components/TextPromptModal';
import { SwipeRow } from '~/components/SwipeRow';
import { BackHeaderLeft } from '~/lib/goBack';
import { useSurveyors } from '~/stores/surveyors';

export default function SurveyorsScreen() {
  const items = useSurveyors((s) => s.items);
  const refresh = useSurveyors((s) => s.refresh);
  const add = useSurveyors((s) => s.add);
  const rename = useSurveyors((s) => s.rename);
  const remove = useSurveyors((s) => s.remove);
  const toggleDefault = useSurveyors((s) => s.toggleDefault);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  const handleAdd = async () => {
    const name = await promptText({
      title: '新增調查者',
      placeholder: '姓名',
      confirmText: '建立',
      autoCapitalize: 'words',
    });
    if (name?.trim()) add(name);
  };

  const handleRename = async (id: number, current: string) => {
    const name = await promptText({
      title: '改名',
      defaultValue: current,
      confirmText: '儲存',
      autoCapitalize: 'words',
    });
    if (name?.trim()) rename(id, name);
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: '調查者',
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
          標記「預設」(★) 的調查者，建立新的快速記錄 / 樣區 / 穿越線時會自動帶入。
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(s) => String(s.id)}
        ListEmptyComponent={
          <View className="px-4 py-16">
            <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
              尚無調查者，點右上角「＋」新增。
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <SwipeRow onDelete={() => remove(item.id)} label="刪除">
            <Pressable
              onPress={() => handleRename(item.id, item.name)}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
            >
              <Pressable
                onPress={() => toggleDefault(item.id, !item.is_default)}
                hitSlop={10}
                className="mr-3"
              >
                <Ionicons
                  name={item.is_default ? 'star' : 'star-outline'}
                  size={20}
                  color={item.is_default ? '#d97706' : '#9ca3af'}
                />
              </Pressable>
              <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">{item.name}</Text>
              {item.is_default ? (
                <Text className="text-xs font-medium text-amber-700 dark:text-amber-300">預設</Text>
              ) : null}
            </Pressable>
          </SwipeRow>
        )}
      />
    </SafeAreaView>
  );
}
