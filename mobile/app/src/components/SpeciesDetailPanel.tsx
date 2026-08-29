/**
 * Species detail content (header + body) without modal/sheet chrome.
 *
 * Used by:
 *   - LookupResultSheet (wraps with Modal + drag handle for sheet UX)
 *   - SpeciesSearchPanel (renders inline above the search box, no modal)
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '~/i18n';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import {
  endemicTagLabel,
  getInfraspeciesOf,
  getSynonyms,
  type Ancestors,
  type Rank,
  type SearchResult,
  type Synonym,
  type TaxonSpecies,
} from '~/db';
import { buildSpeciesCopyText, copyToClipboard, speciesCopyActions } from '~/lib/clipboard';
import { alienBadge } from '~/lib/conservationColors';
import { rankColor } from '~/lib/rankColors';
import { useFavorites } from '~/stores/favorites';
import { useTaxonomyJump, type JumpPath } from '~/stores/taxonomyJump';
import { showActionSheet } from './ActionSheet';
import { CollapsibleSection, SynonymStatusBadge } from './CollapsibleSection';
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
  /** Long-press on the add button. Used to offer the alternative destinations
   *  (採集) without changing what a plain tap does. Omit to disable. */
  onAddLongPress?: () => void;
  /** Called when the user taps an infraspecies row in the「下級分類群」section.
   *  The caller is expected to swap the visible detail to the picked taxon
   *  (`LookupResultSheet` / `SpeciesSearchPanel` route this to their internal
   *  `currentResult` state). When omitted, the row is rendered non-tappable. */
  onPickSubordinate?: (sp: TaxonSpecies) => void;
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
  links.push({ label: 'NCBI', url: `https://www.ncbi.nlm.nih.gov/taxonomy/?term=${sciEnc}` });
  if (result.kingdom === 'Plantae') {
    links.push({ label: 'POWO', url: `https://powo.science.kew.org/results?q=${sciEnc}` });
    links.push({ label: 'IPNI', url: `https://www.ipni.org/?q=${sciEnc}` });
    links.push({ label: i18n.t('species.taiLink'), url: `https://tai2.ntu.edu.tw/search/1/${sciEnc}` });
  }
  return links;
}

export function SpeciesDetailPanel({
  result,
  onAddToSession,
  onClose,
  addButtonLabel,
  onAddLongPress,
  onPickSubordinate,
}: Props) {
  const { t } = useTranslation();
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [infraspecies, setInfraspecies] = useState<TaxonSpecies[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const favorited = useFavorites((s) => s.ids.has(result.taxon_id));
  const addFav = useFavorites((s) => s.add);
  const removeFav = useFavorites((s) => s.remove);

  useEffect(() => {
    if (result.taxon_id) setSynonyms(getSynonyms(result.taxon_id));
    else setSynonyms([]);
  }, [result.taxon_id]);

  // Look up infraspecies only when this is a binomial Species (rank='Species'
  // or unknown rank but two-token name). Subspecies/Variety/Form pages don't
  // have children, so skip the SQL.
  useEffect(() => {
    const isSpecies =
      result.rank === 'Species' ||
      (!result.rank && result.name && result.name.split(/\s+/).length === 2);
    if (!isSpecies) {
      setInfraspecies([]);
      return;
    }
    const ancestors: Ancestors = {};
    if (result.kingdom) ancestors.kingdom = result.kingdom;
    if (result.phylum) ancestors.phylum = result.phylum;
    if (result.class_name) ancestors.class = result.class_name;
    if (result.order) ancestors.order = result.order;
    if (result.family) ancestors.family = result.family;
    if (result.genus) ancestors.genus = result.genus;
    setInfraspecies(getInfraspeciesOf(result.name, ancestors));
  }, [
    result.name,
    result.rank,
    result.kingdom,
    result.phylum,
    result.class_name,
    result.order,
    result.family,
    result.genus,
  ]);

  // Scroll body back to top whenever the displayed taxon changes — important
  // when `onPickSubordinate` swaps the result in-place (the parent re-renders
  // this same panel with a new taxon, ScrollView would otherwise stay at the
  // old scroll position deep in the previous taxon's body).
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [result.taxon_id]);

  const links = externalLinks(result);

  return (
    <View className="flex-1">
      <View className="flex-row items-start border-b border-gray-100 dark:border-gray-800 px-4 py-3">
        <View className="flex-1">
          <Text selectable className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {result.cname || t('species.noChineseName')}
          </Text>
          <ScientificName
            name={result.name}
            author={result.fullname.replace(result.name, '').trim()}
            kingdom={result.kingdom}
            nomenclature={result.nomenclature_name}
            className="text-sm text-gray-700 dark:text-gray-300"
            selectable
          />
          {result.taxon_id ? (
            <Pressable
              onPress={() => (favorited ? removeFav(result.taxon_id) : addFav(result))}
              hitSlop={6}
              className="mt-2 flex-row items-center self-start rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 active:bg-amber-100 dark:active:bg-amber-900/60"
            >
              <Ionicons
                name={favorited ? 'star' : 'star-outline'}
                size={14}
                color="#d97706"
              />
              <Text className="ml-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {favorited ? t('species.inFavorites') : t('favorites.add')}
              </Text>
            </Pressable>
          ) : null}
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
              await copyToClipboard(buildSpeciesCopyText(result, a.mode), a.label);
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
            {t('species.matchedSynonymPre')}
            <ScientificName
              name={result.matched_as.name}
              kingdom={result.kingdom}
              nomenclature={result.nomenclature_name}
            />
            {t('species.matchedSynonymPost', { status: result.matched_as.status })}
          </Text>
        </View>
      ) : null}

      <ScrollView ref={scrollRef} className="flex-1">
        <View className="px-4 py-3">
          <RankChipRow result={result} onClose={onClose} />
        </View>

        {result.alternative_name_c ? (
          <Section title={t('species.otherNames')}>
            <Text selectable className="text-sm text-gray-700 dark:text-gray-300">
              {splitAltNames(result.alternative_name_c).join('、')}
            </Text>
          </Section>
        ) : null}

        <Section title={t('species.status')}>
          <View className="flex-row flex-wrap gap-2">
            {result.endemic ? <Tag color="emerald" label={endemicTagLabel(result.taxon_id)} /> : null}
            {(() => {
              const ab = alienBadge(result.alien_type, result.kingdom);
              if (!ab) return null;
              const color =
                ab.kind === 'invasive' || ab.kind === 'naturalized' ? 'rose' : 'purple';
              return <Tag color={color} label={ab.longLabel} />;
            })()}
            {result.is_hybrid === 'true' ? <Tag color="purple" label={t('species.hybrid')} /> : null}
            {habitatLabels(result).map((label) => (
              <Tag key={label} color="blue" label={label} />
            ))}
          </View>
        </Section>

        <Section title={t('species.conservation')}>
          <ConservationBadgeRow label={t('species.redlist')} value={result.redlist} />
          <ConservationBadgeRow label="IUCN" value={result.iucn_category} />
          <ConservationRow label="CITES" value={result.cites} />
          <ConservationRow label={t('species.protected')} value={result.protected} />
        </Section>

        {result.alien_status_note ? (
          <Section title={t('species.sourceLit')}>
            <View>
              {parseAlienStatusNote(result.alien_status_note).map((entry, idx) => (
                <View
                  key={idx}
                  className={`flex-row py-1.5 ${idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}
                >
                  <Text
                    selectable
                    className="w-20 text-xs text-gray-500 dark:text-gray-400"
                  >
                    {entry.type}
                  </Text>
                  <Text
                    selectable
                    className="flex-1 text-xs text-gray-700 dark:text-gray-300"
                  >
                    {entry.citation}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

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
                      kingdom={result.kingdom}
                      nomenclature={result.nomenclature_name}
                      selectable
                    />
                  </Text>
                  <SynonymStatusBadge status={s.status} />
                </View>
              ))}
            </CollapsibleSection>
          );
        })()}

        {infraspecies.length > 0 ? (
          <Section title={t('species.infraspecies', { count: infraspecies.length })}>
            <View>
              {infraspecies.map((sp) => {
                const rc = rankColor(sp.rank);
                const row = (
                  <View className="flex-row items-start py-2">
                    <Ionicons
                      name="leaf-outline"
                      size={14}
                      color="#10b981"
                      style={{ marginRight: 8, marginTop: 3 }}
                    />
                    <View className="flex-1">
                      <Text className="text-sm text-gray-700 dark:text-gray-300">
                        {sp.common_name_c ? (
                          <Text className="font-medium text-gray-900 dark:text-gray-100">
                            {sp.common_name_c}{' '}
                          </Text>
                        ) : null}
                        <ScientificName
                          name={sp.simple_name}
                          kingdom={sp.kingdom}
                          nomenclature={sp.nomenclature_name}
                        />
                        {sp.is_autonym ? (
                          <Text className="text-xs italic text-gray-500 dark:text-gray-400">
                            {' '}
                            s.str.
                          </Text>
                        ) : null}
                      </Text>
                      {sp.rank ? (
                        <View className={`mt-0.5 self-start rounded px-1.5 py-0.5 ${rc.bg}`}>
                          <Text className={`text-[10px] font-medium ${rc.text}`}>{sp.rank}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
                return onPickSubordinate ? (
                  <Pressable
                    key={sp.taxon_id || sp.simple_name}
                    onPress={() => onPickSubordinate(sp)}
                    className="active:bg-blue-50 dark:active:bg-blue-900/40"
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View key={sp.taxon_id || sp.simple_name}>{row}</View>
                );
              })}
            </View>
          </Section>
        ) : null}

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

        {result.nomenclature_name ? (
          <View className="px-4 pt-3">
            <Text className="text-xs text-gray-400 dark:text-gray-500">
              {t('species.nomenclature', { name: result.nomenclature_name })}
            </Text>
          </View>
        ) : null}

        <View className="px-4 pb-6 pt-4">
          <Pressable
            onPress={onAddToSession}
            onLongPress={onAddLongPress}
            delayLongPress={350}
            className="flex-row items-center justify-center rounded-lg bg-blue-500 px-4 py-3 active:bg-blue-600"
          >
            <Ionicons name="add" size={18} color="white" />
            <Text className="ml-2 text-sm font-medium text-white">{addButtonLabel ?? t('species.addToRecord')}</Text>
          </Pressable>
          {onAddLongPress ? (
            <Text className="mt-1.5 text-center text-[11px] text-gray-400 dark:text-gray-500">
              {t('addToRecord.longPressHint')}
            </Text>
          ) : null}
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

/** Parse TaiCOL `alien_status_note` field. Format: `type: citation | type: citation | …`
 *  Entries lacking the `type:` prefix are kept as citation-only (type = ''). */
/** Build the cascade path used by `useTaxonomyJump` from a SearchResult. Stops
 *  at the deepest rank requested — e.g. tapping 「科」 builds path up to family,
 *  not down to genus. */
function buildJumpPath(result: SearchResult, depth: Rank): JumpPath {
  const order: Rank[] = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'];
  const stopIdx = order.indexOf(depth);
  const path: JumpPath = [];
  const valueFor: Record<Rank, string> = {
    kingdom: result.kingdom,
    phylum: result.phylum,
    class: result.class_name,
    order: result.order,
    family: result.family,
    genus: result.genus,
  };
  for (let i = 0; i <= stopIdx; i++) {
    const r = order[i];
    const v = valueFor[r];
    if (v) path.push({ rank: r, value: v });
  }
  return path;
}

function RankChipRow({
  result,
  onClose,
}: {
  result: SearchResult;
  onClose?: () => void;
}) {
  const router = useRouter();
  const requestJump = useTaxonomyJump((s) => s.request);

  const items: Array<{ rank: Rank; name: string; nameC: string }> = [];
  if (result.kingdom) items.push({ rank: 'kingdom', name: result.kingdom, nameC: result.kingdom_c });
  if (result.phylum) items.push({ rank: 'phylum', name: result.phylum, nameC: result.phylum_c });
  if (result.class_name)
    items.push({ rank: 'class', name: result.class_name, nameC: result.class_c });
  if (result.order) items.push({ rank: 'order', name: result.order, nameC: result.order_c });
  if (result.family)
    items.push({ rank: 'family', name: result.family, nameC: result.family_cname });
  if (result.genus) items.push({ rank: 'genus', name: result.genus, nameC: result.genus_c });

  if (items.length === 0) return null;

  return (
    <View className="mt-1 flex-row flex-wrap gap-1.5">
      {items.map(({ rank, name, nameC }) => (
        <Pressable
          key={rank}
          onPress={() => {
            const path = buildJumpPath(result, rank);
            if (path.length === 0) return;
            requestJump(path);
            onClose?.();
            // Defer the navigation a frame so the modal close animation starts
            // before the tab switch — avoids a flash where both transitions
            // overlap on iOS.
            requestAnimationFrame(() => {
              router.push('/(tabs)/taxonomy');
            });
          }}
          className="flex-row items-center rounded-full bg-gray-100 px-2.5 py-1 active:bg-blue-100 dark:bg-gray-800 dark:active:bg-blue-900/60"
          hitSlop={4}
        >
          <Text className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400">
            {i18n.t('rank.' + rank)}
          </Text>
          {nameC ? (
            <Text className="ml-1 text-xs text-gray-800 dark:text-gray-200">{nameC}</Text>
          ) : null}
          <Text
            className={`ml-1 text-xs text-gray-600 dark:text-gray-400 ${rank === 'genus' ? 'italic' : ''}`}
          >
            {name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function habitatLabels(result: SearchResult): string[] {
  const out: string[] = [];
  if (result.is_terrestrial === 'true') out.push(i18n.t('species.terrestrial'));
  if (result.is_freshwater === 'true') out.push(i18n.t('species.freshwater'));
  if (result.is_brackish === 'true') out.push(i18n.t('species.brackish'));
  if (result.is_marine === 'true') out.push(i18n.t('species.marine'));
  if (result.is_fossil === 'true') out.push(i18n.t('species.fossil'));
  return out;
}

function parseAlienStatusNote(note: string): Array<{ type: string; citation: string }> {
  return note
    .split('|')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^([^:]+):\s*(.+)$/);
      if (m) return { type: m[1].trim(), citation: m[2].trim() };
      return { type: '', citation: seg };
    });
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
