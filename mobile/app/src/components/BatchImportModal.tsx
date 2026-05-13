import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addRecord, isTaxonInSession, type SearchResult } from '~/db';
import { parseInput, resolveBatch, type CategorizedImport } from '~/lib/batchImport';
import { ScientificName } from './ScientificName';

type Props = {
  visible: boolean;
  sessionId: number;
  onClose: () => void;
  onCommitted: (added: number) => void;
};

type Step = 'input' | 'preview';

export function BatchImportModal({ visible, sessionId, onClose, onCommitted }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<CategorizedImport | null>(null);
  // For exact entries: track which to skip (default: all selected)
  const [skipExact, setSkipExact] = useState<Set<number>>(new Set());
  // For ambiguous entries: track which match was picked (or null for skip)
  const [ambiguousPicks, setAmbiguousPicks] = useState<Map<number, SearchResult | null>>(new Map());

  const reset = () => {
    setStep('input');
    setText('');
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
      setText(content);
    } catch (e) {
      Alert.alert('讀檔失敗', e instanceof Error ? e.message : String(e));
    }
  };

  const handlePreview = () => {
    const names = parseInput(text);
    if (names.length === 0) {
      Alert.alert('沒有可匯入的名稱', '請輸入或貼上每行一個名稱');
      return;
    }
    const r = resolveBatch(names);
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
      if (isTaxonInSession(sessionId, m.taxon_id)) {
        skipped++;
        continue;
      }
      addRecord({ session_id: sessionId, taxon_id: m.taxon_id });
      added++;
    }
    onCommitted(added);
    if (skipped > 0) {
      Alert.alert(
        '匯入完成',
        `已加入 ${added} 筆，略過 ${skipped} 筆（重複或缺 taxon_id）`,
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
        className="flex-1 bg-white"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3">
          <Pressable onPress={handleClose} hitSlop={8}>
            <Text className="text-base text-gray-700">取消</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900">
            {step === 'input' ? '批次匯入' : `預覽（將加入 ${totalSelected} 筆）`}
          </Text>
          {step === 'input' ? (
            <Pressable onPress={handlePreview} hitSlop={8}>
              <Text className="text-base font-semibold text-blue-600">預覽</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleCommit} hitSlop={8} disabled={totalSelected === 0}>
              <Text
                className={`text-base font-semibold ${totalSelected === 0 ? 'text-gray-300' : 'text-blue-600'}`}
              >
                加入
              </Text>
            </Pressable>
          )}
        </View>

        {step === 'input' ? (
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View className="border-b border-gray-100 bg-gray-50 px-4 py-3">
              <Text className="text-xs text-gray-600">
                每行一個名稱（俗名 / 學名 / 科）。支援貼上 .yml 匯出檔內容。
              </Text>
              <Pressable
                onPress={handlePickFile}
                className="mt-2 flex-row items-center self-start rounded-full bg-white px-3 py-1.5 active:bg-blue-50"
              >
                <Ionicons name="folder-open-outline" size={14} color="#2563eb" />
                <Text className="ml-1 text-xs font-medium text-blue-700">從檔案讀入</Text>
              </Pressable>
            </View>
            <TextInput
              className="flex-1 px-4 py-3 text-base text-gray-900"
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              placeholder={'例：\n殼斗科\n大葉雀榕\nLithocarpus konishii'}
              placeholderTextColor="#9ca3af"
              textAlignVertical="top"
            />
          </KeyboardAvoidingView>
        ) : (
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {resolved && resolved.exact.length > 0 ? (
              <Section
                title={`精確匹配 (${resolved.exact.filter((_, i) => !skipExact.has(i)).length}/${resolved.exact.length})`}
                hint="自動匹配，可逐筆取消"
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
                      className={`flex-row items-center border-b border-gray-100 px-4 py-2 ${skipped ? 'opacity-40' : ''}`}
                    >
                      <Ionicons
                        name={skipped ? 'square-outline' : 'checkbox'}
                        size={20}
                        color={skipped ? '#9ca3af' : '#10b981'}
                        style={{ marginRight: 10 }}
                      />
                      <View className="flex-1">
                        {m.cname ? (
                          <Text className="text-sm font-medium text-gray-900">{m.cname}</Text>
                        ) : null}
                        <ScientificName
                          name={m.name}
                          author={m.fullname.replace(m.name, '').trim()}
                          kingdom={m.kingdom}
                          className="text-xs text-gray-700"
                        />
                        <Text className="text-[11px] text-gray-500">原輸入：{e.raw}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </Section>
            ) : null}

            {resolved && resolved.ambiguous.length > 0 ? (
              <Section
                title={`需確認 (${resolved.ambiguous.filter((_, i) => ambiguousPicks.get(i) !== null).length}/${resolved.ambiguous.length})`}
                hint="同名稱有多筆候選，請挑選"
                color="amber"
              >
                {resolved.ambiguous.map((e, idx) => {
                  const pick = ambiguousPicks.get(idx);
                  return (
                    <View key={idx} className="border-b border-gray-100 px-4 py-2">
                      <Text className="text-xs text-gray-600">原輸入：{e.raw}</Text>
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
                          <Text className="ml-2 text-xs italic text-gray-600">略過此筆</Text>
                        </Pressable>
                        {e.matches.slice(0, 5).map((m, mi) => {
                          const selected = pick?.id === m.id;
                          return (
                            <Pressable
                              key={mi}
                              onPress={() =>
                                setAmbiguousPicks((prev) => new Map(prev).set(idx, m))
                              }
                              className={`flex-row items-center rounded px-1 py-1 ${selected ? 'bg-amber-50' : ''}`}
                            >
                              <Ionicons
                                name={selected ? 'radio-button-on' : 'radio-button-off'}
                                size={16}
                                color={selected ? '#d97706' : '#9ca3af'}
                              />
                              <View className="ml-2 flex-1">
                                {m.cname ? (
                                  <Text className="text-sm text-gray-900">{m.cname}</Text>
                                ) : null}
                                <ScientificName
                                  name={m.name}
                                  author={m.fullname.replace(m.name, '').trim()}
                                  kingdom={m.kingdom}
                                  className="text-xs text-gray-700"
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
                title={`找不到 (${resolved.unmatched.length})`}
                hint="這些名稱在 TaiCOL 找不到，將被忽略"
                color="red"
              >
                {resolved.unmatched.map((e, idx) => (
                  <View key={idx} className="border-b border-gray-100 px-4 py-2">
                    <Text className="text-sm text-gray-700">{e.raw}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {resolved &&
            resolved.exact.length === 0 &&
            resolved.ambiguous.length === 0 &&
            resolved.unmatched.length === 0 ? (
              <View className="px-4 py-12">
                <Text className="text-center text-sm text-gray-500">沒有可匯入的內容</Text>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
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
    color === 'green' ? 'bg-emerald-50' : color === 'amber' ? 'bg-amber-50' : 'bg-red-50';
  const fg =
    color === 'green' ? 'text-emerald-700' : color === 'amber' ? 'text-amber-800' : 'text-red-700';
  return (
    <View className="mt-2">
      <View className={`border-b border-gray-200 ${bg} px-4 py-2`}>
        <Text className={`text-sm font-semibold ${fg}`}>{title}</Text>
        <Text className="text-[11px] text-gray-600">{hint}</Text>
      </View>
      {children}
    </View>
  );
}
