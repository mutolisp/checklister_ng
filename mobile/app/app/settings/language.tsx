/**
 * 語言 — the one settings list that is a screen rather than a dropdown.
 *
 * A pill row stopped scaling at 9 languages, and the search box is the way out
 * for a user stranded in a script they cannot read. Neither survives a popover:
 * it has no room for the `English · en` sublabel, and a TextInput inside a
 * portalled overlay fights the keyboard on iOS. A pushed route keeps both, and
 * the native back chevron is a dismissal affordance that needs no reading.
 */
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '~/components/settings/SettingsPage';
import { SearchableOptionList } from '~/components/SearchableOptionList';
import { LANGUAGE_CATALOGUE } from '~/i18n';
import { useSettings, type Language } from '~/stores/settings';

export default function LanguageScreen() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const setSetting = useSettings((s) => s.set);

  const options = [
    { value: 'system', label: t('settings.languageSystem'), sublabel: 'System' },
    // Endonyms: someone hunting for their language reads it in that language,
    // not in whichever one the UI is currently showing.
    ...LANGUAGE_CATALOGUE.map((l) => ({
      value: l.value,
      label: l.native,
      sublabel: `${l.english} · ${l.value}`,
    })),
  ];

  return (
    <SettingsPage>
      <SearchableOptionList
        options={options}
        value={language}
        onSelect={(v) => setSetting('language', v as Language)}
        searchPlaceholder={t('settings.languageSearch')}
      />
    </SettingsPage>
  );
}
