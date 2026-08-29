import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useSettings,
  type Theme,
  type CardDensity,
  type FontScale,
  type RecordTypeDefault,
  type RegionCode,
  type Language,
} from '~/stores/settings';
import { clearAllUserData, clearSearchHistory, clearTaxonomyCache, nextRecordNumber } from '~/db';
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

  // Language self-names stay untranslated (English / 正體中文).
  const languageOptions: Array<{ value: Language; label: string }> = [
    { value: 'system', label: t('settings.languageSystem') },
    { value: 'en', label: 'English' },
    { value: 'zh-TW', label: '正體中文' },
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

  // Recomputed on every render so the hint reflects the prefix/start just typed.
  const nextNumberPreview = nextRecordNumber().text;

  const jpEnabled = settings.enabled_regions.includes('JP');
  const setJp = (on: boolean) => {
    const next: RegionCode[] = on ? ['TW', 'JP'] : ['TW'];
    settings.set('enabled_regions', next);
    clearTaxonomyCache(); // tree dataset changed — drop the kingdom cache
    // No toast here: the ToastHost banner overlays the nav header's top-left
    // back button, swallowing taps while visible. The pill's active state is
    // sufficient feedback and matches the other rows on this screen.
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

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: t('settings.title') }} />
      <ScrollView>
        <Section title={t('settings.sectionAppearance')}>
          <RowSelect
            label={t('settings.language')}
            value={settings.language}
            options={languageOptions}
            onChange={(v) => settings.set('language', v)}
          />
          <RowSelect
            label={t('settings.theme')}
            value={settings.theme}
            options={themeOptions}
            onChange={(v) => settings.set('theme', v)}
          />
          <RowSelect
            label={t('settings.cardDensity')}
            value={settings.card_density}
            options={densityOptions}
            onChange={(v) => settings.set('card_density', v)}
          />
          <RowSelect
            label={t('settings.fontSize')}
            value={settings.font_scale}
            options={fontScaleOptions}
            onChange={(v) => settings.set('font_scale', v)}
          />
        </Section>
        <Section title={t('settings.sectionInteraction')}>
          <RowSelect
            label={t('settings.undoDuration')}
            value={settings.undo_duration}
            options={undoOptions.map((s) => ({ value: s, label: t('settings.undoSeconds', { count: s }) }))}
            onChange={(v) => settings.set('undo_duration', v)}
          />
          <RowSelect
            label={t('settings.defaultCreate')}
            value={settings.record_type_default}
            options={recordTypeOptions}
            onChange={(v) => settings.set('record_type_default', v)}
          />
        </Section>
        <Section title={t('settings.sectionRegions')}>
          <RowSelect
            label={t('settings.regionJapan')}
            value={jpEnabled ? 'on' : 'off'}
            options={[
              { value: 'off', label: t('settings.off') },
              { value: 'on', label: t('settings.on') },
            ]}
            onChange={(v) => setJp(v === 'on')}
          />
          <View className="bg-white dark:bg-gray-900 px-4 pb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.regionJapanDesc')}
            </Text>
          </View>
        </Section>
        <Section title={t('settings.sectionCollection')}>
          <RowInput
            label={t('collection.numberPrefix')}
            value={settings.collection_number_prefix}
            placeholder={t('settings.numberPrefixPlaceholder')}
            autoCapitalize="characters"
            onCommit={(v) => settings.set('collection_number_prefix', v.trim())}
          />
          <RowInput
            label={t('collection.numberStart')}
            value={String(settings.collection_number_start)}
            placeholder="1"
            keyboardType="number-pad"
            onCommit={(v) => {
              const n = Math.floor(Number(v));
              settings.set('collection_number_start', Number.isFinite(n) && n > 0 ? n : 1);
            }}
          />
          <View className="bg-white dark:bg-gray-900 px-4 pb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.collectionNumberDesc', { next: nextNumberPreview })}
            </Text>
          </View>
        </Section>
        <Section title={t('settings.sectionSurvey')}>
          <Pressable
            onPress={() => router.push('/surveyors' as Href)}
            className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <View>
              <Text className="text-base text-gray-900 dark:text-gray-100">{t('settings.surveyors')}</Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">{t('settings.surveyorsDesc')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
        </Section>
        <Section title={t('settings.sectionData')}>
          <Pressable
            onPress={handleClearHistory}
            className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">{t('settings.clearHistory')}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
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
            }}
            className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text className="text-base text-red-600 dark:text-red-400">{t('settings.clearAll')}</Text>
            <Text className="text-xs text-gray-500 dark:text-gray-400">{t('settings.clearAllDesc')}</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Uncontrolled text row committed on blur — same interaction as the plot
 *  env-tab fields, so a half-typed value never lands in settings. */
function RowInput({
  label,
  value,
  placeholder,
  keyboardType,
  autoCapitalize,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'characters';
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <View className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <Text className="text-base text-gray-900 dark:text-gray-100">{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => onCommit(draft)}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        className="min-w-[120px] rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-right text-base text-gray-900 dark:text-gray-100"
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</Text>
      {children}
    </View>
  );
}

function RowSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <View className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <Text className="text-sm text-gray-700 dark:text-gray-300">{label}</Text>
      <View className="mt-2 flex-row gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => onChange(opt.value)}
              className={`rounded-full border px-3 py-1.5 ${active ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
            >
              <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
