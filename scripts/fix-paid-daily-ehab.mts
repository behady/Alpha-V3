/**
 * One-time fix: Dr Mohamed Ehab at Alpha Dental Clinic becomes "paid daily", with his whole history.
 *
 *   npx tsx scripts/fix-paid-daily-ehab.mts                       # inventory + dry run: reads only, writes a backup file
 *   npx tsx scripts/fix-paid-daily-ehab.mts --apply --backup=F    # writes, only if nothing changed since that dry run
 *   npx tsx scripts/fix-paid-daily-ehab.mts --restore=F           # puts every touched record back as it was in F
 *
 * Spec: docs/superpowers/specs/2026-11-28-paid-daily-dentists-design.md §8.
 *
 * Pinned to ONE clinic and ONE dentist. Every document it may write is listed by the dry run and
 * saved, in full, to the backup file first; --apply refuses to run if any of them changed since, and
 * writes nothing outside that list except the automatic day's-share lines the app itself creates.
 *
 * What it does:
 *   1. re-points his old-copy records (ledger rows and clinical notes on the pre-August staff id) to
 *      his current staff record;
 *   2. gives his payments that carry no dentist (their treatment is his) his id and name;
 *   3. removes the three lump payouts recorded on the Team page and their Salary rows;
 *   4. switches "Paid daily" on from his first payment, and lets the app write one day's-share line
 *      per day (lib/server/dailyPaySync.ts), then re-stamps what is paid.
 *
 * Uses the .env.local admin credentials (the live database), found in this folder or a parent.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const CLINIC = "SmtW6r6jKaFhfRWYcxsG";
const STAFF = "XLBIC0YPS9ogSe7K4UR3";
const STAFF_NAME = "Mohamed Ehab";
const OLD_ID = "dsQWVT4RmwvaC5Y9NZcF";
/** The three lump payouts recorded on the Team page (31 Oct 21,700 · 9 Nov 7,050 · 28 Nov 11,800). */
const LUMP_SETTLEMENTS = ["JJMTUnkDWt30uuX63EPX", "dwR6mDChg8dALLBnlE5w", "tC572khoOl8rLcUUHnN5"];
const BACKUP_DIR = "C:/Users/PC/alpha-backups";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const APPLY = args.apply === true;
const RESTORE = typeof args.restore === "string" ? args.restore : "";
const BACKUP_IN = typeof args.backup === "string" ? args.backup : "";

// --- credentials: .env.local here or in a parent folder (the worktree sits inside the main checkout)
{
  let dir = ROOT;
  let envFile = "";
  for (let i = 0; i < 6; i += 1) {
    const f = path.join(dir, ".env.local");
    if (fs.existsSync(f)) {
      envFile = f;
      break;
    }
    dir = path.dirname(dir);
  }
  if (!envFile) throw new Error("No .env.local found");
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const { Timestamp } = await import("firebase-admin/firestore");
const { adminDb } = await import("../src/lib/firebaseAdmin");
const { dailyShares, dailyPayStart } = await import("../src/lib/dailyPay");
const { syncDailyPay } = await import("../src/lib/server/dailyPaySync");
const { writeLedgerAudit } = await import("../src/lib/server/ledgerAuditWrite");
const { commissionByStaff } = await import("../src/lib/staffCommission");
const { parseSettlement, settleEarnings, SETTLEMENTS_COLLECTION } = await import("../src/lib/staffSettlement");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
type Json = Record<string, any>;
type Doc = { path: string; id: string; data: Json };

const money = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => money(n).toLocaleString("en-US");
const sum = (rows: Json[], f: (r: Json) => number) => money(rows.reduce((a, r) => a + f(r), 0));
const share = (r: Json) => Number(r.doctorCommissionAmount) || 0;
const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));
const AUDIT_ACTOR = { uid: "script:paid-daily-ehab", name: "One-time fix (paid daily)", role: "system" };

async function readDocs(coll: string, ids: string[]): Promise<Doc[]> {
  if (ids.length === 0) return [];
  const snaps = await db.getAll(...ids.map((id) => clinic.collection(coll).doc(id)));
  return snaps.filter((s) => s.exists).map((s) => ({ path: `${coll}/${s.id}`, id: s.id, data: s.data() as Json }));
}

// =================================================================================================
// RESTORE
// =================================================================================================
if (RESTORE) {
  const backup = JSON.parse(fs.readFileSync(RESTORE, "utf8")) as { clinicId: string; staffId: string; docs: Doc[] };
  if (backup.clinicId !== CLINIC || backup.staffId !== STAFF) throw new Error("This backup is for another clinic or dentist.");
  // The day's-share lines the fix created go first, so the restored lump payouts stand alone again.
  const autos = await clinic.collection(SETTLEMENTS_COLLECTION).where("staffId", "==", STAFF).get();
  let removed = 0;
  for (const d of autos.docs) {
    if (d.get("auto") !== "daily") continue;
    const ledgerId = String(d.get("ledgerId") || "");
    if (ledgerId) await clinic.collection("ledger").doc(ledgerId).delete();
    await d.ref.delete();
    removed += 1;
  }
  for (const doc of backup.docs) {
    const [coll, id, ...rest] = doc.path.split("/");
    if (!coll || !id || rest.length > 0) throw new Error(`Unexpected path in backup: ${doc.path}`);
    await clinic.collection(coll).doc(id).set(restoreTimestamps(doc.data));
  }
  console.log(`Restored ${backup.docs.length} records from ${RESTORE}; removed ${removed} day's-share lines.`);
  const { restampStaffSettlements } = await import("../src/lib/server/staffSettlementSync");
  await restampStaffSettlements(CLINIC, STAFF);
  console.log("Re-stamped paid amounts. Done.");
  process.exit(0);
}

/** Backups store Firestore timestamps as {_seconds,_nanoseconds}; put them back as timestamps. */
function restoreTimestamps(value: any): any {
  if (Array.isArray(value)) return value.map(restoreTimestamps);
  if (value && typeof value === "object") {
    if (typeof value._seconds === "number" && typeof value._nanoseconds === "number" && Object.keys(value).length === 2) return new Timestamp(value._seconds, value._nanoseconds);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreTimestamps(v)]));
  }
  return value;
}

// =================================================================================================
// INVENTORY (read-only)
// =================================================================================================
console.log(`Clinic ${CLINIC} · dentist ${STAFF_NAME} (${STAFF}) · old copy ${OLD_ID}\n`);

const staffSnap = await clinic.collection("staff").doc(STAFF).get();
if (!staffSnap.exists || String(staffSnap.get("name")) !== STAFF_NAME) throw new Error("The dentist's staff record is not what this script expects. Stopping.");
if ((await clinic.collection("staff").doc(OLD_ID).get()).exists) throw new Error("The old id has a staff record after all. Stopping.");

const [currentSnap, oldSnap, paymentsSnap, notesSnap, settleSnap] = await Promise.all([
  clinic.collection("ledger").where("doctorId", "==", STAFF).get(),
  clinic.collection("ledger").where("doctorId", "==", OLD_ID).get(),
  clinic.collection("ledger").where("type", "==", "payment").get(),
  clinic.collection("clinical_notes").where("doctorId", "==", OLD_ID).get(),
  clinic.collection(SETTLEMENTS_COLLECTION).where("staffId", "==", STAFF).get(),
]);
const toDoc = (coll: string) => (d: FirebaseFirestore.QueryDocumentSnapshot): Doc => ({ path: `${coll}/${d.id}`, id: d.id, data: d.data() as Json });
const current = currentSnap.docs.map(toDoc("ledger"));
const old = oldSnap.docs.map(toDoc("ledger"));
const notes = notesSnap.docs.map(toDoc("clinical_notes"));
const hisTreatments = new Set([...current, ...old].filter((d) => d.data.type === "procedure").map((d) => d.id));
const noDentist = paymentsSnap.docs
  .map(toDoc("ledger"))
  .filter((d) => !d.data.doctorId && !d.data.doctorName && !d.data.doctor && typeof d.data.procedureId === "string" && hisTreatments.has(d.data.procedureId));

// Anything else that names him but is on neither id: listed for a person to look at, never touched.
const nameOnly = paymentsSnap.docs
  .map(toDoc("ledger"))
  .filter((d) => d.data.doctorId !== STAFF && d.data.doctorId !== OLD_ID && /ehab|إيهاب|ايهاب/i.test(`${d.data.doctorName ?? ""} ${d.data.doctor ?? ""}`));

// The old id anywhere else in the clinic's dentist-linked records.
const OTHER_COLLECTIONS = ["appointments", "prescriptions", "lab_cases", "ortho_cases", "xray_reports", "patient_media", "attendance", "call_reminders", "tasks", "inventory_transactions", "stock_events", "staff_settlements"];
const elsewhere: string[] = [];
for (const name of OTHER_COLLECTIONS) {
  const snap = await clinic.collection(name).get();
  const hits = snap.docs.filter((d) => JSON.stringify(d.data()).includes(OLD_ID)).length;
  if (hits > 0) elsewhere.push(`${name}: ${hits}`);
}

const pay = (docs: Doc[]) => docs.filter((d) => d.data.type === "payment").map((d) => d.data);
const lumps = settleSnap.docs.filter((d) => LUMP_SETTLEMENTS.includes(d.id)).map(toDoc(SETTLEMENTS_COLLECTION));
const lumpLedger = await readDocs("ledger", lumps.map((l) => String(l.data.ledgerId || "")).filter(Boolean));
const otherSettlements = settleSnap.docs.filter((d) => !LUMP_SETTLEMENTS.includes(d.id));

console.log("What was found");
console.log(`  payments on his current profile      ${String(pay(current).length).padStart(4)}   share ${fmt(sum(pay(current), share))}`);
console.log(`  payments on the old copy             ${String(pay(old).length).padStart(4)}   share ${fmt(sum(pay(old), share))}`);
console.log(`  payments with no dentist, his work   ${String(noDentist.length).padStart(4)}   share ${fmt(sum(noDentist.map((d) => d.data), share))}`);
console.log(`  all ledger rows on the old copy      ${String(old.length).padStart(4)}`);
console.log(`  clinical notes on the old copy       ${String(notes.length).padStart(4)}`);
console.log(`  lump payouts to remove               ${String(lumps.length).padStart(4)}   total ${fmt(sum(lumps.map((l) => l.data), (r) => Number(r.amount) || 0))}   (Salary rows found: ${lumpLedger.length})`);
console.log(`  other payouts/deductions of his      ${String(otherSettlements.length).padStart(4)}   ${otherSettlements.map((d) => `${d.id}${d.get("auto") === "daily" ? " (auto)" : ""}`).join(", ") || "none"}`);
console.log(`  payments naming him on neither id    ${String(nameOnly.length).padStart(4)}   ${nameOnly.map((d) => d.id).join(", ")}`);
console.log(`  old id in other collections          ${elsewhere.join(", ") || "none"}`);

const problems: string[] = [];
if (lumps.length !== 3 || lumpLedger.length !== 3) problems.push("the three lump payouts (and their Salary rows) are not all there");
if (nameOnly.length > 0) problems.push("some payments name him without either id — look at them first");
if (elsewhere.length > 0) problems.push("the old id appears in other collections — look at them first");
if (otherSettlements.some((d) => d.get("auto") !== "daily")) problems.push("he has other manual payouts or deductions — decide on them first");
if (dailyPayStart(staffSnap.data()) && !APPLY) console.log("\n  note: the switch is already on for him");

// =================================================================================================
// THE PLAN
// =================================================================================================
const allHisPayments = [...pay(current), ...pay(old), ...noDentist.map((d) => d.data)].filter((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r.date || "")));
const FROM = allHisPayments.map((r) => String(r.date).slice(0, 10)).sort()[0];
const afterRows = [
  ...current.map((d) => ({ id: d.id, ...d.data })),
  ...old.map((d) => ({ id: d.id, ...d.data, doctorId: STAFF, doctorName: STAFF_NAME })),
  ...noDentist.map((d) => ({ id: d.id, ...d.data, doctorId: STAFF, doctorName: STAFF_NAME })),
];
const shares = [...dailyShares(afterRows, { id: STAFF, name: STAFF_NAME }).values()];
const byMonth = new Map<string, number>();
for (const s of shares) byMonth.set(s.date.slice(0, 7), money((byMonth.get(s.date.slice(0, 7)) || 0) + s.amount));
const lumpByMonth = new Map<string, number>();
for (const l of lumps) lumpByMonth.set(String(l.data.date).slice(0, 7), money((lumpByMonth.get(String(l.data.date).slice(0, 7)) || 0) + Number(l.data.amount)));

console.log(`\nThe plan`);
console.log(`  re-point ${old.length} old-copy ledger rows and ${notes.length} clinical notes to ${STAFF}`);
console.log(`  give ${noDentist.length} no-dentist payments his id and name`);
console.log(`  remove ${lumps.length} lump payouts and their ${lumpLedger.length} Salary rows`);
console.log(`  switch "Paid daily" on from ${FROM}`);
console.log(`  the app then writes ${shares.length} day's-share lines, total ${fmt(shares.reduce((a, s) => a + s.amount, 0))}`);
console.log(`\n  month      paid to him now   after the fix   clinic profit`);
for (const m of [...new Set([...byMonth.keys(), ...lumpByMonth.keys()])].sort()) {
  const now = lumpByMonth.get(m) || 0;
  const after = byMonth.get(m) || 0;
  console.log(`  ${m}    ${fmt(now).padStart(12)}    ${fmt(after).padStart(12)}    ${(now - after >= 0 ? "+" : "") + fmt(now - after)}`);
}

// Everything the fix will write, in full, as it stands now.
const touched: Doc[] = [
  { path: `staff/${STAFF}`, id: STAFF, data: staffSnap.data() as Json },
  ...old,
  ...noDentist,
  ...notes,
  ...lumps,
  ...lumpLedger,
];
const fingerprint = crypto.createHash("sha256").update(stable(touched.map((d) => [d.path, d.data]))).digest("hex").slice(0, 16);

if (problems.length > 0) {
  console.log(`\nSTOPPED — ${problems.join("; ")}.`);
  process.exit(2);
}

if (!APPLY) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `paid-daily-ehab-${new Date().toISOString().replace(/[:.]/g, "-")}-${fingerprint}.json`);
  fs.writeFileSync(file, JSON.stringify({ clinicId: CLINIC, staffId: STAFF, fingerprint, takenAt: new Date().toISOString(), docs: touched }, null, 1));
  console.log(`\nBackup of all ${touched.length} records it would touch: ${file}`);
  console.log(`Dry run: nothing was written. To apply:  npx tsx scripts/fix-paid-daily-ehab.mts --apply --backup="${file}"`);
  process.exit(0);
}

// =================================================================================================
// APPLY
// =================================================================================================
if (!BACKUP_IN) throw new Error("--apply needs --backup=<the file the dry run wrote>.");
const backup = JSON.parse(fs.readFileSync(BACKUP_IN, "utf8")) as { fingerprint: string; clinicId: string; staffId: string };
if (backup.clinicId !== CLINIC || backup.staffId !== STAFF) throw new Error("That backup is for another clinic or dentist.");
if (backup.fingerprint !== fingerprint) {
  console.log(`\nSTOPPED — something changed since the dry run (fingerprint ${backup.fingerprint} → ${fingerprint}). Run the dry run again.`);
  process.exit(3);
}

console.log(`\nApplying (fingerprint ${fingerprint})…`);
const audit = (documentId: string, action: "update" | "delete", before: Json, after: Json | null) =>
  writeLedgerAudit({ clinicId: CLINIC, action, collection: "ledger", documentId, before, after, actor: AUDIT_ACTOR, via: "script:paid-daily-ehab" });

let batch = db.batch();
let pending = 0;
const flush = async () => {
  if (pending > 0) await batch.commit();
  batch = db.batch();
  pending = 0;
};
const queue = async (fn: () => void) => {
  fn();
  pending += 1;
  if (pending >= 400) await flush();
};

for (const d of [...old, ...noDentist]) {
  const patch = { doctorId: STAFF, doctorName: STAFF_NAME };
  await queue(() => batch.update(clinic.collection("ledger").doc(d.id), patch));
}
for (const d of notes) await queue(() => batch.update(clinic.collection("clinical_notes").doc(d.id), { doctorId: STAFF }));
for (const l of lumps) await queue(() => batch.delete(clinic.collection(SETTLEMENTS_COLLECTION).doc(l.id)));
for (const r of lumpLedger) await queue(() => batch.delete(clinic.collection("ledger").doc(r.id)));
await queue(() => batch.update(clinic.collection("staff").doc(STAFF), { paidDaily: true, paidDailyFrom: FROM, paidDailyUpdatedBy: AUDIT_ACTOR.name }));
await flush();

await Promise.all([
  ...[...old, ...noDentist].map((d) => audit(d.id, "update", d.data, { ...d.data, doctorId: STAFF, doctorName: STAFF_NAME })),
  ...lumpLedger.map((r) => audit(r.id, "delete", r.data, null)),
]);
console.log(`  re-pointed ${old.length + noDentist.length} ledger rows and ${notes.length} notes; removed ${lumps.length} lump payouts; switch on from ${FROM}`);

const result = await syncDailyPay(CLINIC, STAFF, "all");
console.log(`  day's-share lines written: ${result.upserted} (removed ${result.deleted})`);

// --- check --------------------------------------------------------------------------------------
const [ledgerAfter, settleAfter] = await Promise.all([
  clinic.collection("ledger").where("doctorId", "==", STAFF).get(),
  clinic.collection(SETTLEMENTS_COLLECTION).where("staffId", "==", STAFF).get(),
]);
const settlements = settleAfter.docs.map((d) => parseSettlement(d.id, d.data())).filter((s): s is NonNullable<typeof s> => s !== null);
const daily = settlements.filter((s) => s.auto === "daily");
const rows = ledgerAfter.docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
const entries = commissionByStaff(rows, [{ id: STAFF, name: STAFF_NAME }]).get(STAFF)?.entries ?? [];
const settled = settleEarnings(entries.map((e) => ({ key: e.id, date: e.date, amount: e.amount })), settlements);
const dailyTotal = money(daily.reduce((a, s) => a + s.amount, 0));
const planned = money(shares.reduce((a, s) => a + s.amount, 0));
console.log(`\nCheck`);
console.log(`  day's-share lines: ${daily.length} (planned ${shares.length}), total ${fmt(dailyTotal)} (planned ${fmt(planned)})  ${daily.length === shares.length && dailyTotal === planned ? "OK" : "MISMATCH"}`);
console.log(`  still owed for patient work: ${fmt(settled.owed)}  ${settled.owed === 0 ? "OK" : "CHECK"}`);
console.log(`  old-copy ledger rows left: ${(await clinic.collection("ledger").where("doctorId", "==", OLD_ID).get()).size}`);
console.log(`  old-copy notes left: ${(await clinic.collection("clinical_notes").where("doctorId", "==", OLD_ID).get()).size}`);
console.log(`\nDone. To undo:  npx tsx scripts/fix-paid-daily-ehab.mts --restore="${BACKUP_IN}"`);
process.exit(0);
