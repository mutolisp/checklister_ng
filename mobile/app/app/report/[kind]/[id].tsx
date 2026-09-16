/**
 * Read-only research report. `kind` selects the unit (plot for now; project
 * and session follow), `id` the record.
 *
 * The screen only assembles and renders — all figures come from the pure
 * report model, so what is on screen and what an export writes are the same
 * numbers by construction.
 */
import { File, Paths } from 'expo-file-system';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showActionSheet } from '~/components/ActionSheet';
import { pickExportLanguage } from '~/lib/pickExportLanguage';
import { ExportProgressOverlay } from '~/components/ExportProgressOverlay';
import { ReportView } from '~/components/report/ReportView';
import i18n from '~/i18n';
import { sanitizeFilename } from '~/lib/bundleExport';
import { DOCX_MIME } from '~/lib/docx';
import { buildReportDocx } from '~/lib/reportDocx';
import { BackHeaderLeft } from '~/lib/goBack';
import {
  collectPlotReportInput,
  collectProjectReportInput,
  collectSessionReportInput,
} from '~/lib/reportData';
import {
  buildPlotReport,
  buildProjectReport,
  buildSessionReport,
  type Report,
  type Translate,
} from '~/lib/reportModel';
import { buildReportHtml } from '~/lib/reportHtml';
import { HeaderIconButton } from '~/components/HeaderIconButton';
import { useExportShare } from '~/lib/useExportShare';

/** Build the report in an arbitrary language — the same model code, with a
 *  translator pinned to `lang` instead of the UI's. */
function buildFor(kind: string, id: number, tr: Translate): Report | null {
  if (kind === 'plot') {
    const input = collectPlotReportInput(id);
    return input ? buildPlotReport(input, tr) : null;
  }
  if (kind === 'project') {
    const input = collectProjectReportInput(id);
    return input ? buildProjectReport(input, tr) : null;
  }
  if (kind === 'session') {
    const input = collectSessionReportInput(id);
    return input ? buildSessionReport(input, tr) : null;
  }
  return null;
}

export default function ReportScreen() {
  const { t } = useTranslation();
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const numericId = Number(id);
  const { busy, progress, shareBundle } = useExportShare();

  const report: Report | null = useMemo(() => {
    if (!Number.isFinite(numericId)) return null;
    return buildFor(kind, numericId, t);
    // `t` is included so the whole report re-renders in the new language when
    // the user switches it — the model bakes translated strings in.
  }, [kind, numericId, t]);

  /**
   * Export flow: pick a format, then a language (current UI language first, so
   * the common case is two taps), then render and share. Shares the language
   * sheet with the checklist exports (`pickExportLanguage`), which follow the
   * same rule: prose and headings translate, names and DwC terms do not.
   */
  const handleShare = async () => {
    if (!report) return;
    const fmtIdx = await showActionSheet({
      title: t('report.exportFormat'),
      options: [{ label: t('report.formatHtml') }, { label: t('report.formatDocx') }],
    });
    if (fmtIdx < 0) return;
    const docx = fmtIdx === 1;

    const lang = await pickExportLanguage(t, 'report.exportLanguage');
    if (!lang) return;
    await shareBundle(async () => {
      // getFixedT gives a translator pinned to `lang` without touching the
      // UI's own language.
      const tr = i18n.getFixedT(lang) as unknown as Translate;
      const localised = buildFor(kind, numericId, tr) ?? report;
      const base = sanitizeFilename(localised.title);
      const filename = `${base}.${docx ? 'docx' : 'html'}`;
      const file = new File(Paths.cache, filename);
      if (file.exists) file.delete();
      file.create();
      // `write` takes bytes or a string; the DOCX path is a real OOXML
      // package, the HTML path a single self-contained document.
      file.write(docx ? buildReportDocx(localised) : buildReportHtml(localised, lang));
      return {
        uri: file.uri,
        filename,
        mimeType: docx ? DOCX_MIME : 'text/html',
        UTI: docx ? 'org.openxmlformats.wordprocessingml.document' : 'public.html',
      };
    });
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <ExportProgressOverlay progress={progress} />
      <Stack.Screen
        options={{
          title: t('report.navTitle'),
          headerLeft: BackHeaderLeft,
          headerRight: () =>
            report ? (
              <HeaderIconButton
                icon="share-outline"
                onPress={handleShare}
                disabled={busy}
                label={t('common.export')}
              />
            ) : null,
        }}
      />
      {report ? (
        <ReportView report={report} />
      ) : (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
            {t('report.notAvailable')}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
