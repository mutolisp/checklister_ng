import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createProject,
  deleteProject,
  listProjectsWithCounts,
  updateProject,
  type ProjectInput,
  type ProjectWithCounts,
} from '~/db';
import { ProjectEditModal, type ProjectEditTarget } from '~/components/ProjectEditModal';
import { SwipeRow } from '~/components/SwipeRow';
import { BackHeaderLeft } from '~/lib/goBack';

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [editing, setEditing] = useState<ProjectEditTarget>(null);

  const reload = useCallback(() => setProjects(listProjectsWithCounts()), []);
  useFocusEffect(useCallback(() => reload(), [reload]));

  const handleSave = (data: ProjectInput) => {
    if (editing === 'new') createProject(data);
    else if (editing) updateProject(editing.id, data);
    reload();
    setEditing(null);
  };

  const handleDelete = (project: ProjectWithCounts) => {
    if (project.id === 0) return;
    Alert.alert(
      t('projects.deleteTitle'),
      t('projects.deleteMsg', { name: project.name, sessions: project.session_count, plots: project.plot_count }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deleteProject(project.id);
            reload();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: t('nav.projects'),
          headerLeft: BackHeaderLeft,
          headerRight: () => (
            <Pressable onPress={() => setEditing('new')} hitSlop={8}>
              <Ionicons name="add" size={26} color="#2563eb" />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={projects}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => {
          const row = (
            <Pressable
              onPress={() => setEditing(item)}
              disabled={item.id === 0}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
            >
              <Ionicons
                name={item.id === 0 ? 'help-circle-outline' : 'folder-outline'}
                size={18}
                color="#6b7280"
                style={{ marginRight: 10 }}
              />
              <View className="flex-1">
                <Text className={`text-base ${item.id === 0 ? 'italic text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
                  {item.name}
                </Text>
                <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {t('projects.stats', { sessions: item.session_count, plots: item.plot_count })}
                </Text>
                {item.location_description ? (
                  <Text className="mt-0.5 text-xs text-gray-400 dark:text-gray-500" numberOfLines={1}>
                    {item.location_description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
          if (item.id === 0) return row;
          return <SwipeRow onDelete={() => handleDelete(item)}>{row}</SwipeRow>;
        }}
      />
      <ProjectEditModal target={editing} onCancel={() => setEditing(null)} onSave={handleSave} />
    </SafeAreaView>
  );
}
