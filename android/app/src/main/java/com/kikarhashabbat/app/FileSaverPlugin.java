package com.kikarhashabbat.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves a file in the phone's public "Download" folder, like a normal download from the browser,
 * so it can be found in the Files app (and picked again for a restore) without sharing it anywhere.
 */
@CapacitorPlugin(
    name = "FileSaver",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        if (call.getString("name") == null || call.getString("data") == null) {
            call.reject("missing name or data");
            return;
        }
        // Android 10+ writes through MediaStore without any permission; older versions need storage permission
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermission");
            return;
        }
        save(call);
    }

    @PermissionCallback
    private void storagePermission(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            save(call);
        } else {
            call.reject("permission-denied");
        }
    }

    private void save(final PluginCall call) {
        final String name = call.getString("name");
        final String data = call.getString("data");
        final String mime = call.getString("mime", "application/octet-stream");
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                String saved;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saved = saveWithMediaStore(name, mime, bytes);
                } else {
                    saved = saveToFolder(name, bytes);
                }
                JSObject ret = new JSObject();
                ret.put("name", saved);
                ret.put("folder", Environment.DIRECTORY_DOWNLOADS);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("save-failed: " + e.getMessage());
            }
        }).start();
    }

    @RequiresApi(api = Build.VERSION_CODES.Q)
    private String saveWithMediaStore(String name, String mime, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("could not create the file");
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new Exception("could not open the file");
            out.write(bytes);
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
        // Android adds " (1)" when a file with the same name is already there
        String saved = name;
        try (Cursor c = resolver.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) saved = c.getString(0);
        }
        return saved;
    }

    private String saveToFolder(String name, byte[] bytes) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("no Download folder");
        File file = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; file.exists(); i++) file = new File(dir, base + " (" + i + ")" + ext);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, null, null);
        return file.getName();
    }
}
