import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { currentVersion } from './version';

export const REPO = 'syleblsyl/kikar-hashabbat';

type AppUpdaterPlugin = {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(opts: { url: string; sha256?: string; versionCode?: number }): Promise<void>;
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
  sha256: string | null;
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
    connectTimeout: 15000,
    readTimeout: 15000,
  });
  if (res.status === 404) {
    // no release published yet
    return { available: false, currentName: cur.name, latestName: cur.name, latestCode: cur.code, notes: '', apkUrl: null, sha256: null };
  }
  if (res.status !== 200) throw new Error(`GitHub ${res.status}`);
  const rel = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  const tag: string = rel.tag_name ?? '';
  const latestCode = codeFromTag(tag);
  const asset = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith('.apk'));
  const digest: string | undefined = asset?.digest;
  const info: UpdateInfo = {
    available: Capacitor.isNativePlatform() && latestCode > cur.code && !!asset,
    currentName: cur.name,
    latestName: tag.replace(/^v/, ''),
    latestCode,
    notes: rel.body ?? '',
    apkUrl: asset?.browser_download_url ?? null,
    sha256: digest?.startsWith('sha256:') ? digest.slice(7) : null,
  };
  try {
    localStorage.setItem('kikar.updateCheck', JSON.stringify({ at: Date.now(), info }));
  } catch {
    /* storage unavailable */
  }
  return info;
}

const SIX_HOURS = 6 * 3600 * 1000;

/** Automatic check on start: asks GitHub at most every 6 hours (rate limits), otherwise reuses the last answer. */
export async function checkForUpdateThrottled(): Promise<UpdateInfo | null> {
  try {
    const cached = JSON.parse(localStorage.getItem('kikar.updateCheck') ?? 'null') as { at: number; info: UpdateInfo } | null;
    if (cached && Date.now() - cached.at < SIX_HOURS) {
      const cur = await currentVersion();
      return { ...cached.info, available: cached.info.available && cached.info.latestCode > cur.code, currentName: cur.name };
    }
  } catch {
    /* ignore */
  }
  return checkForUpdate();
}

export class InstallPermissionNeeded extends Error {}

export async function installUpdate(u: UpdateInfo, onProgress: (percent: number) => void) {
  if (!u.apkUrl) throw new Error('no apk');
  const { allowed } = await AppUpdater.canInstall();
  if (!allowed) {
    await AppUpdater.openInstallSettings();
    throw new InstallPermissionNeeded('install permission');
  }
  const handle = await AppUpdater.addListener('progress', (e) => onProgress(e.percent));
  try {
    await AppUpdater.downloadAndInstall({ url: u.apkUrl, sha256: u.sha256 ?? undefined, versionCode: u.latestCode });
  } finally {
    await handle.remove();
  }
}
