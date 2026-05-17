/**
 * Cross-platform text prompt — replacement for iOS-only `Alert.prompt`.
 *
 * Usage:
 *
 *   import { promptText } from '~/components/TextPromptModal';
 *
 *   const value = await promptText({
 *     title: '新建專案',
 *     placeholder: '專案名稱',
 *     defaultValue: '',
 *   });
 *   if (value !== null) doSomething(value);
 *
 * The host (`<TextPromptHost />`) must be mounted somewhere near the root of
 * the navigation tree so the modal can render above all screens.
 */
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';

type PromptOptions = {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'email-address';
  /** When true, allow blank confirm (otherwise the OK button stays disabled). */
  allowEmpty?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

type PromptRequest = PromptOptions & {
  resolve: (value: string | null) => void;
};

type PromptStoreState = {
  pending: PromptRequest | null;
  open: (req: PromptRequest) => void;
  resolve: (value: string | null) => void;
};

const usePromptStore = create<PromptStoreState>((set, get) => ({
  pending: null,
  open: (req) => set({ pending: req }),
  resolve: (value) => {
    const p = get().pending;
    if (p) p.resolve(value);
    set({ pending: null });
  },
}));

/** Imperative API: pops up the prompt and resolves with the entered string,
 *  or `null` if the user cancelled. */
export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    usePromptStore.getState().open({ ...options, resolve });
  });
}

export function TextPromptHost() {
  const pending = usePromptStore((s) => s.pending);
  const resolve = usePromptStore((s) => s.resolve);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (pending) setValue(pending.defaultValue ?? '');
  }, [pending]);

  if (!pending) return null;

  const canConfirm = pending.allowEmpty ? true : value.trim().length > 0;
  const handleCancel = () => resolve(null);
  const handleConfirm = () => {
    if (!canConfirm) return;
    resolve(value);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Pressable
          onPress={handleCancel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        <SafeAreaView edges={['top', 'bottom']} className="flex-1 items-center justify-center px-6">
          <View className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900">
            <View className="px-5 pt-5 pb-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{pending.title}</Text>
              {pending.message ? (
                <Text className="mt-1 text-sm text-gray-600 dark:text-gray-400">{pending.message}</Text>
              ) : null}
            </View>
            <View className="px-5 pb-3">
              <TextInput
                value={value}
                onChangeText={setValue}
                onSubmitEditing={handleConfirm}
                placeholder={pending.placeholder}
                placeholderTextColor="#9ca3af"
                keyboardType={pending.keyboardType ?? 'default'}
                autoCapitalize={pending.autoCapitalize ?? 'sentences'}
                autoFocus
                returnKeyType="done"
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-3 text-base text-gray-900 dark:text-gray-100"
              />
            </View>
            <View className="flex-row border-t border-gray-100 dark:border-gray-800">
              <Pressable
                onPress={handleCancel}
                className="flex-1 items-center justify-center border-r border-gray-100 dark:border-gray-800 py-3 active:bg-gray-50 dark:active:bg-gray-800"
              >
                <Text className="text-base text-gray-700 dark:text-gray-300">{pending.cancelText ?? '取消'}</Text>
              </Pressable>
              <Pressable
                onPress={canConfirm ? handleConfirm : undefined}
                disabled={!canConfirm}
                className={`flex-1 items-center justify-center py-3 ${canConfirm ? 'active:bg-blue-50 dark:active:bg-blue-900/40' : ''}`}
              >
                <Text
                  className={`text-base font-semibold ${canConfirm ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}
                >
                  {pending.confirmText ?? '確定'}
                </Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
