/**
 * Options for a herbarium label sheet, asked once before the export runs.
 *
 * Built on the bottom-sheet shape used elsewhere (Modal → KeyboardAvoidingView
 * with `flex-1 justify-end` → panel) rather than ExportPreferenceSheet's,
 * because this one has a TextInput: ExportPreferenceSheet has no keyboard
 * avoidance and its confirm button would end up behind the keyboard.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useThemeColors } from '~/hooks/useThemeColors';
import { useSettings } from '~/stores/settings';

type Props = {
  visible: boolean;
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (title: string, includeFamily: boolean) => void;
};

export function LabelExportSheet({ visible, count, busy, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const savedTitle = useSettings((s) => s.collection_label_title);
  const savedFamily = useSettings((s) => s.collection_label_family);
  const setSetting = useSettings((s) => s.set);

  const [title, setTitle] = useState(savedTitle);
  const [includeFamily, setIncludeFamily] = useState(savedFamily);

  // Re-seed on each open; the stored value may have changed since mount.
  useEffect(() => {
    if (!visible) return;
    setTitle(savedTitle);
    setIncludeFamily(savedFamily);
  }, [visible, savedTitle, savedFamily]);

  const confirm = () => {
    const next = title.trim();
    setSetting('collection_label_title', next);
    setSetting('collection_label_family', includeFamily);
    onConfirm(next, includeFamily);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable
          onPress={onCancel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        {/* `marginTop` is what stops the sheet from growing under the notch /
            Dynamic Island once the keyboard pushes it up — a bottom sheet with
            only a bottom inset has nothing bounding its top edge. `flexShrink`
            is the other half: without it the panel keeps its content height and
            simply overflows past the margin instead of yielding to it, and the
            inner ScrollView never gets a bounded height to scroll within. */}
        <View
          className="rounded-t-2xl bg-white dark:bg-gray-900"
          style={{ marginTop: insets.top + 16, flexShrink: 1, paddingBottom: insets.bottom + 12 }}
        >
          <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text className="text-base text-blue-500">{t('common.cancel')}</Text>
            </Pressable>
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('collection.labelSheetTitle')}
            </Text>
            <View className="w-14" />
          </View>

          <ScrollView className="px-4" contentContainerClassName="py-4" keyboardShouldPersistTaps="handled">
            <Text className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              {t('collection.labelSheetDesc')}
            </Text>

            <Text className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              {t('collection.labelHeading')}
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t('collection.labelHeadingPlaceholder')}
              placeholderTextColor={colors.placeholder}
              className="mb-4 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 dark:border-gray-600 dark:text-gray-100"
            />

            <View className="mb-5 flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-sm text-gray-900 dark:text-gray-100">
                  {t('collection.labelIncludeFamily')}
                </Text>
                <Text className="text-xs text-gray-500 dark:text-gray-400">
                  {t('collection.labelIncludeFamilyHint')}
                </Text>
              </View>
              <Switch value={includeFamily} onValueChange={setIncludeFamily} />
            </View>

            <Pressable
              onPress={confirm}
              disabled={busy}
              className={`items-center rounded-xl py-3 ${
                busy ? 'bg-gray-300 dark:bg-gray-700' : 'bg-blue-500 active:bg-blue-600'
              }`}
            >
              <Text className="text-base font-semibold text-white">
                {busy ? t('export.exporting') : t('collection.labelExportCount', { count })}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
