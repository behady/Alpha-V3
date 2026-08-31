/**
 * Fills in `interest` on leads that arrived before the webhook learned to read it.
 *
 *   node scripts/backfill-lead-interest.mjs                 # dry run, prints what it would set
 *   node scripts/backfill-lead-interest.mjs --apply         # writes
 *   node scripts/backfill-lead-interest.mjs --clinic-id=abc # one clinic instead of every connected page
 *
 * The retry sweep cannot do this: those leads were delivered successfully, so nothing ever looks
 * at them again. Their answers are already sitting in the notes — this re-reads them through the
 * same `detectInterest` the webhook now uses, so a backfilled lead and a new one agree.
 *
 * Only ever fills a blank. A lead whose interest reception typed by hand is left exactly as it is.
 *
 * Uses the same .env.local admin credentials and the named "default" database as every other
 * script here (see seed-demo-clinic.mjs for why the name matters).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { detectInterest } = require(path.join(ROOT, "functions", "metaLeads.js"));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const APPLY = args.apply === true;

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
if (!projectId || !clientEmail || !privateKey) throw new Error("Missing Firebase admin env in .env.local");
if (getApps().length === 0) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(getApps()[0], "default");

/**
 * The webhook reads Meta's field_data; a lead already written has only the notes it produced.
 * Those notes are one "question: answer" per line, so they rebuild the same shape well enough
 * for `detectInterest` to give the identical answer.
 */
function fieldDataFromNotes(notes) {
  return String(notes || "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf(":");
      if (at === -1) return null;
      const name = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim();
      if (!name || !value) return null;
      if (/^(campaign|ad|email|organic)$/i.test(name)) return null; // not questions the person answered
      return { name, values: [value] };
    })
    .filter(Boolean);
}

async function clinicServiceNames(clinicId) {
  try {
    const snap = await db.collection(`clinics/${clinicId}/services`).limit(200).get();
    return snap.docs.map((d) => String(d.data().name || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const clinicIds = args["clinic-id"]
  ? [String(args["clinic-id"])]
  : [
      ...new Set(
        (await db.collection("meta_pages").get()).docs.map((d) => d.data().clinicId).filter(Boolean)
      ),
    ];

if (clinicIds.length === 0) throw new Error("No clinics found — pass --clinic-id=<id>");
console.log(`${APPLY ? "APPLYING to" : "DRY RUN over"} ${clinicIds.length} clinic(s): ${clinicIds.join(", ")}\n`);

let filled = 0;
let skipped = 0;
let unreadable = 0;

for (const clinicId of clinicIds) {
  const services = await clinicServiceNames(clinicId);
  const leads = await db.collection(`clinics/${clinicId}/leads`).where("source", "==", "Meta ads").get();
  console.log(`clinic ${clinicId}: ${leads.size} Meta leads, ${services.length} services in the catalogue`);

  for (const doc of leads.docs) {
    const lead = doc.data();
    if (String(lead.interest || "").trim()) {
      skipped += 1;
      continue; // never overwrite what a person put there
    }

    const interest = detectInterest({
      fieldData: fieldDataFromNotes(lead.notes),
      campaignName: lead.meta?.campaignName || "",
      adName: lead.meta?.adName || "",
      clinicServices: services,
    });

    if (!interest) {
      unreadable += 1;
      console.log(`  · ${String(lead.name || doc.id).padEnd(24)} → (nothing recognisable)`);
      continue;
    }

    console.log(`  ✓ ${String(lead.name || doc.id).padEnd(24)} → ${interest}`);
    filled += 1;
    if (APPLY) {
      await doc.ref.set({ interest, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
}

console.log(
  `\n${APPLY ? "Filled" : "Would fill"} ${filled} lead(s). ` +
    `Left alone: ${skipped} that already had an interest, ${unreadable} with nothing to read.`
);
if (!APPLY && filled > 0) console.log("Re-run with --apply to write.");
process.exit(0);
