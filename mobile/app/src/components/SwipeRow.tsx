import { Ionicons } from '@expo/vector-icons';
import { useRef, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

type Props = {
  children: ReactNode;
  /** Fires when the user TAPS the revealed delete button. Previously this
   *  fired the moment swipe opened (onSwipeableOpen), which made the parent's
   *  confirm Alert pop up mid-gesture — users had no chance to back out by
   *  just swiping back closed. */
  onDelete: () => void;
  /** Optional label shown next to the trash icon */
  label?: string;
};

/**
 * Standard left-swipe to delete row pattern used across the app.
 * Wraps content in a Swipeable that reveals a red delete BUTTON on the
 * trailing edge. The button must be tapped explicitly to fire `onDelete`.
 */
export function SwipeRow({ children, onDelete, label = '刪除' }: Props) {
  const ref = useRef<Swipeable>(null);
  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            // Close the swipe first so the row reverts visually whether the
            // caller's confirm Alert is accepted or cancelled.
            ref.current?.close();
            onDelete();
          }}
          className="flex-row items-center justify-end bg-red-600 px-6 active:bg-red-700"
        >
          <Ionicons name="trash" size={20} color="white" />
          <Text className="ml-2 text-sm font-medium text-white">{label}</Text>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  );
}
