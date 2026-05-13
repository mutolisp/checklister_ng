import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSynonyms, type SearchResult, type Synonym } from '~/db';
import { ScientificName } from './ScientificName';

type Props = {
  result: SearchResult | null;
  onClose: () => void;
  onAddToSession: () => void;
};

function externalLinks(result: SearchResult): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (result.taxon_id) {
    links.push({ label: 'TaiCOL', url: `https://taicol.tw/zh-hant/taxon/${result.taxon_id}` });
  }
  const sciEnc = encodeURIComponent(result.name);
  links.push({ label: 'GBIF', url: `https://www.gbif.org/species/search?q=${sciEnc}` });
  links.push({ label: 'iNaturalist', url: `https://www.inaturalist.org/taxa/search?q=${sciEnc}` });
  links.push({ label: 'Wikispecies', url: `https://species.wikimedia.org/wiki/${sciEnc}` });
  if (result.kingdom === 'Plantae') {
    links.push({ label: 'POWO', url: `https://powo.science.kew.org/?q=${sciEnc}` });
    links.push({ label: 'IPNI', url: `https://www.ipni.org/?q=${sciEnc}` });
  }
  return links;
}

export function LookupResultSheet({ result, onClose, onAddToSession }: Props) {
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);

  useEffect(() => {
    if (result?.taxon_id) setSynonyms(getSynonyms(result.taxon_id));
    else setSynonyms([]);
  }, [result?.taxon_id]);

  if (!result) return null;

  const links = externalLinks(result);

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
                  {result.cname || '(無中文名)'}
                </Text>
                <ScientificName
                  name={result.name}
                  author={result.fullname.replace(result.name, '').trim()}
                  kingdom={result.kingdom}
                  nomenclature={result.nomenclature_name}
                  className="text-sm text-gray-700"
                  selectable
                />
                <Text selectable className="text-xs text-gray-500">
                  {result.family_cname} {result.family}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={8} className="ml-2">
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>

            {result.matched_as ? (
              <View className="border-b border-gray-100 bg-orange-50 px-4 py-2">
                <Text selectable className="text-xs text-orange-900">
                  你輸入的是 <Text className="font-medium italic">{result.matched_as.name}</Text>（
                  {result.matched_as.status}），上方為接受名
                </Text>
              </View>
            ) : null}

            <ScrollView className="flex-1">
              {result.alternative_name_c ? (
                <Section title="其他俗名">
                  <Text selectable className="text-sm text-gray-700">
                    {splitAltNames(result.alternative_name_c).join('、')}
                  </Text>
                </Section>
              ) : null}

              <Section title="物種狀態">
                <View className="flex-row flex-wrap gap-2">
                  {result.endemic ? <Tag color="emerald" label="特有" /> : null}
                  {result.source ? <Tag color="blue" label={result.source} /> : null}
                  {result.is_hybrid === 'true' ? <Tag color="purple" label="雜交" /> : null}
                </View>
              </Section>

              <Section title="保育狀態">
                <ConservationRow label="紅皮書" value={result.redlist} />
                <ConservationRow label="IUCN" value={result.iucn_category} />
                <ConservationRow label="CITES" value={result.cites} />
                <ConservationRow label="保育類" value={result.protected} />
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
                          kingdom={result.kingdom}
                          nomenclature={result.nomenclature_name}
                          selectable
                        />
                      </Text>
                    ))}
                </Section>
              ) : null}

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
                    onAddToSession();
                    onClose();
                  }}
                  className="flex-row items-center justify-center rounded-lg bg-blue-500 px-4 py-3 active:bg-blue-600"
                >
                  <Ionicons name="add" size={18} color="white" />
                  <Text className="ml-2 text-sm font-medium text-white">加到當前 session</Text>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
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
