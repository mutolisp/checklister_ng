/**
 * 匯出設定 —— was a bottom sheet with a 「完成」 button that only dismissed it.
 * Every control writes straight through to settings, so there was nothing to
 * confirm and nothing to cancel; as a pushed route the back chevron is the
 * whole interaction.
 */
import { ScrollView } from 'react-native';
import { ExportPreferenceOptions } from '~/components/ExportPreferenceOptions';
import { SettingsPage } from '~/components/settings/SettingsPage';

export default function ExportSettingsScreen() {
  return (
    <SettingsPage>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <ExportPreferenceOptions />
      </ScrollView>
    </SettingsPage>
  );
}
