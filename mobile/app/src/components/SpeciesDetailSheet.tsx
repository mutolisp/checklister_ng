import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { showActionSheet } from './ActionSheet';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSynonyms, type RecordWithTaxon, type Synonym } from '~/db';
import { ScientificName } from './ScientificName';
import { NotesEditModal } from './NotesEditModal';
import {
  SpeciesAttributesBlock,
  type SpeciesAttributesDraft,
} from './SpeciesAttributesBlock';
import { parseMultiAttribute } from '~/lib/dwcAttributes';

const ALIEN_LABEL: Record<string, string> = {
  native: '原生',
  naturalized: '歸化',
  invasive: '歸化',
  cultured: '栽培/圈養',
};

type Props = {
  record: RecordWithTaxon | null;
  onClose: () => void;
  onRemove: () => void;
  /** Called when user saves new notes for the current record. The sheet handles its own NotesEditModal. */
  onSaveNotes: (newNotes: string) => void;
  /** Save / clear per-record GPS coordinates. Pass null to clear. */
  onSaveLocation?: (lat: number | null, lng: number | null) => void;
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
  onAddPhoto,
  onRemovePhoto,
  onSaveAttributes,
}: Props) {
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    if (record?.taxon_id) {
      setSynonyms(getSynonyms(record.taxon_id));
    } else {
      setSynonyms([]);
    }
  }, [record?.taxon_id]);

  // Reset internal modal when the underlying record changes
  useEffect(() => {
    setNotesModalOpen(false);
    setViewerIndex(null);
  }, [record?.id]);

  if (!record) return null;

  const isEndemic = record.is_endemic === 'true';
  const sourceLabel = ALIEN_LABEL[record.alien_type] ?? '';
  const links = externalLinks(record);
  const observed = new Date(record.observed_at);
  const observedStr = `${observed.getFullYear()}-${String(observed.getMonth() + 1).padStart(2, '0')}-${String(observed.getDate()).padStart(2, '0')} ${String(observed.getHours()).padStart(2, '0')}:${String(observed.getMinutes()).padStart(2, '0')}`;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '85%' }}
          className="rounded-t-2xl bg-white"
        >
          <SafeAreaView edges={['bottom']} className="flex-1">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300" />
            </View>
            <View className="flex-row items-start border-b border-gray-100 px-4 py-3">
              <View className="flex-1">
                <Text selectable className="text-lg font-semibold text-gray-900">
                  {record.common_name_c || '(無中文名)'}
                </Text>
                <ScientificName
                  name={record.simple_name}
                  author={record.name_author}
                  kingdom={record.kingdom}
                  className="text-sm text-gray-700"
                  selectable
                />
                <Text selectable className="text-xs text-gray-500">
                  {record.family_c} {record.family}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} className="ml-2">
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>

            <ScrollView className="flex-1">
              {record.alternative_name_c ? (
                <Section title="其他俗名">
                  <Text selectable className="text-sm text-gray-700">
                    {splitAltNames(record.alternative_name_c).join('、')}
                  </Text>
                </Section>
              ) : null}

              <Section title="物種狀態">
                <View className="flex-row flex-wrap gap-2">
                  {isEndemic ? <Tag color="emerald" label="特有" /> : null}
                  {sourceLabel ? <Tag color="blue" label={sourceLabel} /> : null}
                  {record.is_hybrid === 'true' ? <Tag color="purple" label="雜交" /> : null}
                </View>
              </Section>

              <Section title="保育狀態">
                <View className="space-y-1">
                  <ConservationRow label="紅皮書" value={record.redlist} />
                  <ConservationRow label="IUCN" value={record.iucn} />
                  <ConservationRow label="CITES" value={record.cites} />
                  <ConservationRow label="保育類" value={record.protected} />
                </View>
              </Section>

              {synonyms.length > 1 ? (
                <Section title={`同物異名 (${synonyms.length - 1})`}>
                  {synonyms
                    .filter((s) => s.status !== 'accepted')
                    .map((s, idx) => (
                      <Text key={idx} selectable className="text-sm text-gray-700">
                        {'• '}
                        <ScientificName
                          name={s.scientificName}
                          author={s.authorship}
                          kingdom={record.kingdom}
                          selectable
                        />
                      </Text>
                    ))}
                </Section>
              ) : null}

              <Section title="此次紀錄">
                <Text selectable className="text-sm text-gray-700">時間：{observedStr}</Text>
                {onAddPhoto ? (
                  <PhotoGrid
                    photos={parsePhotoPaths(record.photo_paths)}
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
                ) : null}
                <Pressable
                  onPress={() => setNotesModalOpen(true)}
                  className="mt-2 flex-row items-center rounded-lg border border-gray-200 px-3 py-2 active:bg-gray-50"
                >
                  <Ionicons name="create-outline" size={18} color="#4b5563" />
                  <Text className="ml-2 flex-1 text-sm text-gray-700">
                    {record.notes ? record.notes : '加入備註'}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
                </Pressable>
                {onSaveLocation ? (
                  <Pressable
                    onPress={async () => {
                      // Tap to capture current GPS; long-press handled via separate clear action.
                      const perm = await Location.requestForegroundPermissionsAsync();
                      if (perm.status !== 'granted') {
                        Alert.alert('需要定位權限', '請至 設定 → Checklister → 位置 開啟');
                        return;
                      }
                      try {
                        const pos = await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced,
                        });
                        onSaveLocation(pos.coords.latitude, pos.coords.longitude);
                      } catch (e) {
                        Alert.alert('無法取得位置', e instanceof Error ? e.message : String(e));
                      }
                    }}
                    onLongPress={
                      record.lat !== null
                        ? () => {
                            Alert.alert('GPS', undefined, [
                              { text: '取消', style: 'cancel' },
                              {
                                text: '清除座標',
                                style: 'destructive',
                                onPress: () => onSaveLocation(null, null),
                              },
                            ]);
                          }
                        : undefined
                    }
                    className="mt-2 flex-row items-center rounded-lg border border-gray-200 px-3 py-2 active:bg-gray-50"
                  >
                    <Ionicons
                      name={record.lat !== null ? 'location' : 'location-outline'}
                      size={18}
                      color={record.lat !== null ? '#2563eb' : '#4b5563'}
                    />
                    <Text className="ml-2 flex-1 text-sm text-gray-700" selectable>
                      {record.lat !== null && record.lng !== null
                        ? `${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}`
                        : '定位此物種'}
                    </Text>
                    <Text className="text-xs text-gray-400">
                      {record.lat !== null ? '長按清除' : '點選 GPS'}
                    </Text>
                  </Pressable>
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

              <Section title="外部連結">
                <View className="flex-row flex-wrap gap-2">
                  {links.map((link) => (
                    <Pressable
                      key={link.label}
                      onPress={() => Linking.openURL(link.url)}
                      className="flex-row items-center rounded-full bg-blue-50 px-3 py-1.5 active:bg-blue-100"
                    >
                      <Text className="text-xs font-medium text-blue-700">{link.label}</Text>
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
                  className="flex-row items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-3 active:bg-red-100"
                >
                  <Ionicons name="trash-outline" size={18} color="#dc2626" />
                  <Text className="ml-2 text-sm font-medium text-red-700">從名錄移除</Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>

        <NotesEditModal
          visible={notesModalOpen}
          initialValue={record.notes ?? ''}
          title={record.common_name_c || record.simple_name || '備註'}
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
    <View className="border-b border-gray-100 px-4 py-3">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</Text>
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

function Tag({ color, label }: { color: 'emerald' | 'blue' | 'purple'; label: string }) {
  const cls =
    color === 'emerald'
      ? 'bg-emerald-100 text-emerald-700'
      : color === 'blue'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-purple-100 text-purple-700';
  return (
    <View className={`rounded-full px-2.5 py-1 ${cls.split(' ')[0]}`}>
      <Text className={`text-xs font-medium ${cls.split(' ')[1]}`}>{label}</Text>
    </View>
  );
}

function ConservationRow({ label, value }: { label: string; value: string }) {
  return (
    <Text selectable className="text-sm text-gray-700">
      {label}：<Text className="font-medium">{value || '–'}</Text>
    </Text>
  );
}

function PhotoGrid({
  photos,
  onAdd,
  onView,
  onRemove,
}: {
  photos: string[];
  onAdd: () => void;
  onView?: (index: number) => void;
  onRemove?: (uri: string) => void;
}) {
  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {photos.map((uri, idx) => (
        <Pressable
          key={uri}
          onPress={onView ? () => onView(idx) : undefined}
          onLongPress={
            onRemove
              ? () => {
                  Alert.alert('照片', undefined, [
                    { text: '取消', style: 'cancel' },
                    { text: '移除', style: 'destructive', onPress: () => onRemove(uri) },
                  ]);
                }
              : undefined
          }
          className="overflow-hidden rounded-lg border border-gray-200"
          style={{ width: 88, height: 88 }}
        >
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        </Pressable>
      ))}
      <Pressable
        onPress={onAdd}
        className="items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 active:bg-gray-100"
        style={{ width: 88, height: 88 }}
      >
        <Ionicons name="camera-outline" size={24} color="#6b7280" />
        <Text className="mt-1 text-xs text-gray-600">加照片</Text>
      </Pressable>
    </View>
  );
}

function PhotoViewerModal({
  photos,
  index,
  onClose,
}: {
  photos: string[];
  index: number | null;
  onClose: () => void;
}) {
  const listRef = useRef<FlatList<string>>(null);
  const [current, setCurrent] = useState(index ?? 0);
  const { width, height } = Dimensions.get('window');

  useEffect(() => {
    if (index !== null) {
      setCurrent(index);
    }
  }, [index]);

  if (index === null || photos.length === 0) return null;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(uri) => uri}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / width);
            setCurrent(idx);
          }}
          renderItem={({ item }) => (
            <Pressable
              onPress={onClose}
              style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
            >
              <Image
                source={{ uri: item }}
                style={{ width, height: height * 0.85 }}
                contentFit="contain"
              />
            </Pressable>
          )}
        />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={{ position: 'absolute', top: 56, right: 20 }}
        >
          <Ionicons name="close" size={32} color="#fff" />
        </Pressable>
        {photos.length > 1 ? (
          <View
            style={{ position: 'absolute', bottom: 40, left: 0, right: 0 }}
            className="items-center"
          >
            <View className="rounded-full bg-black/60 px-3 py-1">
              <Text className="text-sm text-white">
                {current + 1} / {photos.length}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
