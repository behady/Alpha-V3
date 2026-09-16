/**
 * Read-only: run the X-Rays tab's "past reports" query exactly as the browser does — through the
 * web SDK, signed in as a real staff member, under the deployed security rules.
 *
 *   node scripts/probe-xray-reports-as-user.mjs <email> <clinicId> <patientId>
 *
 * The Admin SDK bypasses rules, so `probe-xray-reports.mjs` can only prove the documents exist.
 * A screen that shows nothing while the documents exist is a rules or query problem, and this
 * is the only way to see the error the browser swallows.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { collection, getDocs, getFirestore, query, where } from "firebase/firestore";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
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

loadEnvLocal();
const [email, clinicId, patientId] = process.argv.slice(2);
if (!email || !clinicId || !patientId) {
  console.error("usage: node scripts/probe-xray-reports-as-user.mjs <email> <clinicId> <patientId>");
  process.exit(1);
}

if (getApps().length === 0) {
  initAdmin({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim(),
    }),
  });
}
const user = await getAdminAuth().getUserByEmail(email);
const token = await getAdminAuth().createCustomToken(user.uid);

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
await signInWithCustomToken(getAuth(app), token);
const db = getFirestore(app, "default");

for (const name of ["xray_reports", "patient_media"]) {
  try {
    const snap = await getDocs(query(collection(db, `clinics/${clinicId}/${name}`), where("patientId", "==", patientId)));
    console.log(`${name}: ${snap.size} docs readable as ${email}`);
  } catch (e) {
    console.log(`${name}: FAILED —`, e?.code || "", e?.message || e);
  }
}
process.exit(0);
