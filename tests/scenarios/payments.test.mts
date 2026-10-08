// @ts-nocheck — a scenario script: rows are read back as loose Firestore data on purpose.
/**
 * PAYMENTS & LEDGER — 25 clinic workflow scenarios (P01–P25), end to end against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/scenarios/payments.test.mts
 *
 * Runs the real route handlers (`/api/clinical/procedures` to charge a treatment, `/api/finance/ledger`
 * for every money write) with nothing mocked but the login check: a tiny server answers the one
 * accounts:lookup call verifyIdToken makes in emulator mode, so only the Firestore emulator is needed.
 * Report maths (summarizeLedger, ledgerCashValue) are run over the rows the routes actually stored.
 *
 * Every scenario asserts what a clinic NEEDS. A scenario whose checks fail is either a bug in the
 * product or a wrong assumption here — the summary table at the end says which is which.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-scn-payments";
const C1 = "scn-pay-c1"; // the clinic under test
const C2 = "scn-pay-c2"; // another clinic, for tenancy checks
const C3 = "scn-pay-c3"; // a clean clinic, for the Finance totals
const CX = "scn-pay-cx"; // an expired clinic

const ADMIN = "pay-admin";
const OWNER = "pay-owner";
const RECEP = "pay-recep";
const OTHER_ADMIN = "pay-other-admin";
const CROSS = "pay-cross"; // Admin of C2, plain Assistant (no money rights) in C1
const EXPIRED_ADMIN = "pay-expired-admin";
const DR_A = "dr-ahmed";
const DR_B = "dr-basma";

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

const { adminDb } = await import("../../src/lib/firebaseAdmin");
const ledgerRoute = await import("../../src/app/api/finance/ledger/route");
const procRoute = await import("../../src/app/api/clinical/procedures/route");
const { summarizeLedger } = await import("../../src/lib/reports/ledgerStats");
const { ledgerCashValue } = await import("../../src/lib/reportHelpers");
const { overAllocation, chargeAmount } = await import("../../src/lib/paymentAllocation");

const db = adminDb();
const col = (clinicId: string, name: string) => db.collection("clinics").doc(clinicId).collection(name);

// --- tiny harness -----------------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

type Json = Record<string, any>;
const results: Array<{ id: string; title: string; ok: boolean }> = [];
async function scenario(id: string, title: string, fn: () => Promise<void>) {
  console.log(`\n${id} — ${title}`);
  const before = failed;
  try {
    await fn();
  } catch (e) {
    check(`${id} ran without throwing`, false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  }
  results.push({ id, title, ok: failed === before });
}

async function post(handler: (r: Request) => Promise<Response>, path: string, body: unknown, uid = ADMIN): Promise<{ status: number; json: Json }> {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken(uid)}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

/** Record a treatment (the clinical editor's Save). */
const charge = (b: Json, uid = ADMIN, clinicId: string | null = C1) =>
  post(procRoute.POST, "/api/clinical/procedures", { action: "create", ...(clinicId ? { clinicId } : {}), status: "Completed", ...b }, uid);
const procAction = (b: Json, uid = ADMIN, clinicId = C1) => post(procRoute.POST, "/api/clinical/procedures", { clinicId, ...b }, uid);
/** Take money (any of the four payment screens). */
const pay = (b: Json, uid = ADMIN, clinicId: string | null = C1) =>
  post(ledgerRoute.POST, "/api/finance/ledger", { action: "create-payment", ...(clinicId ? { clinicId } : {}), method: "Cash", ...b }, uid);
const ledger = (b: Json, uid = ADMIN, clinicId = C1) => post(ledgerRoute.POST, "/api/finance/ledger", { clinicId, ...b }, uid);

const row = async (id: string, clinicId = C1): Promise<Json> => ((await col(clinicId, "ledger").doc(id).get()).data() ?? {}) as Json;
const exists = async (collection: string, id: string, clinicId = C1) => (await col(clinicId, collection).doc(id).get()).exists;
const paymentsOf = async (procId: string, clinicId = C1) =>
  (await col(clinicId, "ledger").where("procedureId", "==", procId).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
const rowsOfPatient = async (patientId: string, clinicId = C1) =>
  (await col(clinicId, "ledger").where("patientId", "==", patientId).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.005;

let patientSeq = 0;
async function newPatient(name: string, clinicId = C1): Promise<string> {
  patientSeq += 1;
  const id = `pat-${patientSeq}`;
  await col(clinicId, "patients").doc(id).set({ name, phone: `+2010000${String(patientSeq).padStart(5, "0")}` });
  return id;
}

const CROWN = { procedures: ["Zirconia Crown"], selectedTeeth: ["11"] }; // 3000, lab 800, per tooth
const CONSULT = { procedures: ["Consultation"] }; // 200 flat
const FILLING = { procedures: ["Composite Filling"], selectedTeeth: ["36"] }; // 500 per tooth

// --- the world ------------------------------------------------------------------------------------

async function wipe() {
  for (const c of [C1, C2, C3, CX]) await db.recursiveDelete(db.collection("clinics").doc(c));
  for (const u of [ADMIN, OWNER, RECEP, OTHER_ADMIN, CROSS, EXPIRED_ADMIN]) await db.recursiveDelete(db.collection("users").doc(u));
}

async function seedClinic(clinicId: string, status = "Active") {
  await db.collection("clinics").doc(clinicId).set({ name: `Scenario ${clinicId}`, status, subscriptionTier: "Premium" });
  await col(clinicId, "staff").doc(DR_A).set({ name: "Dr Ahmed Samir", role: "Dentist", commissionPercentage: 40 });
  await col(clinicId, "staff").doc(DR_B).set({ name: "Dr Basma Adel", role: "Dentist", commissionPercentage: 30 });
  await col(clinicId, "services").doc("svc-consult").set({ name: "Consultation", price: 200, pricingMode: "flat" });
  await col(clinicId, "services").doc("svc-crown").set({ name: "Zirconia Crown", price: 3000, pricingMode: "per_tooth", requiresLab: true, estimatedLabFee: 800 });
  await col(clinicId, "services").doc("svc-fill").set({ name: "Composite Filling", price: 500, pricingMode: "per_tooth" });
}

await wipe();
await seedClinic(C1);
await seedClinic(C2);
await seedClinic(C3);
await seedClinic(CX, "Expired");
await db.collection("users").doc(ADMIN).set({ name: "Dr Hany (Admin)", clinicRoles: { [C1]: "Admin", [C3]: "Admin" }, defaultClinicId: C1 });
await db.collection("users").doc(OWNER).set({ name: "Dr Mona (Owner)", clinicRoles: { [C1]: "Owner" }, defaultClinicId: C1 });
const RECEP_PERMS = ["finance.add", "finance.edit", "clinical.edit"];
await db.collection("users").doc(RECEP).set({
  name: "Nour (Reception)", role: "Assistant", permissions: RECEP_PERMS,
  clinicRoles: { [C1]: "Assistant" }, clinicPermissions: { [C1]: RECEP_PERMS }, defaultClinicId: C1,
});
await db.collection("users").doc(OTHER_ADMIN).set({ name: "Other clinic admin", clinicRoles: { [C2]: "Admin" }, defaultClinicId: C2 });
await db.collection("users").doc(CROSS).set({
  name: "Samy (works at two clinics)", role: "Assistant", permissions: [],
  clinicRoles: { [C2]: "Admin", [C1]: "Assistant" }, clinicPermissions: { [C1]: [] }, defaultClinicId: C1,
});
await db.collection("users").doc(EXPIRED_ADMIN).set({ name: "Expired clinic admin", clinicRoles: { [CX]: "Admin" }, defaultClinicId: CX });

// ===================================================================================================

await scenario("P01", "Consultation charged at catalogue price, paid in full in cash", async () => {
  // Om Karim comes in for a check-up with Dr Ahmed. Reception leaves the price blank (catalogue 200)
  // and takes 200 cash at the desk.
  const pid = await newPatient("Om Karim");
  const c = await charge({ patientId: pid, ...CONSULT, doctorId: DR_A, unitCost: "" });
  check("charge saved", c.status === 200 && c.json.ok && !!c.json.ledgerId, c.json);
  check("priced from the catalogue: 200", c.json.cost === 200, c.json);
  const proc = await row(c.json.ledgerId);
  check("charge row: cost 200, paid 0, Dr Ahmed, 40% stamped", proc.cost === 200 && proc.paid === 0 && proc.doctorId === DR_A && proc.doctorCommissionPercentage === 40, proc);

  const p = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 200 });
  check("payment accepted with a receipt number", p.status === 200 && p.json.ok && /^R-\d{4}-\d{4}$/.test(p.json.receiptNumber ?? ""), p.json);
  const pr = await row(p.json.id);
  check("payment row: paid 200 = amount 200, cost 0", pr.paid === 200 && pr.amount === 200 && pr.cost === 0 && pr.type === "payment", pr);
  check("payment names the dentist and patient", pr.doctorId === DR_A && pr.doctorName === "Dr Ahmed Samir" && pr.patientName === "Om Karim", pr);
  check("commission 40% of 200 = 80, clinic keeps 120", pr.doctorCommissionAmount === 80 && pr.clinicProfit === 120, pr);
  check("category Treatment Payment, linked to the charge", pr.category === "Treatment Payment" && pr.procedureId === c.json.ledgerId, pr);
  check("charge now reads paid 200", (await row(c.json.ledgerId)).paid === 200);
  const counter = (await col(C1, "settings").doc("receipt_counter").get()).data() ?? (await col(C1, "settings").get()).docs.find((d) => d.data().last)?.data();
  check("receipt counter advanced to this receipt's sequence", !!counter && counter.last === pr.receiptSeq, { counter, seq: pr.receiptSeq });
  const audit = await col(C1, "ledger_audit").where("documentId", "==", p.json.id).get();
  check("an audit row records the payment", audit.size >= 1, audit.size);
});

await scenario("P02", "Filling paid in three instalments; a fourth pound is refused", async () => {
  // Mr Tarek pays his 500 filling 200 / 200 / 100 over three visits.
  const pid = await newPatient("Tarek Fathy");
  const c = await charge({ patientId: pid, ...FILLING, doctorId: DR_A });
  const proc = c.json.ledgerId;
  check("filling charged at 500", c.json.cost === 500, c.json);
  const amounts: Array<[number, string]> = [[200, "2026-10-01"], [200, "2026-10-02"], [100, "2026-10-03"]];
  let running = 0;
  for (const [amount, date] of amounts) {
    const p = await pay({ patientId: pid, procedureId: proc, amount, date });
    running += amount;
    check(`instalment ${amount} on ${date} accepted`, p.status === 200, p.json);
    check(`charge paid is now ${running}`, (await row(proc)).paid === running);
  }
  const pays = await paymentsOf(proc);
  check("three payment rows, commission 80/80/40", pays.length === 3 && pays.map((x) => x.doctorCommissionAmount).sort((a, b) => a - b).join(",") === "40,80,80", pays.map((x) => x.doctorCommissionAmount));
  const extra = await pay({ patientId: pid, procedureId: proc, amount: 1 });
  check("a 4th payment of 1 EGP is refused as over-allocation", extra.status === 409 && extra.json.reason === "over_allocation" && extra.json.remaining === 0 && extra.json.excess === 1, extra.json);
  check("message says it is already paid in full", /paid in full/.test(extra.json.error ?? ""), extra.json.error);
  check("still three payments", (await paymentsOf(proc)).length === 3);
});

await scenario("P03", "Patient hands over more than is left: refused with the exact remaining", async () => {
  // Root canal typed at 1000. Patient paid 600 last week, today gives 500.
  const pid = await newPatient("Hoda Said");
  const c = await charge({ patientId: pid, procedures: ["Root Canal"], selectedTeeth: ["46"], doctorId: DR_B, unitCost: 1000 });
  check("unlisted treatment charged at the typed 1000", c.json.cost === 1000, c.json);
  await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 600, date: "2026-10-01" });
  const over = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 500 });
  check("500 on a 400 balance is refused (409 over_allocation)", over.status === 409 && over.json.reason === "over_allocation", over.json);
  check("refusal carries remaining 400 and excess 100", over.json.remaining === 400 && over.json.excess === 100, over.json);
  check("refusal tells reception to record 400", /400/.test(over.json.error ?? ""), over.json.error);
  check("nothing written: still one payment, paid 600", (await paymentsOf(c.json.ledgerId)).length === 1 && (await row(c.json.ledgerId)).paid === 600);
  const exact = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 400 });
  const onAccount = await pay({ patientId: pid, amount: 100 });
  check("reception records 400 against it and 100 on account", exact.status === 200 && onAccount.status === 200, [exact.json, onAccount.json]);
  check("charge settled at exactly 1000", (await row(c.json.ledgerId)).paid === 1000);
});

await scenario("P04", "Treatment with no dentist: money refused (NO_DENTIST) but advance on account allowed", async () => {
  // A cleaning was typed up as "General" with no dentist picked.
  const pid = await newPatient("Mahmoud Ali");
  const c = await charge({ patientId: pid, procedures: ["Scaling"], unitCost: 300 });
  check("General treatment saved with no dentist", c.status === 200 && !!c.json.ledgerId, c.json);
  const proc = await row(c.json.ledgerId);
  check("charge carries no dentist and no commission", proc.doctorId === null && proc.doctorCommissionAmount === 0, proc);
  const p = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 300 });
  check("payment refused 409 NO_DENTIST", p.status === 409 && p.json.reason === "NO_DENTIST", p.json);
  check("refusal is bilingual", /اختار الطبيب/.test(p.json.error ?? ""), p.json.error);
  check("no payment row was written", (await paymentsOf(c.json.ledgerId)).length === 0 && (await row(c.json.ledgerId)).paid === 0);
  const adv = await pay({ patientId: pid, amount: 300 });
  const a = await row(adv.json.id);
  check("payment on account accepted", adv.status === 200, adv.json);
  check("advance: no treatment, no dentist, all clinic profit", a.procedureId === null && a.doctorId === null && a.category === "Advance Payment" && a.doctorCommissionAmount === 0 && a.clinicProfit === 300 && a.labFee === 0, a);
});

await scenario("P05", "Price typed as 0 = free treatment, no charge row", async () => {
  // Dr Ahmed re-cements a crown for free, reception types 0 in the price box.
  const pid = await newPatient("Free Recement");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, unitCost: 0 });
  check("saved with cost 0 and no ledger charge", c.status === 200 && c.json.cost === 0 && c.json.ledgerId === null, c.json);
  const note = (await col(C1, "clinical_notes").doc(c.json.noteId).get()).data() ?? {};
  check("the clinical note exists, cost 0", note.cost === 0 && note.ledgerId === null, note);
  check("patient has no ledger rows at all", (await rowsOfPatient(pid)).length === 0);
  const s = await charge({ patientId: pid, ...CONSULT, doctorId: DR_A, unitCost: "0" });
  check("a typed \"0\" string is also free", s.json.cost === 0 && s.json.ledgerId === null, s.json);
});

await scenario("P06", "Blank price uses the catalogue; a typed price wins; per-tooth multiplies", async () => {
  const pid = await newPatient("Sherif Nabil");
  const blank = await charge({ patientId: pid, ...FILLING, doctorId: DR_A, unitCost: "" });
  const nul = await charge({ patientId: pid, ...FILLING, doctorId: DR_A, unitCost: null });
  check("blank price → catalogue 500", blank.json.cost === 500 && nul.json.cost === 500, [blank.json, nul.json]);
  const typed = await charge({ patientId: pid, procedures: ["Composite Filling"], selectedTeeth: ["36", "37"], doctorId: DR_A, unitCost: "750" });
  const r = await row(typed.json.ledgerId);
  check("typed 750 × 2 teeth = 1500", typed.json.cost === 1500 && r.unitCost === 750 && r.unitsCount === 2 && r.pricingFormula === "750*2", r);
  check("commission on the charge = 40% of 1500", r.doctorCommissionAmount === 600 && r.clinicProfit === 900, r);
});

await scenario("P07", "10% Promotion discount on a crown; lab fee not discounted; then paid", async () => {
  const pid = await newPatient("Rania Mostafa");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "percent", discountValue: 10, discountReason: "Promotion" });
  check("charged 2700 after 10% off 3000", c.status === 200 && c.json.cost === 2700, c.json);
  const r = await row(c.json.ledgerId);
  check("discount stored structurally: list 3000, 300 off, reason", r.listPrice === 3000 && r.discountAmount === 300 && r.discountReason === "Promotion", r);
  check("lab fee stays the full 800", r.labFee === 800, r.labFee);
  check("commission on the net after lab: (2700-800)×40% = 760", r.doctorCommissionAmount === 760 && r.clinicProfit === 1140, r);
  const p = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 2700 });
  const pr = await row(p.json.id);
  check("full payment 2700 accepted", p.status === 200, p.json);
  check("payment carries the lab 800 and commission 760", pr.labFee === 800 && pr.doctorCommissionAmount === 760 && pr.clinicProfit === 1140, pr);
  const over = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 300 });
  check("the discounted 300 cannot be collected on top", over.status === 409, over.json);
});

await scenario("P08", "Receptionist discounts: reason required, cap 20% for non-admins", async () => {
  const pid = await newPatient("Ayman Fawzy");
  const noReason = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "fixed", discountValue: 500 }, RECEP);
  check("fixed 500 off with no reason refused 403", noReason.status === 403 && /reason/i.test(noReason.json.error ?? ""), noReason.json);
  const ok = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "fixed", discountValue: 500, discountReason: "Promotion" }, RECEP);
  check("fixed 500 (16.7%) with a reason allowed → 2500", ok.status === 200 && ok.json.cost === 2500, ok.json);
  const tooBig = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "percent", discountValue: 30, discountReason: "Family & friends" }, RECEP);
  check("30% by reception refused, needs a Clinic Admin", tooBig.status === 403 && /Clinic Admin/.test(tooBig.json.error ?? ""), tooBig.json);
  const madeUp = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "percent", discountValue: 5, discountReason: "Because I said so" }, RECEP);
  check("a reason the clinic does not offer is refused", madeUp.status === 403, madeUp.json);
  check("refused attempts wrote nothing: one charge only", (await rowsOfPatient(pid)).length === 1);
  // The same ceiling through the ledger's own edit door.
  const viaLedger = await ledger({ action: "update", id: ok.json.ledgerId, patch: { discountMode: "percent", discountPercent: 50, discountReason: "Promotion" } }, RECEP);
  check("raising it to 50% from the ledger edit is refused too", viaLedger.status === 403, viaLedger.json);
  check("charge still 2500", (await row(ok.json.ledgerId)).cost === 2500);
});

await scenario("P09", "The clinic OWNER gives a 50% family discount", async () => {
  // Dr Mona owns the clinic (role Owner — full access like an Admin) and treats her cousin at half price.
  const pid = await newPatient("Owner's cousin");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "percent", discountValue: 50, discountReason: "Family & friends" }, OWNER);
  check("owner may discount 50% (Owner is full access)", c.status === 200 && c.json.cost === 1500, { status: c.status, json: c.json });
});

await scenario("P10", "Crown lab fee spread across instalments, earliest first", async () => {
  // Crown 3000 with an 800 lab bill. Patient pays 300, then 500, then 2200.
  const pid = await newPatient("Lab Spread");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A });
  const proc = c.json.ledgerId;
  const p1 = await pay({ patientId: pid, procedureId: proc, amount: 300, date: "2026-10-01" });
  let r1 = await row(p1.json.id);
  check("after the first 300 the whole 800 lab sits on it, dentist earns 0", r1.labFee === 800 && r1.doctorCommissionAmount === 0, r1);
  const p2 = await pay({ patientId: pid, procedureId: proc, amount: 500, date: "2026-10-02" });
  const p3 = await pay({ patientId: pid, procedureId: proc, amount: 2200, date: "2026-10-03" });
  r1 = await row(p1.json.id);
  const r2 = await row(p2.json.id);
  const r3 = await row(p3.json.id);
  check("lab shares 300 / 500 / 0", r1.labFee === 300 && r2.labFee === 500 && r3.labFee === 0, [r1.labFee, r2.labFee, r3.labFee]);
  check("commission 0 / 0 / 880", r1.doctorCommissionAmount === 0 && r2.doctorCommissionAmount === 0 && r3.doctorCommissionAmount === 880, [r1.doctorCommissionAmount, r2.doctorCommissionAmount, r3.doctorCommissionAmount]);
  const sumLab = r1.labFee + r2.labFee + r3.labFee;
  const sumComm = r1.doctorCommissionAmount + r2.doctorCommissionAmount + r3.doctorCommissionAmount;
  check("lab paid exactly once (800) and dentist gets 40% of 2200 = 880", sumLab === 800 && sumComm === 880, { sumLab, sumComm });
  check("clinic profit across the three = 3000 − 800 − 880 = 1320", near(r1.clinicProfit + r2.clinicProfit + r3.clinicProfit, 1320), [r1.clinicProfit, r2.clinicProfit, r3.clinicProfit]);
  check("charge paid 3000", (await row(proc)).paid === 3000);
});

await scenario("P11", "Deleting the first instalment: paid recomputes and the lab fee moves on", async () => {
  // Reception entered the 300 by mistake (it was for another patient) and deletes it.
  const pid = await newPatient("Delete First");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A });
  const proc = c.json.ledgerId;
  const p1 = await pay({ patientId: pid, procedureId: proc, amount: 300, date: "2026-10-01" });
  const p2 = await pay({ patientId: pid, procedureId: proc, amount: 500, date: "2026-10-02" });
  const p3 = await pay({ patientId: pid, procedureId: proc, amount: 2200, date: "2026-10-03" });
  const del = await ledger({ action: "delete", id: p1.json.id });
  check("payment deleted", del.status === 200 && !(await exists("ledger", p1.json.id)), del.json);
  check("charge paid falls to 2700", (await row(proc)).paid === 2700);
  const r2 = await row(p2.json.id);
  const r3 = await row(p3.json.id);
  check("lab now 500 on the 500 and 300 on the 2200", r2.labFee === 500 && r3.labFee === 300, [r2.labFee, r3.labFee]);
  check("commission on the 2200 recomputed to (2200−300)×40% = 760", r3.doctorCommissionAmount === 760, r3);
  const reception = await ledger({ action: "delete", id: p2.json.id }, RECEP);
  check("reception without finance.delete cannot delete a payment", reception.status === 403 && (await exists("ledger", p2.json.id)), reception.json);
});

await scenario("P12", "A back-dated receipt becomes the earliest and takes the lab fee", async () => {
  // A paper receipt from 1 September turns up and is entered today, after a 2000 payment already recorded.
  const pid = await newPatient("Back Dated");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A });
  const proc = c.json.ledgerId;
  const later = await pay({ patientId: pid, procedureId: proc, amount: 2000, date: "2026-10-05" });
  check("2000 first carries the 800 lab: commission 480", (await row(later.json.id)).doctorCommissionAmount === 480);
  const old = await pay({ patientId: pid, procedureId: proc, amount: 1000, date: "2026-09-01" });
  check("back-dated payment accepted with its own date", old.status === 200 && (await row(old.json.id)).date === "2026-09-01", old.json);
  const o = await row(old.json.id);
  const l = await row(later.json.id);
  check("lab fee moved to the 1 Sept payment (800) and off the later one (0)", o.labFee === 800 && l.labFee === 0, [o.labFee, l.labFee]);
  check("commission 80 + 800 = 880 total", o.doctorCommissionAmount === 80 && l.doctorCommissionAmount === 800, [o.doctorCommissionAmount, l.doctorCommissionAmount]);
  const bad = await pay({ patientId: pid, amount: 50, date: "05/10/2026" });
  check("a date in the wrong format falls back to today, not garbage", bad.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test((await row(bad.json.id)).date), (await row(bad.json.id)).date);
});

await scenario("P13", "Deleting a charge that has money on it is refused from both doors", async () => {
  const pid = await newPatient("Has Payments");
  const c = await charge({ patientId: pid, ...CONSULT, doctorId: DR_A });
  const p = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 200 });
  const viaLedger = await ledger({ action: "delete", id: c.json.ledgerId });
  check("ledger delete refused 409 HAS_PAYMENTS naming the payment", viaLedger.status === 409 && viaLedger.json.reason === "HAS_PAYMENTS" && viaLedger.json.blockingPaymentIds?.[0] === p.json.id, viaLedger.json);
  const viaClinical = await procAction({ action: "delete", noteId: c.json.noteId });
  check("clinical delete refused too", viaClinical.status === 409 && viaClinical.json.reason === "HAS_PAYMENTS", viaClinical.json);
  const unbill = await procAction({ action: "update", noteId: c.json.noteId, ...CONSULT, doctorId: DR_A, unitCost: 0 });
  check("re-pricing it to free (un-billing) is refused while paid", unbill.status === 409 && unbill.json.reason === "HAS_PAYMENTS", unbill.json);
  check("charge, note and payment all still there", (await exists("ledger", c.json.ledgerId)) && (await exists("clinical_notes", c.json.noteId)) && (await exists("ledger", p.json.id)));
  await ledger({ action: "delete", id: p.json.id });
  check("after deleting the payment the charge reads paid 0", (await row(c.json.ledgerId)).paid === 0);
  const now = await ledger({ action: "delete", id: c.json.ledgerId });
  check("now the charge deletes and takes its clinical note", now.status === 200 && !(await exists("ledger", c.json.ledgerId)) && !(await exists("clinical_notes", c.json.noteId)), now.json);
});

await scenario("P14", "Correcting a payment amount, and moving it", async () => {
  const pid = await newPatient("Edit Amount");
  const c = await charge({ patientId: pid, procedures: ["Root Canal"], selectedTeeth: ["16"], doctorId: DR_A, unitCost: 1000 });
  const p = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 500 });
  const up = await ledger({ action: "update", id: p.json.id, patch: { paid: 700, procedureId: c.json.ledgerId } });
  const pr = await row(p.json.id);
  check("500 corrected to 700", up.status === 200 && pr.paid === 700 && pr.amount === 700, pr);
  check("commission follows: 280", pr.doctorCommissionAmount === 280 && pr.clinicProfit === 420, pr);
  check("charge paid 700", (await row(c.json.ledgerId)).paid === 700);
  const over = await ledger({ action: "update", id: p.json.id, patch: { paid: 1200 } });
  check("raising it to 1200 on a 1000 charge refused", over.status === 409 && over.json.reason === "over_allocation", over.json);
  const zero = await ledger({ action: "update", id: p.json.id, patch: { paid: 0 } });
  const comma = await ledger({ action: "update", id: p.json.id, patch: { paid: "1,500" } });
  check("0 and \"1,500\" refused as bad amounts", zero.status === 400 && comma.status === 400, [zero.json, comma.json]);
  check("payment still 700", (await row(p.json.id)).paid === 700);
  // Moving it onto ANOTHER patient's charge must not be possible.
  const other = await newPatient("Someone Else");
  const oc = await charge({ patientId: other, ...CONSULT, doctorId: DR_B });
  const move = await ledger({ action: "update", id: p.json.id, patch: { procedureId: oc.json.ledgerId, paid: 200 } });
  check("moving to another patient's treatment refused", move.status === 400 && /same patient/.test(move.json.error ?? ""), move.json);
  // Unlinking it to on-account: the charge drops back and the payment pays no dentist.
  const unlink = await ledger({ action: "update", id: p.json.id, patch: { procedureId: null } });
  const u = await row(p.json.id);
  check("unlinked to on-account: charge paid 0, no dentist on the payment", unlink.status === 200 && (await row(c.json.ledgerId)).paid === 0 && u.doctorId === null && u.doctorCommissionAmount === 0 && u.clinicProfit === 700, u);
});

await scenario("P15", "Junk amounts are refused and write nothing", async () => {
  const pid = await newPatient("Junk Amounts");
  const c = await charge({ patientId: pid, ...FILLING, doctorId: DR_A });
  const junk: unknown[] = [-100, 0, "1,500", "١٥٠٠", "abc", null, "", "  "];
  for (const amount of junk) {
    const r = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount });
    check(`amount ${JSON.stringify(amount)} refused 400`, r.status === 400 && r.json.ok === false, r.json);
  }
  const tiny = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 0.001 });
  const zeroRows = (await paymentsOf(c.json.ledgerId)).filter((x) => Number(x.paid) === 0);
  check("a 0.001 payment does not leave a 0.00 receipt behind", zeroRows.length === 0, { status: tiny.status, json: tiny.json, zeroRows: zeroRows.map((z) => ({ paid: z.paid, receipt: z.receiptNumber })) });
  const noPatient = await pay({ amount: 100 });
  check("a payment with no patient refused", noPatient.status === 400, noPatient.json);
  check("the filling is still unpaid", (await row(c.json.ledgerId)).paid === 0);
  const s = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: "250" });
  check("a plain numeric string \"250\" is accepted as 250", s.status === 200 && (await row(s.json.id)).paid === 250, s.json);
});

await scenario("P16", "Thirds of 1000: rounding to 2 decimals adds up", async () => {
  const pid = await newPatient("Rounding");
  const c = await charge({ patientId: pid, procedures: ["Ortho Adjustment"], doctorId: DR_A, unitCost: 1000, pricingMode: "flat" });
  for (let i = 0; i < 3; i++) await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 333.333, date: `2026-10-0${i + 1}` });
  const pays = await paymentsOf(c.json.ledgerId);
  check("each third stored as 333.33", pays.length === 3 && pays.every((x) => x.paid === 333.33 && x.amount === 333.33), pays.map((x) => x.paid));
  check("commission stored to 2dp: 133.33", pays.every((x) => x.doctorCommissionAmount === 133.33), pays.map((x) => x.doctorCommissionAmount));
  check("charge paid 999.99", (await row(c.json.ledgerId)).paid === 999.99, (await row(c.json.ledgerId)).paid);
  const cent = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 0.01 });
  check("the last piastre 0.01 settles it to exactly 1000", cent.status === 200 && (await row(c.json.ledgerId)).paid === 1000, cent.json);
  const more = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 0.01 });
  check("one more piastre refused", more.status === 409, more.json);
});

await scenario("P17", "Manual clinic income and expense rows", async () => {
  const inc = await ledger({ action: "create-entry", type: "income", amount: 1000, description: "Implant course fee", date: "2026-10-04" });
  const exp = await ledger({ action: "create-entry", type: "expense", amount: 400, description: "Electricity", category: "Rent", date: "2026-10-04", isRecurring: true });
  const i = await row(inc.json.id);
  const e = await row(exp.json.id);
  check("income: paid 1000, cost 0, no patient, no commission", inc.status === 200 && i.paid === 1000 && i.cost === 0 && i.amount === 1000 && i.patientId === null, i);
  check("expense: cost 400, paid 0, recurring kept", exp.status === 200 && e.cost === 400 && e.paid === 0 && e.isRecurring === true && e.category === "Rent", e);
  const edit = await ledger({ action: "update", id: exp.json.id, patch: { amount: 450 } });
  const e2 = await row(exp.json.id);
  check("expense edited to 450: cost 450, amount 450, paid 0", edit.status === 200 && e2.cost === 450 && e2.amount === 450 && e2.paid === 0, e2);
  const neg = await ledger({ action: "create-entry", type: "expense", amount: -5, description: "x" });
  const kind = await ledger({ action: "create-entry", type: "refund", amount: 50, description: "x" });
  check("negative expense and unknown entry type refused", neg.status === 400 && kind.status === 400, [neg.json, kind.json]);
  const editNeg = await ledger({ action: "update", id: inc.json.id, patch: { amount: "abc" } });
  check("editing income to junk refused", editNeg.status === 400 && (await row(inc.json.id)).paid === 1000, editNeg.json);
  const recepEntry = await ledger({ action: "create-entry", type: "expense", amount: 50, description: "Tea and sugar" }, RECEP);
  check("reception with finance.add can log petty cash", recepEntry.status === 200, recepEntry.json);
});

// A clean clinic for the Finance page's month: one crown, one consultation, one course fee, rent.
let c3Rows: Json[] = [];
await scenario("P18", "Finance net = income − lab − expenses; commission NOT subtracted (decision B)", async () => {
  const pid = await newPatient("Finance Crown", C3);
  const pid2 = await newPatient("Finance Consult", C3);
  const crown = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, date: "2026-10-01" }, ADMIN, C3);
  await pay({ patientId: pid, procedureId: crown.json.ledgerId, amount: 1000, date: "2026-10-01" }, ADMIN, C3);
  await pay({ patientId: pid, procedureId: crown.json.ledgerId, amount: 2000, date: "2026-10-02" }, ADMIN, C3);
  const cons = await charge({ patientId: pid2, ...CONSULT, doctorId: DR_B, date: "2026-10-02" }, ADMIN, C3);
  await pay({ patientId: pid2, procedureId: cons.json.ledgerId, amount: 200, date: "2026-10-02" }, ADMIN, C3);
  await ledger({ action: "create-entry", type: "income", amount: 500, description: "Whitening kit sale", date: "2026-10-03" }, ADMIN, C3);
  await ledger({ action: "create-entry", type: "expense", amount: 1000, description: "Rent", category: "Rent", date: "2026-10-03" }, ADMIN, C3);
  c3Rows = (await col(C3, "ledger").get()).docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
  const t = summarizeLedger(c3Rows as never);
  check("income 3700 (1000 + 2000 + 200 + 500)", t.income === 3700, t);
  check("charged 3200, lab 800, expenses 1000", t.charged === 3200 && t.labFees === 800 && t.expenses === 1000, t);
  check("commissions reported: 80 + 800 (Dr Ahmed) + 60 (Dr Basma) = 940", t.commissions === 940, t.commissions);
  check("net = 3700 − 800 − 1000 = 1900 (commission not taken off)", t.net === 1900, t.net);
  check("rows in the books add up to the same lab fee the payments carry", near(c3Rows.filter((r) => r.type === "payment").reduce((s, r) => s + (Number(r.labFee) || 0), 0), 800));
});

await scenario("P19", "ledgerCashValue never double counts a charge's mirrored paid", async () => {
  const procs = c3Rows.filter((r) => r.type === "procedure");
  check("the charges mirror their paid totals (3000 and 200)", procs.map((p) => p.paid).sort((a, b) => a - b).join(",") === "200,3000", procs.map((p) => p.paid));
  const t = summarizeLedger(c3Rows as never);
  const naive = c3Rows.reduce((s, r) => s + (r.type === "expense" ? 0 : ledgerCashValue(r)), 0);
  check("summarizeLedger income 3700, not the 6900 a naive sum over every row gives", t.income === 3700 && naive === 6900, { income: t.income, naive });
  check("a legacy payment with amount:0 placeholder still counts its paid", ledgerCashValue({ type: "payment", amount: 0, paid: 500 }) === 500);
  check("a legacy expense with cost:0 placeholder counts its amount", ledgerCashValue({ type: "expense", cost: 0, amount: 300 }) === 300);
  check("an unpaid charge is 0 cash", ledgerCashValue({ type: "procedure", cost: 3000, amount: 3000, paid: 0 }) === 0);
  check("chargeAmount reads cost before a placeholder amount:0", chargeAmount({ cost: 1500, amount: 0 }) === 1500 && chargeAmount({ amount: 900 }) === 900);
});

await scenario("P20", "Lowering a fully-paid charge below what was paid is flagged, not refused (by design)", async () => {
  // Dr Basma decides the 1000 root canal should have been 600 after it was paid in full.
  const pid = await newPatient("Price Dropped");
  const c = await charge({ patientId: pid, procedures: ["Root Canal"], selectedTeeth: ["26"], doctorId: DR_B, unitCost: 1000 });
  await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 1000 });
  const up = await procAction({ action: "update", noteId: c.json.noteId, procedures: ["Root Canal"], selectedTeeth: ["26"], doctorId: DR_B, unitCost: 600 });
  const r = await row(c.json.ledgerId);
  check("the re-price is accepted", up.status === 200 && r.cost === 600, up.json);
  check("paid stays 1000 (no refund created)", r.paid === 1000, r.paid);
  check("overAllocation flags 400 for the screen", overAllocation(chargeAmount(r), r.paid) === 400);
  const more = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 1 });
  check("and no further money can be put on it", more.status === 409, more.json);
});

await scenario("P21", "Two receptionists take money for the same crown at the same moment", async () => {
  const pid = await newPatient("Race Patient");
  const c = await charge({ patientId: pid, procedures: ["Root Canal"], selectedTeeth: ["36"], doctorId: DR_A, unitCost: 1000 });
  const [a, b] = await Promise.all([
    pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 600 }),
    pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 600 }, RECEP),
  ]);
  const okCount = [a, b].filter((x) => x.status === 200).length;
  const refused = [a, b].filter((x) => x.status === 409 && x.json.reason === "over_allocation").length;
  check("exactly one 600 lands, the other is refused", okCount === 1 && refused === 1, [a, b]);
  check("charge paid 600, one payment row", (await row(c.json.ledgerId)).paid === 600 && (await paymentsOf(c.json.ledgerId)).length === 1);
  const [x, y] = await Promise.all([
    pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 200, date: "2026-10-06" }),
    pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 200, date: "2026-10-06" }, RECEP),
  ]);
  check("two 200s that both fit both land", x.status === 200 && y.status === 200, [x.json, y.json]);
  check("charge paid 1000", (await row(c.json.ledgerId)).paid === 1000);
  const receipts = (await paymentsOf(c.json.ledgerId)).map((p) => p.receiptNumber);
  check("every receipt number is unique", new Set(receipts).size === receipts.length, receipts);
});

await scenario("P22", "Money cannot cross clinics or patients", async () => {
  const foreign = await newPatient("Other clinic patient", C2);
  const foreignCharge = await charge({ patientId: foreign, ...CONSULT, doctorId: DR_A }, OTHER_ADMIN, C2);
  // (a) C1's admin names clinic C2.
  const a = await pay({ patientId: foreign, procedureId: foreignCharge.json.ledgerId, amount: 200 }, ADMIN, C2);
  check("(a) C1 admin posting into clinic C2 is refused 403", a.status === 403, a.json);
  check("(a) C2's charge untouched", (await row(foreignCharge.json.ledgerId, C2)).paid === 0);
  // (b) C1's admin posts in C1 with C2's patient id.
  const b = await pay({ patientId: foreign, amount: 200 }, ADMIN, C1);
  check("(b) a payment for a patient who is not in this clinic is refused", b.status >= 400, { status: b.status, json: b.json, stored: b.json.id ? await row(b.json.id) : null });
  // (c) Patient A's money pointed at patient B's treatment, same clinic.
  const pa = await newPatient("Patient A (payer)");
  const pb = await newPatient("Patient B (owner of the charge)");
  const bCharge = await charge({ patientId: pb, ...CONSULT, doctorId: DR_A });
  const c = await pay({ patientId: pa, procedureId: bCharge.json.ledgerId, amount: 200 });
  check("(c) A's payment cannot settle B's treatment", c.status >= 400, { status: c.status, json: c.json, bPaid: (await row(bCharge.json.ledgerId)).paid });
});

await scenario("P23", "Changing the treatment's dentist re-stamps its payments", async () => {
  // Typed under Dr Ahmed by mistake; Dr Basma actually did the filling after 300 was paid.
  const pid = await newPatient("Wrong Dentist");
  const c = await charge({ patientId: pid, ...FILLING, doctorId: DR_A });
  const p = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 300 });
  check("payment first credited to Dr Ahmed at 40% (120)", (await row(p.json.id)).doctorId === DR_A && (await row(p.json.id)).doctorCommissionAmount === 120);
  const up = await procAction({ action: "update", noteId: c.json.noteId, ...FILLING, doctorId: DR_B });
  const pr = await row(p.json.id);
  check("treatment saved under Dr Basma", up.status === 200 && (await row(c.json.ledgerId)).doctorId === DR_B, up.json);
  check("the payment now names Dr Basma", pr.doctorId === DR_B && pr.doctorName === "Dr Basma Adel" && pr.doctor === "Dr Basma Adel", pr);
  check("and pays her 30% (90), not his 40%", pr.doctorCommissionPercentage === 30 && pr.doctorCommissionAmount === 90 && pr.clinicProfit === 210, pr);
  check("charge still reads paid 300", (await row(c.json.ledgerId)).paid === 300);
  const later = await pay({ patientId: pid, procedureId: c.json.ledgerId, amount: 200 });
  check("the next payment is Dr Basma's too", (await row(later.json.id)).doctorId === DR_B && (await row(later.json.id)).doctorCommissionAmount === 60);
});

await scenario("P24", "Editing the DATE of a discounted treatment keeps its discount", async () => {
  // Rania's crown was charged 2700 after a 10% Promotion from the treatment screen. A week later
  // reception fixes only the date on the patient's Finance tab (PatientFinance.tsx handleUpdate).
  const pid = await newPatient("Discount Then Date");
  const c = await charge({ patientId: pid, ...CROWN, doctorId: DR_A, discountMode: "percent", discountValue: 10, discountReason: "Promotion" });
  const before = await row(c.json.ledgerId);
  // Exactly the patch PatientFinance builds from the stored row.
  const patch = {
    date: "2026-10-07",
    description: before.description,
    listPrice: Number(before.listPrice) || Number(before.cost) || 0,
    discountMode: before.discountMode || "none",
    discountPercent: before.discountPercent ?? null,
    discountFixed: before.discountFixed ?? null,
    discountReason: before.discountReason || null,
  };
  const up = await ledger({ action: "update", id: c.json.ledgerId, patch }, RECEP);
  const after = await row(c.json.ledgerId);
  check("the date edit saves", up.status === 200 && after.date === "2026-10-07", up.json);
  check("the charge is still 2700 (10% off), not back to 3000", after.cost === 2700 && after.amount === 2700, { cost: after.cost, discountAmount: after.discountAmount, discountReason: after.discountReason });
  check("…its reason and dentist's share untouched", after.discountReason === "Promotion" && after.doctorCommissionAmount === before.doctorCommissionAmount, { reason: after.discountReason, share: after.doctorCommissionAmount, was: before.doctorCommissionAmount });
  // A real change from the same dialog still re-prices, and the clinical note follows it.
  const grow = await ledger({ action: "update", id: c.json.ledgerId, patch: { ...patch, discountPercent: 15 } }, ADMIN);
  const grown = await row(c.json.ledgerId);
  const note = ((await col(C1, "clinical_notes").doc(String(grown.clinicalNoteId)).get()).data() ?? {}) as Json;
  check("raising it to 15% charges 2550", grow.status === 200 && grown.cost === 2550 && grown.discountAmount === 450, { status: grow.status, json: grow.json, cost: grown.cost });
  check("…and the clinical note carries 2550 / 15%, so its next save keeps it", note.cost === 2550 && note.discountValue === 15 && note.discountMode === "percent", { cost: note.cost, value: note.discountValue, mode: note.discountMode });
  // Same through the bare API: only the date.
  const c2 = await charge({ patientId: pid, ...FILLING, doctorId: DR_A, discountMode: "fixed", discountValue: 100, discountReason: "Promotion" });
  await ledger({ action: "update", id: c2.json.ledgerId, patch: { date: "2026-10-07" } });
  const f = await row(c2.json.ledgerId);
  check("a date-only patch keeps a fixed 100 off (cost 400)", f.cost === 400, { cost: f.cost, discountAmount: f.discountAmount });
});

await scenario("P25", "Gates: expired clinic, and no rights escalation by leaving the clinic out", async () => {
  const xp = await newPatient("Expired clinic patient", CX);
  const named = await pay({ patientId: xp, amount: 100 }, EXPIRED_ADMIN, CX);
  check("an expired clinic cannot take money (403 clinic_inactive)", named.status === 403, named.json);
  const unnamed = await pay({ patientId: xp, amount: 100 }, EXPIRED_ADMIN, null);
  const xRows = (await col(CX, "ledger").get()).size;
  check("…not even when the request leaves clinicId out", unnamed.status === 403 && xRows === 0, { status: unnamed.status, json: unnamed.json, rowsWritten: xRows });

  const cp = await newPatient("Cross-user patient");
  const withId = await pay({ patientId: cp, amount: 100 }, CROSS, C1);
  check("an Assistant with no finance rights in C1 is refused when naming C1", withId.status === 403, withId.json);
  const withoutId = await pay({ patientId: cp, amount: 100 }, CROSS, null);
  const landed = (await rowsOfPatient(cp)).length;
  check("…and is still refused when clinicId is left out (Admin of C2 must not be Admin of C1)", withoutId.status === 403 && landed === 0, { status: withoutId.status, json: withoutId.json, rowsInC1: landed });
});

// ===================================================================================================

await wipe();
authServer.close();

console.log("\n--- scenario summary ---");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.title}`);
console.log(`\npayments scenarios: ${results.filter((r) => r.ok).length}/${results.length} scenarios clean; checks ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
