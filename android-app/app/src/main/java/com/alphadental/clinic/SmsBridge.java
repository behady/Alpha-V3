package com.alphadental.clinic;

import android.content.Context;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/**
 * Lets the SMS settings page pair the very phone it is being viewed on.
 *
 * <p>Without this, setting up the clinic phone means generating a code on a
 * computer, walking to the phone, opening the app and typing eight characters.
 * With it, the same page opened on the phone shows a "Pair this phone" button
 * that does the whole thing — the page asks the server for a code and hands it
 * straight over.
 *
 * <p>The manual code path still exists and still works. This is a shortcut, not
 * the only way in, so a clinic can still pair a second phone that has no browser
 * session on it.
 *
 * <p>Safe to expose to the page because {@code AppConfig.IN_APP_HOSTS} keeps
 * this WebView on the clinic system's own addresses — no third-party page is
 * ever loaded here. The worst this interface can do is pair the phone the user
 * is holding, using a code only a signed-in clinic Admin can obtain.
 */
public class SmsBridge {

    /** Implemented by MainActivity, which owns the permission prompt and the UI thread. */
    interface Host {
        void onPairRequested(String code);
    }

    private final Context context;
    private final Host host;

    SmsBridge(Context context, Host host) {
        this.context = context.getApplicationContext();
        this.host = host;
    }

    /** The page uses this to decide whether to show the in-app shortcut at all. */
    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    /**
     * Pair this phone with the given code.
     *
     * <p>Returns immediately: pairing needs a permission prompt and a network
     * call, neither of which can happen on the WebView's JavaScript thread.
     */
    @JavascriptInterface
    public void pair(String code) {
        if (code == null || code.trim().isEmpty()) {
            return;
        }
        host.onPairRequested(code.trim());
    }

    /** A JSON summary the page can show without having to ask the server. */
    @JavascriptInterface
    public String status() {
        JSONObject json = new JSONObject();
        try {
            json.put("paired", SmsConfig.isPaired(context));
            json.put("deviceId", SmsConfig.deviceId(context));
            json.put("permissionGranted", SmsSyncWorker.hasSmsPermission(context));
            json.put("lastSyncAt", SmsConfig.lastSyncAt(context));
            json.put("lastResult", SmsConfig.lastResult(context));
            json.put("sentCount", SmsConfig.sentCount(context));
            json.put("deviceName", deviceName());
        } catch (Exception ignored) {
            // A malformed status is not worth crashing a settings screen over.
        }
        return json.toString();
    }

    /** What this phone will be called in the clinic's list of paired devices. */
    static String deviceName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();

        if (model.toLowerCase().startsWith(manufacturer.toLowerCase()) || manufacturer.isEmpty()) {
            return model.isEmpty() ? "Clinic phone" : model;
        }
        return (manufacturer + " " + model).trim();
    }
}
