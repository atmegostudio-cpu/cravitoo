// Dynamic Expo config — supports two app variants from a single codebase:
//   APP_VARIANT=vendor → builds the "Cravitoo Partner" app (com.cravitoo.partner)
//   default            → builds the "Cravitoo" customer app (com.cravitoo.app)

const IS_VENDOR = process.env.APP_VARIANT === 'vendor';

const NAME = IS_VENDOR ? 'Cravitoo Partner' : 'Cravitoo';
const SLUG = IS_VENDOR ? 'cravitoo-partner' : 'cravitoo';
const BUNDLE_ID = IS_VENDOR ? 'com.cravitoo.partner' : 'com.cravitoo.app';
const SCHEME = IS_VENDOR ? 'cravitoo-partner' : 'cravitoo';

module.exports = {
  expo: {
    name: NAME,
    slug: SLUG,
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: SCHEME,
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#FFFFFF',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: BUNDLE_ID,
      buildNumber: '1.0.0',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/icon.png',
        backgroundColor: IS_VENDOR ? '#111827' : '#FF5A1F',
      },
      package: BUNDLE_ID,
      versionCode: 1,
    },
    web: {
      favicon: './assets/icon.png',
    },
    plugins: [
      'expo-secure-store',
      [
        'expo-build-properties',
        {
          android: {
            kotlinVersion: '1.9.25',
          },
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: IS_VENDOR
            ? 'Allow Cravitoo Partner to access your camera to scan customer pickup QR codes.'
            : 'Allow Cravitoo to access your camera to scan pickup QR codes.',
        },
      ],
    ],
    extra: {
      appVariant: IS_VENDOR ? 'vendor' : 'customer',
      eas: {
        projectId: IS_VENDOR
          ? process.env.VENDOR_EAS_PROJECT_ID || ''
          : '8e1d75df-6b09-4130-b2f6-49ece283b9eb',
      },
    },
    owner: 'atmego',
  },
};
