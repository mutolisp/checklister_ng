import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { SpeciesSearchPanel } from '~/components/SpeciesSearchPanel';

export default function LookupScreen() {
  const headerHeight = useHeaderHeight();
  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50">
      <Stack.Screen options={{ title: '物種查詢' }} />
      <SpeciesSearchPanel keyboardOffset={headerHeight} autoFocus />
    </SafeAreaView>
  );
}
