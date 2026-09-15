import { Stack, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { useActiveSession } from '~/stores/activeSession';

export default function SettingsScreen() {
  const settings = useSettings();
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const router = useRouter();
  const refreshActiveSession = useActiveSession((s) => s.refresh);
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
    settings.language === 'system'
      ? t('settings.languageSystem')
      : (LANGUAGE_CATALOGUE.find((l) => l.value === settings.language)?.native ?? settings.language);

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
                    refreshActiveSession();
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
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: t('settings.title') }} />
      <ScrollView>
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
            value={settings.theme}
            options={themeOptions}
            onChange={(v) => settings.set('theme', v)}
          />
          <SelectRow
            label={t('settings.cardDensity')}
            value={settings.card_density}
            options={densityOptions}
            onChange={(v) => settings.set('card_density', v)}
          />
          <SelectRow
            label={t('settings.fontSize')}
            value={settings.font_scale}
            options={fontScaleOptions}
            onChange={(v) => settings.set('font_scale', v)}
          />
        </Section>
        <Section title={t('settings.sectionInteraction')}>
          <SelectRow
            label={t('settings.undoDuration')}
            value={settings.undo_duration}
            options={undoOptions.map((s) => ({ value: s, label: t('settings.undoSeconds', { count: s }) }))}
            onChange={(v) => settings.set('undo_duration', v)}
          />
          <SelectRow
            label={t('settings.defaultCreate')}
            value={settings.record_type_default}
            options={recordTypeOptions}
            onChange={(v) => settings.set('record_type_default', v)}
          />
        </Section>
        <Section title={t('settings.sectionRegions')}>
          <LinkRow
            label={t('settings.regionPacks')}
            description={t('settings.regionPacksDesc')}
            onPress={() => router.push('/regionpacks' as Href)}
          />
        </Section>
        <Section title={t('settings.sectionInat')}>
          <LinkRow
            label={t('settings.inaturalist')}
            description={
              settings.inat_login
                ? t('settings.inaturalistLinked', { login: settings.inat_login })
                : t('settings.inaturalistDesc')
            }
            onPress={() => router.push('/inaturalist' as Href)}
          />
        </Section>
        <Section title={t('settings.sectionCollection')}>
          <LinkRow
            label={t('settings.sectionCollection')}
            description={t('settings.collectionDesc')}
            onPress={() => router.push('/settings/collection' as Href)}
          />
        </Section>
        <Section title={t('settings.sectionSurvey')}>
          <LinkRow
            label={t('settings.surveyors')}
            description={t('settings.surveyorsDesc')}
            onPress={() => router.push('/surveyors' as Href)}
          />
        </Section>
        <Section title={t('settings.sectionExport')}>
          <LinkRow
            label={t('exportPref.title')}
            description={t('settings.exportPrefDesc')}
            onPress={() => router.push('/settings/export' as Href)}
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
      </ScrollView>
    </SafeAreaView>
  );
}
