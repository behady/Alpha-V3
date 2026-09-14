/**
 * Removes the appointments the diary chapter books while it is being recorded.
 *
 *   node scripts/promo-clean-bookings.mjs [--dry-run]
 *
 * The chapter books a real appointment on camera, which is the whole point — but it books the
 * SAME patient into the SAME slot on every take, and those bookings are made through the UI, so
 * they carry no `__demo` marker and survive a re-seed. After a few takes the payoff shot showed
 * three identical five o'clock consultations stacked on top of each other, which reads as a bug
 * in the product rather than as a demo.
 *
 * Run this before each take. It only ever deletes appointments matching the chapter's exact
 * signature — that patient, that time, today — so a seeded appointment is never at risk.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { DEMO_MARKER } from "./demo-clinic-data.mjs";
import { STAR_PATIENT } from "./promo-chapters.mjs";

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
// This project's Firestore database is named "default", not "(default)".
const db = getFirestore(getApps()[0], "default");

const DRY = process.argv.includes("--dry-run");

/** What the diary chapter books: see CHAPTERS.diary beat 5. */
const SLOT_TIME = "17:00";

async function main() {
  const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
  if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
  const clinicId = demo.docs[0].id;

  /**
   * Local date, built by hand. `toISOString().slice(0,10)` is UTC, and Cairo is ahead of it —
   * so after midnight local it names YESTERDAY, and this script quietly found nothing to clean
   * while the duplicates were still sitting in today's diary.
   */
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const snap = await db
    .collection(`clinics/${clinicId}/appointments`)
    // By NAME, not id: re-seeding the demo clinic mints new patient documents, so a hard-coded
    // patient id goes stale the moment the diary is re-centred — and this script then silently
    // reports nothing to clean while the duplicates are still on screen.
    .where("patientName", "==", STAR_PATIENT.name)
    .where("date", "==", today)
    .get();

  /**
   * Matched on the absence of the demo marker, not on the time.
   *
   * Matching the time looked obvious and does not work: the booking dialog writes
   * `time: "05:00 PM"` while the seeder writes 24-hour `"09:00"`, so the two formats coexist in
   * one collection and a `startsWith("17")` test finds neither. Everything seeded carries
   * `__demo`, so anything for this patient today WITHOUT it can only be a take of this chapter.
   */
  const targets = snap.docs.filter((d) => !d.data()[DEMO_MARKER]);

  console.log(`Demo clinic : ${clinicId}`);
  console.log(`Looking for : ${STAR_PATIENT.name}, ${today}, un-seeded bookings (chapter slot ${SLOT_TIME})`);
  console.log(`Found       : ${targets.length} of ${snap.size} appointment(s) for that patient today\n`);

  for (const doc of targets) {
    const d = doc.data();
    console.log(`  ${doc.id}  ${d.time}  ${d.treatment} · ${d.doctor}${d[DEMO_MARKER] ? "  (seeded — SKIPPED)" : ""}`);
    // Belt and braces: a seeded appointment is never this chapter's doing, so never delete one.
    if (d[DEMO_MARKER]) continue;
    if (!DRY) await doc.ref.delete();
  }

  const removed = targets.filter((d) => !d.data()[DEMO_MARKER]).length;
  console.log(DRY ? `\nDry run — ${removed} would be deleted.` : `\nDeleted ${removed}.`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
