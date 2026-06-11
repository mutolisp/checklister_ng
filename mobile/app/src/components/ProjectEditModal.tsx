import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Project, ProjectInput } from '~/db';

const EMPTY: ProjectInput = { name: '', abstract: null, location_description: null, notes: null };

export type ProjectEditTarget = Project | 'new' | null;

type Props = {
  target: ProjectEditTarget;
  onCancel: () => void;
  onSave: (data: ProjectInput) => void;
  /** Optional override for the title text */
  newTitle?: string;
  editTitle?: string;
};

export function ProjectEditModal({
  target,
  onCancel,
  onSave,
  newTitle,
  editTitle,
}: Props) {
  const { t } = useTranslation();
  const resolvedNew = newTitle ?? t('sheets.addProjectTitle');
  const resolvedEdit = editTitle ?? t('sheets.editProjectTitle');
  const visible = target !== null;
  const initial = target === 'new' || target === null ? EMPTY : target;
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(initial.name);
  const [abstract, setAbstract] = useState(initial.abstract ?? '');
  const [location, setLocation] = useState(initial.location_description ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');

  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setAbstract(initial.abstract ?? '');
      setLocation(initial.location_description ?? '');
      setNotes(initial.notes ?? '');
    }
  }, [visible, initial]);

  const isNew = target === 'new';
  const canSave = name.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View
        className="flex-1 bg-white dark:bg-gray-900"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{isNew ? resolvedNew : resolvedEdit}</Text>
          <Pressable
            onPress={() => {
              if (!canSave) return;
              onSave({
                name: name.trim(),
                abstract: abstract.trim() || null,
                location_description: location.trim() || null,
                notes: notes.trim() || null,
              });
            }}
            hitSlop={8}
          >
            <Text className={`text-base font-semibold ${canSave ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300'}`}>
              {t('common.save')}
            </Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <Field label={t('sheets.projectName')}>
              <TextInput
                value={name}
                onChangeText={setName}
                autoFocus={isNew}
                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                placeholder={t('sheets.projectNameEx')}
                placeholderTextColor="#9ca3af"
              />
            </Field>
            <Field label={t('sheets.summary')}>
              <TextInput
                value={abstract}
                onChangeText={setAbstract}
                multiline
                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />
            </Field>
            <Field label={t('sheets.locationDesc')}>
              <TextInput
                value={location}
                onChangeText={setLocation}
                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
              />
            </Field>
            <Field label={t('sheets.note')}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                style={{ minHeight: 100, textAlignVertical: 'top' }}
              />
            </Field>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
      <Text className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</Text>
      {children}
    </View>
  );
}
