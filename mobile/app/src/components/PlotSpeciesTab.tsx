import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import {
  addPlotSpecies,
  deletePlotSpecies,
  listPlotSpecies,
  type Layer,
  type PlotSpeciesRecordWithTaxon,
  type PlotSurvey,
  type SearchResult,
  LAYERS,
  LAYER_LABEL,
  updatePlotSpeciesValue,
} from '~/db';
import { ScientificName } from './ScientificName';
import { SearchBox } from './SearchBox';
import { SwipeRow } from './SwipeRow';
import { PlotSpeciesValueModal, type PlotValueDraft } from './PlotSpeciesValueModal';
import { parseMultiAttribute, serializeMultiAttribute } from '~/lib/dwcAttributes';
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
  const isTransect = plot.plot_type === 'transect';
  // Transect plots have no layer concept — every record is stored under 'T'.
  const [layer, setLayer] = useState<Layer>(isTransect ? 'T' : 'E1');
  const [records, setRecords] = useState<PlotSpeciesRecordWithTaxon[]>([]);
  const [modal, setModal] = useState<ValueModalState | null>(null);
  // Remember last entered value per layer for fast batch entry (carries unit
  // + scalar quantity to the next species). Keyed by Layer.
  const [lastValue, setLastValue] = useState<Partial<Record<Layer, PlotValueDraft>>>({});

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
      E0: [],
      E1: [],
      E2: [],
      E3: [],
      T: [],
    };
    for (const r of records) out[r.layer as Layer]?.push(r);
    return out;
  }, [records]);

  const handleSelect = (taxon: SearchResult) => {
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
      });
    }
    setModal(null);
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
    return legacyMethodToType(
      l === 'E0' ? plot.e0_method : l === 'E1' ? plot.e1_method : l === 'E2' ? plot.e2_method : plot.e3_method,
    );
  };

  const modalProps = (() => {
    if (!modal) return null;
    if (modal.mode === 'create') {
      const initial = lastValue[modal.layer] ?? null;
      const taxon = modal.taxon;
      return {
        layer: modal.layer,
        title: `${taxon.cname || ''} ${taxon.name}`.trim(),
        initial,
        kingdom: taxon.kingdom ?? null,
        className: taxon.class_name ?? null,
        // Priority: lastValue.type (user just used) → plot's per-layer method
        // setting → kingdom default (modal-internal fallback).
        defaultType: initial?.organism_quantity_type ?? layerMethodHint(modal.layer),
      };
    }
    const r = modal.record;
    return {
      layer: r.layer as Layer,
      title: `${r.common_name_c || ''} ${r.simple_name}`.trim(),
      initial: {
        organism_quantity: r.organism_quantity,
        organism_quantity_type: r.organism_quantity_type,
        notes: r.notes,
        sex: r.sex ?? null,
        life_stage: r.life_stage ?? null,
        reproductive_condition: parseMultiAttribute(r.reproductive_condition),
        leaf_phenology: parseMultiAttribute(r.leaf_phenology),
      } satisfies PlotValueDraft,
      kingdom: r.kingdom ?? null,
      className: r.class ?? null,
      defaultType: r.organism_quantity_type ?? null,
    };
  })();

  return (
    <View className="flex-1 bg-gray-50">
      {/* Layer focus chips (fixed plots only) */}
      <View className="border-b border-gray-100 bg-white px-4 py-3">
        {isTransect ? (
          <Text className="text-[11px] text-gray-500">
            穿越線記錄
            {grouped['T'].length > 0 ? ` · 已記 ${grouped['T'].length} 筆` : ''}
          </Text>
        ) : (
          <>
            <Text className="mb-1.5 text-xs font-medium text-gray-600">輸入分層</Text>
            <View className="flex-row gap-2">
              {LAYERS.map((l) => {
                const on = layer === l;
                return (
                  <Pressable
                    key={l}
                    onPress={() => setLayer(l)}
                    className={`flex-1 items-center rounded-lg py-2 ${on ? 'bg-emerald-500' : 'bg-gray-100'}`}
                  >
                    <Text className={`text-sm font-bold ${on ? 'text-white' : 'text-gray-700'}`}>
                      {l}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="mt-1.5 text-[11px] text-gray-500">
              {LAYER_LABEL[layer]}
              {grouped[layer].length > 0 ? ` · 已記 ${grouped[layer].length} 筆` : ''}
            </Text>
          </>
        )}
      </View>

      {/* Records grouped by layer */}
      <FlatList
        data={(isTransect ? (['T'] as const) : LAYERS).flatMap<
          { kind: 'header'; layer: Layer } | { kind: 'row'; record: PlotSpeciesRecordWithTaxon }
        >((l) => {
          const list = grouped[l];
          if (list.length === 0) return [];
          // Transect 模式不顯示 header（單一層，已在 chips 區告知）。
          return [
            ...(isTransect
              ? []
              : [{ kind: 'header', layer: l } as const]),
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
              <View className="bg-gray-100 px-4 py-1.5">
                <Text className="text-xs font-semibold text-gray-600">
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
              />
            </SwipeRow>
          );
        }}
        ListEmptyComponent={
          <View className="items-center px-8 py-12">
            <Ionicons name="leaf-outline" size={40} color="#cbd5e1" />
            <Text className="mt-2 text-center text-sm text-gray-500">
              {isTransect ? '從下方搜尋加入物種' : '選擇分層後從下方搜尋加入物種'}
            </Text>
          </View>
        }
      />

      {/* SearchBox pinned at bottom */}
      <SearchBox onSelect={handleSelect} />

      {modal && modalProps ? (
        <PlotSpeciesValueModal
          visible
          layer={modalProps.layer}
          title={modalProps.title}
          initial={modalProps.initial}
          kingdom={modalProps.kingdom}
          className={modalProps.className}
          defaultType={modalProps.defaultType}
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
}: {
  record: PlotSpeciesRecordWithTaxon;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3 active:bg-gray-50"
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
          {record.common_name_c || '(無中文名)'}
        </Text>
        <ScientificName
          name={record.simple_name}
          author={record.name_author}
          kingdom={record.kingdom}
          className="mt-0.5 text-xs text-gray-700"
          numberOfLines={1}
        />
        <Text className="mt-0.5 text-[11px] text-gray-500" numberOfLines={1}>
          {record.family_c} {record.family}
        </Text>
        {record.notes ? (
          <Text className="mt-0.5 text-[11px] italic text-gray-500" numberOfLines={1}>
            {record.notes}
          </Text>
        ) : null}
      </View>
      <View className="ml-3 items-end">
        <ValueBadge record={record} />
      </View>
    </Pressable>
  );
}

function ValueBadge({ record }: { record: PlotSpeciesRecordWithTaxon }) {
  const kind = kindForType(record.organism_quantity_type);
  const badge = formatQuantityBadge(record.organism_quantity, record.organism_quantity_type);

  // Tone by kind
  const tone =
    kind === 'BB'
      ? { bg: 'bg-emerald-100', text: 'text-emerald-700' }
      : kind === 'percent'
        ? { bg: 'bg-blue-100', text: 'text-blue-700' }
        : kind === 'DBH'
          ? { bg: 'bg-amber-100', text: 'text-amber-800' }
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
