/**
 * Modal/sheet wrapper around SpeciesDetailPanel for contexts that don't have
 * inline space (taxonomy tree popup, key result, session list long-press).
 * Inline use cases (the search panel) render SpeciesDetailPanel directly.
 *
 * Sheet-local state: `currentResult` is seeded from `props.result`, but the
 * 「下級分類群」section can swap it to an infraspecies in-place. The parent's
 * `props.result` reset (e.g. set to null on close) re-seeds the local state
 * via the `useEffect` below. No history stack — picking a subordinate
 * replaces the visible taxon; closing the sheet ends the session.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SearchResult } from '~/db';
import { taxonSpeciesToSearchResult } from '~/lib/taxonSpecies';
import { SpeciesDetailPanel } from './SpeciesDetailPanel';

type Props = {
  result: SearchResult | null;
  onClose: () => void;
  onAddToSession: () => void;
  /** Override the add-button label (e.g. 「加入目前樣區」 when a plot is active). */
  addButtonLabel?: string;
};

export function LookupResultSheet({ result, onClose, onAddToSession, addButtonLabel }: Props) {
  const [currentResult, setCurrentResult] = useState<SearchResult | null>(result);

  // Re-seed local state whenever the parent passes a different taxon (or null
  // on close). Using taxon_id+name as the dependency catches the common case
  // where the parent flips between two distinct taxa without unmounting.
  useEffect(() => {
    setCurrentResult(result);
  }, [result?.taxon_id, result?.name]);

  if (!currentResult) return null;

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
              result={currentResult}
              onAddToSession={() => {
                onAddToSession();
                onClose();
              }}
              addButtonLabel={addButtonLabel}
              onClose={onClose}
              onPickSubordinate={(sp) => setCurrentResult(taxonSpeciesToSearchResult(sp))}
            />
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
