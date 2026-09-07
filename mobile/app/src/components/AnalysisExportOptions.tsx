/**
 * Project-export analysis options, shared between the records tab's gear
 * sheet (ExportPreferenceSheet) and the project detail's ProjectExportSheet
 * so the two stay identical. All state lives in the persisted settings.
 *
 * Also exports `exportContentItems()` — the numbered "本次將匯出" list both
 * the sheet preview and the swipe-export confirm dialog render.
 */
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { useSettings, type AnalysisFormat, type MatrixValueMode } from '~/stores/settings';

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

export function matrixValueLabelKey(mode: MatrixValueMode): string {
  return VALUE_OPTIONS.find((o) => o.value === mode)?.labelKey ?? 'projectExport.valueCover';
}

/** The numbered list of what a project export will produce, from the current
 *  settings. `t` passed in so callers outside a component (Alert) work too. */
export function exportContentItems(
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    analysisFormats: AnalysisFormat[];
    matrixValue: MatrixValueMode;
    matrixByLayer: boolean;
    includePhotos: boolean;
    includeDocx: boolean;
    geoFormats: string[];
  },
): string[] {
  const items: string[] = [];
  const recordFormats = [
    'YAML',
    'CSV',
    'Markdown',
    ...(opts.includeDocx ? ['DOCX'] : []),
    ...opts.geoFormats.map((f) => f.toUpperCase()),
    ...(opts.includePhotos ? [t('projectExport.itemPhotos')] : []),
  ];
  items.push(t('projectExport.itemRecords', { formats: recordFormats.join(' / ') }));
  if (opts.analysisFormats.includes('vegan')) {
    items.push(
      t('projectExport.itemMatrix', {
        mode: t(matrixValueLabelKey(opts.matrixValue)),
        layered: opts.matrixByLayer ? t('projectExport.itemLayeredSuffix') : '',
      }),
    );
    items.push(t('projectExport.itemEnv'));
    items.push(t('projectExport.itemLong'));
  }
  if (opts.analysisFormats.includes('juice')) items.push(t('projectExport.itemJuice'));
  if (opts.analysisFormats.includes('dwca')) items.push(t('projectExport.itemDwca'));
  items.push(t('projectExport.itemSites'));
  return items;
}

/** Confirm dialog for the one-tap swipe exports (which skip the sheet):
 *  shows the same numbered content list, resolves true to proceed. */
export function confirmExportContent(
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: Parameters<typeof exportContentItems>[1],
): Promise<boolean> {
  const items = exportContentItems(t, opts);
  return new Promise((resolve) => {
    Alert.alert(
      t('projectExport.title'),
      `${t('projectExport.listTitle')}\n${items.map((it, i) => `${i + 1}. ${it}`).join('\n')}`,
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('common.export'), onPress: () => resolve(true) },
      ],
    );
  });
}

/** Renders the format checkboxes + matrix-value chips + per-layer switch. */
export function AnalysisExportOptions() {
  const { t } = useTranslation();
  const formats = useSettings((s) => s.export_analysis_formats);
  const matrixValue = useSettings((s) => s.export_matrix_value);
  const matrixByLayer = useSettings((s) => s.export_matrix_by_layer);
  const setSetting = useSettings((s) => s.set);

  const toggleFormat = (f: AnalysisFormat) => {
    // Empty selection is valid: records/ + sites/ still export.
    setSetting(
      'export_analysis_formats',
      formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f],
    );
  };

  return (
    <View>
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

      <View className="mb-4 flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 py-3">
        <View className="flex-1 pr-3">
          <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('projectExport.byLayer')}
          </Text>
          <Text className="text-xs text-gray-500 dark:text-gray-400">{t('projectExport.byLayerHint')}</Text>
        </View>
        <Switch
          value={matrixByLayer}
          onValueChange={(v) => setSetting('export_matrix_by_layer', v)}
        />
      </View>
    </View>
  );
}
