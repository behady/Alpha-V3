package com.alphadental.clinic;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Puts a finished file into the phone's public Downloads folder, so reports and
 * prescriptions show up in the Files app exactly like a normal download.
 */
final class FileSaver {

    private FileSaver() {
    }

    /**
     * @return a Uri that can be handed to other apps for viewing or sharing.
     */
    static Uri saveToDownloads(Context context, File source, String displayName, String mimeType)
            throws IOException {
        String safeName = sanitise(displayName, mimeType);
        String safeMime = TextUtils.isEmpty(mimeType) ? guessMime(safeName) : mimeType;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return saveViaMediaStore(context, source, safeName, safeMime);
        }
        return saveViaLegacyFile(context, source, safeName);
    }

    private static Uri saveViaMediaStore(Context context, File source, String name, String mime)
            throws IOException {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (target == null) {
            throw new IOException("The system would not create a file in Downloads.");
        }

        try (InputStream in = new FileInputStream(source);
             OutputStream out = resolver.openOutputStream(target)) {
            if (out == null) {
                throw new IOException("Could not open the new file for writing.");
            }
            copy(in, out);
        } catch (IOException e) {
            resolver.delete(target, null, null);
            throw e;
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(target, values, null, null);
        return target;
    }

    /** Android 8 and 9: write straight into the public Downloads directory. */
    private static Uri saveViaLegacyFile(Context context, File source, String name)
            throws IOException {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Could not open the Downloads folder.");
        }

        File target = uniqueFile(dir, name);
        try (InputStream in = new FileInputStream(source);
             OutputStream out = new FileOutputStream(target)) {
            copy(in, out);
        }

        // Make it visible to the Files app straight away.
        MediaScannerConnection.scanFile(context, new String[]{target.getAbsolutePath()}, null, null);
        return FileProvider.getUriForFile(
                context, context.getPackageName() + ".fileprovider", target);
    }

    private static File uniqueFile(File dir, String name) {
        File candidate = new File(dir, name);
        if (!candidate.exists()) {
            return candidate;
        }
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int i = 1; i < 1000; i++) {
            candidate = new File(dir, base + " (" + i + ")" + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        out.flush();
    }

    /** Strips path separators and other characters Android will not accept. */
    private static String sanitise(String rawName, String mimeType) {
        String name = rawName == null ? "" : rawName.trim();
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        name = name.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_");
        if (TextUtils.isEmpty(name)) {
            name = "AlphaDental-" + System.currentTimeMillis();
        }
        if (name.length() > 120) {
            name = name.substring(0, 120);
        }
        if (!name.contains(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            name = name + "." + (ext == null ? "bin" : ext);
        }
        return name;
    }

    private static String guessMime(String name) {
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mime != null) {
                return mime;
            }
        }
        return "application/octet-stream";
    }
}
