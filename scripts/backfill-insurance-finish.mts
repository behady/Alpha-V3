/**
 * Stores `finishedDate` and `workMonths` on insurance approvals saved before those fields existed.
 *
 *   npx tsx scripts/backfill-insurance-finish.mts                  # dry run: prints what it would set
 *   npx tsx scripts/backfill-insurance-finish.mts --apply          # writes
 *   npx tsx scripts/backfill-insurance-finish.mts --clinic-id=abc  # one clinic instead of all
 *
 * The claims route stores both fields on every write from now on, so an approval that is edited
 * gets them anyway. This is for the ones nobody touches again: without the fields they do not
 * appear when the Insurance page lists approvals "By finish date", and the Team page finds them
 * only through the older by-date listeners.
 *
 * It writes those two fields and nothing else. No service gets a day of its own, so every one
 * still reads as done on its approval's treated date (lib/insurance/billingMonth.ts): no approval
 * changes month on any sheet, and no dentist's share changes month. A claim that cannot be read
 * (`parseClaim` refuses it) is reported and left alone.
 *
 * Uses the .env.local admin credentials and the named "default" database, like every script here.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const APPLY = args.apply === true;
const ONLY_CLINIC = typeof args["clinic-id"] === "string" ? args["clinic-id"] : "";

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { CLAIMS_COLLECTION, parseClaim } = await import("../src/lib/insurance/claims");
const { billingFieldsToStore } = await import("../src/lib/insurance/billingMonth");

const db = adminDb();
const clinicIds = ONLY_CLINIC ? [ONLY_CLINIC] : (await db.collection("clinics").select().get()).docs.map((d) => d.id);

let seen = 0;
let changed = 0;
let unreadable = 0;
for (const clinicId of clinicIds) {
  const snap = await db.collection("clinics").doc(clinicId).collection(CLAIMS_COLLECTION).get();
  if (snap.empty) continue;
  let clinicChanged = 0;
  for (const doc of snap.docs) {
    seen += 1;
    const claim = parseClaim(doc.id, doc.data());
    if (!claim) {
      unreadable += 1;
      console.log(`  ?  ${clinicId}/${doc.id}  could not be read; left alone`);
      continue;
    }
    const want = billingFieldsToStore(claim);
    if (!want) continue;
    changed += 1;
    clinicChanged += 1;
    console.log(
      `  ${APPLY ? "set" : "would set"}  ${clinicId}/${doc.id}  ${claim.approvalNumber}  ${claim.status}  approved ${claim.approvalDate}  treated ${claim.treatedDate ?? "-"}  ->  finished ${want.finishedDate ?? "-"}  months [${want.workMonths.join(", ")}]`,
    );
    if (APPLY) await doc.ref.update({ finishedDate: want.finishedDate, workMonths: want.workMonths });
  }
  console.log(`${clinicId}: ${snap.size} approvals, ${clinicChanged} ${APPLY ? "updated" : "to update"}`);
}

console.log(`\n${seen} approvals read, ${changed} ${APPLY ? "updated" : "would be updated"}, ${unreadable} unreadable.${APPLY ? "" : "  (dry run: nothing was written; add --apply to write)"}`);
process.exit(0);
