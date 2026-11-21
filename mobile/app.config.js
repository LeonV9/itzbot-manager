// HTTPS is required for production builds. For a quick test against a plain-HTTP server, build with ALLOW_CLEARTEXT=1
// (the "development" and "preview-insecure" EAS profiles do this). Never ship cleartext builds.
const cleartext = process.env.ALLOW_CLEARTEXT === '1';
module.exports = {
  expo: {
    name: 'ItzBot Manager',
    slug: 'itzbot-manager',
    scheme: 'itzbot',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    icon: './assets/icon.png',
    backgroundColor: '#0B0B0C',
    splash: { image: './assets/splash.png', resizeMode: 'contain', backgroundColor: '#0B0B0C' },
    android: {
      package: 'com.itzbot.manager',
      versionCode: 1,
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B0B0C' },
      permissions: [],
    },
    plugins: [
      'expo-secure-store',
      ['expo-build-properties', { android: { usesCleartextTraffic: cleartext, compileSdkVersion: 35, targetSdkVersion: 34, minSdkVersion: 24 } }],
    ],
    // After the first `eas build`, `eas init` writes extra.eas.projectId here.
    extra: {},
  },
};
