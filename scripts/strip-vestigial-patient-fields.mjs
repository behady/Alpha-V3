/**
 * Removes the two patient fields nothing maintains: `balance` and `totalSpent`.
 *
 *   node scripts/strip-vestigial-patient-fields.mjs --dry-run             # count what would change
 *   node scripts/strip-vestigial-patient-fields.mjs --dry-run --clinic X  # one clinic
 *   node scripts/strip-vestigial-patient-fields.mjs                       # do it
 *
 * Both fields were written once, at patient creation, and never updated again — so every patient
 * record has carried a permanent `balance: 0` that reads as authoritative while the real figure is
 * derived from the ledger every time it is displayed (see PatientFinance and lib/paymentRecovery).
 * A stored zero next to a real debt is the kind of detail that makes someone trust the wrong
 * number, which is why they are being removed rather than left as harmless clutter.
 *
 * Safe by construction: this only ever deletes those two field names, never a document, and only
 * touches documents that actually carry one of them.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const DRY_RUN = process.argv.includes("--dry-run");
const clinicArgIndex = process.argv.indexOf("--clinic");
const ONLY_CLINIC = clinicArgIndex !== -1 ? process.argv[clinicArgIndex + 1] : null;

/** The only fields this script is ever allowed to touch. */
const FIELDS = ["balance", "totalSpent"];

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 400;

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
  return getFirestore(getApps()[0], "default");
}

async function stripClinic(db, clinicId) {
  const patients = db.collection("clinics").doc(clinicId).collection("patients");
  let scanned = 0;
  let touched = 0;
  let pending = [];

  const flush = async () => {
    if (!pending.length || DRY_RUN) {
      pending = [];
      return;
    }
    const batch = db.batch();
    const payload = Object.fromEntries(FIELDS.map((f) => [f, FieldValue.delete()]));
    for (const ref of pending) batch.update(ref, payload);
    await batch.commit();
    pending = [];
  };

  // Paged by document id so the walk is stable even while the clinic is in use.
  let cursor = null;
  for (;;) {
    let q = patients.orderBy("__name__").limit(500);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() || {};
      if (!FIELDS.some((f) => data[f] !== undefined)) continue;
      touched += 1;
      pending.push(doc.ref);
      if (pending.length >= BATCH_LIMIT) await flush();
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }
  await flush();

  return { scanned, touched };
}

async function main() {
  loadEnvLocal();
  const db = adminDb();

  console.log(`\nProject : ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Mode    : ${DRY_RUN ? "DRY RUN — nothing will be written" : "APPLY"}`);
  console.log(`Fields  : ${FIELDS.join(", ")}\n`);

  const clinicIds = ONLY_CLINIC
    ? [ONLY_CLINIC]
    : (await db.collection("clinics").select().get()).docs.map((d) => d.id);

  let totalScanned = 0;
  let totalTouched = 0;

  for (const clinicId of clinicIds) {
    const { scanned, touched } = await stripClinic(db, clinicId);
    totalScanned += scanned;
    totalTouched += touched;
    if (touched) {
      console.log(`  ${DRY_RUN ? "would clear" : "cleared"} ${touched}/${scanned} · clinic ${clinicId}`);
    }
  }

  console.log(
    `\n${DRY_RUN ? "Would clear" : "Cleared"} ${totalTouched} of ${totalScanned} patient records ` +
      `across ${clinicIds.length} clinic(s).`
  );
  if (DRY_RUN && totalTouched > 0) console.log("Re-run without --dry-run to apply.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
