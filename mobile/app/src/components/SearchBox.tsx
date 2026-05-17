import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { prewarmFuzzyIndex, searchWithFuzzyFallback, type SearchResult } from '~/db';
import type { TaxonGroup } from '~/db/types';
import { TaxonGroupPicker } from './TaxonGroupPicker';
import { ScientificName } from './ScientificName';
import { useSettings } from '~/stores/settings';

const PLACEHOLDER = '輸入物種/分類群關鍵字...';
/**
 * Debounce window between the last keystroke and the actual search firing.
 * Chinese IME composition pauses for ~100-200ms between committed chars, so
 * 250ms gives the user enough room to finish typing a word before we hit
 * the 242k-row SQLite scan + 62k-row fuzzy index.
 *
 * Single-char queries (芒、櫸、薹、莎、桑…) are valid common names so we
 * don't gate on length — the cache + 250ms debounce + column projection
 * are what we lean on for performance.
 */
const DEBOUNCE_MS = 250;
/** Cap on the in-memory result cache (FIFO eviction). 20 keeps the typical
 *  back-and-forth typing path warm without growing the JS heap. */
const CACHE_LIMIT = 20;

type Props = {
  onSelect: (result: SearchResult) => void;
  onLongPressResult?: (result: SearchResult) => void;
  autoFocus?: boolean;
  /**
   * Behaviour after the user picks a result:
   *   - 'refocus' (default): re-focus the input + keep keyboard up. Right for
   *     quick-add flows (session / plot list) where the next action is typing
   *     another species.
   *   - 'dismiss': blur the input + dismiss the keyboard. Right for inline
   *     detail panels where the keyboard would cover the detail the user
   *     just opened.
   */
  afterSelect?: 'refocus' | 'dismiss';
};

/**
 * Small FIFO-evicting cache. Keys are `${trimmedQuery}|${groupOrEmpty}`.
 * Module-scope so cache survives navigation between screens that all mount
 * SearchBox (lookup → session → plot, same query) — Chinese keyword search
 * over 242k rows costs ~100-300ms, repeated lookups should be instant.
 */
const resultCache = new Map<string, SearchResult[]>();
function cacheGet(key: string): SearchResult[] | undefined {
  return resultCache.get(key);
}
function cacheSet(key: string, value: SearchResult[]): void {
  if (resultCache.has(key)) resultCache.delete(key);
  resultCache.set(key, value);
  if (resultCache.size > CACHE_LIMIT) {
    const first = resultCache.keys().next().value;
    if (first !== undefined) resultCache.delete(first);
  }
}

export function SearchBox({ onSelect, onLongPressResult, autoFocus = false, afterSelect = 'refocus' }: Props) {
  const lastGroup = useSettings((s) => s.last_search_group);
  const setSetting = useSettings((s) => s.set);

  const [query, setQuery] = useState('');
  const [group, setGroupLocal] = useState<TaxonGroup | ''>(lastGroup);
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setGroupLocal(lastGroup);
  }, [lastGroup]);

  // Pre-warm the 62k fuzzy cname index off the critical path so the first
  // user query doesn't pay the ~200-500ms cold-load cost. setTimeout(0)
  // yields to UI render first; an already-warm index is a no-op.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        prewarmFuzzyIndex();
      } catch {
        // non-fatal: search still works via exact path, just slower on
        // the first fuzzy fallback.
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    // Cache hit fires synchronously — no debounce wait. Lets the user
    // erase a char and instantly see the prior result without re-running
    // the SQL.
    const cacheKey = `${trimmed}|${group || ''}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      setResults(cached.slice(0, 20));
      return;
    }
    debounceRef.current = setTimeout(() => {
      try {
        const r = searchWithFuzzyFallback({ q: trimmed, group: group || undefined });
        cacheSet(cacheKey, r);
        setResults(r.slice(0, 20));
      } catch (e) {
        // Defense in depth: never let a search-time exception escape the
        // debounce timer — an uncaught error here has been observed to
        // destabilize the JS runtime (Hermes GC crash) when typing fires
        // many queries in quick succession.
        // eslint-disable-next-line no-console
        console.warn('[SearchBox] search failed:', e);
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, group]);

  const handleGroupChange = (next: TaxonGroup | '') => {
    setGroupLocal(next);
    setSetting('last_search_group', next);
  };

  const handleSelect = (result: SearchResult) => {
    onSelect(result);
    setQuery('');
    setResults([]);
    if (afterSelect === 'refocus') {
      inputRef.current?.focus();
    } else {
      inputRef.current?.blur();
      Keyboard.dismiss();
    }
  };

  return (
    <View className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {results.length > 0 ? (
        <View className="max-h-72 border-b border-gray-100 dark:border-gray-800">
          <FlatList
            data={results}
            keyExtractor={getResultKey}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews
            renderItem={({ item }) => (
              <AutocompleteRow
                result={item}
                onPress={() => handleSelect(item)}
                onLongPress={onLongPressResult ? () => onLongPressResult(item) : undefined}
              />
            )}
          />
        </View>
      ) : null}
      <View className="flex-row items-center justify-start gap-2 border-b border-gray-100 dark:border-gray-800 px-3 py-2">
        <TaxonGroupPicker value={group} onChange={handleGroupChange} />
      </View>
      <View className="flex-row items-center px-2 py-2">
        <View className="flex-1 flex-row items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-2">
          <Ionicons name="search" size={18} color="#6b7280" />
          <TextInput
            ref={inputRef}
            className="ml-2 flex-1 text-base text-gray-900 dark:text-gray-100"
            placeholder={PLACEHOLDER}
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            autoFocus={autoFocus}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => Keyboard.dismiss()} className="ml-2 px-2">
          <Text className="text-sm text-blue-500">完成</Text>
        </Pressable>
      </View>
    </View>
  );
}

function getResultKey(r: SearchResult): string {
  return `${r.id}`;
}

const AutocompleteRow = memo(function AutocompleteRow({
  result,
  onPress,
  onLongPress,
}: {
  result: SearchResult;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const isSynonym = !!result.matched_as;
  const isFuzzy = !!result.fuzzy_match;
  const cname = result.cname || '(無中文名)';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="border-b border-gray-100 dark:border-gray-800 px-4 py-2.5 active:bg-blue-50 dark:active:bg-blue-900/40"
    >
      <View className="flex-row flex-wrap items-center">
        {isSynonym ? <Text className="mr-1 text-sm text-orange-600">≡</Text> : null}
        {isFuzzy ? <Text className="mr-1 text-sm text-purple-600">~</Text> : null}
        <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">{cname}</Text>
        <Text className="ml-1 text-xs text-gray-500 dark:text-gray-400"> </Text>
        <ScientificName
          name={result.name}
          author={result.fullname.replace(result.name, '').trim()}
          kingdom={result.kingdom}
          nomenclature={result.nomenclature_name}
          className="text-sm text-gray-700 dark:text-gray-300"
        />
      </View>
      {result.matched_as ? (
        <Text className="mt-0.5 text-xs text-orange-700 dark:text-orange-300" numberOfLines={1}>
          ↳ 你輸入：<Text className="italic">{result.matched_as.name}</Text>（{result.matched_as.status}）
        </Text>
      ) : null}
      {result.family_cname || result.family ? (
        <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {result.family_cname} {result.family}
        </Text>
      ) : null}
    </Pressable>
  );
});
