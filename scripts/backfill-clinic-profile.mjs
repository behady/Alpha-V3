/**
 * Folds `settings/clinicProfile` into `settings/clinic_info`, one document per clinic.
 *
 *   node scripts/backfill-clinic-profile.mjs                    # dry run, every clinic
 *   node scripts/backfill-clinic-profile.mjs --clinic <id>      # dry run, one clinic
 *   node scripts/backfill-clinic-profile.mjs --apply            # write
 *
 * WHY THE APP DOES NOT NEED THIS TO HAVE RUN
 *
 * Reads already fall back: getClinicProfile / getClinicProfileAdmin consult the old document for
 * the logo and the two Google links when clinic_info has not got them yet, so nothing disappears
 * for a clinic that has never opened the profile screen since the merge. This script exists so
 * that fallback can eventually be deleted, and so a clinic's data is not spread across two
 * documents any longer than it has to be.
 *
 * WHAT IT COPIES, AND WHAT IT REFUSES TO
 *
 * Only the three fields that lived nowhere else: googleMapsUrl, googleReviewUrl, logoUrl. Name,
 * phone and address exist on BOTH documents and clinic_info is the one the whole app has been
 * writing through the schedule, attendance and alerts screens — the profile document's copies are
 * the stale ones. Copying them back would silently undo edits. So a field already present on
 * clinic_info is never overwritten, and a name is only ever filled in when clinic_info has none.
 *
 * `name` is the field that matters most: the Android app reads snap.getString("name") with no
 * fallback, so a clinic whose name sits only under `clinicName` prints a blank letterhead on
 * every prescription issued from a phone. Where this finds one, it writes both spellings.
 *
 * The old document is left in place. Deleting it is a separate decision, worth taking only once
 * this has run everywhere and the fallback has been removed from the code.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] || null;
};

const APPLY = has("--apply");
const ONLY_CLINIC = valueOf("--clinic");

/** Lived only on the retired document. Safe to copy across. */
const PROFILE_ONLY = ["googleMapsUrl", "googleReviewUrl", "logoUrl"];

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
  // This project's Firestore database is literally NAMED "default" — it is not the unnamed
  // "(default)" one. `getFirestore()` with no id targets the unnamed database, which does not
  // exist here, and every read comes back "5 NOT_FOUND" as though the clinics were missing.
  return getFirestore(getApps()[0], "default");
}

const str = (value) => (typeof value === "string" ? value.trim() : "");

async function main() {
  loadEnvLocal();
  const db = adminDb();

  const clinicRefs = ONLY_CLINIC
    ? [db.collection("clinics").doc(ONLY_CLINIC)]
    : await db.collection("clinics").listDocuments();

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${clinicRefs.length} clinic(s)\n`);

  let changed = 0;
  let clean = 0;

  for (const ref of clinicRefs) {
    const [infoSnap, legacySnap] = await Promise.all([
      ref.collection("settings").doc("clinic_info").get(),
      ref.collection("settings").doc("clinicProfile").get(),
    ]);

    const info = infoSnap.exists ? infoSnap.data() : {};
    const legacy = legacySnap.exists ? legacySnap.data() : null;
    const label = str(info.name) || str(info.clinicName) || ref.id;

    if (!legacy) {
      clean++;
      continue;
    }

    const patch = {};
    for (const field of PROFILE_ONLY) {
      if (!str(info[field]) && str(legacy[field])) patch[field] = str(legacy[field]);
    }

    // Only when clinic_info has no name at all. Its copy is otherwise the live one.
    const infoName = str(info.name) || str(info.clinicName);
    const legacyName = str(legacy.clinicName) || str(legacy.name);
    if (!infoName && legacyName) {
      patch.name = legacyName;
      patch.clinicName = legacyName;
    } else if (infoName && !str(info.name)) {
      // Name present, but only under `clinicName` — Android reads `name` and would print blank.
      patch.name = infoName;
    }

    if (Object.keys(patch).length === 0) {
      clean++;
      continue;
    }

    changed++;
    console.log(`${ref.id}  ${label}`);
    for (const [field, value] of Object.entries(patch)) {
      const shown = field === "logoUrl" ? `${value.slice(0, 60)}…` : value;
      console.log(`   + ${field}: ${shown}`);
    }

    if (APPLY) {
      await ref
        .collection("settings")
        .doc("clinic_info")
        .set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    }
    console.log("");
  }

  console.log(`${changed} clinic(s) ${APPLY ? "updated" : "would be updated"}, ${clean} already merged.`);
  if (!APPLY && changed > 0) console.log("\nRe-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
