/**
 * Multi-action variant of SwipeRow. Left-swipe reveals 1-N buttons (e.g.
 * `[匯出][刪除]`) on the trailing edge. Each action gets its own background
 * colour and icon. Trailing edge sits on the right side of the row, so the
 * RIGHTMOST action in `actions` is the one closest to the swipe origin —
 * conventionally the destructive "delete" sits last per the user's spec.
 *
 * Separate from `SwipeRow` (single-delete) so existing call sites (per-species
 * rows in session/plot) don't have to change. Use this on the records list.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

export type SwipeAction = {
  /** Display label next to the icon. */
  label: string;
  /** Ionicons glyph. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Tailwind bg colour class (also used for active state). */
  color: 'red' | 'blue' | 'emerald' | 'purple' | 'amber';
  onPress: () => void;
};

const BG: Record<SwipeAction['color'], string> = {
  red: 'bg-red-600 active:bg-red-700',
  blue: 'bg-blue-600 active:bg-blue-700',
  emerald: 'bg-emerald-600 active:bg-emerald-700',
  purple: 'bg-purple-600 active:bg-purple-700',
  amber: 'bg-amber-600 active:bg-amber-700',
};

type Props = {
  children: ReactNode;
  actions: SwipeAction[];
  /** When true, the row is non-swipeable. Use this in multi-select mode so
   *  the user can't accidentally delete while picking. */
  disabled?: boolean;
};

export function SwipeRowActions({ children, actions, disabled = false }: Props) {
  const ref = useRef<Swipeable>(null);

  if (disabled || actions.length === 0) {
    return <View>{children}</View>;
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View className="flex-row">
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => {
                ref.current?.close();
                a.onPress();
              }}
              className={`flex-row items-center justify-center px-5 ${BG[a.color]}`}
            >
              <Ionicons name={a.icon} size={20} color="white" />
              <Text className="ml-1.5 text-sm font-medium text-white">{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      {children}
    </Swipeable>
  );
}
