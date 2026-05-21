/**
 * Tappable header that toggles visibility of its children. Used for sections
 * like 同物異名 / 下級分類群 that can be long and benefit from a default-closed
 * state, sparing the user a wall of text on first open.
 *
 * Also exports `SynonymStatusBadge` since it's paired with this section in
 * every caller (and avoids duplicating the rose / gray / blue colour logic).
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

type Props = {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function CollapsibleSection({ title, count, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="mb-2 flex-row items-center active:opacity-70"
        hitSlop={6}
      >
        <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}
          {typeof count === 'number' ? ` (${count})` : ''}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color="#6b7280"
          style={{ marginLeft: 6 }}
        />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function SynonymStatusBadge({ status }: { status: string }) {
  if (!status) return null;
  if (status === 'misapplied') {
    return (
      <View className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 dark:bg-rose-900/60">
        <Text className="text-[10px] font-medium text-rose-700 dark:text-rose-300">{status}</Text>
      </View>
    );
  }
  if (status === 'not-accepted') {
    return (
      <View className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 dark:bg-gray-800">
        <Text className="text-[10px] font-medium text-gray-600 dark:text-gray-300">{status}</Text>
      </View>
    );
  }
  return (
    <View className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 dark:bg-blue-900/60">
      <Text className="text-[10px] font-medium text-blue-700 dark:text-blue-300">{status}</Text>
    </View>
  );
}
