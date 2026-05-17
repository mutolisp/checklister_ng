/**
 * Expo dynamic config. Replaces `app.json` to read secrets from env vars at
 * prebuild time, so credentials (e.g. Google Maps API key) never enter git.
 *
 * Sources read by Expo CLI:
 *   - Local dev: `.env` file at this directory (gitignored). See `.env.example`.
 *   - EAS build: secrets set via `eas secret:create --name X --value Y`
 *     or via EAS Dashboard → Project Settings → Secrets.
 *
 * Required env vars:
 *   - GOOGLE_MAPS_ANDROID_API_KEY  → injected into AndroidManifest as
 *     com.google.android.geo.API_KEY (only needed for Android; iOS uses
 *     Apple Maps, no key required).
 *
 * Missing vars don't crash the build, but the corresponding native config is
 * omitted (e.g. Android map tab will be blank if the key is absent).
 */
import type { ExpoConfig } from 'expo/config';

const GOOGLE_MAPS_ANDROID_API_KEY = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

const config: ExpoConfig = {
  name: 'Checklister',
  slug: 'checklister-mobile',
  version: 'm0.3.1',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'checklister',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'tw.checklister.mobile',
  },
  android: {
    package: 'tw.checklister.mobile',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    ...(GOOGLE_MAPS_ANDROID_API_KEY
      ? { config: { googleMaps: { apiKey: GOOGLE_MAPS_ANDROID_API_KEY } } }
      : {}),
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
    [
      'expo-asset',
      {
        assets: ['./assets/db/twnamelist.db'],
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Allow Checklister to record locations of species observations (foreground use is sufficient).',
        locationWhenInUsePermission:
          'Allow Checklister to record locations of species observations.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Checklister to attach photos to species records.',
        cameraPermission: 'Allow Checklister to take photos of observed species.',
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: 'Allow Checklister to attach photos to species records.',
        savePhotosPermission:
          'Allow Checklister to save captured species photos to your Photos library.',
        isAccessMediaLocationEnabled: true,
      },
    ],
  ],
  assetBundlePatterns: ['**/*', 'assets/db/*.db'],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
