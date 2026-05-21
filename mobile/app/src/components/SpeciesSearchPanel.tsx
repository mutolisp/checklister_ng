/**
 * Reusable species search panel: full-text + fuzzy search with the detail
 * rendered inline above the search box (no modal). Tapping a result fills the
 * empty area with SpeciesDetailPanel; users can dismiss with the X or just
 * pick another result. Add-to-session clears the panel so the next search is
 * one tap away — this is the field-recording happy path.
 *
 * Used by:
 *   - (tabs)/taxonomy.tsx (Search segment)
 */
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Keyboard, Text, View } from 'react-native';
import { KeyboardStickyView } from './KeyboardAvoidingView';
import {
  addRecord,
  addSearchHistory,
  isTaxonInSession,
  type SearchResult,
} from '~/db';
import { useActiveSession } from '~/stores/activeSession';
import { useSpeciesSearchPanel } from '~/stores/speciesSearchPanel';
import { useToast } from '~/stores/toast';
import { taxonSpeciesToSearchResult } from '~/lib/taxonSpecies';
import { SearchBox } from './SearchBox';
import { SpeciesDetailPanel } from './SpeciesDetailPanel';

type Props = {
  autoFocus?: boolean;
};

export function SpeciesSearchPanel({ autoFocus = false }: Props) {
  const router = useRouter();
  const session = useActiveSession((s) => s.session);
  const start = useActiveSession((s) => s.start);
  const refreshActive = useActiveSession((s) => s.refresh);
  const toast = useToast((s) => s.show);
  // KSV opened-offset so SearchBox sits flush against the keyboard top (without
  // this it floats `tabBarHeight` above the keyboard — see same fix in
  // taxonomy.tsx tree segment + KeyListView).
  const tabBarHeight = useBottomTabBarHeight();
  // `active` lives in a module-level store so it survives segment switches
  // inside the 物種 tab. Without persistence, tapping a rank chip on the
  // inline detail forces the segment to 'tree' (cross-screen jump), which
  // unmounts this panel and wipes the local detail state — coming back to
  // 'search' shows an empty panel. The store keeps the prior detail visible.
  const active = useSpeciesSearchPanel((s) => s.active);
  const setActive = useSpeciesSearchPanel((s) => s.setActive);

  const handleSelect = (result: SearchResult) => {
    addSearchHistory(result.cname || result.name);
    Keyboard.dismiss();
    setActive(result);
  };

  const handleLongPress = (result: SearchResult) => {
    Keyboard.dismiss();
    setActive(result);
  };

  const handleAddToSession = () => {
    if (!active?.taxon_id) {
      toast('此物種無 taxon_id');
      return;
    }
    const target = session ?? start();
    if (isTaxonInSession(target.id, active.taxon_id)) {
      toast(`已存在於當前記錄：${active.cname || active.name}`);
      return;
    }
    addRecord({ session_id: target.id, taxon_id: active.taxon_id });
    refreshActive();
    toast(`已加入：${active.cname || active.name}`, {
      action: { label: '前往', onPress: () => router.push(`/session/${target.id}`) },
    });
    // Clear the inline detail so the next search is one tap away.
    setActive(null);
  };

  return (
    <View className="flex-1">
      <View className="flex-1 bg-white dark:bg-gray-900">
        {active ? (
          <SpeciesDetailPanel
            result={active}
            onAddToSession={handleAddToSession}
            onClose={() => setActive(null)}
            onPickSubordinate={(sp) => setActive(taxonSpeciesToSearchResult(sp))}
          />
        ) : (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search-outline" size={48} color="#cbd5e1" />
            <Text className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
              下方輸入俗名 / 學名 / 科名搜尋物種，{'\n'}選擇結果後在此檢視詳細資訊。
            </Text>
          </View>
        )}
      </View>
      <KeyboardStickyView offset={{ opened: tabBarHeight }}>
        <SearchBox
          onSelect={handleSelect}
          onLongPressResult={handleLongPress}
          autoFocus={autoFocus}
          afterSelect="dismiss"
        />
      </KeyboardStickyView>
    </View>
  );
}
