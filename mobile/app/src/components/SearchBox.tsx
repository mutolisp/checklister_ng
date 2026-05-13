import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { searchWithFuzzyFallback, type SearchResult } from '~/db';
import type { TaxonGroup } from '~/db/types';
import { TaxonGroupPicker } from './TaxonGroupPicker';
import { ScientificName } from './ScientificName';
import { useSettings } from '~/stores/settings';

const PLACEHOLDER = '輸入物種/分類群關鍵字...';
const DEBOUNCE_MS = 150;

type Props = {
  onSelect: (result: SearchResult) => void;
  onLongPressResult?: (result: SearchResult) => void;
  autoFocus?: boolean;
};

export function SearchBox({ onSelect, onLongPressResult, autoFocus = false }: Props) {
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

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const r = searchWithFuzzyFallback({ q: query, group: group || undefined });
      setResults(r.slice(0, 20));
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
    inputRef.current?.focus();
  };

  return (
    <View className="border-t border-gray-200 bg-white">
      {results.length > 0 ? (
        <View className="max-h-72 border-b border-gray-100">
          <FlatList
            data={results}
            keyExtractor={(r) => `${r.id}`}
            keyboardShouldPersistTaps="handled"
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
      <View className="flex-row items-center justify-start gap-2 border-b border-gray-100 px-3 py-2">
        <TaxonGroupPicker value={group} onChange={handleGroupChange} />
      </View>
      <View className="flex-row items-center px-2 py-2">
        <View className="flex-1 flex-row items-center rounded-full bg-gray-100 px-3 py-2">
          <Ionicons name="search" size={18} color="#6b7280" />
          <TextInput
            ref={inputRef}
            className="ml-2 flex-1 text-base text-gray-900"
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

function AutocompleteRow({
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
      className="border-b border-gray-100 px-4 py-2.5 active:bg-blue-50"
    >
      <View className="flex-row flex-wrap items-center">
        {isSynonym ? <Text className="mr-1 text-sm text-orange-600">≡</Text> : null}
        {isFuzzy ? <Text className="mr-1 text-sm text-purple-600">~</Text> : null}
        <Text className="text-sm font-medium text-gray-900">{cname}</Text>
        <Text className="ml-1 text-xs text-gray-500"> </Text>
        <ScientificName
          name={result.name}
          author={result.fullname.replace(result.name, '').trim()}
          kingdom={result.kingdom}
          nomenclature={result.nomenclature_name}
          className="text-sm text-gray-700"
        />
      </View>
      {result.matched_as ? (
        <Text className="mt-0.5 text-xs text-orange-700" numberOfLines={1}>
          ↳ 你輸入：<Text className="italic">{result.matched_as.name}</Text>（{result.matched_as.status}）
        </Text>
      ) : null}
      {result.family_cname || result.family ? (
        <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
          {result.family_cname} {result.family}
        </Text>
      ) : null}
    </Pressable>
  );
}
