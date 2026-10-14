/**
 * Activity log v2: the money routes write structured events. Runs the real procedures and ledger
 * handlers against the Firestore emulator and reads `system_logs` back, so a discount, a payment, an
 * edit and a delete each leave exactly one line with the right event, amount, people and flags.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:activity-money-routes
 *
 * Same harness as branchMoneyRoutes.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-activity-money";
const CLINIC = "C1";
const OWNER = "owner-1";
const PATIENT = "عمر حسام علي";

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
const ledgerRoute = await import("../src/app/api/finance/ledger/route");
const proceduresRoute = await import("../src/app/api/clinical/procedures/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);

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
async function post(route: { POST: (r: Request) => Promise<Response> }, body: Json) {
  const res = await route.POST(
    new Request("http://localhost/api/test", {
      method: "POST",
      headers: { authorization: `Bearer ${idToken(OWNER)}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const ledgerPost = (body: Json) => post(ledgerRoute, body);
const procPost = (body: Json) => post(proceduresRoute, body);

/** Every v2 line for one event, newest first. */
async function logsFor(event: string): Promise<Json[]> {
  const snap = await col("system_logs").where("event", "==", event).orderBy("timestamp", "desc").get();
  return snap.docs.map((d) => d.data());
}
/** A Firestore auto id: twenty letters and digits in a row. */
const RAW_ID = /[A-Za-z0-9]{20}/;

async function wipe() {
  await db.recursiveDelete(clinic);
  await db.recursiveDelete(db.collection("users").doc(OWNER));
}

await wipe();
await clinic.set({ name: "Activity Money", status: "Active", subscriptionTier: "Premium" });
await db.collection("users").doc(OWNER).set({ name: "Owner Tester", clinicRoles: { [CLINIC]: "Owner" } });
await col("settings").doc("locations").set({ branches: [{ id: "hel", name: "Heliopolis", rooms: [], receiptPrefix: "HEL" }] });
await col("settings").doc("discounts").set({ reasons: ["قريب", "x"] });
await col("staff").doc("D1").set({ name: "Dr One", role: "Dentist", commissionPercentage: 50 });
await col("staff").doc("D2").set({ name: "Dr Two", role: "Dentist", commissionPercentage: 40 });
await col("patients").doc("P1").set({ name: PATIENT });

console.log("\n1. a treatment charged under the list price");
const created = await procPost({
  action: "create",
  patientId: "P1",
  procedures: ["Crown"],
  selectedTeeth: [],
  tooth: "Gen",
  unitCost: 1500,
  pricingMode: "per_tooth",
  doctorId: "D1",
  status: "Completed",
  date: "2026-10-13",
  discountMode: "fixed",
  discountValue: 200,
  discountReason: "قريب",
  branchId: "hel",
});
check("the create is accepted", created.status === 200 && created.json.ok === true, created);
const chargeId = String(created.json.ledgerId);
const noteId = String(created.json.noteId);
{
  const logs = await logsFor("procedure.added");
  check("exactly one procedure.added", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("categories include discount", Array.isArray(log.categories) && log.categories.includes("discount"), log.categories);
  check("it is flagged (below the list price)", log.flag === true, log.flag);
  check("it names the patient", log.patientName === PATIENT, log.patientName);
  check("amount is the charged price", log.amount === 1300, log.amount);
  check("the discount and its reason are on it", log.changes?.some((c: Json) => c.field === "discount" && c.to === 200) && log.reason === "قريب", { changes: log.changes, reason: log.reason });
  check("it carries the branch", log.branchId === "hel", log.branchId);
  check("refs carry the procedure, doctor and ids", log.refs?.procedure === "Crown" && log.refs?.doctor === "Dr One" && log.refs?.noteId === noteId && log.refs?.ledgerId === chargeId, log.refs);
  check("a private treatment carries no payer", log.refs?.payerName === undefined, log.refs);
  check("no legacy 'Procedure Logged' line beside it", (await col("system_logs").where("action", "==", "Procedure Logged").get()).size === 0);
}

console.log("\n2. a payment against it");
const paid = await ledgerPost({ action: "create-payment", patientId: "P1", procedureId: chargeId, amount: 800, method: "Cash", date: "2026-10-13", branchId: "hel" });
check("the payment is accepted", paid.status === 200 && paid.json.ok === true, paid);
const paymentId = String(paid.json.id);
{
  const logs = await logsFor("payment.received");
  check("exactly one payment.received", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("it has the receipt number", typeof log.refs?.receiptNumber === "string" && log.refs.receiptNumber === paid.json.receiptNumber, log.refs);
  check("amount and method", log.amount === 800 && log.refs?.method === "Cash", { amount: log.amount, refs: log.refs });
  check("the description is not prefixed 'Payment for'", typeof log.refs?.procedure === "string" && !/^Payment for/i.test(log.refs.procedure), log.refs?.procedure);
  check("details carry no raw id", typeof log.details === "string" && !RAW_ID.test(log.details), log.details);
  check("it names the patient and branch", log.patientName === PATIENT && log.branchId === "hel", { p: log.patientName, b: log.branchId });
}

console.log("\n3. a bigger discount on the charge, as part of a visit-wide discount");
const grown = await ledgerPost({
  action: "update",
  id: chargeId,
  patch: { listPrice: 1500, discountMode: "fixed", discountFixed: 300, discountPercent: null, discountReason: "x" },
  groupId: "g1",
});
check("the update is accepted", grown.status === 200 && grown.json.ok === true, grown);
{
  const logs = await logsFor("discount.changed");
  check("exactly one discount.changed", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("amount is the difference (100)", log.amount === 100, log.amount);
  check("groupId is carried", log.groupId === "g1", log.groupId);
  check("price and discount changes", JSON.stringify(log.changes) === JSON.stringify([{ field: "price", from: 1300, to: 1200 }, { field: "discount", from: 200, to: 300 }]), log.changes);
  check("reason, patient and branch", log.reason === "x" && log.patientName === PATIENT && log.branchId === "hel", log);
  check("no generic procedure.edited for the same save", (await logsFor("procedure.edited")).length === 0);
}

console.log("\n4. the discount taken off");
const removed = await ledgerPost({
  action: "update",
  id: chargeId,
  patch: { listPrice: 1500, discountMode: "fixed", discountFixed: 0, discountPercent: null, discountReason: "x" },
  // Longer than 64 characters: ignored, never stored.
  groupId: "g".repeat(65),
});
check("the update is accepted", removed.status === 200 && removed.json.ok === true, removed);
{
  const logs = await logsFor("discount.removed");
  check("exactly one discount.removed", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("amount is what was taken off before (300)", log.amount === 300, log.amount);
  check("an over-long groupId is not stored", log.groupId === undefined, log.groupId);
}

console.log("\n5. the payment's method corrected");
const methodFix = await ledgerPost({ action: "update", id: paymentId, patch: { method: "Card" } });
check("the update is accepted", methodFix.status === 200 && methodFix.json.ok === true, methodFix);
{
  const logs = await logsFor("payment.edited");
  check("exactly one payment.edited", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("it is flagged", log.flag === true, log.flag);
  check("only the method changed", JSON.stringify(log.changes) === JSON.stringify([{ field: "method", from: "Cash", to: "Card" }]), log.changes);
}

console.log("\n6. the payment deleted");
const gone = await ledgerPost({ action: "delete", id: paymentId });
check("the delete is accepted", gone.status === 200 && gone.json.ok === true, gone);
{
  const logs = await logsFor("payment.deleted");
  check("exactly one payment.deleted", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("amount 800", log.amount === 800, log.amount);
  check("it names the patient and the receipt", log.patientName === PATIENT && log.refs?.receiptNumber === paid.json.receiptNumber, log);
}

console.log("\n7. the treatment re-priced from the clinical screen");
const edited = await procPost({
  action: "update",
  noteId,
  patientId: "P1",
  procedures: ["Crown"],
  selectedTeeth: [],
  tooth: "Gen",
  unitCost: 1500,
  pricingMode: "per_tooth",
  doctorId: "D1",
  status: "Completed",
  date: "2026-10-13",
  discountMode: "fixed",
  discountValue: 100,
  discountReason: "قريب",
});
check("the edit is accepted", edited.status === 200 && edited.json.ok === true, edited);
{
  const logs = await logsFor("procedure.edited");
  check("exactly one procedure.edited", logs.length === 1, logs.length);
  const log = logs[0] ?? {};
  check("price and discount changes, renamed", log.changes?.some((c: Json) => c.field === "price" && c.from === 1500 && c.to === 1400)
    && log.changes?.some((c: Json) => c.field === "discount" && c.from === 0 && c.to === 100), log.changes);
  check("refs.listPrice is set", log.refs?.listPrice === 1500, log.refs);
  check("below the list price: flagged", log.flag === true && log.categories?.includes("discount"), { flag: log.flag, c: log.categories });
  check("charge's branch", log.branchId === "hel", log.branchId);
}
{
  const before = (await col("system_logs").get()).size;
  const again = await procPost({
    action: "update", noteId, patientId: "P1", procedures: ["Crown"], selectedTeeth: [], tooth: "Gen", unitCost: 1500,
    pricingMode: "per_tooth", doctorId: "D1", status: "Completed", date: "2026-10-13", discountMode: "fixed", discountValue: 100, discountReason: "قريب",
  });
  check("an unchanged re-save is accepted", again.status === 200, again);
  check("and writes no activity line", (await col("system_logs").get()).size === before);
}

console.log("\n7b. only the dentist changed (both dentists' payouts move)");
{
  const dentist = await procPost({
    action: "update", noteId, patientId: "P1", procedures: ["Crown"], selectedTeeth: [], tooth: "Gen", unitCost: 1500,
    pricingMode: "per_tooth", doctorId: "D2", status: "Completed", date: "2026-10-13", discountMode: "fixed", discountValue: 100, discountReason: "قريب",
  });
  check("the dentist change is accepted", dentist.status === 200 && dentist.json.ok === true, dentist);
  const logs = await logsFor("procedure.edited");
  check("one more procedure.edited", logs.length === 2, logs.length);
  check("its only change is the doctor", JSON.stringify(logs[0]?.changes) === JSON.stringify([{ field: "doctor", from: "Dr One", to: "Dr Two" }]), logs[0]?.changes);
  check("the sentence names the field", typeof logs[0]?.details === "string" && logs[0].details.includes("Doctor Dr One → Dr Two"), logs[0]?.details);
}

console.log("\n7c. only the reason reworded on a standing discount");
{
  const discountLines = async () =>
    (await logsFor("discount.given")).length + (await logsFor("discount.changed")).length + (await logsFor("discount.removed")).length;
  const discountBefore = await discountLines();
  const reworded = await ledgerPost({ action: "update", id: chargeId, patch: { discountReason: "x" } });
  check("the reword is accepted", reworded.status === 200 && reworded.json.ok === true, reworded);
  const logs = await logsFor("procedure.edited");
  check("one more procedure.edited", logs.length === 3, logs.length);
  check("its only change is the reason", JSON.stringify(logs[0]?.changes) === JSON.stringify([{ field: "reason", from: "قريب", to: "x" }]), logs[0]?.changes);
  check("no discount.* event for it", (await discountLines()) === discountBefore);
}

console.log("\n8. an expense");
const exp = await ledgerPost({ action: "create-entry", type: "expense", amount: 250, description: "Gloves", date: "2026-10-13", branchId: "hel" });
check("the expense is accepted", exp.status === 200, exp);
{
  const logs = await logsFor("expense.added");
  const log = logs[0] ?? {};
  check("one expense.added with its description and amount", logs.length === 1 && log.refs?.procedure === "Gloves" && log.amount === 250 && log.branchId === "hel", log);
}

console.log("\n9. the treatment deleted");
const del = await procPost({ action: "delete", noteId });
check("the delete is accepted", del.status === 200 && del.json.ok === true, del);
{
  const logs = await logsFor("procedure.deleted");
  const log = logs[0] ?? {};
  check("one procedure.deleted", logs.length === 1, logs.length);
  check("amount, patient, branch and linked-row count", log.amount === 1400 && log.patientName === PATIENT && log.branchId === "hel" && log.refs?.count === 1, log);
}

console.log("\nno line anywhere carries undefined or a raw id in its details");
{
  const all = (await col("system_logs").get()).docs.map((d) => d.data());
  check("every line is a v2 event", all.every((l) => l.v === 2 && typeof l.event === "string"), all.map((l) => l.action));
  check("no details carry a raw id", all.every((l) => !RAW_ID.test(String(l.details || ""))), all.map((l) => l.details));
}

await wipe();
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
