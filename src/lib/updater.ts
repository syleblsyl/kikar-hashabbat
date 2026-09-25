import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { currentVersion } from './version';

export const REPO = 'syleblsyl/kikar-hashabbat';

type AppUpdaterPlugin = {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(opts: { url: string }): Promise<void>;
  addListener(event: 'progress', cb: (e: { percent: number }) => void): Promise<PluginListenerHandle>;
};

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export type UpdateInfo = {
  available: boolean;
  currentName: string;
  latestName: string;
  latestCode: number;
  notes: string;
  apkUrl: string | null;
};

/** Tags look like v1.0.<code>; the last number is the Android versionCode. */
function codeFromTag(tag: string): number {
  const n = parseInt(tag.split('.').pop() ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const cur = await currentVersion();
  const res = await CapacitorHttp.get({
    url: `https://api.github.com/repos/${REPO}/releases/latest`,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) {
    // no release published yet
    return { available: false, currentName: cur.name, latestName: cur.name, latestCode: cur.code, notes: '', apkUrl: null };
  }
  if (res.status !== 200) throw new Error(`GitHub ${res.status}`);
  const rel = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  const tag: string = rel.tag_name ?? '';
  const latestCode = codeFromTag(tag);
  const asset = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith('.apk'));
  return {
    available: Capacitor.isNativePlatform() && latestCode > cur.code && !!asset,
    currentName: cur.name,
    latestName: tag.replace(/^v/, ''),
    latestCode,
    notes: rel.body ?? '',
    apkUrl: asset?.browser_download_url ?? null,
  };
}

export class InstallPermissionNeeded extends Error {}

export async function installUpdate(url: string, onProgress: (percent: number) => void) {
  const { allowed } = await AppUpdater.canInstall();
  if (!allowed) {
    await AppUpdater.openInstallSettings();
    throw new InstallPermissionNeeded('install permission');
  }
  const handle = await AppUpdater.addListener('progress', (e) => onProgress(e.percent));
  try {
    await AppUpdater.downloadAndInstall({ url });
  } finally {
    await handle.remove();
  }
}
