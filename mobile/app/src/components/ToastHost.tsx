import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '~/stores/toast';

/** Distance (px) the banner must be dragged up before it dismisses. */
const DISMISS_THRESHOLD = 28;

export function ToastHost() {
  const current = useToast((s) => s.current);
  const dismiss = useToast((s) => s.dismiss);
  const translateY = useSharedValue(0);

  // Reset position whenever a new toast appears (id changes).
  useEffect(() => {
    translateY.value = 0;
  }, [current?.id, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    // Fade as it slides up so the dismiss feels responsive.
    opacity: Math.max(0, 1 + translateY.value / 80),
  }));

  if (!current) return null;

  // Swipe up to dismiss (only upward movement is tracked).
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < -DISMISS_THRESHOLD) {
        translateY.value = withTiming(-200, { duration: 150 });
        runOnJS(dismiss)();
      } else {
        translateY.value = withTiming(0, { duration: 120 });
      }
    });

  return (
    <SafeAreaView edges={['top']} pointerEvents="box-none" className="absolute inset-x-0 top-0 items-center">
      <GestureDetector gesture={pan}>
        {/* Animated.View carries only transform/opacity; visual styling stays
            on a plain View so it doesn't depend on NativeWind mapping
            Animated.View. */}
        <Animated.View style={animatedStyle}>
          <View className="mx-4 mt-2 flex-row items-center rounded-lg bg-gray-900 px-4 py-3 shadow-lg">
            <Text className="flex-1 text-sm text-white">{current.message}</Text>
            {current.action ? (
              <Pressable
                onPress={() => {
                  current.action!.onPress();
                  dismiss();
                }}
                className="ml-3 active:opacity-70"
              >
                <Text className="text-sm font-bold text-blue-300">{current.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </GestureDetector>
    </SafeAreaView>
  );
}
