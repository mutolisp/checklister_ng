/**
 * Bottom sheet shown before a project export. The options themselves live in
 * the shared <AnalysisExportOptions /> (also embedded in the records tab's
 * gear sheet); this sheet adds a live numbered preview of what the export
 * will contain, then kicks it off.
 */
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '~/stores/settings';
import { AnalysisExportOptions, exportContentItems } from './AnalysisExportOptions';
import { ACTION_FILL } from '~/lib/colors';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Kick off the export (sheet closes itself first). */
  onExport: () => void;
};

export function ProjectExportSheet({ visible, onClose, onExport }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Bottom sheet must never reach the Dynamic Island / status bar: cap its
  // height at window height minus the top inset (85% guesses wrong on short
  // screens with tall content).
  const { height: winHeight } = useWindowDimensions();
  const sheetMaxHeight = winHeight - insets.top - 12;
  const analysisFormats = useSettings((s) => s.export_analysis_formats);
  const matrixValue = useSettings((s) => s.export_matrix_value);
  const matrixByLayer = useSettings((s) => s.export_matrix_by_layer);
  const includePhotos = useSettings((s) => s.export_include_photos);
  const includeDocx = useSettings((s) => s.export_include_docx);
  const geoFormats = useSettings((s) => s.export_geo_formats);
  const includeReport = useSettings((s) => s.export_include_report);
  const reportFormat = useSettings((s) => s.export_report_format);

  const items = exportContentItems(t, {
    analysisFormats,
    matrixValue,
    matrixByLayer,
    includePhotos,
    includeDocx,
    geoFormats,
    includeReport,
    reportFormat,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
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
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: sheetMaxHeight }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} style={{ flexShrink: 1 }}>
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>

            <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
              <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('projectExport.title')}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>

            <ScrollView className="px-4" style={{ flexShrink: 1 }} bounces={false}>
              <AnalysisExportOptions />

              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('projectExport.listTitle')}
              </Text>
              <View className="mb-4 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                {items.map((item, i) => (
                  <Text
                    key={i}
                    className="py-0.5 text-xs leading-4 text-gray-700 dark:text-gray-300"
                  >
                    {i + 1}. {item}
                  </Text>
                ))}
              </View>
            </ScrollView>

            <View
              className="px-4"
              style={{ paddingBottom: Math.max(insets.bottom, 12), paddingTop: 4 }}
            >
              <Pressable
                onPress={onExport}
                className={`flex-row items-center justify-center rounded-lg px-4 py-3 ${ACTION_FILL}`}
              >
                <Ionicons name="share-outline" size={16} color="white" style={{ marginRight: 6 }} />
                <Text className="text-sm font-medium text-white">
                  {t('projectExport.exportNow')}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
