/**
 * Repairs historical payments that were recorded with no dentist and no commission.
 *
 *   node scripts/repair-payment-attribution.mjs --clinic <id>                # dry run (default)
 *   node scripts/repair-payment-attribution.mjs --clinic <id> --apply        # apply AUTO_FIXABLE only
 *   node scripts/repair-payment-attribution.mjs --clinic <id> --apply-reviewed approved.csv
 *   node scripts/repair-payment-attribution.mjs                              # dry run, every clinic
 *
 * Two of the four screens that took payments wrote the amount and nothing else. Those payments
 * paid the treating dentist zero and booked whole as clinic profit. They are written correctly
 * from now on; this is about the ones already in the database.
 *
 * WHAT THIS WILL NOT DO, and why it matters more than what it will:
 *
 *   Commission figures on this ledger have been corrected by hand. A repair that recomputed
 *   everything from each dentist's standing rate would quietly reverse those corrections, and
 *   nobody would notice until a payout was wrong in a month nobody was checking. So any payment
 *   that already carries a commission figure — any value, including an explicit zero — is left
 *   exactly as it is. A correct row and a hand-corrected row look identical from the outside, and
 *   the only safe reading of that ambiguity is "someone decided this; leave it".
 *
 *   It also never writes a row it is not repairing. The lab fee belongs on a procedure's earliest
 *   payment, so fixing one row can imply moving the fee off another — when that other row is one
 *   we may not touch, the repair is downgraded to REVIEW rather than half-applied.
 *
 * The classification lives in src/lib/repairPaymentAttribution.ts and is covered by
 * tests/repairClassifier.test.mjs. This file is the shell that reads Firestore and writes the
 * report; it makes no decisions of its own.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { classifyAllPayments } from "../src/lib/repairPaymentAttribution.ts";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] || null;
};

const APPLY = has("--apply");
const APPLY_REVIEWED = valueOf("--apply-reviewed");
const ONLY_CLINIC = valueOf("--clinic");
const OUT_DIR = valueOf("--out") || process.cwd();

/** Ledger volume is unbounded; cap the read so one large clinic cannot exhaust memory. */
const SCAN_LIMIT = 20000;

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

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeReport(clinicId, report) {
  const stamp = report.scannedAt.slice(0, 10);
  const base = path.join(OUT_DIR, `repair-report-${clinicId}-${stamp}`);

  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));

  const header = [
    "paymentId", "class", "patientName", "date", "amount",
    "currentDoctorId", "currentPct", "currentCommission", "currentLabFee",
    "proposedDoctorId", "proposedDoctorName", "proposedPct", "proposedCommission", "proposedLabFee",
    "reason",
  ];
  const rows = report.verdicts.map((v) =>
    [
      v.paymentId, v.class, v.patientName, v.date, v.amount,
      v.current.doctorId, v.current.doctorCommissionPercentage, v.current.doctorCommissionAmount, v.current.labFee,
      v.proposal?.doctorId, v.proposal?.doctorName, v.proposal?.doctorCommissionPercentage,
      v.proposal?.doctorCommissionAmount, v.proposal?.labFee,
      v.reason,
    ].map(csvCell).join(",")
  );
  fs.writeFileSync(`${base}.csv`, [header.join(","), ...rows].join("\n"));

  return base;
}

/** Payment ids a human has approved, from the first column of a CSV (the report's own shape). */
function readApprovedIds(file) {
  if (!fs.existsSync(file)) throw new Error(`Approval file not found: ${file}`);
  const ids = new Set();
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const first = line.split(",")[0].trim().replace(/^"|"$/g, "");
    if (!first || first === "paymentId") continue;
    ids.add(first);
  }
  return ids;
}

async function readLedger(db, clinicId) {
  const snap = await db.collection("clinics").doc(clinicId).collection("ledger").limit(SCAN_LIMIT).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function readStaff(db, clinicId) {
  const snap = await db.collection("clinics").doc(clinicId).collection("staff").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function applyVerdicts(db, clinicId, verdicts) {
  let written = 0;
  for (let i = 0; i < verdicts.length; i += 400) {
    const slice = verdicts.slice(i, i + 400);
    const batch = db.batch();
    for (const verdict of slice) {
      if (!verdict.proposal) continue;
      const ref = db.collection("clinics").doc(clinicId).collection("ledger").doc(verdict.paymentId);
      batch.update(ref, {
        doctorId: verdict.proposal.doctorId,
        doctorName: verdict.proposal.doctorName,
        doctorCommissionPercentage: verdict.proposal.doctorCommissionPercentage,
        doctorCommissionAmount: verdict.proposal.doctorCommissionAmount,
        clinicProfit: verdict.proposal.clinicProfit,
        labFee: verdict.proposal.labFee,
        // Stamped so a later pass can tell this figure came from the repair rather than from the
        // desk, and so the change is traceable without reading the audit trail.
        attributionRepairedAt: FieldValue.serverTimestamp(),
        attributionRepairedBy: "repair-script-v1",
      });
      // Same before/after record the API routes write, so a repaired row is as accountable as an
      // edited one.
      const auditRef = db.collection("clinics").doc(clinicId).collection("ledger_audit").doc();
      batch.set(auditRef, {
        action: "update",
        collection: "ledger",
        documentId: verdict.paymentId,
        before: verdict.current,
        after: verdict.proposal,
        byUid: null,
        byName: "repair-payment-attribution script",
        byRole: "script",
        via: "scripts/repair-payment-attribution.mjs",
        at: FieldValue.serverTimestamp(),
        date: new Date().toISOString().split("T")[0],
      });
      written += 1;
    }
    await batch.commit();
  }
  return written;
}

async function handleClinic(db, clinicId, approvedIds) {
  const [ledger, staff] = await Promise.all([readLedger(db, clinicId), readStaff(db, clinicId)]);
  const report = classifyAllPayments(clinicId, ledger, staff);

  if (ledger.length >= SCAN_LIMIT) {
    report.notes.push(`Only the first ${SCAN_LIMIT} ledger rows were read, so this is a partial view.`);
  }

  const base = writeReport(clinicId, report);

  console.log(`\nClinic ${clinicId}`);
  console.log(`  payments        : ${report.verdicts.length}`);
  console.log(`  never attributed: ${report.counts.AUTO_FIXABLE}  (repairable)`);
  console.log(`  left untouched  : ${report.counts.MANUAL_OR_OK}  (already carry a figure — may be hand-corrected)`);
  console.log(`  need a person   : ${report.counts.REVIEW}`);
  console.log(`  nothing to do   : ${report.counts.UNRESOLVABLE}`);
  console.log(`  commission that would be credited: ${report.commissionToCredit}`);
  console.log(`  report: ${base}.json / .csv`);
  for (const note of report.notes) console.log(`  · ${note}`);

  if (!APPLY && !approvedIds) return { fixed: 0 };

  const toApply = approvedIds
    ? report.verdicts.filter((v) => v.class === "REVIEW" && approvedIds.has(v.paymentId) && v.proposal)
    : report.verdicts.filter((v) => v.class === "AUTO_FIXABLE");

  if (toApply.length === 0) {
    console.log("  nothing to apply.");
    return { fixed: 0 };
  }

  const fixed = await applyVerdicts(db, clinicId, toApply);
  console.log(`  APPLIED to ${fixed} payment(s).`);
  return { fixed };
}

async function main() {
  loadEnvLocal();
  const db = adminDb();

  if (APPLY && APPLY_REVIEWED) {
    throw new Error("Use either --apply or --apply-reviewed, not both.");
  }
  const approvedIds = APPLY_REVIEWED ? readApprovedIds(APPLY_REVIEWED) : null;
  if (approvedIds && !ONLY_CLINIC) {
    throw new Error("--apply-reviewed needs --clinic: an approval list belongs to one clinic's report.");
  }

  console.log(`\nProject : ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(
    `Mode    : ${
      approvedIds
        ? `APPLY REVIEWED (${approvedIds.size} approved id(s))`
        : APPLY
          ? "APPLY — auto-fixable rows only"
          : "DRY RUN — nothing will be written"
    }`
  );

  const clinicIds = ONLY_CLINIC
    ? [ONLY_CLINIC]
    : (await db.collection("clinics").select().get()).docs.map((d) => d.id);

  let totalFixed = 0;
  for (const clinicId of clinicIds) {
    const { fixed } = await handleClinic(db, clinicId, approvedIds);
    totalFixed += fixed;
  }

  if (!APPLY && !approvedIds) {
    console.log("\nNothing was written. Read the report, then re-run with --apply.\n");
  } else {
    console.log(`\nRepaired ${totalFixed} payment(s) across ${clinicIds.length} clinic(s).\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
