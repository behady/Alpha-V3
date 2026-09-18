/**
 * Removes the clinic the walkthrough creates on camera, so the next take can create it again.
 *
 *   node scripts/promo-clean-clinic.mjs --name "<clinic name>" [--dry-run]
 *
 * The walkthrough's opening minute creates a clinic through the real onboarding form — that is
 * the point of the shot — which means every take leaves one behind on the recording account.
 * The app's own trash route needs a superadmin, which the recording account is not, so this does
 * the same job with the admin SDK: the clinic document, every subcollection under it, and the
 * role each member holds for it.
 *
 * Three refusals, all deliberate:
 *   - never a clinic carrying the demo marker (that one is rebuilt by its own seeders),
 *   - never a clinic whose name does not match exactly,
 *   - never a clinic the recording account does not own.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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
// This project's Firestore database is named "default", not "(default)".
const db = getFirestore(getApps()[0], "default");

const DRY = process.argv.includes("--dry-run");
import { RECORDING_UID } from "./promo-config.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function deleteCollection(ref) {
  let n = 0;
  for (;;) {
    const snap = await ref.limit(300).get();
    if (snap.empty) return n;
    const batch = db.batch();
    for (const d of snap.docs) {
      // Subcollections of a document are not deleted with it; walk them first.
      for (const sub of await d.ref.listCollections()) n += await deleteCollection(sub);
      batch.delete(d.ref);
    }
    await batch.commit();
    n += snap.size;
  }
}

async function main() {
  const name = arg("name");
  if (!name) throw new Error('Pass --name "<exact clinic name>".');

  const snap = await db.collection("clinics").where("name", "==", name).get();
  const targets = snap.docs.filter((d) => !d.data()[DEMO_MARKER] && d.data().ownerId === RECORDING_UID);

  console.log(`Looking for : "${name}" owned by the recording account, not demo`);
  console.log(`Found       : ${targets.length} of ${snap.size} clinic(s) with that name\n`);
  if (!targets.length) return;

  for (const doc of targets) {
    const id = doc.id;
    const members = await db.collection("users").where(`clinicRoles.${id}`, "in", ["Owner", "Admin", "Dentist", "Assistant", "Receptionist"]).get()
      .catch(() => ({ docs: [] }));
    console.log(`  ${id}  created ${doc.data().createdAt?.toDate?.()?.toISOString?.().slice(0, 16) || "?"}  members=${members.docs.length}`);
    if (DRY) continue;

    let removed = 0;
    for (const sub of await doc.ref.listCollections()) removed += await deleteCollection(sub);
    for (const m of members.docs) {
      await m.ref.update({ [`clinicRoles.${id}`]: FieldValue.delete() });
      const data = m.data();
      if (data.defaultClinicId === id) await m.ref.update({ defaultClinicId: FieldValue.delete() });
    }
    await doc.ref.delete();
    console.log(`    deleted clinic + ${removed} document(s), ${members.docs.length} role(s) removed`);
  }
  console.log(DRY ? "\nDry run — nothing deleted." : "\nDone.");
}

// Only when run directly. Importing this module must never delete anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
}
