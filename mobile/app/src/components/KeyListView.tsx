/**
 * Identification-key search view (物種 tab → 檢索表 segment).
 *
 * Design: search-first. No full list. The user either taps one of ≤5 chips
 * (most-recent merged with the largest families) or types into the search
 * box. The search box is pinned to the bottom for thumb reach; chips sit
 * directly above it. When the query is non-empty, chips hide to give the
 * results FlatList more vertical room.
 *
 * Perf:
 *  - Module-level LRU cache of search results (`SEARCH_CACHE`, capped at 20),
 *    keyed on `${trimmedLowerQuery}` and invalidated when the underlying
 *    `keys` array reference changes (re-imported bundle, etc).
 *  - Lowercased haystack strings pre-built once via `useMemo`; filtering is
 *    a plain `for` loop over a parallel string array (no per-row Object
 *    property reads).
 *  - 250 ms debounce so CJK IME composition only triggers one re-filter at
 *    the end of a burst.
 *  - No min-query-length gate. Single-char Chinese queries (芒/桑/楓/薹) are
 *    legitimate.
 */
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, type Href } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '~/i18n';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardStickyView } from './KeyboardAvoidingView';
import { getCachedKeys, type IdentificationKey } from '~/db';
import { useSettings } from '~/stores/settings';
import { ScientificName } from './ScientificName';
import { useThemeColors } from '~/hooks/useThemeColors';

function scopeLabel(rank: string): string {
  const KEY: Record<string, string> = {
    family: 'rank.family', genus: 'rank.genus', subfamily: 'rank.subfamily',
    tribe: 'rank.tribe', order: 'rank.order', class: 'rank.class',
  };
  return KEY[rank] ? i18n.t(KEY[rank]) : rank;
}

const ITALIC_RANKS = new Set(['genus', 'subgenus', 'species', 'subspecies', 'variety', 'form']);
function isItalicRank(rank: string): boolean {
  return ITALIC_RANKS.has(rank.toLowerCase());
}

/** Short chip label for the key's mode. Empty string means no chip — applied
 *  to plain dichotomous keys so existing list rows stay visually unchanged. */
function modeLabel(mode: string): string {
  if (mode === 'multi_access') return i18n.t('keys.modeMultiAccess');
  if (mode === 'both') return i18n.t('keys.modeBoth');
  return '';
}

const DEBOUNCE_MS = 250;
const MAX_CHIPS = 5;
const SEARCH_CACHE_LIMIT = 20;
const SEARCH_CACHE = new Map<string, IdentificationKey[]>();
/** Identity of the keys array currently reflected in SEARCH_CACHE. When the
 *  outer keys reference changes (re-import, hot reload) we drop the cache.
 *  Cheaper than a content hash and good enough — we only have one writer. */
let cachedKeysRef: IdentificationKey[] | null = null;

function cachedFilter(
  keys: IdentificationKey[],
  haystacks: string[],
  q: string,
): IdentificationKey[] {
  if (!q) return [];
  if (cachedKeysRef !== keys) {
    SEARCH_CACHE.clear();
    cachedKeysRef = keys;
  }
  const cached = SEARCH_CACHE.get(q);
  if (cached) return cached;
  const out: IdentificationKey[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (haystacks[i].includes(q)) out.push(keys[i]);
  }
  SEARCH_CACHE.set(q, out);
  if (SEARCH_CACHE.size > SEARCH_CACHE_LIMIT) {
    const firstKey = SEARCH_CACHE.keys().next().value;
    if (firstKey !== undefined) SEARCH_CACHE.delete(firstKey);
  }
  return out;
}

type Props = {
  /** When set, KeyListView mounts with this string already in the search
   *  field — used by the taxonomy tree's 🔑 chip to jump straight to the
   *  matching key(s) for a scope (e.g. `Lauraceae`). */
  initialQuery?: string;
  /** Nonce that re-applies `initialQuery` on every change, even when the
   *  string didn't change. Lets the user re-tap the same 🔑 chip after
   *  they've manually edited the search box and still get re-prefilled. */
  prefillNonce?: number;
};

export function KeyListView({ initialQuery, prefillNonce }: Props = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const recentIds = useSettings((s) => s.key_recent_ids);
  // Used as KeyboardStickyView opened-offset so the bar sits flush against
  // the keyboard (see same comment in taxonomy.tsx tree segment).
  const tabBarHeight = useBottomTabBarHeight();
  const [keys, setKeys] = useState<IdentificationKey[]>([]);
  const [query, setQuery] = useState<string>(initialQuery ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery ?? '');

  // Re-apply prefill when nonce changes (caller wants to overwrite whatever
  // the user typed). Plain initialQuery dependency wouldn't fire if the
  // string repeats. We deliberately don't filter when prefillNonce is
  // undefined — that lets callers opt out by omitting the prop entirely.
  useEffect(() => {
    if (prefillNonce == null) return;
    setQuery(initialQuery ?? '');
    setDebouncedQuery(initialQuery ?? '');
  }, [initialQuery, prefillNonce]);

  // Hydrate from module cache (fast, no SQL) — useFocusEffect previously
  // re-ran the keys SQL on every tab focus, costing ~1-2 s on mobile.
  useEffect(() => {
    setKeys(getCachedKeys());
  }, []);

  useEffect(() => {
    const trimmed = query.toLowerCase().trim();
    if (trimmed === debouncedQuery) return;
    const t = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, debouncedQuery]);

  // Build the lowercase haystack array once per keys change. Indices align
  // 1-to-1 with the keys array so the inner filter loop never touches
  // IdentificationKey objects.
  const haystacks = useMemo(() => {
    const out = new Array<string>(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      out[i] = `${k.scope_name.toLowerCase()} ${(k.scope_cname ?? '').toLowerCase()}`;
    }
    return out;
  }, [keys]);

  // ── Shortcuts (≤5): recent first, fill with families by scope_name asc
  const byId = useMemo(() => {
    const m = new Map<number, IdentificationKey>();
    for (const k of keys) m.set(k.id, k);
    return m;
  }, [keys]);

  // child_count was dropped (the COUNT subquery cost 15s on real device);
  // fallback chip suggestions now go alphabetical by scope_name. Still bounded
  // to MAX_CHIPS so the chip strip doesn't overflow.
  const largestFamilies = useMemo(() => {
    return keys
      .filter((k) => k.scope_rank === 'family')
      .slice()
      .sort((a, b) => a.scope_name.localeCompare(b.scope_name))
      .slice(0, MAX_CHIPS);
  }, [keys]);

  const shortcuts = useMemo<IdentificationKey[]>(() => {
    const out: IdentificationKey[] = [];
    const seen = new Set<number>();
    for (const id of recentIds) {
      const k = byId.get(id);
      if (k) {
        out.push(k);
        seen.add(k.id);
        if (out.length >= MAX_CHIPS) break;
      }
    }
    for (const k of largestFamilies) {
      if (out.length >= MAX_CHIPS) break;
      if (seen.has(k.id)) continue;
      out.push(k);
      seen.add(k.id);
    }
    return out;
  }, [recentIds, byId, largestFamilies]);

  const results = useMemo(
    () => cachedFilter(keys, haystacks, debouncedQuery),
    [keys, haystacks, debouncedQuery],
  );

  const handlePickKey = useCallback(
    (id: number) => router.push(`/key/${id}` as Href),
    [router],
  );

  const renderRow = useCallback(
    ({ item }: { item: IdentificationKey }) => <KeyRow k={item} onPick={handlePickKey} />,
    [handlePickKey],
  );

  if (keys.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Ionicons name="key-outline" size={56} color="#cbd5e1" />
        <Text className="mt-3 text-base font-medium text-gray-700 dark:text-gray-300">{t('keys.noKeys')}</Text>
        <Text className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('keys.noKeysHint1')}{'\n'}{t('keys.noKeysHint2')}
        </Text>
      </View>
    );
  }

  const hasQuery = debouncedQuery.length > 0;
  const showChips = !hasQuery && shortcuts.length > 0;

  return (
    <View className="flex-1">
      {/* Results area (or empty hint). Takes all remaining height above the
          bottom-sticky search panel. */}
      <View className="flex-1">
        {!hasQuery ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search" size={48} color="#cbd5e1" />
            <Text className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('keys.searchHint', { br: '\n' })}
            </Text>
          </View>
        ) : results.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search" size={40} color="#cbd5e1" />
            <Text className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('keys.noMatchKeys')}</Text>
          </View>
        ) : (
          <FlatList
            className="flex-1"
            data={results}
            keyExtractor={getRowKey}
            keyboardShouldPersistTaps="handled"
            renderItem={renderRow}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews
          />
        )}
      </View>

      {/* Sticky panel: chips (when no query) + search box. Follows the kbd
          top via KeyboardStickyView regardless of accessory-bar changes. */}
      <KeyboardStickyView offset={{ opened: tabBarHeight }}>
        <View className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          {showChips ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, gap: 6 }}
            >
              {shortcuts.map((k) => (
                <ShortcutChip key={k.id} k={k} onPress={handlePickKey} />
              ))}
            </ScrollView>
          ) : null}
          <View className="flex-row items-center gap-2 px-3 pb-3 pt-2">
            <View className="flex-1 flex-row items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-2">
              <Ionicons name="search" size={16} color={colors.icon} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('keys.searchPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCorrect={false}
                returnKeyType="search"
                className="ml-2 flex-1 text-sm text-gray-900 dark:text-gray-100"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.icon} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

function getRowKey(k: IdentificationKey): string {
  return String(k.id);
}

const KeyRow = memo(function KeyRow({
  k,
  onPick,
}: {
  k: IdentificationKey;
  onPick: (id: number) => void;
}) {
  return (
    <Pressable
      onPress={() => onPick(k.id)}
      className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
        <Ionicons name="key" size={18} color="#10b981" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-baseline flex-wrap">
          {isItalicRank(k.scope_rank) ? (
            <ScientificName
              name={k.scope_name}
              className="text-base font-medium text-gray-900 dark:text-gray-100"
            />
          ) : (
            <Text className="text-base font-medium text-gray-900 dark:text-gray-100">
              {k.scope_name}
            </Text>
          )}
          {k.scope_cname ? (
            <Text className="ml-2 text-sm text-gray-600 dark:text-gray-400">{k.scope_cname}</Text>
          ) : null}
          <Text className="ml-2 text-xs text-gray-400 dark:text-gray-500">
            {scopeLabel(k.scope_rank)}
          </Text>
          {modeLabel(k.mode) ? (
            <View className="ml-2 rounded bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.5">
              <Text className="text-[10px] font-medium text-blue-700 dark:text-blue-300">
                {modeLabel(k.mode)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </Pressable>
  );
});

const ShortcutChip = memo(function ShortcutChip({
  k,
  onPress,
}: {
  k: IdentificationKey;
  onPress: (id: number) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(k.id)}
      className="flex-row items-center rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 active:bg-gray-50 dark:active:bg-gray-800"
    >
      {isItalicRank(k.scope_rank) ? (
        <ScientificName
          name={k.scope_name}
          className="text-xs font-medium text-gray-800 dark:text-gray-200"
        />
      ) : (
        <Text className="text-xs font-medium text-gray-800 dark:text-gray-200">{k.scope_name}</Text>
      )}
      {k.scope_cname ? (
        <Text className="ml-1.5 text-xs text-gray-600 dark:text-gray-400">{k.scope_cname}</Text>
      ) : null}
    </Pressable>
  );
});
