/**
 * Prints the id of the clinic the walkthrough created on camera.
 *
 *   node scripts/promo-find-clinic.mjs --name "<clinic name>"
 *
 * Parts 1–5 of the walkthrough are recorded with `--clinic <id>` and seeded with the same id, and
 * the id only exists after part 0's take. Newest match wins, in case a previous take's clinic was
 * not cleaned up yet — and it says so, because two clinics with the demo's name is exactly the
 * situation promo-clean-clinic.mjs exists for.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { RECORDING_UID } from "./promo-config.mjs";

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

const i = process.argv.indexOf("--name");
const name = i === -1 ? null : process.argv[i + 1];
if (!name) throw new Error('Pass --name "<clinic name>".');

const snap = await db.collection("clinics").where("name", "==", name).get();
const mine = snap.docs
  .filter((d) => d.data().ownerId === RECORDING_UID && !d.data().__demo)
  .map((d) => ({ id: d.id, at: d.data().createdAt?.toDate?.()?.getTime?.() || 0 }))
  .sort((a, b) => b.at - a.at);

if (!mine.length) { console.error(`No clinic named "${name}" owned by the recording account.`); process.exit(2); }
if (mine.length > 1) console.error(`Note: ${mine.length} clinics carry this name; using the newest. Clean the rest with promo-clean-clinic.mjs.`);
console.log(mine[0].id);
