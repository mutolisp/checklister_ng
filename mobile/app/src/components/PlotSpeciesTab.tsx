import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Keyboard, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addPlotSpecies,
  deletePlotSpecies,
  getActiveLayers,
  getPlotLayers,
  isStratified,
  layerIndexOf,
  layerKeyForIndex,
  listPlotSpecies,
  parsePhotoPaths,
  type FixedLayer,
  type Layer,
  type PlotLayer,
  type PlotSpeciesRecordWithTaxon,
  type PlotSurvey,
  type SearchResult,
  LAYER_LABEL,
  updatePlotSpeciesLocation,
  updatePlotSpeciesPhotos,
  updatePlotSpeciesValue,
} from '~/db';
import { KeyboardStickyView } from './KeyboardAvoidingView';
import { ScientificName } from './ScientificName';
import { SearchBox } from './SearchBox';
import { SwipeRow } from './SwipeRow';
import { TaxonomyJumpChip } from './TaxonomyJumpChip';
import { PlotSpeciesValueModal, type PlotValueDraft } from './PlotSpeciesValueModal';
import { alienBadge } from '~/lib/conservationColors';
import { parseMultiAttribute, serializeMultiAttribute } from '~/lib/dwcAttributes';
import { useSettings, type RecordSort, type SortDirection } from '~/stores/settings';
import { showActionSheet } from './ActionSheet';
import {
  formatQuantityBadge,
  kindForType,
  legacyMethodToType,
  parseDbhArray,
} from '~/lib/dwcAbundance';

type ValueModalState =
  | { mode: 'create'; taxon: SearchResult; layer: Layer }
  | { mode: 'edit'; record: PlotSpeciesRecordWithTaxon };

export function PlotSpeciesTab({
  plot,
  onChanged,
}: {
  plot: PlotSurvey;
  onChanged: () => void;
}) {
  // `stratified` = fixed plot only (has E1..E6 layers). transect + point_count
  // are non-stratified: a single 'T' bucket, no layer chips/headers. Keep the
  // transect / point-count distinction only for the user-facing copy.
  const stratified = isStratified(plot);
  const isPointCount = plot.plot_type === 'point_count';
  // KSV gap fix: parent plot/[id] wraps in <SafeAreaView edges={['bottom']}>,
  // so KSV's natural bottom sits `insets.bottom` above the screen bottom.
  // Without compensation, the search box floats that gap above the keyboard.
  const insets = useSafeAreaInsets();
  // Active layers (E1..E{layer_count}) for this plot. Recomputed when the user
  // changes layer_count from the env tab. Transect plots: empty (single 'T').
  const activeLayers = useMemo<FixedLayer[]>(
    () => (stratified ? getActiveLayers(plot.layer_count) : []),
    [stratified, plot.layer_count],
  );
  // Default layer: prefer E2 (草本層) for vegetation surveys — that's the
  // most commonly entered layer. If layer_count < 2, fall back to E1.
  const defaultLayer: Layer = !stratified
    ? 'T'
    : (activeLayers.includes('E2' as FixedLayer) ? 'E2' : activeLayers[0]) ?? 'E1';
  const [layer, setLayer] = useState<Layer>(defaultLayer);
  // Sync layer state with activeLayers: if the user lowers layer_count in the
  // env tab below the currently-selected layer (e.g. selected 'E5' then drops
  // count to 3), state would otherwise hold a layer that no chip can switch
  // to. Snap back to the first active layer so the entry path is unambiguous.
  useEffect(() => {
    if (!stratified) return;
    if (activeLayers.length === 0) return;
    if (!activeLayers.includes(layer as FixedLayer)) {
      setLayer(activeLayers[0]);
    }
  }, [activeLayers, layer, stratified]);
  const [records, setRecords] = useState<PlotSpeciesRecordWithTaxon[]>([]);
  const [modal, setModal] = useState<ValueModalState | null>(null);
  // Per-layer method config from plot_survey_layers (used for default
  // abundance unit when opening the modal). Lazy-loaded; refreshed on plot.id.
  const [plotLayers, setPlotLayers] = useState<PlotLayer[]>([]);
  useMemo(() => {
    setPlotLayers(stratified ? getPlotLayers(plot.id) : []);
    return null;
  }, [plot.id, plot.layer_count, stratified]);
  // Remember last entered value per layer for fast batch entry (carries unit
  // + scalar quantity to the next species). Keyed by Layer.
  const [lastValue, setLastValue] = useState<Partial<Record<Layer, PlotValueDraft>>>({});

  const sortOrder = useSettings((s) => s.last_record_sort);
  const sortDir = useSettings((s) => s.last_record_sort_dir);
  const setSetting = useSettings((s) => s.set);

  const reload = useCallback(() => {
    setRecords(listPlotSpecies(plot.id));
  }, [plot.id]);

  // Reload on first mount + when plot changes
  useMemo(() => {
    reload();
    return null;
  }, [reload]);

  const grouped = useMemo(() => {
    const out: Record<Layer, PlotSpeciesRecordWithTaxon[]> = {
      E1: [],
      E2: [],
      E3: [],
      E4: [],
      E5: [],
      E6: [],
      T: [],
    };
    for (const r of records) out[r.layer as Layer]?.push(r);
    // Sort within each layer using the shared user preference.
    const cmp = (a: string, b: string) => a.localeCompare(b);
    const allLayers: Layer[] = stratified ? [...activeLayers, 'T'] : ['T'];
    for (const l of allLayers) {
      const arr = out[l];
      arr.sort((a, b) => {
        switch (sortOrder) {
          case 'cname':
            return cmp(a.common_name_c || a.simple_name, b.common_name_c || b.simple_name);
          case 'name':
            return cmp(a.simple_name, b.simple_name);
          case 'family': {
            const f = cmp(a.family || '', b.family || '');
            return f !== 0 ? f : cmp(a.simple_name, b.simple_name);
          }
          case 'observed':
          default:
            return a.observed_at - b.observed_at;
        }
      });
      if (sortDir === 'desc') arr.reverse();
    }
    return out;
  }, [records, sortOrder, sortDir, activeLayers, stratified]);

  const handlePickSort = async () => {
    const orders: RecordSort[] = ['observed', 'cname', 'name', 'family'];
    const labels: Record<RecordSort, string> = {
      observed: '加入順序',
      cname: '俗名',
      name: '學名',
      family: '科',
    };
    const idx = await showActionSheet({
      title: '排序方式',
      options: orders.map((o) => ({
        label: o === sortOrder ? `${labels[o]}（再點翻轉方向）` : labels[o],
      })),
    });
    if (idx < 0 || idx >= orders.length) return;
    const picked = orders[idx];
    if (picked === sortOrder) {
      setSetting('last_record_sort_dir', sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSetting('last_record_sort', picked);
      setSetting('last_record_sort_dir', picked === 'observed' ? 'desc' : 'asc');
    }
  };

  const handleToggleSortDir = () => {
    setSetting('last_record_sort_dir', sortDir === 'asc' ? 'desc' : 'asc');
  };

  const handleSelect = async (taxon: SearchResult) => {
    // iOS UIKit refuses to present a Modal while the keyboard / Chinese IME
    // composition session is still active. Dismiss first, wait one frame,
    // then mount PlotSpeciesValueModal.
    Keyboard.dismiss();
    if (Platform.OS === 'ios') await new Promise((r) => setTimeout(r, 150));
    setModal({ mode: 'create', taxon, layer });
  };

  const handleSaveValue = (v: PlotValueDraft) => {
    if (!modal) return;
    if (modal.mode === 'create') {
      addPlotSpecies({
        plot_survey_id: plot.id,
        taxon_id: modal.taxon.taxon_id,
        layer: modal.layer,
        organism_quantity: v.organism_quantity,
        organism_quantity_type: v.organism_quantity_type,
        notes: v.notes,
        sex: v.sex,
        life_stage: v.life_stage,
        reproductive_condition: serializeMultiAttribute(v.reproductive_condition),
        leaf_phenology: serializeMultiAttribute(v.leaf_phenology),
        detection_type: v.detection_type,
      });
      // Remember last entry per layer so the next species defaults to the
      // same unit + scalar value. DBH stems & per-individual attributes are
      // wiped to avoid leakage to the next species.
      const kind = kindForType(v.organism_quantity_type);
      setLastValue((prev) => ({
        ...prev,
        [modal.layer]: {
          organism_quantity: kind === 'DBH' ? null : v.organism_quantity,
          organism_quantity_type: v.organism_quantity_type,
          notes: null,
          sex: null,
          life_stage: null,
          reproductive_condition: [],
          leaf_phenology: [],
          detection_type: null,
        },
      }));
    } else {
      updatePlotSpeciesValue(modal.record.id, {
        organism_quantity: v.organism_quantity,
        organism_quantity_type: v.organism_quantity_type,
        notes: v.notes,
        sex: v.sex,
        life_stage: v.life_stage,
        reproductive_condition: serializeMultiAttribute(v.reproductive_condition),
        leaf_phenology: serializeMultiAttribute(v.leaf_phenology),
        detection_type: v.detection_type,
      });
    }
    setModal(null);
    reload();
    onChanged();
  };

  const handleAddPhotoForModal = async (mode: 'camera' | 'library') => {
    if (!modal || modal.mode !== 'edit') return;
    const record = modal.record;
    try {
      const { captureAndSavePhoto, pickPhotos, buildContextFromPlotRecord } = await import(
        '~/lib/photoCapture'
      );
      const ctx = buildContextFromPlotRecord(record);
      let newUris: string[] = [];
      if (mode === 'camera') {
        const uri = await captureAndSavePhoto(ctx);
        if (uri) newUris = [uri];
      } else {
        newUris = await pickPhotos();
      }
      if (newUris.length === 0) return;
      const existing = parsePhotoPaths(record.photo_paths);
      const merged = [...existing, ...newUris];
      updatePlotSpeciesPhotos(record.id, merged);
      // Re-seed modal with updated record so PhotoGrid reflects the new entry
      // without closing the modal.
      const updated = { ...record, photo_paths: JSON.stringify(merged) };
      setModal({ mode: 'edit', record: updated });
      reload();
      onChanged();
    } catch (e) {
      Alert.alert('加照片失敗', e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemovePhotoForModal = (uri: string) => {
    if (!modal || modal.mode !== 'edit') return;
    const record = modal.record;
    const existing = parsePhotoPaths(record.photo_paths);
    const next = existing.filter((u) => u !== uri);
    updatePlotSpeciesPhotos(record.id, next);
    const updated = { ...record, photo_paths: next.length > 0 ? JSON.stringify(next) : null };
    setModal({ mode: 'edit', record: updated });
    reload();
    onChanged();
  };

  // Quick +/- adjust for individuals (count) records straight from the list,
  // without opening the value modal. Clamps to a minimum of 1.
  const handleAdjustQuantity = (r: PlotSpeciesRecordWithTaxon, delta: number) => {
    const cur = Number(r.organism_quantity);
    const base = Number.isFinite(cur) ? cur : 0;
    const next = Math.max(1, base + delta);
    if (next === base) return;
    updatePlotSpeciesValue(r.id, { organism_quantity: String(next) });
    reload();
    onChanged();
  };

  const handleSaveModalLocation = (
    lat: number | null,
    lng: number | null,
    accuracy: number | null,
  ) => {
    if (!modal || modal.mode !== 'edit') return;
    const record = modal.record;
    updatePlotSpeciesLocation(record.id, lat, lng, accuracy);
    // Re-seed modal with updated record so the GPS button reflects the new
    // coords without closing the modal.
    setModal({ mode: 'edit', record: { ...record, lat, lng, accuracy } });
    reload();
    onChanged();
  };

  const handleLongPressRecord = (r: PlotSpeciesRecordWithTaxon) => {
    Alert.alert(r.common_name_c || r.simple_name, undefined, [
      { text: '取消', style: 'cancel' },
      { text: '編輯', onPress: () => setModal({ mode: 'edit', record: r }) },
      {
        text: '刪除',
        style: 'destructive',
        onPress: () => {
          deletePlotSpecies(r.id);
          reload();
          onChanged();
        },
      },
    ]);
  };

  const layerMethodHint = (l: Layer): string | null => {
    if (l === 'T') return null;
    const idx = layerIndexOf(l as FixedLayer);
    const row = plotLayers.find((pl) => pl.layer_index === idx);
    return row ? legacyMethodToType(row.method) : null;
  };

  const modalProps = (() => {
    if (!modal) return null;
    if (modal.mode === 'create') {
      const initial = lastValue[modal.layer] ?? null;
      const taxon = modal.taxon;
      return {
        layer: modal.layer,
        title: `${taxon.cname || ''} ${taxon.name}`.trim(),
        header: {
          cname: taxon.cname ?? '',
          name: taxon.name,
          author: taxon.fullname.replace(taxon.name, '').trim(),
          kingdom: taxon.kingdom ?? '',
          phylum: taxon.phylum ?? '',
          class_name: taxon.class_name ?? '',
          order: taxon.order ?? '',
          family: taxon.family ?? '',
          family_c: taxon.family_cname ?? '',
          genus: taxon.genus ?? '',
        },
        initial,
        kingdom: taxon.kingdom ?? null,
        className: taxon.class_name ?? null,
        // Priority: lastValue.type (user just used) → plot's per-layer method
        // setting → kingdom default (modal-internal fallback).
        defaultType: initial?.organism_quantity_type ?? layerMethodHint(modal.layer),
        // 偵測方式 shown for point count or any animal record.
        showDetection: isPointCount || taxon.kingdom === 'Animalia',
      };
    }
    const r = modal.record;
    return {
      layer: r.layer as Layer,
      title: `${r.common_name_c || ''} ${r.simple_name}`.trim(),
      header: {
        cname: r.common_name_c ?? '',
        name: r.simple_name,
        author: r.name_author ?? '',
        kingdom: r.kingdom ?? '',
        phylum: r.phylum ?? '',
        class_name: r.class ?? '',
        order: r.order ?? '',
        family: r.family ?? '',
        family_c: r.family_c ?? '',
        genus: r.genus ?? '',
      },
      initial: {
        organism_quantity: r.organism_quantity,
        organism_quantity_type: r.organism_quantity_type,
        notes: r.notes,
        sex: r.sex ?? null,
        life_stage: r.life_stage ?? null,
        reproductive_condition: parseMultiAttribute(r.reproductive_condition),
        leaf_phenology: parseMultiAttribute(r.leaf_phenology),
        detection_type: r.detection_type ?? null,
      } satisfies PlotValueDraft,
      kingdom: r.kingdom ?? null,
      className: r.class ?? null,
      defaultType: r.organism_quantity_type ?? null,
      showDetection: isPointCount || r.kingdom === 'Animalia',
    };
  })();

  const SORT_LABEL: Record<RecordSort, string> = {
    observed: '加入順序',
    cname: '俗名',
    name: '學名',
    family: '科',
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      {/* Layer focus chips (fixed plots only) */}
      <View className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <View className="mb-2 flex-row items-center justify-end">
          <Pressable
            onPress={handlePickSort}
            hitSlop={6}
            className="flex-row items-center active:opacity-70"
          >
            <Ionicons name="swap-vertical" size={16} color="#6b7280" />
            <Text className="ml-0.5 text-xs text-gray-600 dark:text-gray-400">
              {SORT_LABEL[sortOrder]}
            </Text>
          </Pressable>
          <Pressable onPress={handleToggleSortDir} hitSlop={6} className="ml-0.5 active:opacity-50">
            <Ionicons
              name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'}
              size={14}
              color="#6b7280"
            />
          </Pressable>
        </View>
        {!stratified ? (
          <Text className="text-[11px] text-gray-500 dark:text-gray-400">
            {isPointCount ? '定點計數記錄' : '穿越線記錄'}
            {grouped['T'].length > 0 ? ` · 已記 ${grouped['T'].length} 筆` : ''}
          </Text>
        ) : (
          <>
            <Text className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">輸入分層</Text>
            {/* Horizontal scrollable chips — supports up to 6 layers (E1-E6)
                without cramping on narrow phones. Each chip is fixed-width so
                ≤4 layers fill the row, 5-6 layers gain horizontal scroll. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 4 }}
            >
              {activeLayers.map((l) => {
                const on = layer === l;
                return (
                  <Pressable
                    key={l}
                    onPress={() => setLayer(l)}
                    className={`items-center justify-center rounded-lg px-4 py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                    style={{ minWidth: 56 }}
                  >
                    <Text className={`text-sm font-bold ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {l}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              {LAYER_LABEL[layer]}
              {grouped[layer].length > 0 ? ` · 已記 ${grouped[layer].length} 筆` : ''}
            </Text>
          </>
        )}
      </View>

      {/* Records grouped by layer */}
      <FlatList
        data={(stratified ? activeLayers : (['T'] as Layer[])).flatMap<
          { kind: 'header'; layer: Layer } | { kind: 'row'; record: PlotSpeciesRecordWithTaxon }
        >((l) => {
          const list = grouped[l];
          if (list.length === 0) return [];
          // 非分層模式（穿越線 / 定點計數）不顯示 header（單一 'T'，已在 chips 區告知）。
          return [
            ...(stratified ? [{ kind: 'header', layer: l } as const] : []),
            ...list.map((r) => ({ kind: 'row', record: r }) as const),
          ];
        })}
        keyExtractor={(item, idx) =>
          item.kind === 'header' ? `h-${item.layer}` : `r-${item.record.id}-${idx}`
        }
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View className="bg-gray-100 dark:bg-gray-800 px-4 py-1.5">
                <Text className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  {LAYER_LABEL[item.layer]} ({grouped[item.layer].length})
                </Text>
              </View>
            );
          }
          return (
            <SwipeRow
              onDelete={() => {
                deletePlotSpecies(item.record.id);
                reload();
                onChanged();
              }}
            >
              <SpeciesRow
                record={item.record}
                onPress={() => setModal({ mode: 'edit', record: item.record })}
                onLongPress={() => handleLongPressRecord(item.record)}
                onAdjust={(d) => handleAdjustQuantity(item.record, d)}
              />
            </SwipeRow>
          );
        }}
        ListEmptyComponent={
          <View className="items-center px-8 py-12">
            <Ionicons name="leaf-outline" size={40} color="#cbd5e1" />
            <Text className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
              {!stratified ? '從下方搜尋加入物種' : '選擇分層後從下方搜尋加入物種'}
            </Text>
          </View>
        }
      />

      {/* SearchBox sticks above the keyboard, follows accessory-bar changes */}
      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <SearchBox onSelect={handleSelect} />
      </KeyboardStickyView>

      {modal && modalProps ? (
        <PlotSpeciesValueModal
          visible
          layer={modalProps.layer}
          title={modalProps.title}
          header={modalProps.header}
          initial={modalProps.initial}
          kingdom={modalProps.kingdom}
          className={modalProps.className}
          defaultType={modalProps.defaultType}
          showDetection={modalProps.showDetection}
          lat={modal.mode === 'edit' ? modal.record.lat : undefined}
          lng={modal.mode === 'edit' ? modal.record.lng : undefined}
          accuracy={modal.mode === 'edit' ? modal.record.accuracy : undefined}
          onSaveLocation={modal.mode === 'edit' ? handleSaveModalLocation : undefined}
          photoUris={
            modal.mode === 'edit' ? parsePhotoPaths(modal.record.photo_paths) : undefined
          }
          onAddPhoto={modal.mode === 'edit' ? handleAddPhotoForModal : undefined}
          onRemovePhoto={modal.mode === 'edit' ? handleRemovePhotoForModal : undefined}
          onCancel={() => setModal(null)}
          onSave={handleSaveValue}
        />
      ) : null}
    </View>
  );
}

function SpeciesRow({
  record,
  onPress,
  onLongPress,
  onAdjust,
}: {
  record: PlotSpeciesRecordWithTaxon;
  onPress: () => void;
  onLongPress: () => void;
  onAdjust?: (delta: number) => void;
}) {
  const ab = alienBadge(record.alien_type, record.kingdom);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row items-start border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <View className="flex-1">
        <View className="flex-row items-center" style={{ flexWrap: 'wrap' }}>
          <Text className="text-sm font-medium text-gray-900 dark:text-gray-100" numberOfLines={1}>
            {record.common_name_c || '(無中文名)'}
          </Text>
          {record.is_endemic === 'true' ? (
            <Text className="ml-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">特</Text>
          ) : null}
          {ab ? (
            <Text className={`ml-1.5 text-[11px] font-medium ${ab.textClass}`}>{ab.shortLabel}</Text>
          ) : null}
          {record.is_hybrid === 'true' ? (
            <Text className="ml-1.5 text-[11px] font-medium text-purple-700 dark:text-purple-300">雜</Text>
          ) : null}
        </View>
        <ScientificName
          name={record.simple_name}
          author={record.name_author}
          kingdom={record.kingdom}
          className="mt-0.5 text-xs text-gray-700 dark:text-gray-300"
          numberOfLines={1}
        />
        {record.family ? (
          <View className="mt-1 self-start">
            <TaxonomyJumpChip
              rank="family"
              lineage={{
                kingdom: record.kingdom,
                phylum: record.phylum,
                class: record.class,
                order: record.order,
                family: record.family,
              }}
              name={record.family}
              nameC={record.family_c}
              compact
            />
          </View>
        ) : null}
        {record.notes ? (
          <Text className="mt-0.5 text-[11px] italic text-gray-500 dark:text-gray-400" numberOfLines={1}>
            {record.notes}
          </Text>
        ) : null}
      </View>
      <View className="ml-3 items-end">
        <ValueBadge record={record} onAdjust={onAdjust} />
      </View>
    </Pressable>
  );
}

function ValueBadge({
  record,
  onAdjust,
}: {
  record: PlotSpeciesRecordWithTaxon;
  onAdjust?: (delta: number) => void;
}) {
  const kind = kindForType(record.organism_quantity_type);
  const badge = formatQuantityBadge(record.organism_quantity, record.organism_quantity_type);

  // Individuals (count): inline +/- stepper for quick field tallying without
  // opening the value modal. Other kinds keep the static badge.
  if (kind === 'count' && onAdjust) {
    return (
      <View className="flex-row items-center">
        <Pressable onPress={() => onAdjust(-1)} hitSlop={10} className="px-1.5 py-1 active:opacity-50">
          <Ionicons name="remove-circle-outline" size={22} color="#ea580c" />
        </Pressable>
        <View className="min-w-[40px] items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1.5">
          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">{badge}</Text>
        </View>
        <Pressable onPress={() => onAdjust(1)} hitSlop={10} className="px-1.5 py-1 active:opacity-50">
          <Ionicons name="add-circle-outline" size={22} color="#ea580c" />
        </Pressable>
      </View>
    );
  }

  // Tone by kind
  const tone =
    kind === 'BB'
      ? { bg: 'bg-emerald-100 dark:bg-emerald-900/60', text: 'text-emerald-700 dark:text-emerald-300' }
      : kind === 'percent'
        ? { bg: 'bg-blue-100 dark:bg-blue-900/60', text: 'text-blue-700 dark:text-blue-300' }
        : kind === 'DBH'
          ? { bg: 'bg-amber-100 dark:bg-amber-900/60', text: 'text-amber-800 dark:text-amber-300' }
          : { bg: 'bg-slate-100', text: 'text-slate-700' };

  if (kind === 'DBH') {
    const stems = parseDbhArray(record.organism_quantity);
    const ba = stems.reduce((s, d) => s + Math.PI * (d / 2) ** 2, 0);
    return (
      <View className={`items-end rounded-md px-2.5 py-1.5 ${tone.bg}`}>
        <Text className={`text-sm font-semibold ${tone.text}`}>{badge}</Text>
        {stems.length > 0 ? (
          <Text className={`text-[10px] ${tone.text}`}>{ba.toFixed(1)} cm²</Text>
        ) : null}
        {stems.length > 0 ? (
          <Text className={`text-[10px] ${tone.text}`} numberOfLines={1}>
            {stems.map((d) => d.toFixed(1)).join(', ')}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className={`rounded-md px-2.5 py-1.5 ${tone.bg}`}>
      <Text className={`text-sm font-semibold ${tone.text}`}>{badge}</Text>
    </View>
  );
}
