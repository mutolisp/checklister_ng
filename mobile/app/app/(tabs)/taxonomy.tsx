import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import {
  addRecord,
  addSearchHistory,
  getSpeciesUnder,
  getTaxonChildren,
  isTaxonInSession,
  type Rank,
  type SearchResult,
  type TaxonNode as TaxonNodeData,
  type TaxonSearchHit,
  type TaxonSpecies,
} from '~/db';
import { showActionSheet } from '~/components/ActionSheet';
import { LookupResultSheet } from '~/components/LookupResultSheet';
import { ScientificName } from '~/components/ScientificName';
import { SpeciesSearchPanel } from '~/components/SpeciesSearchPanel';
import { TaxonomySearchBox } from '~/components/TaxonomySearchBox';
import { useActiveSession } from '~/stores/activeSession';
import { useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';

type FlatItem =
  | { kind: 'taxon'; key: string; node: TaxonNodeData; depth: number; expanded: boolean }
  | { kind: 'species'; key: string; species: TaxonSpecies; depth: number }
  | { kind: 'loading'; key: string; depth: number };

const nodeKey = (rank: string, name: string) => `${rank}:${name}`;

function flatten(
  roots: TaxonNodeData[],
  expanded: Set<string>,
  childrenMap: Map<string, TaxonNodeData[]>,
  speciesMap: Map<string, TaxonSpecies[]>,
): FlatItem[] {
  const out: FlatItem[] = [];
  function walk(nodes: TaxonNodeData[], depth: number) {
    for (const node of nodes) {
      const key = nodeKey(node.rank_key, node.name);
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
  const tabBarHeight = useBottomTabBarHeight();

  const [segment, setSegment] = useState<'tree' | 'key' | 'search'>('tree');
  const [roots, setRoots] = useState<TaxonNodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodeMap, setNodeMap] = useState<Map<string, TaxonNodeData>>(new Map());
  const [childrenMap, setChildrenMap] = useState<Map<string, TaxonNodeData[]>>(new Map());
  const [speciesMap, setSpeciesMap] = useState<Map<string, TaxonSpecies[]>>(new Map());
  const [activeSpecies, setActiveSpecies] = useState<SearchResult | null>(null);

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
        for (const n of r) m.set(nodeKey(n.rank_key, n.name), n);
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
    // Path entries beyond loaded levels need synthetic nodes derived from search hit.
    for (let i = 0; i < hit.path.length; i++) {
      const p = hit.path[i];
      const k = nodeKey(p.rank, p.value);
      wantExpanded.add(k);

      let node = nm.get(k);
      if (!node) {
        // Synthesize minimal node so we can call loader
        const childRankIdx = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].indexOf(p.rank) + 1;
        const childRank =
          childRankIdx < 6
            ? (['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as Rank[])[childRankIdx]
            : ('species' as const);
        node = {
          name: p.value,
          name_c: '',
          rank: '',
          rank_key: p.rank,
          child_rank: childRank,
          stats: {},
        };
        nm.set(k, node);
      }
      if (!cm.has(k) && !sm.has(k)) loadInto(node, nm, cm, sm);
    }

    setNodeMap(nm);
    setChildrenMap(cm);
    setSpeciesMap(sm);
    setExpanded(wantExpanded);
    persistExpanded(wantExpanded);

    // Compute flat after expansion + scroll to deepest path entry
    const flat = flatten(roots, wantExpanded, cm, sm);
    const target = hit.path[hit.path.length - 1];
    const targetKey = nodeKey(target.rank, target.value);
    const idx = flat.findIndex((item) => item.kind === 'taxon' && item.key === targetKey);
    if (idx >= 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
      }, 120);
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
      toast(`已存在於當前 session：${sp.common_name_c || sp.simple_name}`);
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
    <View className="flex-1 bg-gray-50">
      <View className="border-b border-gray-200 bg-white px-4 pb-3 pt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">物種</Text>
          {segment === 'tree' ? (
            <Pressable
              onPress={handleCollapseAll}
              disabled={expanded.size === 0}
              hitSlop={6}
              className={`flex-row items-center rounded-full px-3 py-1.5 ${expanded.size === 0 ? 'bg-gray-100' : 'bg-blue-50 active:bg-blue-100'}`}
            >
              <Ionicons
                name="contract-outline"
                size={14}
                color={expanded.size === 0 ? '#9ca3af' : '#2563eb'}
              />
              <Text
                className={`ml-1 text-xs font-medium ${expanded.size === 0 ? 'text-gray-400' : 'text-blue-700'}`}
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
                className={`flex-1 items-center rounded-lg py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100'}`}
              >
                <Text className={`text-sm font-medium ${on ? 'text-white' : 'text-gray-700'}`}>
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
            <Text className="mt-3 text-sm text-gray-600">載入分類樹...</Text>
          </View>
        ) : (
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? tabBarHeight : 0}
          >
            <FlatList
              ref={listRef}
              className="flex-1"
              data={flatItems}
              keyExtractor={(item) => item.key}
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  listRef.current?.scrollToOffset({
                    offset: info.averageItemLength * info.index,
                    animated: true,
                  });
                }, 120);
              }}
              renderItem={({ item }) => {
                if (item.kind === 'taxon') {
                  return (
                    <TaxonRow
                      node={item.node}
                      depth={item.depth}
                      expanded={item.expanded}
                      onToggle={() => handleToggle(item.key)}
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
                        const idx = await showActionSheet({
                          title: item.species.common_name_c || item.species.simple_name,
                          options: [
                            { label: '加入當前 session' },
                            { label: '看詳細資訊' },
                          ],
                        });
                        if (idx === 0) handleQuickAdd(item.species);
                        else if (idx === 1)
                          setActiveSpecies(speciesToSearchResult(item.species));
                      }}
                    />
                  );
                }
                return <LoadingRow depth={item.depth} />;
              }}
            />
            <TaxonomySearchBox onPick={handleSearchPick} />
          </KeyboardAvoidingView>
        )
      ) : null}

      {segment === 'key' ? <KeyPlaceholder /> : null}

      {segment === 'search' ? (
        <SpeciesSearchPanel keyboardOffset={tabBarHeight} />
      ) : null}

      <LookupResultSheet
        result={activeSpecies}
        onClose={() => setActiveSpecies(null)}
        onAddToSession={handleAddFromSheet}
      />
    </View>
  );
}

function KeyPlaceholder() {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Ionicons name="key-outline" size={56} color="#cbd5e1" />
      <Text className="mt-3 text-base font-medium text-gray-700">檢索表即將推出</Text>
      <Text className="mt-2 text-center text-sm text-gray-500">
        將支援科 / 屬 dichotomous key 與 multi-access key，目前僅維管束植物資料庫有資料。
      </Text>
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
  const k = nodeKey(node.rank_key, node.name);
  if (node.child_rank === 'species') {
    const sp = getSpeciesUnder(node.rank_key as Rank, node.name);
    sm.set(k, sp);
    return;
  }
  const children = getTaxonChildren({
    rank: node.child_rank as Rank,
    parentRank: node.rank_key as Rank,
    parentValue: node.name,
  });
  cm.set(k, children);
  for (const c of children) nm.set(nodeKey(c.rank_key, c.name), c);
}

function TaxonRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: TaxonNodeData;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stats = Object.entries(node.stats)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}${v}`)
    .join(' · ');

  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3 active:bg-gray-50"
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
            <Text className="text-base font-medium text-gray-900">{node.name_c}</Text>
          ) : null}
          <Text className={`${node.name_c ? 'ml-1' : ''} text-sm text-gray-700`}>{node.name}</Text>
          {node.rank ? (
            <View className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">
              <Text className="text-[10px] font-medium text-gray-600">{node.rank}</Text>
            </View>
          ) : null}
        </View>
        {stats ? <Text className="mt-0.5 text-xs text-gray-500">{stats}</Text> : null}
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
      className="flex-row items-center border-b border-gray-100 bg-white px-4 py-2 active:bg-blue-50"
      style={{ paddingLeft: 16 + depth * 14 }}
    >
      <Ionicons name="leaf-outline" size={14} color="#10b981" style={{ marginRight: 8 }} />
      <View className="flex-1">
        <View className="flex-row items-baseline">
          {species.common_name_c ? (
            <Text className="text-sm font-medium text-gray-900">{species.common_name_c}</Text>
          ) : null}
          <ScientificName
            name={species.simple_name}
            kingdom={species.kingdom}
            nomenclature={species.nomenclature_name}
            className={`${species.common_name_c ? 'ml-1' : ''} text-sm text-gray-700`}
          />
          {species.is_autonym ? (
            <Text className="ml-1 text-xs italic text-gray-500">s.str.</Text>
          ) : null}
        </View>
        {isInfraspecific ? (
          <Text className="text-[10px] text-gray-500">{species.rank}</Text>
        ) : null}
      </View>
      {species.is_endemic === 'true' ? (
        <Text className="ml-2 text-xs text-emerald-700">特有</Text>
      ) : null}
      {species.redlist ? (
        <Text className="ml-2 text-xs text-orange-700">{species.redlist}</Text>
      ) : null}
    </Pressable>
  );
}

function LoadingRow({ depth }: { depth: number }) {
  return (
    <View
      className="flex-row items-center border-b border-gray-100 bg-white px-4 py-2"
      style={{ paddingLeft: 16 + depth * 14 }}
    >
      <ActivityIndicator size="small" />
      <Text className="ml-2 text-xs text-gray-500">載入中...</Text>
    </View>
  );
}
