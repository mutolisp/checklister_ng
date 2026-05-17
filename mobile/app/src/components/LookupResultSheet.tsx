/**
 * Modal/sheet wrapper around SpeciesDetailPanel for contexts that don't have
 * inline space (taxonomy tree popup, key result, session list long-press).
 * Inline use cases (the search panel) render SpeciesDetailPanel directly.
 */
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SearchResult } from '~/db';
import { SpeciesDetailPanel } from './SpeciesDetailPanel';

type Props = {
  result: SearchResult | null;
  onClose: () => void;
  onAddToSession: () => void;
};

export function LookupResultSheet({ result, onClose, onAddToSession }: Props) {
  if (!result) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '85%' }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <SafeAreaView edges={['bottom']} className="flex-1">
            <View className="items-center pt-2">
              <View className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </View>
            <SpeciesDetailPanel
              result={result}
              onAddToSession={() => {
                onAddToSession();
                onClose();
              }}
              onClose={onClose}
            />
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
