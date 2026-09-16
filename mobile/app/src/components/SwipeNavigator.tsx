/**
 * 左右滑動切換上／下一筆 —— shared horizontal-swipe stepping.
 *
 * Used by the record detail sheets（名錄物種 / 樣區物種 / 採集標本）to walk the
 * species list, and by 樣區「環境 / 物種」to switch tab.
 *
 * Direction follows a photo carousel: dragging LEFT (finger towards −x) reveals
 * the NEXT item, dragging RIGHT goes BACK to the previous one.
 *
 * Three details make this safe to drop on top of screens that already work:
 *
 * - `activeOffsetX` / `failOffsetY` hand every even-slightly-vertical gesture
 *   back to the enclosing ScrollView, so the sheets scroll exactly as before.
 * - `blocker` is a NativeViewGestureHandler the caller wraps around any native
 *   child that pans on its own — in practice the inline `RecordLocationMap`
 *   that every detail sheet embeds. Without it, dragging the map sideways to
 *   place a point would step the record instead.
 * - At either end of the list the drag is damped to a short rubber-band rather
 *   than disabled, so the gesture still answers and the user learns there is
 *   nothing further that way.
 *
 * Callers rendering inside a react-native `<Modal>` must ALSO wrap the content
 * in their own `<GestureHandlerRootView>` — gesture-handler does not reach into
 * a Modal's separate native view hierarchy (the same reason
 * `SurveyorAssignSheet` carries one).
 */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Gesture,
  GestureDetector,
  type NativeGesture,
  type PanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** Horizontal travel before the swipe takes the gesture from the ScrollView. */
const ACTIVATE_X = 18;
/** Vertical travel that makes the swipe give up (scrolling wins). */
const FAIL_Y = 16;
/** Travel needed to commit a step… */
const COMMIT_X = 64;
/** …or this flick speed (px/s), so a short fast swipe also counts. */
const COMMIT_V = 650;
/** How far the content may follow the finger. */
const MAX_FOLLOW = 56;
/** Rubber-band factor when there is nothing in that direction. */
const EDGE_DAMPING = 0.22;

export type SwipeNav = {
  /** Wrap the swipeable content in `<GestureDetector gesture={nav.gesture}>`. */
  gesture: PanGesture;
  /** Wrap self-panning native children (maps) in `<GestureDetector gesture={nav.blocker}>`. */
  blocker: NativeGesture;
  /** Animated follow transform — put on the Animated.View holding the content. */
  style: StyleProp<ViewStyle>;
  /** Internal: exposed so `SwipeNavArea` can share the same offset. */
  translateX: SharedValue<number>;
};

/** What a caller knows about the current item's place in its on-screen list. */
export type SwipeNavPagerState = {
  /** Zero-based position of the current item. */
  index: number;
  total: number;
  /** −1 = previous, +1 = next. */
  onStep: (dir: -1 | 1) => void;
};

type Options = {
  /** −1 = previous, +1 = next. Only called when that neighbour exists. */
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** Turn the whole gesture off (e.g. while a nested editor owns the screen). */
  enabled?: boolean;
};

export function useSwipeNav({ onStep, hasPrev, hasNext, enabled = true }: Options): SwipeNav {
  const translateX = useSharedValue(0);

  // The gesture is rebuilt when the neighbour flags change, so the callback is
  // read through a ref to keep that dependency list honest and short.
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const step = useCallback((dir: -1 | 1) => {
    Haptics.selectionAsync().catch(() => {});
    stepRef.current(dir);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-ACTIVATE_X, ACTIVATE_X])
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onUpdate((e) => {
          const raw = e.translationX;
          // Dragging towards −x asks for the NEXT item; +x for the previous.
          const blocked = raw < 0 ? !hasNext : !hasPrev;
          const eased = blocked ? raw * EDGE_DAMPING : raw;
          translateX.value = Math.max(-MAX_FOLLOW, Math.min(MAX_FOLLOW, eased));
        })
        .onEnd((e) => {
          const committed = Math.abs(e.translationX) > COMMIT_X || Math.abs(e.velocityX) > COMMIT_V;
          const dir: -1 | 1 = e.translationX < 0 ? 1 : -1;
          const available = dir === 1 ? hasNext : hasPrev;
          if (committed && available) runOnJS(step)(dir);
          translateX.value = withTiming(0, { duration: 140 });
        })
        .onFinalize(() => {
          translateX.value = withTiming(0, { duration: 140 });
        }),
    [enabled, hasPrev, hasNext, step, translateX],
  );

  // `Gesture.Native()` stands in for whatever the wrapped native view does with
  // the touch; blocking the pan on it means the map keeps its own drags.
  const blocker = useMemo(() => Gesture.Native().blocksExternalGesture(gesture), [gesture]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return { gesture, blocker, style, translateX };
}

/**
 * `useSwipeNav` for the common case where the caller already has a pager state
 * (and may not have one at all — hooks cannot be called conditionally, so an
 * absent pager yields a disabled gesture rather than no gesture).
 */
export function usePagerNav(state: SwipeNavPagerState | undefined): SwipeNav {
  const onStep = useCallback(
    (dir: -1 | 1) => {
      state?.onStep(dir);
    },
    [state],
  );
  return useSwipeNav({
    onStep,
    hasPrev: !!state && state.index > 0,
    hasNext: !!state && state.index < state.total - 1,
    enabled: !!state && state.total > 1,
  });
}

/**
 * Lets a nested swipe-to-reveal row take precedence over an enclosing swipe.
 *
 * `SwipeRowActions` is scattered across every list in the app, so instead of
 * threading a gesture prop through each call site the enclosing screen puts its
 * gesture in this context and the rows opt themselves out. Without it, dragging
 * a species row sideways to reveal 刪除 would switch tab instead.
 */
const SwipeBlockContext = createContext<SwipeNav | undefined>(undefined);

export function SwipeBlockProvider({ nav, children }: { nav: SwipeNav; children: ReactNode }) {
  return <SwipeBlockContext.Provider value={nav}>{children}</SwipeBlockContext.Provider>;
}

/** The enclosing swipe gesture a nested row should block, if any. */
export function useSwipeBlock(): PanGesture | undefined {
  return useContext(SwipeBlockContext)?.gesture;
}

/**
 * Wraps a self-panning native child (a MapView) so the enclosing swipe keeps
 * its hands off it. A no-op when nothing around it is swipeable, so components
 * shared between swipeable and plain screens can use it unconditionally.
 */
export function SwipeBlockedArea({ children }: { children: ReactNode }) {
  const nav = useContext(SwipeBlockContext);
  if (!nav) return <>{children}</>;
  return (
    <GestureDetector gesture={nav.blocker}>
      <View>{children}</View>
    </GestureDetector>
  );
}

/** `<GestureDetector>` + the animated follow, for the common full-area case. */
export function SwipeNavArea({
  nav,
  children,
  style,
}: {
  nav: SwipeNav;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <GestureDetector gesture={nav.gesture}>
      <Animated.View style={[{ flex: 1 }, nav.style, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

/**
 * The visible half of the gesture: `‹ 3 / 47 ›`.
 *
 * A swipe nobody knows about is a swipe nobody uses, and gloved hands in the
 * field miss gestures — so every surface that accepts the swipe also shows this
 * row, and the chevrons do the same thing by tap.
 */
export function SwipeNavPager({
  state,
  grabber = false,
}: {
  state: SwipeNavPagerState | undefined;
  /** Draw the bottom-sheet grab handle above the row. */
  grabber?: boolean;
}) {
  const index = state?.index ?? 0;
  const total = state?.total ?? 0;
  const onStep = state?.onStep;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;
  if (!onStep || total <= 1) {
    // Nothing to step through — keep the grab handle, drop the chevrons.
    return grabber ? (
      <View className="items-center pt-2">
        <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
      </View>
    ) : null;
  }
  return (
    <View className="items-center pt-2">
      {grabber ? <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" /> : null}
      <View className="mt-1 flex-row items-center">
        <Pressable
          onPress={() => onStep(-1)}
          disabled={!hasPrev}
          hitSlop={10}
          className="px-3 py-1"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={18} color={hasPrev ? '#6b7280' : '#d1d5db'} />
        </Pressable>
        {/* Explicit style rather than min-w-16 / tabular-nums: both are
            Tailwind-only spellings that map to nothing on React Native, so the
            counter would jitter as the digit count changes. */}
        <Text
          style={{ minWidth: 64, fontVariant: ['tabular-nums'] }}
          className="text-center text-xs text-gray-500 dark:text-gray-400"
        >
          {index + 1} / {total}
        </Text>
        <Pressable
          onPress={() => onStep(1)}
          disabled={!hasNext}
          hitSlop={10}
          className="px-3 py-1"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-forward" size={18} color={hasNext ? '#6b7280' : '#d1d5db'} />
        </Pressable>
      </View>
    </View>
  );
}
