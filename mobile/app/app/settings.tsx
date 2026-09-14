import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportPreferenceSheet } from '~/components/ExportPreferenceSheet';
import { LANGUAGE_CATALOGUE } from '~/i18n';
import {
  useSettings,
  type Theme,
  type CardDensity,
  type FontScale,
  type RecordTypeDefault,
  type Language,
} from '~/stores/settings';
import {
  checkIntegrity,
  clearAllUserData,
  clearSearchHistory,
  formatRecordNumber,
  maxRecordNumberSeq,
  nextRecordNumber,
} from '~/db';
import { promptText } from '~/components/TextPromptModal';
import { useToast } from '~/stores/toast';
import { useActiveSession } from '~/stores/activeSession';

export default function SettingsScreen() {
  const settings = useSettings();
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const router = useRouter();
  const [exportPrefOpen, setExportPrefOpen] = useState(false);
  const refreshActiveSession = useActiveSession((s) => s.refresh);
  const reloadSettings = useSettings((s) => s.load);

  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: 'auto', label: t('settings.themeAuto') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];

  const languageOptions: Array<{ value: Language; label: string; sublabel?: string }> = [
    { value: 'system', label: t('settings.languageSystem'), sublabel: 'System' },
    // Endonyms: someone hunting for their language reads it in that language,
    // not in whichever one the UI is currently showing.
    ...LANGUAGE_CATALOGUE.map((l) => ({
      value: l.value as Language,
      label: l.native,
      sublabel: `${l.english} · ${l.value}`,
    })),
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

  /**
   * 強制指定下一個採集號。
   *
   * 底層仍是 collection_number_start（nextRecordNumber 取
   * max(資料庫最大序號 + 1, start)），所以只能往前跳、不能往回。輸入值若不大於
   * 目前最大序號，設了也不會生效 —— 這種情況要明講，不能靜默吞掉。
   */
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

  const handleSetNextNumber = async () => {
    const maxSeq = maxRecordNumberSeq();
    const current = nextRecordNumber();
    const input = await promptText({
      title: t('settings.setNextNumberTitle'),
      message:
        maxSeq > 0
          ? t('settings.setNextNumberMsg', { max: formatRecordNumber(maxSeq), next: current.text })
          : t('settings.setNextNumberMsgEmpty', { next: current.text }),
      keyboardType: 'numeric',
      defaultValue: String(current.seq),
    });
    if (input == null) return;

    const seq = Math.floor(Number(input.trim()));
    if (!Number.isFinite(seq) || seq < 1) {
      toast(t('settings.setNextNumberInvalid'));
      return;
    }
    if (seq <= maxSeq) {
      // 採集號只會往前：資料庫已經有更大的號了，設下去不會生效。
      Alert.alert(
        t('settings.setNextNumberTooLowTitle'),
        t('settings.setNextNumberTooLowMsg', {
          value: formatRecordNumber(seq),
          max: formatRecordNumber(maxSeq),
          next: formatRecordNumber(maxSeq + 1),
        }),
        [{ text: t('common.ok') }],
      );
      return;
    }

    Alert.alert(
      t('settings.setNextNumberConfirmTitle'),
      t('settings.setNextNumberConfirmMsg', { value: formatRecordNumber(seq) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            settings.set('collection_number_start', seq);
            toast(t('settings.setNextNumberDone', { value: formatRecordNumber(seq) }));
          },
        },
      ],
    );
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
          {/* Searchable: a pill row stopped scaling at 9 languages, and the
              search box is the way out for a user stranded in a script they
              cannot read. */}
          <SelectRow
            label={t('settings.language')}
            value={settings.language}
            options={languageOptions}
            onChange={(v) => settings.set('language', v)}
            searchable
            searchPlaceholder={t('settings.languageSearch')}
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
          <Pressable
            onPress={() => router.push('/regionpacks' as Href)}
            className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <View>
              <Text className="text-base text-gray-900 dark:text-gray-100">{t('settings.regionPacks')}</Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">{t('settings.regionPacksDesc')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
        </Section>
        <Section title={t('settings.sectionCollection')}>
          {/* 預設鑑定者：新增標本時自動帶入，比照採集者從行程繼承的作法。
              留空表示不帶入——標籤上寧可沒有這一行，也不要掛一個沒定過名的人。 */}
          <RowInput
            label={t('settings.defaultDeterminer')}
            value={settings.default_identified_by}
            placeholder={t('settings.defaultDeterminerPlaceholder')}
            onCommit={(v) => settings.set('default_identified_by', v.trim())}
          />
          <RowInput
            label={t('collection.numberPrefix')}
            value={settings.collection_number_prefix}
            placeholder={t('settings.numberPrefixPlaceholder')}
            autoCapitalize="characters"
            onCommit={(v) => settings.set('collection_number_prefix', v.trim())}
          />
          {/* 取代原本會在失焦時靜默寫入的「起始號」輸入框：改號會影響實體標本
              編號，必須先讓使用者看到目前狀態並確認。底層設定同一個。 */}
          <Pressable
            onPress={handleSetNextNumber}
            className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">
              {t('collection.numberStart')}
            </Text>
            <View className="flex-row items-center">
              <Text className="mr-1 text-base text-gray-500 dark:text-gray-400">
                {nextNumberPreview}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </View>
          </Pressable>
          <RowInput
            label={t('collection.numberPad')}
            value={String(settings.collection_number_pad)}
            placeholder="4"
            keyboardType="number-pad"
            onCommit={(v) => {
              // 0 = 不補零；上限 10 避免打錯字產生荒謬的長號碼。
              const n = Math.floor(Number(v));
              const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 0), 10) : 4;
              settings.set('collection_number_pad', clamped);
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
        <Section title={t('settings.sectionExport')}>
          {/* Same row shape as the regionPacks / surveyors rows, but it opens
              the existing sheet instead of pushing a route — the sheet is a
              self-contained component with its own chrome. */}
          <Pressable
            onPress={() => setExportPrefOpen(true)}
            className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <View className="flex-1 pr-3">
              <Text className="text-base text-gray-900 dark:text-gray-100">{t('exportPref.title')}</Text>
              <Text className="text-xs text-gray-500 dark:text-gray-400">{t('settings.exportPrefDesc')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
        </Section>
        <Section title={t('settings.sectionData')}>
          <Pressable
            onPress={handleCheckIntegrity}
            className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">{t('settings.integrityCheck')}</Text>
            <Text className="text-xs text-gray-500 dark:text-gray-400">{t('settings.integrityDesc')}</Text>
          </Pressable>
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

      <ExportPreferenceSheet
        visible={exportPrefOpen}
        onClose={() => setExportPrefOpen(false)}
      />

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

/**
 * A settings row that opens a modal list — the select this app uses instead of
 * a native picker (no new native module, and it renders identically on both
 * platforms). `searchable` adds a filter box; only worth it for long lists
 * like the language catalogue.
 */
function SelectRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  searchable = false,
  searchPlaceholder,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; sublabel?: string }>;
  onChange: (v: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!searchable || !needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.sublabel ?? '').toLowerCase().includes(needle) ||
        String(o.value).toLowerCase().includes(needle),
    );
  }, [options, q, searchable]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text className="text-base text-gray-900 dark:text-gray-100">{label}</Text>
        <View className="flex-row items-center">
          <Text className="mr-1 text-base text-gray-500 dark:text-gray-400">
            {current?.label ?? String(value)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
        </View>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        onShow={() => setQ('')}
      >
        <View style={{ paddingTop: insets.top }} className="flex-1 bg-white dark:bg-gray-900">
          <View className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3">
            <Text className="flex-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {label}
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={10}
              accessibilityLabel={t('common.cancel')}
            >
              <Ionicons name="close" size={22} color="#6b7280" />
            </Pressable>
          </View>
          {searchable ? (
            <View className="px-4 py-2">
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={searchPlaceholder}
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100"
              />
            </View>
          ) : null}
          <FlatList
            data={rows}
            keyExtractor={(o) => String(o.value)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-blue-50 dark:active:bg-blue-900/40"
              >
                <View className="flex-1">
                  <Text className="text-base text-gray-900 dark:text-gray-100">{item.label}</Text>
                  {item.sublabel ? (
                    <Text className="text-xs text-gray-500 dark:text-gray-400">{item.sublabel}</Text>
                  ) : null}
                </View>
                {item.value === value ? (
                  <Ionicons name="checkmark" size={20} color="#2563eb" />
                ) : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  );
}
