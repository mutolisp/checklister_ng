import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
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
import { KeyboardStickyView } from '~/components/KeyboardAvoidingView';
import {
  addRecord,
  addSearchHistory,
  getKeysForScope,
  getSpeciesUnder,
  getTaxonChildren,
  isTaxonInSession,
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
import { rankColor } from '~/lib/rankColors';
import { useActiveSession } from '~/stores/activeSession';
import { useSettings } from '~/stores/settings';
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
  const session = useActiveSession((s) => s.session);
  const start = useActiveSession((s) => s.start);
  const refreshActive = useActiveSession((s) => s.refresh);
  const toast = useToast((s) => s.show);

  const persistedExpanded = useSettings((s) => s.taxonomy_expanded);
  const setSetting = useSettings((s) => s.set);
  const settingsLoaded = useSettings((s) => s.loaded);

  const [segment, setSegment] = useState<'tree' | 'key' | 'search'>('tree');
  const [roots, setRoots] = useState<TaxonNodeData[]>([]);
  const [loading, setLoading] = useState(true);
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
  const hydratedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      refreshActive();
    }, [refreshActive]),
  );

  // Initial load: roots (kingdoms)
  useEffect(() => {
    setLoading(true);
    try {
      const r = getTaxonChildren({ rank: 'kingdom' });
      setRoots(r);
      setNodeMap((prev) => {
        const m = new Map(prev);
        for (const n of r) m.set(nodeKeyFor(n), n);
        return m;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Hydrate persisted expanded set + cascade-load all referenced nodes
  useEffect(() => {
    if (!settingsLoaded || hydratedRef.current || roots.length === 0) return;
    hydratedRef.current = true;
    if (persistedExpanded.length === 0) return;

    const wantExpanded = new Set(persistedExpanded);
    const nm = new Map(nodeMap);
    const cm = new Map(childrenMap);
    const sm = new Map(speciesMap);

    // Repeated passes: load known-but-not-yet-loaded nodes in expanded set.
    // Each pass may reveal new known nodes via children loading.
    let progress = true;
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

    setNodeMap(nm);
    setChildrenMap(cm);
    setSpeciesMap(sm);
    setExpanded(wantExpanded);
  }, [settingsLoaded, persistedExpanded, roots, nodeMap, childrenMap, speciesMap]);

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
    () => flatten(roots, expanded, childrenMap, speciesMap),
    [roots, expanded, childrenMap, speciesMap],
  );

  const handleSearchPick = (hit: TaxonSearchHit) => {
    if (hit.path.length === 0 || roots.length === 0) return;

    const wantExpanded = new Set(expanded);
    const nm = new Map(nodeMap);
    const cm = new Map(childrenMap);
    const sm = new Map(speciesMap);

    // Cascade: for each path entry, ensure node is known & children loaded.
    // Path entries beyond loaded levels need synthetic nodes derived from
    // search hit. Each synthetic node carries the strict-ancestor lineage
    // (path[0..i-1]) so subsequent SQL filters by full chain — without this
    // a homonym genus like Taiwania (plant vs insect) would mix species.
    for (let i = 0; i < hit.path.length; i++) {
      const p = hit.path[i];
      const ancestors: Ancestors = {};
      for (let j = 0; j < i; j++) ancestors[hit.path[j].rank] = hit.path[j].value;

      const tempNode: TaxonNodeData = {
        name: p.value,
        name_c: '',
        rank: '',
        rank_key: p.rank,
        child_rank: 'species', // overwritten below if not leaf
        stats: {},
        ancestors,
      };
      const k = nodeKeyFor(tempNode);
      wantExpanded.add(k);

      let node = nm.get(k);
      if (!node) {
        const childRankIdx = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].indexOf(p.rank) + 1;
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

    // Compute flat after expansion + scroll to deepest path entry. Build
    // target key from full hit.path so it matches the synthesized node key.
    const flat = flatten(roots, wantExpanded, cm, sm);
    const targetAncestors: Ancestors = {};
    for (let j = 0; j < hit.path.length - 1; j++) {
      targetAncestors[hit.path[j].rank] = hit.path[j].value;
    }
    const target = hit.path[hit.path.length - 1];
    const targetKey = nodeKeyFor({
      rank_key: target.rank,
      name: target.value,
      ancestors: targetAncestors,
    });
    const idx = flat.findIndex((item) => item.kind === 'taxon' && item.key === targetKey);
    if (idx >= 0) {
      // 雙幀延遲，等 setExpanded 觸發的 layout pass 完成。
      // 失敗（目標 row 還沒被 measure）時交給 onScrollToIndexFailed 接手。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          try {
            listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.25 });
          } catch {
            // no-op: onScrollToIndexFailed handles it
          }
        }),
      );
    }

    toast(`已展開 ${hit.cname || hit.name}`);
  };

  const speciesToSearchResult = (sp: TaxonSpecies): SearchResult => ({
    id: 0,
    name: sp.simple_name,
    fullname: sp.name_author ? `${sp.simple_name} ${sp.name_author}` : sp.simple_name,
    cname: sp.common_name_c,
    _raw_cname: sp.common_name_c,
    family: sp.family,
    family_cname: sp.family_c,
    iucn_category: sp.iucn,
    redlist: sp.redlist,
    endemic: sp.is_endemic === 'true' ? 1 : 0,
    source:
      sp.alien_type === 'native'
        ? '原生'
        : sp.alien_type === 'naturalized' || sp.alien_type === 'invasive'
          ? '歸化'
          : sp.alien_type === 'cultured'
            ? sp.kingdom === 'Animalia'
              ? '圈養'
              : '栽培'
            : '',
    alien_type: sp.alien_type,
    pt_name: '',
    taxon_id: sp.taxon_id,
    usage_status: 'accepted',
    alternative_name_c: sp.alternative_name_c,
    kingdom: sp.kingdom,
    kingdom_c: '',
    phylum: sp.phylum,
    phylum_c: '',
    class_name: sp.class,
    class_c: '',
    order: sp.order,
    order_c: '',
    genus: sp.genus,
    genus_c: '',
    nomenclature_name: sp.nomenclature_name,
    cites: sp.cites,
    protected: sp.protected,
    is_hybrid: sp.is_hybrid,
    is_terrestrial: '',
    is_freshwater: '',
    is_brackish: '',
    is_marine: '',
    is_fossil: '',
    alien_status_note: '',
    rank: sp.rank,
    is_autonym: sp.is_autonym,
    is_sensu_lato: false,
  });

  const handleQuickAdd = (sp: TaxonSpecies) => {
    if (!sp.taxon_id) {
      toast('此物種無 taxon_id，無法加入');
      return;
    }
    const target = session ?? start();
    if (isTaxonInSession(target.id, sp.taxon_id)) {
      toast(`已存在於當前記錄：${sp.common_name_c || sp.simple_name}`);
      return;
    }
    addRecord({ session_id: target.id, taxon_id: sp.taxon_id });
    refreshActive();
    toast(`已加入：${sp.common_name_c || sp.simple_name}`);
  };

  const handleAddFromSheet = () => {
    if (!activeSpecies?.taxon_id) {
      toast('此物種無 taxon_id');
      return;
    }
    addSearchHistory(activeSpecies.cname || activeSpecies.name);
    const target = session ?? start();
    if (isTaxonInSession(target.id, activeSpecies.taxon_id)) {
      toast(`已存在：${activeSpecies.cname || activeSpecies.name}`);
      return;
    }
    addRecord({ session_id: target.id, taxon_id: activeSpecies.taxon_id });
    refreshActive();
    toast(`已加入：${activeSpecies.cname || activeSpecies.name}`);
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
                onPress={() => setSegment(opt.value)}
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
            <Text className="mt-3 text-sm text-gray-600 dark:text-gray-400">載入分類樹...</Text>
          </View>
        ) : (
          <View className="flex-1">
            <FlatList
              ref={listRef}
              className="flex-1"
              data={flatItems}
              keyExtractor={(item) => item.key}
              onScrollToIndexFailed={(info) => {
                // 先粗滾到估算 offset，強迫 FlatList 渲染目標附近的 row，
                // 等量到正確高度後再 retry scrollToIndex 做精準定位。
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
                setTimeout(() => {
                  try {
                    listRef.current?.scrollToIndex({
                      index: info.index,
                      animated: true,
                      viewPosition: 0.25,
                    });
                  } catch {
                    // 第二次仍失敗就放棄，避免無限 loop
                  }
                }, 250);
              }}
              renderItem={({ item }) => {
                if (item.kind === 'taxon') {
                  return (
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
                }
                if (item.kind === 'species') {
                  return (
                    <SpeciesRow
                      species={item.species}
                      depth={item.depth}
                      onPress={() => setActiveSpecies(speciesToSearchResult(item.species))}
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
                          setActiveSpecies(speciesToSearchResult(item.species));
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
                }
                return <LoadingRow depth={item.depth} />;
              }}
            />
            <KeyboardStickyView>
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
      />
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
