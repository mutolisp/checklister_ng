/**
 * Bottom sheet shown before a project export: which analysis folders to
 * produce (vegan / JUICE / DwC-A) and how Braun-Blanquet codes are
 * numericised in the matrices. Choices persist via settings, so the swipe
 * export on /projects reuses them without opening this sheet.
 */
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings, type AnalysisFormat, type MatrixValueMode } from '~/stores/settings';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Kick off the export (sheet closes itself first). */
  onExport: () => void;
};

const FORMAT_OPTIONS: Array<{ value: AnalysisFormat; label: string; hintKey: string }> = [
  { value: 'vegan', label: 'R (vegan)', hintKey: 'projectExport.veganHint' },
  { value: 'juice', label: 'JUICE', hintKey: 'projectExport.juiceHint' },
  { value: 'dwca', label: 'Darwin Core Archive', hintKey: 'projectExport.dwcaHint' },
];

const VALUE_OPTIONS: Array<{ value: MatrixValueMode; labelKey: string }> = [
  { value: 'cover', labelKey: 'projectExport.valueCover' },
  { value: 'ordinal', labelKey: 'projectExport.valueOrdinal' },
  { value: 'bb', labelKey: 'projectExport.valueBb' },
];

export function ProjectExportSheet({ visible, onClose, onExport }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const formats = useSettings((s) => s.export_analysis_formats);
  const matrixValue = useSettings((s) => s.export_matrix_value);
  const setSetting = useSettings((s) => s.set);

  const toggleFormat = (f: AnalysisFormat) => {
    // Empty selection is valid: records/ + sites/ still export.
    setSetting(
      'export_analysis_formats',
      formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="px-4">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>

            <View className="flex-row items-center justify-between pt-3 pb-2">
              <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('projectExport.title')}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>

            <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('projectExport.formats')}
            </Text>
            <View className="mb-4">
              {FORMAT_OPTIONS.map((opt) => {
                const on = formats.includes(opt.value);
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => toggleFormat(opt.value)}
                    className="flex-row items-center border-b border-gray-100 dark:border-gray-800 py-3 active:bg-gray-50 dark:active:bg-gray-800"
                  >
                    <View
                      className={`mr-3 h-6 w-6 items-center justify-center rounded ${on ? 'bg-blue-500' : 'border border-gray-300 dark:border-gray-700'}`}
                    >
                      {on ? <Ionicons name="checkmark" size={16} color="white" /> : null}
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{opt.label}</Text>
                      <Text className="text-xs text-gray-500 dark:text-gray-400">{t(opt.hintKey)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('projectExport.matrixValue')}
            </Text>
            <Text className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {t('projectExport.matrixValueHint')}
            </Text>
            <View className="mb-4 flex-row flex-wrap gap-1.5">
              {VALUE_OPTIONS.map((opt) => {
                const on = matrixValue === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setSetting('export_matrix_value', opt.value)}
                    className={`rounded-full border px-3 py-1.5 ${on ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
                  >
                    <Text className={`text-xs font-medium ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {t(opt.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <Pressable
                onPress={onExport}
                className="flex-row items-center justify-center rounded-lg bg-blue-500 px-4 py-3 active:bg-blue-600"
              >
                <Ionicons name="share-outline" size={16} color="white" style={{ marginRight: 6 }} />
                <Text className="text-sm font-medium text-white">{t('projectExport.exportNow')}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
