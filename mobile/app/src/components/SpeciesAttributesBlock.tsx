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
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import {
  hasAttributes,
  leafPhenologyOptions,
  reproductiveOptions,
  sexOptions,
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
  /** Override the collapsible header's text. The header stays collapsible
   *  either way; omit to use 「進階（物種屬性）」. */
  headerLabel?: string;
};

export function SpeciesAttributesBlock({
  kingdom,
  className,
  value,
  onChange,
  defaultOpen,
  headerLabel,
}: Props) {
  const { t } = useTranslation();
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
        className="flex-row items-center justify-between rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 active:bg-gray-200 dark:active:bg-gray-700"
      >
        <View className="flex-row items-center">
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color="#4b5563" />
          <Text className="ml-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
            {headerLabel ?? t('attr.advanced')}
          </Text>
          {filledCount > 0 ? (
            <View className="ml-2 rounded-full bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5">
              <Text className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{t('attr.filledCount', { count: filledCount })}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {open ? (
        <View className="mt-2 gap-3">
          <FieldRow label={t('attr.sexLabel')}>
            <SingleChipGroup
              options={sexOptions()}
              value={value.sex}
              onChange={(v) => setSingle('sex', v)}
            />
          </FieldRow>

          {isAnimal ? (
            <FieldRow label={t('attr.lifeStageLabel')}>
              <SingleChipGroup
                options={lifeStageOptions(className)}
                value={value.life_stage}
                onChange={(v) => setSingle('life_stage', v)}
              />
            </FieldRow>
          ) : null}

          {isPlant ? (
            <>
              <FieldRow label={t('attr.reproLabel')}>
                <MultiChipGroup
                  options={reproductiveOptions()}
                  value={value.reproductive_condition}
                  onToggle={(v) => toggleMulti('reproductive_condition', v)}
                />
              </FieldRow>
              <FieldRow label={t('attr.leafLabel')}>
                <MultiChipGroup
                  options={leafPhenologyOptions()}
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
      <Text className="mb-1 text-[11px] font-medium text-gray-600 dark:text-gray-400">{label}</Text>
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
            className={`rounded-full border px-3 py-1.5 ${active ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
          >
            <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
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
            className={`rounded-full border px-3 py-1.5 ${active ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'}`}
          >
            <Text className={`text-xs font-medium ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
