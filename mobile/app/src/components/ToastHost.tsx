import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '~/stores/toast';

export function ToastHost() {
  const current = useToast((s) => s.current);
  const dismiss = useToast((s) => s.dismiss);

  if (!current) return null;

  return (
    <SafeAreaView pointerEvents="box-none" className="absolute inset-x-0 bottom-24 items-center">
      <View className="mx-4 flex-row items-center rounded-lg bg-gray-900 px-4 py-3 shadow-lg">
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
    </SafeAreaView>
  );
}
