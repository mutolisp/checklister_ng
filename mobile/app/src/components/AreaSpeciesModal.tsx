/**
 * Map area → species list → a new 常用名錄 folder.
 *
 * Three steps, each of which the user can back out of: pick a source and
 * filters, wait for the fetch, then review what came back BEFORE anything is
 * written. The review step is not optional polish — a name that maps to several
 * local taxa must be decided by a human, and a name nothing local knows becomes
 * a new external taxon, which is a bigger commitment than adding a row.
 *
 * Also the app's only screen that can fail because of the network, so the
 * failure states are spelled out rather than reduced to one "error" toast.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { showActionSheet } from './ActionSheet';
import { ScientificName } from './ScientificName';
import { useThemeColors } from '~/hooks/useThemeColors';
import { ApiError } from '~/lib/apiFetch';
import { apiErrorMessage } from '~/lib/apiErrorMessage';
import {
  fetchSpeciesInBBox,
  ICONIC_TAXA,
  MAX_SPECIES,
  type BBox,
  type IconicTaxon,
} from '~/lib/inat';
import { fetchSpeciesInPolygon, GBIF_MAX_SPECIES } from '~/lib/gbif';
import {
  fromGbif,
  fromINat,
  importAreaSpecies,
  refineUnmatched,
  resolveAreaSpeciesChunked,
  summarize,
  type AreaEntry,
} from '~/lib/areaSpecies';
import { useFavorites } from '~/stores/favorites';
import type { FavoriteFolder } from '~/db';
import { setFavoriteFolderArea } from '~/db';

type Step = 'filters' | 'loading' | 'result';

/**
 * Where the imported species land.
 *
 * Creating a list every time makes the fourth query of the same area produce a
 * fourth near-identical list, so adding into one that already exists has to be
 * offered. The two cases differ in more than the id: only a NEW list records
 * the queried area as its provenance — overwriting an existing list's area
 * would relabel species that came from somewhere else.
 */
type Target = { kind: 'new' } | { kind: 'existing'; id: number; name: string };

/**
 * Which service answers the query.
 *
 * They are not interchangeable, and the difference is geometric: iNaturalist
 * has no polygon parameter, so it is asked about the drawn shape's BOUNDING
 * BOX; GBIF's `geometry=` takes WKT, so it is asked about the shape itself.
 */
type Source = 'inat' | 'gbif';

type Props = {
  visible: boolean;
  /** Bounding box of the drawn shape — what iNaturalist is asked about. */
  bbox: BBox | null;
  /** The drawn shape as WKT — what GBIF is asked about. */
  wkt: string | null;
  /** True when the drawn outline could not be used and its bounding box was
   *  substituted (fewer than three distinct vertices, or self-intersecting).
   *  Both sources then query the same rectangle; saying so matters because the
   *  queried area is larger than what the user drew. */
  simplified: boolean;
  /** The drawn shape as GeoJSON, stored on the folder as its provenance. */
  areaGeoJson: string | null;
  onClose: () => void;
  onImported: (folderName: string, added: number) => void;
};

/** ~4 decimal places is ±11 m, far finer than a finger-drawn boundary. */
const fmt = (n: number) => n.toFixed(4);

export function AreaSpeciesModal({
  visible,
  bbox,
  wkt,
  simplified,
  areaGeoJson,
  onClose,
  onImported,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const createFolder = useFavorites((s) => s.createFolder);
  const refresh = useFavorites((s) => s.refresh);
  const folders = useFavorites((s) => s.folders);

  const [step, setStep] = useState<Step>('filters');
  const [source, setSource] = useState<Source>('inat');
  const [researchOnly, setResearchOnly] = useState(true);
  const [iconic, setIconic] = useState<Set<IconicTaxon>>(new Set());
  const [entries, setEntries] = useState<AreaEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [resolving, setResolving] = useState<{ done: number; of: number } | null>(null);
  const [refining, setRefining] = useState<{ done: number; of: number } | null>(null);
  const [refineNote, setRefineNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [target, setTarget] = useState<Target>({ kind: 'new' });
  const [includeUnmatched, setIncludeUnmatched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep('filters');
    setSource('inat');
    setResearchOnly(true);
    setIconic(new Set());
    setEntries([]);
    setTotal(0);
    setTruncated(false);
    setProgress(null);
    setResolving(null);
    setRefining(null);
    setRefineNote(null);
    setError(null);
    setFolderName('');
    setTarget({ kind: 'new' });
    setIncludeUnmatched(false);
  };

  // The map screen never loads the favourites store on its own, so the list of
  // existing lists would be empty here without this.
  useEffect(() => {
    if (visible && folders.length === 0) refresh();
  }, [visible, folders.length, refresh]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleIconic = (k: IconicTaxon) => {
    setIconic((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // Shared with the search box's GBIF fallback — see src/lib/apiErrorMessage.ts.
  const messageFor = apiErrorMessage;

  const runQuery = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setProgress(null);
    setRefineNote(null);
    setStep('loading');
    try {
      const groups = iconic.size > 0 ? [...iconic] : undefined;
      const fetched =
        source === 'gbif'
          ? await (async () => {
              if (!wkt) throw new ApiError('gbif', 'parse', 'no geometry');
              // GBIF's own ceiling, not iNaturalist's: one faceted request
              // returns a whole group, so there is no reason to throw away
              // species that already came back in it.
              const r = await fetchSpeciesInPolygon(
                wkt,
                { groups, maxSpecies: GBIF_MAX_SPECIES },
                ctrl.signal,
                (done, of) => setProgress({ done, of }),
              );
              return { list: r.species.map(fromGbif), total: r.total, truncated: r.truncated };
            })()
          : await (async () => {
              if (!bbox) throw new ApiError('inat', 'parse', 'no bounding box');
              const r = await fetchSpeciesInBBox(
                bbox,
                { researchGradeOnly: researchOnly, iconicTaxa: groups },
                ctrl.signal,
              );
              return { list: r.species.map(fromINat), total: r.total, truncated: r.truncated };
            })();

      // Chunked: a GBIF area can be thousands of names, and resolving them in
      // one synchronous pass would freeze the screen for seconds.
      setProgress(null);
      setResolving({ done: 0, of: fetched.list.length });
      const resolved = await resolveAreaSpeciesChunked(
        fetched.list,
        (done, of) => setResolving({ done, of }),
        ctrl.signal,
      );
      if (ctrl.signal.aborted) {
        setStep('filters');
        return;
      }
      setEntries(resolved);
      setTotal(fetched.total);
      setTruncated(fetched.truncated);
      setStep('result');
    } catch (e) {
      if (ctrl.signal.aborted) {
        setStep('filters');
        return;
      }
      setError(await messageFor(e));
      setStep('filters');
    } finally {
      abortRef.current = null;
      setProgress(null);
      setResolving(null);
    }
  };

  const cancelQuery = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep('filters');
  };

  /** Ask GBIF about the names nothing local matched. Costs one request each, so
   *  it never runs on its own. */
  const runRefine = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRefineNote(null);
    setRefining({ done: 0, of: summary.unmatched });
    try {
      const r = await refineUnmatched(entries, ctrl.signal, (done, of) =>
        setRefining({ done, of }),
      );
      setEntries(r.entries);
      setRefineNote(
        t('areaSpecies.refineDone', { rescued: r.rescued, keyed: r.keyed, unknown: r.unknown }),
      );
    } catch (e) {
      setRefineNote(await messageFor(e));
    } finally {
      setRefining(null);
      abortRef.current = null;
    }
  };

  /** Let the user settle one ambiguous name. Never resolved automatically. */
  const pickCandidate = async (index: number) => {
    const e = entries[index];
    if (e.match.kind !== 'ambiguous') return;
    const idx = await showActionSheet({
      title: e.src.name,
      message: t('areaSpecies.pickMsg'),
      options: e.match.candidates.map((c) => ({
        label: `${c.simple_name}${c.name_author ? ` ${c.name_author}` : ''}${
          c.common_name_c ? ` · ${c.common_name_c}` : ''
        }`,
      })),
    });
    if (idx < 0) return;
    const chosen = e.match.candidates[idx];
    setEntries((prev) => prev.map((x, i) => (i === index ? { ...x, resolved: chosen } : x)));
  };

  const folderLabel = (f: FavoriteFolder) => (f.is_default ? t('favorites.defaultFolder') : f.name);

  const pickTarget = async () => {
    const idx = await showActionSheet({
      title: t('areaSpecies.targetTitle'),
      options: [
        { label: t('areaSpecies.targetNew') },
        ...folders.map((f) => ({
          label: `${folderLabel(f)} (${t('favorites.count', { count: f.species_count })})`,
        })),
      ],
    });
    if (idx < 0) return;
    if (idx === 0) {
      setTarget({ kind: 'new' });
      return;
    }
    const f = folders[idx - 1];
    setTarget({ kind: 'existing', id: f.id, name: folderLabel(f) });
  };

  const commit = () => {
    const name = folderName.trim();
    if (target.kind === 'new' && !name) return;
    const folderId = target.kind === 'new' ? createFolder(name) : target.id;
    const res = importAreaSpecies(entries, folderId, { includeUnmatched });
    // Provenance is only meaningful for a list this query created. An existing
    // list may already hold species from several areas, or from none.
    if (areaGeoJson && target.kind === 'new') setFavoriteFolderArea(folderId, areaGeoJson, source);
    refresh();
    const label = target.kind === 'new' ? name : target.name;
    reset();
    onImported(label, res.added);
  };

  const summary = summarize(entries);
  /** Unmatched entries that actually have an id to mint from. A GBIF facet
   *  result has none until `refineUnmatched` has given it a usageKey. */
  const mintable = entries.filter(
    (e) => e.match.kind === 'unmatched' && (e.gbifKey != null || e.src.key),
  ).length;
  const importable =
    summary.matched +
    entries.filter((e) => e.match.kind === 'ambiguous' && e.resolved).length +
    (includeUnmatched ? mintable : 0);
  const busy = refining !== null;
  const ready =
    importable > 0 && !busy && (target.kind === 'existing' || folderName.trim().length > 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      {/* Structure copied from PlotSpeciesValueModal, and it has to be: the
          KeyboardAvoidingView wrapper puts the caller's className on the OUTER
          measured View and gives its inner KAV `flex: 1`. Without `flex-1`
          here that inner KAV resolves to zero height inside an auto-sized
          parent, and the whole sheet renders 0 px tall — a dimmed screen that
          swallows touches with nothing on it and no way out. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable
          onPress={handleClose}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        <View
          className="flex-1 rounded-t-2xl bg-white dark:bg-gray-900"
          style={{ marginTop: insets.top + 16, paddingBottom: insets.bottom + 12 }}
        >
          <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <Pressable onPress={handleClose} hitSlop={8}>
              <Text className="text-base text-blue-500">{t('common.cancel')}</Text>
            </Pressable>
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t('areaSpecies.title')}
            </Text>
            <View className="w-14" />
          </View>

          {step === 'filters' ? (
            <ScrollView
              className="flex-1 px-4"
              contentContainerClassName="py-4"
              keyboardShouldPersistTaps="handled"
            >
              <Text className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('areaSpecies.source')}
              </Text>
              <View className="mb-2 flex-row gap-2">
                {(['inat', 'gbif'] as Source[]).map((s) => {
                  const on = source === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSource(s)}
                      className={`flex-1 items-center rounded-xl border px-3 py-2 ${
                        on
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          on ? 'text-blue-600 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {t(s === 'inat' ? 'areaSpecies.sourceINat' : 'areaSpecies.sourceGbif')}
                      </Text>
                      <Text className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                        {t(s === 'inat' ? 'areaSpecies.shapeBox' : 'areaSpecies.shapePolygon')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('areaSpecies.range')}
              </Text>
              {bbox ? (
                <Text className="mb-1 text-sm text-gray-700 dark:text-gray-300">
                  {fmt(bbox.swLat)}, {fmt(bbox.swLng)} — {fmt(bbox.neLat)}, {fmt(bbox.neLng)}
                </Text>
              ) : null}
              <Text className="mb-4 text-xs text-amber-600 dark:text-amber-400">
                {t(source === 'inat' ? 'areaSpecies.bboxNote' : 'areaSpecies.polygonNote')}
              </Text>

              {source === 'inat' ? (
                <View className="mb-4 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm text-gray-900 dark:text-gray-100">
                      {t('areaSpecies.researchOnly')}
                    </Text>
                    <Text className="text-xs text-gray-500 dark:text-gray-400">
                      {t('areaSpecies.researchOnlyHint')}
                    </Text>
                  </View>
                  <Switch value={researchOnly} onValueChange={setResearchOnly} />
                </View>
              ) : null}

              <Text className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('areaSpecies.groups')}
              </Text>
              <Text className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                {t('areaSpecies.groupsHint')}
              </Text>
              <View className="mb-2 flex-row flex-wrap gap-2">
                {ICONIC_TAXA.map((k) => {
                  const on = iconic.has(k);
                  return (
                    <Pressable
                      key={k}
                      onPress={() => toggleIconic(k)}
                      className={`rounded-full border px-3 py-1.5 ${
                        on
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
                      }`}
                    >
                      <Text
                        className={`text-xs ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {t(`areaSpecies.iconic.${k}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {/* GBIF's backbone has no usable concept for these two, so
                  selecting them widens the query to the whole kingdom. */}
              {source === 'gbif' && (iconic.has('Reptilia') || iconic.has('Actinopterygii')) ? (
                <Text className="mb-3 text-xs text-amber-600 dark:text-amber-400">
                  {t('areaSpecies.gbifCoarseGroup')}
                </Text>
              ) : null}

              {error ? (
                <View className="mb-4 mt-2 rounded-lg bg-red-50 p-3 dark:bg-red-900/30">
                  <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
                </View>
              ) : null}

              <Text className="mb-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t(source === 'inat' ? 'areaSpecies.attribution' : 'areaSpecies.attributionGbif')}
              </Text>

              <Pressable
                onPress={runQuery}
                disabled={source === 'gbif' ? !wkt : !bbox}
                className={`items-center rounded-xl py-3 ${
                  (source === 'gbif' ? wkt : bbox)
                    ? 'bg-blue-500 active:bg-blue-600'
                    : 'bg-gray-300 dark:bg-gray-700'
                }`}
              >
                <Text className="text-base font-semibold text-white">
                  {t('areaSpecies.search')}
                </Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {step === 'loading' ? (
            <View className="items-center px-4 py-12">
              <ActivityIndicator size="large" />
              <Text className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                {resolving
                  ? t('areaSpecies.matching', { done: resolving.done, of: resolving.of })
                  : progress
                    ? t('areaSpecies.searchingGroup', { done: progress.done, of: progress.of })
                    : t('areaSpecies.searching')}
              </Text>
              <Pressable onPress={cancelQuery} className="mt-6 px-4 py-2" hitSlop={8}>
                <Text className="text-base text-blue-500">{t('common.cancel')}</Text>
              </Pressable>
            </View>
          ) : null}

          {step === 'result' ? (
            <>
              <View className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <Text className="text-sm text-gray-900 dark:text-gray-100">
                  {t('areaSpecies.found', { count: entries.length, total })}
                </Text>
                {truncated ? (
                  <Text className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                    {t('areaSpecies.truncated', {
                      max: source === 'gbif' ? GBIF_MAX_SPECIES : MAX_SPECIES,
                    })}
                  </Text>
                ) : null}
                <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('areaSpecies.breakdown', {
                    matched: summary.matched,
                    ambiguous: summary.ambiguous,
                    unmatched: summary.unmatched,
                  })}
                </Text>
              </View>

              {/* FlatList, not ScrollView: a GBIF area routinely returns
                  thousands of names and mounting every row at once is its own
                  freeze. Rows are pure and keyed by source+name, so
                  virtualisation is safe here. */}
              <FlatList
                className="flex-1 px-4"
                contentContainerClassName="py-2"
                data={entries}
                keyExtractor={(e) => `${e.src.source}:${e.src.key || e.src.name}`}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={11}
                removeClippedSubviews
                renderItem={({ item: e, index: i }) => {
                  const kind = e.resolved ? 'matched' : e.match.kind;
                  const local =
                    e.match.kind === 'matched' ? e.match.candidate : (e.resolved ?? null);
                  return (
                    <Pressable
                      onPress={() => pickCandidate(i)}
                      disabled={e.match.kind !== 'ambiguous'}
                      className="flex-row items-start border-b border-gray-100 py-2 dark:border-gray-800"
                    >
                      <View className="mt-0.5 w-6">
                        <Ionicons
                          name={
                            kind === 'matched'
                              ? 'checkmark-circle'
                              : kind === 'ambiguous'
                                ? 'help-circle'
                                : e.gbifKey != null
                                  ? 'globe'
                                  : 'globe-outline'
                          }
                          size={16}
                          color={
                            kind === 'matched'
                              ? '#10b981'
                              : kind === 'ambiguous'
                                ? '#f59e0b'
                                : colors.icon
                          }
                        />
                      </View>
                      <View className="flex-1">
                        <ScientificName
                          name={e.src.name}
                          author={e.src.author}
                          kingdom={e.src.kingdom}
                          rank={e.src.rank}
                          className="text-sm text-gray-900 dark:text-gray-100"
                        />
                        <Text className="text-xs text-gray-500 dark:text-gray-400">
                          {local?.common_name_c || e.src.commonName || e.src.family || e.src.kingdom}
                          {' · '}
                          {t('areaSpecies.obs', { count: e.src.count })}
                        </Text>
                        {e.match.kind === 'ambiguous' && !e.resolved ? (
                          <Text className="text-xs text-amber-600 dark:text-amber-400">
                            {t('areaSpecies.tapToPick', { count: e.match.candidates.length })}
                          </Text>
                        ) : null}
                        {e.match.kind === 'matched' && e.match.via ? (
                          <Text className="text-xs text-orange-600 dark:text-orange-400">
                            {t('areaSpecies.viaSynonym', { name: e.match.via.name })}
                          </Text>
                        ) : null}
                        {e.match.kind === 'matched' && e.refined ? (
                          <Text className="text-xs text-orange-600 dark:text-orange-400">
                            {t('areaSpecies.viaGbif', { name: e.refined.name })}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                }}
              />

              <View className="border-t border-gray-200 px-4 pt-3 dark:border-gray-700">
                {summary.unmatched > 0 ? (
                  <>
                    <Pressable
                      onPress={runRefine}
                      disabled={busy}
                      className={`mb-2 flex-row items-center justify-center rounded-lg border py-2 ${
                        busy
                          ? 'border-gray-300 dark:border-gray-700'
                          : 'border-blue-500 active:bg-blue-50 dark:active:bg-blue-900/30'
                      }`}
                    >
                      {busy ? <ActivityIndicator size="small" /> : null}
                      <Text
                        className={`ml-2 text-sm font-medium ${
                          busy ? 'text-gray-400' : 'text-blue-600 dark:text-blue-300'
                        }`}
                      >
                        {busy
                          ? t('areaSpecies.refining', {
                              done: refining?.done ?? 0,
                              of: refining?.of ?? 0,
                            })
                          : t('areaSpecies.refine', { count: summary.unmatched })}
                      </Text>
                    </Pressable>
                    <Text className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                      {refineNote ?? t('areaSpecies.refineHint')}
                    </Text>

                    <View className="mb-3 flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-sm text-gray-900 dark:text-gray-100">
                          {t('areaSpecies.includeUnmatched', { count: mintable })}
                        </Text>
                        <Text className="text-xs text-gray-500 dark:text-gray-400">
                          {mintable === 0
                            ? t('areaSpecies.needRefine')
                            : t('areaSpecies.includeUnmatchedHint')}
                        </Text>
                      </View>
                      <Switch
                        value={includeUnmatched}
                        onValueChange={setIncludeUnmatched}
                        disabled={mintable === 0}
                      />
                    </View>
                  </>
                ) : null}

                <Pressable
                  onPress={pickTarget}
                  className="mb-2 flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600"
                >
                  <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">
                    {target.kind === 'new' ? t('areaSpecies.targetNew') : target.name}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.icon} />
                </Pressable>
                {target.kind === 'new' ? (
                  <TextInput
                    value={folderName}
                    onChangeText={setFolderName}
                    placeholder={t('areaSpecies.folderPlaceholder')}
                    placeholderTextColor={colors.placeholder}
                    className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 dark:border-gray-600 dark:text-gray-100"
                  />
                ) : null}
                <Pressable
                  onPress={commit}
                  disabled={!ready}
                  className={`items-center rounded-xl py-3 ${
                    ready ? 'bg-blue-500 active:bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
                  }`}
                >
                  <Text className="text-base font-semibold text-white">
                    {target.kind === 'new'
                      ? t('areaSpecies.createFolder', { count: importable })
                      : t('areaSpecies.addToFolder', { count: importable, name: target.name })}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
