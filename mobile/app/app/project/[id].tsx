/**
 * Project detail: metadata, per-kind stats, the project's records, edit, and
 * the project-level export (records/ + analysis matrices + JUICE + DwC-A).
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getProject,
  listRecords,
  listSitesByProject,
  updateProject,
  type Project,
  type ProjectInput,
  type RecordItem,
  type RecordKind,
} from '~/db';
import { ExportProgressOverlay } from '~/components/ExportProgressOverlay';
import { ProjectEditModal } from '~/components/ProjectEditModal';
import { ProjectExportSheet } from '~/components/ProjectExportSheet';
import { estimateBundleSize } from '~/lib/exportSize';
import { bundleProject } from '~/lib/projectExport';
import { useExportShare } from '~/lib/useExportShare';
import { BackHeaderLeft } from '~/lib/goBack';
import { isoDateTime } from '~/lib/datetime';
import { useSettings } from '~/stores/settings';

function kindIcon(kind: RecordKind): string {
  return kind === 'session' ? 'list' : kind === 'collection' ? 'leaf-outline' : 'grid-outline';
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const router = useRouter();
  const { t } = useTranslation();

  const [project, setProject] = useState<Project | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [siteCount, setSiteCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { busy, progress, onProgress, shareBundle, confirmIfLarge } = useExportShare();
  const geoFormats = useSettings((s) => s.export_geo_formats);
  const includePhotos = useSettings((s) => s.export_include_photos);
  const includeDocx = useSettings((s) => s.export_include_docx);
  const levels = useSettings((s) => s.export_levels);
  const conservationFields = useSettings((s) => s.export_conservation_fields);
  const matrixValue = useSettings((s) => s.export_matrix_value);
  const analysisFormats = useSettings((s) => s.export_analysis_formats);

  const reload = useCallback(() => {
    setProject(getProject(projectId));
    setRecords(listRecords('all').filter((r) => r.projectId === projectId));
    setSiteCount(listSitesByProject(projectId).length);
  }, [projectId]);
  useFocusEffect(useCallback(() => reload(), [reload]));

  const counts = useMemo(() => {
    const c = { session: 0, plot: 0, collection: 0 };
    for (const r of records) c[r.kind] += 1;
    return c;
  }, [records]);

  const handleSave = (data: ProjectInput) => {
    updateProject(projectId, data);
    reload();
    setEditing(false);
  };

  const startExport = async () => {
    setSheetOpen(false);
    // Let the sheet finish dismissing before any Alert / progress Modal —
    // iOS silently drops a present() over a dismissing Modal.
    await new Promise((r) => setTimeout(r, 450));
    const est = await estimateBundleSize(
      records.map((r) => ({ kind: r.kind, id: r.id })),
      { includePhotos },
    );
    if (!(await confirmIfLarge(est.totalBytes))) return;
    await shareBundle(() =>
      bundleProject(projectId, {
        geoFormats,
        includePhotos,
        includeDocx,
        levels,
        conservationFields,
        matrixValue,
        analysisFormats,
        onProgress,
      }),
    );
  };

  const handleOpen = (item: RecordItem) => {
    if (item.kind === 'session') router.push(`/session/${item.id}` as Href);
    else if (item.kind === 'collection') router.push(`/collection/${item.id}` as Href);
    else router.push(`/plot/${item.id}` as Href);
  };

  if (!project) {
    return (
      <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
        <Stack.Screen options={{ title: t('nav.projects'), headerLeft: BackHeaderLeft }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: project.name,
          headerLeft: BackHeaderLeft,
          headerRight: () => (
            <View className="flex-row items-center gap-4">
              {projectId !== 0 ? (
                <Pressable onPress={() => setEditing(true)} hitSlop={8} disabled={busy}>
                  <Ionicons name="pencil" size={20} color="#2563eb" />
                </Pressable>
              ) : null}
              <Pressable onPress={() => setSheetOpen(true)} hitSlop={8} disabled={busy}>
                <Ionicons name="share-outline" size={22} color={busy ? '#9ca3af' : '#2563eb'} />
              </Pressable>
            </View>
          ),
        }}
      />

      <FlatList
        data={records}
        keyExtractor={(r) => `${r.kind}-${r.id}`}
        ListHeaderComponent={
          <View>
            {project.abstract || project.location_description || project.notes ? (
              <View className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
                {project.abstract ? (
                  <Text className="text-sm text-gray-700 dark:text-gray-300">{project.abstract}</Text>
                ) : null}
                {project.location_description ? (
                  <View className="mt-1 flex-row items-center">
                    <Ionicons name="location-outline" size={13} color="#6b7280" />
                    <Text className="ml-1 flex-1 text-xs text-gray-500 dark:text-gray-400">
                      {project.location_description}
                    </Text>
                  </View>
                ) : null}
                {project.notes ? (
                  <Text className="mt-1 text-xs text-gray-400 dark:text-gray-500">{project.notes}</Text>
                ) : null}
              </View>
            ) : null}
            <View className="px-4 py-2">
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {t('projectDetail.stats', {
                  sessions: counts.session,
                  plots: counts.plot,
                  collections: counts.collection,
                  sites: siteCount,
                })}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center px-4 py-16">
            <Ionicons name="folder-open-outline" size={40} color="#9ca3af" />
            <Text className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('projectDetail.empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handleOpen(item)}
            className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Ionicons name={kindIcon(item.kind) as never} size={18} color="#6b7280" style={{ marginRight: 10 }} />
            <View className="flex-1">
              <Text className="text-base text-gray-900 dark:text-gray-100" numberOfLines={1}>
                {item.title}
              </Text>
              <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                {isoDateTime(item.startedAt)} · {item.subtitle}
              </Text>
            </View>
            {item.active ? (
              <View className="ml-2 h-2 w-2 rounded-full bg-emerald-500" />
            ) : null}
            <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
          </Pressable>
        )}
      />

      <ProjectEditModal
        target={editing ? project : null}
        onCancel={() => setEditing(false)}
        onSave={handleSave}
      />
      <ProjectExportSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onExport={startExport}
      />
      <ExportProgressOverlay progress={progress} />
    </SafeAreaView>
  );
}
