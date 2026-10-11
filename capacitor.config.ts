import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iOS app is the website in a native shell.
 *
 * `server.url` is the whole design: the app does not bundle any screens, it opens the live site
 * inside a WKWebView, so every deploy to Vercel reaches the phones the moment it goes live and
 * there is no second copy of 21 screens to keep in step. The cost is the same one the old Android
 * WebView app paid — nothing works without a connection — and the Android README explains why
 * that app moved to native screens. For iOS this is the deliberate first step: a store listing,
 * push notifications and a home-screen icon in weeks rather than months.
 *
 * `webDir` holds only the page shown when the site cannot be reached (ios-web/index.html). It is
 * what Capacitor copies into the app bundle; with `server.url` set it is never shown otherwise.
 *
 * `appId` matches the Android applicationId so Firebase, the push catalogue and support all speak
 * of one app with two platforms.
 */
const config: CapacitorConfig = {
  appId: "com.alphadental.clinic",
  appName: "Alpha Dental",
  webDir: "ios-web",
  server: {
    url: "https://alphadental.app",
    // Every link stays inside the app except these. Anything off this list opens in Safari,
    // which is right for WhatsApp links, PDFs handed to the share sheet and the privacy page.
    allowNavigation: [
      "alphadental.app",
      "*.alphadental.app",
      "*.firebaseapp.com",
      "*.googleapis.com",
      "*.google.com",
      "*.gstatic.com",
      "*.vercel.app",
    ],
  },
  ios: {
    // Pull-to-refresh on a dashboard with its own scrolling panels only ever fires by accident.
    scrollEnabled: true,
    contentInset: "automatic",
    // The site's viewport does not opt into viewport-fit=cover, so WebKit keeps the page out of
    // the notch and home-indicator areas itself; this is the colour of those strips.
    backgroundColor: "#ffffff",
    limitsNavigationsToAppBoundDomains: false,
  },
  // Capawesome's documented workaround for a Swift Package Manager identity collision between
  // the messaging plugin and firebase-ios-sdk (capacitor-firebase issue 959).
  experimental: {
    ios: {
      spm: {
        packageOptions: {
          "@capacitor-firebase/messaging": { symlink: true },
        },
      },
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
