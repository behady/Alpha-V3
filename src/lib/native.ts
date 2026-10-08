/**
 * Whether the site is running inside the iOS app shell (capacitor.config.ts).
 *
 * The shell loads the live website, so the same bundle serves Safari and the app. The few places
 * that must behave differently ask this instead of sniffing the user agent: push goes through APNs
 * rather than a service worker, and Google sign-in is not offered because a WKWebView cannot open
 * the popup window Firebase's web flow needs (the Android app made the same call, for the same
 * reason — a button that always fails is worse than none).
 *
 * `@capacitor/core` guards every window access itself, but the check is kept to the browser so
 * nothing about the server render depends on it.
 */
import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): "ios" | "android" | "web" {
  if (!isNativeApp()) return "web";
  return Capacitor.getPlatform() === "android" ? "android" : "ios";
}
