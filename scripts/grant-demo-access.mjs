/**
 * Gives an existing account Admin on the demo clinic, so it shows up in their clinic switcher.
 *
 *   node scripts/grant-demo-access.mjs test77@test.com
 *
 * Only the role grant is written — nothing about the account itself changes, and its access to
 * every other clinic is untouched (clinicRoles is merged, not replaced). `delete-demo-clinic.mjs`
 * strips this grant from every account that holds it, so it cleans up with the rest of the demo.
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
  console.error("Usage: node scripts/grant-demo-access.mjs <email>");
  process.exit(1);
}

const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
const clinicId = demo.docs[0].id;

const users = await db.collection("users").where("email", "==", email).limit(1).get();
if (users.empty) throw new Error(`No user document for ${email}`);
const user = users.docs[0];

const before = Object.keys(user.data().clinicRoles || {}).length;

/**
 * `--make-default` also points defaultClinicId at the demo clinic.
 *
 * Worth it for a screenshot account. ClinicContext only consults the `preferredClinicId` that the
 * clinic switcher writes when nothing else has already resolved, so on every full page load the
 * selection falls back to `defaultClinicId || userClinics[0]`. Without this the account snaps back
 * to its own clinic on each navigation — which, mid-capture, silently puts real patient names on
 * screen. `delete-demo-clinic.mjs` clears the field again when it matches the demo clinic.
 */
const makeDefault = process.argv.includes("--make-default");

// Nested map, not a dotted key — see the long note in api/onboarding/create-clinic. A dot in a
// set() key becomes part of the field NAME and silently creates a useless top-level field.
const patch = { clinicRoles: { [clinicId]: "Admin" } };
if (makeDefault) patch.defaultClinicId = clinicId;
await user.ref.set(patch, { merge: true });

const after = await user.ref.get();
const roles = after.data().clinicRoles || {};

console.log(`\n${after.data().name || "(unnamed)"} <${email}>`);
console.log(`granted Admin on "${demo.docs[0].data().name}" (${clinicId})`);
console.log(`clinics reachable: ${before} → ${Object.keys(roles).length}`);
console.log(`role now reads: ${roles[clinicId]}`);
console.log(`defaultClinicId: ${after.data().defaultClinicId || "(none)"}\n`);
console.log("Refresh the app — the demo clinic appears in the clinic switcher.\n");
