/**
 * Project detail: metadata, per-kind stats, the project's records, edit, and
 * the project-level export (records/ + analysis matrices + JUICE + DwC-A).
 */
import { Ionicons } from '@expo/vector-icons';
import { pickExportLanguage } from '~/lib/pickExportLanguage';
import { CrossPlotChao2Card } from '~/components/CrossPlotChao2Card';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getProject,
  listRecords,
  listSitesByProject,
  setRecordStarred,
  updateProject,
  type Project,
  type ProjectInput,
  type RecordItem,
} from '~/db';
import {
  clearRecordDiversityCache,
  RecordGridCard,
  RecordListRow,
} from '~/components/RecordListItem';
import { HeaderIconButton } from '~/components/HeaderIconButton';
import { ExportProgressOverlay } from '~/components/ExportProgressOverlay';
import { ProjectEditModal } from '~/components/ProjectEditModal';
import { ProjectExportSheet } from '~/components/ProjectExportSheet';
import { estimateBundleSize } from '~/lib/exportSize';
import { bundleProject } from '~/lib/projectExport';
import { useExportShare } from '~/lib/useExportShare';
import { BackHeaderLeft } from '~/lib/goBack';
import { useSettings } from '~/stores/settings';

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
  const matrixByLayer = useSettings((s) => s.export_matrix_by_layer);
  const includeReport = useSettings((s) => s.export_include_report);
  const reportFormat = useSettings((s) => s.export_report_format);
  const layout = useSettings((s) => s.records_layout);
  const setSetting = useSettings((s) => s.set);

  const reload = useCallback(() => {
    clearRecordDiversityCache();
    setProject(getProject(projectId));
    setRecords(listRecords('all').filter((r) => r.projectId === projectId));
    setSiteCount(listSitesByProject(projectId).length);
  }, [projectId]);
  useFocusEffect(useCallback(() => reload(), [reload]));

  const handleToggleStar = (item: RecordItem) => {
    setRecordStarred(item.kind, item.id, !item.starred);
    reload();
  };

  /** Records → list rows, chunked into pairs in card layout. Same shape as the
   *  records tab (`app/(tabs)/index.tsx`), minus the project group headers —
   *  everything here is already one project. */
  const rows = useMemo(() => {
    if (layout === 'list')
      return records.map((item) => ({ key: `${item.kind}-${item.id}`, items: [item] }));
    const out: { key: string; items: RecordItem[] }[] = [];
    for (let i = 0; i < records.length; i += 2) {
      const chunk = records.slice(i, i + 2);
      out.push({ key: `c-${chunk.map((x) => `${x.kind}-${x.id}`).join('+')}`, items: chunk });
    }
    return out;
  }, [records, layout]);

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
    const lang = await pickExportLanguage(t, 'export.language');
    if (!lang) return;
    await shareBundle(() =>
      bundleProject(projectId, {
        geoFormats,
        includePhotos,
        includeDocx,
        levels,
        conservationFields,
        lang,
        matrixValue,
        analysisFormats,
        matrixByLayer,
        includeReport,
        reportFormat,
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
            <View className="flex-row items-center gap-2">
              <HeaderIconButton
                icon={layout === 'card' ? 'grid-outline' : 'list-outline'}
                onPress={() => setSetting('records_layout', layout === 'card' ? 'list' : 'card')}
                label={t(layout === 'card' ? 'records.layoutToList' : 'records.layoutToCard')}
              />
              <HeaderIconButton
                icon="document-text-outline"
                onPress={() => router.push(`/report/project/${projectId}` as Href)}
                label={t('report.navTitle')}
              />
              {projectId !== 0 ? (
                <HeaderIconButton
                  icon="pencil"
                  onPress={() => setEditing(true)}
                  disabled={busy}
                  label={t('common.edit')}
                />
              ) : null}
              <HeaderIconButton
                icon="share-outline"
                onPress={() => setSheetOpen(true)}
                disabled={busy}
                label={t('common.export')}
              />
            </View>
          ),
        }}
      />

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerClassName="pb-4"
        ListHeaderComponent={
          <View>
            {project.abstract || project.location_description || project.notes ? (
              <View className="border-b border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                {project.abstract ? (
                  <Text className="text-sm text-gray-700 dark:text-gray-300">
                    {project.abstract}
                  </Text>
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
                  <Text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {project.notes}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <CrossPlotChao2Card
              plots={records
                .filter((r) => r.kind === 'plot')
                .map((r) => ({ id: r.id, title: r.title }))}
            />
            <View className="px-4 py-2">
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {t('projectDetail.stats', {
                  sessions: t('projectDetail.nChecklists', { count: counts.session }),
                  plots: t('projectDetail.nPlots', { count: counts.plot }),
                  collections: t('projectDetail.nCollections', { count: counts.collection }),
                  sites: t('projectDetail.nSites', { count: siteCount }),
                })}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center px-4 py-16">
            <Ionicons name="folder-open-outline" size={40} color="#9ca3af" />
            <Text className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {t('projectDetail.empty')}
            </Text>
          </View>
        }
        renderItem={({ item: row }) =>
          layout === 'card' ? (
            <View className="mx-3 mb-2 flex-row gap-2">
              {row.items.map((it) => (
                <RecordGridCard
                  key={`${it.kind}-${it.id}`}
                  item={it}
                  // The screen IS one project, so the card footer shows the
                  // record's own summary instead of repeating the name.
                  showProject
                  onPress={() => handleOpen(it)}
                  onToggleStar={() => handleToggleStar(it)}
                />
              ))}
              {row.items.length < 2 ? <View className="flex-1" /> : null}
            </View>
          ) : (
            <View className="mx-3 mb-2 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
              <RecordListRow
                item={row.items[0]}
                showProject
                onPress={() => handleOpen(row.items[0])}
                onToggleStar={() => handleToggleStar(row.items[0])}
              />
            </View>
          )
        }
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
