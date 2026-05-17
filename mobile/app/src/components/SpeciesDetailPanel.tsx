/**
 * Species detail content (header + body) without modal/sheet chrome.
 *
 * Used by:
 *   - LookupResultSheet (wraps with Modal + drag handle for sheet UX)
 *   - SpeciesSearchPanel (renders inline above the search box, no modal)
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { getSynonyms, type SearchResult, type Synonym } from '~/db';
import { buildSpeciesCopyText, copyToClipboard, speciesCopyActions } from '~/lib/clipboard';
import { alienBadge } from '~/lib/conservationColors';
import { showActionSheet } from './ActionSheet';
import { ConservationBadge } from './ConservationBadge';
import { ScientificName } from './ScientificName';

type Props = {
  result: SearchResult;
  onAddToSession: () => void;
  /** Optional close button at top-right. Pass null/omit to hide. */
  onClose?: () => void;
  /** Override the add button text (e.g. for inline mode you might want
   *  「加入並繼續搜尋」 someday). Defaults to「加到當前記錄」. */
  addButtonLabel?: string;
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

export function SpeciesDetailPanel({
  result,
  onAddToSession,
  onClose,
  addButtonLabel = '加到當前記錄',
}: Props) {
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);

  useEffect(() => {
    if (result.taxon_id) setSynonyms(getSynonyms(result.taxon_id));
    else setSynonyms([]);
  }, [result.taxon_id]);

  const links = externalLinks(result);

  return (
    <View className="flex-1">
      <View className="flex-row items-start border-b border-gray-100 dark:border-gray-800 px-4 py-3">
        <View className="flex-1">
          <Text selectable className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {result.cname || '(無中文名)'}
          </Text>
          <ScientificName
            name={result.name}
            author={result.fullname.replace(result.name, '').trim()}
            kingdom={result.kingdom}
            nomenclature={result.nomenclature_name}
            className="text-sm text-gray-700 dark:text-gray-300"
            selectable
          />
          <Text selectable className="text-xs text-gray-500 dark:text-gray-400">
            {result.family_cname} {result.family}
          </Text>
        </View>
        <Pressable
          onPress={async () => {
            const actions = speciesCopyActions(result);
            const idx = await showActionSheet({
              title: result.cname || result.name,
              options: actions.map((a) => ({ label: a.label })),
            });
            if (idx >= 0 && idx < actions.length) {
              const a = actions[idx];
              await copyToClipboard(buildSpeciesCopyText(result, a.mode), a.label.replace(/^複製/, ''));
            }
          }}
          hitSlop={8}
          className="ml-2"
        >
          <Ionicons name="copy-outline" size={20} color="#6b7280" />
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={8} className="ml-2">
            <Ionicons name="close" size={22} color="#6b7280" />
          </Pressable>
        ) : null}
      </View>

      {result.matched_as ? (
        <View className="border-b border-gray-100 dark:border-gray-800 bg-orange-50 dark:bg-orange-950/40 px-4 py-2">
          <Text selectable className="text-xs text-orange-900 dark:text-orange-200">
            你輸入的是 <Text className="font-medium italic">{result.matched_as.name}</Text>（
            {result.matched_as.status}），上方為接受名
          </Text>
        </View>
      ) : null}

      <ScrollView className="flex-1">
        {result.alternative_name_c ? (
          <Section title="其他俗名">
            <Text selectable className="text-sm text-gray-700 dark:text-gray-300">
              {splitAltNames(result.alternative_name_c).join('、')}
            </Text>
          </Section>
        ) : null}

        <Section title="物種狀態">
          <View className="flex-row flex-wrap gap-2">
            {result.endemic ? <Tag color="emerald" label="特有種" /> : null}
            {(() => {
              const ab = alienBadge(result.alien_type, result.kingdom);
              if (!ab) return null;
              const color =
                ab.kind === 'invasive' || ab.kind === 'naturalized' ? 'rose' : 'purple';
              return <Tag color={color} label={ab.longLabel} />;
            })()}
            {result.is_hybrid === 'true' ? <Tag color="purple" label="雜交" /> : null}
          </View>
        </Section>

        <Section title="保育狀態">
          <ConservationBadgeRow label="紅皮書" value={result.redlist} />
          <ConservationBadgeRow label="IUCN" value={result.iucn_category} />
          <ConservationRow label="CITES" value={result.cites} />
          <ConservationRow label="保育類" value={result.protected} />
        </Section>

        {synonyms.length > 1 ? (
          <Section title={`同物異名 (${synonyms.length - 1})`}>
            {synonyms
              .filter((s) => s.status !== 'accepted')
              .map((s, idx) => (
                <Text key={idx} selectable className="text-sm text-gray-700 dark:text-gray-300">
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
            onPress={onAddToSession}
            className="flex-row items-center justify-center rounded-lg bg-blue-500 px-4 py-3 active:bg-blue-600"
          >
            <Ionicons name="add" size={18} color="white" />
            <Text className="ml-2 text-sm font-medium text-white">{addButtonLabel}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
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
