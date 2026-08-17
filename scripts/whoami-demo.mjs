/**
 * Read-only: shows which clinics an account can reach, and whether the demo clinic is one of them.
 *
 *   node scripts/whoami-demo.mjs test77@test.com
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { DEMO_MARKER } from "./demo-clinic-data.mjs";

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

const email = (process.argv[2] || "").toLowerCase();
if (!email) {
  console.error("Usage: node scripts/whoami-demo.mjs <email>");
  process.exit(1);
}

const snap = await db.collection("users").where("email", "==", email).limit(1).get();
if (snap.empty) {
  console.log(`\nNo user document for ${email}\n`);
  process.exit(0);
}

const user = snap.docs[0];
const roles = user.data().clinicRoles || {};
console.log(`\n${user.data().name || "(unnamed)"} <${email}>`);
console.log(`uid: ${user.id}`);
console.log(`defaultClinicId: ${user.data().defaultClinicId || "(none)"}\n`);

const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).get();
const demoId = demo.empty ? null : demo.docs[0].id;

console.log("clinics this account can reach:");
for (const [clinicId, role] of Object.entries(roles)) {
  const c = await db.collection("clinics").doc(clinicId).get();
  const isDemo = clinicId === demoId ? "  ← DEMO CLINIC" : "";
  console.log(`  ${role.padEnd(12)} ${(c.data()?.name || "(missing)").padEnd(30)} ${clinicId}${isDemo}`);
}

console.log(
  demoId && roles[demoId]
    ? `\nThis account CAN open the demo clinic.\n`
    : `\nThis account CANNOT open the demo clinic (${demoId || "not seeded"}).\n`
);
