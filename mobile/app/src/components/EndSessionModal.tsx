import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listProjects, type Project, type Session } from '~/db';

type Props = {
  visible: boolean;
  session: Session;
  recordCount: number;
  onCancel: () => void;
  onConfirm: (data: { name: string; project_id: number; notes: string }) => void;
  onDeleteEmpty: () => void;
};

function formatDuration(start: number, end: number = Date.now()): string {
  const ms = end - start;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} 小時 ${mins} 分鐘`;
}

export function EndSessionModal({ visible, session, recordCount, onCancel, onConfirm, onDeleteEmpty }: Props) {
  const [name, setName] = useState(session.name);
  const [projectId, setProjectId] = useState(session.project_id);
  const [notes, setNotes] = useState(session.notes ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setName(session.name);
      setProjectId(session.project_id);
      setNotes(session.notes ?? '');
      setProjects(listProjects());
    }
  }, [visible, session]);

  const currentProject = projects.find((p) => p.id === projectId);
  const duration = formatDuration(session.started_at);
  const isEmpty = recordCount === 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 bg-white dark:bg-gray-900" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">取消</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{isEmpty ? '空記錄' : '結束記錄'}</Text>
          {isEmpty ? (
            <Pressable onPress={onDeleteEmpty} hitSlop={8}>
              <Text className="text-base font-semibold text-red-600 dark:text-red-400">刪除</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => onConfirm({ name, project_id: projectId, notes })} hitSlop={8}>
              <Text className="text-base font-semibold text-red-600 dark:text-red-400">結束</Text>
            </Pressable>
          )}
        </View>
        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ScrollView className="flex-1">
            {isEmpty ? (
              <View className="border-b border-gray-100 dark:border-gray-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-4">
                <Text className="text-sm font-medium text-amber-900 dark:text-amber-200">這個記錄還沒有任何項目。</Text>
                <Text className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                  按右上「刪除」直接清掉，或按取消回去繼續加入物種。
                </Text>
              </View>
            ) : (
              <View className="border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-4">
                <Text className="text-sm text-blue-900 dark:text-blue-100">
                  共 <Text className="font-bold">{recordCount}</Text> 筆 · 歷時 {duration}
                </Text>
              </View>
            )}

            <Field label="名稱">
              <TextInput
                value={name}
                onChangeText={setName}
                className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                placeholder="記錄名稱"
                placeholderTextColor="#9ca3af"
              />
            </Field>

            <Field label="專案">
              <Pressable
                onPress={() => setShowProjectPicker(true)}
                className="flex-row items-center justify-between rounded border border-gray-300 dark:border-gray-600 px-3 py-2 active:bg-gray-50 dark:active:bg-gray-800"
              >
                <Text className="text-base text-gray-900 dark:text-gray-100">{currentProject?.name ?? '未分類'}</Text>
                <Ionicons name="chevron-down" size={16} color="#6b7280" />
              </Pressable>
            </Field>

            <Field label="備註（選填）">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-base text-gray-900 dark:text-gray-100"
                style={{ minHeight: 100, textAlignVertical: 'top' }}
                placeholder="此次調查的概況、天氣、人員等"
                placeholderTextColor="#9ca3af"
              />
            </Field>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <Modal visible={showProjectPicker} transparent animationType="slide" onRequestClose={() => setShowProjectPicker(false)}>
        <Pressable onPress={() => setShowProjectPicker(false)} className="flex-1 bg-black/40">
          <Pressable className="mt-auto rounded-t-2xl bg-white dark:bg-gray-900" style={{ paddingBottom: insets.bottom + 8 }}>
            <View className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">選擇專案</Text>
            </View>
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
                    <Text className={`flex-1 text-base ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'} ${p.id === 0 ? 'italic text-gray-500 dark:text-gray-400' : ''}`}>
                      {p.name}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={20} color="#2563eb" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
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
