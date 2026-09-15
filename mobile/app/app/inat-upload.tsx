/**
 * 上傳到 iNaturalist — one record unit (a session / plot survey / collection
 * trip) at a time.
 *
 * A stack route rather than a bottom sheet: it has a TextInput (tags), and the
 * project rule is that anything with an input is full-screen; it also has to
 * present the login WebView Modal, which cannot sit on top of another Modal.
 *
 * The page is a pure subscriber of `useInatUpload` — leaving it does not stop
 * the batch, coming back shows the same batch. Rows are re-read from the DB
 * whenever a batch finishes, so status (未上傳 / 未完成 / 已上傳 #id) always
 * reflects what was persisted, not what the UI remembers.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScientificName } from '~/components/ScientificName';
import type { RecordKind } from '~/db';
import { observationWebUrl } from '~/lib/inatApi';
import { getInatStatus } from '~/lib/inatAuth';
import { GEOPRIVACY_VALUES, parseTags, type Geoprivacy, type LocationSource } from '~/lib/inatPayload';
import {
  cancelUpload,
  driveUpload,
  estimateBatch,
  listEligible,
  useInatUpload,
  type EligibleList,
  type EligibleRecord,
  type UploadResult,
  type UploadUnit,
} from '~/lib/inatUpload';
import { useExportShare } from '~/lib/useExportShare';
import { useSettings } from '~/stores/settings';

/** Rough transfer size for the confirm-if-large prompt; originals go up
 *  unresized, so a phone photo is a few MB. */
const PHOTO_BYTES = 3 * 1024 * 1024;
const AUDIO_BYTES = 1 * 1024 * 1024;

const KINDS: RecordKind[] = ['session', 'plot', 'collection'];

export default function InatUploadScreen() {
  const params = useLocalSearchParams<{ kind?: string; id?: string; record?: string }>();
  const kind = (KINDS as string[]).includes(params.kind ?? '') ? (params.kind as RecordKind) : 'session';
  const id = Number(params.id ?? 0);
  const unit = useMemo<UploadUnit>(() => ({ kind, id }), [kind, id]);
  /** Set when opened from a single row's swipe action: only that record is
   *  pre-selected (it is listed like any other, so the user can still add). */
  const onlyRecordId = Number(params.record ?? 0) || null;

  const { t } = useTranslation();
  const router = useRouter();
  const defaultGeoprivacy = useSettings((s) => s.inat_geoprivacy);
  const { confirmIfLarge } = useExportShare();

  const [list, setList] = useState<EligibleList>({ title: '', records: [], skippedNoMedia: 0 });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tagsText, setTagsText] = useState('');
  const [geoprivacy, setGeoprivacy] = useState<Geoprivacy>(defaultGeoprivacy);
  const [connected, setConnected] = useState<boolean | null>(null);

  const progress = useInatUpload((s) => s.progress);
  const result = useInatUpload((s) => s.result);
  const runningUnit = useInatUpload((s) => s.unit);
  const sameUnit = (u: UploadUnit | null) => u?.kind === unit.kind && u?.id === unit.id;
  const running = progress !== null && sameUnit(runningUnit);
  const otherRunning = progress !== null && !running;
  const lastResult = result && sameUnit(result.unit) ? result : null;

  const reload = useCallback(() => {
    const next = listEligible(unit);
    setList(next);
    // Default selection: needs a location, not already complete — or exactly
    // the row the user swiped, when opened from one.
    setSelected(
      new Set(
        next.records
          .filter((r) => r.status !== 'done' && (onlyRecordId ? r.id === onlyRecordId : Boolean(r.location)))
          .map((r) => r.id),
      ),
    );
    void getInatStatus().then((s) => setConnected(s !== null));
  }, [unit, onlyRecordId]);

  useFocusEffect(reload);
  useEffect(() => {
    if (lastResult) reload();
  }, [lastResult, reload]);

  const chosen = list.records.filter((r) => selected.has(r.id));
  const est = estimateBatch(chosen);
  const failureFor = (recId: number) => lastResult?.failures.find((f) => f.id === recId)?.message ?? null;

  const toggle = (r: EligibleRecord) => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
  };

  const handleUpload = async () => {
    if (chosen.length === 0 || running || otherRunning) return;
    if (!connected) {
      router.push('/inaturalist' as Href);
      return;
    }
    const ok = await confirmIfLarge(est.photos * PHOTO_BYTES + est.audio * AUDIO_BYTES);
    if (!ok) return;
    driveUpload(unit, chosen, { tags: parseTags(tagsText), geoprivacy });
  };

  const resultText = (stopped: UploadResult['stopped'], v: { ok: number; failed: number; unresolved: number }) => {
    // Literal keys and inline params so check-i18n verifies key and placeholders.
    if (stopped === 'completed')
      return t('inat.resultCompleted', { ok: v.ok, failed: v.failed, unresolved: v.unresolved });
    if (stopped === 'cancelled') return t('inat.resultCancelled', { ok: v.ok, failed: v.failed });
    if (stopped === 'offline') return t('inat.resultOffline', { ok: v.ok, failed: v.failed });
    return t('inat.resultAuth', { ok: v.ok, failed: v.failed });
  };

  const sourceLabel: Record<LocationSource, string> = {
    record: t('inat.locRecord'),
    plot: t('inat.locPlot'),
    site: t('inat.locSite'),
    session: t('inat.locSession'),
  };
  const geoLabel: Record<Geoprivacy, string> = {
    open: t('inat.geoprivacyOpen'),
    obscured: t('inat.geoprivacyObscured'),
    private: t('inat.geoprivacyPrivate'),
  };

  const renderRow = ({ item: r }: { item: EligibleRecord }) => {
    const done = r.status === 'done';
    const checked = selected.has(r.id);
    const failure = failureFor(r.id);
    return (
      <Pressable
        onPress={() => (done ? undefined : toggle(r))}
        disabled={done || running}
        className={`flex-row border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${done ? 'opacity-60' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
      >
        <Ionicons
          name={done ? 'checkmark-circle' : checked ? 'checkbox' : 'square-outline'}
          size={22}
          color={done ? '#16a34a' : checked ? '#2563eb' : '#9ca3af'}
        />
        <View className="ml-3 flex-1">
          <Text className="text-base text-gray-900 dark:text-gray-100" numberOfLines={1}>
            {r.cname ? `${r.cname} ` : ''}
            <ScientificName name={r.name} kingdom={r.kingdom} className="text-sm text-gray-600 dark:text-gray-400" />
          </Text>
          <View className="mt-0.5 flex-row flex-wrap items-center">
            {r.photos.length > 0 ? (
              <Text className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                <Ionicons name="camera-outline" size={12} /> {r.photos.length}
              </Text>
            ) : null}
            {r.audio.length > 0 ? (
              <Text className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                <Ionicons name="mic-outline" size={12} /> {r.audio.length}
              </Text>
            ) : null}
            <Text className={`mr-2 text-xs ${r.location ? 'text-gray-500 dark:text-gray-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {r.location ? sourceLabel[r.location.source] : t('inat.locNone')}
            </Text>
            {r.status === 'partial' ? (
              <Text className="mr-2 text-xs text-amber-600 dark:text-amber-400">{t('inat.statusPartial')}</Text>
            ) : null}
            {running && progress?.currentId === r.id ? (
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color="#74AB00" />
                <Text className="ml-1 text-xs text-[#74AB00]">{t('inat.rowUploading')}</Text>
              </View>
            ) : null}
          </View>
          {failure ? <Text className="mt-0.5 text-xs text-red-600 dark:text-red-400">{failure}</Text> : null}
        </View>
        {r.observationId !== null ? (
          <Pressable
            onPress={() => void Linking.openURL(observationWebUrl(r.observationId!))}
            hitSlop={8}
            className="ml-2 justify-center"
            accessibilityRole="link"
          >
            <Text className="text-xs text-blue-600 dark:text-blue-400">#{r.observationId}</Text>
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: list.title ? `${t('nav.inatUpload')} · ${list.title}` : t('nav.inatUpload') }} />
      <FlatList
        data={list.records}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="px-4 pt-3">
            {connected === false ? (
              <Pressable
                onPress={() => router.push('/inaturalist' as Href)}
                className="mb-3 flex-row items-center rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/30 px-3 py-2"
              >
                <Ionicons name="alert-circle-outline" size={18} color="#d97706" />
                <Text className="ml-2 flex-1 text-sm text-amber-800 dark:text-amber-200">{t('inat.notConnectedHint')}</Text>
                <Ionicons name="chevron-forward" size={16} color="#d97706" />
              </Pressable>
            ) : null}
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {t('inat.eligibleSummary', { count: list.records.length })}
              {list.skippedNoMedia > 0 ? ` · ${t('inat.skippedNoMedia', { count: list.skippedNoMedia })}` : ''}
            </Text>

            <Text className="mt-3 mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">{t('inat.tags')}</Text>
            <TextInput
              value={tagsText}
              onChangeText={setTagsText}
              editable={!running}
              placeholder={t('inat.tagsPlaceholder')}
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
            />

            <Text className="mt-3 mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">{t('inat.geoprivacy')}</Text>
            <View className="flex-row overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              {GEOPRIVACY_VALUES.map((g) => {
                const active = g === geoprivacy;
                return (
                  <Pressable
                    key={g}
                    onPress={() => !running && setGeoprivacy(g)}
                    className={`flex-1 items-center py-1.5 ${active ? 'bg-blue-500' : 'bg-white dark:bg-gray-900'}`}
                  >
                    <Text className={`text-sm ${active ? 'font-semibold text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {geoLabel[g]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="mt-3 flex-row items-center justify-between">
              <Text className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('inat.recordsHeader')}</Text>
              {!running ? (
                <Pressable
                  onPress={() =>
                    setSelected((prev) =>
                      prev.size === list.records.filter((r) => r.status !== 'done').length
                        ? new Set()
                        : new Set(list.records.filter((r) => r.status !== 'done').map((r) => r.id)),
                    )
                  }
                  hitSlop={6}
                >
                  <Text className="text-xs text-blue-600 dark:text-blue-400">{t('inat.toggleAll')}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('inat.emptyList')}</Text>
        }
        ListFooterComponent={
          lastResult ? (
            <Text className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
              {resultText(lastResult.stopped, {
                ok: lastResult.ok,
                failed: lastResult.failures.length,
                unresolved: lastResult.unresolvedTaxa,
              })}
            </Text>
          ) : null
        }
      />

      <View className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pb-2 pt-2">
        {running && progress ? (
          <>
            <Text className="text-xs text-gray-600 dark:text-gray-400" numberOfLines={1}>
              {progress.phase === 'auth'
                ? t('inat.progressAuth')
                : t('inat.progressUploading', { done: progress.done, total: progress.total, name: progress.current })}
            </Text>
            <View className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <View
                className="h-2 rounded-full bg-[#74AB00]"
                style={{
                  width: `${
                    progress.requestsTotal > 0
                      ? Math.round((progress.requestsDone / progress.requestsTotal) * 100)
                      : progress.total > 0
                        ? Math.round((progress.done / progress.total) * 100)
                        : 0
                  }%`,
                }}
              />
            </View>
            <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('inat.progressRequests', { done: progress.requestsDone, total: progress.requestsTotal })}
            </Text>
            <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('inat.keepForeground')}</Text>
            <Pressable
              onPress={cancelUpload}
              className="mt-2 items-center rounded-xl border border-gray-300 dark:border-gray-600 py-2 active:bg-gray-100 dark:active:bg-gray-800"
            >
              <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('inat.cancelUpload')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {t('inat.estimate', { requests: est.requests, seconds: est.requests, photos: est.photos, audio: est.audio })}
            </Text>
            <Pressable
              onPress={handleUpload}
              disabled={chosen.length === 0 || otherRunning}
              className={`mt-2 items-center rounded-xl py-3 ${chosen.length === 0 || otherRunning ? 'bg-gray-300 dark:bg-gray-700' : 'bg-[#74AB00] active:bg-[#5E8A00]'}`}
            >
              <Text className="text-base font-semibold text-white">
                {otherRunning ? t('inat.otherRunning') : t('inat.uploadN', { count: chosen.length })}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
