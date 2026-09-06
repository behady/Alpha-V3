#!/usr/bin/env node
/**
 * Publish the Android app so every phone finds out about it.
 *
 * Until this existed a new version reached staff as a file handed to each person, and nothing
 * told anyone it was there. The app now asks once a day for `latest.json` and shows a one-line
 * banner with a Download button when it is behind. This script is what writes that file.
 *
 * Two objects go to Firebase Storage under `app/android/`:
 *   - `AlphaDental-<version>.apk`  — the build, with a fresh download token
 *   - `latest.json`                — version code, name, size, the APK's link, and notes
 *
 * `latest.json` is fetched by the app through a Storage download-token link, which needs no
 * sign-in and no rules change. The token is the one in `android/firebase.properties`
 * (`firebase.updateToken`); the app bakes the same token into its manifest URL at build time.
 * If the property is missing this script mints one, appends it, and stops — because the build
 * you are about to publish would not know the URL. Rebuild, then run this again.
 *
 * Usage:  node scripts/publish-android-apk.mjs [--notes "What changed, in a sentence"]
 * Reads the version from android/app/build.gradle.kts and the APK from the release output.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.join(root, ".env.local"));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? "" : String(process.argv[i + 1] || "");
}

// --- the version, from the one place it is written ---------------------------------------------
const gradle = fs.readFileSync(path.join(root, "android/app/build.gradle.kts"), "utf8");
const versionCode = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
const versionName = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
if (!versionCode || !versionName) {
  console.error("Could not read versionCode / versionName from android/app/build.gradle.kts");
  process.exit(1);
}

const apkPath = path.join(root, `android/app/build/outputs/apk/release/AlphaDental-release-${versionName}.apk`);
if (!fs.existsSync(apkPath)) {
  console.error(`No release APK for ${versionName} at\n  ${apkPath}\nRun android/build-apk.bat first.`);
  process.exit(1);
}

// --- the token the app was built with ------------------------------------------------------------
const propsPath = path.join(root, "android/firebase.properties");
const props = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, "utf8") : "";
let token = /^firebase\.updateToken\s*=\s*(\S+)/m.exec(props)?.[1] || "";
const bucketName =
  /^firebase\.storageBucket\s*=\s*(\S+)/m.exec(props)?.[1] || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "";
if (!bucketName) {
  console.error("No storage bucket in android/firebase.properties or .env.local");
  process.exit(1);
}
if (!token) {
  token = randomUUID();
  fs.appendFileSync(
    propsPath,
    `${props.endsWith("\n") || props === "" ? "" : "\n"}# The download token for app/android/latest.json — the app bakes it into its update URL.\nfirebase.updateToken=${token}\n`
  );
  console.log(
    `firebase.updateToken was missing. Added ${token} to android/firebase.properties.\n` +
      `The APK you just built does not carry it: rebuild with build-apk.bat, then run this again.`
  );
  process.exit(2);
}

// --- upload ---------------------------------------------------------------------------------------
if (getApps().length === 0) {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env.local");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), storageBucket: bucketName });
}
const bucket = getStorage().bucket(bucketName);

const apkObject = `app/android/AlphaDental-${versionName}.apk`;
const apkToken = randomUUID();
const sizeBytes = fs.statSync(apkPath).size;
console.log(`Uploading ${path.basename(apkPath)} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB) → ${apkObject}`);
await bucket.upload(apkPath, {
  destination: apkObject,
  contentType: "application/vnd.android.package-archive",
  metadata: { metadata: { firebaseStorageDownloadTokens: apkToken } },
});
const tokenUrl = (object, t) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(object)}?alt=media&token=${t}`;
const apkUrl = tokenUrl(apkObject, apkToken);

const latest = {
  versionCode,
  versionName,
  url: apkUrl,
  sizeBytes,
  notes: arg("notes"),
  publishedAt: new Date().toISOString(),
};
const latestObject = "app/android/latest.json";
await bucket.file(latestObject).save(JSON.stringify(latest, null, 2), {
  contentType: "application/json",
  // Short cache: phones ask once a day anyway, and a stale manifest would hide a release.
  metadata: { cacheControl: "public, max-age=300", metadata: { firebaseStorageDownloadTokens: token } },
});

console.log(`\nPublished ${versionName} (code ${versionCode}).`);
console.log(`APK:      ${apkUrl}`);
console.log(`Manifest: ${tokenUrl(latestObject, token)}`);
console.log(`\nPhones on older builds will see the update banner within a day, or on their next app start.`);
