/**
 * One-tap chip that requests the taxonomy tab to expand to a specific rank
 * within the lineage of the given taxon. Used by SpeciesDetailSheet (session
 * records) and PlotSpeciesTab rows where we don't want a full ancestor
 * breadcrumb but still need a way to navigate to the tree.
 *
 * Italic rule: latin name italic ONLY when targetRank === 'genus'.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import type { Rank } from '~/db';
import { useTaxonomyJump, type JumpPath } from '~/stores/taxonomyJump';

const RANK_ZH: Record<Rank, string> = {
  kingdom: '界',
  phylum: '門',
  class: '綱',
  order: '目',
  family: '科',
  genus: '屬',
};

type Lineage = {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
};

type Props = {
  /** Rank that the chip lands the user on after jump. Typically 'family'. */
  rank: Rank;
  /** Higher-rank fields from the taxon. Pass `class` as the third key
   *  (matches the DB column name despite being a JS reserved word context). */
  lineage: Lineage;
  /** Latin name of the target rank — what the chip displays + the leaf of
   *  the cascade. e.g. for family chip → `'Lycopodiaceae'`. */
  name: string;
  /** Optional Chinese label (e.g. `'石松科'`). */
  nameC?: string;
  /** Optional callback invoked before navigation — e.g. close a modal. */
  beforeJump?: () => void;
  /** Compact variant for inline rows (smaller padding + no rank prefix). */
  compact?: boolean;
};

export function TaxonomyJumpChip({
  rank,
  lineage,
  name,
  nameC,
  beforeJump,
  compact = false,
}: Props) {
  const router = useRouter();
  const requestJump = useTaxonomyJump((s) => s.request);

  if (!name) return null;

  const handlePress = () => {
    const order: Rank[] = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'];
    const stopIdx = order.indexOf(rank);
    const path: JumpPath = [];
    const valueFor: Record<Rank, string | undefined> = {
      kingdom: lineage.kingdom,
      phylum: lineage.phylum,
      class: lineage.class,
      order: lineage.order,
      family: lineage.family,
      genus: lineage.genus,
    };
    for (let i = 0; i <= stopIdx; i++) {
      const r = order[i];
      const v = valueFor[r];
      if (v) path.push({ rank: r, value: v });
    }
    if (path.length === 0) return;
    requestJump(path);
    beforeJump?.();
    requestAnimationFrame(() => {
      router.push('/(tabs)/taxonomy');
    });
  };

  const italic = rank === 'genus' ? 'italic' : '';

  if (compact) {
    return (
      <Pressable
        onPress={handlePress}
        className="flex-row items-center rounded-full bg-gray-100 px-2 py-0.5 active:bg-blue-100 dark:bg-gray-800 dark:active:bg-blue-900/60"
        hitSlop={6}
      >
        {nameC ? (
          <Text className="text-[10px] text-gray-700 dark:text-gray-300">{nameC}</Text>
        ) : null}
        <Text className={`text-[10px] text-gray-600 dark:text-gray-400 ${nameC ? 'ml-1' : ''} ${italic}`}>
          {name}
        </Text>
        <Ionicons name="open-outline" size={10} color="#6b7280" style={{ marginLeft: 3 }} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      className="flex-row items-center rounded-full bg-gray-100 px-2.5 py-1 active:bg-blue-100 dark:bg-gray-800 dark:active:bg-blue-900/60"
      hitSlop={4}
    >
      <Text className="text-[10px] font-semibold uppercase text-gray-500 dark:text-gray-400">
        {RANK_ZH[rank]}
      </Text>
      {nameC ? (
        <Text className="ml-1 text-xs text-gray-800 dark:text-gray-200">{nameC}</Text>
      ) : null}
      <Text className={`ml-1 text-xs text-gray-600 dark:text-gray-400 ${italic}`}>{name}</Text>
      <Ionicons name="open-outline" size={11} color="#6b7280" style={{ marginLeft: 4 }} />
    </Pressable>
  );
}
