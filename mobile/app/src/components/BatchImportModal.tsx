import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addFavorite,
  addRecord,
  isTaxonInFolder,
  isTaxonInSession,
  type SearchResult,
} from '~/db';
import {
  parseInput,
  resolveBatch,
  type CategorizedImport,
  type ParsedEntry,
} from '~/lib/batchImport';
import { splitVoiceInput } from '~/lib/voiceSplit';
import { ScientificName } from './ScientificName';

/** Where matched taxa land. The modal owns the dedupe + insert for each kind
 *  so callers don't reimplement it; adding a third target means one more case
 *  here, not a new modal. */
export type BatchImportTarget =
  | { kind: 'session'; sessionId: number }
  | { kind: 'favorites'; folderId: number };

type Props = {
  visible: boolean;
  target: BatchImportTarget;
  onClose: () => void;
  onCommitted: (added: number) => void;
};

/** Already present in the target? */
function targetHas(target: BatchImportTarget, taxonId: string): boolean {
  return target.kind === 'session'
    ? isTaxonInSession(target.sessionId, taxonId)
    : isTaxonInFolder(target.folderId, taxonId);
}

function targetAdd(target: BatchImportTarget, m: SearchResult): void {
  if (target.kind === 'session') addRecord({ session_id: target.sessionId, taxon_id: m.taxon_id });
  else addFavorite(m, target.folderId);
}

type Step = 'input' | 'preview';
type InputMode = 'paste' | 'voice';

export function BatchImportModal({ visible, target, onClose, onCommitted }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('input');
  const [inputMode, setInputMode] = useState<InputMode>('paste');
  const [text, setText] = useState('');
  // A picked file is parsed on read and kept as entries — never poured into the
  // TextInput (a checklist .yml is thousands of lines; rendering it in a
  // multiline input hangs the UI, and its yml keys aren't names).
  const [pickedFile, setPickedFile] = useState<{ name: string; entries: ParsedEntry[] } | null>(null);
  const [resolved, setResolved] = useState<CategorizedImport | null>(null);
  // For exact entries: track which to skip (default: all selected)
  const [skipExact, setSkipExact] = useState<Set<number>>(new Set());
  // For ambiguous entries: track which match was picked (or null for skip)
  const [ambiguousPicks, setAmbiguousPicks] = useState<Map<number, SearchResult | null>>(new Map());

  // A picked file replaces the typed text; voice mode never uses it.
  const usingFile = inputMode === 'paste' && pickedFile !== null;

  const reset = () => {
    setStep('input');
    setInputMode('paste');
    setText('');
    setPickedFile(null);
    setResolved(null);
    setSkipExact(new Set());
    setAmbiguousPicks(new Map());
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFile = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/x-yaml', 'text/yaml', '*/*'],
        copyToCacheDirectory: true,
      });
      if (r.canceled) return;
      const asset = r.assets[0];
      if (!asset?.uri) return;
      const file = new File(asset.uri);
      const content = await file.text();
      const entries = parseInput(content);
      if (entries.length === 0) {
        Alert.alert(t('batchImport.noNames'), t('batchImport.noNamesFile'));
        return;
      }
      setPickedFile({ name: asset.name || t('batchImport.pickedFileFallback'), entries });
    } catch (e) {
      Alert.alert(t('batchImport.readFail'), e instanceof Error ? e.message : String(e));
    }
  };

  const handlePreview = () => {
    const voice = inputMode === 'voice';
    const names: (string | ParsedEntry)[] = usingFile
      ? pickedFile!.entries
      : voice
        ? splitVoiceInput(text)
        : parseInput(text);
    if (names.length === 0) {
      Alert.alert(
        t('batchImport.noNames'),
        voice ? t('batchImport.noNamesVoice') : t('batchImport.noNamesText'),
      );
      return;
    }
    // Voice dictation garbles uncommon names into homophones; enable the
    // toneless-pinyin fallback so they still resolve.
    const r = resolveBatch(names, { phonetic: voice });
    setResolved(r);
    setSkipExact(new Set());
    const picks = new Map<number, SearchResult | null>();
    for (let i = 0; i < r.ambiguous.length; i++) picks.set(i, r.ambiguous[i].matches[0] ?? null);
    setAmbiguousPicks(picks);
    setStep('preview');
  };

  const handleCommit = () => {
    if (!resolved) return;
    const toAdd: SearchResult[] = [];
    resolved.exact.forEach((e, idx) => {
      if (!skipExact.has(idx) && e.matches[0]) toAdd.push(e.matches[0]);
    });
    resolved.ambiguous.forEach((_, idx) => {
      const pick = ambiguousPicks.get(idx);
      if (pick) toAdd.push(pick);
    });

    let added = 0;
    let skipped = 0;
    for (const m of toAdd) {
      if (!m.taxon_id) {
        skipped++;
        continue;
      }
      if (targetHas(target, m.taxon_id)) {
        skipped++;
        continue;
      }
      targetAdd(target, m);
      added++;
    }
    onCommitted(added);
    if (skipped > 0) {
      Alert.alert(
        t('batchImport.done'),
        t('batchImport.doneMsg', { added, skipped }),
      );
    }
    handleClose();
  };

  const totalSelected =
    (resolved?.exact.filter((_, i) => !skipExact.has(i)).length ?? 0) +
    (resolved?.ambiguous.filter((_, i) => ambiguousPicks.get(i) !== null).length ?? 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View
        className="flex-1 bg-white dark:bg-gray-900"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={handleClose} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {step === 'input' ? t('batchImport.title') : t('batchImport.previewTitle', { count: totalSelected })}
          </Text>
          {step === 'input' ? (
            <Pressable onPress={handlePreview} hitSlop={8}>
              <Text className="text-base font-semibold text-blue-600 dark:text-blue-400">{t('batchImport.preview')}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleCommit} hitSlop={8} disabled={totalSelected === 0}>
              <Text
                className={`text-base font-semibold ${totalSelected === 0 ? 'text-gray-300' : 'text-blue-600 dark:text-blue-400'}`}
              >
                {t('batchImport.add')}
              </Text>
            </Pressable>
          )}
        </View>

        {step === 'input' ? (
          <KeyboardAvoidingView className="flex-1" behavior="padding">
            <View className="flex-row border-b border-gray-200 dark:border-gray-700">
              <ModeTab
                label={t('batchImport.paste')}
                icon="clipboard-outline"
                active={inputMode === 'paste'}
                onPress={() => setInputMode('paste')}
              />
              <ModeTab
                label={t('batchImport.voice')}
                icon="mic-outline"
                active={inputMode === 'voice'}
                onPress={() => setInputMode('voice')}
              />
            </View>
            <View className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-3">
              {inputMode === 'paste' ? (
                <>
                  <Text className="text-xs text-gray-600 dark:text-gray-400">
                    {t('batchImport.inputHint')}
                  </Text>
                  <Pressable
                    onPress={handlePickFile}
                    className="mt-2 flex-row items-center self-start rounded-full bg-white dark:bg-gray-900 px-3 py-1.5 active:bg-blue-50 dark:active:bg-blue-900/40"
                  >
                    <Ionicons name="folder-open-outline" size={14} color="#2563eb" />
                    <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300">{t('batchImport.readFromFile')}</Text>
                  </Pressable>
                </>
              ) : (
                <Text className="text-xs text-gray-600 dark:text-gray-400">
                  {t('batchImport.voiceHint')}
                </Text>
              )}
            </View>
            {usingFile ? (
              <View className="flex-1 px-4 py-4">
                <View className="flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-3">
                  <Ionicons name="document-text-outline" size={20} color="#2563eb" />
                  <View className="ml-2 flex-1">
                    <Text
                      numberOfLines={1}
                      className="text-sm font-medium text-gray-900 dark:text-gray-100"
                    >
                      {pickedFile!.name}
                    </Text>
                    <Text className="text-xs text-gray-500 dark:text-gray-400">
                      {t('batchImport.fileLoaded', { count: pickedFile!.entries.length })}
                    </Text>
                  </View>
                  <Pressable onPress={() => setPickedFile(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color="#9ca3af" />
                  </Pressable>
                </View>
                <Text className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                  {t('batchImport.fileHint')}
                </Text>
              </View>
            ) : (
              <TextInput
                className="flex-1 px-4 py-3 text-base text-gray-900 dark:text-gray-100"
                value={text}
                onChangeText={setText}
                multiline
                autoFocus
                placeholder={
                  inputMode === 'voice'
                    ? t('batchImport.exampleVoice')
                    : t('batchImport.exampleText')
                }
                placeholderTextColor="#9ca3af"
                textAlignVertical="top"
              />
            )}
          </KeyboardAvoidingView>
        ) : (
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {resolved && resolved.exact.length > 0 ? (
              <Section
                title={t('batchImport.exactTitle', { n: resolved.exact.filter((_, i) => !skipExact.has(i)).length, total: resolved.exact.length })}
                hint={t('batchImport.exactHint')}
                color="green"
              >
                {resolved.exact.map((e, idx) => {
                  const m = e.matches[0];
                  const skipped = skipExact.has(idx);
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => {
                        setSkipExact((prev) => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        });
                      }}
                      className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-2 ${skipped ? 'opacity-40' : ''}`}
                    >
                      <Ionicons
                        name={skipped ? 'square-outline' : 'checkbox'}
                        size={20}
                        color={skipped ? '#9ca3af' : '#10b981'}
                        style={{ marginRight: 10 }}
                      />
                      <View className="flex-1">
                        {m.cname ? (
                          <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.cname}</Text>
                        ) : null}
                        <ScientificName
                          name={m.name}
                          author={m.fullname.replace(m.name, '').trim()}
                          kingdom={m.kingdom}
                          className="text-xs text-gray-700 dark:text-gray-300"
                        />
                        <Text className="text-[11px] text-gray-500 dark:text-gray-400">{t('batchImport.rawInput', { raw: e.raw })}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </Section>
            ) : null}

            {resolved && resolved.ambiguous.length > 0 ? (
              <Section
                title={t('batchImport.confirmTitle', { n: resolved.ambiguous.filter((_, i) => ambiguousPicks.get(i) !== null).length, total: resolved.ambiguous.length })}
                hint={t('batchImport.confirmHint')}
                color="amber"
              >
                {resolved.ambiguous.map((e, idx) => {
                  const pick = ambiguousPicks.get(idx);
                  return (
                    <View key={idx} className="border-b border-gray-100 dark:border-gray-800 px-4 py-2">
                      <Text className="text-xs text-gray-600 dark:text-gray-400">{t('batchImport.rawInput', { raw: e.raw })}</Text>
                      <View className="mt-1">
                        <Pressable
                          onPress={() =>
                            setAmbiguousPicks((prev) => new Map(prev).set(idx, null))
                          }
                          className={`mb-1 flex-row items-center px-1 ${pick === null ? 'opacity-100' : 'opacity-40'}`}
                        >
                          <Ionicons
                            name={pick === null ? 'radio-button-on' : 'radio-button-off'}
                            size={16}
                            color={pick === null ? '#6b7280' : '#9ca3af'}
                          />
                          <Text className="ml-2 text-xs italic text-gray-600 dark:text-gray-400">{t('batchImport.skipThis')}</Text>
                        </Pressable>
                        {e.matches.slice(0, 5).map((m, mi) => {
                          const selected = pick?.id === m.id;
                          return (
                            <Pressable
                              key={mi}
                              onPress={() =>
                                setAmbiguousPicks((prev) => new Map(prev).set(idx, m))
                              }
                              className={`flex-row items-center rounded px-1 py-1 ${selected ? 'bg-amber-50 dark:bg-amber-950/40' : ''}`}
                            >
                              <Ionicons
                                name={selected ? 'radio-button-on' : 'radio-button-off'}
                                size={16}
                                color={selected ? '#d97706' : '#9ca3af'}
                              />
                              <View className="ml-2 flex-1">
                                {m.cname ? (
                                  <Text className="text-sm text-gray-900 dark:text-gray-100">{m.cname}</Text>
                                ) : null}
                                <ScientificName
                                  name={m.name}
                                  author={m.fullname.replace(m.name, '').trim()}
                                  kingdom={m.kingdom}
                                  className="text-xs text-gray-700 dark:text-gray-300"
                                />
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </Section>
            ) : null}

            {resolved && resolved.unmatched.length > 0 ? (
              <Section
                title={t('batchImport.notFoundTitle', { count: resolved.unmatched.length })}
                hint={t('batchImport.notFoundHint')}
                color="red"
              >
                {resolved.unmatched.map((e, idx) => (
                  <View key={idx} className="border-b border-gray-100 dark:border-gray-800 px-4 py-2">
                    <Text className="text-sm text-gray-700 dark:text-gray-300">{e.raw}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {resolved &&
            resolved.exact.length === 0 &&
            resolved.ambiguous.length === 0 &&
            resolved.unmatched.length === 0 ? (
              <View className="px-4 py-12">
                <Text className="text-center text-sm text-gray-500 dark:text-gray-400">{t('batchImport.nothingToImport')}</Text>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function ModeTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center py-2.5 ${active ? 'border-b-2 border-blue-600 dark:border-blue-400' : ''}`}
    >
      <Ionicons name={icon} size={16} color={active ? '#2563eb' : '#9ca3af'} />
      <Text
        className={`ml-1.5 text-sm font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  hint,
  color,
  children,
}: {
  title: string;
  hint: string;
  color: 'green' | 'amber' | 'red';
  children: React.ReactNode;
}) {
  const bg =
    color === 'green' ? 'bg-emerald-50 dark:bg-emerald-950/40' : color === 'amber' ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-red-50 dark:bg-red-950/40';
  const fg =
    color === 'green' ? 'text-emerald-700 dark:text-emerald-300' : color === 'amber' ? 'text-amber-800 dark:text-amber-300' : 'text-red-700 dark:text-red-400';
  return (
    <View className="mt-2">
      <View className={`border-b border-gray-200 dark:border-gray-700 ${bg} px-4 py-2`}>
        <Text className={`text-sm font-semibold ${fg}`}>{title}</Text>
        <Text className="text-[11px] text-gray-600 dark:text-gray-400">{hint}</Text>
      </View>
      {children}
    </View>
  );
}
