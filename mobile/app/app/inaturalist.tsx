/**
 * iNaturalist 帳號頁 — link / refresh / unlink the 24 h token, plus the
 * default geoprivacy for uploads.
 *
 * Primary path: 「連結」 opens the login WebView (InatTokenHost) and reads
 * the token off /users/api_token. Fallback for accounts that sign in with
 * Google / Apple (blocked inside a WebView): open the same page in the real
 * browser, copy the JSON, paste it here.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SelectRow } from '~/components/settings/rows';
import { SettingsPage } from '~/components/settings/SettingsPage';
import { apiErrorMessage } from '~/lib/apiErrorMessage';
import {
  INAT_API_TOKEN_URL,
  getInatStatus,
  logoutInat,
  pasteInatToken,
  requestInatToken,
  type InatStatus,
} from '~/lib/inatAuth';
import { GEOPRIVACY_VALUES, type Geoprivacy } from '~/lib/inatPayload';
import { useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';
import { ACTION_FILL } from '~/lib/colors';

export default function InaturalistScreen() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const geoprivacy = useSettings((s) => s.inat_geoprivacy);
  const setSetting = useSettings((s) => s.set);
  const [status, setStatus] = useState<InatStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    void getInatStatus().then(setStatus);
  }, []);

  useFocusEffect(reload);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(t('inat.linkFailed', { msg: await apiErrorMessage(e) }));
    } finally {
      setBusy(false);
      reload();
    }
  };

  const handleConnect = () =>
    run(async () => {
      const r = await requestInatToken();
      if (r === 'ok') toast(t('inat.linked'));
    });

  const handlePaste = () =>
    run(async () => {
      const r = await pasteInatToken();
      toast(r === 'ok' ? t('inat.linked') : t('inat.pasteInvalid'));
    });

  const handleDisconnect = () => {
    Alert.alert(t('inat.disconnectConfirmTitle'), t('inat.disconnectConfirmMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('inat.disconnect'),
        style: 'destructive',
        onPress: () =>
          run(async () => {
            await logoutInat();
            toast(t('inat.disconnected'));
          }),
      },
    ]);
  };

  const geoLabel: Record<Geoprivacy, string> = {
    open: t('inat.geoprivacyOpen'),
    obscured: t('inat.geoprivacyObscured'),
    private: t('inat.geoprivacyPrivate'),
  };

  return (
    <SettingsPage>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text className="text-xs text-gray-500 dark:text-gray-400">{t('inat.intro')}</Text>

        <View className="mt-4 rounded-xl bg-white px-4 py-3 dark:bg-gray-900">
          {status ? (
            <>
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {status.login
                  ? t('inat.connectedAs', { login: status.login })
                  : t('inat.connected')}
              </Text>
              <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {status.usable && status.expiresAt
                  ? t('inat.tokenExpires', { time: new Date(status.expiresAt).toLocaleString() })
                  : t('inat.tokenExpired')}
              </Text>
              <View className="mt-3 flex-row gap-2">
                <Pressable
                  onPress={handleConnect}
                  disabled={busy}
                  className="flex-1 items-center rounded-lg border border-blue-500 py-2 active:bg-blue-50 dark:active:bg-blue-900/40"
                >
                  <Text className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {t('inat.refreshToken')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleDisconnect}
                  disabled={busy}
                  className="flex-1 items-center rounded-lg border border-red-400 py-2 active:bg-red-50 dark:active:bg-red-900/30"
                >
                  <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
                    {t('inat.disconnect')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('inat.notConnected')}
              </Text>
              <Pressable
                onPress={handleConnect}
                disabled={busy}
                className={`mt-3 items-center rounded-xl py-3 ${ACTION_FILL}`}
              >
                <Text className="text-base font-semibold text-white">{t('inat.connect')}</Text>
              </Pressable>
            </>
          )}
        </View>

        <Text className="mb-1 mt-6 px-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
          {t('inat.fallbackTitle')}
        </Text>
        <View className="rounded-xl bg-white dark:bg-gray-900">
          <Text className="px-4 pt-3 text-xs text-gray-500 dark:text-gray-400">
            {t('inat.fallbackHint')}
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(INAT_API_TOKEN_URL)}
            className="flex-row items-center border-b border-gray-100 px-4 py-3 active:bg-gray-50 dark:border-gray-800 dark:active:bg-gray-800"
          >
            <Ionicons name="open-outline" size={18} color="#2563eb" />
            <Text className="ml-2 text-base text-blue-600 dark:text-blue-400">
              {t('inat.openTokenPage')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handlePaste}
            disabled={busy}
            className="flex-row items-center px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Ionicons name="clipboard-outline" size={18} color="#2563eb" />
            <Text className="ml-2 text-base text-blue-600 dark:text-blue-400">
              {t('inat.pasteToken')}
            </Text>
          </Pressable>
        </View>

        {/* No uppercase section header here: the row labels itself, the way
            主題 / 卡片密度 do on the 偏好設定 root. The 其他方式 card above
            keeps its header because its rows carry no labels. */}
        <View className="mt-6 overflow-hidden rounded-xl">
          <SelectRow
            label={t('inat.geoprivacy')}
            value={geoprivacy}
            options={GEOPRIVACY_VALUES.map((g) => ({ value: g, label: geoLabel[g] }))}
            onChange={(v) => setSetting('inat_geoprivacy', v)}
            divider={false}
          />
        </View>
        <Text className="mt-1 px-1 text-xs text-gray-500 dark:text-gray-400">
          {t('inat.geoprivacyHint')}
        </Text>
      </ScrollView>
    </SettingsPage>
  );
}
