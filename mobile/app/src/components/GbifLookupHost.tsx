/**
 * 到 GBIF 查名 — the way out when neither bundled checklist has the species.
 *
 * Three things happen here, in this order, and the order is the point:
 *   1. ask GBIF what names match what the user typed;
 *   2. check the picked name against the LOCAL checklists again, because GBIF
 *      resolves synonyms far better than our fuzzy match and the species may
 *      well be in TaiCOL under its accepted name — a Taiwanese species must
 *      keep its local id, or the same organism ends up with two identities
 *      and records, exports and statistics split;
 *   3. only then mint a 'g…' external taxon.
 *
 * Imperative API + module-level store + a host mounted at the navigation root,
 * exactly like `TextPromptModal` / `ActionSheet` — and for the same reason:
 * one caller (the batch importer's 找不到 list) is itself inside a Modal, and
 * iOS will not present a Modal on top of a Modal. Hoisting the host out of
 * every screen is what makes it work from anywhere.
 *
 *   const picked = await lookupGbifName('Ficus benjamina');
 *   if (picked) addToRecord(picked.result);
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { ScientificName } from './ScientificName';
import { SynonymStatusBadge } from './CollapsibleSection';
import {
  searchByTaxonId,
  upsertExternalTaxon,
  type SearchResult,
} from '~/db';
import {
  fetchTaxonDetail,
  searchNames,
  splitScientificName,
  type GbifNameCandidate,
  type GbifTaxonDetail,
} from '~/lib/gbif';
import { apiErrorMessage } from '~/lib/apiErrorMessage';
import { matchScientificName } from '~/lib/sciMatch';

/** What the caller gets back: a taxon that is now usable, plus whether it
 *  turned out to be a LOCAL one GBIF led us to (no external taxon minted). */
export type GbifLookupOutcome = { result: SearchResult; viaLocal: boolean };

type LookupRequest = {
  query: string;
  resolve: (outcome: GbifLookupOutcome | null) => void;
};

type LookupStore = {
  pending: LookupRequest | null;
  open: (req: LookupRequest) => void;
  resolve: (outcome: GbifLookupOutcome | null) => void;
};

const useLookupStore = create<LookupStore>((set, get) => ({
  pending: null,
  open: (req) => set({ pending: req }),
  resolve: (outcome) => {
    const p = get().pending;
    if (p) p.resolve(outcome);
    set({ pending: null });
  },
}));

/** Imperative API: opens the lookup for `q` and resolves with the taxon the
 *  user settled on, or `null` if they backed out. */
export function lookupGbifName(q: string): Promise<GbifLookupOutcome | null> {
  return new Promise((resolve) => {
    useLookupStore.getState().open({ query: q, resolve });
  });
}

type Step = 'searching' | 'list' | 'confirm' | 'local';

/** A GBIF pick that the local checklist already covers — shown for
 *  confirmation rather than applied silently. */
type LocalHit = {
  result: SearchResult;
  via: { name: string; status: string } | null;
  picked: GbifNameCandidate;
};

export function GbifLookupHost() {
  const pending = useLookupStore((s) => s.pending);
  const resolveLookup = useLookupStore((s) => s.resolve);
  const query = pending?.query ?? null;
  const onClose = () => resolveLookup(null);
  const onResolved = (result: SearchResult, viaLocal: boolean) =>
    resolveLookup({ result, viaLocal });

  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('searching');
  const [candidates, setCandidates] = useState<GbifNameCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<GbifNameCandidate | null>(null);
  const [localHit, setLocalHit] = useState<LocalHit | null>(null);
  const [cname, setCname] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query === null) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStep('searching');
    setError(null);
    setCandidates([]);
    setPicked(null);
    setLocalHit(null);
    (async () => {
      try {
        const rows = await searchNames(query, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setCandidates(rows);
        setStep('list');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(await apiErrorMessage(e));
        setStep('list');
      }
    })();
    return () => ctrl.abort();
  }, [query]);

  const handlePick = (c: GbifNameCandidate) => {
    // A synonym's accepted name is the one to test locally — that is the whole
    // reason to consult GBIF before minting anything.
    // `accepted` carries the author; sciMatch compares against TaiCOL's
    // author-free simple_name, so use the repo's verified splitter rather than
    // guessing at word counts (infraspecific names are three tokens).
    const nameToMatch =
      c.status?.toUpperCase() === 'SYNONYM' && c.acceptedName
        ? splitScientificName(c.acceptedName).name
        : c.canonicalName;
    const local = matchScientificName({
      name: nameToMatch,
      kingdom: c.kingdom || undefined,
      family: c.family || undefined,
      author: c.author || undefined,
    });
    if (local.kind === 'matched') {
      const hit = searchByTaxonId(local.taxon_id);
      if (hit) {
        // The checklist knows this name — but possibly under a different name
        // than the one just picked, and `via` says what it calls it. Carrying
        // that through means the toast can name the substitution instead of
        // performing it silently.
        setLocalHit({ result: hit, via: local.via ?? null, picked: c });
        setStep('local');
        return;
      }
    }
    setPicked(c);
    setCname(c.vernacularName);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!picked) return;
    // The full parent chain is enrichment: fetch it, but never let it block or
    // fail the adoption — the user may be standing in a forest.
    let detail: GbifTaxonDetail | null = null;
    try {
      detail = await fetchTaxonDetail(picked.usageKey);
    } catch {
      detail = null;
    }
    const taxonId = upsertExternalTaxon({
      source: 'gbif',
      source_key: String(picked.usageKey),
      simple_name: picked.canonicalName,
      name_author: picked.author,
      rank: picked.rank.toLowerCase(),
      kingdom: picked.kingdom,
      phylum: picked.phylum,
      class: picked.class,
      order: picked.order,
      family: picked.family,
      genus: picked.genus,
      common_name_c: cname.trim(),
      taxonomic_status: detail?.taxonomicStatus || picked.status || null,
      accepted_name: detail?.acceptedName || picked.acceptedName || null,
      higher_classification: detail?.higherClassification || null,
      // Set only when the user chose this OVER a local name the checklist
      // offered — that is what makes it an adoption rather than a cache fill.
      local_taxon_id: localHit?.result.taxon_id ?? null,
      local_status: localHit?.via?.status ?? null,
      adopted: localHit ? 1 : 0,
    });
    const created = searchByTaxonId(taxonId);
    if (created) onResolved(created, false);
    onClose();
  };

  return (
    <Modal visible={query !== null} animationType="slide" onRequestClose={onClose}>
      <View
        className="flex-1 bg-white dark:bg-gray-900"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <Pressable onPress={onClose} hitSlop={8}>
            <Text className="text-base text-gray-700 dark:text-gray-300">{t('common.cancel')}</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('gbifLookup.title')}
          </Text>
          {step === 'confirm' ? (
            <Pressable onPress={handleConfirm} hitSlop={8}>
              <Text className="text-base font-semibold text-blue-600 dark:text-blue-400">
                {t('gbifLookup.add')}
              </Text>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {step === 'searching' ? (
          <View className="flex-1 items-center justify-center px-8">
            <ActivityIndicator />
            <Text className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              {t('gbifLookup.searching', { q: query ?? '' })}
            </Text>
          </View>
        ) : null}

        {step === 'list' ? (
          <View className="flex-1">
            {error ? (
              <View className="border-b border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-950/40 px-4 py-3">
                <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
              </View>
            ) : null}
            {!error && candidates.length === 0 ? (
              <View className="flex-1 items-center justify-center px-8">
                <Ionicons name="earth-outline" size={40} color="#cbd5e1" />
                <Text className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('gbifLookup.noResults', { q: query ?? '' })}
                </Text>
              </View>
            ) : null}
            <FlatList
              data={candidates}
              keyExtractor={(c) => String(c.usageKey)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handlePick(item)}
                  className="border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
                >
                  <View className="flex-row items-center">
                    <ScientificName
                      name={item.canonicalName}
                      author={item.author}
                      kingdom={item.kingdom}
                      rank={item.rank.toLowerCase()}
                      className="flex-1 text-sm text-gray-900 dark:text-gray-100"
                    />
                    <Text className="ml-2 text-[11px] uppercase text-gray-400 dark:text-gray-500">
                      {item.rank.toLowerCase()}
                    </Text>
                  </View>
                  {item.vernacularName ? (
                    <Text className="mt-0.5 text-xs text-gray-700 dark:text-gray-300">
                      {item.vernacularName}
                    </Text>
                  ) : null}
                  <Text className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {[item.kingdom, item.phylum, item.class, item.order, item.family]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {item.status?.toUpperCase() === 'SYNONYM' && item.acceptedName ? (
                    <Text className="mt-0.5 text-[11px] text-orange-600 dark:text-orange-400">
                      {t('gbifLookup.synonymOf', { name: item.acceptedName })}
                    </Text>
                  ) : null}
                </Pressable>
              )}
            />
            <Text className="border-t border-gray-100 dark:border-gray-800 px-4 py-2 text-[11px] text-gray-500 dark:text-gray-400">
              {t('areaSpecies.attributionGbif')}
            </Text>
          </View>
        ) : null}

        {step === 'local' && localHit ? (
          <View className="flex-1 px-6 pt-10">
            <Text className="text-sm text-gray-700 dark:text-gray-300">
              {t('gbifLookup.localHitTitle')}
            </Text>
            <View className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3">
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {t('gbifLookup.youPicked')}
              </Text>
              <ScientificName
                name={localHit.picked.canonicalName}
                author={localHit.picked.author}
                kingdom={localHit.picked.kingdom}
                className="mt-0.5 text-sm text-gray-900 dark:text-gray-100"
              />
              <Text className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {t('gbifLookup.localHas')}
              </Text>
              <View className="mt-0.5 flex-row items-center">
                <ScientificName
                  name={localHit.result.name}
                  author={localHit.result.fullname.replace(localHit.result.name, '').trim()}
                  kingdom={localHit.result.kingdom}
                  className="text-sm text-gray-900 dark:text-gray-100"
                />
                {localHit.via ? <SynonymStatusBadge status={localHit.via.status} /> : null}
              </View>
            </View>

            <Pressable
              onPress={() => {
                onResolved(localHit.result, true);
                onClose();
              }}
              className="mt-6 rounded-lg bg-blue-600 px-4 py-3 active:bg-blue-700"
            >
              <Text className="text-center text-sm font-semibold text-white">
                {t('gbifLookup.useLocal')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPicked(localHit.picked);
                setCname(localHit.picked.vernacularName);
                setStep('confirm');
              }}
              className="mt-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
            >
              <Text className="text-center text-sm font-medium text-gray-800 dark:text-gray-200">
                {t('gbifLookup.useMineAnyway')}
              </Text>
            </Pressable>
            <Text className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {t('gbifLookup.useMineAnywayHint')}
            </Text>
          </View>
        ) : null}

        {step === 'confirm' && picked ? (
          <KeyboardAvoidingView className="flex-1" behavior="padding">
            <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
              <View className="px-4 pt-4">
                <Text className="text-xs text-gray-500 dark:text-gray-400">
                  {t('gbifLookup.willAdd')}
                </Text>
                <ScientificName
                  name={picked.canonicalName}
                  author={picked.author}
                  kingdom={picked.kingdom}
                  rank={picked.rank.toLowerCase()}
                  className="mt-1 text-base text-gray-900 dark:text-gray-100"
                />
                <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {[picked.kingdom, picked.phylum, picked.class, picked.order, picked.family]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View className="px-4 pt-5">
                <Text className="text-xs text-gray-500 dark:text-gray-400">
                  {t('gbifLookup.cname')}
                </Text>
                <TextInput
                  value={cname}
                  onChangeText={setCname}
                  placeholder={t('gbifLookup.cnamePlaceholder')}
                  placeholderTextColor="#9ca3af"
                  className="mt-1 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100"
                />
                <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {picked.vernacularName
                    ? t('gbifLookup.cnameFromGbif')
                    : t('gbifLookup.cnameMissing')}
                </Text>
              </View>
              <View className="mx-4 mt-6 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
                <Text className="text-xs text-amber-800 dark:text-amber-300">
                  {t('gbifLookup.externalNote')}
                </Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}
      </View>
    </Modal>
  );
}
