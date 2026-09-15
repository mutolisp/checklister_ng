/**
 * The WebView that fetches an iNaturalist JWT for `inatAuth.ts`.
 *
 * Mounted once at the navigation root. Two shapes:
 *   hidden  — a 1×1 off-screen WebView. Loads the api_token page; if the
 *             iNat session cookie is still valid the JSON comes back with no
 *             UI at all (the daily refresh).
 *   visible — a full-screen Modal with a close button, shown when the token
 *             page redirected to login and the caller allowed interaction.
 *             The user logs in on iNaturalist's OWN page. After login iNat
 *             lands on its home page (api_token's redirect keeps no return
 *             path), so we send the WebView back to api_token ourselves.
 *
 * Security rules — fixed, not props:
 *   • JS is injected on exactly one URL, the api_token page, to read
 *     `document.body.innerText`. Never on the login page: this component does
 *     not read forms.
 *   • Navigation is confined to https://www.inaturalist.org. Third-party
 *     sign-in (Google/Apple) will not work in here; the account page offers
 *     the browser + paste fallback for those accounts.
 *   • Not `incognito`: the session cookie must persist in the WebView store
 *     for silent refresh. 「解除連結」 loads /logout to invalidate it.
 *
 * Switching hidden → visible remounts the WebView (different parent). That is
 * fine: cookies live in the shared store, and the reload just replays
 * api_token → login.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import {
  INAT_API_TOKEN_URL,
  INAT_LOGOUT_URL,
  InatLoginRequired,
  useInatTokenFlow,
} from '~/lib/inatAuth';
import { parseTokenText } from '~/lib/inatJwt';

const INAT_ORIGIN = 'https://www.inaturalist.org';

/** A hidden fetch that has not produced a token by then is not going to;
 *  interactive flows get the page shown instead of a failure. */
const HIDDEN_TIMEOUT_MS = 25_000;
const LOGOUT_TIMEOUT_MS = 15_000;
/** Bounces we are willing to make from "some iNat page" back to api_token
 *  before concluding the site is not cooperating. */
const MAX_REDIRECTS = 4;

const READ_BODY_JS = `(function(){try{window.ReactNativeWebView.postMessage(document.body ? document.body.innerText : '');}catch(e){}})();true;`;
const GOTO_TOKEN_JS = `window.location.href = ${JSON.stringify(INAT_API_TOKEN_URL)}; true;`;

function stripQuery(url: string): string {
  return url.split('#')[0].split('?')[0].replace(/\/$/, '');
}

function isTokenUrl(url: string): boolean {
  return stripQuery(url) === INAT_API_TOKEN_URL;
}

function isLoginUrl(url: string): boolean {
  const path = stripQuery(url).replace(INAT_ORIGIN, '');
  return path === '/login' || path === '/users/sign_in' || path === '/session' || path.startsWith('/users/password');
}

export function InatTokenHost() {
  const pending = useInatTokenFlow((s) => s.pending);
  if (!pending) return null;
  // Keyed on purpose+mode so a mode switch gets a fresh WebView with fresh
  // per-attempt state (redirect counter, timers).
  return <FlowWebView key={`${pending.purpose}-${pending.mode}`} />;
}

function FlowWebView() {
  const pending = useInatTokenFlow((s) => s.pending);
  const show = useInatTokenFlow((s) => s.show);
  const finish = useInatTokenFlow((s) => s.finish);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const ref = useRef<WebView>(null);
  const redirects = useRef(0);
  const done = useRef(false);
  const [loading, setLoading] = useState(true);

  const purpose = pending?.purpose ?? 'token';
  const mode = pending?.mode ?? 'hidden';
  const interactive = pending?.interactive ?? false;

  const settle = (jwt: string | null, error?: Error) => {
    if (done.current) return;
    done.current = true;
    finish(jwt, error);
  };

  // Hidden flows must not hang forever on a page that never becomes JSON.
  useEffect(() => {
    if (mode !== 'hidden') return;
    const ms = purpose === 'logout' ? LOGOUT_TIMEOUT_MS : HIDDEN_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (done.current) return;
      if (purpose === 'logout') settle(null);
      else if (interactive) show();
      else settle(null, new InatLoginRequired('token page timed out'));
    }, ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, purpose, interactive]);

  if (!pending) return null;

  const onNavigationStateChange = (nav: WebViewNavigation) => {
    if (done.current || nav.loading) return;
    const url = nav.url ?? '';
    if (purpose === 'logout') {
      // Devise redirects to the home page after destroying the session; any
      // settled page other than /logout itself means it happened.
      if (stripQuery(url) !== INAT_LOGOUT_URL) settle(null);
      return;
    }
    if (isTokenUrl(url)) {
      ref.current?.injectJavaScript(READ_BODY_JS);
      return;
    }
    if (isLoginUrl(url)) {
      if (mode === 'hidden') {
        if (interactive) show();
        else settle(null, new InatLoginRequired('login page reached'));
      }
      return; // visible: the user is typing; nothing to do
    }
    // Any other iNat page (home after login, a site chooser…) → go back to
    // the token page. Bounded so a misbehaving redirect cannot loop.
    if (url.startsWith(INAT_ORIGIN)) {
      if (redirects.current >= MAX_REDIRECTS) {
        settle(null, new InatLoginRequired('too many redirects'));
        return;
      }
      redirects.current += 1;
      ref.current?.injectJavaScript(GOTO_TOKEN_JS);
    }
  };

  const onMessage = (e: { nativeEvent: { data: string } }) => {
    if (done.current || purpose !== 'token') return;
    const jwt = parseTokenText(e.nativeEvent.data ?? '');
    if (jwt) settle(jwt);
    else if (mode === 'hidden' && interactive) show();
    else settle(null, new InatLoginRequired('token page had no token'));
  };

  const webview = (
    <WebView
      ref={ref}
      source={{ uri: purpose === 'logout' ? INAT_LOGOUT_URL : INAT_API_TOKEN_URL }}
      onNavigationStateChange={onNavigationStateChange}
      onMessage={onMessage}
      onLoadStart={() => setLoading(true)}
      onLoadEnd={() => setLoading(false)}
      onError={() => {
        if (purpose === 'logout') settle(null);
        else settle(null, new InatLoginRequired('page failed to load'));
      }}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith(INAT_ORIGIN) || req.url.startsWith('about:')}
      incognito={false}
      sharedCookiesEnabled={false}
      javaScriptEnabled
      domStorageEnabled
      style={mode === 'hidden' ? { width: 1, height: 1, opacity: 0 } : { flex: 1 }}
    />
  );

  if (mode === 'hidden') {
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: -10, top: -10, width: 1, height: 1 }}>
        {webview}
      </View>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => settle(null)}>
      <View style={{ flex: 1, paddingTop: insets.top }} className="bg-white dark:bg-gray-900">
        <View className="flex-row items-center border-b border-gray-200 dark:border-gray-800 px-2 py-2">
          <Pressable onPress={() => settle(null)} hitSlop={10} className="p-2" accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={24} color="#6b7280" />
          </Pressable>
          <Text className="ml-1 flex-1 text-base font-semibold text-gray-900 dark:text-gray-100">{t('inat.loginTitle')}</Text>
          {loading ? <ActivityIndicator /> : null}
        </View>
        <Text className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{t('inat.loginHint')}</Text>
        <View style={{ flex: 1 }}>{webview}</View>
      </View>
    </Modal>
  );
}
