import { useState, useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  initialValue: string;
  title?: string;
  onCancel: () => void;
  onSave: (value: string) => void;
};

export function NotesEditModal({ visible, initialValue, title = '編輯備註', onCancel, onSave }: Props) {
  const [value, setValue] = useState(initialValue);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700">取消</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900">{title}</Text>
          <Pressable onPress={() => onSave(value.trim())} hitSlop={8}>
            <Text className="text-base font-semibold text-blue-600">儲存</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TextInput
            className="flex-1 px-4 py-3 text-base text-gray-900"
            value={value}
            onChangeText={setValue}
            multiline
            autoFocus
            placeholder="輸入備註（觀察行為、環境條件等）"
            placeholderTextColor="#9ca3af"
            textAlignVertical="top"
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
