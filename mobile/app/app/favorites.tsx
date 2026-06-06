import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchByTaxonId, type FavoriteItem, type SearchResult } from '~/db';
import { KeyboardStickyView } from '~/components/KeyboardAvoidingView';
import { LookupResultSheet } from '~/components/LookupResultSheet';
import { ScientificName } from '~/components/ScientificName';
import { SearchBox } from '~/components/SearchBox';
import { showActionSheet } from '~/components/ActionSheet';
import { useAddToActiveRecord } from '~/lib/useAddToActiveRecord';
import { useFavorites } from '~/stores/favorites';
import { useToast } from '~/stores/toast';

type SortKey = 'added' | 'cname' | 'name' | 'family';
const SORT_LABEL: Record<SortKey, string> = {
  added: '加入時間',
  cname: '俗名',
  name: '學名',
  family: '科',
};

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const items = useFavorites((s) => s.items);
  const add = useFavorites((s) => s.add);
  const remove = useFavorites((s) => s.remove);
  const toast = useToast((s) => s.show);
  const { addSpecies, modal: addRecordModal } = useAddToActiveRecord();

  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [selected, setSelected] = useState<SearchResult | null>(null);

  const display = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (i) =>
            i.common_name_c.toLowerCase().includes(q) ||
            i.simple_name.toLowerCase().includes(q) ||
            i.family.toLowerCase().includes(q) ||
            i.family_c.toLowerCase().includes(q),
        )
      : items;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'cname':
          return (a.common_name_c || a.simple_name).localeCompare(
            b.common_name_c || b.simple_name,
            'zh-Hant',
          );
        case 'name':
          return a.simple_name.localeCompare(b.simple_name);
        case 'family':
          return (
            (a.family_c || a.family).localeCompare(b.family_c || b.family, 'zh-Hant') ||
            a.simple_name.localeCompare(b.simple_name)
          );
        case 'added':
        default:
          return b.added_at - a.added_at;
      }
    });
    return sorted;
  }, [items, filter, sortKey]);

  const handleSort = async () => {
    const keys: SortKey[] = ['added', 'cname', 'name', 'family'];
    const idx = await showActionSheet({
      title: '排序方式',
      options: keys.map((k) => ({ label: k === sortKey ? `✓ ${SORT_LABEL[k]}` : SORT_LABEL[k] })),
    });
    if (idx >= 0 && idx < keys.length) setSortKey(keys[idx]);
  };

  const openDetail = (taxonId: string) => {
    const r = searchByTaxonId(taxonId);
    if (r) setSelected(r);
    else toast('此物種已不在名錄資料庫中');
  };

  const handleLongPress = async (item: FavoriteItem) => {
    const idx = await showActionSheet({
      title: item.common_name_c || item.simple_name,
      options: [{ label: '加入記錄' }, { label: '移除常用名錄', destructive: true }],
    });
    if (idx === 0) {
      const r = searchByTaxonId(item.taxon_id);
      if (r) addSpecies(r);
      else toast('此物種已不在名錄資料庫中');
    } else if (idx === 1) {
      remove(item.taxon_id);
      toast('已從常用名錄移除');
    }
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      {/* Content (toolbar + filter + list) fills above the bottom search box.
          The KeyboardStickyView search box is a SIBLING of this flex-1 View
          (not a child) so keyboard translation lifts only the search box, not
          the list — mirrors the session detail screen. */}
      <View className="flex-1">
        {/* Sub-toolbar: count + 排序 + 放大鏡（在已收藏內過濾） */}
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2">
        <Text className="text-sm text-gray-500 dark:text-gray-400">{items.length} 筆</Text>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={handleSort}
            className="flex-row items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1.5 active:bg-gray-200 dark:active:bg-gray-700"
          >
            <Ionicons name="swap-vertical" size={14} color="#4b5563" />
            <Text className="ml-1 text-xs font-medium text-gray-700 dark:text-gray-300">
              {SORT_LABEL[sortKey]}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setFilterOpen((v) => !v);
              if (filterOpen) setFilter('');
            }}
            hitSlop={8}
            className="rounded-full bg-gray-100 dark:bg-gray-800 p-1.5 active:bg-gray-200 dark:active:bg-gray-700"
          >
            <Ionicons name={filterOpen ? 'search' : 'search-outline'} size={16} color="#4b5563" />
          </Pressable>
        </View>
      </View>

      {filterOpen ? (
        <View className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2">
          <TextInput
            className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            value={filter}
            onChangeText={setFilter}
            placeholder="在常用名錄內搜尋..."
            placeholderTextColor="#9ca3af"
            autoFocus
          />
        </View>
      ) : null}

      <FlatList
        data={display}
        keyExtractor={(item) => item.taxon_id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View className="px-4 py-16">
            <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
              {items.length === 0
                ? '尚無常用名錄。用下方搜尋框加入,或在物種詳細 / 分類樹 / 記錄中長按加入。'
                : '沒有符合的項目'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openDetail(item.taxon_id)}
            onLongPress={() => handleLongPress(item)}
            className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            {item.common_name_c ? (
              <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.common_name_c}
              </Text>
            ) : null}
            <ScientificName
              name={item.simple_name}
              author=""
              kingdom={item.kingdom}
              className="text-xs text-gray-700 dark:text-gray-300"
            />
            {item.family_c || item.family ? (
              <Text className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                {item.family_c}
                {item.family ? ` ${item.family}` : ''}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
      </View>

      {/* 底部貼鍵盤的 fuzzy 搜尋框：加入新的常用名錄 */}
      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <SearchBox
          onSelect={(r) => {
            add(r);
            toast(`已加入常用名錄：${r.cname || r.name}`);
          }}
          onLongPressResult={async (r) => {
            Keyboard.dismiss();
            if (Platform.OS === 'ios') await new Promise((res) => setTimeout(res, 150));
            setSelected(r);
          }}
        />
      </KeyboardStickyView>

      <LookupResultSheet
        result={selected}
        onClose={() => setSelected(null)}
        onAddToSession={() => {
          if (selected) addSpecies(selected);
        }}
        addButtonLabel="加入記錄"
      />
      {addRecordModal}
    </SafeAreaView>
  );
}
