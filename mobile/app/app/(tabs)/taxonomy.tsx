import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSettings } from '~/stores/settings';
import { useTaxonomyJump } from '~/stores/taxonomyJump';
import { useToast } from '~/stores/toast';

type FlatItem =
  | { kind: 'taxon'; key: string; node: TaxonNodeData; depth: number; expanded: boolean }
  | { kind: 'species'; key: string; species: TaxonSpecies; depth: number }
  | { kind: 'loading'; key: string; depth: number };

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
  const { addSpecies, modal: addRecordModal, targetLabel: addTargetLabel } = useAddToActiveRecord();

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
  const [loadStage, setLoadStage] = useState('載入分類樹...');
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
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  // Row-height cache for getItemLayout. Populated by each row's onLayout the
  // first time it renders, so subsequent scrollToIndex calls have accurate
  // offsets even for previously-unrendered rows. Ref (not state) — onLayout
  // writes do not need to trigger a re-render; FlatList reads the latest map
  // every time it calls getItemLayout.
  const heightCacheRef = useRef<Map<string, number>>(new Map());
  const hydratedRef = useRef(false);
  // FlatList milestone tracking — each fires at most once so we measure the
  // first time the tree actually paints natively. onLayout = wrapper measured;
  // first renderItem call = JS started building rows; onContentSizeChange =
  // native ScrollView received its child views and laid them out (good proxy
  // for "user sees something").
  const flatListMarkedRef = useRef({ layout: false, firstRow: false, content: false });

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
    setLoadStage('載入分類樹...');
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
    toast('已收合所有節點');
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

  // Per-kind row-height defaults for getItemLayout. Used for any row whose
  // actual height has not been measured yet (no onLayout fired). Calibrated
  // by spot-measuring real renders. Note: TaiCOL taxa pretty much always
  // have non-zero stats so the "with stats line" case is dominant, hence the
  // ~60 default for taxon (rather than the 50 median between the two
  // extremes). Slightly biased LOW so first scroll lands BEFORE target
  // (visible below the viewPosition mark) rather than past it (off-screen
  // above). Multi-attempt refines once real measurements land in cache.
  const DEFAULT_ROW_HEIGHT: Record<FlatItem['kind'], number> = {
    taxon: 60,
    species: 40,
    loading: 32,
  };
  const getItemLayout = useCallback(
    (data: ArrayLike<FlatItem> | null | undefined, index: number) => {
      const fallback = DEFAULT_ROW_HEIGHT.taxon;
      if (!data || index < 0) {
        return { length: fallback, offset: 0, index };
      }
      // Sum offsets up to index. O(n) per call but FlatList caches the
      // result and only re-invokes on data change / explicit scrollToIndex;
      // for our list of ~5k items this is <1ms on Hermes.
      const list = data as readonly FlatItem[];
      let offset = 0;
      for (let i = 0; i < index; i++) {
        const it = list[i];
        if (!it) continue;
        offset += heightCacheRef.current.get(it.key) ?? DEFAULT_ROW_HEIGHT[it.kind];
      }
      const item = list[index];
      const length = item
        ? (heightCacheRef.current.get(item.key) ?? DEFAULT_ROW_HEIGHT[item.kind])
        : fallback;
      return { length, offset, index };
    },
    // heightCacheRef is a ref so the callback identity is stable; safe to
    // pass empty deps.
    [],
  );

  /** Cascade-expand the tree along a rank path, then scroll to the deepest
   *  entry. Used by both the in-tab search hit handler and the
   *  cross-screen taxonomy jump (rank chip on SpeciesDetailPanel). */
  const expandToPath = useCallback(
    (path: Array<{ rank: Rank; value: string }>, toastLabel?: string) => {
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
      setPendingScrollKey(targetKey);

      if (toastLabel) toast(`已展開 ${toastLabel}`);
    },
    [roots, expanded, nodeMap, childrenMap, speciesMap, persistExpanded, toast],
  );

  const handleSearchPick = (hit: TaxonSearchHit) => {
    expandToPath(hit.path, hit.cname || hit.name);
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
    if (!pendingScrollKey) return;
    const idx = flatItems.findIndex(
      (item) => item.kind === 'taxon' && item.key === pendingScrollKey,
    );
    if (idx < 0) {
      if (__DEV__) console.log(`[scroll] target key not in flatItems: ${pendingScrollKey}`);
      return;
    }

    let cancelled = false;
    let n = 0;
    const MAX_ATTEMPTS = 8;
    const INTERVAL_MS = 220;
    // Approximation: phone viewport minus segment tabs (~120px) and search
    // box (~60px). We don't need a real value to land at the top quarter —
    // any reasonable number does, and the inaccuracy just shifts the
    // landing band by a row or two.
    const VIEWPORT_HEIGHT_APPROX = 600;
    const VIEW_POSITION = 0.25;

    const tick = () => {
      if (cancelled) return;
      const { offset, length } = getItemLayout(flatItems, idx);
      const targetY = Math.max(
        0,
        offset - VIEW_POSITION * (VIEWPORT_HEIGHT_APPROX - length),
      );
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
        setPendingScrollKey(null);
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
  }, [flatItems, pendingScrollKey, getItemLayout]);

  // ── Bug 2 (scroll position survives segment switch) ─────────────────────
  // The 'tree' segment's FlatList unmounts when user switches to 'key' or
  // 'search' (conditional ternary in render). Save the last-known scroll
  // offset in a ref (survives the unmount — TaxonomyScreen itself stays
  // mounted) and restore it the next time 'tree' becomes active. Skipped
  // when a cross-screen jump is pending — that flow sets pendingScrollKey
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
    if (pendingScrollKey || pendingJumpPath) return;
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
  }, [segment, loading, pendingScrollKey, pendingJumpPath]);

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
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">物種</Text>
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
                全部收合{expanded.size > 0 ? ` (${expanded.size})` : ''}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View className="mt-3 flex-row gap-2">
          {(
            [
              { value: 'tree', label: '分類樹' },
              { value: 'key', label: '檢索表' },
              { value: 'search', label: '搜尋' },
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
              onLayout={() => {
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
                  const h = Math.round(e.nativeEvent.layout.height);
                  if (h > 0 && heightCacheRef.current.get(item.key) !== h) {
                    heightCacheRef.current.set(item.key, h);
                  }
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
                            a.label.replace(/^複製/, ''),
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
                        const idx = await showActionSheet({
                          title,
                          options: [
                            { label: '加入當前記錄' },
                            { label: '看詳細資訊' },
                            { label: '複製...' },
                          ],
                        });
                        if (idx === 0) handleQuickAdd(item.species);
                        else if (idx === 1)
                          setActiveSpecies(taxonSpeciesToSearchResult(item.species));
                        else if (idx === 2) {
                          const actions = speciesCopyActions(item.species);
                          const sub = await showActionSheet({
                            title,
                            options: actions.map((a) => ({ label: a.label })),
                          });
                          if (sub >= 0 && sub < actions.length) {
                            const a = actions[sub];
                            await copyToClipboard(
                              buildSpeciesCopyText(item.species, a.mode),
                              a.label.replace(/^複製/, ''),
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
  const stats = Object.entries(node.stats)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}${v}`)
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
          {node.rank ? (() => {
            const c = rankColor(node.rank);
            return (
              <View className={`ml-2 rounded px-1.5 py-0.5 ${c.bg}`}>
                <Text className={`text-[10px] font-medium ${c.text}`}>{node.rank}</Text>
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
              <Text className={`text-[10px] font-medium ${c.text}`}>{species.rank}</Text>
            </View>
          );
        })() : null}
      </View>
      <View className="ml-2 flex-row items-center" style={{ marginTop: 2 }}>
        {species.is_endemic === 'true' ? (
          <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">特</Text>
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
  return (
    <View
      className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2"
      style={{ paddingLeft: 16 + depth * 14 }}
    >
      <ActivityIndicator size="small" />
      <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400">載入中...</Text>
    </View>
  );
}
