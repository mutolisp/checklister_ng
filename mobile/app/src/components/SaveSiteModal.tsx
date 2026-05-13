import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  Point: '點位',
  LineString: '路線',
  Polygon: '範圍',
};

export function SaveSiteModal({
  visible,
  defaultName = '',
  defaultProjectId = 0,
  defaultNotes = '',
  geometryType,
  vertexCount,
  title = '儲存樣區',
  onCancel,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(defaultName);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [notes, setNotes] = useState(defaultNotes);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const handleCreateProjectInline = async () => {
    // promptText is a cross-platform replacement for the iOS-only Alert.prompt;
    // it renders a modal sibling that does not run into the iOS triple-nested
    // Modal hang because TextPromptHost mounts at the navigation root.
    const name = await promptText({
      title: '新建專案',
      message: '輸入專案名稱（其他欄位可之後在「專案管理」頁編輯）',
      placeholder: '專案名稱',
      confirmText: '建立',
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
    setShowProjectPicker(false);
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
        className="flex-1 bg-white"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700">取消</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900">{title}</Text>
          <Pressable
            onPress={() => {
              if (!canSave) return;
              onConfirm({ name: name.trim(), project_id: projectId, notes: notes.trim() || null });
            }}
            hitSlop={8}
          >
            <Text className={`text-base font-semibold ${canSave ? 'text-blue-600' : 'text-gray-300'}`}>
              儲存
            </Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <View className="border-b border-gray-100 bg-blue-50 px-4 py-3">
              <Text className="text-sm text-blue-900">
                類型：<Text className="font-bold">{TYPE_LABEL[geometryType]}</Text> · {vertexCount} 個頂點
              </Text>
            </View>

            <Field label="名稱">
              <TextInput
                value={name}
                onChangeText={setName}
                autoFocus
                className="rounded border border-gray-300 px-3 py-2 text-base text-gray-900"
                placeholder="例：A 樣區"
                placeholderTextColor="#9ca3af"
              />
            </Field>

            <Field label="專案">
              <Pressable
                onPress={() => setShowProjectPicker(true)}
                className="flex-row items-center justify-between rounded border border-gray-300 px-3 py-2 active:bg-gray-50"
              >
                <Text className="text-base text-gray-900">{currentProject?.name ?? '未分類'}</Text>
                <Ionicons name="chevron-down" size={16} color="#6b7280" />
              </Pressable>
            </Field>

            <Field label="備註（選填）">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                className="rounded border border-gray-300 px-3 py-2 text-base text-gray-900"
                style={{ minHeight: 100, textAlignVertical: 'top' }}
                placeholder="描述地點、海拔、植被等"
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
            className="rounded-t-2xl bg-white"
          >
            <View className="border-b border-gray-200 px-4 py-3">
              <Text className="text-base font-semibold text-gray-900">選擇專案</Text>
            </View>
            <Pressable
              onPress={handleCreateProjectInline}
              className="flex-row items-center border-b border-gray-100 bg-blue-50 px-4 py-3 active:bg-blue-100"
            >
              <View className="mr-3 h-7 w-7 items-center justify-center rounded-full bg-blue-500">
                <Ionicons name="add" size={18} color="white" />
              </View>
              <Text className="text-base font-semibold text-blue-700">新建專案</Text>
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
                    className={`flex-row items-center border-b border-gray-100 px-4 py-3 ${active ? 'bg-blue-50' : 'active:bg-gray-50'}`}
                  >
                    <Text
                      className={`flex-1 text-base ${active ? 'font-semibold text-blue-700' : 'text-gray-900'} ${p.id === 0 ? 'italic text-gray-500' : ''}`}
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
    <View className="border-b border-gray-100 px-4 py-3">
      <Text className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</Text>
      {children}
    </View>
  );
}
