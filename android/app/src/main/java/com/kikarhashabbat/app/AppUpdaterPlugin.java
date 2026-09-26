package com.kikarhashabbat.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads a newer APK from GitHub Releases, checks it, and hands it to the Android package installer.
 * The installed app keeps its data because every release is signed with the same key.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private final AtomicBoolean busy = new AtomicBoolean(false);
    /** A checked APK whose installer could not open because the app was in the background. */
    private volatile File pendingApk = null;
    private volatile boolean resumed = true;

    @Override
    public void load() {
        // leftovers from an earlier update (the new version is already installed, or the download was cut off)
        File dir = updatesDir();
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        resumed = false;
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        resumed = true;
        File apk = pendingApk;
        if (apk != null && apk.exists()) {
            pendingApk = null;
            openInstaller(apk);
        }
    }

    private File updatesDir() {
        return new File(getContext().getCacheDir(), "updates");
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    private static long codeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    private void openInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String expectedSha = call.getString("sha256");
        final Integer expectedCode = call.getInt("versionCode");
        if (url == null || !url.startsWith("https://")) {
            call.reject("invalid url");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("busy");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            File part = null;
            try {
                File dir = updatesDir();
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("cannot create cache dir");
                }
                part = new File(dir, "update.apk.part");
                File out = new File(dir, "update.apk");
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                //noinspection ResultOfMethodCallIgnored
                out.delete();

                URL current = new URL(url);
                int redirects = 0;
                while (true) {
                    conn = (HttpURLConnection) current.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String location = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (location == null || ++redirects > 6) {
                            throw new Exception("too many redirects");
                        }
                        current = new URL(current, location);
                        if (!"https".equals(current.getProtocol())) {
                            throw new Exception("insecure redirect");
                        }
                        continue;
                    }
                    if (code != 200) {
                        throw new Exception("HTTP " + code);
                    }
                    break;
                }

                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                long total = conn.getContentLengthLong();
                long done = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int lastPercent = -1;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        fos.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int percent = (int) (done * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                JSObject p = new JSObject();
                                p.put("percent", percent);
                                notifyListeners("progress", p);
                            }
                        }
                    }
                    fos.getFD().sync();
                }
                if (total > 0 && done != total) {
                    throw new Exception("incomplete download");
                }
                if (expectedSha != null && !expectedSha.isEmpty() && !hex(sha.digest()).equalsIgnoreCase(expectedSha.trim())) {
                    throw new Exception("checksum mismatch");
                }

                // it must be this app, and newer than what is installed
                PackageManager pm = getContext().getPackageManager();
                PackageInfo apkInfo = pm.getPackageArchiveInfo(part.getAbsolutePath(), 0);
                if (apkInfo == null || !getContext().getPackageName().equals(apkInfo.packageName)) {
                    throw new Exception("not this app");
                }
                long installed = codeOf(pm.getPackageInfo(getContext().getPackageName(), 0));
                long downloaded = codeOf(apkInfo);
                if (downloaded <= installed || (expectedCode != null && downloaded < expectedCode)) {
                    throw new Exception("not newer");
                }

                if (!part.renameTo(out)) {
                    throw new Exception("cannot save file");
                }
                part = null;

                if (resumed) {
                    openInstaller(out);
                } else {
                    pendingApk = out; // opened in handleOnResume
                }
                call.resolve();
            } catch (Exception e) {
                if (part != null) {
                    //noinspection ResultOfMethodCallIgnored
                    part.delete();
                }
                call.reject("download failed: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
                busy.set(false);
            }
        }).start();
    }
}
