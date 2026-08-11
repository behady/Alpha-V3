package com.alphadental.clinic;

import android.net.Uri;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * ============================================================================
 *  THE ONLY FILE YOU NORMALLY NEED TO EDIT.
 * ============================================================================
 *
 * If your clinic system moves to a different web address, change START_URL
 * below, add the new address to IN_APP_HOSTS, then rebuild. Nothing else in
 * the project refers to the address directly.
 */
public final class AppConfig {

    /** The page the app opens when you tap its icon. */
    public static final String START_URL = "https://alpha-v3.vercel.app/";

    /**
     * Addresses that stay INSIDE the app. Anything else opens in the phone's
     * browser, so a stray link can never trap staff inside the clinic app.
     * A leading dot means "this domain and all of its subdomains".
     */
    private static final List<String> IN_APP_HOSTS = Arrays.asList(
            "alpha-v3.vercel.app",
            ".vercel.app",              // Vercel preview deployments
            "alpha-v2-ffc98.firebaseapp.com",   // Firebase sign-in handler
            "identitytoolkit.googleapis.com",
            "securetoken.googleapis.com",
            "firebasestorage.googleapis.com"
    );

    /**
     * Google's sign-in pages refuse to load inside any embedded browser, so we
     * catch them and explain rather than showing staff a raw Google error.
     */
    private static final List<String> BLOCKED_OAUTH_HOSTS = Arrays.asList(
            "accounts.google.com",
            "accounts.youtube.com"
    );

    /** Appended to the browser identity so the website can tell it's the app. */
    public static final String USER_AGENT_SUFFIX = " AlphaDentalApp/1.0";

    private AppConfig() {
    }

    public static boolean isInAppUrl(Uri uri) {
        String host = hostOf(uri);
        if (host == null) {
            return false;
        }
        for (String allowed : IN_APP_HOSTS) {
            if (allowed.startsWith(".")) {
                if (host.endsWith(allowed) || host.equals(allowed.substring(1))) {
                    return true;
                }
            } else if (host.equals(allowed)) {
                return true;
            }
        }
        return false;
    }

    public static boolean isBlockedOAuthUrl(Uri uri) {
        String host = hostOf(uri);
        return host != null && BLOCKED_OAUTH_HOSTS.contains(host);
    }

    private static String hostOf(Uri uri) {
        if (uri == null || uri.getHost() == null) {
            return null;
        }
        return uri.getHost().toLowerCase(Locale.ROOT);
    }
}
