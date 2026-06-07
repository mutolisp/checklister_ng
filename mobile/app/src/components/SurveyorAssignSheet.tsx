import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useSurveyors } from '~/stores/surveyors';

type Props = {
  visible: boolean;
  /** Current recorded_by value (comma-separated names). */
  current: string;
  onCancel: () => void;
  onAssign: (value: string) => void;
};

function parseNames(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function SurveyorAssignSheet({ visible, current, onCancel, onAssign }: Props) {
  const insets = useSafeAreaInsets();
  const items = useSurveyors((s) => s.items);
  const add = useSurveyors((s) => s.add);

  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (visible) {
      setSelected(parseNames(current));
      setAdding(false);
      setNewName('');
    }
  }, [visible, current]);

  // Show known surveyors + any ad-hoc names already on the record (so editing
  // a free-typed recorded_by from older data doesn't silently drop them).
  const known = items.map((i) => i.name);
  const extras = parseNames(current).filter((n) => !known.includes(n));
  const rows = [...extras, ...known];

  const isSel = (name: string) => selected.includes(name);
  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const handleAddSubmit = () => {
    const n = newName.trim();
    if (!n) return;
    add(n);
    setSelected((prev) => (prev.includes(n) ? prev : [...prev, n]));
    setNewName('');
    setAdding(false);
  };

  const handleConfirm = () => {
    // Keep stable display order; drop names no longer selected.
    onAssign(rows.filter((n) => selected.includes(n)).join(', '));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1">
        <Pressable
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <KeyboardAvoidingView
          behavior="padding"
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
        >
          <View
            style={{ paddingBottom: insets.bottom + 8 }}
            className="rounded-t-2xl bg-white dark:bg-gray-900"
          >
            <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
              <View className="flex-1">
                <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">指派調查者</Text>
                <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  可多選；於「偏好設定 → 調查者」標記預設者，新記錄會自動帶入
                </Text>
              </View>
              <Pressable onPress={handleConfirm} hitSlop={8} className="ml-3">
                <Text className="text-base font-semibold text-blue-600 dark:text-blue-400">完成</Text>
              </Pressable>
            </View>

            {adding ? (
              <View className="flex-row items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-4 py-2">
                <TextInput
                  className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="調查者姓名"
                  placeholderTextColor="#9ca3af"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleAddSubmit}
                />
                <Pressable onPress={handleAddSubmit} hitSlop={6} className="px-2 py-1">
                  <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">加入</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setAdding(true)}
                className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 active:bg-blue-100 dark:active:bg-blue-900/60"
              >
                <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-blue-500">
                  <Ionicons name="add" size={20} color="white" />
                </View>
                <Text className="text-base font-semibold text-blue-700 dark:text-blue-300">新增調查者</Text>
              </Pressable>
            )}

            <ScrollView className="max-h-96">
              {rows.length === 0 ? (
                <View className="px-4 py-8">
                  <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
                    尚無調查者，點上方「新增調查者」建立。
                  </Text>
                </View>
              ) : (
                rows.map((name) => {
                  const active = isSel(name);
                  return (
                    <Pressable
                      key={name}
                      onPress={() => toggle(name)}
                      className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
                    >
                      <Ionicons
                        name={active ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={active ? '#2563eb' : '#9ca3af'}
                        style={{ marginRight: 12 }}
                      />
                      <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">{name}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
