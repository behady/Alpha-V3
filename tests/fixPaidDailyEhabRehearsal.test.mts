/**
 * Rehearsal of scripts/fix-paid-daily-ehab.mts against the Firestore EMULATOR — never the live database.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/fixPaidDailyEhabRehearsal.test.mts
 *
 * Seeds the same shape of records the live inventory found (current-profile payments, old-copy rows
 * and notes, payments with no dentist, three lump payouts, another dentist, another clinic), runs the
 * script's dry run, apply and restore, and checks each step — including that restore puts every
 * record back exactly and that nothing outside the dentist's records moved.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set, and this test writes. It must never reach the live database.");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLINIC = "SmtW6r6jKaFhfRWYcxsG";
const STAFF = "XLBIC0YPS9ogSe7K4UR3";
const OLD = "dsQWVT4RmwvaC5Y9NZcF";
const LUMPS = ["JJMTUnkDWt30uuX63EPX", "dwR6mDChg8dALLBnlE5w", "tC572khoOl8rLcUUHnN5"];

// Throwaway credentials, set BEFORE the script reads .env.local: it only fills keys that are empty,
// so the live ones are never picked up here.
const { generateKeyPairSync } = await import("node:crypto");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.FIREBASE_PROJECT_ID = "demo-fix-rehearsal";
process.env.FIREBASE_CLIENT_EMAIL = "sa@demo-fix-rehearsal.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey;
const { adminDb } = await import("../src/lib/firebaseAdmin");
const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const other = db.collection("clinics").doc("OTHER");

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok || detail === "" ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (ok) passed += 1;
  else failed += 1;
}

async function snapshot(ref: FirebaseFirestore.DocumentReference, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const n of names) for (const d of (await ref.collection(n).get()).docs) out.set(`${n}/${d.id}`, JSON.stringify(d.data(), Object.keys(d.data()).sort()));
  return out;
}

// --- seed ----------------------------------------------------------------------------------------
await db.recursiveDelete(clinic);
await db.recursiveDelete(other);
await clinic.set({ name: "Alpha Dental Clinic (rehearsal)", status: "Active" });
await clinic.collection("staff").doc(STAFF).set({ name: "Mohamed Ehab", role: "Admin", isDentist: true, commissionPercentage: 50 });
await clinic.collection("staff").doc("yahia").set({ name: "Yahia Gamal", role: "Admin", isDentist: true, commissionPercentage: 40 });
const L = clinic.collection("ledger");
// current profile: two treatments, two payments on two days
await L.doc("T1").set({ type: "procedure", doctorId: STAFF, doctorName: "Mohamed Ehab", amount: 2000, cost: 2000, date: "2026-10-30" });
await L.doc("P1").set({ type: "payment", procedureId: "T1", doctorId: STAFF, doctorName: "Mohamed Ehab", paid: 1400, amount: 1400, doctorCommissionAmount: 700, date: "2026-10-30" });
await L.doc("P2").set({ type: "payment", procedureId: "T1", doctorId: STAFF, doctorName: "Mohamed Ehab", paid: 600, amount: 600, doctorCommissionAmount: 300, date: "2026-11-09" });
// old copy: a treatment and two payments, May and July
await L.doc("T2").set({ type: "procedure", doctorId: OLD, doctorName: "Mohamed Ehab", amount: 3600, cost: 3600, date: "2026-05-22" });
await L.doc("P3").set({ type: "payment", procedureId: "T2", doctorId: OLD, doctorName: "Mohamed Ehab", paid: 1800, amount: 1800, doctorCommissionAmount: 900, date: "2026-05-22" });
await L.doc("P4").set({ type: "payment", procedureId: "T2", doctorId: OLD, doctorName: "Mohamed Ehab", paid: 1800, amount: 1800, doctorCommissionAmount: 900, date: "2026-07-28" });
// a payment with no dentist, whose treatment is his (old copy)
await L.doc("P5").set({ type: "payment", procedureId: "T2", paid: 500, amount: 500, doctorCommissionAmount: 250, doctorCommissionPercentage: 50, date: "2026-07-28" });
// another dentist's payment, and a plain expense: never touched
await L.doc("T9").set({ type: "procedure", doctorId: "yahia", doctorName: "Yahia Gamal", amount: 500, cost: 500, date: "2026-10-30" });
await L.doc("P9").set({ type: "payment", procedureId: "T9", doctorId: "yahia", doctorName: "Yahia Gamal", paid: 500, amount: 500, doctorCommissionAmount: 200, date: "2026-10-30" });
await L.doc("E1").set({ type: "expense", category: "General", amount: 300, cost: 300, date: "2026-10-30", description: "Rent" });
// the three lump payouts and their Salary rows
const lump = [[LUMPS[0], "2026-10-31", 600], [LUMPS[1], "2026-11-09", 200], [LUMPS[2], "2026-11-28", 300]] as const;
for (const [id, date, amount] of lump) {
  await clinic.collection("staff_settlements").doc(id).set({ staffId: STAFF, staffName: "Mohamed Ehab", kind: "payout", amount, date, note: "", method: "Cash", ledgerId: `S-${id}` });
  await L.doc(`S-${id}`).set({ type: "expense", category: "Salary", amount, cost: amount, date, description: "Staff pay – Mohamed Ehab", settlementId: id, staffId: STAFF });
}
await clinic.collection("clinical_notes").doc("N1").set({ doctorId: OLD, doctor: "Mohamed Ehab", date: "2026-07-27", procedure: "Cleaning" });
await clinic.collection("clinical_notes").doc("N2").set({ doctorId: "yahia", doctor: "Yahia Gamal", date: "2026-07-27", procedure: "Filling" });
// another clinic, same ids: must not move
await other.set({ name: "Other", status: "Active" });
await other.collection("staff").doc(STAFF).set({ name: "Mohamed Ehab", commissionPercentage: 50 });
await other.collection("ledger").doc("P1").set({ type: "payment", doctorId: OLD, doctorName: "Mohamed Ehab", paid: 100, amount: 100, doctorCommissionAmount: 50, date: "2026-07-01" });

const COLLS = ["ledger", "staff", "staff_settlements", "clinical_notes"];
const before = await snapshot(clinic, COLLS);
const otherBefore = await snapshot(other, COLLS);

// The same way the script is run by hand (paths here hold no spaces, so the shell needs no quoting).
const run = (...extra: string[]) =>
  execFileSync("npx", ["tsx", "scripts/fix-paid-daily-ehab.mts", ...extra], { cwd: ROOT, env: process.env, encoding: "utf8", shell: true });

// --- dry run --------------------------------------------------------------------------------------
console.log("dry run");
const dry = run();
const backupFile = dry.match(/--backup="([^"]+)"/)?.[1] ?? "";
check("prints a plan and a backup file", Boolean(backupFile) && fs.existsSync(backupFile), dry.slice(-400));
check("finds 2 + 2 + 1 payments", /current profile\s+2\b/.test(dry) && /old copy\s+2\b/.test(dry) && /no dentist, his work\s+1\b/.test(dry), dry);
check("plans 4 day lines (22 May, 28 Jul, 30 Oct, 9 Nov)", /writes 4 day's-share lines, total 3,050/.test(dry), dry);
check("writes nothing", JSON.stringify([...(await snapshot(clinic, COLLS))]) === JSON.stringify([...before]));

// --- apply refuses a stale backup -----------------------------------------------------------------
await clinic.collection("clinical_notes").doc("N1").update({ procedure: "Cleaning (edited)" });
let refused = false;
try {
  run("--apply", `--backup=${backupFile}`);
} catch (e) {
  refused = String((e as { stdout?: string }).stdout || "").includes("something changed since the dry run");
}
check("apply refuses when a record changed after the dry run", refused);
check("…and wrote nothing", (await clinic.collection("staff").doc(STAFF).get()).get("paidDaily") !== true);
await clinic.collection("clinical_notes").doc("N1").update({ procedure: "Cleaning" });

// --- apply ------------------------------------------------------------------------------------------
console.log("apply");
const applied = run("--apply", `--backup=${backupFile}`);
check("the check line says OK", /day's-share lines: 4 \(planned 4\), total 3,050 \(planned 3,050\)\s+OK/.test(applied), applied);
check("nothing owed for patient work", /still owed for patient work: 0\s+OK/.test(applied), applied);
const staff = (await clinic.collection("staff").doc(STAFF).get()).data() || {};
check("switch on from his first payment", staff.paidDaily === true && staff.paidDailyFrom === "2026-05-22", staff);
check("old-copy rows re-pointed", (await L.doc("P3").get()).get("doctorId") === STAFF && (await L.doc("T2").get()).get("doctorId") === STAFF);
check("no-dentist payment given his id", (await L.doc("P5").get()).get("doctorId") === STAFF);
check("old-copy note re-pointed", (await clinic.collection("clinical_notes").doc("N1").get()).get("doctorId") === STAFF);
check("lump payouts gone", (await Promise.all(LUMPS.map((id) => clinic.collection("staff_settlements").doc(id).get()))).every((s) => !s.exists));
check("their Salary rows gone", (await Promise.all(LUMPS.map((id) => L.doc(`S-${id}`).get()))).every((s) => !s.exists));
const julyLine = (await clinic.collection("staff_settlements").doc(`daily_${STAFF}_2026-07-28_all`).get()).data();
check("28 Jul line = 900 + 250", julyLine?.amount === 1150, julyLine);
check("Yahia untouched", (await L.doc("P9").get()).get("doctorId") === "yahia" && (await clinic.collection("clinical_notes").doc("N2").get()).get("doctorId") === "yahia");
check("Yahia has no payouts", (await clinic.collection("staff_settlements").where("staffId", "==", "yahia").get()).empty);
check("the rent expense untouched", (await snapshot(clinic, ["ledger"])).get("ledger/E1") === before.get("ledger/E1"));
check("the other clinic untouched", JSON.stringify([...(await snapshot(other, COLLS))]) === JSON.stringify([...otherBefore]));

// --- restore -----------------------------------------------------------------------------------------
console.log("restore");
run(`--restore=${backupFile}`);
const after = await snapshot(clinic, COLLS);
const stampFree = (m: Map<string, string>) =>
  new Map([...m].map(([k, v]) => {
    const o = JSON.parse(v);
    delete o.doctorCommissionPaid;
    delete o.doctorCommissionDeducted;
    return [k, JSON.stringify(o, Object.keys(o).sort())];
  }));
const a = stampFree(after);
const b = stampFree(before);
const diff = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
check("every record is back exactly as before (paid stamps aside)", diff.length === 0, diff);
check("the other clinic still untouched", JSON.stringify([...(await snapshot(other, COLLS))]) === JSON.stringify([...otherBefore]));

fs.rmSync(backupFile, { force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
