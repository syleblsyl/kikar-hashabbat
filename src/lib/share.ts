import { Capacitor } from '@capacitor/core';
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

/**
 * On the phone: writes the file and opens Android's share sheet (WhatsApp, Drive, email…).
 * In a browser: downloads it.
 */
export async function shareFile(filename: string, blob: Blob, title: string) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const data = await blobToBase64(blob);
  const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  await Share.share({ title, dialogTitle: title, files: [res.uri] });
}
