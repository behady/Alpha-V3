/**
 * Read-only: what the apps see when they resolve this account's clinic and role.
 *
 *   node scripts/whoami-roles.mjs <email>
 *
 * The website reads isSuperAdmin, then clinicRoles[selected clinic]. The phone
 * reads defaultClinicId, falls back to the first clinicRoles key, and (before
 * v5.24) never read isSuperAdmin at all. When those two disagree, the same login
 * is an owner on one and an assistant on the other.
 */
import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k]) continue;
    process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();
const PK = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: PK.split(String.fromCharCode(92) + "n").join("\n").trim(),
    }),
  });
}
const db = getFirestore(getApps()[0], "default");

const email = (process.argv[2] || "").toLowerCase();
if (!email) throw new Error("Usage: node scripts/whoami-roles.mjs <email>");

let users = await db.collection("users").where("email", "==", email).get();
// The staff row's email and the account's own email are separate fields and do
// drift apart, so fall back to whatever uid the clinic's staff list carries.
if (users.empty && process.argv[3]) {
  const staff = await db.collection("clinics").doc(process.argv[3]).collection("staff").get();
  const uids = staff.docs
    .filter((d) => String(d.data()?.email || "").toLowerCase() === email)
    .map((d) => String(d.data()?.uid || "").trim())
    .filter(Boolean);
  const docs = [];
  for (const uid of uids) {
    const snap = await db.collection("users").doc(uid).get();
    if (snap.exists) docs.push(snap);
  }
  users = { empty: docs.length === 0, docs };
  if (docs.length) console.log(`(matched via the clinic staff list, not users.email)`);
}
if (users.empty) {
  console.log(`No users/ document for ${email}`);
} else {
  for (const u of users.docs) {
    const d = u.data() || {};
    const roles = d.clinicRoles || {};
    console.log(`\nuid ${u.id}  (${d.name || "no name"})`);
    console.log(`  isSuperAdmin : ${d.isSuperAdmin === true || d.isSuperAdmin === "true"}`);
    console.log(`  legacy role  : ${d.role ?? "(none)"}`);
    console.log(`  defaultClinic: ${d.defaultClinicId ?? "(none)"}`);
    console.log(`  devices      : ${Array.isArray(d.fcmTokens) ? d.fcmTokens.filter(Boolean).length : 0}`);
    const perms = d.clinicPermissions || {};
    console.log(`  permissions  :`);
    for (const cid of Object.keys(perms)) {
      const list = Array.isArray(perms[cid]) ? perms[cid] : [];
      console.log(`     ${cid}: ${list.length ? list.join(", ") : "(empty)"}`);
    }
    if (!Object.keys(perms).length) console.log("     (none granted anywhere)");
    console.log(`  clinicRoles  :`);
    const keys = Object.keys(roles);
    if (!keys.length) console.log("     (none — the phone would have nothing to fall back to)");
    for (const cid of keys) {
      const c = await db.collection("clinics").doc(cid).get();
      console.log(`     ${cid} = ${roles[cid]}  → ${c.exists ? c.data()?.name || "(no name)" : "CLINIC DELETED"}`);
    }
    const def = d.defaultClinicId;
    const phonePick = (def && keys.includes(def)) ? def : keys[0];
    console.log(`  → phone would open clinic ${phonePick ?? "(none)"} as role "${roles[phonePick] ?? d.role ?? "Assistant"}"`);
  }
}
