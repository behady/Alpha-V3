package com.alphadental.clinic;

import android.net.Uri;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Receives files that the website builds in the browser itself — PDF
 * prescriptions, payroll reports, Excel exports. A plain WebView throws those
 * away silently, which is why every "Export" button would otherwise do nothing.
 *
 * The page hands the file over in base64 pieces (see {@link DownloadScripts});
 * we glue them back together on disk and drop the result into Downloads.
 *
 * Every method here is called from the WebView's JavaScript thread, never the
 * UI thread — anything user-visible is posted back through {@link Listener}.
 */
public class DownloadBridge {

    /** Base64 grows ~33%, so 256 KB of text is ~192 KB of file per hop. */
    static final int CHUNK_CHARS = 262144;

    interface Listener {
        void onDownloadSaved(Uri uri, String displayName, String mimeType);

        void onDownloadFailed(String displayName, String reason);
    }

    private static final class PendingFile {
        final String displayName;
        final String mimeType;
        final File temp;
        final OutputStream out;

        PendingFile(String displayName, String mimeType, File temp) throws IOException {
            this.displayName = displayName;
            this.mimeType = mimeType;
            this.temp = temp;
            this.out = new FileOutputStream(temp);
        }
    }

    private final File cacheDir;
    private final Listener listener;
    private final Map<String, PendingFile> pending = new ConcurrentHashMap<>();
    private final AtomicLong counter = new AtomicLong();

    DownloadBridge(File cacheDir, Listener listener) {
        this.cacheDir = new File(cacheDir, "web-downloads");
        this.listener = listener;
        //noinspection ResultOfMethodCallIgnored
        this.cacheDir.mkdirs();
    }

    @JavascriptInterface
    public int chunkSize() {
        return CHUNK_CHARS;
    }

    /** @return a handle the page uses for the following chunks, or "" on failure. */
    @JavascriptInterface
    public String begin(String displayName, String mimeType) {
        String id = "dl-" + counter.incrementAndGet();
        try {
            File temp = new File(cacheDir, id + ".part");
            pending.put(id, new PendingFile(displayName, mimeType, temp));
            return id;
        } catch (IOException e) {
            listener.onDownloadFailed(displayName, "No room left on the device.");
            return "";
        }
    }

    @JavascriptInterface
    public boolean write(String id, String base64Chunk) {
        PendingFile file = pending.get(id);
        if (file == null) {
            return false;
        }
        try {
            file.out.write(Base64.decode(base64Chunk, Base64.NO_WRAP));
            return true;
        } catch (IOException | IllegalArgumentException e) {
            abandon(id, "The file could not be written.");
            return false;
        }
    }

    @JavascriptInterface
    public void finish(String id) {
        PendingFile file = pending.remove(id);
        if (file == null) {
            return;
        }
        try {
            file.out.close();
            Uri saved = FileSaver.saveToDownloads(
                    AlphaApp.get(), file.temp, file.displayName, file.mimeType);
            listener.onDownloadSaved(saved, file.displayName, file.mimeType);
        } catch (IOException e) {
            listener.onDownloadFailed(file.displayName, readableReason(e));
        } catch (SecurityException e) {
            listener.onDownloadFailed(file.displayName,
                    "The app is not allowed to save files yet.");
        } finally {
            //noinspection ResultOfMethodCallIgnored
            file.temp.delete();
        }
    }

    @JavascriptInterface
    public void cancel(String id, String reason) {
        abandon(id, reason == null || reason.isEmpty() ? "The download was cancelled." : reason);
    }

    private void abandon(String id, String reason) {
        PendingFile file = pending.remove(id);
        if (file == null) {
            // The page failed before it got as far as opening a file — usually
            // the blob expired. Still worth telling the user rather than
            // letting the Export button appear to do nothing.
            listener.onDownloadFailed("", reason);
            return;
        }
        try {
            file.out.close();
        } catch (IOException ignored) {
            // Nothing useful to do; the temp file is deleted either way.
        }
        //noinspection ResultOfMethodCallIgnored
        file.temp.delete();
        listener.onDownloadFailed(file.displayName, reason);
    }

    private static String readableReason(IOException e) {
        String message = e.getMessage();
        return message == null || message.isEmpty() ? "The file could not be saved." : message;
    }
}
