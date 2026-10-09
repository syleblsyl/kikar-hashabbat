package com.kikarhashabbat.app;

import android.os.Bundle;
import android.os.Environment;
import com.getcapacitor.BridgeActivity;
import java.io.File;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        super.onCreate(savedInstanceState);
        cleanCameraTemp();
    }

    /** Product photos taken with the camera leave full-size JPEG_* files behind; the app keeps only a small copy. */
    private void cleanCameraTemp() {
        new Thread(() -> {
            try {
                File dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                File[] files = dir != null ? dir.listFiles() : null;
                if (files == null) return;
                long cutoff = System.currentTimeMillis() - 60 * 60 * 1000L;
                for (File f : files) {
                    if (f.isFile() && f.getName().startsWith("JPEG_") && f.lastModified() < cutoff) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            } catch (Exception ignored) {
                // nothing to clean
            }
        }).start();
    }
}
