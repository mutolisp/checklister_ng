import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { PhotoGrid, PhotoViewerModal } from './PhotoGrid';
import { showActionSheet } from './ActionSheet';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { isoDateTime } from '~/lib/datetime';
import { useRouter } from 'expo-router';
import {
  endemicTagLabel,
  getKeysForScope,
  getSynonyms,
  type IdentificationKey,
  type RecordWithTaxon,
  type Synonym,
} from '~/db';
import { buildSpeciesCopyText, copyToClipboard, speciesCopyActions } from '~/lib/clipboard';
import { alienBadge } from '~/lib/conservationColors';
import { CollapsibleSection, SynonymStatusBadge } from './CollapsibleSection';
import { ConservationBadge } from './ConservationBadge';
import { ScientificName } from './ScientificName';
import { TaxonomyJumpChip } from './TaxonomyJumpChip';
import { NotesEditModal } from './NotesEditModal';
import { RecordLocationMap } from './RecordLocationMap';
import {
  SpeciesAttributesBlock,
  type SpeciesAttributesDraft,
} from './SpeciesAttributesBlock';
import { parseMultiAttribute } from '~/lib/dwcAttributes';

type Props = {
  record: RecordWithTaxon | null;
  onClose: () => void;
  onRemove: () => void;
  /** Called when user saves new notes for the current record. The sheet handles its own NotesEditModal. */
  onSaveNotes: (newNotes: string) => void;
  /** Save / clear per-record GPS coordinates. Pass null to clear. */
  onSaveLocation?: (lat: number | null, lng: number | null, accuracy: number | null) => void;
  /** Live-commit a coordinate edited on the inline map (no toast). Manual map
   *  edits carry no GPS accuracy. Pass alongside onSaveLocation to show the map. */
  onChangeLocation?: (lat: number, lng: number) => void;
  /** Capture or pick a photo for the current record. Parent persists the URI. */
  onAddPhoto?: (mode: 'camera' | 'library') => void;
  /** Remove a single photo URI from the current record. */
  onRemovePhoto?: (uri: string) => void;
  /** Save species attribute changes (sex / lifeStage / reproductive / leaf). */
  onSaveAttributes?: (next: SpeciesAttributesDraft) => void;
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

function externalLinks(record: RecordWithTaxon): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (record.taxon_id) {
    links.push({ label: 'TaiCOL', url: `https://taicol.tw/zh-hant/taxon/${record.taxon_id}` });
  }
  const sciEnc = encodeURIComponent(record.simple_name);
  links.push({ label: 'GBIF', url: `https://www.gbif.org/species/search?q=${sciEnc}` });
  links.push({ label: 'iNaturalist', url: `https://www.inaturalist.org/taxa/search?q=${sciEnc}` });
  links.push({ label: 'Wikispecies', url: `https://species.wikimedia.org/wiki/${sciEnc}` });
  if (record.kingdom === 'Plantae') {
    links.push({ label: 'POWO', url: `https://powo.science.kew.org/?q=${sciEnc}` });
    links.push({ label: 'IPNI', url: `https://www.ipni.org/?q=${sciEnc}` });
  }
  return links;
}

export function SpeciesDetailSheet({
  record,
  onClose,
  onRemove,
  onSaveNotes,
  onSaveLocation,
  onChangeLocation,
  onAddPhoto,
  onRemovePhoto,
  onSaveAttributes,
}: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [parentKeys, setParentKeys] = useState<IdentificationKey[]>([]);

  useEffect(() => {
    if (record?.taxon_id) {
      setSynonyms(getSynonyms(record.taxon_id));
    } else {
      setSynonyms([]);
    }
  }, [record?.taxon_id]);

  // Surface identification keys defined for the record's genus / family
  // ("上一階層"). Each key is shown as a tappable chip that closes this
  // sheet and pushes the user to the key runner.
  useEffect(() => {
    if (!record) {
      setParentKeys([]);
      return;
    }
    const found: IdentificationKey[] = [];
    if (record.genus) found.push(...getKeysForScope('genus', record.genus));
    if (record.family) found.push(...getKeysForScope('family', record.family));
    // Dedupe by id (same key can index via alias on multiple scopes).
    const seen = new Set<number>();
    setParentKeys(
      found.filter((k) => {
        if (seen.has(k.id)) return false;
        seen.add(k.id);
        return true;
      }),
    );
  }, [record]);

  // Reset internal modal when the underlying record changes
  useEffect(() => {
    setNotesModalOpen(false);
    setViewerIndex(null);
  }, [record?.id]);

  if (!record) return null;

  const isEndemic = record.is_endemic === 'true';
  const ab = alienBadge(record.alien_type, record.kingdom);
  const links = externalLinks(record);
  const observedStr = isoDateTime(record.observed_at);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '85%' }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="flex-1">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>
            <View className="flex-row items-start border-b border-gray-100 dark:border-gray-800 px-4 py-3">
              <View className="flex-1">
                <Text selectable className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {record.common_name_c || t('species.noChineseName')}
                </Text>
                <ScientificName
                  name={record.simple_name}
                  author={record.name_author}
                  kingdom={record.kingdom}
                  className="text-sm text-gray-700 dark:text-gray-300"
                  selectable
                />
              </View>
              <Pressable
                onPress={async () => {
                  const actions = speciesCopyActions(record);
                  const idx = await showActionSheet({
                    title: record.common_name_c || record.simple_name,
                    options: actions.map((a) => ({ label: a.label })),
                  });
                  if (idx >= 0 && idx < actions.length) {
                    const a = actions[idx];
                    await copyToClipboard(buildSpeciesCopyText(record, a.mode), a.label);
                  }
                }}
                hitSlop={8}
                className="ml-2"
              >
                <Ionicons name="copy-outline" size={20} color="#6b7280" />
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8} className="ml-2">
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>

            <ScrollView className="flex-1">
              {record.family ? (
                <View className="px-4 py-3">
                  <View className="flex-row flex-wrap items-center gap-2">
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
                      beforeJump={onClose}
                    />
                    {parentKeys.map((k) => (
                      <Pressable
                        key={k.id}
                        onPress={() => {
                          onClose();
                          requestAnimationFrame(() => router.push(`/key/${k.id}`));
                        }}
                        className={`flex-row items-center rounded-full px-2.5 py-1 active:opacity-80 ${
                          k.mode === 'multi_access'
                            ? 'bg-blue-100 dark:bg-blue-900/60'
                            : 'bg-emerald-100 dark:bg-emerald-900/60'
                        }`}
                        hitSlop={4}
                      >
                        <Ionicons
                          name="key"
                          size={12}
                          color={k.mode === 'multi_access' ? '#2563eb' : '#10b981'}
                        />
                        <Text
                          className={`ml-1 text-xs font-medium ${
                            k.mode === 'multi_access'
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {t('nav.key')} ({k.scope_name})
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {record.alternative_name_c ? (
                <Section title={t('species.otherNames')}>
                  <Text selectable className="text-sm text-gray-700 dark:text-gray-300">
                    {splitAltNames(record.alternative_name_c).join('、')}
                  </Text>
                </Section>
              ) : null}

              <Section title={t('species.status')}>
                <View className="flex-row flex-wrap gap-2">
                  {isEndemic ? <Tag color="emerald" label={endemicTagLabel(record.taxon_id)} /> : null}
                  {ab ? (
                    <Tag
                      color={ab.kind === 'invasive' || ab.kind === 'naturalized' ? 'rose' : 'purple'}
                      label={ab.longLabel}
                    />
                  ) : null}
                  {record.is_hybrid === 'true' ? <Tag color="purple" label={t('species.hybrid')} /> : null}
                  {record.is_terrestrial === 'true' ? <Tag color="blue" label={t('species.terrestrial')} /> : null}
                  {record.is_freshwater === 'true' ? <Tag color="blue" label={t('species.freshwater')} /> : null}
                  {record.is_brackish === 'true' ? <Tag color="blue" label={t('species.brackish')} /> : null}
                  {record.is_marine === 'true' ? <Tag color="blue" label={t('species.marine')} /> : null}
                  {record.is_fossil === 'true' ? <Tag color="blue" label={t('species.fossil')} /> : null}
                </View>
              </Section>

              <Section title={t('species.conservation')}>
                <View className="space-y-1">
                  <ConservationBadgeRow label={t('species.redlist')} value={record.redlist} />
                  <ConservationBadgeRow label="IUCN" value={record.iucn} />
                  <ConservationRow label="CITES" value={record.cites} />
                  <ConservationRow label={t('species.protected')} value={record.protected} />
                </View>
              </Section>

              {(() => {
                const nonAccepted = synonyms.filter((s) => s.status !== 'accepted');
                if (nonAccepted.length === 0) return null;
                return (
                  <CollapsibleSection title={t('species.synonyms')} count={nonAccepted.length} defaultOpen={false}>
                    {nonAccepted.map((s, idx) => (
                      <View key={idx} className="flex-row flex-wrap items-baseline">
                        <Text selectable className="text-sm text-gray-700 dark:text-gray-300">
                          {'• '}
                          <ScientificName
                            name={s.scientificName}
                            author={s.authorship}
                            kingdom={record.kingdom}
                            selectable
                          />
                        </Text>
                        <SynonymStatusBadge status={s.status} />
                      </View>
                    ))}
                  </CollapsibleSection>
                );
              })()}

              <Section title={t('species.thisRecord')}>
                <Text selectable className="text-sm text-gray-700 dark:text-gray-300">{t('species.timeLabel', { time: observedStr })}</Text>
                {onAddPhoto ? (
                  <PhotoGrid
                    photos={parsePhotoPaths(record.photo_paths)}
                    onView={(idx) => setViewerIndex(idx)}
                    onAdd={async () => {
                      const idx = await showActionSheet({
                        title: t('species.addPhoto'),
                        options: [{ label: t('species.takePhoto') }, { label: t('species.pickFromAlbum') }],
                      });
                      if (idx === 0) onAddPhoto('camera');
                      else if (idx === 1) onAddPhoto('library');
                    }}
                    onRemove={onRemovePhoto}
                  />
                ) : null}
                <Pressable
                  onPress={() => setNotesModalOpen(true)}
                  className="mt-2 flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 active:bg-gray-50 dark:active:bg-gray-800"
                >
                  <Ionicons name="create-outline" size={18} color="#4b5563" />
                  <Text className="ml-2 flex-1 text-sm text-gray-700 dark:text-gray-300">
                    {record.notes ? record.notes : t('species.addNote')}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
                </Pressable>
                {onSaveLocation ? (
                  <Pressable
                    onPress={async () => {
                      // Tap to capture current GPS; long-press handled via separate clear action.
                      const perm = await Location.requestForegroundPermissionsAsync();
                      if (perm.status !== 'granted') {
                        Alert.alert(t('gps.permTitle'), t('gps.permMsg'));
                        return;
                      }
                      try {
                        const pos = await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced,
                        });
                        onSaveLocation(
                          pos.coords.latitude,
                          pos.coords.longitude,
                          pos.coords.accuracy ?? null,
                        );
                      } catch (e) {
                        Alert.alert(t('gps.posFailTitle'), e instanceof Error ? e.message : String(e));
                      }
                    }}
                    onLongPress={
                      record.lat !== null
                        ? () => {
                            Alert.alert('GPS', undefined, [
                              { text: t('common.cancel'), style: 'cancel' },
                              {
                                text: t('species.clearCoord'),
                                style: 'destructive',
                                onPress: () => onSaveLocation(null, null, null),
                              },
                            ]);
                          }
                        : undefined
                    }
                    className="mt-2 flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 active:bg-gray-50 dark:active:bg-gray-800"
                  >
                    <Ionicons
                      name={record.lat !== null ? 'location' : 'location-outline'}
                      size={18}
                      color={record.lat !== null ? '#2563eb' : '#4b5563'}
                    />
                    <Text className="ml-2 flex-1 text-sm text-gray-700 dark:text-gray-300" selectable>
                      {record.lat !== null && record.lng !== null
                        ? `${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}${
                            record.accuracy !== null
                              ? ` (±${Math.round(record.accuracy)}m)`
                              : ''
                          }`
                        : t('species.locateSpecies')}
                    </Text>
                    <Text className="text-xs text-gray-400 dark:text-gray-500">
                      {record.lat !== null ? t('species.longPressClear') : t('species.tapGps')}
                    </Text>
                  </Pressable>
                ) : null}
                {onSaveLocation && onChangeLocation ? (
                  <RecordLocationMap
                    lat={record.lat}
                    lng={record.lng}
                    onChange={onChangeLocation}
                  />
                ) : null}
                {onSaveAttributes ? (
                  <View className="mt-3">
                    <SpeciesAttributesBlock
                      kingdom={record.kingdom}
                      className={record.class}
                      value={{
                        sex: record.sex ?? null,
                        life_stage: record.life_stage ?? null,
                        reproductive_condition: parseMultiAttribute(record.reproductive_condition),
                        leaf_phenology: parseMultiAttribute(record.leaf_phenology),
                      }}
                      onChange={onSaveAttributes}
                    />
                  </View>
                ) : null}
              </Section>

              <Section title={t('species.externalLinks')}>
                <View className="flex-row flex-wrap gap-2">
                  {links.map((link) => (
                    <Pressable
                      key={link.label}
                      onPress={() => Linking.openURL(link.url)}
                      className="flex-row items-center rounded-full bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 active:bg-blue-100 dark:active:bg-blue-900/60"
                    >
                      <Text className="text-xs font-medium text-blue-700 dark:text-blue-300">{link.label}</Text>
                      <Ionicons name="open-outline" size={12} color="#2563eb" />
                    </Pressable>
                  ))}
                </View>
              </Section>

              <View className="px-4 pb-6 pt-4">
                <Pressable
                  onPress={() => {
                    onRemove();
                    onClose();
                  }}
                  className="flex-row items-center justify-center rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/40 px-4 py-3 active:bg-red-100 dark:active:bg-red-900/60"
                >
                  <Ionicons name="trash-outline" size={18} color="#dc2626" />
                  <Text className="ml-2 text-sm font-medium text-red-700 dark:text-red-400">{t('session.removeFromList')}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>

        <NotesEditModal
          visible={notesModalOpen}
          initialValue={record.notes ?? ''}
          title={record.common_name_c || record.simple_name || t('session.notes')}
          onCancel={() => setNotesModalOpen(false)}
          onSave={(newNotes) => {
            onSaveNotes(newNotes);
            setNotesModalOpen(false);
          }}
        />

        <PhotoViewerModal
          photos={parsePhotoPaths(record.photo_paths)}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</Text>
      {children}
    </View>
  );
}

function splitAltNames(s: string): string[] {
  return s
    .split(/[,、]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const TAG_STYLES: Record<'emerald' | 'blue' | 'purple' | 'rose', { bg: string; text: string }> = {
  emerald: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/60',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/60',
    text: 'text-blue-700 dark:text-blue-300',
  },
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-900/60',
    text: 'text-purple-700 dark:text-purple-300',
  },
  rose: {
    bg: 'bg-rose-100 dark:bg-rose-900/60',
    text: 'text-rose-700 dark:text-rose-300',
  },
};

function Tag({ color, label }: { color: 'emerald' | 'blue' | 'purple' | 'rose'; label: string }) {
  const s = TAG_STYLES[color];
  return (
    <View className={`rounded-full px-2.5 py-1 ${s.bg}`}>
      <Text className={`text-xs font-medium ${s.text}`}>{label}</Text>
    </View>
  );
}

function ConservationRow({ label, value }: { label: string; value: string }) {
  return (
    <Text selectable className="text-sm text-gray-700 dark:text-gray-300">
      {label}：<Text className="font-medium">{value || '–'}</Text>
    </Text>
  );
}

function ConservationBadgeRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center">
      <Text selectable className="text-sm text-gray-700 dark:text-gray-300">{label}：</Text>
      {value ? (
        <ConservationBadge code={value} />
      ) : (
        <Text className="text-sm text-gray-700 dark:text-gray-300">–</Text>
      )}
    </View>
  );
}

