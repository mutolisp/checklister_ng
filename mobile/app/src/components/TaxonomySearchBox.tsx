import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { searchTaxonomy, type TaxonSearchHit } from '~/db';
import { rankColor } from '~/lib/rankColors';

const PLACEHOLDER = '搜尋分類群（俗名 / 學名 / 科名 ...）';
const DEBOUNCE_MS = 250;

type Props = {
  onPick: (hit: TaxonSearchHit) => void;
};

export function TaxonomySearchBox({ onPick }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaxonSearchHit[]>([]);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      try {
        setResults(searchTaxonomy(trimmed));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[TaxonomySearchBox] search failed:', e);
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handlePick = (hit: TaxonSearchHit) => {
    // 先 clear child state（含同步 native input value）並收鍵盤，再把
    // parent 的展開 + scroll 工作 defer 到下一幀。否則 onPick 會同步觸發
    // parent 大量 setState（setExpanded / setNodeMap / setChildrenMap /
    // setSpeciesMap / setSetting 寫 SQLite + 排程 setTimeout），實機上這個
    // 風暴 batch 後 child 的 setQuery('') / setResults([]) 偶爾視覺上沒生效。
    setResults([]);
    setQuery('');
    inputRef.current?.clear();
    Keyboard.dismiss();
    requestAnimationFrame(() => onPick(hit));
  };

  return (
    <View className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {results.length > 0 ? (
        <View className="max-h-60 border-b border-gray-100 dark:border-gray-800">
          <FlatList
            data={results}
            keyExtractor={(r, i) => `${r.rank}:${r.name}:${i}`}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews
            renderItem={({ item }) => <HitRow hit={item} onPress={() => handlePick(item)} />}
          />
        </View>
      ) : null}
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
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const ITALIC_RANKS = new Set(['Genus', 'Subgenus', 'Species', 'Subspecies', 'Variety', 'Form']);

const HitRow = memo(function HitRow({ hit, onPress }: { hit: TaxonSearchHit; onPress: () => void }) {
  const pathPreview = hit.path.map((p) => p.value).join(' › ');
  const italic = ITALIC_RANKS.has(hit.rank);
  const c = rankColor(hit.rank);
  return (
    <Pressable onPress={onPress} className="border-b border-gray-100 dark:border-gray-800 px-4 py-2.5 active:bg-blue-50 dark:active:bg-blue-900/40">
      <View className="flex-row items-center">
        <Text className="flex-1 text-sm text-gray-900 dark:text-gray-100" numberOfLines={1}>
          {hit.cname ? <Text className="font-medium">{hit.cname} </Text> : null}
          <Text className={italic ? 'italic' : ''}>{hit.name}</Text>
        </Text>
        <View className={`ml-2 rounded px-1.5 py-0.5 ${c.bg}`}>
          <Text className={`text-[10px] font-medium ${c.text}`}>{hit.rank}</Text>
        </View>
      </View>
      {pathPreview ? (
        <Text className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400" numberOfLines={1}>
          {pathPreview}
        </Text>
      ) : null}
    </Pressable>
  );
});
