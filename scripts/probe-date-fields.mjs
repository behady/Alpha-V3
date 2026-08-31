/**
 * Read-only: what type is actually stored in the date fields we want to query on?
 *
 *   node scripts/probe-date-fields.mjs
 *
 * Moving a filter from the browser to Firestore only works if the field holds one comparable
 * type. `normalizeDate` on the marketing page accepts a Timestamp, an ISO string, or anything
 * `new Date()` can parse — so the tolerant reader hides whatever the writers actually did, and a
 * `where("date", ">=", "2026-08-01")` would silently skip every row that is not a string. On a
 * marketing revenue report, silently skipping rows is worse than being slow.
 *
 * Samples rather than scans: enough to see whether the field is uniform, without paying to read
 * the collections this exists to stop reading.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const SAMPLE = 300;

const TARGETS = [
  { collection: "ledger", fields: ["date", "createdAt"] },
  { collection: "leads", fields: ["createdAt"] },
  { collection: "appointments", fields: ["date", "createdAt"] },
  { collection: "system_logs", fields: ["timestamp"] },
];

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

function adminDb() {
  if (getApps().length === 0) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey,
      }),
    });
  }
  // This project's Firestore database is NAMED "default" — not the unnamed "(default)" one.
  return getFirestore(getApps()[0], "default");
}

function describe(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "object" && typeof value.toDate === "function") return "Timestamp";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "string YYYY-MM-DD";
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "string ISO";
    return `string other (${value.slice(0, 18)})`;
  }
  return typeof value;
}

async function main() {
  loadEnvLocal();
  const db = adminDb();
  const clinics = await db.collection("clinics").listDocuments();
  console.log(`${clinics.length} clinic(s), sampling up to ${SAMPLE} docs per collection\n`);

  for (const { collection, fields } of TARGETS) {
    const shapes = {};
    let total = 0;
    for (const clinic of clinics) {
      const snap = await clinic.collection(collection).limit(SAMPLE).get();
      for (const doc of snap.docs) {
        total += 1;
        const data = doc.data() || {};
        for (const field of fields) {
          const key = `${field}: ${describe(data[field])}`;
          shapes[key] = (shapes[key] || 0) + 1;
        }
      }
    }
    console.log(`${collection}  (${total} sampled)`);
    if (total === 0) console.log("   empty");
    for (const [shape, n] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(5)}  ${shape}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
