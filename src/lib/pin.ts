import { getSetting, setSetting } from '../db/repo';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hasPin(): Promise<boolean> {
  return (await getSetting('pin_hash')) !== null;
}

export async function savePin(pin: string) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await setSetting('pin_salt', salt);
  await setSetting('pin_hash', await sha256(salt + pin));
}

export async function checkPin(pin: string): Promise<boolean> {
  const salt = await getSetting('pin_salt');
  const hash = await getSetting('pin_hash');
  if (!salt || !hash) return false;
  return (await sha256(salt + pin)) === hash;
}

/* ---------- wrong-code lockout ---------- */

const FREE_TRIES = 5;

/** Milliseconds left before another try is allowed (0 = may try now). */
export async function pinWaitLeft(): Promise<number> {
  const until = Number((await getSetting('pin_wait_until')) ?? 0);
  return Math.max(0, until - Date.now());
}

/** Records a wrong code. After 5 wrong tries each further one waits longer: 30s, 1m, 2m… up to 15 minutes. */
export async function pinFailed(): Promise<number> {
  const fails = Number((await getSetting('pin_fails')) ?? 0) + 1;
  await setSetting('pin_fails', String(fails));
  if (fails < FREE_TRIES) return 0;
  const wait = Math.min(15 * 60_000, 30_000 * 2 ** (fails - FREE_TRIES));
  await setSetting('pin_wait_until', String(Date.now() + wait));
  return wait;
}

export async function pinSucceeded() {
  await setSetting('pin_fails', '0');
  await setSetting('pin_wait_until', '0');
}
