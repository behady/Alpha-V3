/**
 * Read-only sanity check on the seeded demo clinic. Writes nothing.
 *
 *   node scripts/verify-demo-clinic.mjs
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

function adminDb() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .trim();
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getFirestore(getApps()[0], "default");
}

const pad = (n) => String(n).padStart(2, "0");

async function main() {
  loadEnvLocal();
  const db = adminDb();

  const found = await db.collection("clinics").where(DEMO_MARKER, "==", true).get();
  if (found.empty) {
    console.log("\nNo demo clinic found.\n");
    return;
  }

  const clinic = found.docs[0];
  const id = clinic.id;
  console.log(`\n"${clinic.data().name}"  ·  ${clinic.data().subscriptionTier}  ·  ${id}\n`);

  for (const sub of [
    "patients", "appointments", "ledger", "clinical_notes",
    "services", "inventory", "staff", "settings",
  ]) {
    const n = await db.collection(`clinics/${id}/${sub}`).count().get();
    console.log(`  ${sub.padEnd(16)} ${n.data().count}`);
  }

  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const t = await db.collection(`clinics/${id}/appointments`).where("date", "==", today).get();
  console.log(`\ntoday (${today}) — ${t.size} appointments`);
  t.docs
    .sort((a, b) => a.data().time.localeCompare(b.data().time))
    .forEach((d) => {
      const a = d.data();
      console.log(`  ${a.time}  ${a.patientName.padEnd(22)} ${a.treatment.padEnd(24)} [${a.status}]`);
    });

  const reqs = await db.collection("join_requests").where("clinicId", "==", id).get();
  console.log(`\npending join requests : ${reqs.size}`);

  const inv = await db.collection(`clinics/${id}/inventory`).get();
  const low = inv.docs.filter((d) => d.data().stock < d.data().minStock);
  console.log(`low-stock items       : ${low.length} — ${low.map((d) => d.data().name).join(", ")}`);

  // Mirrors lib/revenueRecovery.rowAmount: a charge is measured by `amount`, a payment by `paid`.
  const ledger = await db.collection(`clinics/${id}/ledger`).get();
  const rows = ledger.docs.map((d) => d.data());
  const billed = rows.filter((r) => r.type === "procedure").reduce((s, r) => s + (r.amount || 0), 0);
  const collected = rows.filter((r) => r.type === "payment").reduce((s, r) => s + (r.paid || 0), 0);
  const todayCash = rows
    .filter((r) => r.type === "payment" && r.date === today)
    .reduce((s, r) => s + (r.paid || 0), 0);

  console.log(`charges / payments    : ${rows.filter((r) => r.type === "procedure").length} / ${rows.filter((r) => r.type === "payment").length} rows`);
  console.log(`billed / collected    : EGP ${billed.toLocaleString()} / ${collected.toLocaleString()}`);
  console.log(`outstanding           : EGP ${(billed - collected).toLocaleString()}`);
  console.log(`today's cash (dashboard Daily Income) : EGP ${todayCash.toLocaleString()}`);

  const staff = await db.collection(`clinics/${id}/staff`).get();
  console.log(`\nteam:`);
  staff.docs.forEach((d) => {
    const s = d.data();
    console.log(`  ${s.role.padEnd(13)} ${s.name.padEnd(22)} ${(s.permissions || []).length} permissions`);
  });
  console.log("");
}

main().catch((err) => {
  console.error("\nVerify failed:", err.message, "\n");
  process.exit(1);
});
