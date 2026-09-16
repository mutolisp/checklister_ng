/**
 * 選單 — the app's only settings surface.
 *
 * Was a five-row launcher that pushed `/settings`, which then pushed the detail
 * pages: three levels to reach 區域名錄. Flattening the settings root into this
 * tab makes it two, and lets the single-row sections disappear whose caption
 * only repeated their row's label (區域名錄 → 區域名錄, 標本採集 → 標本採集).
 *
 * Grouped by what the row is for, not by which screen it used to live on:
 * day-to-day management first, set-once preferences after, destructive last.
 */
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text, View } from 'react-native';
import { LinkRow, Section, SelectRow } from '~/components/settings/rows';
import { LANGUAGE_CATALOGUE } from '~/i18n';
import {
  useSettings,
  type Theme,
  type CardDensity,
  type FontScale,
  type RecordTypeDefault,
} from '~/stores/settings';
import { checkIntegrity, clearAllUserData, clearSearchHistory } from '~/db';
import { clearInatTokens } from '~/lib/inatAuth';
import { useToast } from '~/stores/toast';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';

export default function MenuScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast((s) => s.show);

  // Per-field selectors, not the whole store: this is a tab, so it stays
  // mounted for the session and a whole-store subscription would re-render it
  // on every settings write from anywhere in the app.
  const language = useSettings((s) => s.language);
  const theme = useSettings((s) => s.theme);
  const cardDensity = useSettings((s) => s.card_density);
  const fontScale = useSettings((s) => s.font_scale);
  const undoDuration = useSettings((s) => s.undo_duration);
  const recordTypeDefault = useSettings((s) => s.record_type_default);
  const inatLogin = useSettings((s) => s.inat_login);
  const setSetting = useSettings((s) => s.set);
  const reloadSettings = useSettings((s) => s.load);

  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: 'auto', label: t('settings.themeAuto') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];
  const undoOptions = [5, 8, 10];
  const densityOptions: Array<{ value: CardDensity; label: string }> = [
    { value: 'compact', label: t('settings.densityCompact') },
    { value: 'comfortable', label: t('settings.densityComfortable') },
  ];
  const fontScaleOptions: Array<{ value: FontScale; label: string }> = [
    { value: 'small', label: t('settings.fontSmall') },
    { value: 'normal', label: t('settings.fontNormal') },
    { value: 'large', label: t('settings.fontLarge') },
    { value: 'xlarge', label: t('settings.fontXLarge') },
  ];
  const recordTypeOptions: Array<{ value: RecordTypeDefault; label: string }> = [
    { value: 'ask', label: t('settings.createAsk') },
    { value: 'session', label: t('record.kindSession') },
    { value: 'plot', label: t('record.kindPlot') },
    { value: 'collection', label: t('record.kindCollection') },
  ];

  // Endonym, matching how the language screen lists them.
  const languageLabel =
    language === 'system'
      ? t('settings.languageSystem')
      : (LANGUAGE_CATALOGUE.find((l) => l.value === language)?.native ?? language);

  /** 唯讀盤點。重複的 occurrence_id 刻意不自動清除 —— 那是已發布的 DwC 識別碼，
   *  重新配號會與交付出去的檔案對不起來，所以只報數字讓使用者自己決定。 */
  const handleCheckIntegrity = () => {
    try {
      const r = checkIntegrity();
      const lines: string[] = [];
      for (const d of r.duplicateOccurrenceIds) {
        lines.push(t('settings.integrityDup', {
            table: d.table,
            groups: t('settings.nDupGroups', { count: d.groups }),
            rows: t('settings.nRows', { count: d.rows }),
          }));
      }
      for (const o of r.orphanRows) lines.push(t('settings.integrityOrphan', { table: o.table, count: o.n }));
      for (const d of r.danglingProjectIds) {
        lines.push(t('settings.integrityProject', { table: d.table, count: d.n }));
      }
      for (const a of r.staleAdoptedNames) {
        lines.push(t('settings.integrityAdopted', { table: a.table, count: a.n }));
      }
      if (r.fkViolations > 0) lines.push(t('settings.integrityFk', { count: r.fkViolations }));
      Alert.alert(
        t('settings.integrityTitle'),
        lines.length === 0 ? t('settings.integrityClean') : lines.join('\n'),
        [{ text: t('common.ok') }],
      );
    } catch (e) {
      toast(t('settings.integrityFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleClearHistory = () => {
    Alert.alert(t('settings.clearHistoryConfirmTitle'), t('settings.clearHistoryConfirmMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.clear'),
        style: 'destructive',
        onPress: () => {
          clearSearchHistory();
          toast(t('settings.historyCleared'));
        },
      },
    ]);
  };

  const handleClearAll = () => {
    Alert.alert(
      t('settings.clearAllConfirmTitle'),
      t('settings.clearAllConfirmMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(t('settings.clearAllConfirm2Title'), t('settings.clearAllConfirm2Msg'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.clear'),
                style: 'destructive',
                onPress: async () => {
                  try {
                    await clearAllUserData();
                    // user.db is gone but the token lives in SecureStore —
                    // same "clear at the call site" rule as gbifCredentials.
                    await clearInatTokens();
                    reloadSettings();
                    // Both active records, not just the session: the whole DB
                    // file is gone, so a live 樣區 would otherwise leave
                    // ActiveSessionBar pointing at a plot that no longer exists.
                    useActiveSession.getState().refresh();
                    useActivePlot.getState().refresh();
                    toast(t('settings.allCleared'));
                    router.replace('/');
                  } catch (e) {
                    toast(t('settings.clearFailed', { error: e instanceof Error ? e.message : String(e) }));
                  }
                },
              },
            ]);
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-gray-50 dark:bg-gray-950"
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      <View className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-6">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('tab.menu')}</Text>
      </View>

      <Section title={t('settings.sectionRecords')}>
        <LinkRow
          label={t('nav.projects')}
          description={t('menu.projectsDesc')}
          onPress={() => router.push('/projects' as Href)}
        />
        <LinkRow
          label={t('menu.sites')}
          description={t('menu.sitesDesc')}
          onPress={() => router.push('/sites' as Href)}
        />
        <LinkRow
          label={t('nav.favorites')}
          description={t('menu.favoritesDesc')}
          onPress={() => router.push('/favorites' as Href)}
        />
        <LinkRow
          label={t('nav.backup')}
          description={t('menu.backupDesc')}
          onPress={() => router.push('/backup' as Href)}
        />
      </Section>

      <Section title={t('settings.sectionSurvey')}>
        <SelectRow
          label={t('settings.defaultCreate')}
          value={recordTypeDefault}
          options={recordTypeOptions}
          onChange={(v) => setSetting('record_type_default', v)}
        />
        <LinkRow
          label={t('settings.surveyors')}
          description={t('settings.surveyorsDesc')}
          onPress={() => router.push('/surveyors' as Href)}
        />
        <LinkRow
          label={t('settings.sectionCollection')}
          description={t('settings.collectionDesc')}
          onPress={() => router.push('/settings/collection' as Href)}
        />
      </Section>

      <Section title={t('settings.sectionSync')}>
        <LinkRow
          label={t('settings.regionPacks')}
          description={t('settings.regionPacksDesc')}
          onPress={() => router.push('/regionpacks' as Href)}
        />
        <LinkRow
          label={t('settings.inaturalist')}
          description={
            inatLogin
              ? t('settings.inaturalistLinked', { login: inatLogin })
              : t('settings.inaturalistDesc')
          }
          onPress={() => router.push('/inaturalist' as Href)}
        />
        <LinkRow
          label={t('exportPref.title')}
          description={t('settings.exportPrefDesc')}
          onPress={() => router.push('/settings/export' as Href)}
        />
      </Section>

      <Section title={t('settings.sectionAppearance')}>
        {/* Its own screen, not a dropdown: a popover has no room for the
            `English · en` sublabel and no search box, and both are what a
            user stranded in an unreadable script needs. */}
        <LinkRow
          label={t('settings.language')}
          value={languageLabel}
          onPress={() => router.push('/settings/language' as Href)}
        />
        <SelectRow
          label={t('settings.theme')}
          value={theme}
          options={themeOptions}
          onChange={(v) => setSetting('theme', v)}
        />
        <SelectRow
          label={t('settings.cardDensity')}
          value={cardDensity}
          options={densityOptions}
          onChange={(v) => setSetting('card_density', v)}
        />
        <SelectRow
          label={t('settings.fontSize')}
          value={fontScale}
          options={fontScaleOptions}
          onChange={(v) => setSetting('font_scale', v)}
        />
        <SelectRow
          label={t('settings.undoDuration')}
          value={undoDuration}
          options={undoOptions.map((s) => ({ value: s, label: t('settings.undoSeconds', { count: s }) }))}
          onChange={(v) => setSetting('undo_duration', v)}
        />
      </Section>

      <Section title={t('settings.sectionData')}>
        <LinkRow
          label={t('settings.integrityCheck')}
          description={t('settings.integrityDesc')}
          chevron={false}
          onPress={handleCheckIntegrity}
        />
        <LinkRow label={t('settings.clearHistory')} chevron={false} onPress={handleClearHistory} />
        <LinkRow
          label={t('settings.clearAll')}
          description={t('settings.clearAllDesc')}
          destructive
          chevron={false}
          onPress={handleClearAll}
        />
      </Section>

      {/* No caption: a caption promises a group, and this is one row. */}
      <Section>
        <LinkRow label={t('nav.about')} onPress={() => router.push('/about' as Href)} />
      </Section>
    </ScrollView>
  );
}
