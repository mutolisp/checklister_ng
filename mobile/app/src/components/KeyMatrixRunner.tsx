/**
 * Multi-access (matrix) identification key runner.
 *
 * UI layout (方案 A from Step 3b):
 *   ┌────────────────────────────────┐
 *   │ Stack header (scope name)      │
 *   ├────────────────────────────────┤
 *   │  特徵                  重置     │
 *   │  ─ feature list (scroll) ─    │  flex 0.6
 *   ├────────────────────────────────┤
 *   │ 剩 N 種 · 已選 M 條件   清空    │  sticky middle bar
 *   ├────────────────────────────────┤
 *   │  候選                          │
 *   │  ─ candidate list (scroll) ─  │  flex 0.4
 *   └────────────────────────────────┘
 *
 * Filter semantics (per Step 3a):
 *   - Taxon multi-value (`橫走|短直立`)          → OR within feature
 *   - User multi-state per feature               → OR within feature
 *   - Across features                            → AND
 *   - Taxon has no data on a feature             → permissive (don't exclude)
 *   - "不確定" / no selection on a feature       → skip (filter not applied)
 *   - Text features                              → not in filter, candidate display only
 *
 * Performance: all features + taxon_features + taxon info loaded once on
 * mount and indexed in JS Maps. Scopes ≤ ~100 taxa × ~20 features are
 * trivial to filter in pure JS.
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addRecord,
  getKeyTaxonInfo,
  isTaxonInSession,
  listKeyFeatures,
  listKeyTaxonFeatures,
  parseFeatureValues,
  searchByTaxonId,
  type IdentificationKey,
  type KeyFeature,
  type KeyTaxonInfo,
  type SearchResult,
} from '~/db';
import { useActiveSession } from '~/stores/activeSession';
import { useToast } from '~/stores/toast';
import { ConservationBadge } from './ConservationBadge';
import { LookupResultSheet } from './LookupResultSheet';
import { ScientificName } from './ScientificName';

type Props = {
  keyId: number;
  keyData: IdentificationKey;
};

type Selection =
  | { kind: 'categorical'; states: string[] }
  | { kind: 'numeric'; min: number | null; max: number | null };

type TaxonRow = {
  taxon_id: string;
  info: KeyTaxonInfo | null;
  values: Map<number, string[]>;
};

type NumericRange = { min: number; max: number };

function parseNumericRange(raw: string): NumericRange | null {
  const s = (raw || '').trim();
  if (!s) return null;
  // Open-ended comparators: `<5`, `<=5`, `>5`, `>=5`
  if (s.startsWith('<=')) {
    const v = parseFloat(s.slice(2));
    return Number.isFinite(v) ? { min: -Infinity, max: v } : null;
  }
  if (s.startsWith('<')) {
    const v = parseFloat(s.slice(1));
    return Number.isFinite(v) ? { min: -Infinity, max: v } : null;
  }
  if (s.startsWith('>=')) {
    const v = parseFloat(s.slice(2));
    return Number.isFinite(v) ? { min: v, max: Infinity } : null;
  }
  if (s.startsWith('>')) {
    const v = parseFloat(s.slice(1));
    return Number.isFinite(v) ? { min: v, max: Infinity } : null;
  }
  // Range `1-3`, `1–3`, `1~3`
  const range = s.match(/^(-?\d+(?:\.\d+)?)\s*[-–~]\s*(-?\d+(?:\.\d+)?)$/);
  if (range) {
    const a = parseFloat(range[1]);
    const b = parseFloat(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  // Single value
  const v = parseFloat(s);
  if (Number.isFinite(v)) return { min: v, max: v };
  return null;
}

function matchesTaxon(taxon: TaxonRow, selections: Map<number, Selection>): boolean {
  for (const [featureId, sel] of selections) {
    const vals = taxon.values.get(featureId);
    if (!vals || vals.length === 0) continue; // permissive: no data → don't exclude
    if (sel.kind === 'categorical') {
      if (sel.states.length === 0) continue; // empty selection = no filter
      if (!vals.some((v) => sel.states.includes(v))) return false;
    } else {
      // numeric: any taxon range overlaps user range
      const uMin = sel.min ?? -Infinity;
      const uMax = sel.max ?? Infinity;
      if (uMin === -Infinity && uMax === Infinity) continue;
      const overlap = vals.some((v) => {
        const r = parseNumericRange(v);
        if (!r) return false;
        return r.max >= uMin && r.min <= uMax;
      });
      if (!overlap) return false;
    }
  }
  return true;
}

function selectionLabel(sel: Selection | undefined): string {
  if (!sel) return '未選';
  if (sel.kind === 'categorical') {
    if (sel.states.length === 0) return '未選';
    if (sel.states.length <= 2) return sel.states.join(' / ');
    return `${sel.states[0]} 等 ${sel.states.length} 項`;
  }
  const lo = sel.min == null ? '–' : String(sel.min);
  const hi = sel.max == null ? '–' : String(sel.max);
  return `${lo} ~ ${hi}`;
}

function isSelectionActive(sel: Selection | undefined): boolean {
  if (!sel) return false;
  if (sel.kind === 'categorical') return sel.states.length > 0;
  return sel.min != null || sel.max != null;
}

export function KeyMatrixRunner({ keyId, keyData }: Props) {
  const router = useRouter();
  const session = useActiveSession((s) => s.session);
  const startActive = useActiveSession((s) => s.start);
  const refreshActive = useActiveSession((s) => s.refresh);
  const toast = useToast((s) => s.show);

  const [features, setFeatures] = useState<KeyFeature[]>([]);
  const [taxa, setTaxa] = useState<TaxonRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selections, setSelections] = useState<Map<number, Selection>>(new Map());
  const [picker, setPicker] = useState<KeyFeature | null>(null);
  const [activeDetail, setActiveDetail] = useState<SearchResult | null>(null);

  // Load features + taxon-features once, in effect (render-time DB calls
  // have historically crashed Hermes in this app — keep them out of JSX).
  useEffect(() => {
    const feats = listKeyFeatures(keyId);
    const tfRows = listKeyTaxonFeatures(keyId);

    const grouped = new Map<string, Map<number, string[]>>();
    for (const r of tfRows) {
      let perFeat = grouped.get(r.taxon_id);
      if (!perFeat) {
        perFeat = new Map();
        grouped.set(r.taxon_id, perFeat);
      }
      const arr = perFeat.get(r.feature_id) ?? [];
      arr.push(r.value);
      perFeat.set(r.feature_id, arr);
    }

    const ts: TaxonRow[] = [];
    for (const [tid, values] of grouped) {
      ts.push({ taxon_id: tid, info: getKeyTaxonInfo(tid), values });
    }
    // Stable display order: by Chinese name (or sciname fallback) so the
    // candidate list doesn't shuffle as filters change.
    ts.sort((a, b) => {
      const ka = a.info?.common_name_c || a.info?.simple_name || a.taxon_id;
      const kb = b.info?.common_name_c || b.info?.simple_name || b.taxon_id;
      return ka.localeCompare(kb);
    });

    setFeatures(feats);
    setTaxa(ts);
    setLoaded(true);
  }, [keyId]);

  const candidates = useMemo(
    () => taxa.filter((t) => matchesTaxon(t, selections)),
    [taxa, selections],
  );

  const activeCount = useMemo(() => {
    let n = 0;
    for (const sel of selections.values()) if (isSelectionActive(sel)) n++;
    return n;
  }, [selections]);

  const handleSetSelection = (featureId: number, sel: Selection | null) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (sel === null || !isSelectionActive(sel)) next.delete(featureId);
      else next.set(featureId, sel);
      return next;
    });
  };

  const handleReset = () => {
    setSelections(new Map());
  };

  const handleOpenCandidate = (taxonId: string) => {
    const r = searchByTaxonId(taxonId);
    if (r) setActiveDetail(r);
  };

  const handleAddToSession = () => {
    if (!activeDetail?.taxon_id) {
      toast('此物種無 taxon_id');
      return;
    }
    const target = session ?? startActive();
    if (isTaxonInSession(target.id, activeDetail.taxon_id)) {
      toast(`已存在：${activeDetail.cname || activeDetail.name}`);
      return;
    }
    addRecord({ session_id: target.id, taxon_id: activeDetail.taxon_id });
    refreshActive();
    toast(`已加入：${activeDetail.cname || activeDetail.name}`, {
      action: { label: '前往', onPress: () => router.push(`/session/${target.id}` as Href) },
    });
  };

  const headerTitle = keyData.scope_cname
    ? `${keyData.scope_cname} ${keyData.scope_name}`
    : keyData.scope_name;

  if (!loaded) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <Stack.Screen options={{ title: '檢索表' }} />
        <Text className="text-sm text-gray-500 dark:text-gray-400">載入中...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: headerTitle }} />

      {/* Top: feature list (60% height) */}
      <View style={{ flex: 0.6 }} className="bg-white dark:bg-gray-900">
        <View className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            特徵 ({features.length})
          </Text>
          <Pressable
            onPress={handleReset}
            disabled={activeCount === 0}
            hitSlop={6}
            className={`rounded-full px-3 py-1 ${activeCount === 0 ? 'opacity-40' : 'active:bg-gray-100 dark:active:bg-gray-800'}`}
          >
            <Text className="text-xs font-medium text-blue-600 dark:text-blue-400">重置</Text>
          </Pressable>
        </View>
        <ScrollView>
          {features.map((f) => (
            <FeatureRow
              key={f.id}
              feature={f}
              selection={selections.get(f.id)}
              onPress={() => {
                if (f.type === 'text') return; // text features are display-only
                setPicker(f);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Sticky middle bar */}
      <View className="flex-row items-center justify-between border-y border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2">
        <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          剩 {candidates.length} 種
          {activeCount > 0 ? (
            <Text className="font-normal text-gray-600 dark:text-gray-400">  ·  已選 {activeCount} 條件</Text>
          ) : null}
        </Text>
        {activeCount > 0 ? (
          <Pressable onPress={handleReset} hitSlop={6}>
            <Text className="text-xs font-medium text-blue-600 dark:text-blue-400">清空</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Bottom: candidate list (40% height) */}
      <View style={{ flex: 0.4 }} className="bg-white dark:bg-gray-900">
        <ScrollView>
          {candidates.length === 0 ? (
            <View className="items-center justify-center py-8">
              <Ionicons name="search-outline" size={36} color="#9ca3af" />
              <Text className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                沒有符合條件的物種
              </Text>
            </View>
          ) : (
            candidates.map((t) => (
              <CandidateRow
                key={t.taxon_id}
                taxon={t}
                features={features}
                onPress={() => handleOpenCandidate(t.taxon_id)}
              />
            ))
          )}
        </ScrollView>
      </View>

      <StatePickerSheet
        feature={picker}
        selection={picker ? selections.get(picker.id) : undefined}
        taxa={taxa}
        onChange={(sel) => picker && handleSetSelection(picker.id, sel)}
        onClose={() => setPicker(null)}
      />

      <LookupResultSheet
        result={activeDetail}
        onClose={() => setActiveDetail(null)}
        onAddToSession={handleAddToSession}
      />
    </View>
  );
}

function FeatureRow({
  feature,
  selection,
  onPress,
}: {
  feature: KeyFeature;
  selection: Selection | undefined;
  onPress: () => void;
}) {
  const isText = feature.type === 'text';
  const active = isSelectionActive(selection);
  return (
    <Pressable
      onPress={onPress}
      disabled={isText}
      className={`flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${isText ? 'opacity-50' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{feature.name}</Text>
        {isText ? (
          <Text className="text-[11px] text-gray-500 dark:text-gray-400">說明欄位（不參與篩選）</Text>
        ) : (
          <Text className={`text-xs ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {selectionLabel(selection)}
          </Text>
        )}
      </View>
      {!isText ? <Ionicons name="chevron-forward" size={16} color="#9ca3af" /> : null}
    </Pressable>
  );
}

function CandidateRow({
  taxon,
  features,
  onPress,
}: {
  taxon: TaxonRow;
  features: KeyFeature[];
  onPress: () => void;
}) {
  const info = taxon.info;
  // Show text features inline on candidate card so users still see info like 「分布」
  const textFeatureValues: string[] = [];
  for (const f of features) {
    if (f.type !== 'text') continue;
    const vals = taxon.values.get(f.id);
    if (vals && vals.length > 0) textFeatureValues.push(`${f.name}：${vals.join('、')}`);
  }
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-start border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-blue-50 dark:active:bg-blue-900/40"
    >
      <Ionicons name="leaf-outline" size={14} color="#10b981" style={{ marginRight: 8, marginTop: 3 }} />
      <View className="flex-1">
        <Text className="text-sm text-gray-700 dark:text-gray-300">
          {info?.common_name_c ? (
            <Text className="font-medium text-gray-900 dark:text-gray-100">{info.common_name_c} </Text>
          ) : null}
          {info ? (
            <ScientificName
              name={info.simple_name}
              kingdom={info.kingdom}
            />
          ) : (
            <Text className="italic">{taxon.taxon_id}</Text>
          )}
        </Text>
        {textFeatureValues.length > 0 ? (
          <Text className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400" numberOfLines={2}>
            {textFeatureValues.join('  ·  ')}
          </Text>
        ) : null}
      </View>
      <View className="ml-2 flex-row items-center" style={{ marginTop: 2 }}>
        {info?.is_endemic === 'true' ? (
          <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">特</Text>
        ) : null}
        {info?.redlist ? (
          <View className="ml-2">
            <ConservationBadge code={info.redlist} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatePickerSheet({
  feature,
  selection,
  taxa,
  onChange,
  onClose,
}: {
  feature: KeyFeature | null;
  selection: Selection | undefined;
  taxa: TaxonRow[];
  onChange: (sel: Selection | null) => void;
  onClose: () => void;
}) {
  if (!feature) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '75%' }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']}>
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>
            <View className="flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{feature.name}</Text>
              <Pressable onPress={onClose} hitSlop={6}>
                <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">完成</Text>
              </Pressable>
            </View>
            {feature.type === 'categorical' ? (
              <CategoricalPicker feature={feature} selection={selection} onChange={onChange} />
            ) : feature.type === 'numeric' ? (
              <NumericPicker feature={feature} selection={selection} taxa={taxa} onChange={onChange} />
            ) : null}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function CategoricalPicker({
  feature,
  selection,
  onChange,
}: {
  feature: KeyFeature;
  selection: Selection | undefined;
  onChange: (sel: Selection | null) => void;
}) {
  const values = parseFeatureValues(feature.values_json);
  const selected = selection?.kind === 'categorical' ? selection.states : [];

  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.length === 0 ? null : { kind: 'categorical', states: next });
  };

  return (
    <View>
      <ScrollView className="max-h-96 px-4 py-3">
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {values.map((v) => {
            const on = selected.includes(v);
            return (
              <Pressable
                key={v}
                onPress={() => toggle(v)}
                className={`rounded-full border px-3 py-2 ${on ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 active:bg-gray-50 dark:active:bg-gray-800'}`}
              >
                <Text className={`text-sm ${on ? 'text-white font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{v}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View className="flex-row items-center justify-between border-t border-gray-100 dark:border-gray-800 px-4 py-3">
        <Pressable
          onPress={() => onChange(null)}
          className="rounded-full px-3 py-2 active:bg-gray-100 dark:active:bg-gray-800"
        >
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">不確定 / 清除</Text>
        </Pressable>
        <Pressable
          onPress={() => onChange({ kind: 'categorical', states: [...values] })}
          className="rounded-full px-3 py-2 active:bg-gray-100 dark:active:bg-gray-800"
        >
          <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">全選</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NumericPicker({
  feature,
  selection,
  taxa,
  onChange,
}: {
  feature: KeyFeature;
  selection: Selection | undefined;
  taxa: TaxonRow[];
  onChange: (sel: Selection | null) => void;
}) {
  // Show the observed taxa range as a hint so the user knows the sensible
  // input bounds (e.g. 「現有資料：< 1 ~ 20」for tree-height in metres).
  const allRanges: NumericRange[] = [];
  for (const t of taxa) {
    const vals = t.values.get(feature.id);
    if (!vals) continue;
    for (const v of vals) {
      const r = parseNumericRange(v);
      if (r) allRanges.push(r);
    }
  }
  let dataMin: number | null = null;
  let dataMax: number | null = null;
  for (const r of allRanges) {
    if (Number.isFinite(r.min) && (dataMin == null || r.min < dataMin)) dataMin = r.min;
    if (Number.isFinite(r.max) && (dataMax == null || r.max > dataMax)) dataMax = r.max;
  }

  const cur = selection?.kind === 'numeric' ? selection : { min: null, max: null };
  const [minStr, setMinStr] = useState<string>(cur.min == null ? '' : String(cur.min));
  const [maxStr, setMaxStr] = useState<string>(cur.max == null ? '' : String(cur.max));

  const apply = () => {
    const min = minStr.trim() === '' ? null : parseFloat(minStr);
    const max = maxStr.trim() === '' ? null : parseFloat(maxStr);
    const minN = Number.isFinite(min as number) ? (min as number) : null;
    const maxN = Number.isFinite(max as number) ? (max as number) : null;
    if (minN == null && maxN == null) onChange(null);
    else onChange({ kind: 'numeric', min: minN, max: maxN });
  };

  return (
    <View className="px-4 py-4">
      {dataMin != null || dataMax != null ? (
        <Text className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          現有資料範圍：{dataMin == null ? '–' : dataMin} ~ {dataMax == null ? '–' : dataMax}
        </Text>
      ) : null}
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <View className="flex-1">
          <Text className="mb-1 text-xs text-gray-500 dark:text-gray-400">下限</Text>
          <TextInput
            value={minStr}
            onChangeText={setMinStr}
            onEndEditing={apply}
            keyboardType="numeric"
            placeholder="不限"
            placeholderTextColor="#9ca3af"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
          />
        </View>
        <Text className="text-gray-400 dark:text-gray-500">~</Text>
        <View className="flex-1">
          <Text className="mb-1 text-xs text-gray-500 dark:text-gray-400">上限</Text>
          <TextInput
            value={maxStr}
            onChangeText={setMaxStr}
            onEndEditing={apply}
            keyboardType="numeric"
            placeholder="不限"
            placeholderTextColor="#9ca3af"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base text-gray-900 dark:text-gray-100"
          />
        </View>
      </View>
      <View className="mt-4 flex-row items-center justify-between">
        <Pressable
          onPress={() => {
            setMinStr('');
            setMaxStr('');
            onChange(null);
          }}
          className="rounded-full px-3 py-2 active:bg-gray-100 dark:active:bg-gray-800"
        >
          <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">不確定 / 清除</Text>
        </Pressable>
        <Pressable onPress={apply} className="rounded-full bg-blue-500 px-4 py-2 active:bg-blue-600">
          <Text className="text-sm font-medium text-white">套用</Text>
        </Pressable>
      </View>
    </View>
  );
}
