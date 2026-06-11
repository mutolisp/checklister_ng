import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createProject, listProjects, type Project } from '~/db';
import { promptText } from './TextPromptModal';

type Props = {
  visible: boolean;
  currentProjectId: number;
  onCancel: () => void;
  onAssign: (projectId: number) => void;
};

export function ProjectAssignSheet({ visible, currentProjectId, onCancel, onAssign }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (visible) setProjects(listProjects());
  }, [visible]);

  const handleCreateInline = async () => {
    // iOS UIKit refuses to present a second Modal while a presented one is
    // still on-screen. We dismiss ourselves, wait for the animation to
    // finish, then open the text prompt — and only after a name comes back
    // do we notify the parent through `onAssign` (which the parent uses to
    // both pick the project AND close the sheet, which is already closed
    // here, harmlessly).
    onCancel();
    await new Promise((r) => setTimeout(r, 350));
    const name = await promptText({
      title: t('sheets.newProject'),
      message: t('sheets.newProjectMsg'),
      placeholder: t('sheets.projectNamePlaceholder'),
      confirmText: t('surveyors.create'),
    });
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    const id = createProject({
      name: trimmed,
      abstract: null,
      location_description: null,
      notes: null,
    });
    setProjects(listProjects());
    onAssign(id);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1">
        <Pressable
          onPress={onCancel}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 8 }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <View className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('sheets.assignProject')}</Text>
            <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t('sheets.assignProjectDesc')}
            </Text>
          </View>
          <Pressable
            onPress={handleCreateInline}
            className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 active:bg-blue-100 dark:active:bg-blue-900/60"
          >
            <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-blue-500">
              <Ionicons name="add" size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-blue-700 dark:text-blue-300">{t('sheets.newProject')}</Text>
              <Text className="text-xs text-blue-600 dark:text-blue-400">{t('sheets.newProjectDesc')}</Text>
            </View>
          </Pressable>
          <ScrollView className="max-h-96">
            {projects.map((p) => {
              const active = p.id === currentProjectId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onAssign(p.id)}
                  className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
                >
                  <Ionicons
                    name={p.id === 0 ? 'help-circle-outline' : 'folder-outline'}
                    size={20}
                    color="#6b7280"
                    style={{ marginRight: 12 }}
                  />
                  <View className="flex-1">
                    <Text
                      className={`text-base ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'} ${p.id === 0 ? 'italic text-gray-500 dark:text-gray-400' : ''}`}
                    >
                      {p.name}
                    </Text>
                    {p.location_description ? (
                      <Text className="text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                        {p.location_description}
                      </Text>
                    ) : null}
                  </View>
                  {active ? <Ionicons name="checkmark" size={20} color="#2563eb" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
