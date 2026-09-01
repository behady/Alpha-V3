/**
 * Read-only: who would receive a push for a clinic, and whether they have a device.
 *
 *   node scripts/whoami-push.mjs <clinicId> [email]
 *
 * Written to answer "the notification never arrived" without sending one: a
 * missing token and a muted channel look identical from the outside, and only
 * one of them is visible from here.
 */
import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
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
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "")
        .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim(),
    }),
  });
}
const db = getFirestore(getApps()[0], "default");

const clinicId = process.argv[2];
if (!clinicId) throw new Error("Usage: node scripts/whoami-push.mjs <clinicId> [email]");
const wantEmail = (process.argv[3] || "").toLowerCase();

const clinic = await db.collection("clinics").doc(clinicId).get();
console.log(`Clinic: ${clinicId} — ${clinic.exists ? clinic.data()?.name || "(no name)" : "DOES NOT EXIST"}`);

const staff = await db.collection("clinics").doc(clinicId).collection("staff").get();
console.log(`Staff rows: ${staff.size}\n`);

for (const doc of staff.docs) {
  const d = doc.data() || {};
  const uid = String(d.uid || "").trim();
  const role = String(d.role || "").trim() || "(no role)";
  const name = String(d.name || d.email || doc.id);
  if (!uid) {
    console.log(`  ${name} — ${role} — NO uid on the staff row (can never be pushed to)`);
    continue;
  }
  const user = await db.collection("users").doc(uid).get();
  const tokens = Array.isArray(user.data()?.fcmTokens) ? user.data().fcmTokens.filter(Boolean) : [];
  const email = String(user.data()?.email || d.email || "").toLowerCase();
  const mark = wantEmail && email === wantEmail ? "  <= YOU" : "";
  console.log(`  ${name} — ${role} — ${tokens.length} device(s) — ${email || "(no email)"}${mark}`);
  if (wantEmail && email === wantEmail) console.log(`     uid: ${uid}`);
}
