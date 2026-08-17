/**
 * Removes everything `seed-demo-clinic.mjs` created, and nothing else.
 *
 *   node scripts/delete-demo-clinic.mjs --dry-run   # list what would go
 *   node scripts/delete-demo-clinic.mjs             # delete it
 *
 * Safety: this only ever touches clinics whose document carries `__demo: true`. A clinic without
 * that marker is skipped even if it is named like the demo one, so a real clinic cannot be
 * removed by running this by mistake.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { DEMO_MARKER } from "./demo-clinic-data.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const SUBCOLLECTIONS = [
  "patients", "appointments", "ledger", "clinical_notes", "services", "inventory",
  "inventory_transactions", "staff", "attendance", "notifications", "system_logs",
  "prescriptions", "patient_media", "drugs", "categories", "ortho_sessions",
  "whatsapp_logs", "settings",
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
  return getFirestore(getApps()[0], "default");
}

async function purge(db, ref, label) {
  let removed = 0;
  for (;;) {
    const snap = await ref.limit(400).get();
    if (snap.empty) break;
    if (DRY_RUN) return snap.size >= 400 ? "400+" : snap.size;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
  }
  if (removed) console.log(`  removed ${removed} · ${label}`);
  return removed;
}

async function main() {
  loadEnvLocal();
  const db = adminDb();

  console.log(`\nProject : ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Mode    : ${DRY_RUN ? "DRY RUN — nothing will be deleted" : "DELETE"}\n`);

  const demoClinics = await db.collection("clinics").where(DEMO_MARKER, "==", true).get();
  if (demoClinics.empty) {
    console.log("No demo clinic found. Nothing to do.\n");
    return;
  }

  for (const clinicDoc of demoClinics.docs) {
    // Belt and braces: never proceed on a clinic missing the marker.
    if (clinicDoc.data()[DEMO_MARKER] !== true) {
      console.log(`SKIPPED ${clinicDoc.id} — not marked as demo data.`);
      continue;
    }

    const clinicId = clinicDoc.id;
    console.log(`Demo clinic "${clinicDoc.data().name}" (${clinicId})`);

    for (const sub of SUBCOLLECTIONS) {
      const n = await purge(db, db.collection(`clinics/${clinicId}/${sub}`), sub);
      if (DRY_RUN && n) console.log(`  would remove ${n} · ${sub}`);
    }

    const reqs = await db.collection("join_requests").where("clinicId", "==", clinicId).get();
    if (!reqs.empty) {
      if (DRY_RUN) console.log(`  would remove ${reqs.size} · join_requests`);
      else {
        const b = db.batch();
        reqs.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
        console.log(`  removed ${reqs.size} · join_requests`);
      }
    }

    // Strip the role grant off every account that held one, including the real owner's.
    const holders = await db.collection("users").where(`clinicRoles.${clinicId}`, "!=", null).get();
    for (const u of holders.docs) {
      if (DRY_RUN) {
        console.log(`  would clear clinicRoles.${clinicId} on user ${u.data().email || u.id}`);
        continue;
      }
      const patch = { [`clinicRoles.${clinicId}`]: FieldValue.delete() };
      if (u.data().defaultClinicId === clinicId) patch.defaultClinicId = FieldValue.delete();
      await u.ref.update(patch);
      console.log(`  cleared role · ${u.data().email || u.id}`);
    }

    if (DRY_RUN) console.log(`  would remove the clinic document itself\n`);
    else {
      await clinicDoc.ref.delete();
      console.log(`  removed the clinic document\n`);
    }
  }

  // The fabricated staff logins live in the root users collection and are marked individually.
  const demoUsers = await db.collection("users").where(DEMO_MARKER, "==", true).get();
  if (!demoUsers.empty) {
    if (DRY_RUN) console.log(`Would remove ${demoUsers.size} demo user documents`);
    else {
      const b = db.batch();
      demoUsers.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      console.log(`Removed ${demoUsers.size} demo user documents`);
    }
  }

  console.log(DRY_RUN ? "\nDry run complete.\n" : "\nDone.\n");
}

main().catch((err) => {
  console.error("\nDelete failed:", err.message, "\n");
  process.exit(1);
});
