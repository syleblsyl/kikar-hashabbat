import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type AppVersion = { name: string; code: number };

let cached: AppVersion | null = null;

export async function currentVersion(): Promise<AppVersion> {
  if (cached) return cached;
  if (Capacitor.isNativePlatform()) {
    const info = await App.getInfo();
    cached = { name: info.version, code: parseInt(info.build, 10) || 0 };
  } else {
    cached = { name: __APP_VERSION__, code: 0 };
  }
  return cached;
}
