/**
 * Activity log v2: insurance approvals, staff settlements, appointment deletes and the recycle bin
 * write structured events. Runs the real route handlers against the Firestore emulator and reads
 * `system_logs` back.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:activity-insurance-routes
 *
 * Same harness as branchMoneyRoutes.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { SAMPLE_RAW } from "./fixtures/insuranceMetlife.fixture";

const PROJECT = "demo-activity-insurance";
const CLINIC = "C1";
const OWNER = "owner-1";
const PATIENT = "EXAMPLE PATIENT NAME";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const authServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (!req.url?.includes("accounts:lookup")) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    const ids = (JSON.parse(body || "{}").localId as string[] | undefined) ?? [];
    res.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: false, validSince: "0" })) }));
  });
});
await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
const authPort = (authServer.address() as { port: number }).port;

process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;

function idToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { liveEntryId } = await import("../src/lib/server/recycleBinStore");
const claimsRoute = await import("../src/app/api/insurance/claims/route");
const settlementsRoute = await import("../src/app/api/staff/settlements/route");
const apptDeleteRoute = await import("../src/app/api/appointments/delete/route");
const deleteRoute = await import("../src/app/api/records/delete/route");
const restoreRoute = await import("../src/app/api/records/restore/route");
const purgeRoute = await import("../src/app/api/records/purge/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);
const bin = db.collection("deleted_records");

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

type Json = Record<string, any>;
type Handler = (r: Request) => Promise<Response>;
async function call(handler: Handler, body: Json, method = "POST") {
  const res = await handler(
    new Request("http://localhost/api/test", {
      method,
      headers: { authorization: `Bearer ${idToken(OWNER)}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const patchClaim = (claimId: string, patch: Json) => call(claimsRoute.PATCH, { claimId, patch, branchId: "hel" }, "PATCH");
const settle = (body: Json) => call(settlementsRoute.POST, body);

/** Every v2 line for one event, newest first. */
async function logsFor(event: string): Promise<Json[]> {
  const snap = await col("system_logs").where("event", "==", event).orderBy("timestamp", "desc").get();
  return snap.docs.map((d) => d.data());
}
/** A Firestore auto id: twenty letters and digits in a row. */
const RAW_ID = /[A-Za-z0-9]{20}/;

async function wipe() {
  for (const d of (await bin.where("clinicId", "==", CLINIC).get()).docs) await db.recursiveDelete(d.ref);
  await db.recursiveDelete(clinic);
  await db.recursiveDelete(db.collection("users").doc(OWNER));
}

await wipe();
await clinic.set({ name: "Activity Insurance", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("users").doc(OWNER).set({ name: "Owner Tester", clinicRoles: { [CLINIC]: "Owner" } });
await col("settings").doc("locations").set({ branches: [{ id: "hel", name: "Heliopolis", rooms: [], receiptPrefix: "HEL" }] });
await col("settings").doc("payers").set({ payers: [{ id: "metlife", name: "MetLife", format: "metlife", providerCode: "DNC0001", active: true }] });
await col("staff").doc("D1").set({ name: "Dr One", role: "Dentist", commissionPercentage: 40 });
await col("staff").doc("S1").set({ name: "Nurse Sara", role: "Assistant" });
await col("patients").doc("P1").set({ name: PATIENT, phone: "+201000000001" });

const CLAIM = "metlife_d6000001";

console.log("\n1. an approval saved as approved");
{
  const saved = await call(claimsRoute.POST, { docId: "doc-1", payerId: "metlife", extraction: SAMPLE_RAW, patient: { id: "P1" }, status: "approved", branchId: "hel" });
  check("the save is accepted", saved.status === 201 && saved.json.claimId === CLAIM, saved);
  const logs = await logsFor("insurance.created");
  check("exactly one insurance.created", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("refs name the payer and the approval", log.refs?.payerName === "MetLife" && log.refs?.approvalNumber === "D6000001" && log.refs?.claimId === CLAIM, log.refs);
  check("refs carry the status and line count", log.refs?.status === "approved" && typeof log.refs?.count === "number" && log.refs.count > 0, log.refs);
  check("it names the patient and the branch", log.patientName === PATIENT && log.patientId === "P1" && log.branchId === "hel", log);
  check("amount is the approval's total", typeof log.amount === "number" && log.amount > 0, log.amount);
  check("categories are insurance, not flagged", JSON.stringify(log.categories) === JSON.stringify(["insurance"]) && log.flag === false, { c: log.categories, f: log.flag });
  check("an approved save writes no treatment rows, so no procedure.added", (await logsFor("procedure.added")).length === 0);
}

console.log("\n2. marked treated");
{
  const r = await patchClaim(CLAIM, { status: "treated" });
  check("the status change is accepted", r.status === 200 && r.json.ok === true, r);
  const logs = await logsFor("insurance.status");
  check("exactly one insurance.status", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("it is not flagged", log.flag === false, log.flag);
  check("the change is approved → treated", JSON.stringify(log.changes) === JSON.stringify([{ field: "status", from: "approved", to: "treated" }]), log.changes);
  check("refs name the payer and approval", log.refs?.payerName === "MetLife" && log.refs?.approvalNumber === "D6000001", log.refs);
  check("it names the patient", log.patientName === PATIENT, log.patientName);
  const added = await logsFor("procedure.added");
  check("one procedure.added per treatment row", added.length > 0 && added.length === (await col("ledger").where("claimId", "==", CLAIM).get()).size, added.length);
  check("each carries the claim and payer", added.every((l) => l.refs?.claimId === CLAIM && l.refs?.payerName === "MetLife"), added.map((l) => l.refs));
  check("each is filed under insurance and money, never flagged", added.every((l) => l.categories?.includes("insurance") && l.categories?.includes("money") && l.flag === false), added.map((l) => [l.categories, l.flag]));
  check("no category says discount", added.every((l) => !l.categories?.includes("discount")), added.map((l) => l.categories));
  check("no legacy 'Procedure Logged' line", (await col("system_logs").where("action", "==", "Procedure Logged").get()).size === 0);
  check("no insurance.edited for a plain status change", (await logsFor("insurance.edited")).length === 0);
}

console.log("\n2b. a dentist picked on a line");
{
  const r = await patchClaim(CLAIM, { dentists: { 0: "D1" } });
  check("the pick is accepted", r.status === 200 && r.json.ok === true, r);
  const logs = await logsFor("insurance.edited");
  check("exactly one insurance.edited", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("its change is the dentists label alone", JSON.stringify(log.changes) === JSON.stringify([{ field: "dentists", from: null, to: null }]), log.changes);
  check("the sentence names the field in words", typeof log.details === "string" && log.details.includes("Dentists"), log.details);
  check("no insurance.status for it", (await logsFor("insurance.status")).length === 1);
}

console.log("\n3. cancelled");
{
  const rows = (await col("ledger").where("claimId", "==", CLAIM).get()).size;
  const r = await patchClaim(CLAIM, { status: "cancelled" });
  check("the cancel is accepted", r.status === 200 && r.json.ok === true, r);
  const logs = await logsFor("insurance.status");
  check("a second insurance.status", logs.length === 2, logs.length);
  const log = logs[0] ?? {};
  check("it is flagged", log.flag === true, log.flag);
  check("changes[0] is treated → cancelled", log.changes?.[0]?.field === "status" && log.changes?.[0]?.from === "treated" && log.changes?.[0]?.to === "cancelled", log.changes);
  const deleted = await logsFor("procedure.deleted");
  check("one procedure.deleted per removed row", deleted.length === rows, { deleted: deleted.length, rows });
  check("each says why and names the claim", deleted.every((l) => l.reason === "not treated" && l.refs?.claimId === CLAIM && l.refs?.payerName === "MetLife"), deleted.map((l) => [l.reason, l.refs]));
}

console.log("\n4. a staff deduction, then its amount corrected");
{
  const made = await settle({ action: "create", staffId: "S1", kind: "deduction", amount: 100, date: "2026-10-13", note: "late", branchId: "hel" });
  check("the deduction is accepted", made.status === 200 && made.json.ok === true, made);
  const added = await logsFor("staff.deduction.added");
  check("exactly one staff.deduction.added", added.length === 1, added.length);
  check("it names the staff member, amount and reason", added[0]?.refs?.staffName === "Nurse Sara" && added[0]?.amount === 100 && added[0]?.reason === "late" && added[0]?.branchId === "hel", added[0]);
  const edited = await settle({ action: "update", id: made.json.id, amount: 150 });
  check("the correction is accepted", edited.status === 200 && edited.json.ok === true, edited);
  const logs = await logsFor("staff.deduction.edited");
  check("exactly one staff.deduction.edited", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("its change is amount 100 → 150", JSON.stringify(log.changes) === JSON.stringify([{ field: "amount", from: 100, to: 150 }]), log.changes);
  check("it is flagged", log.flag === true, log.flag);
  check("it names the staff member", log.refs?.staffName === "Nurse Sara" && log.branchId === "hel", log);
  const before = (await col("system_logs").get()).size;
  const same = await settle({ action: "update", id: made.json.id, amount: 150 });
  check("an unchanged re-save is accepted", same.status === 200, same);
  check("and writes no activity line", (await col("system_logs").get()).size === before);
  const gone = await settle({ action: "delete", id: made.json.id });
  check("the delete is accepted", gone.status === 200, gone);
  const removed = await logsFor("staff.deduction.removed");
  check("one staff.deduction.removed with its amount", removed.length === 1 && removed[0]?.amount === 150 && removed[0]?.flag === true, removed[0]);
}

console.log("\n4b. a staff payout, edited and deleted");
{
  const made = await settle({ action: "create", staffId: "S1", kind: "payout", amount: 300, date: "2026-10-13", branchId: "hel" });
  check("the payout is accepted", made.status === 200 && made.json.ok === true, made);
  const paid = await logsFor("staff.paid");
  check("one staff.paid", paid.length === 1 && paid[0]?.amount === 300 && paid[0]?.refs?.staffName === "Nurse Sara" && paid[0]?.branchId === "hel", paid[0]);
  check("the ledger audit was still written", (await col("ledger_audit").where("documentId", "==", made.json.ledgerId).get()).size === 1);
  const edited = await settle({ action: "update", id: made.json.id, method: "Card" });
  check("the method change is accepted", edited.status === 200, edited);
  const logs = await logsFor("staff.payout.edited");
  check("one staff.payout.edited: method Cash → Card", logs.length === 1 && JSON.stringify(logs[0]?.changes) === JSON.stringify([{ field: "method", from: "Cash", to: "Card" }]), logs[0]?.changes);
  const gone = await settle({ action: "delete", id: made.json.id });
  check("the delete is accepted", gone.status === 200, gone);
  const deleted = await logsFor("staff.payout.deleted");
  check("one staff.payout.deleted", deleted.length === 1 && deleted[0]?.amount === 300 && deleted[0]?.flag === true, deleted[0]);
}

console.log("\n5. an appointment deleted");
{
  await col("appointments").doc("A1").set({ patientId: "P1", patientName: PATIENT, date: "2026-10-20", time: "18:00", doctor: "Dr One", branchId: "hel" });
  const r = await call(apptDeleteRoute.POST, { appointmentId: "A1", servicesAction: "keep" });
  check("the delete is accepted", r.status === 200 && r.json.ok === true, r);
  const logs = await logsFor("appointment.deleted");
  check("exactly one appointment.deleted", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("refs carry the date, time and doctor", log.refs?.date === "2026-10-20" && log.refs?.time === "18:00" && log.refs?.doctor === "Dr One" && log.refs?.count === 0, log.refs);
  check("module is appointments", log.module === "appointments", log.module);
  check("it names the patient, branch and reason", log.patientName === PATIENT && log.branchId === "hel" && log.reason === "kept treatments", log);
  check("it is flagged", log.flag === true, log.flag);
  check("keeping the treatments carries no money", log.amount === undefined, log.amount);
}

console.log("\n5b. an appointment deleted with its treatments and their charges");
{
  await col("appointments").doc("A2").set({ patientId: "P1", patientName: PATIENT, date: "2026-10-21", time: "19:00", doctor: "Dr One", branchId: "hel" });
  await col("clinical_notes").doc("AN1").set({ patientId: "P1", appointmentId: "A2", procedure: "Crown", cost: 1200, ledgerId: "AL1" });
  await col("clinical_notes").doc("AN2").set({ patientId: "P1", appointmentId: "A2", procedure: "Filling", cost: 300, ledgerId: "AL2" });
  await col("ledger").doc("AL1").set({ patientId: "P1", type: "procedure", appointmentId: "A2", clinicalNoteId: "AN1", amount: 1200, cost: 1200 });
  await col("ledger").doc("AL2").set({ patientId: "P1", type: "procedure", appointmentId: "A2", clinicalNoteId: "AN2", amount: 300, cost: 300 });
  const r = await call(apptDeleteRoute.POST, { appointmentId: "A2", servicesAction: "delete" });
  check("the delete is accepted", r.status === 200 && r.json.ok === true && r.json.deletedLedgerRows === 2, r);
  const log = (await logsFor("appointment.deleted"))[0] ?? {};
  check("amount is the deleted charges' total (1,500)", log.amount === 1500, log.amount);
  check("count is the treatments, reason the code", log.refs?.count === 2 && log.reason === "with treatments", { refs: log.refs, reason: log.reason });
  check("the sentence says the money went", log.details === "Appointment deleted: EXAMPLE PATIENT NAME 2026-10-21 19:00 · with 2 treatments and 1,500 EGP removed", log.details);
}

console.log("\n6. a patient to the bin, back, and purged");
{
  await col("patients").doc("P9").set({ name: "Bin Patient" });
  const del = await call(deleteRoute.POST, { items: [{ collection: "patients", documentId: "P9" }] });
  check("the delete is accepted", del.status === 200 && del.json.deleted === 1, del);
  const pd = await logsFor("patient.deleted");
  check("one patient.deleted naming the patient", pd.length === 1 && pd[0]?.patientName === "Bin Patient" && pd[0]?.patientId === "P9", pd[0]);
  const rd = await logsFor("record.deleted");
  check("one aggregate record.deleted with the count", rd.length === 1 && rd[0]?.refs?.count === 1, rd[0]);
  const entryId = liveEntryId(CLINIC, "patients", "P9");
  const back = await call(restoreRoute.POST, { entryId });
  check("the restore is accepted", back.status === 200 && back.json.ok === true, back);
  const pr = await logsFor("patient.restored");
  check("one patient.restored naming the patient", pr.length === 1 && pr[0]?.patientName === "Bin Patient", pr[0]);

  await col("prescriptions").doc("RX1").set({ patientId: "P1", drugName: "Amoxicillin" });
  const rx = await call(deleteRoute.POST, { items: [{ collection: "prescriptions", documentId: "RX1" }] });
  check("a prescription to the bin", rx.status === 200 && rx.json.deleted === 1, rx);
  check("no patient.deleted for it", (await logsFor("patient.deleted")).length === 1);
  check("the record.deleted line names it", (await logsFor("record.deleted"))[0]?.refs?.procedure === "Amoxicillin", (await logsFor("record.deleted"))[0]?.refs);
  const rxEntry = liveEntryId(CLINIC, "prescriptions", "RX1");
  const rxBack = await call(restoreRoute.POST, { entryId: rxEntry });
  check("the prescription restored", rxBack.status === 200, rxBack);
  const rr = await logsFor("record.restored");
  check("one record.restored", rr.length === 1 && rr[0]?.refs?.procedure === "Amoxicillin", rr[0]);

  const again = await call(deleteRoute.POST, { items: [{ collection: "patients", documentId: "P9" }] });
  check("deleted again", again.status === 200 && again.json.deleted === 1, again);
  const purged = await call(purgeRoute.POST, { entryId });
  check("the purge is accepted", purged.status === 200 && purged.json.ok === true, purged);
  const rp = await logsFor("record.purged");
  check("one record.purged naming the patient, flagged", rp.length === 1 && rp[0]?.patientName === "Bin Patient" && rp[0]?.flag === true, rp[0]);
  check("it reads as the patient's whole file", rp[0]?.details === "Permanently deleted patient file Bin Patient" && rp[0]?.refs?.procedure === undefined, rp[0]?.details);
}

console.log("\n7. the approval, treated again, deleted from the bin with its charges");
{
  const r = await patchClaim(CLAIM, { status: "treated" });
  check("treated again", r.status === 200 && r.json.ok === true, r);
  const rows = (await col("ledger").where("claimId", "==", CLAIM).get()).docs.map((d) => d.data());
  check("it has treatment rows to take with it", rows.length > 0, rows.length);
  const charged = Math.round(rows.reduce((s, row) => s + (Number(row.cost) || Number(row.amount) || 0), 0) * 100) / 100;
  const del = await call(deleteRoute.POST, { items: [{ collection: "insurance_claims", documentId: CLAIM }] });
  check("the delete is accepted", del.status === 200 && del.json.deleted === 1, del);
  const log = (await logsFor("record.deleted"))[0] ?? {};
  // The approval stores its payer's id, not its name, so no payerName rides along (never the raw id).
  check("it names the claim", log.refs?.claimId === CLAIM && log.refs?.payerName === undefined, log.refs);
  check("it names the patient and the branch", log.patientId === "P1" && log.patientName === PATIENT && log.branchId === "hel", { p: log.patientId, n: log.patientName, b: log.branchId });
  check("filed under insurance and money (its charges went too)", log.categories?.includes("insurance") && log.categories?.includes("money"), log.categories);
  check("amount is the charges that went with it", log.amount === charged && charged > 0, { amount: log.amount, charged });
  check("still flagged", log.flag === true, log.flag);
}

console.log("\nno line anywhere carries a raw id in its details, and every line is v2");
{
  const all = (await col("system_logs").get()).docs.map((d) => d.data());
  check("every line is a v2 event", all.every((l) => l.v === 2 && typeof l.event === "string"), all.filter((l) => l.v !== 2).map((l) => l.action));
  check("no details carry a raw id", all.every((l) => !RAW_ID.test(String(l.details || ""))), all.map((l) => l.details));
}

await wipe();
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
