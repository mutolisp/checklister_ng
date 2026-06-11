import { Ionicons } from '@expo/vector-icons';
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
import { createProject, listProjects, type Project } from '~/db';
import { promptText } from './TextPromptModal';

type Props = {
  visible: boolean;
  defaultName?: string;
  defaultProjectId?: number;
  defaultNotes?: string;
  geometryType: 'Point' | 'LineString' | 'Polygon';
  vertexCount: number;
  title?: string;
  onCancel: () => void;
  onConfirm: (data: { name: string; project_id: number; notes: string | null }) => void;
};

const TYPE_LABEL: Record<Props['geometryType'], string> = {
  Point: 'sites.typePoint',
  LineString: 'sites.typeLineString',
  Polygon: 'sites.typePolygon',
};

export function SaveSiteModal({
  visible,
  defaultName = '',
  defaultProjectId = 0,
  defaultNotes = '',
  geometryType,
  vertexCount,
  title,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('sheets.saveSite');
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(defaultName);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [notes, setNotes] = useState(defaultNotes);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const handleCreateProjectInline = async () => {
    // iOS UIKit refuses to stack a second Modal on top of an already-presented
    // one (SaveSiteModal → project-picker overlay → text prompt would be 3 deep).
    // Dismiss the inline project picker first, await the iOS animation, then
    // open the text prompt.
    setShowProjectPicker(false);
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
    setProjectId(id);
  };

  useEffect(() => {
    if (visible) {
      setName(defaultName);
      setProjectId(defaultProjectId);
      setNotes(defaultNotes);
      setProjects(listProjects());
    }
  }, [visible, defaultName, defaultProjectId, defaultNotes]);

  const currentProject = projects.find((p) => p.id === projectId);
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
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{resolvedTitle}</Text>
          <Pressable
            onPress={() => {
              if (!canSave) return;
              onConfirm({ name: name.trim(), project_id: projectId, notes: notes.trim() || null });
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
            <View className="border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3">
              <Text className="text-sm text-blue-900 dark:text-blue-100">
                {t('sheets.siteTypeVertices', { type: t(TYPE_LABEL[geometryType]), count: vertexCount })}
              </Text>
            </View>

            <Field label={t('endSession.name')}>
              <TextInput
                value={name}
                onChangeText={setName}
                autoFocus
                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                placeholder={t('sheets.siteNameEx')}
                placeholderTextColor="#9ca3af"
              />
            </Field>

            <Field label={t('plot.project')}>
              <Pressable
                onPress={() => setShowProjectPicker(true)}
                className="flex-row items-center justify-between rounded border border-gray-300 dark:border-gray-600 px-3 py-2 active:bg-gray-50 dark:active:bg-gray-800"
              >
                <Text className="text-base text-gray-900 dark:text-gray-100">{currentProject?.name ?? t('plot.uncategorized')}</Text>
                <Ionicons name="chevron-down" size={16} color="#6b7280" />
              </Pressable>
            </Field>

            <Field label={t('endSession.notesOptional')}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                style={{ minHeight: 100, textAlignVertical: 'top' }}
                placeholder={t('sheets.siteNotesEx')}
                placeholderTextColor="#9ca3af"
              />
            </Field>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <Modal
        visible={showProjectPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProjectPicker(false)}
      >
        <View className="flex-1">
          <Pressable
            onPress={() => setShowProjectPicker(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
            }}
          />
          <View
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 8 }}
            className="rounded-t-2xl bg-white dark:bg-gray-900"
          >
            <View className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('endSession.selectProject')}</Text>
            </View>
            <Pressable
              onPress={handleCreateProjectInline}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 active:bg-blue-100 dark:active:bg-blue-900/60"
            >
              <View className="mr-3 h-7 w-7 items-center justify-center rounded-full bg-blue-500">
                <Ionicons name="add" size={18} color="white" />
              </View>
              <Text className="text-base font-semibold text-blue-700 dark:text-blue-300">{t('sheets.newProject')}</Text>
            </Pressable>
            <ScrollView className="max-h-96">
              {projects.map((p) => {
                const active = p.id === projectId;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setProjectId(p.id);
                      setShowProjectPicker(false);
                    }}
                    className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
                  >
                    <Text
                      className={`flex-1 text-base ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'} ${p.id === 0 ? 'italic text-gray-500 dark:text-gray-400' : ''}`}
                    >
                      {p.name}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={20} color="#2563eb" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
