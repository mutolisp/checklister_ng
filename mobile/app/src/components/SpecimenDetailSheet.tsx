/**
 * Specimen detail (標本明細) — the editable form behind a row in a collection
 * trip. Deliberately assembled from the components the plot / session flows
 * already use (RecordLocationMap, PhotoGrid, SpeciesAttributesBlock,
 * SurveyorAssignSheet) so a specimen looks and behaves like every other record.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { showActionSheet } from './ActionSheet';
import { DateTimeField } from './DateTimeField';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isRecordNumberTaken, nextRecordNumber, type SpecimenWithTaxon } from '~/db';
import { parseMultiAttribute, serializeMultiAttribute } from '~/lib/dwcAttributes';
import { PhotoGrid, PhotoViewerModal } from './PhotoGrid';
import { RecordLocationMap } from './RecordLocationMap';
import { ScientificName } from './ScientificName';
import { SurveyorAssignSheet } from './SurveyorAssignSheet';
import {
  SpeciesAttributesBlock,
  type SpeciesAttributesDraft,
} from './SpeciesAttributesBlock';

export type SpecimenPatch = {
  record_number?: string;
  collected_at?: number;
  recorded_by?: string | null;
  locality?: string | null;
  notes?: string | null;
  reproductive_condition?: string | null;
  leaf_phenology?: string | null;
};

type Props = {
  specimen: SpecimenWithTaxon | null;
  onClose: () => void;
  onSave: (patch: SpecimenPatch) => void;
  /** Commit a coordinate. `accuracy` is the GPS uncertainty in metres for a
   *  real fix, or null when the point was placed by hand on the map. */
  onChangeLocation: (lat: number, lng: number, accuracy: number | null) => void;
  onDelete: () => void;
  onAddPhoto: (mode: 'camera' | 'library') => void;
  onRemovePhoto: (uri: string) => void;
  /** Hand off to the trip screen's docked SearchBox to re-identify this
   *  specimen. The sheet closes; the collection number is kept. */
  onReplaceTaxon: () => void;
  /** This number is carried by more than one specimen. */
  duplicate?: boolean;
};

function parsePhotoPaths(s: string | null): string[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    // ignore
  }
  return [];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mt-4">
      <Text className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</Text>
      {children}
    </View>
  );
}

const INPUT_CLASS =
  'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-gray-100';

export function SpecimenDetailSheet({
  specimen,
  onClose,
  onSave,
  onChangeLocation,
  onDelete,
  onAddPhoto,
  onRemovePhoto,
  onReplaceTaxon,
  duplicate,
}: Props) {
  const { t } = useTranslation();
  // SafeAreaView reports 0 inset inside a Modal (separate view hierarchy, no
  // provider) — apply the top inset by hand.
  const insets = useSafeAreaInsets();
  const [number, setNumber] = useState('');
  const [locality, setLocality] = useState('');
  const [notes, setNotes] = useState('');
  const [attrs, setAttrs] = useState<SpeciesAttributesDraft>({
    sex: null,
    life_stage: null,
    reproductive_condition: [],
    leaf_phenology: [],
  });
  const [surveyorOpen, setSurveyorOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Re-seed the drafts only when a DIFFERENT specimen is opened.
  //
  // Keyed on the id on purpose: every save hands back a fresh `specimen` object
  // for the same row, and depending on the object would re-seed mid-edit and
  // wipe whatever the user is currently typing in another field. Do not "fix"
  // this by adding `specimen` to the deps.
  useEffect(() => {
    if (!specimen) return;
    setNumber(specimen.record_number);
    setLocality(specimen.locality ?? '');
    setNotes(specimen.notes ?? '');
    setAttrs({
      sex: null,
      life_stage: null,
      reproductive_condition: parseMultiAttribute(specimen.reproductive_condition),
      leaf_phenology: parseMultiAttribute(specimen.leaf_phenology),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specimen?.id]);

  if (!specimen) return null;

  const photos = parsePhotoPaths(specimen.photo_paths);

  /**
   * Commit a hand-typed collection number.
   *
   * Auto-assigned numbers can't collide (`nextRecordNumber` skips occupied
   * ones), so this is the only path that can create a duplicate. It warns
   * rather than blocks: duplicate sheets of one gathering legitimately share a
   * number, and imported data may already contain repeats.
   */
  const commitNumber = async () => {
    if (!specimen) return;
    const value = number.trim();
    if (!value || value === specimen.record_number) {
      setNumber(specimen.record_number);
      return;
    }
    if (!isRecordNumberTaken(value, specimen.id)) {
      onSave({ record_number: value });
      return;
    }
    const free = nextRecordNumber().text;
    const idx = await showActionSheet({
      title: t('collection.dupTitle'),
      message: t('collection.dupMsg', { number: value }),
      cancelLabel: t('common.cancel'),
      options: [{ label: t('collection.dupUseAnyway') }, { label: t('collection.dupUseNext', { number: free }) }],
    });
    if (idx === 0) onSave({ record_number: value });
    else if (idx === 1) {
      setNumber(free);
      onSave({ record_number: free });
    } else {
      setNumber(specimen.record_number); // cancelled — put the old one back
    }
  };

  const commitAttrs = (next: SpeciesAttributesDraft) => {
    setAttrs(next);
    onSave({
      reproductive_condition: serializeMultiAttribute(next.reproductive_condition),
      leaf_phenology: serializeMultiAttribute(next.leaf_phenology),
    });
  };

  const locateMe = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    // A real fix carries its uncertainty; keep it (DwC coordinateUncertaintyInMeters).
    onChangeLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        className="flex-1 bg-gray-50 dark:bg-gray-900"
        style={{ paddingTop: insets.top }}
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
          <Pressable onPress={onClose} hitSlop={8} className="active:opacity-60">
            <Ionicons name="chevron-down" size={24} color="#6b7280" />
          </Pressable>
          <Text className="flex-1 px-3 text-base font-semibold text-gray-900 dark:text-gray-100" numberOfLines={1}>
            {specimen.record_number}
          </Text>
          <Pressable onPress={onDelete} hitSlop={8} className="active:opacity-60">
            <Ionicons name="trash-outline" size={20} color="#dc2626" />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Species identity */}
          <View className="mt-4 rounded-lg bg-white dark:bg-gray-800 p-3">
            {specimen.common_name_c ? (
              <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {specimen.common_name_c}
              </Text>
            ) : null}
            <ScientificName
              name={specimen.simple_name}
              author={specimen.name_author}
              kingdom={specimen.kingdom}
              rank={specimen.rank}
              className="text-base text-gray-700 dark:text-gray-300"
            />
            {specimen.family ? (
              <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {specimen.family_c ? `${specimen.family_c} (${specimen.family})` : specimen.family}
              </Text>
            ) : null}
            <Pressable
              onPress={onReplaceTaxon}
              hitSlop={6}
              className="mt-2 flex-row items-center self-start active:opacity-70"
            >
              <Ionicons name="swap-horizontal" size={14} color="#2563eb" />
              <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                {t('collection.changeTaxon')}
              </Text>
            </Pressable>
          </View>

          <Field label={t('collection.recordNumber')}>
            <TextInput
              value={number}
              onChangeText={setNumber}
              onBlur={commitNumber}
              autoCapitalize="characters"
              autoCorrect={false}
              className={INPUT_CLASS}
            />
            {duplicate ? (
              <View className="mt-1 flex-row items-center">
                <Ionicons name="warning-outline" size={13} color="#d97706" />
                <Text className="ml-1 text-[11px] text-amber-600 dark:text-amber-500">
                  {t('collection.dupBadge')}
                </Text>
              </View>
            ) : null}
            <Text className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              {t('collection.recordNumberHint')}
            </Text>
          </Field>

          <Field label={t('collection.collectedAt')}>
            <DateTimeField
              value={specimen.collected_at}
              onChange={(ts) => onSave({ collected_at: ts })}
            />
          </Field>

          <Field label={t('collection.collector')}>
            <Pressable
              onPress={() => setSurveyorOpen(true)}
              className="flex-row items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 active:opacity-70"
            >
              <Ionicons
                name="people-outline"
                size={16}
                color={specimen.recorded_by ? '#2563eb' : '#9ca3af'}
              />
              <Text
                className={`ml-2 flex-1 text-base ${specimen.recorded_by ? 'text-gray-900 dark:text-gray-100' : 'italic text-gray-400 dark:text-gray-500'}`}
                numberOfLines={1}
              >
                {specimen.recorded_by || t('collection.collectorEmpty')}
              </Text>
            </Pressable>
          </Field>

          <Field label={t('collection.locality')}>
            <TextInput
              value={locality}
              onChangeText={setLocality}
              onBlur={() => onSave({ locality: locality.trim() || null })}
              placeholder={t('collection.localityPlaceholder')}
              placeholderTextColor="#9ca3af"
              className={INPUT_CLASS}
            />
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                {specimen.lat !== null && specimen.lng !== null
                  ? `${specimen.lat.toFixed(5)}, ${specimen.lng.toFixed(5)}${
                      specimen.accuracy !== null ? ` (±${Math.round(specimen.accuracy)}m)` : ''
                    }`
                  : t('collection.noCoord')}
              </Text>
              <Pressable onPress={locateMe} hitSlop={8} className="flex-row items-center active:opacity-70">
                <Ionicons name="locate" size={14} color="#2563eb" />
                <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                  {t('locMap.locateMe')}
                </Text>
              </Pressable>
            </View>
            <RecordLocationMap
              lat={specimen.lat}
              lng={specimen.lng}
              // Placed by hand — there is no measured uncertainty to record.
              onChange={(lat, lng) => onChangeLocation(lat, lng, null)}
            />
          </Field>

          <Field label={t('collection.phenology')}>
            <SpeciesAttributesBlock
              kingdom={specimen.kingdom}
              className={specimen.class}
              value={attrs}
              onChange={commitAttrs}
              only="phenology"
              headerLabel={t('collection.phenology')}
            />
          </Field>

          <Field label={t('collection.remarks')}>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              onBlur={() => onSave({ notes: notes.trim() || null })}
              placeholder={t('collection.remarksPlaceholder')}
              placeholderTextColor="#9ca3af"
              multiline
              className={`${INPUT_CLASS} min-h-[72px]`}
              textAlignVertical="top"
            />
          </Field>

          <Field label={t('collection.photos')}>
            <PhotoGrid
              photos={photos}
              onAdd={() => onAddPhoto('camera')}
              onView={(i) => setViewerIndex(i)}
              onRemove={onRemovePhoto}
            />
            <Pressable
              onPress={() => onAddPhoto('library')}
              hitSlop={8}
              className="mt-2 flex-row items-center active:opacity-70"
            >
              <Ionicons name="images-outline" size={14} color="#2563eb" />
              <Text className="ml-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                {t('collection.fromLibrary')}
              </Text>
            </Pressable>
          </Field>
        </ScrollView>
      </View>

      <PhotoViewerModal
        photos={photos}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
      <SurveyorAssignSheet
        visible={surveyorOpen}
        current={specimen.recorded_by ?? ''}
        onCancel={() => setSurveyorOpen(false)}
        onAssign={(v) => {
          setSurveyorOpen(false);
          onSave({ recorded_by: v || null });
        }}
      />
    </Modal>
  );
}
