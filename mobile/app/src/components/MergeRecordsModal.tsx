/**
 * 合併記錄 — name the merged record, pick which source it inherits from, and
 * decide what happens to the sources.
 *
 * The primary picker is the load-bearing control: 時間 is the union of every
 * source, but 座標 and 環境資料 can only come from ONE of them (averaging two
 * plot centres would invent a place nobody surveyed), so the user has to say
 * which. The summary line under the picker spells that division out rather
 * than leaving it to be discovered after the fact.
 *
 * Full-screen, not a floating bottom sheet: it has a TextInput, and a sheet
 * anchored to the bottom gets shoved off the top of a short screen when the
 * keyboard opens (see DuplicateRecordModal's note).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import type { MergeRecordOptions } from '~/db';

export type MergeSource = { id: number; title: string; subtitle: string };

export type MergeRequest = {
  kind: 'session' | 'plot';
  /** In selection order; the first is the default primary. */
  sources: MergeSource[];
  /** Name to pre-fill (already advanced past every taken name). */
  suggested: string;
  /** Every existing name of this kind, for the collision warning. */
  taken: Set<string>;
  /** 名錄 / 樣區 — used in the title and labels. */
  noun: string;
};

type Props = {
  request: MergeRequest | null;
  onCancel: () => void;
  onConfirm: (opts: MergeRecordOptions) => void;
};

export function MergeRecordsModal({ request, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [primaryId, setPrimaryId] = useState(0);
  const [dedupe, setDedupe] = useState(true);
  const [keepSources, setKeepSources] = useState(true);

  useEffect(() => {
    if (!request) return;
    setName(request.suggested);
    setPrimaryId(request.sources[0]?.id ?? 0);
    setDedupe(true);
    // Keeping the originals is the reversible choice, so it is the default.
    setKeepSources(true);
  }, [request]);

  const trimmed = name.trim();
  const taken = request ? request.taken.has(trimmed) : false;
  const canConfirm = trimmed.length > 0 && primaryId > 0;

  return (
    <Modal visible={request !== null} animationType="slide" onRequestClose={onCancel}>
      <View
        className="flex-1 bg-white dark:bg-gray-900"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('records.mergeTitle', { noun: request?.noun ?? '' })}
          </Text>
          <Pressable
            onPress={() => onConfirm({ name: trimmed, primaryId, dedupe, keepSources })}
            disabled={!canConfirm}
            hitSlop={8}
          >
            <Text
              className={`text-base font-semibold ${
                canConfirm ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'
              }`}
            >
              {t('records.merge')}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <View className="px-4 pt-4">
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {t('records.mergeCount', { count: request?.sources.length ?? 0 })}
              </Text>
              <Text className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('records.newName')}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoCapitalize={request?.kind === 'plot' ? 'none' : 'sentences'}
                autoCorrect={false}
                className={`mt-1 rounded-lg border px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 ${
                  taken ? 'border-amber-400' : 'border-gray-300 dark:border-gray-700'
                }`}
                placeholderTextColor="#9ca3af"
              />
              {taken ? (
                <View className="mt-1 flex-row items-center">
                  <Ionicons name="alert-circle" size={14} color="#d97706" />
                  <Text className="ml-1 text-xs text-amber-700 dark:text-amber-400">
                    {t('records.nameTaken', { noun: request?.noun ?? '' })}
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="mt-5 px-4">
              <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t('records.mergePrimary')}
              </Text>
              <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t('records.mergePrimaryHint')}
              </Text>
            </View>
            <View className="mt-2">
              {(request?.sources ?? []).map((s) => {
                const active = s.id === primaryId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setPrimaryId(s.id)}
                    className={`flex-row items-center border-b border-gray-100 px-4 py-3 dark:border-gray-800 ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/40'
                        : 'active:bg-gray-50 dark:active:bg-gray-800'
                    }`}
                  >
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={active ? '#2563eb' : '#9ca3af'}
                      style={{ marginRight: 12 }}
                    />
                    <View className="flex-1">
                      <Text
                        numberOfLines={1}
                        className={`text-base ${
                          active
                            ? 'font-semibold text-blue-700 dark:text-blue-300'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        {s.title}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-gray-500 dark:text-gray-400">
                        {s.subtitle}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View className="mt-4 px-4 pb-8">
              <Row
                label={t('records.mergeDedupe')}
                hint={t('records.mergeDedupeHint')}
                value={dedupe}
                onChange={setDedupe}
              />
              <Row
                label={t('records.mergeKeepSources')}
                hint={t('records.mergeKeepSourcesHint')}
                value={keepSources}
                onChange={setKeepSources}
              />
              {keepSources ? null : (
                <View className="mt-3 flex-row items-start rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/40">
                  <Ionicons name="warning-outline" size={16} color="#dc2626" />
                  <Text className="ml-2 flex-1 text-xs text-red-700 dark:text-red-400">
                    {t('records.mergeDeleteWarn', { count: request?.sources.length ?? 0 })}
                  </Text>
                </View>
              )}
              <Text className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                {t('records.mergeExplain')}
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center border-b border-gray-100 py-3 dark:border-gray-800">
      <View className="flex-1 pr-3">
        <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</Text>
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}
