import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { KeyboardStickyView } from '~/components/KeyboardAvoidingView';
import {
  addSearchHistory,
  getKeysForScope,
  getSpeciesUnder,
  getTaxonChildren,
  nodeKeyFor,
  type Ancestors,
  type IdentificationKey,
  type Rank,
  type SearchResult,
  type TaxonNode as TaxonNodeData,
  type TaxonSearchHit,
  type TaxonSpecies,
} from '~/db';
import { showActionSheet } from '~/components/ActionSheet';
import { ConservationBadge } from '~/components/ConservationBadge';
import { KeyListView } from '~/components/KeyListView';
import { LookupResultSheet } from '~/components/LookupResultSheet';
import { ScientificName } from '~/components/ScientificName';
import { SpeciesSearchPanel } from '~/components/SpeciesSearchPanel';
import { TaxonomySearchBox } from '~/components/TaxonomySearchBox';
import {
  buildSpeciesCopyText,
  buildTaxonCopyText,
  copyToClipboard,
  speciesCopyActions,
  taxonCopyActions,
} from '~/lib/clipboard';
import { alienBadge } from '~/lib/conservationColors';
import { perf } from '~/lib/perf';
import { rankColor } from '~/lib/rankColors';
import { taxonSpeciesToSearchResult } from '~/lib/taxonSpecies';
import { useAddToActiveRecord } from '~/lib/useAddToActiveRecord';
import { useActiveSession } from '~/stores/activeSession';
import { useFavorites } from '~/stores/favorites';
import { useSettings } from '~/stores/settings';
import { useTaxonomyJump } from '~/stores/taxonomyJump';
import { useToast } from '~/stores/toast';

type FlatItem =
  | { kind: 'taxon'; key: string; node: TaxonNodeData; depth: number; expanded: boolean }
  | { kind: 'species'; key: string; species: TaxonSpecies; depth: number }
  | { kind: 'loading'; key: string; depth: number };

// Per-kind row-height seeds, used only until real measurements arrive.
// Deliberately NOT biased low — the old code biased low so the first scroll
// would land before the target, but that was compensating for an impure
// getItemLayout (now fixed), and a systematic per-row error multiplied by the
// target index is exactly what made deep locates land in the wrong place.
// Module scope so the memo/callback below need no dependency on it.
const DEFAULT_ROW_HEIGHT: Record<FlatItem['kind'], number> = {
  taxon: 60,
  species: 40,
  loading: 32,
};

function flatten(
  roots: TaxonNodeData[],
  expanded: Set<string>,
  childrenMap: Map<string, TaxonNodeData[]>,
  speciesMap: Map<string, TaxonSpecies[]>,
): FlatItem[] {
  const out: FlatItem[] = [];
  function walk(nodes: TaxonNodeData[], depth: number) {
    for (const node of nodes) {
      const key = nodeKeyFor(node);
      out.push({ kind: 'taxon', key, node, depth, expanded: expanded.has(key) });
      if (!expanded.has(key)) continue;
      const sp = speciesMap.get(key);
      if (sp) {
        for (const s of sp) {
          out.push({
            kind: 'species',
            key: `species:${s.taxon_id || s.simple_name}`,
            species: s,
            depth: depth + 1,
          });
        }
        continue;
      }
      const children = childrenMap.get(key);
      if (children) walk(children, depth + 1);
      else out.push({ kind: 'loading', key: `${key}:loading`, depth: depth + 1 });
    }
  }
  walk(roots, 0);
  return out;
}

export default function TaxonomyScreen() {
  const { t } = useTranslation();
  // Mount-time marker — paired with `taxonomy:first-paint` below.
  // Must fire only ONCE on first render; putting it bare in the function body
  // would re-mark on every re-render and make `first-paint` measure from the
  // last render instead of mount.
  const renderStartMarkedRef = useRef(false);
  if (!renderStartMarkedRef.current) {
    renderStartMarkedRef.current = true;
    perf.mark('taxonomy:render-start');
  }
  const refreshActive = useActiveSession((s) => s.refresh);
  const toast = useToast((s) => s.show);
  const {
    addSpecies,
    promptAddDestination,
    modal: addRecordModal,
    targetLabel: addTargetLabel,
  } = useAddToActiveRecord();

  const persistedExpanded = useSettings((s) => s.taxonomy_expanded);
  const setSetting = useSettings((s) => s.set);
  const settingsLoaded = useSettings((s) => s.loaded);
  // KeyboardStickyView translates by -keyboard_height from its natural laid-out
  // position. Inside a Tabs screen the natural bottom = top of tab bar, NOT
  // screen bottom, so without compensating offset the search box ends up
  // sitting `tabBarHeight` ABOVE the keyboard's top edge (the ~88-100px gap
  // user reported). Adding `offset.opened: tabBarHeight` pushes it back down
  // by that much so the bar sits flush against the keyboard.
  const tabBarHeight = useBottomTabBarHeight();

  const [segment, setSegment] = useState<'tree' | 'key' | 'search'>('tree');

  // Segment switch needs to clear the KeyboardStickyView's stale offset.
  // Empirically (per user report after multiple fixes) just calling
  // KeyboardController.dismiss inside an effect doesn't bring the lib's
  // sticky-view animated value back to 0 — it stays latched at the previous
  // keyboard height, so TaxonomySearchBox ends up floating mid-screen on
  // entry to the tree segment. The only known-working workaround is the
  // user's own discovery: tap another bottom tab and come back, which
  // unmounts taxonomy.tsx entirely and resets every KSV instance.
  //
  // We mirror that behaviour by wrapping each segment's subtree in a
  // `<View key={segment}>` below (segment value as key → React unmounts the
  // previous subtree + mounts the next, KSV resets fresh from 0). The
  // explicit dismiss is still useful so the native keyboard doesn't linger
  // visually during the swap.
  const handleSwitchSegment = useCallback(async (next: 'tree' | 'key' | 'search') => {
    if (next === segment) return;
    try {
      await KeyboardController.dismiss({ keepFocus: false });
    } catch {
      // best effort — lib not initialized yet etc.
    }
    setSegment(next);
  }, [segment]);
  const [roots, setRoots] = useState<TaxonNodeData[]>([]);
  const [loading, setLoading] = useState(true);
  // Separate stage labels so the spinner says something concrete (「載入分類樹...」
  // → 「展開上次狀態 (3/8)...」) instead of leaving the user staring at a frozen
  // empty tree while the cascade SQL runs.
  const [loadStage, setLoadStage] = useState(t('taxonomy.loadingTree'));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodeMap, setNodeMap] = useState<Map<string, TaxonNodeData>>(new Map());
  const [childrenMap, setChildrenMap] = useState<Map<string, TaxonNodeData[]>>(new Map());
  const [speciesMap, setSpeciesMap] = useState<Map<string, TaxonSpecies[]>>(new Map());
  const [activeSpecies, setActiveSpecies] = useState<SearchResult | null>(null);
  // Query to pre-fill into KeyListView when user taps a 🔑 chip on TaxonRow.
  // We bump a counter alongside the string so re-tapping the same scope still
  // re-triggers the prefill (KeyListView clears the field on user typing).
  const [keyListPrefill, setKeyListPrefill] = useState<{ q: string; nonce: number } | null>(null);

  const openKeysForScope = useCallback((scopeName: string) => {
    setKeyListPrefill((prev) => ({ q: scopeName, nonce: (prev?.nonce ?? 0) + 1 }));
    setSegment('key');
  }, []);

  const listRef = useRef<FlatList<FlatItem>>(null);
  // A jump request sets this to the target node key. A follow-up effect
  // resolves it against the latest flatItems and runs a multi-attempt scroll
  // (FlatList virtualization can delay the target row's mount; one-shot
  // scrollToIndex would land on the wrong offset via the fallback estimate).
  // 捲動目標。種階層命中時要捲到「那一列物種」而不是它所屬的屬節點 ——
  // 屬底下可能有數百種（jp_names 的 Carex 有 550 種，カンスゲ 排第 300），
  // 捲到屬節點等於只看得到最前面幾種，這正是使用者回報的症狀。
  //
  // 用學名而不是 taxon_id 比對：日本區開啟時 getSpeciesUnder 會把 TW/JP 共有種
  // 收合成一列並**保留 TaiCOL 的 taxon_id**（全域 5,969 種、光 Carex 就 82 種），
  // 所以 JP 搜尋命中帶的 y… id 對不上樹上那一列。學名才是兩邊共同的鍵。
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{
    speciesName?: string;
    nodeKey: string;
  } | null>(null);
  // Row-height cache feeding the prefix-sum table below. Populated by each
  // row's onLayout the first time it renders, so offsets stay accurate for
  // previously-unrendered rows. A ref because onLayout fires per row during
  // a scroll; new measurements are folded in via the trailing-debounced
  // `heightEpoch` bump rather than a render per row (see noteRowHeight).
  const heightCacheRef = useRef<Map<string, number>>(new Map());
  const hydratedRef = useRef(false);
  // FlatList milestone tracking — each fires at most once so we measure the
  // first time the tree actually paints natively. onLayout = wrapper measured;
  // first renderItem call = JS started building rows; onContentSizeChange =
  // native ScrollView received its child views and laid them out (good proxy
  // for "user sees something").
  const flatListMarkedRef = useRef({ layout: false, firstRow: false, content: false });
  // 樹的實際可視高度（FlatList onLayout 量得）。捲動定位要用它換算 viewPosition，
  // 寫死的 600 在現在的手機上普遍偏小，會讓目標落在比預期更下面的位置。
  const treeViewportHeightRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      perf.measure('taxonomy:focus', 'taxonomy:tab-press');
      perf.time('taxonomy:focus-refresh-active', refreshActive);
      // Probe: schedule a microtask + a macrotask. The gap from focus to
      // each tells us when the JS thread finishes whatever it's doing after
      // the focus event. If "macro-idle" is several seconds, something is
      // synchronously blocking the JS thread between focus and idle.
      const tFocus = Date.now();
      queueMicrotask(() => {
        console.log(`[perf] taxonomy:focus → micro-idle: ${Date.now() - tFocus}ms`);
      });
      setTimeout(() => {
        console.log(`[perf] taxonomy:focus → macro-idle: ${Date.now() - tFocus}ms`);
      }, 0);
    }, [refreshActive]),
  );

  // Initial load + hydration of persisted expansion, both run synchronously
  // in this single effect. Cumulative SQL is ~160ms which is fine to block
  // on; the previous chunked-async setTimeout(0) pattern was measured to
  // wait 15+ seconds per yield during cold-start contention with other tab
  // mounts. The initial render already committed with loading=true so the
  // spinner is on screen while this work runs.
  useEffect(() => {
    if (!settingsLoaded || hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;

    setLoading(true);
    setLoadStage(t('taxonomy.loadingTree'));
    perf.mark('taxonomy:hydrate-start');
    if (__DEV__) {
      console.log(
        `[perf] taxonomy:hydrate-state settingsLoaded=${settingsLoaded} persistedExpanded.length=${persistedExpanded.length}`,
      );
    }

    // Step 1: root kingdoms (cached after DBProvider prewarm → instant)
    const r = perf.time('taxonomy:load-roots', () =>
      getTaxonChildren({ rank: 'kingdom' }),
    );
    if (cancelled) return;
    const nm = new Map<string, TaxonNodeData>();
    for (const n of r) nm.set(nodeKeyFor(n), n);
    setRoots(r);

    // Step 2: cascade-load persisted expanded set.
    if (persistedExpanded.length === 0) {
      setNodeMap(nm);
      setLoading(false);
      perf.measure('taxonomy:hydrate-done', 'taxonomy:hydrate-start');
      return;
    }

    const wantExpanded = new Set(persistedExpanded);
    const cm = new Map<string, TaxonNodeData[]>();
    const sm = new Map<string, TaxonSpecies[]>();

    // Run cascade synchronously in the effect body. NO setTimeout — measured
    // on real device, a setTimeout(0) callback during cold start sits behind
    // queued JS work for 15+ seconds even though cumulative cascade SQL is
    // only ~160ms. Blocking the JS thread for 160ms once is dramatically
    // better than a 15s setTimeout wait. The initial render already committed
    // with loading=true so the spinner is on screen while this runs.
    perf.time('taxonomy:cascade-all', () => {
      let progress = true;
      // Repeated passes: child loads may register new keys in nm that
      // satisfy other persisted-expanded entries deeper in the tree.
      while (progress) {
        progress = false;
        for (const key of wantExpanded) {
          if (cm.has(key) || sm.has(key)) continue;
          const node = nm.get(key);
          if (!node) continue;
          loadInto(node, nm, cm, sm);
          progress = true;
        }
      }
    });
    if (cancelled) return;
    setNodeMap(nm);
    setChildrenMap(cm);
    setSpeciesMap(sm);
    setExpanded(wantExpanded);
    setLoading(false);
    perf.measure('taxonomy:hydrate-done', 'taxonomy:hydrate-start');

    return () => {
      cancelled = true;
    };
    // Deliberately depends only on settingsLoaded — we hydrate once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  // First-paint marker: fires after the first non-loading render commits.
  // This is "when the user actually sees the tree", which is the number that
  // matters for perceived perf.
  const firstPaintMarkedRef = useRef(false);
  useEffect(() => {
    if (loading || firstPaintMarkedRef.current) return;
    firstPaintMarkedRef.current = true;
    perf.measure('taxonomy:first-paint', 'taxonomy:render-start');
  }, [loading]);

  const persistExpanded = useCallback(
    (next: Set<string>) => {
      setSetting('taxonomy_expanded', Array.from(next));
    },
    [setSetting],
  );

  const handleToggle = (key: string) => {
    const wasExpanded = expanded.has(key);
    const next = new Set(expanded);
    if (wasExpanded) next.delete(key);
    else next.add(key);
    setExpanded(next);
    persistExpanded(next);

    if (!wasExpanded) {
      const node = nodeMap.get(key);
      if (node && !childrenMap.has(key) && !speciesMap.has(key)) {
        const nm = new Map(nodeMap);
        const cm = new Map(childrenMap);
        const sm = new Map(speciesMap);
        loadInto(node, nm, cm, sm);
        setNodeMap(nm);
        setChildrenMap(cm);
        setSpeciesMap(sm);
      }
    }
  };

  const handleCollapseAll = () => {
    if (expanded.size === 0) return;
    setExpanded(new Set());
    persistExpanded(new Set());
    toast(t('taxonomy.allCollapsed'));
  };

  const flatItems = useMemo(
    () =>
      perf.time('taxonomy:flatten', () => {
        const items = flatten(roots, expanded, childrenMap, speciesMap);
        if (__DEV__) console.log(`[perf] taxonomy:flatten-size ${items.length}`);
        return items;
      }),
    [roots, expanded, childrenMap, speciesMap],
  );

  // Running mean of actually-measured heights per kind. Unmeasured rows are
  // estimated with this instead of the hard-coded seed, so the estimate is
  // unbiased on average rather than systematically short. Self-calibrating:
  // no magic constant to keep in sync with the row styling.
  const heightSamplesRef = useRef<Record<FlatItem['kind'], { sum: number; n: number }>>({
    taxon: { sum: 0, n: 0 },
    species: { sum: 0, n: 0 },
    loading: { sum: 0, n: 0 },
  });
  // Bumped (trailing-debounced) whenever new measurements land, so the
  // prefix-sum table below recomputes. Debounced because every row's
  // onLayout fires during a scroll and we do not want a render per row.
  const [heightEpoch, setHeightEpoch] = useState(0);
  const epochTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteRowHeight = useCallback((key: string, kind: FlatItem['kind'], h: number) => {
    if (h <= 0) return;
    const prev = heightCacheRef.current.get(key);
    if (prev === h) return;
    heightCacheRef.current.set(key, h);
    if (prev === undefined) {
      const s = heightSamplesRef.current[kind];
      s.sum += h;
      s.n += 1;
    }
    if (epochTimerRef.current) return;
    epochTimerRef.current = setTimeout(() => {
      epochTimerRef.current = null;
      setHeightEpoch((v) => v + 1);
    }, 100);
  }, []);

  useEffect(
    () => () => {
      if (epochTimerRef.current) clearTimeout(epochTimerRef.current);
    },
    [],
  );

  // Precomputed prefix-sum offsets. getItemLayout MUST be a pure function of
  // (data, index): VirtualizedList stores what it returns in its internal
  // frame table and drives virtualization and every scroll computation from
  // it. The previous implementation summed heightCacheRef — a mutable Map
  // that each row's onLayout rewrites — so the same (data, index) returned
  // different offsets over time, desynchronising FlatList's frame table from
  // the real rows. That is why "定位" landed in the wrong place, and it got
  // worse the longer the list, because the error is per-row and accumulates.
  //
  // Building the table once per (flatItems, heightEpoch) also turns the old
  // O(n) per call — invoked per row, i.e. O(n²) — into O(1) lookups.
  const rowLayout = useMemo(() => {
    const samples = heightSamplesRef.current;
    const seedFor = (kind: FlatItem['kind']) => {
      const s = samples[kind];
      return s.n > 0 ? s.sum / s.n : DEFAULT_ROW_HEIGHT[kind];
    };
    const lengths = new Array<number>(flatItems.length);
    const offsets = new Array<number>(flatItems.length);
    let acc = 0;
    for (let i = 0; i < flatItems.length; i++) {
      const it = flatItems[i];
      const h = heightCacheRef.current.get(it.key) ?? seedFor(it.kind);
      offsets[i] = acc;
      lengths[i] = h;
      acc += h;
    }
    return { lengths, offsets };
    // heightEpoch is the signal that heightCacheRef/heightSamplesRef changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatItems, heightEpoch]);

  // Latest table, readable from inside the scroll loop without making the
  // loop's effect re-run (which would restart the attempt counter forever as
  // measurements keep arriving).
  const rowLayoutRef = useRef(rowLayout);
  rowLayoutRef.current = rowLayout;

  const getItemLayout = useCallback(
    (_data: ArrayLike<FlatItem> | null | undefined, index: number) => {
      const { lengths, offsets } = rowLayoutRef.current;
      if (index < 0 || index >= lengths.length) {
        return { length: DEFAULT_ROW_HEIGHT.taxon, offset: 0, index };
      }
      return { length: lengths[index], offset: offsets[index], index };
    },
    [],
  );

  /** Cascade-expand the tree along a rank path, then scroll to the deepest
   *  entry. Used by both the in-tab search hit handler and the
   *  cross-screen taxonomy jump (rank chip on SpeciesDetailPanel). */
  const expandToPath = useCallback(
    (path: Array<{ rank: Rank; value: string }>, toastLabel?: string, speciesName?: string) => {
      if (path.length === 0 || roots.length === 0) return;

      const wantExpanded = new Set(expanded);
      const nm = new Map(nodeMap);
      const cm = new Map(childrenMap);
      const sm = new Map(speciesMap);

      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const ancestors: Ancestors = {};
        for (let j = 0; j < i; j++) ancestors[path[j].rank] = path[j].value;

        const tempNode: TaxonNodeData = {
          name: p.value,
          name_c: '',
          rank: '',
          rank_key: p.rank,
          child_rank: 'species',
          stats: {},
          ancestors,
        };
        const k = nodeKeyFor(tempNode);
        wantExpanded.add(k);

        let node = nm.get(k);
        if (!node) {
          const childRankIdx =
            ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].indexOf(p.rank) + 1;
          const childRank =
            childRankIdx < 6
              ? (['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as Rank[])[childRankIdx]
              : ('species' as const);
          node = { ...tempNode, child_rank: childRank };
          nm.set(k, node);
        }
        if (!cm.has(k) && !sm.has(k)) loadInto(node, nm, cm, sm);
      }

      setNodeMap(nm);
      setChildrenMap(cm);
      setSpeciesMap(sm);
      setExpanded(wantExpanded);
      persistExpanded(wantExpanded);

      const targetAncestors: Ancestors = {};
      for (let j = 0; j < path.length - 1; j++) {
        targetAncestors[path[j].rank] = path[j].value;
      }
      const target = path[path.length - 1];
      const targetKey = nodeKeyFor({
        rank_key: target.rank,
        name: target.value,
        ancestors: targetAncestors,
      });
      // Defer the scroll to a follow-up effect that runs once flatItems has
      // recomputed against the new state — virtualization needs the new
      // children rows mounted before scrollToIndex can land. Direct rAF
      // here would race the FlatList re-render.
      // 種階層命中時優先捲到那一列物種，找不到才退回屬節點。
      setPendingScrollTarget({ speciesName, nodeKey: targetKey });

      if (toastLabel) toast(t('taxonomy.expanded', { label: toastLabel }));
    },
    [roots, expanded, nodeMap, childrenMap, speciesMap, persistExpanded, toast],
  );

  const SPECIES_RANKS = ['Species', 'Subspecies', 'Variety', 'Form'];

  const handleSearchPick = (hit: TaxonSearchHit) => {
    const speciesName = SPECIES_RANKS.includes(hit.rank) ? hit.name : undefined;
    expandToPath(hit.path, hit.cname || hit.name, speciesName);
  };

  // Cross-screen taxonomy jump: SpeciesDetailPanel's rank chip writes a
  // `pendingPath` to the store and pushes us here. Drain it once the tree is
  // ready (settings hydrated + roots loaded), forcing the segment back to
  // 'tree' so the cascade is actually visible.
  const pendingJumpPath = useTaxonomyJump((s) => s.pendingPath);
  const clearJump = useTaxonomyJump((s) => s.clear);
  const isFocused = useIsFocused();
  // Consume the jump ONLY once this tab is focused. `request(path)` fires from
  // another screen (plot/session detail), so this effect would otherwise run
  // while taxonomy is still in the background — the FlatList isn't laid out, the
  // scroll silently fails, and the early `clearJump()` removes the request so it
  // never retries on focus. Gating on `isFocused` defers consumption until the
  // tree is actually on-screen, fixing "jump never locates".
  useEffect(() => {
    if (!isFocused || !pendingJumpPath || loading || roots.length === 0) return;
    setSegment('tree');
    expandToPath(pendingJumpPath, pendingJumpPath[pendingJumpPath.length - 1]?.value);
    clearJump();
  }, [isFocused, pendingJumpPath, loading, roots.length, expandToPath, clearJump]);

  // Scroll-to-target resolver. Uses getItemLayout-derived offset and a
  // direct scrollToOffset (bypassing scrollToIndex entirely) so we control
  // the exact pixel target instead of relying on FlatList's viewPosition
  // computation. Multi-attempt because heightCacheRef gets fuller between
  // attempts as more rows render + onLayout-measure, so subsequent offset
  // estimates converge to truth.
  useEffect(() => {
    if (!pendingScrollTarget) return;
    const { speciesName, nodeKey } = pendingScrollTarget;
    // 先找物種列（比對學名，見 pendingScrollTarget 的說明），找不到才退回屬節點。
    let idx = speciesName
      ? flatItems.findIndex(
          (item) => item.kind === 'species' && item.species.simple_name === speciesName,
        )
      : -1;
    if (idx < 0) idx = flatItems.findIndex((item) => item.key === nodeKey);
    if (idx < 0) {
      // 找不到目標就必須把請求清掉。原本只 return 不清，它會永遠停在非 null，
      // 於是底下「切換 segment 時還原捲動位置」那段的
      // `if (pendingScrollTarget || pendingJumpPath) return;` 被永久短路 ——
      // 一次失敗的定位會污染這個 session 之後所有的捲動還原。
      if (__DEV__)
        console.log(`[scroll] no candidate in flatItems: ${speciesName ?? ''} | ${nodeKey}`);
      setPendingScrollTarget(null);
      return;
    }

    let cancelled = false;
    let n = 0;
    const MAX_ATTEMPTS = 8;
    const INTERVAL_MS = 220;
    // 用 FlatList onLayout 量到的真實高度；還沒量到才退回粗估值。
    const VIEWPORT_FALLBACK = 600;
    const VIEW_POSITION = 0.25;

    const tick = () => {
      if (cancelled) return;
      // 每次重試都讀當下最新的前綴和表：這一輪捲動又量到了一批真實行高，
      // 估計值會逐次收斂。effect 不依賴 rowLayout，所以不會重啟計數器。
      const { offsets, lengths } = rowLayoutRef.current;
      const offset = offsets[idx] ?? 0;
      const length = lengths[idx] ?? 0;
      const viewport = treeViewportHeightRef.current || VIEWPORT_FALLBACK;
      const targetY = Math.max(0, offset - VIEW_POSITION * (viewport - length));
      const beforeY = treeScrollOffsetRef.current;
      try {
        listRef.current?.scrollToOffset({ offset: targetY, animated: false });
      } catch (err) {
        if (__DEV__) console.log(`[scroll] scrollToOffset threw on attempt ${n + 1}`, err);
      }
      // Read scrollY one frame later — gives FlatList a paint cycle to
      // actually apply the scroll (or fail to). Diff before/after tells us
      // whether the scroll command landed.
      requestAnimationFrame(() => {
        if (__DEV__) {
          const afterY = treeScrollOffsetRef.current;
          console.log(
            `[scroll] att ${n + 1}/${MAX_ATTEMPTS} idx=${idx} ` +
              `est=${Math.round(offset)} target=${Math.round(targetY)} ` +
              `before=${Math.round(beforeY)} after=${Math.round(afterY)} ` +
              `measured=${heightCacheRef.current.size}`,
          );
        }
      });
      n++;
      if (n < MAX_ATTEMPTS) {
        setTimeout(tick, INTERVAL_MS);
      } else {
        if (__DEV__) {
          console.warn(
            `[scroll] gave up after ${MAX_ATTEMPTS} attempts; idx=${idx} ` +
              `measured=${heightCacheRef.current.size}/${flatItems.length} rows`,
          );
        }
        setPendingScrollTarget(null);
      }
    };

    // Slight delay before first attempt — gives FlatList time to commit
    // the new data prop internally before we ask it to scroll. Double rAF
    // alone was insufficient in some cases (in-tree search after large
    // expandToPath; FlatList's _frames not yet built for new rows).
    const initial = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(tick));
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [flatItems, pendingScrollTarget]);

  // ── Bug 2 (scroll position survives segment switch) ─────────────────────
  // The 'tree' segment's FlatList unmounts when user switches to 'key' or
  // 'search' (conditional ternary in render). Save the last-known scroll
  // offset in a ref (survives the unmount — TaxonomyScreen itself stays
  // mounted) and restore it the next time 'tree' becomes active. Skipped
  // when a cross-screen jump is pending — that flow sets pendingScrollTarget
  // and the scroll-to-target effect above handles positioning instead.
  const treeScrollOffsetRef = useRef(0);
  const treeScrollRestoredRef = useRef(false);
  useEffect(() => {
    if (segment !== 'tree' || loading) {
      // Reset the once-per-mount latch so the next 'tree' entry restores again.
      treeScrollRestoredRef.current = false;
      return;
    }
    if (treeScrollRestoredRef.current) return;
    if (pendingScrollTarget || pendingJumpPath) return;
    const offset = treeScrollOffsetRef.current;
    if (offset <= 0) {
      treeScrollRestoredRef.current = true;
      return;
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset, animated: false });
        treeScrollRestoredRef.current = true;
      }),
    );
  }, [segment, loading, pendingScrollTarget, pendingJumpPath]);

  // Smart-routes to the active plot (opens abundance modal) or session.
  const handleQuickAdd = (sp: TaxonSpecies) => {
    addSpecies(taxonSpeciesToSearchResult(sp));
  };

  const handleAddFromSheet = () => {
    if (!activeSpecies) return;
    addSearchHistory(activeSpecies.cname || activeSpecies.name);
    addSpecies(activeSpecies);
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <View className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 pb-3 pt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('tab.species')}</Text>
          {segment === 'tree' ? (
            <Pressable
              onPress={handleCollapseAll}
              disabled={expanded.size === 0}
              hitSlop={6}
              className={`flex-row items-center rounded-full px-3 py-1.5 ${expanded.size === 0 ? 'bg-gray-100 dark:bg-gray-800' : 'bg-blue-50 dark:bg-blue-950/40 active:bg-blue-100 dark:active:bg-blue-900/60'}`}
            >
              <Ionicons
                name="contract-outline"
                size={14}
                color={expanded.size === 0 ? '#9ca3af' : '#2563eb'}
              />
              <Text
                className={`ml-1 text-xs font-medium ${expanded.size === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-blue-700 dark:text-blue-300'}`}
              >
                {t('taxonomy.collapseAll')}{expanded.size > 0 ? ` (${expanded.size})` : ''}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View className="mt-3 flex-row gap-2">
          {(
            [
              { value: 'tree', label: t('taxonomy.tree') },
              { value: 'key', label: t('nav.key') },
              { value: 'search', label: t('taxonomy.search') },
            ] as const
          ).map((opt) => {
            const on = segment === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => handleSwitchSegment(opt.value)}
                className={`flex-1 items-center rounded-lg py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
              >
                <Text className={`text-sm font-medium ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {segment === 'tree' ? (
        loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
            <Text className="mt-3 text-sm text-gray-600 dark:text-gray-400">{loadStage}</Text>
          </View>
        ) : (
          <View className="flex-1">
            <FlatList
              ref={listRef}
              className="flex-1"
              data={flatItems}
              keyExtractor={(item) => item.key}
              getItemLayout={getItemLayout}
              onScroll={(e) => {
                // Record last-known offset so we can restore on segment
                // switch back to 'tree'. Ref write only — no re-render.
                treeScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={32}
              onLayout={(e) => {
                // 真實可視高度，供捲動定位計算 viewPosition 用（取代寫死的 600）。
                treeViewportHeightRef.current = e.nativeEvent.layout.height;
                if (flatListMarkedRef.current.layout) return;
                flatListMarkedRef.current.layout = true;
                perf.measure('taxonomy:flatlist-layout', 'taxonomy:render-start');
              }}
              onContentSizeChange={() => {
                if (flatListMarkedRef.current.content) return;
                flatListMarkedRef.current.content = true;
                perf.measure('taxonomy:flatlist-content-ready', 'taxonomy:render-start');
              }}
              // Perf tuning for taxonomy tree: rows are mostly text + small
              // badges so we can render more per batch. removeClippedSubviews
              // helps on Android (native view recycling); on iOS it can hide
              // rows on fast scroll so we keep it off there.
              initialNumToRender={20}
              maxToRenderPerBatch={10}
              windowSize={10}
              removeClippedSubviews={Platform.OS === 'android'}
              onScrollToIndexFailed={(info) => {
                // With getItemLayout in place this should fire rarely (only
                // if scrollToIndex is called against stale data). Single
                // scrollToOffset using avg + retry; outer multi-attempt
                // tick() will continue from here.
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
                setTimeout(() => {
                  try {
                    listRef.current?.scrollToIndex({
                      index: info.index,
                      animated: false,
                      viewPosition: 0.25,
                    });
                  } catch {
                    // give up; outer multi-attempt loop will retry anyway
                  }
                }, 200);
              }}
              renderItem={({ item }) => {
                if (!flatListMarkedRef.current.firstRow) {
                  flatListMarkedRef.current.firstRow = true;
                  perf.measure('taxonomy:flatlist-first-row', 'taxonomy:render-start');
                }
                // Wrap each row in a measuring View so getItemLayout can use
                // real heights instead of per-kind defaults. onLayout fires
                // once on mount + on size change; the cache is keyed by
                // item.key so it survives re-renders of the same item.
                const measure = (e: { nativeEvent: { layout: { height: number } } }) => {
                  noteRowHeight(item.key, item.kind, Math.round(e.nativeEvent.layout.height));
                };
                let row: React.ReactNode;
                if (item.kind === 'taxon') {
                  row = (
                    <TaxonRow
                      node={item.node}
                      depth={item.depth}
                      expanded={item.expanded}
                      onToggle={() => handleToggle(item.key)}
                      onOpenKeys={openKeysForScope}
                      onLongPress={async () => {
                        const title = item.node.name_c || item.node.name;
                        const actions = taxonCopyActions(item.node);
                        const sub = await showActionSheet({
                          title,
                          options: actions.map((a) => ({ label: a.label })),
                        });
                        if (sub >= 0 && sub < actions.length) {
                          const a = actions[sub];
                          await copyToClipboard(
                            buildTaxonCopyText(item.node, a.mode),
                            a.label,
                          );
                        }
                      }}
                    />
                  );
                } else if (item.kind === 'species') {
                  row = (
                    <SpeciesRow
                      species={item.species}
                      depth={item.depth}
                      onPress={() => setActiveSpecies(taxonSpeciesToSearchResult(item.species))}
                      onLongPress={async () => {
                        const title = item.species.common_name_c || item.species.simple_name;
                        const sr = taxonSpeciesToSearchResult(item.species);
                        const fav = useFavorites.getState().ids.has(sr.taxon_id);
                        const idx = await showActionSheet({
                          title,
                          options: [
                            { label: t('taxonomy.addCurrent') },
                            { label: fav ? t('favorites.remove') : t('favorites.add') },
                            { label: t('session.viewDetails') },
                            { label: t('taxonomy.copyMenu') },
                          ],
                        });
                        if (idx === 0) handleQuickAdd(item.species);
                        else if (idx === 1) {
                          if (fav) {
                            useFavorites.getState().remove(sr.taxon_id);
                            toast(t('favorites.removed'));
                          } else {
                            useFavorites.getState().add(sr);
                            toast(t('favorites.added'));
                          }
                        } else if (idx === 2)
                          setActiveSpecies(taxonSpeciesToSearchResult(item.species));
                        else if (idx === 3) {
                          const actions = speciesCopyActions(item.species);
                          const sub = await showActionSheet({
                            title,
                            options: actions.map((a) => ({ label: a.label })),
                          });
                          if (sub >= 0 && sub < actions.length) {
                            const a = actions[sub];
                            await copyToClipboard(
                              buildSpeciesCopyText(item.species, a.mode),
                              a.label,
                            );
                          }
                        }
                      }}
                    />
                  );
                } else {
                  row = <LoadingRow depth={item.depth} />;
                }
                return <View onLayout={measure}>{row}</View>;
              }}
            />
            <KeyboardStickyView offset={{ opened: tabBarHeight }}>
              <TaxonomySearchBox onPick={handleSearchPick} />
            </KeyboardStickyView>
          </View>
        )
      ) : null}

      {segment === 'key' ? (
        <KeyListView
          initialQuery={keyListPrefill?.q}
          prefillNonce={keyListPrefill?.nonce}
        />
      ) : null}

      {segment === 'search' ? (
        <SpeciesSearchPanel />
      ) : null}

      <LookupResultSheet
        result={activeSpecies}
        onClose={() => setActiveSpecies(null)}
        onAddToSession={handleAddFromSheet}
        addButtonLabel={addTargetLabel}
        onAddLongPress={async () => {
          if (!activeSpecies) return;
          // Await the chooser before dismissing: closing the sheet while the
          // ActionSheet is being presented crashes iOS.
          if (await promptAddDestination(activeSpecies)) setActiveSpecies(null);
        }}
      />
      {addRecordModal}
    </View>
  );
}

/** Mutates the passed maps to load this node's children or species. */
function loadInto(
  node: TaxonNodeData,
  nm: Map<string, TaxonNodeData>,
  cm: Map<string, TaxonNodeData[]>,
  sm: Map<string, TaxonSpecies[]>,
): void {
  const k = nodeKeyFor(node);
  // Children of this node belong to the lineage = (node's ancestors) ∪ (this node).
  const childAncestors: Ancestors = { ...node.ancestors, [node.rank_key]: node.name };
  if (node.child_rank === 'species') {
    const sp = getSpeciesUnder(childAncestors);
    sm.set(k, sp);
    return;
  }
  const children = getTaxonChildren({
    rank: node.child_rank as Rank,
    ancestors: childAncestors,
  });
  cm.set(k, children);
  for (const c of children) nm.set(nodeKeyFor(c), c);
}

function TaxonRow({
  node,
  depth,
  expanded,
  onToggle,
  onLongPress,
  onOpenKeys,
}: {
  node: TaxonNodeData;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onLongPress?: () => void;
  /** Tap on the row's 🔑 chip — switch to 檢索表 segment + pre-filter to
   *  this scope's name so user lands on the matching key(s). */
  onOpenKeys?: (scopeName: string) => void;
}) {
  const { t } = useTranslation();
  // Localize the rank-key at render (data layer stores keys, not labels) so the
  // tree re-localizes on a language switch. Space-separated so e.g. "Phylum 5"
  // (Latin ranks need the gap; CJK reads fine either way).
  const stats = Object.entries(node.stats)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${t('rank.' + k)} ${v}`)
    .join(' · ');

  // 0/1/2 matching keys per scope; rank_key is 'kingdom'/'phylum'/.../'genus'.
  const keys: IdentificationKey[] = getKeysForScope(node.rank_key, node.name);

  return (
    <Pressable
      onPress={onToggle}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
      style={{ paddingLeft: 16 + depth * 14 }}
    >
      <Ionicons
        name={expanded ? 'chevron-down' : 'chevron-forward'}
        size={16}
        color="#6b7280"
        style={{ marginRight: 8 }}
      />
      <View className="flex-1">
        <View className="flex-row items-baseline">
          {node.name_c ? (
            <Text className="text-base font-medium text-gray-900 dark:text-gray-100">{node.name_c}</Text>
          ) : null}
          <Text className={`${node.name_c ? 'ml-1' : ''} text-sm text-gray-700 dark:text-gray-300`}>{node.name}</Text>
          {node.rank_key ? (() => {
            const c = rankColor(node.rank_key);
            return (
              <View className={`ml-2 rounded px-1.5 py-0.5 ${c.bg}`}>
                <Text className={`text-[10px] font-medium ${c.text}`}>{t('rank.' + node.rank_key)}</Text>
              </View>
            );
          })() : null}
          {keys.length > 0 && onOpenKeys ? (
            <View className="ml-2 flex-row items-center">
              {keys.map((k) => (
                <Pressable
                  key={k.id}
                  onPress={(e) => {
                    // Stop the press from bubbling to the row's onToggle.
                    e.stopPropagation();
                    onOpenKeys(k.scope_name);
                  }}
                  hitSlop={6}
                  className="ml-1 active:opacity-60"
                >
                  <Ionicons
                    name="key"
                    size={14}
                    color={k.mode === 'multi_access' ? '#3b82f6' : '#10b981'}
                  />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        {stats ? <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{stats}</Text> : null}
      </View>
    </Pressable>
  );
}

function SpeciesRow({
  species,
  depth,
  onPress,
  onLongPress,
}: {
  species: TaxonSpecies;
  depth: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const isInfraspecific = ['Subspecies', 'Variety', 'Form'].includes(species.rank);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row items-start border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2 active:bg-blue-50 dark:active:bg-blue-900/40"
      style={{ paddingLeft: 16 + depth * 14 }}
    >
      <Ionicons name="leaf-outline" size={14} color="#10b981" style={{ marginRight: 8, marginTop: 3 }} />
      <View className="flex-1">
        <Text className="text-sm text-gray-700 dark:text-gray-300">
          {species.common_name_c ? (
            <Text className="font-medium text-gray-900 dark:text-gray-100">{species.common_name_c} </Text>
          ) : null}
          <ScientificName
            name={species.simple_name}
            kingdom={species.kingdom}
            nomenclature={species.nomenclature_name}
          />
          {species.is_autonym ? (
            <Text className="text-xs italic text-gray-500 dark:text-gray-400"> s.str.</Text>
          ) : null}
        </Text>
        {isInfraspecific ? (() => {
          const c = rankColor(species.rank);
          return (
            <View className={`mt-0.5 self-start rounded px-1.5 py-0.5 ${c.bg}`}>
              <Text className={`text-[10px] font-medium ${c.text}`}>{t('rank.' + species.rank.toLowerCase())}</Text>
            </View>
          );
        })() : null}
      </View>
      <View className="ml-2 flex-row items-center" style={{ marginTop: 2 }}>
        {species.is_endemic === 'true' ? (
          <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('species.endemicShort')}</Text>
        ) : null}
        {(() => {
          const ab = alienBadge(species.alien_type, species.kingdom);
          if (!ab) return null;
          return (
            <Text className={`ml-1.5 text-xs font-medium ${ab.textClass}`}>{ab.shortLabel}</Text>
          );
        })()}
        {species.redlist ? (
          <View className="ml-2">
            <ConservationBadge code={species.redlist} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function LoadingRow({ depth }: { depth: number }) {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2"
      style={{ paddingLeft: 16 + depth * 14 }}
    >
      <ActivityIndicator size="small" />
      <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</Text>
    </View>
  );
}
