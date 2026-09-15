/**
 * Filter box + option list, no chrome of its own — the body of a screen that
 * picks one value out of a list too long to drop down.
 *
 * Lifted out of app/settings.tsx's private SelectRow so the language screen and
 * (eventually) regionpacks' CountryPickerModal share one implementation.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

export type SearchableOption = {
  value: string;
  label: string;
  /** Secondary line — e.g. a Latin-script rendering of a native language name. */
  sublabel?: string;
};

export function SearchableOptionList({
  options,
  value,
  onSelect,
  searchPlaceholder,
}: {
  options: SearchableOption[];
  value: string;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.sublabel ?? '').toLowerCase().includes(needle) ||
        o.value.toLowerCase().includes(needle),
    );
  }, [options, q]);

  return (
    <>
      <View className="px-4 py-2">
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={searchPlaceholder}
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100"
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(o) => o.value}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelect(item.value)}
            className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-blue-50 dark:active:bg-blue-900/40"
          >
            <View className="flex-1">
              <Text className="text-base text-gray-900 dark:text-gray-100">{item.label}</Text>
              {item.sublabel ? (
                <Text className="text-xs text-gray-500 dark:text-gray-400">{item.sublabel}</Text>
              ) : null}
            </View>
            {item.value === value ? <Ionicons name="checkmark" size={20} color="#2563eb" /> : null}
          </Pressable>
        )}
      />
    </>
  );
}
