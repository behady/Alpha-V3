/**
 * Find ledger rows and clinical notes sitting in the wrong clinic's books.
 *
 *   node scripts/find-misplaced-records.mjs                 # every clinic
 *   node scripts/find-misplaced-records.mjs --clinic <id>   # just one
 *   node scripts/find-misplaced-records.mjs --since 2026-06-01
 *
 * WHAT WENT WRONG
 *
 * Six of the seven money and clinical write paths never told the server which clinic they meant, so
 * the routes fell back to the caller's `defaultClinicId`. Somebody working at their second clinic
 * had writes resolved against their first.
 *
 * MOST of those writes failed rather than landing wrong, which is the difference between an
 * annoyance and an audit. A procedure verifies the patient exists in the resolved clinic inside its
 * transaction, and the dentist before that; a payment against a procedure verifies the procedure
 * row. All three are absent from the wrong clinic, so the save is refused — that refusal, reported
 * as "Choose the dentist who performed this treatment", is how the bug was found.
 *
 * Two paths have no such anchor:
 *
 *   - a payment NOT tied to a procedure (money on account) checks only that a patient id was
 *     supplied, never that the patient belongs to the clinic being written to;
 *   - a clinic income or expense line names no patient at all.
 *
 * The first leaves a fingerprint this script reads: a row naming a patient who does not exist in
 * the clinic holding it, while another clinic has exactly that patient. Firestore ids are random,
 * so that is not coincidence. The second leaves nothing, and the report says so instead of
 * counting it as clean.
 *
 * IT ONLY READS. Nothing here writes, and there is no --apply.
 *
 * Moving a payment from one clinic's books to another changes two clinics' revenue, two dentists'
 * commission, and a patient's balance in both. It is an accounting decision with a paper trail
 * behind it, not a mechanical one, and it should be made per row by somebody who can see both
 * sides — not by a script that inferred the answer from an id.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  classifyRecord,
  countVerdict,
  emptySummary,
  verdictHeadline,
} from "../src/lib/misplacedRecords.ts";

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const v = args[i + 1];
  return !v || v.startsWith("--") ? null : v;
};

const ONLY_CLINIC = valueOf("--clinic");
const SINCE = valueOf("--since");
const OUT_DIR = valueOf("--out") || process.cwd();

/** Where a misplaced write could actually have landed. Both carry a patientId. */
const COLLECTIONS = ["ledger", "clinical_notes"];

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

function db() {
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
  // This project's database is literally named `default`, not `(default)`. Bind to the wrong one
  // and every query succeeds and matches nothing, which would read as a clean bill of health.
  return getFirestore(getApps()[0], "default");
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  loadEnvLocal();
  const store = db();

  const clinicsSnap = await store.collection("clinics").get();
  const clinics = clinicsSnap.docs.map((d) => ({ id: d.id, name: String(d.data()?.name || "") }));
  if (clinics.length === 0) throw new Error("No clinics found. Check the credentials in .env.local.");

  console.log(`\n  ${clinics.length} clinic(s) in this project.\n`);

  /**
   * Which clinic each patient belongs to, across ALL of them.
   *
   * Read in full even when --clinic narrows the scan, because the question a flagged row asks is
   * "then whose patient is this?" — and that cannot be answered from inside one clinic, which is
   * the whole difficulty. Every clinic's patient list is loaded whatever the scope.
   */
  const patientHomes = new Map();
  for (const clinic of clinics) {
    const snap = await store.collection(`clinics/${clinic.id}/patients`).select().get();
    for (const doc of snap.docs) {
      const list = patientHomes.get(doc.id) || [];
      list.push(clinic.id);
      patientHomes.set(doc.id, list);
    }
    console.log(`  ${clinic.name || clinic.id}: ${snap.size} patients`);
  }

  const scope = ONLY_CLINIC ? clinics.filter((c) => c.id === ONLY_CLINIC) : clinics;
  if (scope.length === 0) throw new Error(`No clinic with id "${ONLY_CLINIC}".`);

  const summary = emptySummary();
  const findings = [];
  const nameOf = new Map(clinics.map((c) => [c.id, c.name || c.id]));

  for (const clinic of scope) {
    for (const collection of COLLECTIONS) {
      const snap = await store.collection(`clinics/${clinic.id}/${collection}`).get();
      for (const doc of snap.docs) {
        const data = doc.data() || {};
        // A date filter narrows the reading, never the checking: a row is judged first and only
        // then dropped from the report, so the totals stay honest about what was examined.
        const verdict = classifyRecord(
          {
            clinicId: clinic.id,
            collection,
            documentId: doc.id,
            patientId: typeof data.patientId === "string" ? data.patientId : null,
            type: typeof data.type === "string" ? data.type : null,
          },
          patientHomes
        );
        countVerdict(summary, verdict);

        if (verdict.kind === "ok") continue;
        const date = String(data.date || "");
        if (SINCE && date && date < SINCE) continue;

        findings.push({
          verdict: verdict.kind,
          heldBy: `${nameOf.get(clinic.id)} (${clinic.id})`,
          belongsTo:
            verdict.kind === "misplaced"
              ? verdict.homeClinicIds.map((id) => `${nameOf.get(id)} (${id})`).join(" / ")
              : "",
          collection,
          documentId: doc.id,
          patientId: String(data.patientId || ""),
          type: String(data.type || ""),
          date,
          amount: data.amount ?? data.cost ?? "",
          note: verdict.kind === "unjudgeable" ? verdict.reason : "",
        });
      }
    }
    console.log(`  scanned ${nameOf.get(clinic.id)}`);
  }

  const misplaced = findings.filter((f) => f.verdict === "misplaced");
  const orphaned = findings.filter((f) => f.verdict === "orphaned");

  console.log(`\n  ${verdictHeadline(summary)}\n`);
  console.log(`    checked            ${summary.checked}`);
  console.log(`    in the right place ${summary.ok}`);
  console.log(`    MISPLACED          ${summary.misplaced}`);
  console.log(`    patient not found  ${summary.orphaned}   (most likely deleted since)`);
  console.log(`    cannot be judged   ${summary.unjudgeable}   (no patient on the row)`);

  if (misplaced.length) {
    console.log(`\n  Misplaced:`);
    for (const f of misplaced.slice(0, 20)) {
      console.log(`    ${f.collection}/${f.documentId}  ${f.date}  ${f.amount}`);
      console.log(`      held by   ${f.heldBy}`);
      console.log(`      belongs to ${f.belongsTo}`);
    }
    if (misplaced.length > 20) console.log(`    … and ${misplaced.length - 20} more, in the CSV.`);
  }

  if (findings.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(OUT_DIR, `misplaced-records-${stamp}.csv`);
    const header = "verdict,heldBy,belongsTo,collection,documentId,patientId,type,date,amount,note";
    fs.writeFileSync(
      file,
      [header, ...findings.map((f) =>
        [f.verdict, f.heldBy, f.belongsTo, f.collection, f.documentId, f.patientId, f.type, f.date, f.amount, f.note]
          .map(csvCell).join(",")
      )].join("\n")
    );
    console.log(`\n  Full list: ${file}`);
  }

  console.log(
    `\n  This script only reads. Moving a payment between clinics changes two clinics' revenue,\n` +
    `  two dentists' commission and a patient's balance on both sides — an accounting decision\n` +
    `  with a paper trail behind it, not a mechanical one. Decide row by row.\n`
  );
  if (orphaned.length) {
    console.log(`  The ${orphaned.length} "patient not found" rows are probably patients deleted since,`);
    console.log(`  not a tenancy problem. Worth a look, separately.\n`);
  }
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
});
