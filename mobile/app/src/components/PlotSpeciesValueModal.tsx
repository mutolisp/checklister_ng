/**
 * Generalized abundance entry modal (Step C, DwC organismQuantity / Type).
 *
 * The user picks a quantity TYPE first (BB / % cover / individuals / DBH /
 * custom) and then enters the matching value. Built-in types dispatch to
 * dedicated input widgets; custom types fall through to a free TEXT input.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhotoGrid, PhotoViewerModal } from './PhotoGrid';
import { showActionSheet } from './ActionSheet';
import { useColorScheme as useNwColorScheme } from 'nativewind';
import type { Layer } from '~/db';
import {
  SpeciesAttributesBlock,
  type SpeciesAttributesDraft,
} from './SpeciesAttributesBlock';
import { EMPTY_DRAFT } from '~/lib/dwcAttributes';
import {
  QUANTITY_TYPES,
  basalArea,
  defaultQuantityTypeFor,
  findQuantityType,
  kindForType,
  parseDbhArray,
  serializeDbhArray,
} from '~/lib/dwcAbundance';

const BB_OPTIONS = ['+', 'r', '1', '2', '3', '4', '5'] as const;

/** Modal-internal draft. The DB columns are organism_quantity + type. */
export type PlotValueDraft = {
  organism_quantity: string | null;
  organism_quantity_type: string | null;
  notes: string | null;
} & SpeciesAttributesDraft;

const EMPTY: PlotValueDraft = {
  organism_quantity: null,
  organism_quantity_type: null,
  notes: null,
  ...EMPTY_DRAFT,
};

type Props = {
  visible: boolean;
  layer: Layer;
  title: string;
  initial?: PlotValueDraft | null;
  kingdom?: string | null;
  className?: string | null;
  /** Plot/layer-suggested default type when starting from blank. */
  defaultType?: string | null;
  /** Existing photo URIs for the record (edit mode only). */
  photoUris?: string[];
  /** Capture / library handlers for the photo section. Parent owns the
   *  capture flow + DB write; omit to hide the section (create mode). */
  onAddPhoto?: (mode: 'camera' | 'library') => void;
  onRemovePhoto?: (uri: string) => void;
  onCancel: () => void;
  onSave: (v: PlotValueDraft) => void;
};

export function PlotSpeciesValueModal({
  visible,
  layer,
  title,
  initial,
  kingdom,
  className,
  defaultType,
  photoUris,
  onAddPhoto,
  onRemovePhoto,
  onCancel,
  onSave,
}: Props) {
  const resolvedDefaultType =
    initial?.organism_quantity_type ?? defaultType ?? defaultQuantityTypeFor(kingdom);

  const [qtyType, setQtyType] = useState<string>(resolvedDefaultType);
  const [bb, setBb] = useState<string | null>(null);
  const [numericValue, setNumericValue] = useState<string>('');
  const [stems, setStems] = useState<number[]>([]);
  const [stemDraft, setStemDraft] = useState('');
  const [customValue, setCustomValue] = useState<string>('');
  const [customType, setCustomType] = useState<string>('');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [attrs, setAttrs] = useState<SpeciesAttributesDraft>({
    sex: initial?.sex ?? null,
    life_stage: initial?.life_stage ?? null,
    reproductive_condition: initial?.reproductive_condition ?? [],
    leaf_phenology: initial?.leaf_phenology ?? [],
  });

  // Rehydrate fields whenever the modal opens or the initial draft changes.
  useEffect(() => {
    if (!visible) return;
    const startType = initial?.organism_quantity_type ?? defaultType ?? defaultQuantityTypeFor(kingdom);
    setQtyType(startType);
    setNotes(initial?.notes ?? '');
    setAttrs({
      sex: initial?.sex ?? null,
      life_stage: initial?.life_stage ?? null,
      reproductive_condition: initial?.reproductive_condition ?? [],
      leaf_phenology: initial?.leaf_phenology ?? [],
    });

    const k = kindForType(startType);
    const qty = initial?.organism_quantity ?? '';
    setBb(k === 'BB' ? qty || null : null);
    setNumericValue(k === 'count' || k === 'percent' ? qty : '');
    setStems(k === 'DBH' ? parseDbhArray(qty) : []);
    setStemDraft('');
    setCustomValue(k === 'custom' ? qty : '');
    setCustomType(k === 'custom' ? startType : '');
  }, [visible, initial, defaultType, kingdom]);

  const currentKind = useMemo(() => kindForType(qtyType), [qtyType]);

  // Reset value fields when the user switches type mid-edit (avoid stale BB
  // carrying over to a numeric type, etc.).
  const handleSwitchType = (next: string) => {
    setQtyType(next);
    const k = kindForType(next);
    if (k !== 'BB') setBb(null);
    if (k !== 'count' && k !== 'percent') setNumericValue('');
    if (k !== 'DBH') {
      setStems([]);
      setStemDraft('');
    }
    if (k !== 'custom') {
      setCustomValue('');
      setCustomType('');
    } else {
      setCustomType('');
    }
  };

  const addStem = () => {
    const n = Number(stemDraft);
    if (!Number.isFinite(n) || n <= 0) return;
    setStems((prev) => [...prev, n]);
    setStemDraft('');
  };
  const removeStem = (idx: number) => setStems((prev) => prev.filter((_, i) => i !== idx));

  const canSave = (() => {
    if (currentKind === 'BB') return bb !== null;
    if (currentKind === 'count' || currentKind === 'percent')
      return numericValue.trim() !== '' && Number.isFinite(Number(numericValue));
    if (currentKind === 'DBH') return stems.length > 0;
    if (currentKind === 'custom')
      return customValue.trim() !== '' && customType.trim() !== '';
    return false;
  })();

  const handleSave = () => {
    const base = { ...EMPTY, ...attrs, notes: notes || null };
    let quantity: string | null = null;
    let type: string | null = qtyType;
    if (currentKind === 'BB') quantity = bb;
    else if (currentKind === 'count' || currentKind === 'percent') quantity = numericValue.trim();
    else if (currentKind === 'DBH') quantity = serializeDbhArray(stems);
    else if (currentKind === 'custom') {
      quantity = customValue.trim();
      type = customType.trim();
    }
    onSave({ ...base, organism_quantity: quantity, organism_quantity_type: type });
  };

  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable
          onPress={onCancel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        {/* `marginTop = insets.top + 16` puts the top of the sheet below the
            Dynamic Island / notch even when the keyboard pushes content up.
            `flex-1` lets the sheet fill the remaining viewport so the inner
            ScrollView's height is properly bounded. */}
        <View
          style={{ marginTop: insets.top + 16 }}
          className="flex-1 rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="flex-1">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>
            {/* Title region is INSIDE the scroll so when content is long, the
                user can scroll the title up out of the way. iOS bottom-sheet
                guidance + the user spec ("做成可以 scroll"). */}
            <KeyboardAwareScrollView
              className="flex-1"
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
              keyboardShouldPersistTaps="handled"
              bottomOffset={24}
            >
              <View className="mb-3 border-b border-gray-100 dark:border-gray-800 pb-3">
                <Text className="text-base font-semibold text-gray-900 dark:text-gray-100" numberOfLines={2}>
                  {title}
                </Text>
                <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">分層 {layer}</Text>
              </View>
              {/* Quantity type picker */}
              <Text className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">豐度單位</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {QUANTITY_TYPES.map((opt) => {
                  const active = qtyType === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => handleSwitchType(opt.value)}
                      className={`rounded-full border px-3 py-1.5 ${active ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
                    >
                      <Text
                        className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => handleSwitchType('__custom__')}
                  className={`rounded-full border px-3 py-1.5 ${currentKind === 'custom' ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
                >
                  <Text
                    className={`text-xs font-medium ${currentKind === 'custom' ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
                  >
                    自定義
                  </Text>
                </Pressable>
              </View>

              {/* Value input switches on kind */}
              <View className="mt-4">
                {currentKind === 'BB' ? <BBInput value={bb} onChange={setBb} /> : null}
                {currentKind === 'percent' ? (
                  <PercentInput value={numericValue} onChange={setNumericValue} />
                ) : null}
                {currentKind === 'count' ? (
                  <CountInput
                    value={numericValue}
                    onChange={setNumericValue}
                    suffix={findQuantityType(qtyType)?.suffix ?? ''}
                  />
                ) : null}
                {currentKind === 'DBH' ? (
                  <DBHInput
                    stems={stems}
                    stemDraft={stemDraft}
                    setStemDraft={setStemDraft}
                    onAdd={addStem}
                    onRemove={removeStem}
                  />
                ) : null}
                {currentKind === 'custom' ? (
                  <CustomInput
                    typeValue={customType}
                    setTypeValue={setCustomType}
                    quantityValue={customValue}
                    setQuantityValue={setCustomValue}
                  />
                ) : null}
              </View>

              <View className="mt-4">
                <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">備註（選填）</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="觀察補述..."
                  placeholderTextColor="#9ca3af"
                  multiline
                  className="min-h-[60px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                />
              </View>

              <View className="mt-4">
                <SpeciesAttributesBlock
                  kingdom={kingdom ?? null}
                  className={className ?? null}
                  value={attrs}
                  onChange={setAttrs}
                />
              </View>

              {onAddPhoto ? (
                <View className="mt-4">
                  <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">照片</Text>
                  <PhotoGrid
                    photos={photoUris ?? []}
                    onView={(idx) => setViewerIndex(idx)}
                    onAdd={async () => {
                      const idx = await showActionSheet({
                        title: '加照片',
                        options: [{ label: '拍照' }, { label: '從相簿選' }],
                      });
                      if (idx === 0) onAddPhoto('camera');
                      else if (idx === 1) onAddPhoto('library');
                    }}
                    onRemove={onRemovePhoto}
                  />
                </View>
              ) : null}

              <View className="h-4" />
            </KeyboardAwareScrollView>

            <View className="flex-row gap-3 border-t border-gray-100 dark:border-gray-800 px-4 py-3">
              <Pressable
                onPress={onCancel}
                className="flex-1 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 py-3 active:bg-gray-200 dark:active:bg-gray-700"
              >
                <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">取消</Text>
              </Pressable>
              <Pressable
                onPress={canSave ? handleSave : undefined}
                className={`flex-1 items-center justify-center rounded-lg py-3 ${canSave ? 'bg-emerald-500 active:bg-emerald-600' : 'bg-gray-200 dark:bg-gray-700'}`}
              >
                <Text className="text-sm font-medium text-white">儲存</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>

      <PhotoViewerModal
        photos={photoUris ?? []}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </Modal>
  );
}

function BBInput({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <View>
      <Text className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Braun-Blanquet 等級</Text>
      <View className="flex-row flex-wrap gap-2">
        {BB_OPTIONS.map((v) => {
          const on = value === v;
          return (
            <Pressable
              key={v}
              onPress={() => onChange(v)}
              className={`h-12 w-12 items-center justify-center rounded-lg ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
            >
              <Text className={`text-lg font-semibold ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {v}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PercentInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View>
      <Text className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">覆蓋度 (%)</Text>
      <View className="flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3">
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="0–100"
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          autoFocus
          className="flex-1 py-3 text-base text-gray-900 dark:text-gray-100"
        />
        <Text className="ml-1 text-sm text-gray-500 dark:text-gray-400">%</Text>
      </View>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {[1, 5, 10, 25, 50, 75].map((v) => (
          <Pressable
            key={v}
            onPress={() => onChange(String(v))}
            className="rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1 active:bg-gray-200 dark:active:bg-gray-700"
          >
            <Text className="text-xs text-gray-700 dark:text-gray-300">{v}%</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CountInput({
  value,
  onChange,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix: string;
}) {
  return (
    <View>
      <Text className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">數量 (organismQuantity)</Text>
      <View className="flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3">
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="輸入個體數"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          autoFocus
          className="flex-1 py-3 text-base text-gray-900 dark:text-gray-100"
        />
        {suffix ? <Text className="ml-1 text-sm text-gray-500 dark:text-gray-400">{suffix}</Text> : null}
      </View>
    </View>
  );
}

function DBHInput({
  stems,
  stemDraft,
  setStemDraft,
  onAdd,
  onRemove,
}: {
  stems: number[];
  stemDraft: string;
  setStemDraft: (s: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  const totalBA = basalArea(stems);
  return (
    <View>
      <Text className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">胸高直徑 (DBH, cm)</Text>
      <View className="flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3">
        <TextInput
          value={stemDraft}
          onChangeText={setStemDraft}
          onSubmitEditing={onAdd}
          placeholder="輸入後按 Enter 或 +"
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          returnKeyType="done"
          autoFocus
          className="flex-1 py-3 text-base text-gray-900 dark:text-gray-100"
        />
        <Pressable
          onPress={onAdd}
          className="rounded-md bg-emerald-500 px-3 py-1.5 active:bg-emerald-600"
        >
          <Ionicons name="add" size={18} color="white" />
        </Pressable>
      </View>
      {stems.length > 0 ? (
        <>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {stems.map((d, idx) => (
              <DbhStemChip key={`${idx}-${d}`} value={d} onRemove={() => onRemove(idx)} />
            ))}
          </View>
          <Text className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            共 {stems.length} 分枝 · BA ≈ {totalBA.toFixed(1)} cm²
          </Text>
        </>
      ) : (
        <Text className="mt-2 text-xs text-gray-400 dark:text-gray-500">尚未輸入分枝</Text>
      )}
    </View>
  );
}

function DbhStemChip({ value, onRemove }: { value: number; onRemove: () => void }) {
  const { colorScheme } = useNwColorScheme();
  const closeColor = colorScheme === 'dark' ? '#ffffff' : '#1e40af';
  return (
    <Pressable
      onLongPress={onRemove}
      delayLongPress={300}
      className="flex-row items-center rounded-full bg-blue-100 dark:bg-blue-900/60 px-3 py-1.5"
    >
      <Text className="text-sm font-medium text-blue-800 dark:text-white">{value} cm</Text>
      <Pressable onPress={onRemove} hitSlop={8} className="ml-1.5">
        <Ionicons name="close-circle" size={16} color={closeColor} />
      </Pressable>
    </Pressable>
  );
}

function CustomInput({
  typeValue,
  setTypeValue,
  quantityValue,
  setQuantityValue,
}: {
  typeValue: string;
  setTypeValue: (s: string) => void;
  quantityValue: string;
  setQuantityValue: (s: string) => void;
}) {
  return (
    <View className="gap-3">
      <View>
        <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          自訂單位 (organismQuantityType)
        </Text>
        <TextInput
          value={typeValue}
          onChangeText={setTypeValue}
          placeholder="例: 莖節數 / 鳴叫次數 / biomass(g)"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3 text-base text-gray-900 dark:text-gray-100"
        />
      </View>
      <View>
        <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">數量 (organismQuantity)</Text>
        <TextInput
          value={quantityValue}
          onChangeText={setQuantityValue}
          placeholder="例: 3 或 1.2 或 abundant"
          placeholderTextColor="#9ca3af"
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3 text-base text-gray-900 dark:text-gray-100"
        />
      </View>
    </View>
  );
}
