import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  initialValue: string;
  title?: string;
  onCancel: () => void;
  onSave: (value: string) => void;
};

export function NotesEditModal({ visible, initialValue, title, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('session.editNotes');
  const [value, setValue] = useState(initialValue);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-white dark:bg-gray-900" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{resolvedTitle}</Text>
          <Pressable onPress={() => onSave(value.trim())} hitSlop={8}>
            <Text className="text-base font-semibold text-blue-600 dark:text-blue-400">{t('common.save')}</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <TextInput
            className="flex-1 px-4 py-3 text-base text-gray-900 dark:text-gray-100"
            value={value}
            onChangeText={setValue}
            multiline
            autoFocus
            placeholder={t('notes.placeholder')}
            placeholderTextColor="#9ca3af"
            textAlignVertical="top"
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
