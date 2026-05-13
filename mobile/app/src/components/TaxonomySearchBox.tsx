import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { searchTaxonomy, type TaxonSearchHit } from '~/db';

const PLACEHOLDER = '搜尋分類群（俗名 / 學名 / 科名 ...）';
const DEBOUNCE_MS = 200;

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
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setResults(searchTaxonomy(query));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handlePick = (hit: TaxonSearchHit) => {
    onPick(hit);
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
  };

  return (
    <View className="border-t border-gray-200 bg-white">
      {results.length > 0 ? (
        <View className="max-h-60 border-b border-gray-100">
          <FlatList
            data={results}
            keyExtractor={(r, i) => `${r.rank}:${r.name}:${i}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <HitRow hit={item} onPress={() => handlePick(item)} />}
          />
        </View>
      ) : null}
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

function HitRow({ hit, onPress }: { hit: TaxonSearchHit; onPress: () => void }) {
  const pathPreview = hit.path.map((p) => p.value).join(' › ');
  return (
    <Pressable onPress={onPress} className="border-b border-gray-100 px-4 py-2.5 active:bg-blue-50">
      <View className="flex-row items-center">
        <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
          {hit.cname ? <Text className="font-medium">{hit.cname} </Text> : null}
          <Text className="italic">{hit.name}</Text>
        </Text>
        <View className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">
          <Text className="text-[10px] font-medium text-gray-600">{hit.rank}</Text>
        </View>
      </View>
      {pathPreview ? (
        <Text className="mt-0.5 text-[11px] text-gray-500" numberOfLines={1}>
          {pathPreview}
        </Text>
      ) : null}
    </Pressable>
  );
}
