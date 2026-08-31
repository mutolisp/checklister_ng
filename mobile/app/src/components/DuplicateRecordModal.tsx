/**
 * 複製記錄 — name the copy and choose what travels with it.
 *
 * Three independent choices rather than one "copy everything" button, because
 * the useful copy is usually partial: the next plot in a series wants the
 * survey setup but not last week's cover values, and often wants the species
 * list as a starting point without its counts.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import type { DuplicateRecordOptions } from '~/db';

export type DuplicateRequest = {
  /** Name to pre-fill (already advanced past every taken name). */
  suggested: string;
  /** Every existing name of this kind, for the collision warning. */
  taken: Set<string>;
  /** 名錄 / 樣區 / 採集 — used in the title and the switch labels. */
  noun: string;
  /** Identifier-ish names (plotid) shouldn't be auto-capitalised. */
  autoCapitalize?: 'none' | 'sentences';
  /** 採集: specimens can't be pre-created — each owns a career collection
   *  number that would be burned for a gathering nobody made. */
  speciesDisabled?: boolean;
};

type Props = {
  request: DuplicateRequest | null;
  onCancel: () => void;
  onConfirm: (opts: DuplicateRecordOptions) => void;
};

export function DuplicateRecordModal({ request, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [includeEnv, setIncludeEnv] = useState(true);
  const [includeSpecies, setIncludeSpecies] = useState(false);
  const [activate, setActivate] = useState(false);

  useEffect(() => {
    if (!request) return;
    setName(request.suggested);
    setIncludeEnv(true);
    setIncludeSpecies(false);
    setActivate(false);
  }, [request]);

  const trimmed = name.trim();
  // A warning, not a block: re-surveying a permanent plot next season keeps
  // the SAME plotid on purpose — that is what makes the exported eventID join
  // across years. The check is here so a collision is never a surprise.
  const taken = request ? request.taken.has(trimmed) : false;
  const canConfirm = trimmed.length > 0;

  return (
    <Modal visible={request !== null} animationType="slide" onRequestClose={onCancel}>
      {/* Full-screen with a manual top inset — NOT a floating bottom sheet.
          A sheet anchored to the bottom gets pushed up by the keyboard, and on
          a short screen its top runs off the display (the header ends up under
          the status bar / notch). Same shape as SaveSiteModal / BatchImportModal:
          insets padding on the root, KAV + ScrollView for the body. */}
      <View
        className="flex-1 bg-white dark:bg-gray-900"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('records.duplicateTitle', { noun: request?.noun ?? '' })}
          </Text>
          <Pressable
            onPress={() =>
              onConfirm({
                name: trimmed,
                includeEnv,
                includeSpecies: request?.speciesDisabled ? false : includeSpecies,
                activate,
              })
            }
            disabled={!canConfirm}
            hitSlop={8}
          >
            <Text
              className={`text-base font-semibold ${
                canConfirm ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'
              }`}
            >
              {t('records.duplicate')}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <View className="px-4 pt-4">
              <Text className="text-xs text-gray-500 dark:text-gray-400">{t('records.newName')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoCapitalize={request?.autoCapitalize ?? 'sentences'}
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

            <View className="mt-2 px-4 pb-6">
              <Row
                label={t('records.includeEnv')}
                hint={t('records.includeEnvHint')}
                value={includeEnv}
                onChange={setIncludeEnv}
              />
              {request?.speciesDisabled ? (
                <View className="border-b border-gray-100 dark:border-gray-800 py-3">
                  <Text className="text-sm font-medium text-gray-400 dark:text-gray-500">
                    {t('records.includeSpecies')}
                  </Text>
                  <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {t('records.includeSpeciesCollection')}
                  </Text>
                </View>
              ) : (
                <Row
                  label={t('records.includeSpecies')}
                  hint={t('records.includeSpeciesHint')}
                  value={includeSpecies}
                  onChange={setIncludeSpecies}
                />
              )}
              <Row
                label={t('records.startNow')}
                hint={t('records.startNowHint')}
                value={activate}
                onChange={setActivate}
              />
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
    <View className="flex-row items-center border-b border-gray-100 dark:border-gray-800 py-3">
      <View className="flex-1 pr-3">
        <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</Text>
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}
