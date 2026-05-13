/**
 * Cross-platform ActionSheet — replacement for direct `ActionSheetIOS.show…`.
 *
 * On iOS we still use the native ActionSheetIOS so the UI matches HIG; on
 * Android we render a bottom-sheet Modal with the same option list. Both
 * paths return a Promise<number> that resolves with the chosen option's
 * index, or -1 when the user cancelled.
 *
 *   const i = await showActionSheet({
 *     title: '建立記錄',
 *     options: [
 *       { label: '快速名錄' },
 *       { label: '樣區調查' },
 *       { label: '刪除', destructive: true },
 *     ],
 *   });
 *   if (i >= 0) doSomething(i);
 *
 * The host (`<ActionSheetHost />`) must be mounted near the navigation root
 * so the Android modal renders above all screens.
 */
import { ActionSheetIOS, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';

export type ActionSheetOption = {
  label: string;
  /** Tinted red on both platforms. */
  destructive?: boolean;
};

export type ActionSheetRequest = {
  title?: string;
  message?: string;
  options: ActionSheetOption[];
  cancelLabel?: string;
};

type PendingRequest = ActionSheetRequest & {
  resolve: (index: number) => void;
};

type SheetStoreState = {
  pending: PendingRequest | null;
  open: (req: PendingRequest) => void;
  resolve: (index: number) => void;
};

const useSheetStore = create<SheetStoreState>((set, get) => ({
  pending: null,
  open: (req) => set({ pending: req }),
  resolve: (index) => {
    const p = get().pending;
    if (p) p.resolve(index);
    set({ pending: null });
  },
}));

/** Imperative API. Resolves with chosen option index, or -1 if cancelled. */
export function showActionSheet(req: ActionSheetRequest): Promise<number> {
  return new Promise<number>((resolve) => {
    if (Platform.OS === 'ios') {
      const labels = req.options.map((o) => o.label);
      const cancelIdx = labels.length;
      const destructiveIdx = req.options.findIndex((o) => o.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: req.title,
          message: req.message,
          options: [...labels, req.cancelLabel ?? '取消'],
          cancelButtonIndex: cancelIdx,
          destructiveButtonIndex: destructiveIdx >= 0 ? destructiveIdx : undefined,
        },
        (idx) => {
          if (idx === cancelIdx || idx == null || idx < 0) resolve(-1);
          else resolve(idx);
        },
      );
    } else {
      useSheetStore.getState().open({ ...req, resolve });
    }
  });
}

export function ActionSheetHost() {
  const pending = useSheetStore((s) => s.pending);
  const resolve = useSheetStore((s) => s.resolve);

  if (!pending) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => resolve(-1)}>
      <View className="flex-1">
        <Pressable
          onPress={() => resolve(-1)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        <SafeAreaView edges={['bottom']} className="mt-auto">
          <View className="mx-3 mb-2 rounded-2xl bg-white">
            {pending.title || pending.message ? (
              <View className="border-b border-gray-100 px-4 py-3">
                {pending.title ? (
                  <Text className="text-center text-sm font-semibold text-gray-900">
                    {pending.title}
                  </Text>
                ) : null}
                {pending.message ? (
                  <Text className="mt-0.5 text-center text-xs text-gray-500">
                    {pending.message}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {pending.options.map((opt, i) => (
              <Pressable
                key={i}
                onPress={() => resolve(i)}
                className={`items-center justify-center border-b border-gray-100 py-3.5 active:bg-gray-50 ${i === pending.options.length - 1 ? 'border-b-0' : ''}`}
              >
                <Text
                  className={`text-base ${opt.destructive ? 'font-semibold text-red-600' : 'text-blue-600'}`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="mx-3 mb-2 rounded-2xl bg-white">
            <Pressable
              onPress={() => resolve(-1)}
              className="items-center justify-center py-3.5 active:bg-gray-50"
            >
              <Text className="text-base font-semibold text-gray-900">
                {pending.cancelLabel ?? '取消'}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
