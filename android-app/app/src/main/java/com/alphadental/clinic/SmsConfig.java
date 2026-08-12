package com.alphadental.clinic;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where this phone keeps its identity as a sender for the clinic.
 *
 * <p>The token here is what proves to the server that this handset is allowed to
 * pick up and send the clinic's reminders. It is written once during pairing and
 * read by the background worker; it never appears on screen and is never sent
 * anywhere except to this system's own address.
 *
 * <p>Deliberately NOT stored in the WebView's cookies or local storage: the
 * worker has to run when the app is closed and there is no WebView alive to ask.
 */
public final class SmsConfig {

    private static final String PREFS = "alpha_sms";
    private static final String KEY_TOKEN = "device_token";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_CLINIC_ID = "clinic_id";
    private static final String KEY_LAST_SYNC = "last_sync_at";
    private static final String KEY_LAST_RESULT = "last_result";
    private static final String KEY_SENT_COUNT = "sent_count";

    private SmsConfig() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void savePairing(Context context, String token, String deviceId, String clinicId) {
        prefs(context).edit()
                .putString(KEY_TOKEN, token)
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_CLINIC_ID, clinicId)
                .apply();
    }

    public static void clearPairing(Context context) {
        prefs(context).edit()
                .remove(KEY_TOKEN)
                .remove(KEY_DEVICE_ID)
                .remove(KEY_CLINIC_ID)
                .apply();
    }

    public static String token(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }

    public static String deviceId(Context context) {
        return prefs(context).getString(KEY_DEVICE_ID, "");
    }

    public static boolean isPaired(Context context) {
        return !token(context).isEmpty();
    }

    /** Recorded after every poll so the app can show whether it is actually working. */
    public static void recordSync(Context context, String result, int sentNow) {
        SharedPreferences p = prefs(context);
        p.edit()
                .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
                .putString(KEY_LAST_RESULT, result)
                .putInt(KEY_SENT_COUNT, p.getInt(KEY_SENT_COUNT, 0) + sentNow)
                .apply();
    }

    public static long lastSyncAt(Context context) {
        return prefs(context).getLong(KEY_LAST_SYNC, 0L);
    }

    public static String lastResult(Context context) {
        return prefs(context).getString(KEY_LAST_RESULT, "");
    }

    public static int sentCount(Context context) {
        return prefs(context).getInt(KEY_SENT_COUNT, 0);
    }

    /** Absolute URL for one of the SMS endpoints, derived from the one configured address. */
    public static String endpoint(String path) {
        String base = AppConfig.START_URL;
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        return base + path;
    }
}
