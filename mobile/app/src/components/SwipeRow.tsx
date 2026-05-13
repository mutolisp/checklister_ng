import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

type Props = {
  children: ReactNode;
  /** Called when user fully swipes left (i.e. trailing action triggered) */
  onDelete: () => void;
  /** Optional label shown next to the trash icon */
  label?: string;
};

/**
 * Standard left-swipe to delete row pattern used across the app.
 * Wraps content in a Swipeable that reveals a red delete action on the trailing edge.
 */
export function SwipeRow({ children, onDelete, label = '刪除' }: Props) {
  return (
    <Swipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View className="flex-row items-center justify-end bg-red-600 px-6">
          <Ionicons name="trash" size={20} color="white" />
          <Text className="ml-2 text-sm font-medium text-white">{label}</Text>
        </View>
      )}
      onSwipeableOpen={() => onDelete()}
    >
      {children}
    </Swipeable>
  );
}
