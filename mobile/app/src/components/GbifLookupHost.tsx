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
  generateUuid,
  searchByTaxonId,
  updateExternalTaxon,
  upsertExternalTaxon,
  type ExternalTaxon,
  type SearchResult,
} from '~/db';
import {
  fetchTaxonDetail,
  matchName,
  searchNames,
  splitScientificName,
  type GbifNameCandidate,
  type GbifTaxonDetail,
} from '~/lib/gbif';
import { apiErrorMessage } from '~/lib/apiErrorMessage';
import { matchScientificName } from '~/lib/sciMatch';
import { ACTION_FILL } from '~/lib/colors';

/** What the caller gets back: a taxon that is now usable, plus whether it
 *  turned out to be a LOCAL one GBIF led us to (no external taxon minted). */
export type GbifLookupOutcome = { result: SearchResult; viaLocal: boolean };

type LookupRequest = {
  query: string;
  /** 'lookup' = the classic GBIF name search; 'manual' = straight to the
   *  user-created-taxon form (also reachable from lookup's empty state). */
  mode: 'lookup' | 'manual';
  /** Set when editing an existing manual taxon — save then UPDATEs by id
   *  instead of minting. */
  edit?: ExternalTaxon;
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
    useLookupStore.getState().open({ query: q, mode: 'lookup', resolve });
  });
}

/** Straight to the manual "create your own taxon" form (GBIF had nothing, or
 *  the user knows the name is unpublished/local). */
export function manualTaxonEntry(q: string): Promise<GbifLookupOutcome | null> {
  return new Promise((resolve) => {
    useLookupStore.getState().open({ query: q, mode: 'manual', resolve });
  });
}

/** Re-open the manual form pre-filled from an existing manual taxon; saving
 *  updates the same taxon_id (records keep pointing at it). */
export function editManualTaxon(taxon: ExternalTaxon): Promise<GbifLookupOutcome | null> {
  return new Promise((resolve) => {
    useLookupStore
      .getState()
      .open({ query: taxon.simple_name, mode: 'manual', edit: taxon, resolve });
  });
}

type Step = 'searching' | 'list' | 'confirm' | 'local' | 'manual';

export const MANUAL_KINGDOMS = [
  'Plantae',
  'Animalia',
  'Fungi',
  'Chromista',
  'Protozoa',
  'Bacteria',
  'Archaea',
  'Viruses',
] as const;

const MANUAL_RANKS = ['species', 'genus', 'subspecies', 'variety', 'form'] as const;

type ManualForm = {
  sci: string;
  cname: string;
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  rank: string;
};

/** Rank guessed from the epithet count; the chips let the user override. */
function deriveRank(sci: string): string {
  const toks = sci.trim().split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return 'genus';
  if (toks.length === 2) return 'species';
  const j = sci.toLowerCase();
  if (j.includes(' var.')) return 'variety';
  if (j.includes(' f.')) return 'form';
  return 'subspecies';
}

function emptyManualForm(q: string, edit?: ExternalTaxon): ManualForm {
  if (edit) {
    return {
      sci: edit.name_author ? `${edit.simple_name} ${edit.name_author}` : edit.simple_name,
      cname: edit.common_name_c ?? '',
      kingdom: edit.kingdom ?? '',
      phylum: edit.phylum ?? '',
      class: edit.class ?? '',
      order: edit.order ?? '',
      family: edit.family ?? '',
      genus: edit.genus ?? '',
      rank: edit.rank || deriveRank(edit.simple_name),
    };
  }
  const sci = q.trim();
  const first = sci.split(/\s+/)[0] ?? '';
  const genus = /^[A-Z][a-z-]+$/.test(first) ? first : '';
  return {
    sci,
    cname: '',
    kingdom: '',
    phylum: '',
    class: '',
    order: '',
    family: '',
    genus,
    rank: deriveRank(sci),
  };
}

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
  const [manual, setManual] = useState<ManualForm>(emptyManualForm(''));
  const [autoFilling, setAutoFilling] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query === null || pending == null) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setCandidates([]);
    setPicked(null);
    setLocalHit(null);
    setManualError(null);
    setAutoFilling(false);
    if (pending.mode === 'manual') {
      setManual(emptyManualForm(pending.query, pending.edit));
      setStep('manual');
      return () => ctrl.abort();
    }
    setStep('searching');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  /** GBIF 補高階層: match the genus (or the name itself) against the backbone
   *  and fill the hierarchy fields. Explicit user action, so returned values
   *  overwrite; offline / no-match degrades to a message, never a block. */
  const handleAutoFill = async () => {
    const probe = manual.genus.trim() || manual.sci.trim().split(/\s+/)[0] || '';
    if (!probe) return;
    setAutoFilling(true);
    setManualError(null);
    try {
      const m = await matchName(probe);
      if (!m) {
        setManualError(t('manualTaxon.autoFillNoMatch', { q: probe }));
      } else {
        setManual((prev) => ({
          ...prev,
          kingdom: m.kingdom || prev.kingdom,
          phylum: m.phylum || prev.phylum,
          class: m.class || prev.class,
          order: m.order || prev.order,
          family: m.family || prev.family,
          genus: m.genus || prev.genus,
        }));
      }
    } catch (e) {
      setManualError(await apiErrorMessage(e));
    } finally {
      setAutoFilling(false);
    }
  };

  const handleManualSave = () => {
    const { name, author } = splitScientificName(manual.sci.trim());
    if (!name || !manual.kingdom) return;
    const fields = {
      simple_name: name,
      name_author: author,
      rank: manual.rank,
      kingdom: manual.kingdom,
      phylum: manual.phylum.trim(),
      class: manual.class.trim(),
      order: manual.order.trim(),
      family: manual.family.trim(),
      genus: manual.genus.trim(),
      common_name_c: manual.cname.trim(),
    };
    let taxonId: string;
    if (pending?.edit) {
      taxonId = pending.edit.taxon_id;
      updateExternalTaxon(taxonId, fields);
    } else {
      taxonId = upsertExternalTaxon({
        source: 'manual',
        source_key: generateUuid().replace(/-/g, '').slice(0, 12),
        ...fields,
      });
    }
    const created = searchByTaxonId(taxonId);
    if (created) onResolved(created, false);
    else onClose();
  };

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
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
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
          ) : step === 'manual' ? (
            <Pressable
              onPress={handleManualSave}
              hitSlop={8}
              disabled={!splitScientificName(manual.sci.trim()).name || !manual.kingdom}
            >
              <Text
                className={`text-base font-semibold ${
                  !splitScientificName(manual.sci.trim()).name || !manual.kingdom
                    ? 'text-gray-300 dark:text-gray-600'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {pending?.edit ? t('common.save') : t('gbifLookup.add')}
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
              <View className="border-b border-red-100 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/40">
                <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
              </View>
            ) : null}
            {!error && candidates.length === 0 ? (
              <View className="flex-1 items-center justify-center px-8">
                <Ionicons name="earth-outline" size={40} color="#cbd5e1" />
                <Text className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('gbifLookup.noResults', { q: query ?? '' })}
                </Text>
                <Pressable
                  onPress={() => {
                    setManual(emptyManualForm(query ?? ''));
                    setManualError(null);
                    setStep('manual');
                  }}
                  className={`mt-4 rounded-full px-4 py-2 ${ACTION_FILL}`}
                >
                  <Text className="text-sm font-medium text-white">
                    {t('manualTaxon.createOwn')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <FlatList
              data={candidates}
              keyExtractor={(c) => String(c.usageKey)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handlePick(item)}
                  className="border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-800 dark:active:bg-gray-800"
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
            <Text className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
              {t('areaSpecies.attributionGbif')}
            </Text>
          </View>
        ) : null}

        {step === 'local' && localHit ? (
          <View className="flex-1 px-6 pt-10">
            <Text className="text-sm text-gray-700 dark:text-gray-300">
              {t('gbifLookup.localHitTitle')}
            </Text>
            <View className="mt-3 rounded-lg border border-gray-200 px-3 py-3 dark:border-gray-700">
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
              className="mt-2 rounded-lg border border-gray-300 px-4 py-3 active:bg-gray-50 dark:border-gray-700 dark:active:bg-gray-800"
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
                  className="mt-1 rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
                <Text className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {picked.vernacularName
                    ? t('gbifLookup.cnameFromGbif')
                    : t('gbifLookup.cnameMissing')}
                </Text>
              </View>
              <View className="mx-4 mt-6 rounded-lg bg-amber-50 px-3 py-2.5 dark:bg-amber-950/40">
                <Text className="text-xs text-amber-800 dark:text-amber-300">
                  {t('gbifLookup.externalNote')}
                </Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}

        {step === 'manual' ? (
          <KeyboardAvoidingView className="flex-1">
            <ScrollView className="flex-1 px-4 py-4" keyboardShouldPersistTaps="handled">
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {t('manualTaxon.intro')}
              </Text>

              <Text className="mt-4 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('manualTaxon.sciName')} *
              </Text>
              <TextInput
                value={manual.sci}
                onChangeText={(v) =>
                  setManual((prev) => ({ ...prev, sci: v, rank: deriveRank(v) }))
                }
                placeholder="Laurus nobilis L."
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                className="mt-1 rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 dark:border-gray-600 dark:text-gray-100"
              />

              <Text className="mt-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('manualTaxon.cname')}
              </Text>
              <TextInput
                value={manual.cname}
                onChangeText={(v) => setManual((prev) => ({ ...prev, cname: v }))}
                placeholder={t('manualTaxon.cnamePlaceholder')}
                placeholderTextColor="#9ca3af"
                className="mt-1 rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 dark:border-gray-600 dark:text-gray-100"
              />

              <Text className="mt-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('manualTaxon.kingdom')} *
              </Text>
              <View className="mt-1 flex-row flex-wrap gap-2">
                {MANUAL_KINGDOMS.map((k) => {
                  const on = manual.kingdom === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => setManual((prev) => ({ ...prev, kingdom: k }))}
                      className={`rounded-full border px-3 py-1.5 ${
                        on
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
                      }`}
                    >
                      <Text
                        className={`text-xs ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {t(`manualTaxon.kingdoms.${k}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View className="mt-3 flex-row items-end gap-2">
                <View className="flex-1">
                  <Text className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                    {t('manualTaxon.genus')}
                  </Text>
                  <TextInput
                    value={manual.genus}
                    onChangeText={(v) => setManual((prev) => ({ ...prev, genus: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="mt-1 rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 dark:border-gray-600 dark:text-gray-100"
                  />
                </View>
                <Pressable
                  onPress={() => void handleAutoFill()}
                  disabled={autoFilling}
                  className="rounded-lg bg-emerald-600 px-3 py-3 active:bg-emerald-700"
                >
                  {autoFilling ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-sm font-medium text-white">
                      {t('manualTaxon.autoFill')}
                    </Text>
                  )}
                </Pressable>
              </View>
              <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('manualTaxon.autoFillHint')}
              </Text>
              {manualError ? (
                <Text className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {manualError}
                </Text>
              ) : null}

              {(
                [
                  ['family', t('manualTaxon.family')],
                  ['order', t('manualTaxon.order')],
                  ['class', t('manualTaxon.class')],
                  ['phylum', t('manualTaxon.phylum')],
                ] as const
              ).map(([field, label]) => (
                <View key={field}>
                  <Text className="mt-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                    {label}
                  </Text>
                  <TextInput
                    value={manual[field]}
                    onChangeText={(v) => setManual((prev) => ({ ...prev, [field]: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="mt-1 rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 dark:border-gray-600 dark:text-gray-100"
                  />
                </View>
              ))}

              <Text className="mt-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                {t('manualTaxon.rank')}
              </Text>
              <View className="mt-1 flex-row flex-wrap gap-2">
                {MANUAL_RANKS.map((r) => {
                  const on = manual.rank === r;
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setManual((prev) => ({ ...prev, rank: r }))}
                      className={`rounded-full border px-3 py-1.5 ${
                        on
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
                      }`}
                    >
                      <Text
                        className={`text-xs ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {t(`rank.${r}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text className="mb-8 mt-4 text-xs text-amber-700 dark:text-amber-400">
                {t('manualTaxon.note')}
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}
      </View>
    </Modal>
  );
}
