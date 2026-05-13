/**
 * Collapsible "進階" block that lets the recorder fill in DwC species
 * attributes (sex, lifeStage, reproductiveCondition, leafPhenology). Fields
 * shown depend on the taxon's kingdom + class:
 *
 *   - Plantae : sex + reproductive_condition + leaf_phenology
 *   - Animalia: sex + life_stage (per-class enum from dwcAttributes)
 *   - other   : sex only (covers Fungi / Protozoa where sex still meaningful)
 *
 * Used by PlotSpeciesValueModal and the session SpeciesDetailSheet so plot
 * and checklist records have the same input UX.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  hasAttributes,
  LEAF_PHENOLOGY_OPTIONS,
  REPRODUCTIVE_OPTIONS,
  SEX_OPTIONS,
  lifeStageOptions,
  toggleMultiValue,
} from '~/lib/dwcAttributes';

/** Attribute values are kept in their normalized in-memory form:
 *    - sex / life_stage  : single value
 *    - reproductive / leaf: array (multi-select; planet can be both 開花 + 結果)
 *
 *  The persistence layer is responsible for (de)serializing the arrays. */
export type SpeciesAttributesDraft = {
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string[];
  leaf_phenology: string[];
};

type Props = {
  kingdom: string | null | undefined;
  className: string | null | undefined;
  value: SpeciesAttributesDraft;
  onChange: (next: SpeciesAttributesDraft) => void;
  /** Default collapsed; auto-expand when any attribute already set. */
  defaultOpen?: boolean;
};

export function SpeciesAttributesBlock({
  kingdom,
  className,
  value,
  onChange,
  defaultOpen,
}: Props) {
  const initial = defaultOpen ?? hasAttributes(value);
  const [open, setOpen] = useState(initial);

  const isPlant = (kingdom || '').toLowerCase() === 'plantae';
  const isAnimal = (kingdom || '').toLowerCase() === 'animalia';

  const setSingle = (key: 'sex' | 'life_stage', next: string) => {
    onChange({ ...value, [key]: value[key] === next ? null : next });
  };

  const toggleMulti = (key: 'reproductive_condition' | 'leaf_phenology', next: string) => {
    onChange({ ...value, [key]: toggleMultiValue(value[key] ?? [], next) });
  };

  const filledCount =
    (value.sex ? 1 : 0) +
    (value.life_stage ? 1 : 0) +
    (value.reproductive_condition.length > 0 ? 1 : 0) +
    (value.leaf_phenology.length > 0 ? 1 : 0);

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center justify-between rounded-lg bg-gray-100 px-3 py-2 active:bg-gray-200"
      >
        <View className="flex-row items-center">
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color="#4b5563" />
          <Text className="ml-1.5 text-xs font-medium text-gray-700">進階（物種屬性）</Text>
          {filledCount > 0 ? (
            <View className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5">
              <Text className="text-[10px] font-medium text-emerald-700">{filledCount} 項</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {open ? (
        <View className="mt-2 gap-3">
          <FieldRow label="性別 (sex)">
            <SingleChipGroup
              options={SEX_OPTIONS}
              value={value.sex}
              onChange={(v) => setSingle('sex', v)}
            />
          </FieldRow>

          {isAnimal ? (
            <FieldRow label="生命階段 (lifeStage)">
              <SingleChipGroup
                options={lifeStageOptions(className)}
                value={value.life_stage}
                onChange={(v) => setSingle('life_stage', v)}
              />
            </FieldRow>
          ) : null}

          {isPlant ? (
            <>
              <FieldRow label="花 / 果 (reproductiveCondition，可複選)">
                <MultiChipGroup
                  options={REPRODUCTIVE_OPTIONS}
                  value={value.reproductive_condition}
                  onToggle={(v) => toggleMulti('reproductive_condition', v)}
                />
              </FieldRow>
              <FieldRow label="葉 (leafPhenology，可複選)">
                <MultiChipGroup
                  options={LEAF_PHENOLOGY_OPTIONS}
                  value={value.leaf_phenology}
                  onToggle={(v) => toggleMulti('leaf_phenology', v)}
                />
              </FieldRow>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="mb-1 text-[11px] font-medium text-gray-600">{label}</Text>
      {children}
    </View>
  );
}

function SingleChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: string | null;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1.5 ${active ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 bg-white'}`}
          >
            <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700'}`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MultiChipGroup<T extends string>({
  options,
  value,
  onToggle,
}: {
  options: Array<{ value: T; label: string }>;
  value: string[];
  onToggle: (v: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt.value);
        return (
          <Pressable
            key={opt.value}
            onPress={() => onToggle(opt.value)}
            className={`rounded-full border px-3 py-1.5 ${active ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 bg-white'}`}
          >
            <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700'}`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
