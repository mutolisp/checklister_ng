/**
 * Dichotomous key runner — full-screen step-by-step flow.
 *
 * State machine:
 *
 *   idle / not started          → show couplet 1
 *   at couplet N                → render lead A + lead B as big buttons
 *   user picks lead             → push couplet onto path
 *                                  → if target is "couplet K", advance to K
 *                                  → if target is "taxon T", show terminal card
 *                                  → if target unresolved (e.g. `:` or `;`
 *                                    misread by PDF parser), show warning row
 *   user taps 上一步             → pop path; current couplet = path tail (or start)
 *   user taps "重來"             → clear path, back to first couplet
 *
 * All DB lookups (key, couplets, taxa) happen once in `useEffect` and feed
 * `useState`. Render-phase DB calls were previously seen to trigger
 * `flushPassiveEffects` SIGABRT under iOS 26 + new arch — never query the DB
 * inside a component body or inside JSX.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { BackHeaderLeft } from '~/lib/goBack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addPlotSpecies,
  addRecord,
  findSubkeysByScopeName,
  findSubkeysForTaxon,
  getIdentificationKey,
  getKeyTaxonInfo,
  indexCoupletsByNumber,
  isTaxonInSession,
  listKeyCouplets,
  searchByTaxonId,
  type IdentificationKey,
  type KeyCouplet,
  type KeyTaxonInfo,
  type Layer,
  type SearchResult,
} from '~/db';
import { ConservationBadge } from '~/components/ConservationBadge';
import { KeyMatrixRunner } from '~/components/KeyMatrixRunner';
import { LookupResultSheet } from '~/components/LookupResultSheet';
import { PlotSpeciesValueModal, type PlotValueDraft } from '~/components/PlotSpeciesValueModal';
import { ScientificName } from '~/components/ScientificName';
import { serializeMultiAttribute } from '~/lib/dwcAttributes';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { getKeyRunnerState, pushRecentKey, setKeyRunnerState, useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';

type LeadKey = 'a' | 'b';

type RunnerState = {
  /** Stack of visited couplet numbers (oldest first). The last element is
   *  the current couplet, unless we've reached a terminal. */
  path: number[];
  terminal:
    | null
    | { kind: 'taxon'; taxonId: string; marker: string | null; status: string | null }
    | { kind: 'unresolved'; rawId: string | null };
};

type LeadPreview =
  | { kind: 'couplet'; coupletNumber: string }
  | { kind: 'taxon'; taxon: KeyTaxonInfo }
  | { kind: 'unresolved'; rawText: string };

/** Short label for the subkey scope rank, used in the action-button hint
 *  e.g. "續查屬內檢索表". Falls back to the raw rank for unmapped values. */
const SUBKEY_RANK_LABEL: Record<string, string> = {
  family: '科',
  subfamily: '亞科',
  tribe: '族',
  genus: '屬',
  subgenus: '亞屬',
};
function subkeyRankLabel(rank: string): string {
  return SUBKEY_RANK_LABEL[rank] ?? rank;
}

/** Short chip label for a key's mode — used to disambiguate when the same
 *  scope has multiple subkeys (dichotomous + multi_access). */
const SUBKEY_MODE_LABEL: Record<string, string> = {
  dichotomous: '對偶',
  multi_access: '多重檢索條件',
  both: '對偶 + 多重檢索條件',
};
function subkeyModeLabel(mode: string): string {
  return SUBKEY_MODE_LABEL[mode] ?? mode;
}

type TraceStep = {
  coupletNumber: number;
  lead: 'A' | 'B';
  /** The lead's free-text description, so the candidates sheet can show
   *  "5A 第一側脈 13-22 對 → 6B …" not just the bare "5A → 6B". */
  text: string;
};

type ReachableTerminal = {
  taxonId: string;
  marker: string | null;
  status: string | null;
  taxon: KeyTaxonInfo | null;
  /** Sequence of trace steps from the *starting* couplet down to this
   *  terminal. Used by `CandidatesSheet` to render full lead descriptions
   *  and to expand `state.path` when the user jumps. */
  trace: TraceStep[];
};

/**
 * DFS-enumerate every terminal taxon reachable from `startCouplet`. Used by
 * the "看候選" peek feature so a user who can't observe the current trait
 * can scan all downstream candidates and pick directly.
 *
 * Per-call `visited` prevents infinite loops if the key (rare) has cycles.
 * Real Sheets-authored keys are pure trees, so this is just a safety net.
 */
function enumerateReachableTerminals(
  startCouplet: number,
  byNumber: Map<number, KeyCouplet>,
  taxonCache: Map<string, KeyTaxonInfo | null>,
): ReachableTerminal[] {
  const out: ReachableTerminal[] = [];

  function dfs(
    cNum: number,
    trace: TraceStep[],
    visited: Set<number>,
  ) {
    if (visited.has(cNum)) return;
    const c = byNumber.get(cNum);
    if (!c) return;
    const nextVisited = new Set(visited);
    nextVisited.add(cNum);

    for (const lead of ['a', 'b'] as const) {
      const targetType = lead === 'a' ? c.lead_a_target_type : c.lead_b_target_type;
      const targetId = lead === 'a' ? c.lead_a_target_id : c.lead_b_target_id;
      const marker = lead === 'a' ? c.lead_a_taxon_marker : c.lead_b_taxon_marker;
      const status = lead === 'a' ? c.lead_a_taxon_status : c.lead_b_taxon_status;
      const text = lead === 'a' ? c.lead_a_text : c.lead_b_text;
      const newTrace: TraceStep[] = [
        ...trace,
        { coupletNumber: cNum, lead: lead === 'a' ? 'A' : 'B', text },
      ];

      if (targetType === 'taxon' && targetId) {
        out.push({
          taxonId: targetId,
          marker,
          status,
          taxon: taxonCache.get(targetId) ?? null,
          trace: newTrace,
        });
      } else if (targetType === 'couplet' && targetId) {
        const nextNum = Number(targetId);
        if (Number.isFinite(nextNum)) dfs(nextNum, newTrace, nextVisited);
      }
      // 'subkey' / 'unresolved' aren't picked here — they require user
      // interaction at the respective step.
    }
  }

  dfs(startCouplet, [], new Set());
  return out;
}

function leadFields(c: KeyCouplet, lead: LeadKey) {
  if (lead === 'a') {
    return {
      text: c.lead_a_text,
      type: c.lead_a_target_type,
      id: c.lead_a_target_id,
      marker: c.lead_a_taxon_marker,
      status: c.lead_a_taxon_status,
    };
  }
  return {
    text: c.lead_b_text,
    type: c.lead_b_target_type,
    id: c.lead_b_target_id,
    marker: c.lead_b_taxon_marker,
    status: c.lead_b_taxon_status,
  };
}

function buildLeadPreview(
  c: KeyCouplet,
  lead: LeadKey,
  taxonCache: Map<string, KeyTaxonInfo | null>,
): LeadPreview {
  const f = leadFields(c, lead);
  if (f.type === 'couplet' && f.id != null) {
    return { kind: 'couplet', coupletNumber: f.id };
  }
  if (f.type === 'taxon' && f.id) {
    const t = taxonCache.get(f.id) ?? null;
    if (t) return { kind: 'taxon', taxon: t };
    return { kind: 'unresolved', rawText: f.id };
  }
  if (f.type === 'subkey') {
    return { kind: 'unresolved', rawText: `subkey ${f.id ?? ''}` };
  }
  return { kind: 'unresolved', rawText: '(未解析)' };
}

export default function KeyRunnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const keyId = Number(id);

  // ── Load key + couplets + caches once, in effect ─────────────────────
  const [keyData, setKeyData] = useState<IdentificationKey | null>(null);
  const [couplets, setCouplets] = useState<KeyCouplet[]>([]);
  const [taxonCache, setTaxonCache] = useState<Map<string, KeyTaxonInfo | null>>(new Map());
  // subkey-chain cache: terminal taxon_id → IdentificationKey[]. Empty array
  // means no available subkey. Multiple entries means the same scope has
  // both dichotomous and multi_access keys — the runner renders one button
  // per mode. Pre-fetched alongside `taxonCache` so render never hits DB.
  const [subkeyCache, setSubkeyCache] = useState<Map<string, IdentificationKey[]>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(keyId)) return;
    pushRecentKey(keyId);
    const k = getIdentificationKey(keyId);
    setKeyData(k);
    const cs = listKeyCouplets(keyId);
    setCouplets(cs);

    // Pre-fetch every taxon referenced by any lead, so render never queries DB.
    const ids = new Set<string>();
    for (const c of cs) {
      if (c.lead_a_target_type === 'taxon' && c.lead_a_target_id) ids.add(c.lead_a_target_id);
      if (c.lead_b_target_type === 'taxon' && c.lead_b_target_id) ids.add(c.lead_b_target_id);
    }
    const tCache = new Map<string, KeyTaxonInfo | null>();
    const sCache = new Map<string, IdentificationKey[]>();
    for (const tid of ids) {
      const info = getKeyTaxonInfo(tid);
      tCache.set(tid, info);
      // Drop the self-link: a Quercus genus key whose terminal points back
      // to Quercus would otherwise offer "open this very key again".
      let subs = findSubkeysForTaxon(tid);
      if (subs.length === 0 && !info) {
        // The "taxon_id" here is a raw sciname fallback (parser couldn't
        // resolve to TaiCOL), e.g. "Bambusoideae" stored verbatim. Try
        // looking it up directly as a scope_name token so cross-key
        // pointers like Poaceae→Bambusoideae still navigate.
        subs = findSubkeysByScopeName(tid);
      }
      sCache.set(tid, subs.filter((s) => s.id !== keyId));
    }
    setTaxonCache(tCache);
    setSubkeyCache(sCache);
    setLoaded(true);
  }, [keyId]);

  // ── Derived state (no DB calls) ──────────────────────────────────────
  const coupletByNumber = useMemo(() => indexCoupletsByNumber(couplets), [couplets]);
  const firstCoupletNumber = couplets[0]?.number ?? null;

  const [state, setState] = useState<RunnerState>({ path: [], terminal: null });
  const [detailResult, setDetailResult] = useState<SearchResult | null>(null);
  // Smart-routing target for plot adds: when set, opens PlotSpeciesValueModal
  // so the user can enter abundance value before the row hits the DB.
  const [plotValueTarget, setPlotValueTarget] = useState<{
    taxon: KeyTaxonInfo;
    layer: Layer;
  } | null>(null);
  // 「看候選」sheet: when true, list every terminal reachable from the
  // current couplet so the user can skip an unanswerable trait.
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  // Long-pressed breadcrumb step → centre-screen popup with that couplet's
  // A/B lead text so the user can re-read the trait without losing their
  // current position.
  const [previewCouplet, setPreviewCouplet] = useState<KeyCouplet | null>(null);

  // Active-record awareness for "+ 加入當前記錄" smart routing (Step 5-3).
  const activeSession = useActiveSession((s) => s.session);
  const startActiveSession = useActiveSession((s) => s.start);
  const refreshActiveSession = useActiveSession((s) => s.refresh);
  const activePlot = useActivePlot((s) => s.plot);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
  const toast = useToast((s) => s.show);
  // Hydrate persisted runner state once couplets are loaded. If the saved
  // path references couplet numbers that no longer exist (e.g. after a key
  // re-import that renumbered couplets), fall back to a fresh start.
  // `hydratedRef` gates this so the next state-persist effect doesn't fire
  // before hydration and overwrite stored progress with the empty initial.
  const settingsLoaded = useSettings((s) => s.loaded);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!loaded || !settingsLoaded) return;
    if (firstCoupletNumber == null) return;
    hydratedRef.current = true;
    const persisted = getKeyRunnerState(keyId);
    if (persisted && persisted.path.length > 0) {
      const allKnown = persisted.path.every((n) => coupletByNumber.has(n));
      if (allKnown) {
        setState(persisted as RunnerState);
        return;
      }
    }
    setState({ path: [firstCoupletNumber], terminal: null });
  }, [loaded, settingsLoaded, firstCoupletNumber, coupletByNumber, keyId]);

  // Persist on every state change after hydration (sync SQLite write is fast
  // enough at this volume that no debounce is needed).
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (state.path.length === 0 && !state.terminal) return;
    setKeyRunnerState(keyId, state);
  }, [state, keyId]);

  // Pull latest active session / plot state when entering the runner. Either
  // can be created elsewhere (records tab, plot detail) while the user is
  // mid-key, and we want the "加入" button to reflect what's currently active.
  useEffect(() => {
    refreshActiveSession();
    refreshActivePlot();
  }, [refreshActiveSession, refreshActivePlot]);

  const currentCoupletNumber = state.path[state.path.length - 1] ?? null;
  const currentCouplet = useMemo(
    () => (currentCoupletNumber != null ? coupletByNumber.get(currentCoupletNumber) ?? null : null),
    [currentCoupletNumber, coupletByNumber],
  );

  const previews = useMemo(() => {
    if (!currentCouplet) return null;
    return {
      a: buildLeadPreview(currentCouplet, 'a', taxonCache),
      b: buildLeadPreview(currentCouplet, 'b', taxonCache),
    };
  }, [currentCouplet, taxonCache]);

  const reachable = useMemo(() => {
    if (!currentCoupletNumber) return [];
    return enumerateReachableTerminals(currentCoupletNumber, coupletByNumber, taxonCache);
  }, [currentCoupletNumber, coupletByNumber, taxonCache]);

  // ── Actions ──────────────────────────────────────────────────────────
  const pickLead = useCallback(
    (lead: LeadKey) => {
      if (!currentCouplet) return;
      const f = leadFields(currentCouplet, lead);
      if (f.type === 'couplet' && f.id != null) {
        const next = Number(f.id);
        if (!Number.isFinite(next) || !coupletByNumber.has(next)) {
          setState((prev) => ({ ...prev, terminal: { kind: 'unresolved', rawId: f.id } }));
          return;
        }
        setState((prev) => ({ path: [...prev.path, next], terminal: null }));
      } else if (f.type === 'taxon' && f.id) {
        setState((prev) => ({
          path: prev.path,
          terminal: { kind: 'taxon', taxonId: f.id!, marker: f.marker, status: f.status },
        }));
      } else if (f.type === 'subkey') {
        Alert.alert('Subkey 尚未支援', 'Step 5-2 將支援科 → 屬巢狀檢索表。');
      } else {
        setState((prev) => ({ ...prev, terminal: { kind: 'unresolved', rawId: f.id } }));
      }
    },
    [currentCouplet, coupletByNumber],
  );

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.terminal) return { ...prev, terminal: null };
      if (prev.path.length <= 1) return prev;
      return { ...prev, path: prev.path.slice(0, -1) };
    });
  }, []);

  const restart = useCallback(() => {
    setState({
      path: firstCoupletNumber != null ? [firstCoupletNumber] : [],
      terminal: null,
    });
  }, [firstCoupletNumber]);

  const jumpToPathIndex = useCallback((idx: number) => {
    setState((prev) => ({ path: prev.path.slice(0, idx + 1), terminal: null }));
  }, []);

  const jumpToReachable = useCallback(
    (cand: ReachableTerminal) => {
      // Path expansion: trace[0] is always the couplet we're at right now
      // (already in `state.path`), so skip it; trace[1..] are the couplets
      // the user is "auto-walking" past. The terminal taxon itself doesn't
      // get a path entry — it lives in `state.terminal`.
      setState((prev) => ({
        path: [...prev.path, ...cand.trace.slice(1).map((s) => s.coupletNumber)],
        terminal: {
          kind: 'taxon',
          taxonId: cand.taxonId,
          marker: cand.marker,
          status: cand.status,
        },
      }));
      setCandidatesOpen(false);
    },
    [],
  );

  // ── Smart routing (Step 5-3) ─────────────────────────────────────────
  // 偏好順序：active plot > active session > 自動建立新 session。
  // Plot 加入需要豐度值，會跳 PlotSpeciesValueModal；session 直接 addRecord。
  const addTaxonToActiveRecord = useCallback(
    (taxonId: string, taxon: KeyTaxonInfo | null) => {
      if (!taxon) {
        toast('找不到此 taxon');
        return;
      }
      if (activePlot) {
        // Non-stratified plots (transect / point count) store every row under
        // layer 'T'; fixed plots default to E2 (草本層) — most common entry
        // layer for vegetation surveys. User can change in the modal that follows.
        const layer: Layer = activePlot.plot_type === 'fixed' ? 'E2' : 'T';
        setPlotValueTarget({ taxon, layer });
        return;
      }
      // Session path: start a fresh session if none active (same pattern
      // as SpeciesSearchPanel).
      const target = activeSession ?? startActiveSession();
      if (!target) {
        toast('無法啟動名錄');
        return;
      }
      if (isTaxonInSession(target.id, taxonId)) {
        toast(`已存在於目前名錄：${taxon.common_name_c || taxon.simple_name}`);
        return;
      }
      addRecord({ session_id: target.id, taxon_id: taxonId });
      refreshActiveSession();
      toast(`已加入：${taxon.common_name_c || taxon.simple_name}`, {
        action: { label: '前往', onPress: () => router.push(`/session/${target.id}` as Href) },
      });
    },
    [activePlot, activeSession, startActiveSession, refreshActiveSession, router, toast],
  );

  const handlePlotValueSave = useCallback(
    (v: PlotValueDraft) => {
      if (!plotValueTarget || !activePlot) return;
      const t = plotValueTarget.taxon;
      addPlotSpecies({
        plot_survey_id: activePlot.id,
        taxon_id: t.taxon_id,
        layer: plotValueTarget.layer,
        organism_quantity: v.organism_quantity,
        organism_quantity_type: v.organism_quantity_type,
        notes: v.notes,
        sex: v.sex,
        life_stage: v.life_stage,
        reproductive_condition: serializeMultiAttribute(v.reproductive_condition),
        leaf_phenology: serializeMultiAttribute(v.leaf_phenology),
      });
      setPlotValueTarget(null);
      toast(`已加入樣區：${t.common_name_c || t.simple_name}（分層 ${plotValueTarget.layer}）`, {
        action: { label: '前往', onPress: () => router.push(`/plot/${activePlot.id}` as Href) },
      });
    },
    [plotValueTarget, activePlot, router, toast],
  );

  // ── Render ───────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <Stack.Screen options={{ title: '檢索表', headerLeft: BackHeaderLeft }} />
        <Text className="text-sm text-gray-500 dark:text-gray-400">載入中...</Text>
      </SafeAreaView>
    );
  }

  if (!keyData) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <Stack.Screen options={{ title: '檢索表', headerLeft: BackHeaderLeft }} />
        <Text className="text-sm text-gray-500 dark:text-gray-400">找不到此檢索表</Text>
      </SafeAreaView>
    );
  }

  // Multi-access (matrix) keys take over rendering entirely. The dichotomous
  // useEffects above still ran (cheap: listKeyCouplets returns 0 rows for a
  // matrix key), which keeps hook order stable across renders.
  if (keyData.mode === 'multi_access') {
    return <KeyMatrixRunner keyId={keyId} keyData={keyData} />;
  }

  if (couplets.length === 0) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <Stack.Screen options={{ title: keyData.scope_name, headerLeft: BackHeaderLeft }} />
        <Text className="text-sm text-gray-500 dark:text-gray-400">此檢索表沒有節點內容</Text>
      </SafeAreaView>
    );
  }

  // Show child count (family→genera, genus→species in台) so the user knows
  // the key's coverage from the header alone. Falsy/0 → omit silently.
  const screenTitle = keyData.scope_cname
    ? `${keyData.scope_name} ${keyData.scope_cname}`
    : keyData.scope_name;

  const openTerminalDetail = useCallback(() => {
    if (state.terminal?.kind !== 'taxon') return;
    const r = searchByTaxonId(state.terminal.taxonId);
    if (r) setDetailResult(r);
  }, [state.terminal]);

  let body: React.ReactNode;
  if (state.terminal) {
    if (state.terminal.kind === 'taxon') {
      const t = taxonCache.get(state.terminal.taxonId) ?? null;
      const subs = subkeyCache.get(state.terminal.taxonId) ?? [];
      // Label for the active-record add button. Active plot wins; otherwise
      // we either join the current session (if any) or auto-create a new one.
      const addTarget: 'plot' | 'session' | 'new-session' = activePlot
        ? 'plot'
        : activeSession
          ? 'session'
          : 'new-session';
      body = (
        <TerminalTaxon
          taxon={t}
          taxonId={state.terminal.taxonId}
          marker={state.terminal.marker}
          status={state.terminal.status}
          subkeys={subs}
          addTarget={addTarget}
          onAddToActive={() =>
            state.terminal?.kind === 'taxon' &&
            addTaxonToActiveRecord(state.terminal.taxonId, t)
          }
          onOpenDetail={openTerminalDetail}
          onOpenSubkey={(subId: number) => router.push(`/key/${subId}` as Href)}
          onBack={goBack}
          onRestart={restart}
        />
      );
    } else {
      body = <UnresolvedTerminal rawId={state.terminal.rawId} onBack={goBack} />;
    }
  } else if (currentCouplet && previews) {
    body = (
      <CoupletView
        couplet={currentCouplet}
        previews={previews}
        pickLead={pickLead}
        reachableCount={reachable.length}
        onPeekCandidates={() => setCandidatesOpen(true)}
      />
    );
  }

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: screenTitle,
          headerBackTitle: '返回',
          headerLeft: BackHeaderLeft,
          headerRight: () => (
            <Pressable onPress={restart} hitSlop={8}>
              <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">重來</Text>
            </Pressable>
          ),
        }}
      />

      <Breadcrumb
        path={state.path}
        terminal={state.terminal != null}
        onJump={jumpToPathIndex}
        onLongPressStep={(coupletNumber) => {
          const c = coupletByNumber.get(coupletNumber);
          if (c) setPreviewCouplet(c);
        }}
      />

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        {body}
        {keyData.source ? (
          <View className="mt-6 border-t border-gray-100 dark:border-gray-800 px-4 pt-3">
            <Text className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              引用
            </Text>
            <Text className="mt-1 text-xs text-gray-600 dark:text-gray-400" selectable>
              {/* Strip the "(Sheets:<id>#<worksheet>)" trace the importer
                * appends — useful for backend debugging, noise to users. */}
              {keyData.source.replace(/\s*\(Sheets:[^)]+\)\s*$/, '')}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {!state.terminal && state.path.length > 1 ? (
        <View className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <Pressable
            onPress={goBack}
            className="flex-row items-center justify-center py-3 active:bg-gray-100 dark:active:bg-gray-700"
          >
            <Ionicons name="arrow-back" size={16} color="#374151" />
            <Text className="ml-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">上一步</Text>
          </Pressable>
        </View>
      ) : null}

      <LookupResultSheet
        result={detailResult}
        onClose={() => setDetailResult(null)}
        onAddToSession={() => {
          // Smart routing from the detail sheet — same as TerminalTaxon's
          // primary button, but we have to resolve the cached taxon by id.
          if (state.terminal?.kind === 'taxon') {
            const t = taxonCache.get(state.terminal.taxonId) ?? null;
            addTaxonToActiveRecord(state.terminal.taxonId, t);
          }
          setDetailResult(null);
        }}
      />

      {plotValueTarget && activePlot ? (
        <PlotSpeciesValueModal
          visible
          layer={plotValueTarget.layer}
          title={`${plotValueTarget.taxon.common_name_c || ''} ${plotValueTarget.taxon.simple_name}`.trim()}
          kingdom={plotValueTarget.taxon.kingdom ?? null}
          onCancel={() => setPlotValueTarget(null)}
          onSave={handlePlotValueSave}
        />
      ) : null}

      <CandidatesSheet
        visible={candidatesOpen}
        candidates={reachable}
        coupletNumber={currentCoupletNumber}
        onPick={jumpToReachable}
        onClose={() => setCandidatesOpen(false)}
      />

      <CoupletPreviewPopup
        couplet={previewCouplet}
        onClose={() => setPreviewCouplet(null)}
      />
    </View>
  );
}

function Breadcrumb({
  path,
  terminal,
  onJump,
  onLongPressStep,
}: {
  path: number[];
  terminal: boolean;
  onJump: (idx: number) => void;
  /** Long-press a step number → caller pops a tooltip with the couplet's
   *  lead descriptions, so the user can re-read past traits without
   *  losing their place. */
  onLongPressStep: (coupletNumber: number) => void;
}) {
  if (path.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
      // ScrollView defaults to flexGrow: 1, which would steal vertical space
      // from the main content ScrollView below. Force it to wrap its content.
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' }}
    >
      {/* Step-count hint right at the start: "第 N 步 / 共 M 步" so the user
        * has a sense of progress regardless of where they're scrolled. */}
      <View className="mr-2 rounded-md bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5">
        <Text className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
          第 {path.length} 步
        </Text>
      </View>
      {path.map((n, i) => {
        const isLast = i === path.length - 1 && !terminal;
        return (
          <View key={`${n}-${i}`} className="flex-row items-center">
            <Pressable
              onPress={() => onJump(i)}
              onLongPress={() => onLongPressStep(n)}
              delayLongPress={300}
              className={`rounded-full px-2 py-0.5 ${isLast ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700'}`}
            >
              <Text
                className={`text-[11px] font-semibold ${isLast ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
              >
                {n}
              </Text>
            </Pressable>
            {i < path.length - 1 ? (
              <Ionicons name="chevron-forward" size={10} color="#9ca3af" style={{ marginHorizontal: 2 }} />
            ) : null}
          </View>
        );
      })}
      {terminal ? (
        <View className="flex-row items-center">
          <Ionicons name="chevron-forward" size={10} color="#9ca3af" style={{ marginHorizontal: 2 }} />
          <View className="rounded-full bg-blue-500 px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-white">終點</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function CoupletView({
  couplet,
  previews,
  pickLead,
  reachableCount,
  onPeekCandidates,
}: {
  couplet: KeyCouplet;
  previews: { a: LeadPreview; b: LeadPreview };
  pickLead: (lead: LeadKey) => void;
  reachableCount: number;
  onPeekCandidates: () => void;
}) {
  return (
    <View className="px-4 pt-3">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-xs font-medium text-gray-500 dark:text-gray-400">檢索條件 {couplet.number}</Text>
        {reachableCount > 0 ? (
          <Pressable
            onPress={onPeekCandidates}
            className="flex-row items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 active:bg-gray-200 dark:active:bg-gray-700"
          >
            <Ionicons name="list" size={12} color="#6b7280" />
            <Text className="ml-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
              不確定？看候選 ({reachableCount})
            </Text>
          </Pressable>
        ) : null}
      </View>
      <LeadButton label="A" text={couplet.lead_a_text} preview={previews.a} onPress={() => pickLead('a')} />
      <View className="my-3 flex-row items-center">
        <View className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        <Text className="mx-3 text-xs text-gray-400 dark:text-gray-500">vs</Text>
        <View className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </View>
      <LeadButton label="B" text={couplet.lead_b_text} preview={previews.b} onPress={() => pickLead('b')} />
    </View>
  );
}

function LeadButton({
  label,
  text,
  preview,
  onPress,
}: {
  label: 'A' | 'B';
  text: string;
  preview: LeadPreview;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <View className="flex-row items-baseline">
        <View className="mr-2 h-7 w-7 items-center justify-center rounded-full bg-emerald-500">
          <Text className="text-sm font-bold text-white">{label}</Text>
        </View>
        <Text className="flex-1 text-base leading-6 text-gray-900 dark:text-gray-100" selectable>
          {text || '(無描述)'}
        </Text>
      </View>
      <LeadPreviewLine preview={preview} />
    </Pressable>
  );
}

function LeadPreviewLine({ preview }: { preview: LeadPreview }) {
  if (preview.kind === 'couplet') {
    return (
      <Text className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
        → 檢索條件 {preview.coupletNumber}
      </Text>
    );
  }
  if (preview.kind === 'unresolved') {
    return (
      <Text className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">→ {preview.rawText}</Text>
    );
  }
  const t = preview.taxon;
  return (
    <View className="mt-2 flex-row items-baseline flex-wrap">
      <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">→ </Text>
      <ScientificName
        name={t.simple_name}
        kingdom={t.kingdom}
        className="text-xs font-medium text-emerald-700 dark:text-emerald-300"
      />
      {t.common_name_c ? (
        <Text className="ml-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">{t.common_name_c}</Text>
      ) : null}
    </View>
  );
}

function TerminalTaxon({
  taxon,
  taxonId,
  marker,
  status,
  subkeys,
  addTarget,
  onAddToActive,
  onOpenDetail,
  onOpenSubkey,
  onBack,
  onRestart,
}: {
  taxon: KeyTaxonInfo | null;
  taxonId: string;
  marker: string | null;
  status: string | null;
  subkeys: IdentificationKey[];
  addTarget: 'plot' | 'session' | 'new-session';
  onAddToActive: () => void;
  onOpenDetail: () => void;
  onOpenSubkey: (subId: number) => void;
  onBack: () => void;
  onRestart: () => void;
}) {
  if (!taxon) {
    // Common case: terminal points to a scope (subfamily / family) that
    // TaiCOL doesn't carry a taxon_id for, e.g. Poaceae key lead "Bambusoideae
    // 竹亞科". `taxonId` is the raw sciname fallback the parser stored. When
    // subkeys resolved via scope_name / alias, surface them so the runner
    // can continue instead of dead-ending.
    return (
      <View className="px-4 pt-4">
        <View className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-4 py-4">
          <Text className="text-base font-medium text-amber-800 dark:text-amber-300">
            {subkeys.length > 0 ? '此終端為下一層檢索表' : '無此 taxon_id'}
          </Text>
          <Text className="mt-1 text-xs text-amber-700 dark:text-amber-300">{taxonId}</Text>
        </View>
        {subkeys.map((subkey) => (
          <SubkeyButton
            key={subkey.id}
            subkey={subkey}
            showModeBadge={subkeys.length > 1}
            onPress={() => onOpenSubkey(subkey.id)}
          />
        ))}
        <FooterButtons onBack={onBack} onRestart={onRestart} />
      </View>
    );
  }

  type Tag = { label: string; bg: string; text: string };
  const tags: Tag[] = [];
  if (taxon.is_endemic === 'true')
    tags.push({ label: '臺灣特有', bg: 'bg-emerald-100 dark:bg-emerald-900/60', text: 'text-emerald-700 dark:text-emerald-300' });
  // redlist + IUCN are rendered as ConservationBadge below the tags row
  // so they get the official IUCN palette instead of the generic Tailwind tag.
  if (taxon.cites)
    tags.push({ label: `CITES ${taxon.cites}`, bg: 'bg-red-100 dark:bg-red-900/60', text: 'text-red-700 dark:text-red-400' });
  if (taxon.protected)
    tags.push({ label: `保育 ${taxon.protected}`, bg: 'bg-red-100 dark:bg-red-900/60', text: 'text-red-700 dark:text-red-400' });
  if (marker) tags.push({ label: marker, bg: 'bg-blue-100 dark:bg-blue-900/60', text: 'text-blue-700 dark:text-blue-300' });

  return (
    <View className="px-4 pt-4">
      <Pressable
        onPress={onOpenDetail}
        className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-4 active:bg-emerald-100 dark:active:bg-emerald-900/60"
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">檢索完成</Text>
          <View className="flex-row items-center">
            <Text className="mr-1 text-[11px] text-emerald-700 dark:text-emerald-300">詳細資訊</Text>
            <Ionicons name="information-circle-outline" size={14} color="#047857" />
          </View>
        </View>
        <View className="mt-2 flex-row items-baseline flex-wrap">
          {taxon.common_name_c ? (
            <Text className="text-xl font-bold text-gray-900 dark:text-gray-100" selectable>
              {taxon.common_name_c}
            </Text>
          ) : null}
          <ScientificName
            name={taxon.simple_name}
            kingdom={taxon.kingdom}
            className={`${taxon.common_name_c ? 'ml-2 ' : ''}text-base text-gray-800 dark:text-gray-200`}
          />
        </View>
        {taxon.name_author ? (
          <Text className="mt-0.5 text-sm text-gray-600 dark:text-gray-400" selectable>
            {taxon.name_author}
          </Text>
        ) : null}
        {taxon.family_c || taxon.family ? (
          <Text className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {taxon.family_c} {taxon.family}
          </Text>
        ) : null}
        {tags.length > 0 || taxon.redlist || status ? (
          <View className="mt-3 flex-row flex-wrap items-center gap-1.5">
            {tags.map((t, i) => (
              <View key={`${t.label}-${i}`} className={`rounded-full px-2.5 py-1 ${t.bg}`}>
                <Text className={`text-xs font-medium ${t.text}`}>{t.label}</Text>
              </View>
            ))}
            {taxon.redlist ? <ConservationBadge code={taxon.redlist} /> : null}
            {status ? (
              <View className="flex-row items-center">
                <Text className="mr-1 text-xs font-medium text-gray-600 dark:text-gray-400">IUCN</Text>
                <ConservationBadge code={status} />
              </View>
            ) : null}
          </View>
        ) : null}
        {taxon.taxon_id ? (
          <View className="mt-3">
            <Text className="text-[11px] text-gray-500 dark:text-gray-400">TaiCOL: {taxon.taxon_id}</Text>
          </View>
        ) : null}
      </Pressable>

      {subkeys.map((subkey) => (
        <SubkeyButton
          key={subkey.id}
          subkey={subkey}
          showModeBadge={subkeys.length > 1}
          onPress={() => onOpenSubkey(subkey.id)}
        />
      ))}

      <AddToActiveRecordButton target={addTarget} onPress={onAddToActive} />

      <FooterButtons onBack={onBack} onRestart={onRestart} />
    </View>
  );
}

/** Single "續查 X 內檢索表" button. When the same scope carries both a
 *  dichotomous and a multi_access key, TerminalTaxon renders this twice
 *  with `showModeBadge=true` so the user can pick. */
function SubkeyButton({
  subkey,
  showModeBadge,
  onPress,
}: {
  subkey: IdentificationKey;
  showModeBadge: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-3 flex-row items-center rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 active:bg-blue-100 dark:active:bg-blue-900/60"
    >
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-lg bg-blue-500">
        <Ionicons name="key" size={18} color="white" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center flex-wrap">
          <Text className="text-xs font-medium text-blue-700 dark:text-blue-300">
            續查{subkeyRankLabel(subkey.scope_rank)}內檢索表
          </Text>
          {showModeBadge ? (
            <View className="ml-2 rounded bg-blue-200 dark:bg-blue-800/80 px-1.5 py-0.5">
              <Text className="text-[10px] font-medium text-blue-800 dark:text-blue-200">
                {subkeyModeLabel(subkey.mode)}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="mt-0.5 flex-row items-baseline flex-wrap">
          <ScientificName
            name={subkey.scope_name}
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
          />
          {subkey.scope_cname ? (
            <Text className="ml-2 text-sm text-gray-600 dark:text-gray-400">{subkey.scope_cname}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#3b82f6" />
    </Pressable>
  );
}

function AddToActiveRecordButton({
  target,
  onPress,
}: {
  target: 'plot' | 'session' | 'new-session';
  onPress: () => void;
}) {
  // 文案依目標調整：plot 要再輸豐度故說「填入豐度」；session 已存在就直接加；
  // 沒任何 active 時誠實告知會幫他建一筆新名錄。
  const label =
    target === 'plot'
      ? '加入目前樣區（下一步輸入豐度）'
      : target === 'session'
        ? '加入目前名錄'
        : '建立新名錄並加入';
  const sub =
    target === 'plot'
      ? '依現有樣區的分層與單位設定填寫'
      : target === 'session'
        ? '加入已開啟的名錄'
        : '尚無進行中的記錄，將自動開一筆新名錄';
  return (
    <Pressable
      onPress={onPress}
      className="mt-3 flex-row items-center rounded-xl bg-emerald-500 px-4 py-3 active:bg-emerald-600"
    >
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-lg bg-white/20">
        <Ionicons name="add" size={20} color="white" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-white">{label}</Text>
        <Text className="text-[11px] text-emerald-50/90">{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="white" />
    </Pressable>
  );
}

function UnresolvedTerminal({
  rawId,
  onBack,
}: {
  rawId: string | null;
  onBack: () => void;
}) {
  return (
    <View className="px-4 pt-6">
      <View className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-4 py-4">
        <Text className="text-base font-medium text-amber-800 dark:text-amber-300">無法解析的指向</Text>
        <Text className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          原始值：<Text className="font-mono">{rawId ?? '(空)'}</Text>
        </Text>
        <Text className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          通常是來源資料的 typo 或 PDF font 誤讀（例如 `:` 應為 8 / 9）。請至 Google Sheets 修正後重新匯入。
        </Text>
      </View>
      <FooterButtons onBack={onBack} />
    </View>
  );
}

function FooterButtons({
  onBack,
  onRestart,
}: {
  onBack: () => void;
  onRestart?: () => void;
}) {
  return (
    <View className="mt-4 flex-row gap-3">
      <Pressable
        onPress={onBack}
        className="flex-1 flex-row items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700 py-3 active:bg-gray-300 dark:active:bg-gray-600"
      >
        <Ionicons name="arrow-back" size={14} color="#374151" />
        <Text className="ml-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">上一步</Text>
      </Pressable>
      {onRestart ? (
        <Pressable
          onPress={onRestart}
          className="flex-1 flex-row items-center justify-center rounded-lg bg-emerald-500 py-3 active:bg-emerald-600"
        >
          <Ionicons name="refresh" size={14} color="white" />
          <Text className="ml-1.5 text-sm font-medium text-white">重來</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Bottom-sheet listing every terminal reachable from the current couplet
 * (peek / "看候選" feature). Tapping a row jumps straight to that terminal,
 * auto-expanding `state.path` with the traversed couplets so the breadcrumb
 * still reflects the route. Use this when you can't observe the trait the
 * current couplet asks about.
 */
function CandidatesSheet({
  visible,
  candidates,
  coupletNumber,
  onPick,
  onClose,
}: {
  visible: boolean;
  candidates: ReachableTerminal[];
  coupletNumber: number | null;
  onPick: (c: ReachableTerminal) => void;
  onClose: () => void;
}) {
  // Sort: resolved taxa first (with cname), then by cname / sciname order so
  // the user can scan alphabetically.
  const sorted = useMemo(() => {
    const arr = [...candidates];
    arr.sort((a, b) => {
      const ax = a.taxon?.common_name_c || a.taxon?.simple_name || a.taxonId;
      const bx = b.taxon?.common_name_c || b.taxon?.simple_name || b.taxonId;
      return ax.localeCompare(bx);
    });
    return arr;
  }, [candidates]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
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
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80%' }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="flex-1">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>
            <View className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                不確定？跳過此條件看候選節點或分類群
              </Text>
              <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                從檢索條件 {coupletNumber ?? '?'} 往下還能檢索到的分類群（{sorted.length} 筆），
                直接點選跳到該分類群
              </Text>
            </View>
            <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
              {sorted.map((c, i) => (
                <CandidateRow key={`${c.taxonId}-${i}`} c={c} onPress={() => onPick(c)} />
              ))}
              {sorted.length === 0 ? (
                <View className="px-4 py-12">
                  <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
                    沒有可檢索到之分類群
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function CandidateRow({ c, onPress }: { c: ReachableTerminal; onPress: () => void }) {
  const t = c.taxon;
  return (
    <Pressable
      onPress={onPress}
      className="border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <View className="flex-row items-baseline flex-wrap">
        {t?.common_name_c ? (
          <Text className="text-base font-medium text-gray-900 dark:text-gray-100">
            {t.common_name_c}
          </Text>
        ) : null}
        {t ? (
          <ScientificName
            name={t.simple_name}
            kingdom={t.kingdom}
            className={`${t.common_name_c ? 'ml-2 ' : ''}text-sm text-gray-700 dark:text-gray-300`}
          />
        ) : (
          <Text className="text-sm font-mono text-amber-700 dark:text-amber-300">
            {c.taxonId}
          </Text>
        )}
      </View>
      {/* Family was previously shown here but is redundant inside a key
        * runner: the user already chose the scope (family/genus key) when
        * opening this list, so repeating "Acanthaceae 爵床科" on every row
        * just adds noise. Per-step trace below remains. */}
      {/* Per-step trace with descriptions so users can scan the actual
        * traits leading to this terminal. */}
      <View className="mt-2 rounded-md bg-gray-50 dark:bg-gray-800 px-2.5 py-2">
        {c.trace.map((s, i) => (
          <View
            key={`${s.coupletNumber}-${s.lead}-${i}`}
            className={`flex-row items-baseline ${i > 0 ? 'mt-1' : ''}`}
          >
            <Text className="w-[40px] text-sm font-semibold text-gray-700 dark:text-gray-300">
              {s.coupletNumber}{s.lead}
            </Text>
            <Text
              className="flex-1 text-sm leading-5 text-gray-700 dark:text-gray-300"
              numberOfLines={3}
            >
              {s.text || '(無描述)'}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

/**
 * Floating popup triggered by long-pressing a breadcrumb step. Renders the
 * couplet's A/B lead descriptions so the user can re-read the trait
 * without losing their current position. Centre-screen Modal with backdrop
 * tap to dismiss (no swipe-down — the surface is small and a tap target
 * suffices).
 */
function CoupletPreviewPopup({
  couplet,
  onClose,
}: {
  couplet: KeyCouplet | null;
  onClose: () => void;
}) {
  if (!couplet) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}
      >
        {/* Inner Pressable swallows the press so tapping content doesn't
          * close the popup; only the backdrop does. */}
        <Pressable
          onPress={() => {}}
          className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-4 shadow-2xl"
          style={{ maxWidth: 480 }}
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              檢索條件 {couplet.number}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color="#6b7280" />
            </Pressable>
          </View>
          <PreviewLead label="A" text={couplet.lead_a_text} />
          <View className="my-2 flex-row items-center">
            <View className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <Text className="mx-2 text-[10px] text-gray-400 dark:text-gray-500">vs</Text>
            <View className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </View>
          <PreviewLead label="B" text={couplet.lead_b_text} />
          <Text className="mt-3 text-[10px] text-gray-400 dark:text-gray-500">
            點擊外圍關閉
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PreviewLead({ label, text }: { label: 'A' | 'B'; text: string }) {
  return (
    <View className="flex-row items-baseline">
      <View className="mr-2 h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
        <Text className="text-[10px] font-bold text-white">{label}</Text>
      </View>
      <Text className="flex-1 text-sm leading-5 text-gray-800 dark:text-gray-200" selectable>
        {text || '(無描述)'}
      </Text>
    </View>
  );
}
