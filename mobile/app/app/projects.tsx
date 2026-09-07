import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
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
import { confirmExportContent } from '~/components/AnalysisExportOptions';
import { ExportProgressOverlay } from '~/components/ExportProgressOverlay';
import { ProjectEditModal, type ProjectEditTarget } from '~/components/ProjectEditModal';
import { SwipeRowActions } from '~/components/SwipeRowActions';
import { estimateBundleSize } from '~/lib/exportSize';
import { bundleProject } from '~/lib/projectExport';
import { useExportShare } from '~/lib/useExportShare';
import { useSettings } from '~/stores/settings';
import { listRecords } from '~/db';
import { BackHeaderLeft } from '~/lib/goBack';

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [editing, setEditing] = useState<ProjectEditTarget>(null);
  const { busy, progress, onProgress, shareBundle, confirmIfLarge } = useExportShare();
  const geoFormats = useSettings((s) => s.export_geo_formats);
  const includePhotos = useSettings((s) => s.export_include_photos);
  const includeDocx = useSettings((s) => s.export_include_docx);
  const levels = useSettings((s) => s.export_levels);
  const conservationFields = useSettings((s) => s.export_conservation_fields);
  const matrixValue = useSettings((s) => s.export_matrix_value);
  const analysisFormats = useSettings((s) => s.export_analysis_formats);
  const matrixByLayer = useSettings((s) => s.export_matrix_by_layer);

  // Swipe export: straight to share with the persisted preferences, mirroring
  // the records tab's swipe export. The detail page's sheet is where the
  // analysis options get changed.
  const handleExport = async (project: ProjectWithCounts) => {
    if (busy) return;
    const okGo = await confirmExportContent(t, {
      analysisFormats,
      matrixValue,
      matrixByLayer,
      includePhotos,
      includeDocx,
      geoFormats,
    });
    if (!okGo) return;
    const items = listRecords('all')
      .filter((r) => r.projectId === project.id)
      .map((r) => ({ kind: r.kind, id: r.id }));
    const est = await estimateBundleSize(items, { includePhotos });
    if (!(await confirmIfLarge(est.totalBytes))) return;
    await shareBundle(() =>
      bundleProject(project.id, {
        geoFormats,
        includePhotos,
        includeDocx,
        levels,
        conservationFields,
        matrixValue,
        analysisFormats,
        matrixByLayer,
        onProgress,
      }),
    );
  };

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
              onPress={() => router.push(`/project/${item.id}` as Href)}
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
          const actions = [
            {
              label: t('common.export'),
              icon: 'share-outline' as const,
              color: 'blue' as const,
              onPress: () => handleExport(item),
            },
            ...(item.id !== 0
              ? [
                  {
                    label: t('common.delete'),
                    icon: 'trash-outline' as const,
                    color: 'red' as const,
                    onPress: () => handleDelete(item),
                  },
                ]
              : []),
          ];
          return <SwipeRowActions actions={actions}>{row}</SwipeRowActions>;
        }}
      />
      <ProjectEditModal target={editing} onCancel={() => setEditing(null)} onSave={handleSave} />
      <ExportProgressOverlay progress={progress} />
    </SafeAreaView>
  );
}
