import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kikarhashabbat.app',
  appName: 'כיכר השבת',
  webDir: 'dist',
  backgroundColor: '#FAF5EC',
  android: {
    backgroundColor: '#FAF5EC',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: { biometricAuth: false },
    },
  },
};

export default config;
