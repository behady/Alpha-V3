/**
 * Which branch a piece of money belongs to, through the real money routes, against the Firestore
 * emulator: the ledger route (payments and manual entries), the staff settlements route and the
 * insurance claims route.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:branch-money-routes
 *
 * Same harness as notePhotosRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { SAMPLE_RAW } from "./fixtures/insuranceMetlife.fixture";

const PROJECT = "demo-branch-money";
const CLINIC = "C1";
const NO_BRANCH_CLINIC = "C2";
const FIRST_IS_FORBIDDEN_CLINIC = "C3";
const RECEIPTS_CLINIC = "C4";
const ADMIN = "admin-1";
const DESK = "desk-1";
const DESK_2 = "desk-2";
const DESK_3 = "desk-3";
const DESK_4 = "desk-4";

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
const { SETTLEMENTS_COLLECTION } = await import("../src/lib/staffSettlement");
const ledgerRoute = await import("../src/app/api/finance/ledger/route");
const settlementsRoute = await import("../src/app/api/staff/settlements/route");
const claimsRoute = await import("../src/app/api/insurance/claims/route");
const briefingRoute = await import("../src/app/api/ai/daily-briefing/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const plainClinic = db.collection("clinics").doc(NO_BRANCH_CLINIC);
const thirdClinic = db.collection("clinics").doc(FIRST_IS_FORBIDDEN_CLINIC);
const receiptsClinic = db.collection("clinics").doc(RECEIPTS_CLINIC);
const ledger = clinic.collection("ledger");

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
type Collection = FirebaseFirestore.CollectionReference;
async function post(route: { POST: (r: Request) => Promise<Response> }, uid: string, body: Json, method = "POST") {
  const handler = method === "PATCH" ? (route as unknown as { PATCH: (r: Request) => Promise<Response> }).PATCH : route.POST;
  const res = await handler(
    new Request("http://localhost/api/test", {
      method,
      headers: { authorization: `Bearer ${idToken(uid)}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const money = (uid: string, body: Json, clinicId = CLINIC) => post(ledgerRoute, uid, { clinicId, ...body });
const expense = (uid: string, extra: Json = {}, clinicId = CLINIC) =>
  money(uid, { action: "create-entry", type: "expense", amount: 100, description: "Rent", date: "2026-10-01", ...extra }, clinicId);
const payment = (uid: string, patientId: string, extra: Json = {}) =>
  money(uid, { action: "create-payment", patientId, amount: 50, date: "2026-10-01", ...extra });
const settle = (uid: string, extra: Json = {}) =>
  post(settlementsRoute, uid, { clinicId: CLINIC, action: "create", staffId: "S1", kind: "payout", amount: 300, date: "2026-10-01", ...extra });
const row = async (id: string, collection: Collection = ledger) => (await collection.doc(id).get()).data() as Json | undefined;

for (const c of [clinic, plainClinic, thirdClinic, receiptsClinic]) {
  await db.recursiveDelete(c);
  await c.set({ name: "Branch Test", status: "Active", subscriptionTier: "Premium" });
}
await db.collection("users").doc(ADMIN).set({ name: "Owner Tester", clinicRoles: { [CLINIC]: "Owner", [RECEIPTS_CLINIC]: "Owner" } });
await db.collection("users").doc(DESK).set({
  name: "Desk Hel",
  clinicRoles: { [CLINIC]: "Receptionist" },
  clinicPermissions: { [CLINIC]: ["finance.add", "finance.edit", "finance.delete", "access.appointments"] },
});
await db.collection("users").doc(DESK_2).set({
  name: "Desk Plain",
  clinicRoles: { [NO_BRANCH_CLINIC]: "Receptionist" },
  clinicPermissions: { [NO_BRANCH_CLINIC]: ["finance.add", "access.appointments"] },
});
await db.collection("users").doc(DESK_3).set({
  name: "Desk Third",
  clinicRoles: { [FIRST_IS_FORBIDDEN_CLINIC]: "Receptionist" },
  clinicPermissions: { [FIRST_IS_FORBIDDEN_CLINIC]: ["finance.add", "access.appointments"] },
});
await thirdClinic.collection("settings").doc("locations").set({
  branches: [
    { id: "tag", name: "Tagamoa", rooms: [] },
    { id: "hel", name: "Heliopolis", rooms: [] },
  ],
});
await thirdClinic.collection("staff").doc("desk-3-staff").set({ uid: DESK_3, name: "Desk Third", role: "Receptionist", branchIds: ["hel"] });
await clinic.collection("settings").doc("locations").set({
  branches: [
    { id: "hel", name: "Heliopolis", rooms: [], receiptPrefix: "HEL" },
    { id: "tag", name: "Tagamoa", rooms: [], receiptPrefix: "TAG" },
  ],
});
await receiptsClinic.collection("settings").doc("locations").set({
  branches: [
    { id: "hel", name: "Heliopolis", rooms: [], receiptPrefix: "HEL" },
    { id: "tag", name: "Tagamoa", rooms: [], receiptPrefix: "TAG" },
    // Two Arabic names derive the same prefix; the second gets a number so the series never clash.
    { id: "ar1", name: "التجمع", rooms: [] },
    { id: "ar2", name: "مدينة نصر", rooms: [] },
  ],
});
// No year in the number, so the sequence reads plainly: HEL-0001.
await receiptsClinic.collection("settings").doc("receipt").set({ numberIncludesYear: false });
await receiptsClinic.collection("patients").doc("RP").set({ name: "Receipt Patient" });
await plainClinic.collection("patients").doc("PP").set({ name: "Plain Patient" });
await clinic.collection("staff").doc("desk-1-staff").set({ uid: DESK, name: "Desk Hel", role: "Receptionist", branchIds: ["hel"] });
await clinic.collection("staff").doc("S1").set({ name: "Dr Sami", role: "Dentist", branchIds: [] });

console.log("a branch you may not use is refused");
{
  const r = await expense(DESK, { branchId: "tag" });
  check("desk-1 (Heliopolis only) posting an expense for Tagamoa is a 403", r.status === 403, r);
  check("the refusal says branch_forbidden", r.json.code === "branch_forbidden", r.json);
  check("nothing reached the ledger", (await ledger.get()).size === 0);
}

console.log("a branch you may use is stamped");
{
  const r = await expense(DESK, { branchId: "hel" });
  check("desk-1 posting an expense for Heliopolis is a 200", r.status === 200 && r.json.ok === true, r);
  const stored = await row(r.json.id);
  check("the stored row carries branchId hel", stored?.branchId === "hel" && stored?.type === "expense", stored);
}

console.log("a branch that does not exist is asked for again");
{
  const before = (await ledger.get()).size;
  const r = await expense(DESK, { branchId: "nowhere" });
  check("an unknown branch is a 400", r.status === 400, r);
  check("the refusal says branch_required", r.json.code === "branch_required", r.json);
  check("nothing was written", (await ledger.get()).size === before);
}

console.log("an admin may use any branch, and a saved row keeps its branch");
{
  await clinic.collection("patients").doc("P0").set({ name: "Walk In" });
  const r = await payment(ADMIN, "P0", { branchId: "tag" });
  check("admin-1 taking a payment for Tagamoa is a 200", r.status === 200 && r.json.ok === true, r);
  const id = r.json.id as string;
  const stored = await row(id);
  check("the payment row carries branchId tag", stored?.branchId === "tag" && stored?.type === "payment", stored);
  const move = await money(ADMIN, { action: "update", id, patch: { branchId: "hel" } });
  check("moving it to Heliopolis is a 409", move.status === 409, move);
  check("it is still stamped tag", (await row(id))?.branchId === "tag");
  const same = await money(ADMIN, { action: "update", id, patch: { branchId: "tag", description: "Edited" } });
  check("re-sending its own branch with another edit is fine", same.status === 200, same);
  const after = await row(id);
  check("the edit landed and the branch stayed", after?.description === "Edited" && after?.branchId === "tag", after);
}

console.log("rows nobody chose a branch for fall back, tier by tier");
{
  await clinic.collection("appointments").doc("A1").set({ branchId: "hel" });
  await clinic.collection("patients").doc("P1").set({ name: "One", branchId: "hel" });
  await clinic.collection("patients").doc("P2").set({ name: "Two", branchId: "tag" });
  await clinic.collection("patients").doc("P3").set({ name: "Three", branchId: "tag" });
  await clinic.collection("patients").doc("P4").set({ name: "Four" });
  const charge = (patientId: string, extra: Json) => ({ type: "procedure", patientId, description: "Crown", cost: 1000, doctorName: "Dr Sami", ...extra });
  await ledger.doc("CH-ledger").set(charge("P1", { branchId: "tag" }));
  await ledger.doc("CH-appt").set(charge("P2", { appointmentId: "A1" }));
  await ledger.doc("CH-patient").set(charge("P3", {}));
  await ledger.doc("CH-stale").set(charge("P3", { branchId: "closed", appointmentId: "A-gone" }));

  const viaLedger = await payment(ADMIN, "P1", { procedureId: "CH-ledger" });
  check("a payment on a charge stamped tag takes tag (over the patient's hel)", viaLedger.status === 200 && (await row(viaLedger.json.id))?.branchId === "tag", viaLedger);

  const viaAppt = await payment(ADMIN, "P2", { procedureId: "CH-appt" });
  check("a charge with no branch takes its visit's hel (over the patient's tag)", viaAppt.status === 200 && (await row(viaAppt.json.id))?.branchId === "hel", viaAppt);

  const viaPatient = await payment(ADMIN, "P3", { procedureId: "CH-patient" });
  check("a charge with neither takes the patient's tag", viaPatient.status === 200 && (await row(viaPatient.json.id))?.branchId === "tag", viaPatient);

  const stale = await payment(ADMIN, "P3", { procedureId: "CH-stale" });
  check("a charge naming a branch that no longer exists is skipped, down to the patient's tag", stale.status === 200 && (await row(stale.json.id))?.branchId === "tag", stale);

  const onAccount = await payment(ADMIN, "P4", {});
  check("a payment on account for a patient with no branch takes the first, hel", onAccount.status === 200 && (await row(onAccount.json.id))?.branchId === "hel", onAccount);

  const entry = await expense(ADMIN, {});
  check("a manual entry with no branch takes the first, hel", entry.status === 200 && (await row(entry.json.id))?.branchId === "hel", entry);

  const phone = await payment(DESK, "P1", { procedureId: "CH-ledger" });
  check("desk-1 (hel only) paying a tag charge with no branch is not refused, and lands on her own hel", phone.status === 200 && (await row(phone.json.id))?.branchId === "hel", phone);
  const adminAgain = await payment(ADMIN, "P1", { procedureId: "CH-ledger" });
  check("admin-1 on the same charge still gets tag", adminAgain.status === 200 && (await row(adminAgain.json.id))?.branchId === "tag", adminAgain);

  const third = await expense(DESK_3, {}, FIRST_IS_FORBIDDEN_CLINIC);
  check("a manual entry with no branch, where the clinic's first branch (tag) is not hers, lands on her hel", third.status === 200 && (await row(third.json.id, thirdClinic.collection("ledger")))?.branchId === "hel", third);
}

console.log("another branch's money cannot be edited or deleted");
{
  await clinic.collection("patients").doc("P5").set({ name: "Five" });
  const tagPay = await payment(ADMIN, "P5", { branchId: "tag" });
  const tagId = tagPay.json.id as string;
  check("admin-1 takes a Tagamoa payment", tagPay.status === 200 && (await row(tagId))?.branchId === "tag", tagPay);

  const edit = await money(DESK, { action: "update", id: tagId, patch: { description: "Not mine" } });
  check("desk-1 (hel only) editing the tag payment is a 403 branch_forbidden", edit.status === 403 && edit.json.code === "branch_forbidden", edit);
  check("the edit did not land", (await row(tagId))?.description !== "Not mine");
  const del = await money(DESK, { action: "delete", id: tagId });
  check("desk-1 deleting the tag payment is a 403 branch_forbidden", del.status === 403 && del.json.code === "branch_forbidden", del);
  check("the payment is still there", !!(await row(tagId)));

  const helPay = await payment(DESK, "P5", { branchId: "hel" });
  const ownEdit = await money(DESK, { action: "update", id: helPay.json.id, patch: { description: "Mine" } });
  check("desk-1 editing her own hel payment is a 200", ownEdit.status === 200 && (await row(helPay.json.id))?.description === "Mine", ownEdit);

  const adminEdit = await money(ADMIN, { action: "update", id: tagId, patch: { description: "Owner edit" } });
  check("admin-1 editing the tag payment is a 200", adminEdit.status === 200 && (await row(tagId))?.description === "Owner edit", adminEdit);
  const adminDel = await money(ADMIN, { action: "delete", id: tagId });
  check("admin-1 deleting the tag payment is a 200", adminDel.status === 200 && !(await row(tagId)), adminDel);
}

console.log("a branch's briefing is for the people who work there");
{
  const brief = async (uid: string, branchId: string) => {
    const res = await briefingRoute.GET(
      new Request(`http://localhost/api/ai/daily-briefing?clinicId=${CLINIC}&period=day&branchId=${branchId}`, { headers: { authorization: `Bearer ${idToken(uid)}` } }),
    );
    return { status: res.status, json: (await res.json()) as Json };
  };
  const other = await brief(DESK, "tag");
  check("desk-1 (hel only) asking for Tagamoa's briefing is a 403 branch_forbidden", other.status === 403 && other.json.code === "branch_forbidden", other);
  const own = await brief(DESK, "hel");
  check("desk-1 asking for her own Heliopolis briefing is a 200", own.status === 200 && own.json.ok === true, own.status);
  const owner = await brief(ADMIN, "tag");
  check("admin-1 asking for Tagamoa's briefing is a 200", owner.status === 200 && owner.json.ok === true, owner.status);
}

console.log("staff settlements are paid from a branch");
{
  const none = await settle(ADMIN);
  check("a payout with no branch is a 400 branch_required", none.status === 400 && none.json.code === "branch_required", none);
  const ok = await settle(ADMIN, { branchId: "tag" });
  check("a payout from Tagamoa is a 200", ok.status === 200 && ok.json.ok === true && !!ok.json.ledgerId, ok);
  const settlement = await row(ok.json.id, clinic.collection(SETTLEMENTS_COLLECTION));
  const salary = await row(ok.json.ledgerId);
  check("the settlement carries branchId tag", settlement?.branchId === "tag", settlement);
  check("its Salary expense row carries branchId tag", salary?.branchId === "tag" && salary?.category === "Salary", salary);
  const bad = await settle(ADMIN, { branchId: "nowhere" });
  check("an unknown branch is a 400 branch_required", bad.status === 400 && bad.json.code === "branch_required", bad);
}

console.log("a clinic with no branches stamps nothing");
{
  const r = await expense(DESK_2, {}, NO_BRANCH_CLINIC);
  check("desk-2 posting an expense with no branch is a 200", r.status === 200 && r.json.ok === true, r);
  const stored = await row(r.json.id, plainClinic.collection("ledger"));
  check("the row exists and has no branchId field at all", !!stored && !("branchId" in stored), stored);
}

console.log("each branch numbers its own receipts");
{
  const hel1 = await money(ADMIN, { action: "create-payment", patientId: "RP", amount: 50, date: "2026-10-01", branchId: "hel" }, RECEIPTS_CLINIC);
  const tag1 = await money(ADMIN, { action: "create-payment", patientId: "RP", amount: 50, date: "2026-10-01", branchId: "tag" }, RECEIPTS_CLINIC);
  check("a Heliopolis payment is a 200 numbered HEL-0001", hel1.status === 200 && hel1.json.receiptNumber === "HEL-0001", hel1);
  check("a Tagamoa payment is a 200 numbered TAG-0001 (its own sequence)", tag1.status === 200 && tag1.json.receiptNumber === "TAG-0001", tag1);
  const hel2 = await money(ADMIN, { action: "create-payment", patientId: "RP", amount: 50, date: "2026-10-01", branchId: "hel" }, RECEIPTS_CLINIC);
  check("the next Heliopolis payment is HEL-0002", hel2.json.receiptNumber === "HEL-0002", hel2);
  const settings = receiptsClinic.collection("settings");
  check("the clinic-wide receipt_counter does not exist", !(await settings.doc("receipt_counter").get()).exists);
  check("Heliopolis counts on receipt_counter_hel", (await settings.doc("receipt_counter_hel").get()).data()?.last === 2);
  check("Tagamoa counts on receipt_counter_tag", (await settings.doc("receipt_counter_tag").get()).data()?.last === 1);
  const ar1 = await money(ADMIN, { action: "create-payment", patientId: "RP", amount: 50, date: "2026-10-01", branchId: "ar1" }, RECEIPTS_CLINIC);
  const ar2 = await money(ADMIN, { action: "create-payment", patientId: "RP", amount: 50, date: "2026-10-01", branchId: "ar2" }, RECEIPTS_CLINIC);
  check("two branches whose names derive the same prefix number BR-0001 and BR2-0001", ar1.json.receiptNumber === "BR-0001" && ar2.json.receiptNumber === "BR2-0001", { a: ar1.json, b: ar2.json });
  const stored = await row(hel1.json.id, receiptsClinic.collection("ledger"));
  check("the row stores the sequence it took", stored?.receiptSeq === 1 && stored?.receiptNumber === "HEL-0001", stored);
  check("payments taken in the main test clinic never touched the clinic-wide counter either", !(await clinic.collection("settings").doc("receipt_counter").get()).exists);
}

console.log("a clinic with no branches still numbers from the clinic-wide counter");
{
  const r = await money(DESK_2, { action: "create-payment", patientId: "PP", amount: 50, date: "2026-10-01" }, NO_BRANCH_CLINIC);
  check("a payment with no branches is a 200 numbered with the clinic prefix", r.status === 200 && /^R-\d{4}-0001$/.test(r.json.receiptNumber ?? ""), r);
  const counter = await plainClinic.collection("settings").doc("receipt_counter").get();
  check("it counted on settings/receipt_counter", counter.exists && counter.data()?.last === 1, counter.data());
}

console.log("an insurance approval belongs to a branch");
{
  await receiptsClinic.set({ features: { insurance: true } }, { merge: true });
  await receiptsClinic.collection("settings").doc("payers").set({
    payers: [
      { id: "private", name: "Private", active: true, isDefault: true },
      { id: "metlife", name: "MetLife", format: "metlife", providerCode: "DNC0001", active: true, isDefault: false },
    ],
  });
  await receiptsClinic.collection("staff").doc("omar").set({ name: "Dr Omar Test", role: "Dentist", commissionPercentage: 40, commissionByPayer: { metlife: 25 } });
  await receiptsClinic.collection("staff").doc("desk-4-staff").set({ uid: DESK_4, name: "Desk Four", role: "Receptionist", branchIds: ["hel"] });
  await db.collection("users").doc(DESK_4).set({
    name: "Desk Four",
    clinicRoles: { [RECEIPTS_CLINIC]: "Receptionist" },
    clinicPermissions: { [RECEIPTS_CLINIC]: ["patients.edit", "finance.add"] },
  });
  await receiptsClinic.collection("patients").doc("CP").set({ name: "Claim Patient" });
  const lines = [
    { code: "D0120", description: "PERIODIC ORAL EVALUATION", amount: 60 },
    { code: "D2650", description: "INLAY - RESIN-BASED COMPOSITE", amount: 600 },
  ];
  const paper = (approvalNumber: string) => ({
    header: {
      ...SAMPLE_RAW.header,
      approvalNumber,
      approvalDate: "05/10/2026",
      paperPatientName: "CLAIM PATIENT",
      estimatedCost: 660,
      requestedTotal: 660,
      approvedTotal: 660,
      patientShareTotal: 0,
      collectNote: 0,
    },
    lines: lines.map((l) => ({
      code: l.code, description: l.description, unitsRequested: 1, grossPerUnit: l.amount, grossTotal: l.amount,
      unitsApproved: 1, patientShare: 0, approvedAmount: l.amount, comment: "", confidence: 0.95,
    })),
  });
  const save = (uid: string, approvalNumber: string, branchId: string) =>
    post(claimsRoute, uid, { clinicId: RECEIPTS_CLINIC, docId: `doc-${approvalNumber}`, payerId: "metlife", extraction: paper(approvalNumber), patient: { id: "CP" }, dentistId: "omar", branchId });
  const claims = receiptsClinic.collection("insurance_claims");

  const saved = await save(ADMIN, "D7100001", "tag");
  check("admin-1 saving an approval for Tagamoa is a 201", saved.status === 201 && saved.json.claimId === "metlife_d7100001", saved);
  const claim = (await claims.doc("metlife_d7100001").get()).data();
  check("the claim carries branchId tag", claim?.branchId === "tag", claim?.branchId);
  const rows = (await receiptsClinic.collection("ledger").where("claimId", "==", "metlife_d7100001").where("type", "==", "procedure").get()).docs.map((d) => d.data());
  check("both treatment rows carry branchId tag", rows.length === 2 && rows.every((r) => r.branchId === "tag"), rows.map((r) => r.branchId));

  const paid = await post(claimsRoute, ADMIN, { clinicId: RECEIPTS_CLINIC, claimId: "metlife_d7100001", patch: { insurerPaid: true }, branchId: "hel" }, "PATCH");
  check("the insurer's payment, recorded at Heliopolis, is a 200", paid.status === 200 && Array.isArray(paid.json.payments) && paid.json.payments.length === 2, paid);
  const receipts = await Promise.all((paid.json.payments as string[] ?? []).map((id) => row(id, receiptsClinic.collection("ledger"))));
  check("each insurer payment is numbered in the Heliopolis series (HEL-000n) and stamped hel", receipts.length === 2 && receipts.every((r) => /^HEL-000\d$/.test(String(r?.receiptNumber)) && r?.branchId === "hel"), receipts.map((r) => [r?.receiptNumber, r?.branchId]));

  const refused = await save(DESK_4, "D7100002", "tag");
  check("desk-4 (Heliopolis only) saving an approval for Tagamoa is a 403 branch_forbidden", refused.status === 403 && refused.json.code === "branch_forbidden", refused);
  check("no claim was written", !(await claims.doc("metlife_d7100002").get()).exists);
}

console.log("collecting what an insurance company owes");
{
  const rl = receiptsClinic.collection("ledger");
  const patients = receiptsClinic.collection("patients");
  await patients.doc("GP1").set({ name: "Gasco Patient One" });
  await patients.doc("GP2").set({ name: "Gasco Patient Two" });
  const charge = (id: string, extra: Json) =>
    rl.doc(id).set({ type: "procedure", patientId: "GP1", patientName: "Gasco Patient One", description: "Crown", payerId: "gasco", payerName: "GASCO", cost: 1000, amount: 1000, paid: 0, doctorId: "omar", doctorName: "Dr Omar Test", date: "2026-10-05", ...extra });
  const cashOn = (id: string, procedureId: string, amount: number, extra: Json = {}) =>
    rl.doc(id).set({ type: "payment", patientId: "GP1", procedureId, paid: amount, amount, cost: 0, method: "Cash", payerId: "gasco", payerName: "GASCO", date: "2026-10-05", ...extra });
  const collect = (uid: string, chargeIds: string[], extra: Json = {}) =>
    money(uid, { action: "insurer-collect", payerId: "gasco", chargeIds, ...extra }, RECEIPTS_CLINIC);
  const last = async (branch: string) => Number((await receiptsClinic.collection("settings").doc(`receipt_counter_${branch}`).get()).data()?.last ?? 0);
  const num4 = (n: number) => String(n).padStart(4, "0");
  const insurerPayments = async (procedureId: string) =>
    (await rl.where("procedureId", "==", procedureId).where("type", "==", "payment").where("method", "==", "Insurance").get()).docs.map((d) => ({ id: d.id, ...d.data() })) as Json[];

  // G1: 1000 at Heliopolis, 400 already paid in cash by the patient. G2: 500 at Tagamoa, nothing paid.
  await charge("G1", { branchId: "hel", paid: 400 });
  await cashOn("G1-cash", "G1", 400, { branchId: "hel" });
  await charge("G2", { branchId: "tag", cost: 500, amount: 500, patientId: "GP2", patientName: "Gasco Patient Two" });
  const helBefore = await last("hel");
  const tagBefore = await last("tag");

  const first = await collect(ADMIN, ["G1", "G2"]);
  check("admin collecting two Gasco charges is a 200 with the totals", first.status === 200 && first.json.ok === true && first.json.count === 2 && first.json.paid === 1100, first);
  const g1 = await insurerPayments("G1");
  const g2 = await insurerPayments("G2");
  check("G1 got one Insurance payment for what was left: 600, not the full 1000", g1.length === 1 && g1[0].paid === 600 && g1[0].amount === 600, g1);
  check("G2 got one Insurance payment of 500", g2.length === 1 && g2[0].paid === 500, g2);
  check("each payment names the company and the dentist", g1[0]?.payerId === "gasco" && g1[0]?.payerName === "GASCO" && g1[0]?.doctorId === "omar" && g2[0]?.payerId === "gasco", [g1[0], g2[0]]);
  check("each payment follows its charge's branch", g1[0]?.branchId === "hel" && g2[0]?.branchId === "tag", [g1[0]?.branchId, g2[0]?.branchId]);
  check("receipts are numbered from each charge's own branch counter", g1[0]?.receiptNumber === `HEL-${num4(helBefore + 1)}` && g2[0]?.receiptNumber === `TAG-${num4(tagBefore + 1)}`, [g1[0]?.receiptNumber, g2[0]?.receiptNumber]);
  check("the response lists both receipt numbers", Array.isArray(first.json.receiptNumbers) && first.json.receiptNumbers.length === 2 && first.json.receiptNumbers.includes(g1[0]?.receiptNumber) && first.json.receiptNumbers.includes(g2[0]?.receiptNumber), first.json);
  check("the company's money carries the dentist's rate for that payer, like any payment on the treatment", g1[0]?.doctorCommissionPercentage === 40 && g2[0]?.doctorCommissionPercentage === 40, [g1[0]?.doctorCommissionPercentage, g2[0]?.doctorCommissionPercentage]);
  check("each counter advanced by exactly one", (await last("hel")) === helBefore + 1 && (await last("tag")) === tagBefore + 1);
  const g1After = await row("G1", rl);
  const g2After = await row("G2", rl);
  check("both charges are now paid in full", g1After?.paid === 1000 && g2After?.paid === 500, [g1After?.paid, g2After?.paid]);
  check("the charges are stamped with the day the company paid", typeof g1After?.insurerPaidAt === "string" && typeof g2After?.insurerPaidAt === "string", [g1After?.insurerPaidAt, g2After?.insurerPaidAt]);
  check("the patient's own cash payment is untouched", (await row("G1-cash", rl))?.paid === 400 && (await row("G1-cash", rl))?.method === "Cash");

  const again = await collect(ADMIN, ["G1", "G2"]);
  check("the same call again is a 409 NOTHING_TO_DO", again.status === 409 && again.json.reason === "NOTHING_TO_DO", again);
  check("nothing was paid twice", (await insurerPayments("G1")).length === 1 && (await insurerPayments("G2")).length === 1 && (await row("G1", rl))?.paid === 1000);
  check("no receipt number was spent on the refusal", (await last("hel")) === helBefore + 1 && (await last("tag")) === tagBefore + 1);

  // Two charges at one branch in one batch take consecutive numbers from that branch's one counter.
  await charge("G7", { branchId: "hel", cost: 200, amount: 200 });
  await charge("G8", { branchId: "hel", cost: 300, amount: 300 });
  const pair = await collect(ADMIN, ["G7", "G8"]);
  const numbers = (pair.json.receiptNumbers as string[] | undefined) ?? [];
  check("two Heliopolis charges in one batch are numbered one after the other", pair.status === 200 && numbers.length === 2 && numbers.includes(`HEL-${num4(helBefore + 2)}`) && numbers.includes(`HEL-${num4(helBefore + 3)}`), pair);
  check("and the counter ends on the second", (await last("hel")) === helBefore + 3);

  // A row that came from an approval is collected on the Insurance page, so the batch skips it.
  await charge("G3", { branchId: "hel", claimId: "gasco_a1", cost: 800, amount: 800 });
  await charge("G4", { branchId: "hel", cost: 250, amount: 250 });
  const skipped = await collect(ADMIN, ["G3", "G4"]);
  check("an approval row in the list is skipped: the count is 1", skipped.status === 200 && skipped.json.count === 1 && skipped.json.paid === 250, skipped);
  check("the approval row was not touched", (await insurerPayments("G3")).length === 0 && (await row("G3", rl))?.paid === 0);
  const onlyClaim = await collect(ADMIN, ["G3"]);
  check("a list of only approval rows is a 409 NOTHING_TO_DO", onlyClaim.status === 409 && onlyClaim.json.reason === "NOTHING_TO_DO", onlyClaim);

  // desk-4 works at Heliopolis only. One Tagamoa charge in the batch refuses the whole batch.
  await charge("G5", { branchId: "tag", cost: 400, amount: 400 });
  await charge("G6", { branchId: "hel", cost: 100, amount: 100 });
  const tagBeforeRefusal = await last("tag");
  const helBeforeRefusal = await last("hel");
  const refusedMixed = await collect(DESK_4, ["G6", "G5"]);
  check("desk-4 (Heliopolis only) collecting a batch with a Tagamoa charge is a 403 branch_forbidden", refusedMixed.status === 403 && refusedMixed.json.code === "branch_forbidden", refusedMixed);
  check("nothing was written, not even for her own branch's charge", (await insurerPayments("G5")).length === 0 && (await insurerPayments("G6")).length === 0 && (await row("G6", rl))?.paid === 0 && (await last("hel")) === helBeforeRefusal && (await last("tag")) === tagBeforeRefusal);
  const own = await collect(DESK_4, ["G6"]);
  check("desk-4 collecting her own Heliopolis charge is a 200", own.status === 200 && own.json.count === 1 && own.json.paid === 100, own);

  // The payer in the request must be the charge's payer.
  await charge("G9", { branchId: "hel", payerId: "axa", payerName: "AXA", cost: 90, amount: 90 });
  const wrongPayer = await collect(ADMIN, ["G9"]);
  check("a charge that belongs to another company is a 400", wrongPayer.status === 400, wrongPayer);
  check("and was not paid", (await insurerPayments("G9")).length === 0 && (await row("G9", rl))?.paid === 0);
  const missing = await collect(ADMIN, ["no-such-charge"]);
  check("a charge id that does not exist is a 404", missing.status === 404, missing);
  const none = await collect(ADMIN, []);
  check("an empty list is a 400", none.status === 400, none);

  // Work from before branches takes the clinic's first branch, as a payment on it would.
  await charge("G10", { cost: 120, amount: 120 });
  const old = await collect(ADMIN, ["G10"]);
  const oldPayment = (await insurerPayments("G10"))[0];
  check("a charge with no branch is collected on the first branch (Heliopolis)", old.status === 200 && oldPayment?.branchId === "hel" && /^HEL-\d{4}$/.test(String(oldPayment?.receiptNumber)), [old, oldPayment?.branchId, oldPayment?.receiptNumber]);

  // Two people pressing the button together pay a row once.
  await charge("G11", { branchId: "tag", cost: 640, amount: 640 });
  const raced = await Promise.all([collect(ADMIN, ["G11"]), collect(ADMIN, ["G11"])]);
  const statuses = raced.map((r) => r.status).sort();
  check("two simultaneous collects of one row: one 200, one 409", statuses[0] === 200 && statuses[1] === 409, raced);
  check("the row was paid exactly once", (await insurerPayments("G11")).length === 1 && (await row("G11", rl))?.paid === 640);
}

for (const c of [clinic, plainClinic, thirdClinic, receiptsClinic]) await db.recursiveDelete(c);
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
