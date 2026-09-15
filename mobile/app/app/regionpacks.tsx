/**
 * 國家名錄 pack 管理頁。
 *
 * A pack = one country's GBIF SPECIES_LIST download (optionally narrowed to
 * taxon groups), imported into regionpacks.db so that country's species are
 * searchable offline. Creation needs the user's own (free) GBIF account for
 * exactly one call — the download request; polling and the file itself are
 * public, so an interrupted download resumes without the password.
 *
 * Taiwan is blocked here (the bundled TaiCOL checklist IS the Taiwan list),
 * and Japan-with-only-plants is redirected to the bundled YList overlay.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Linking, Modal, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsPage } from '~/components/settings/SettingsPage';
import { promptText } from '~/components/TextPromptModal';
import { SwipeRow } from '~/components/SwipeRow';
import { ApiError } from '~/lib/apiFetch';
import { COUNTRIES, countryName, type Country } from '~/lib/countries';
import {
  clearGbifCredentials,
  loadGbifCredentials,
  saveGbifCredentials,
  type GbifCredentials,
} from '~/lib/gbifCredentials';
import {
  drivePack,
  isPackRunning,
  requestSpeciesListDownload,
  usePackDownloads,
} from '~/lib/gbifDownload';
import { ICONIC_TAXA, type IconicTaxon } from '~/lib/inat';
import { useSettings, type RegionCode } from '~/stores/settings';
import { useToast } from '~/stores/toast';
import {
  createPack,
  deletePack,
  invalidatePackCache,
  listPacks,
  updatePack,
  type RegionPack,
} from '~/db/regionpacks';
import { clearTaxonomyCache } from '~/db';
import { clearSearchResultCache } from '~/components/SearchBox';

export default function RegionPacksScreen() {
  const { t, i18n } = useTranslation();
  const toast = useToast((s) => s.show);
  const settings = useSettings();
  const [packs, setPacks] = useState<RegionPack[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Live progress comes from the module-level driver (survives navigation);
  // subscribing here is what re-renders the rows while a download runs.
  const progress = usePackDownloads((st) => st.progress);

  const reload = useCallback(() => {
    try {
      setPacks(listPacks());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[regionpacks] list failed:', e);
    }
  }, []);
  useFocusEffect(useCallback(() => reload(), [reload]));
  // A pack finishing (or failing) removes its progress key — refresh the DB
  // rows so status/species-count update without leaving the screen.
  const runningCount = Object.keys(progress).length;
  useEffect(() => reload(), [runningCount, reload]);

  // ── Unified region rows: built-in TW / JP + downloaded packs ──
  const enabledRegions = useSettings((st) => st.enabled_regions);
  const setSetting = useSettings((st) => st.set);
  /** Everything that toggles dataset scope invalidates the same caches. */
  const afterScopeChange = useCallback(() => {
    clearTaxonomyCache();
    clearSearchResultCache();
  }, []);
  // "At least one source stays enabled" — counted across built-ins AND ready
  // packs, enforced here (the DB layer deliberately allows any combination).
  const enabledSourceCount =
    enabledRegions.length + packs.filter((pk) => pk.enabled && pk.status === 'ready').length;
  const toggleBuiltin = useCallback(
    (code: RegionCode, on: boolean) => {
      const next: RegionCode[] = on
        ? code === 'TW'
          ? ['TW', ...enabledRegions.filter((r) => r !== 'TW')]
          : [...enabledRegions.filter((r) => r !== 'JP'), 'JP']
        : enabledRegions.filter((r) => r !== code);
      setSetting('enabled_regions', next);
      afterScopeChange();
    },
    [afterScopeChange, enabledRegions, setSetting],
  );
  type RegionRow = { kind: 'builtin'; code: RegionCode } | { kind: 'pack'; pack: RegionPack };
  const rows: RegionRow[] = [
    { kind: 'builtin', code: 'TW' },
    { kind: 'builtin', code: 'JP' },
    ...packs.map((pack) => ({ kind: 'pack' as const, pack })),
  ];


  /**
   * Saved credentials first (opt-in file, never inside user.db backups), else
   * prompt. The GBIF API authenticates with the USERNAME only — the website
   * accepts email, the API does not (techdocs, api-downloads) — so an '@' in
   * the input gets an explanation and a fresh prompt instead of a confusing
   * 401 later.
   */
  const obtainCredentials = useCallback(
    async (forcePrompt: boolean): Promise<{ creds: GbifCredentials; fromStore: boolean } | null> => {
      if (!forcePrompt) {
        const stored = await loadGbifCredentials();
        if (stored) return { creds: stored, fromStore: true };
      }
      let defaultName = settings.gbif_username;
      for (;;) {
        const username = (
          await promptText({
            title: t('regionPacks.gbifUserTitle'),
            message: t('regionPacks.gbifUserMsg'),
            defaultValue: defaultName,
            autoCapitalize: 'none',
          })
        )?.trim();
        if (!username) return null;
        if (username.includes('@')) {
          defaultName = username;
          await new Promise<void>((resolve) =>
            // Wait out the prompt Modal's dismissal before the Alert presents.
            setTimeout(
              () =>
                Alert.alert(t('regionPacks.emailNotAllowedTitle'), t('regionPacks.emailNotAllowedMsg'), [
                  { text: t('common.confirm'), onPress: () => resolve() },
                ]),
              450,
            ),
          );
          await new Promise<void>((r) => setTimeout(r, 450));
          continue;
        }
        const password = await promptText({
          title: t('regionPacks.gbifPassTitle'),
          message: t('regionPacks.gbifPassMsg'),
          autoCapitalize: 'none',
          secureTextEntry: true,
        });
        if (!password) return null;
        return { creds: { username, password }, fromStore: false };
      }
    },
    [settings, t],
  );

  /** After a request that proved the credentials work, offer to keep them. */
  const offerSavePassword = useCallback(
    (creds: GbifCredentials) => {
      setTimeout(
        () =>
          Alert.alert(t('regionPacks.savePwTitle'), t('regionPacks.savePwMsg'), [
            { text: t('regionPacks.savePwNo'), style: 'cancel' },
            { text: t('regionPacks.savePwYes'), onPress: () => saveGbifCredentials(creds) },
          ]),
        450,
      );
    },
    [t],
  );

  /**
   * (Re)submit the download request for a pack. Shared by create and the
   * retry button on failed packs — a failed pack keeps its country/groups, so
   * retrying never re-walks the pickers.
   */
  const submitRequest = useCallback(
    async (pack: RegionPack, forcePrompt = false) => {
      const got = await obtainCredentials(forcePrompt);
      if (!got) return;
      settings.set('gbif_username', got.creds.username);
      // Completion email (optional): GBIF mails when the file is ready — the
      // only channel that works while the app is backgrounded. Skipped when
      // saved credentials + a saved email already cover it; cancel keeps the
      // stored value instead of aborting the whole request.
      let notifyEmail = settings.gbif_notify_email;
      if (!got.fromStore || !notifyEmail) {
        const entered = await promptText({
          title: t('regionPacks.notifyEmailTitle'),
          message: t('regionPacks.notifyEmailMsg'),
          defaultValue: notifyEmail,
          keyboardType: 'email-address',
          autoCapitalize: 'none',
          allowEmpty: true,
        });
        if (entered != null) {
          notifyEmail = entered.trim();
          settings.set('gbif_notify_email', notifyEmail);
        }
      }
      try {
        const key = await requestSpeciesListDownload(
          pack.country_code,
          pack.groups as IconicTaxon[],
          got.creds.username,
          got.creds.password,
          notifyEmail || undefined,
        );
        updatePack(pack.id, { gbif_download_key: key, status: 'requested', error: null });
        reload();
        toast(t('regionPacks.requested'));
        if (!got.fromStore) offerSavePassword(got.creds);
        drivePack(pack.id);
      } catch (e) {
        const is401 = e instanceof ApiError && e.status === 401;
        if (is401) clearGbifCredentials(); // stale saved password must not loop forever
        const msg = is401
          ? t('regionPacks.badCredentials')
          : e instanceof ApiError && e.detail
            ? `${e.message}: ${e.detail}`
            : String((e as Error)?.message ?? e);
        updatePack(pack.id, { status: 'failed', error: msg });
        reload();
        setTimeout(() => Alert.alert(t('regionPacks.requestFailed'), msg), 450);
      }
    },
    [obtainCredentials, offerSavePassword, reload, settings, t, toast],
  );

  const startCreate = useCallback(
    async (country: Country, groups: IconicTaxon[]) => {
      const pack = createPack(country.code, groups);
      reload();
      await submitRequest(pack);
    },
    [reload, submitRequest],
  );

  const handlePicked = useCallback(
    (country: Country) => {
      setPickerOpen(false);
      // iOS refuses to present a Modal/Alert while the previous Modal is still
      // dismissing — it silently never shows. Same 450 ms wait the export
      // share-sheet path uses.
      setTimeout(() => {
        if (country.code === 'TW') {
          Alert.alert(t('regionPacks.builtinTitle'), t('regionPacks.builtinTaiwan'));
          return;
        }
        openGroupChooser(country);
      }, 450);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  // ── Group chooser modal state ──
  const [groupCountry, setGroupCountry] = useState<Country | null>(null);
  const [chosenGroups, setChosenGroups] = useState<Set<IconicTaxon>>(new Set());
  const openGroupChooser = (country: Country) => {
    setChosenGroups(new Set());
    setGroupCountry(country);
  };
  const confirmGroups = () => {
    const country = groupCountry;
    if (!country) return;
    const groups = [...chosenGroups];
    if (country.code === 'JP' && groups.length === 1 && groups[0] === 'Plantae') {
      Alert.alert(t('regionPacks.builtinTitle'), t('regionPacks.builtinJapanPlants'));
      return;
    }
    setGroupCountry(null);
    // Wait out this Modal's dismissal before the TextPromptHost Modal presents.
    setTimeout(() => void startCreate(country, groups), 450);
  };

  const handleDelete = (pack: RegionPack) => {
    Alert.alert(
      t('regionPacks.deleteTitle'),
      t('regionPacks.deleteMsg', { name: countryName(pack.country_code, i18n.language) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deletePack(pack.id);
            invalidatePackCache();
            reload();
          },
        },
      ],
    );
  };

  const statusLine = (pack: RegionPack): string => {
    const p = progress[pack.id];
    if (p) {
      if (p.phase === 'waiting') {
        // GBIF's status API has no percentage during PREPARING/RUNNING;
        // elapsed time is the only real progress signal there is.
        const min = Math.floor(p.elapsedMs / 60000);
        const elapsed =
          min >= 1
            ? t('regionPacks.elapsedMin', { n: min })
            : t('regionPacks.elapsedSec', { n: Math.max(1, Math.round(p.elapsedMs / 1000)) });
        return t('regionPacks.waiting', { status: p.gbifStatus, elapsed });
      }
      if (p.phase === 'downloading') {
        const mb = (p.receivedBytes / 1048576).toFixed(1);
        return p.totalBytes
          ? t('regionPacks.downloadingPct', {
              pct: Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100)),
              mb,
            })
          : t('regionPacks.downloadingMb', { mb });
      }
      if (p.phase === 'importing')
        return t('regionPacks.importing', { done: p.done, total: p.total });
    }
    switch (pack.status) {
      case 'ready':
        return t('regionPacks.readyCount', { count: pack.species_count ?? 0 });
      case 'failed':
        return `${t('regionPacks.failed')}${pack.error ? `：${pack.error}` : ''}`;
      case 'importing':
      case 'running':
      case 'requested':
        return t('regionPacks.pending');
    }
  };

  const groupLabels = (pack: RegionPack): string =>
    pack.groups.length === 0
      ? t('regionPacks.allGroups')
      : pack.groups.map((g) => t(`areaSpecies.iconic.${g}`)).join('、');

  const renderBuiltin = (code: RegionCode) => {
    const on = enabledRegions.includes(code);
    const isLast = on && enabledSourceCount <= 1;
    return (
      <View className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
        <View className="flex-1">
          <Text className="text-base font-medium text-gray-900 dark:text-gray-100">
            {t(code === 'TW' ? 'regionPacks.builtinTwName' : 'regionPacks.builtinJpName')}
            <Text className="text-xs text-gray-400">  {t('regionPacks.builtinTag')}</Text>
          </Text>
          <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t(code === 'TW' ? 'regionPacks.builtinTwSub' : 'regionPacks.builtinJpSub')}
          </Text>
        </View>
        <Switch
          value={on}
          disabled={isLast}
          onValueChange={(v) => {
            if (!v && isLast) return;
            toggleBuiltin(code, v);
          }}
        />
      </View>
    );
  };

  const renderPack = ({ item }: { item: RegionPack }) => {
    const busy = isPackRunning(item.id);
    // A live key means the queued download can simply be polled again; a
    // failed or key-less pack needs a fresh request (with credentials).
    const resumable =
      !busy && item.status !== 'ready' && item.status !== 'failed' && item.gbif_download_key != null;
    const retryable = !busy && item.status !== 'ready' && !resumable;
    return (
      <SwipeRow onDelete={() => handleDelete(item)} label={t('common.delete')}>
        <Pressable
          // Re-fetch + re-import from the SAME download key (the file stays on
          // GBIF's servers) — the rescue path for a pack whose import went
          // wrong, without re-queueing a new request.
          onLongPress={
            !busy && item.gbif_download_key
              ? () =>
                  Alert.alert(t('regionPacks.reimportTitle'), t('regionPacks.reimportMsg'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('regionPacks.reimportGo'), onPress: () => drivePack(item.id) },
                  ])
              : undefined
          }
          delayLongPress={350}
          className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <View className="flex-row items-center">
            <View className="flex-1">
              <Text className="text-base font-medium text-gray-900 dark:text-gray-100">
                {countryName(item.country_code, i18n.language)}
                <Text className="text-xs text-gray-400"> {item.country_code}</Text>
              </Text>
              <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {groupLabels(item)}
              </Text>
              <Text
                className={`mt-0.5 text-xs ${item.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
                numberOfLines={2}
              >
                {statusLine(item)}
              </Text>
            </View>
            {item.status === 'ready' ? (
              <Switch
                value={item.enabled}
                onValueChange={(on) => {
                  updatePack(item.id, { enabled: on });
                  invalidatePackCache();
                  afterScopeChange();
                  reload();
                }}
                disabled={item.enabled && enabledSourceCount <= 1}
              />
            ) : resumable ? (
              <Pressable
                onPress={() => drivePack(item.id)}
                hitSlop={8}
                className="rounded-full bg-blue-500 px-3 py-1.5 active:bg-blue-600"
                accessibilityLabel={t('regionPacks.resume')}
              >
                <Text className="text-xs font-medium text-white">{t('regionPacks.resume')}</Text>
              </Pressable>
            ) : retryable ? (
              <Pressable
                onPress={() => void submitRequest(item)}
                hitSlop={8}
                className="rounded-full bg-orange-500 px-3 py-1.5 active:bg-orange-600"
                accessibilityLabel={t('regionPacks.retry')}
              >
                <Text className="text-xs font-medium text-white">{t('regionPacks.retry')}</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </SwipeRow>
    );
  };

  return (
    <SettingsPage>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'builtin' ? `builtin-${r.code}` : `pack-${r.pack.id}`)}
        renderItem={({ item }) =>
          item.kind === 'builtin' ? renderBuiltin(item.code) : renderPack({ item: item.pack })}
        ListHeaderComponent={
          <View className="px-4 py-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {t('regionPacks.intro')}
              <Text
                // Nested-Text link: opens GBIF's login/register page in the
                // browser for users without an account yet.
                onPress={() => void Linking.openURL('https://www.gbif.org/user/profile')}
                className="text-blue-600 dark:text-blue-400"
              >
                {t('regionPacks.introRegister')}
              </Text>
              {t('regionPacks.introEnd')}
            </Text>
            <Pressable
              onPress={() => void Linking.openURL('https://www.gbif.org/user/download')}
              hitSlop={6}
              className="mt-2 flex-row items-center"
              accessibilityRole="link"
            >
              <Ionicons name="open-outline" size={14} color="#2563eb" />
              <Text className="ml-1 text-xs text-blue-600 dark:text-blue-400">
                {t('regionPacks.openGbifWeb')}
              </Text>
            </Pressable>
          </View>
        }
      />
      <View className="px-4 pb-2 pt-2">
        <Pressable
          onPress={() => setPickerOpen(true)}
          className="items-center rounded-xl bg-blue-500 py-3 active:bg-blue-600"
        >
          <Text className="text-base font-semibold text-white">{t('regionPacks.add')}</Text>
        </Pressable>
      </View>

      <CountryPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePicked}
      />
      <GroupChooserModal
        country={groupCountry}
        chosen={chosenGroups}
        onToggle={(g) =>
          setChosenGroups((prev) => {
            const next = new Set(prev);
            if (next.has(g)) next.delete(g);
            else next.add(g);
            return next;
          })
        }
        onCancel={() => setGroupCountry(null)}
        onConfirm={confirmGroups}
      />
    </SettingsPage>
  );
}

function CountryPickerModal({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (c: Country) => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const zh = i18n.language.startsWith('zh');
  const data = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...COUNTRIES].sort((a, b) =>
      (zh ? a.zh : a.en).localeCompare(zh ? b.zh : b.en, i18n.language),
    );
    if (!needle) return all;
    return all.filter(
      (c) =>
        c.zh.toLowerCase().includes(needle) ||
        c.en.toLowerCase().includes(needle) ||
        c.code.toLowerCase() === needle,
    );
  }, [q, zh, i18n.language]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-white dark:bg-gray-900"
      >
        <View className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3">
          <Text className="flex-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('regionPacks.pickCountry')}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={22} color="#6b7280" />
          </Pressable>
        </View>
        <View className="px-4 py-2">
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('regionPacks.searchCountry')}
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100"
          />
        </View>
        <FlatList
          data={data}
          keyExtractor={(c) => c.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 active:bg-blue-50 dark:active:bg-blue-900/40"
            >
              <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">
                {zh ? item.zh : item.en}
              </Text>
              <Text className="text-xs text-gray-400">{item.code}</Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

function GroupChooserModal({
  country,
  chosen,
  onToggle,
  onCancel,
  onConfirm,
}: {
  country: Country | null;
  chosen: Set<IconicTaxon>;
  onToggle: (g: IconicTaxon) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const coarse = chosen.has('Reptilia') || chosen.has('Actinopterygii');
  return (
    <Modal visible={country != null} animationType="slide" onRequestClose={onCancel}>
      <View style={{ paddingTop: insets.top }} className="flex-1 bg-white dark:bg-gray-900">
        <View className="flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3">
          <Text className="flex-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {country ? countryName(country.code, i18n.language) : ''}
          </Text>
          <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={22} color="#6b7280" />
          </Pressable>
        </View>
        <View className="px-4 py-3">
          <Text className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            {t('areaSpecies.groups')}
          </Text>
          <Text className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            {t('regionPacks.groupsHint')}
          </Text>
          <View className="mb-2 flex-row flex-wrap gap-2">
            {ICONIC_TAXA.map((k) => {
              const on = chosen.has(k);
              return (
                <Pressable
                  key={k}
                  onPress={() => onToggle(k)}
                  className={`rounded-full border px-3 py-1.5 ${
                    on
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
                  }`}
                >
                  <Text className={`text-xs ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                    {t(`areaSpecies.iconic.${k}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {coarse ? (
            <Text className="mb-2 text-xs text-amber-700 dark:text-amber-400">
              {t('areaSpecies.gbifCoarseGroup')}
            </Text>
          ) : null}
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            {t('regionPacks.qualityNote')}
          </Text>
        </View>
        <View className="mt-auto px-4 pb-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <Pressable
            onPress={onConfirm}
            className="items-center rounded-xl bg-blue-500 py-3 active:bg-blue-600"
          >
            <Text className="text-base font-semibold text-white">
              {t('regionPacks.startDownload')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
