/**
 * Reusable species search panel: full-text + fuzzy search + LookupResultSheet.
 *
 * Used by:
 *   - /lookup screen (drawer menu entry)
 *   - (tabs)/taxonomy.tsx (Search segment) — incremental Step 4-3
 *
 * Owns its KeyboardAvoidingView so it can be embedded in different chrome
 * (stack header vs. tab bar). Callers pass keyboardOffset based on context.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { addRecord, addSearchHistory, isTaxonInSession, type SearchResult } from '~/db';
import { LookupResultSheet } from './LookupResultSheet';
import { SearchBox } from './SearchBox';
import { useActiveSession } from '~/stores/activeSession';
import { useToast } from '~/stores/toast';

type Props = {
  /** Pixels to offset KAV — header height for stack screens, tab bar height for tabs. */
  keyboardOffset: number;
  autoFocus?: boolean;
};

export function SpeciesSearchPanel({ keyboardOffset, autoFocus = false }: Props) {
  const router = useRouter();
  const session = useActiveSession((s) => s.session);
  const start = useActiveSession((s) => s.start);
  const refreshActive = useActiveSession((s) => s.refresh);
  const toast = useToast((s) => s.show);
  const [active, setActive] = useState<SearchResult | null>(null);

  const handleSelect = (result: SearchResult) => {
    addSearchHistory(result.cname || result.name);
    setActive(result);
  };

  const handleAddToSession = () => {
    if (!active?.taxon_id) {
      toast('此物種無 taxon_id');
      return;
    }
    const target = session ?? start();
    if (isTaxonInSession(target.id, active.taxon_id)) {
      toast(`已存在於當前 session：${active.cname || active.name}`);
      return;
    }
    addRecord({ session_id: target.id, taxon_id: active.taxon_id });
    refreshActive();
    toast(`已加入：${active.cname || active.name}`, {
      action: { label: '前往', onPress: () => router.push(`/session/${target.id}`) },
    });
  };

  return (
    <>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardOffset : 0}
      >
        <View className="flex-1 bg-white" />
        <SearchBox onSelect={handleSelect} onLongPressResult={setActive} autoFocus={autoFocus} />
      </KeyboardAvoidingView>
      <LookupResultSheet
        result={active}
        onClose={() => setActive(null)}
        onAddToSession={handleAddToSession}
      />
    </>
  );
}
