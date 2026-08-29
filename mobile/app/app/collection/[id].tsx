/**
 * Collection trip (採集行程) detail — the specimens gathered on one outing,
 * shown as a list. Structurally the thin sibling of `app/session/[id].tsx`:
 * a metadata row, a list, and a sticky SearchBox at the bottom.
 *
 * Note there is no single-active conflict handling here. A collection trip is
 * not part of the app-wide single-active invariant, so opening or reopening one
 * never disturbs an in-progress checklist or plot survey.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  addSpecimen,
  deleteSpecimen,
  duplicateRecordNumbers,
  duplicateSpecimen,
  endCollectionTrip,
  getCollectionTrip,
  getProject,
  getSpecimen,
  listSpecimens,
  nextRecordNumber,
  reopenCollectionTrip,
  updateCollectionTrip,
  updateSpecimen,
  updateSpecimenLocation,
  updateSpecimenPhotos,
  type CollectionTrip,
  type Project,
  type SearchResult,
  type SpecimenWithTaxon,
} from '~/db';
import { KeyboardStickyView } from '~/components/KeyboardAvoidingView';
import { ProjectAssignSheet } from '~/components/ProjectAssignSheet';
import { ScientificName } from '~/components/ScientificName';
import { SearchBox } from '~/components/SearchBox';
import { SpecimenDetailSheet, type SpecimenPatch } from '~/components/SpecimenDetailSheet';
import { SurveyorAssignSheet } from '~/components/SurveyorAssignSheet';
import { SwipeRowActions } from '~/components/SwipeRowActions';
import { promptText } from '~/components/TextPromptModal';
import { BackHeaderLeft } from '~/lib/goBack';
import { isoDateTime } from '~/lib/datetime';
import {
  reproductiveLabel,
  leafPhenologyLabel,
  sexLabel,
  lifeStageLabel,
  parseMultiAttribute,
} from '~/lib/dwcAttributes';
import { useToast } from '~/stores/toast';

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

/** DwC species attributes, flattened to one short line for the row. Ordered to
 *  match the detail sheet: sex → life stage → phenology. */
function attributeSummary(sp: SpecimenWithTaxon): string {
  const parts = [
    sexLabel(sp.sex),
    lifeStageLabel(sp.life_stage),
    ...parseMultiAttribute(sp.reproductive_condition).map(reproductiveLabel),
    ...parseMultiAttribute(sp.leaf_phenology).map(leafPhenologyLabel),
  ].filter(Boolean);
  return parts.join('・');
}

function SpecimenRow({
  specimen,
  duplicate,
  onPress,
}: {
  specimen: SpecimenWithTaxon;
  /** This collection number is carried by more than one specimen. */
  duplicate: boolean;
  onPress: () => void;
}) {
  const photos = parsePhotoPaths(specimen.photo_paths);
  const attributes = attributeSummary(specimen);
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      {photos.length > 0 ? (
        <View className="mr-3">
          <Image
            source={{ uri: photos[0] }}
            style={{ width: 44, height: 44, borderRadius: 6 }}
            contentFit="cover"
          />
          {photos.length > 1 ? (
            <View className="absolute -right-1 -top-1 rounded-full bg-gray-900/80 px-1.5">
              <Text className="text-[10px] font-medium text-white">{photos.length}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View className="mr-3 h-11 w-11 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800">
          <Ionicons name="leaf-outline" size={18} color="#94a3b8" />
        </View>
      )}
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {specimen.record_number}
          </Text>
          {duplicate ? (
            <Ionicons name="warning" size={12} color="#d97706" style={{ marginLeft: 3 }} />
          ) : null}
          {specimen.common_name_c ? (
            <Text
              className="ml-2 flex-1 text-base text-gray-900 dark:text-gray-100"
              numberOfLines={1}
            >
              {specimen.common_name_c}
            </Text>
          ) : null}
        </View>
        <ScientificName
          name={specimen.simple_name}
          author={specimen.name_author}
          kingdom={specimen.kingdom}
          rank={specimen.rank}
          className="text-xs text-gray-600 dark:text-gray-400"
          numberOfLines={1}
        />
        <View className="mt-0.5 flex-row items-center">
          <Text className="text-[11px] text-gray-400 dark:text-gray-500">
            {isoDateTime(specimen.collected_at)}
          </Text>
          {specimen.lat !== null ? (
            <Ionicons name="location" size={11} color="#2563eb" style={{ marginLeft: 6 }} />
          ) : null}
          {attributes ? (
            <Text className="ml-2 flex-1 text-[11px] text-emerald-700 dark:text-emerald-400" numberOfLines={1}>
              {attributes}
            </Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
    </Pressable>
  );
}

export default function CollectionTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tripId = Number(id);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);

  const [trip, setTrip] = useState<CollectionTrip | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [specimens, setSpecimens] = useState<SpecimenWithTaxon[]>([]);
  const [active, setActive] = useState<SpecimenWithTaxon | null>(null);
  const [dupNumbers, setDupNumbers] = useState<Set<string>>(new Set());
  // Non-null = the docked SearchBox re-identifies that specimen instead of
  // adding a new one. Lives here because the SearchBox is a screen-level dock;
  // hosting one inside the detail Modal would need its own keyboard handling.
  const [replaceTarget, setReplaceTarget] = useState<SpecimenWithTaxon | null>(null);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [surveyorSheetOpen, setSurveyorSheetOpen] = useState(false);

  const reload = useCallback(() => {
    const tr = getCollectionTrip(tripId);
    setTrip(tr);
    setProject(tr ? getProject(tr.project_id) : null);
    setSpecimens(listSpecimens(tripId));
    setDupNumbers(duplicateRecordNumbers());
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  /** Keep the open sheet in sync after any write. */
  const refreshActive = (specimenId: number) => {
    setActive(getSpecimen(specimenId));
    reload();
  };

  const isActive = trip?.status === 'active';

  const handleAdd = async (result: SearchResult) => {
    if (!result.taxon_id) {
      toast(t('session.noTaxonId'));
      return;
    }
    // Re-identification: keep the collection number (it names the physical
    // gathering) and swap only the determination.
    if (replaceTarget) {
      const target = replaceTarget;
      setReplaceTarget(null);
      updateSpecimen(target.id, { taxon_id: result.taxon_id });
      reload();
      toast(
        t('collection.taxonChanged', {
          number: target.record_number,
          name: result.cname || result.name,
        }),
      );
      return;
    }
    const number = nextRecordNumber().text;
    // A specimen's coordinate is its collecting locality, so stamp the current
    // fix at insert when permission is already granted. Silent on failure — the
    // user can always place the point on the map in the detail sheet.
    let coords: { lat: number; lng: number; accuracy: number | null } | null = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        };
      }
    } catch {
      // no fix — leave the specimen ungeoreferenced
    }
    addSpecimen({
      trip_id: tripId,
      taxon_id: result.taxon_id,
      record_number: number,
      locality: trip?.locality ?? null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      accuracy: coords?.accuracy ?? null,
    });
    reload();
    toast(t('collection.added', { number, name: result.cname || result.name }));
  };

  const handleDuplicate = (specimen: SpecimenWithTaxon) => {
    const id = duplicateSpecimen(specimen.id);
    if (id === null) return;
    reload();
    const created = getSpecimen(id);
    toast(
      t('collection.duplicated', {
        number: created?.record_number ?? '',
        name: specimen.common_name_c || specimen.simple_name,
      }),
    );
  };

  const handleRename = async () => {
    if (!trip) return;
    const name = await promptText({
      title: t('collection.renameTitle'),
      defaultValue: trip.name,
      confirmText: t('common.save'),
    });
    const next = name?.trim();
    if (!next || next === trip.name) return;
    updateCollectionTrip(trip.id, { name: next });
    reload();
  };

  const handleSave = (patch: SpecimenPatch) => {
    if (!active) return;
    updateSpecimen(active.id, patch);
    refreshActive(active.id);
  };

  const handleDelete = (specimen: SpecimenWithTaxon) => {
    Alert.alert(
      t('collection.deleteTitle'),
      t('collection.deleteMsg', { number: specimen.record_number }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deleteSpecimen(specimen.id);
            setActive(null);
            reload();
          },
        },
      ],
    );
  };

  const handleAddPhoto = async (mode: 'camera' | 'library') => {
    if (!active) return;
    try {
      const { captureAndSavePhoto, pickPhotos, buildContextFromSpecimen } = await import(
        '~/lib/photoCapture'
      );
      let newUris: string[] = [];
      if (mode === 'camera') {
        const uri = await captureAndSavePhoto(buildContextFromSpecimen(active));
        if (uri) newUris = [uri];
      } else {
        newUris = await pickPhotos();
      }
      if (newUris.length === 0) return;
      updateSpecimenPhotos(active.id, [...parsePhotoPaths(active.photo_paths), ...newUris]);
      refreshActive(active.id);
    } catch (e) {
      Alert.alert(t('session.photoFailTitle'), e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemovePhoto = (uri: string) => {
    if (!active) return;
    updateSpecimenPhotos(
      active.id,
      parsePhotoPaths(active.photo_paths).filter((u) => u !== uri),
    );
    refreshActive(active.id);
  };

  if (!trip) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Stack.Screen options={{ title: t('collection.title') }} />
        <Text className="text-gray-500 dark:text-gray-400">{t('collection.missing')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-900">
      <Stack.Screen
        options={{
          title: trip.name,
          headerLeft: () => <BackHeaderLeft />,
          headerRight: () => (
            <Pressable
              onPress={() => {
                if (isActive) endCollectionTrip(trip.id);
                else reopenCollectionTrip(trip.id);
                reload();
              }}
              hitSlop={8}
              className="active:opacity-60"
            >
              <Text className="text-base font-medium text-blue-600 dark:text-blue-400">
                {isActive ? t('collection.endTrip') : t('collection.resume')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <View className="flex-1">
        {/* Metadata row: project · collectors · specimen count */}
        <View className="flex-row items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2">
          <Pressable onPress={() => setProjectSheetOpen(true)} hitSlop={8} className="active:opacity-70">
            <Ionicons
              name={project && project.id !== 0 ? 'folder' : 'folder-open-outline'}
              size={18}
              color={project && project.id !== 0 ? '#2563eb' : '#9ca3af'}
            />
          </Pressable>
          <Pressable
            onPress={() => setSurveyorSheetOpen(true)}
            hitSlop={6}
            className="flex-1 flex-row items-center active:opacity-70"
          >
            <Ionicons
              name="people-outline"
              size={14}
              color={trip.recorded_by ? '#2563eb' : '#9ca3af'}
            />
            <Text
              className={`ml-1 flex-1 text-xs ${trip.recorded_by ? 'font-medium text-blue-700 dark:text-blue-300' : 'italic text-gray-500 dark:text-gray-400'}`}
              numberOfLines={1}
            >
              {trip.recorded_by || t('collection.collectorEmpty')}
            </Text>
          </Pressable>
          <Pressable onPress={handleRename} hitSlop={8} className="active:opacity-70">
            <Ionicons name="pencil-outline" size={16} color="#9ca3af" />
          </Pressable>
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {t('collection.specimenCount', { count: specimens.length })}
          </Text>
        </View>
        {replaceTarget ? (
          <View className="flex-row items-center border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2">
            <Ionicons name="swap-horizontal" size={14} color="#d97706" />
            <Text className="ml-2 flex-1 text-xs text-amber-800 dark:text-amber-300" numberOfLines={1}>
              {t('collection.changeTaxonBanner', { number: replaceTarget.record_number })}
            </Text>
            <Pressable onPress={() => setReplaceTarget(null)} hitSlop={8} className="active:opacity-70">
              <Text className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {t('common.cancel')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {specimens.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="leaf-outline" size={56} color="#cbd5e1" />
            <Text className="mt-3 text-center text-base text-gray-700 dark:text-gray-300">
              {t('collection.emptyHint')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={specimens}
            keyExtractor={(sp) => String(sp.id)}
            renderItem={({ item }) => (
              // Destructive action sits last = closest to the swipe origin,
              // per SwipeRowActions' documented convention.
              <SwipeRowActions
                actions={[
                  {
                    label: t('collection.duplicate'),
                    icon: 'copy-outline',
                    color: 'blue',
                    onPress: () => handleDuplicate(item),
                  },
                  {
                    label: t('common.delete'),
                    icon: 'trash-outline',
                    color: 'red',
                    onPress: () => handleDelete(item),
                  },
                ]}
              >
                <SpecimenRow
                  specimen={item}
                  duplicate={dupNumbers.has(item.record_number)}
                  onPress={() => setActive(item)}
                />
              </SwipeRowActions>
            )}
          />
        )}
      </View>

      {isActive || replaceTarget ? (
        // Also shown while re-identifying, so a finished trip's specimen can
        // still be corrected without reopening the whole trip.
        //
        // Sibling of the flex-1 content View, not a child, so the keyboard
        // translation lifts only the search box and not the list.
        // `opened` must equal the chrome sitting BELOW the dock — here the
        // root SafeAreaView's bottom inset. The two are a pair: drop the
        // SafeAreaView and this offset would shove the box behind the keyboard.
        <KeyboardStickyView offset={{ opened: insets.bottom }}>
          <SearchBox onSelect={handleAdd} />
        </KeyboardStickyView>
      ) : null}

      <SpecimenDetailSheet
        specimen={active}
        onClose={() => setActive(null)}
        onSave={handleSave}
        onChangeLocation={(lat, lng, accuracy) => {
          if (!active) return;
          updateSpecimenLocation(active.id, lat, lng, accuracy);
          refreshActive(active.id);
        }}
        onReplaceTaxon={() => {
          if (!active) return;
          setReplaceTarget(active);
          setActive(null);
        }}
        duplicate={active ? dupNumbers.has(active.record_number) : false}
        onDelete={() => {
          if (active) handleDelete(active);
        }}
        onAddPhoto={handleAddPhoto}
        onRemovePhoto={handleRemovePhoto}
      />
      <ProjectAssignSheet
        visible={projectSheetOpen}
        currentProjectId={trip.project_id}
        onCancel={() => setProjectSheetOpen(false)}
        onAssign={(projectId) => {
          setProjectSheetOpen(false);
          updateCollectionTrip(trip.id, { project_id: projectId });
          reload();
        }}
      />
      <SurveyorAssignSheet
        visible={surveyorSheetOpen}
        current={trip.recorded_by ?? ''}
        onCancel={() => setSurveyorSheetOpen(false)}
        onAssign={(v) => {
          setSurveyorSheetOpen(false);
          updateCollectionTrip(trip.id, { recorded_by: v || null });
          reload();
        }}
      />
    </SafeAreaView>
  );
}
