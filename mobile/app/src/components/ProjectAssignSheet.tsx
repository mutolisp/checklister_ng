import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
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
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (visible) setProjects(listProjects());
  }, [visible]);

  const handleCreateInline = async () => {
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
          className="rounded-t-2xl bg-white"
        >
          <View className="border-b border-gray-200 px-4 py-3">
            <Text className="text-base font-semibold text-gray-900">指派專案</Text>
            <Text className="mt-0.5 text-xs text-gray-500">
              選擇現有專案，或新建一個專案套用到本次記錄
            </Text>
          </View>
          <Pressable
            onPress={handleCreateInline}
            className="flex-row items-center border-b border-gray-100 bg-blue-50 px-4 py-3 active:bg-blue-100"
          >
            <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-blue-500">
              <Ionicons name="add" size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-blue-700">新建專案</Text>
              <Text className="text-xs text-blue-600">建立後自動套用到此記錄</Text>
            </View>
          </Pressable>
          <ScrollView className="max-h-96">
            {projects.map((p) => {
              const active = p.id === currentProjectId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onAssign(p.id)}
                  className={`flex-row items-center border-b border-gray-100 px-4 py-3 ${active ? 'bg-blue-50' : 'active:bg-gray-50'}`}
                >
                  <Ionicons
                    name={p.id === 0 ? 'help-circle-outline' : 'folder-outline'}
                    size={20}
                    color="#6b7280"
                    style={{ marginRight: 12 }}
                  />
                  <View className="flex-1">
                    <Text
                      className={`text-base ${active ? 'font-semibold text-blue-700' : 'text-gray-900'} ${p.id === 0 ? 'italic text-gray-500' : ''}`}
                    >
                      {p.name}
                    </Text>
                    {p.location_description ? (
                      <Text className="text-xs text-gray-500" numberOfLines={1}>
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
