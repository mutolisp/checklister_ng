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
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
// Reanimated-based Swipeable: the legacy RNGH `Swipeable` animates on the JS
// thread and mounts one Animated pipeline per row; this one runs on the UI
// thread (reanimated is already a dependency). Same props/close() contract.
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

export type SwipeAction = {
  /** Display label next to the icon. */
  label: string;
  /** Ionicons glyph. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Tailwind bg colour class (also used for active state). `inat` is
   *  iNaturalist's green (#74AB00) — a static literal, which is the one case
   *  where an arbitrary `bg-[#…]` class is safe for NativeWind's JIT scanner. */
  color: 'red' | 'blue' | 'emerald' | 'purple' | 'amber' | 'inat';
  onPress: () => void;
};

const BG: Record<SwipeAction['color'], string> = {
  red: 'bg-red-600 active:bg-red-700',
  blue: 'bg-blue-600 active:bg-blue-700',
  emerald: 'bg-emerald-600 active:bg-emerald-700',
  purple: 'bg-purple-600 active:bg-purple-700',
  amber: 'bg-amber-600 active:bg-amber-700',
  inat: 'bg-[#74AB00] active:bg-[#5E8A00]',
};

type Props = {
  children: ReactNode;
  actions: SwipeAction[];
  /** When true, the row is non-swipeable. Use this in multi-select mode so
   *  the user can't accidentally delete while picking. */
  disabled?: boolean;
  /** One-shot discovery hint: shortly after mount the row peeks its actions
   *  open and closes again. The caller decides when (first row, first visit)
   *  and persists that it has been shown. */
  teaser?: boolean;
};

export function SwipeRowActions({ children, actions, disabled = false, teaser = false }: Props) {
  const ref = useRef<SwipeableMethods>(null);

  useEffect(() => {
    if (!teaser || disabled) return;
    const open = setTimeout(() => ref.current?.openRight(), 600);
    const close = setTimeout(() => ref.current?.close(), 1600);
    return () => {
      clearTimeout(open);
      clearTimeout(close);
    };
  }, [teaser, disabled]);

  if (disabled || actions.length === 0) {
    return <View>{children}</View>;
  }

  return (
    <ReanimatedSwipeable
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
              className={`flex-row items-center justify-center px-4 ${BG[a.color]}`}
            >
              <Ionicons name={a.icon} size={20} color="white" />
              <Text className="ml-1.5 text-sm font-medium text-white">{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
