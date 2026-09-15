/**
 * Select — react-native-reusables' Select, adapted to this app.
 *
 * Adapted rather than pasted: RNR's registry copy styles itself with shadcn
 * tokens (`bg-popover`, `text-foreground`, `border-input`, …) and draws lucide
 * icons. This project has neither — `tailwind.config.js` has an empty
 * `theme.extend`, so those classes do not exist, and icons are Ionicons
 * everywhere. Standing up a parallel shadcn colour system next to the existing
 * gray-50 / gray-950 / blue-500 convention would leave the app with two.
 *
 * Also dropped from upstream, all native-only concerns:
 *   - every `Platform.OS === 'web'` branch (`@rn-primitives/select` already
 *     resolves its own web build by file extension)
 *   - `FullWindowOverlay` — its job is "paint above the screen container", and
 *     <PortalHost>'s placement in app/_layout.tsx already guarantees that
 *   - the exiting animation: a portalled subtree unmounts synchronously, which
 *     is the flaky half of Reanimated's layout animations
 *   - SelectGroup / SelectLabel / the scroll buttons — nothing here groups
 *     options, and the buttons are web-only no-ops
 *
 * The popover paints above the native stack header because <PortalHost /> is a
 * later sibling of the <View> holding <Stack>. Android's hardware back closes
 * it (the primitive's Content registers its own BackHandler).
 */
import { Ionicons } from '@expo/vector-icons';
import * as SelectPrimitive from '@rn-primitives/select';
import * as React from 'react';
import { View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Select = SelectPrimitive.Root;

function SelectTrigger({
  className = '',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { className?: string }) {
  return (
    <SelectPrimitive.Trigger
      className={`flex-row items-center justify-between gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 ${props.disabled ? 'opacity-50' : ''} ${className}`}
      {...props}
    >
      <>{children}</>
      <Ionicons name="chevron-down" size={16} color="#9ca3af" />
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({
  className = '',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value> & { className?: string }) {
  const { value } = SelectPrimitive.useRootContext();
  return (
    <SelectPrimitive.Value
      className={`text-base ${value ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'} ${className}`}
      {...props}
    />
  );
}

/** Caps the popover so a long list can never span the whole screen — and so
 *  `avoidCollisions` never has to fight the ActiveSessionBar, which is not a
 *  safe-area inset and which the portal knows nothing about. */
const MAX_POPOVER_HEIGHT = 288;

function SelectContent({
  className = '',
  children,
  position = 'popper',
  portalHost,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  className?: string;
  portalHost?: string;
}) {
  // Safe here: <PortalHost /> sits under <SafeAreaProvider>.
  const insets = useSafeAreaInsets();
  return (
    <SelectPrimitive.Portal hostName={portalHost}>
      <SelectPrimitive.Overlay style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} asChild>
        <Animated.View className="z-50 bg-black/40" entering={FadeIn.duration(120)}>
          <SelectPrimitive.Content
            insets={{ top: insets.top + 8, bottom: insets.bottom + 8, left: 12, right: 12 }}
            position={position}
            sideOffset={4}
            className={`z-50 min-w-[8rem] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg ${className}`}
            {...props}
          >
            <ScrollView style={{ maxHeight: MAX_POPOVER_HEIGHT }} bounces={false}>
              <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
            </ScrollView>
          </SelectPrimitive.Content>
        </Animated.View>
      </SelectPrimitive.Overlay>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className = '',
  label,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { className?: string }) {
  return (
    <SelectPrimitive.Item
      label={label}
      className={`flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5 active:bg-blue-50 dark:active:bg-blue-900/40 ${props.disabled ? 'opacity-50' : ''} ${className}`}
      {...props}
    >
      <SelectPrimitive.ItemText className="text-base text-gray-900 dark:text-gray-100" />
      <SelectPrimitive.ItemIndicator asChild>
        <View>
          <Ionicons name="checkmark" size={18} color="#2563eb" />
        </View>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
