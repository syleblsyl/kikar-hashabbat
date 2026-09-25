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
