import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

type FileSaverPlugin = {
  saveToDownloads(o: { name: string; data: string; mime: string }): Promise<{ name: string; folder: string }>;
};
const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver');

function browserDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Saves the file in the phone's "Download" folder, like a normal download – nothing to choose or share.
 * Returns the name it got (Android adds " (1)" when the name is taken).
 */
export async function saveToDownloads(filename: string, blob: Blob): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    browserDownload(filename, blob);
    return filename;
  }
  const data = await blobToBase64(blob);
  const res = await FileSaver.saveToDownloads({ name: filename, data, mime: blob.type || 'application/octet-stream' });
  return res.name;
}

/** The person closed the share sheet without choosing where to send the file. */
export class ShareCancelled extends Error {}

/**
 * On the phone: writes the file and opens Android's share sheet (WhatsApp, Drive, email…).
 * In a browser: downloads it.
 */
export async function shareFile(filename: string, blob: Blob, title: string) {
  if (!Capacitor.isNativePlatform()) {
    browserDownload(filename, blob);
    return;
  }
  const data = await blobToBase64(blob);
  const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  try {
    await Share.share({ title, dialogTitle: title, files: [res.uri] });
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) throw new ShareCancelled();
    throw e;
  }
}

/** wa.me link for an Israeli number (050… → 97250…), optionally with a ready message. */
export function waLink(phone: string, text?: string) {
  const digits = phone.replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Opens an outside link (WhatsApp, phone) – inside the app Android hands it to the right app. */
export function openExternal(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Sends a text: straight to the agent's WhatsApp chat when there is a phone number, otherwise through the share menu. */
export async function sendText(text: string, phone?: string | null) {
  if (phone && phone.replace(/\D/g, '').length >= 9) {
    openExternal(waLink(phone, text));
    return;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ text });
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) throw new ShareCancelled();
      throw e;
    }
    return;
  }
  await navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** A file name that every app accepts: no slashes or odd signs. */
export function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}
