/**
 * Clinic workflow scenarios D51–D75: the dentist's percentage (commission) and staff settlements,
 * end to end against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/scenarios/commission.test.mts
 *
 * Real route handlers (clinical procedures, finance ledger, staff settlements, insurance claims),
 * nothing mocked but the login check: a tiny server answers the one Auth-emulator lookup
 * verifyIdToken makes. Every scenario checks the API answer AND the stored rows, in exact EGP.
 *
 * Owner's rules under test: rate order = dentist's own company rate → dentist's list rate →
 * company dentistRate → usual %; absent = usual, explicit 0 = 0; commission on the NET after
 * discount, lab fee out first and spread earliest-first; rate read live at each payment; insurance
 * counts by TREATED date; settlements poured oldest-first; payout = Salary expense (locked on the
 * ledger route); deduction writes nothing; owed can go negative; stamps after every settlement write.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { SAMPLE_RAW } from "../fixtures/insuranceMetlife.fixture";

const PROJECT = "demo-scn-commission";
const CLINIC = "SC1";
const OTHER = "SC2";

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
const proceduresRoute = await import("../../src/app/api/clinical/procedures/route");
const ledgerRoute = await import("../../src/app/api/finance/ledger/route");
const settleRoute = await import("../../src/app/api/staff/settlements/route");
const claimsRoute = await import("../../src/app/api/insurance/claims/route");
const { commissionByStaff, NO_COMMISSION } = await import("../../src/lib/staffCommission");
const { insuranceWorkByStaff, NO_INSURANCE_WORK } = await import("../../src/lib/staffInsurance");
const { parseClaim } = await import("../../src/lib/insurance/claims");
const { parseSettlement, settleEarnings } = await import("../../src/lib/staffSettlement");
const { summarizeLedger } = await import("../../src/lib/reports/ledgerStats");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);

let passed = 0;
let failed = 0;
const failures: string[] = [];
let current = "";
function scenario(name: string) {
  current = name.split(" ")[0];
  console.log(`\n${name}`);
}
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    const d = detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : "";
    console.log(`  FAIL  ${label}${d}`);
    failures.push(`${current}: ${label}${d}`);
    failed += 1;
  }
}
const eq = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.001;

type Json = Record<string, any>;
let as = idToken("adm");
async function call(handler: (r: Request) => Promise<Response>, method: "POST" | "PATCH", path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const prev = as;
  as = idToken(uid);
  try {
    return await fn();
  } finally {
    as = prev;
  }
}

// --- API helpers -----------------------------------------------------------------------------------
type TxArgs = {
  patientId: string;
  doctorId?: string | null;
  procedures?: string[];
  unitCost?: number;
  discountMode?: string;
  discountValue?: number;
  discountReason?: string;
  payerId?: string;
  priceListId?: string;
  date?: string;
  appointmentId?: string;
};
function txBody(a: TxArgs) {
  return {
    clinicId: CLINIC,
    patientId: a.patientId,
    doctorId: a.doctorId ?? "",
    procedures: a.procedures ?? ["Filling"],
    selectedTeeth: [],
    pricingMode: "flat",
    status: "Completed",
    date: a.date ?? "2026-09-01",
    ...(a.unitCost !== undefined ? { unitCost: a.unitCost } : {}),
    ...(a.discountMode ? { discountMode: a.discountMode, discountValue: a.discountValue, discountReason: a.discountReason ?? "Promotion" } : {}),
    ...(a.payerId ? { payerId: a.payerId } : {}),
    ...(a.priceListId ? { priceListId: a.priceListId } : {}),
    ...(a.appointmentId ? { appointmentId: a.appointmentId } : {}),
  };
}
async function treat(a: TxArgs): Promise<{ ledgerId: string; noteId: string; res: { status: number; json: Json } }> {
  const res = await call(proceduresRoute.POST, "POST", "/api/clinical/procedures", { action: "create", ...txBody(a) });
  return { ledgerId: res.json.ledgerId, noteId: res.json.noteId, res };
}
async function pay(patientId: string, procedureId: string, amount: number, date: string) {
  const res = await call(ledgerRoute.POST, "POST", "/api/finance/ledger", { action: "create-payment", clinicId: CLINIC, patientId, procedureId, amount, date, method: "Cash" });
  return { id: res.json.id as string, res };
}
const ledgerAction = (body: Json) => call(ledgerRoute.POST, "POST", "/api/finance/ledger", { clinicId: CLINIC, ...body });
const settle = (body: Json) => call(settleRoute.POST, "POST", "/api/staff/settlements", { clinicId: CLINIC, ...body });
const payout = (staffId: string, amount: number, date: string, extra: Json = {}) => settle({ action: "create", staffId, kind: "payout", amount, date, ...extra });
const deduction = (staffId: string, amount: number, date: string, note = "") => settle({ action: "create", staffId, kind: "deduction", amount, date, note });

const row = async (id: string) => (await col("ledger").doc(id).get()).data() ?? {};
const exists = async (c: string, id: string) => (await col(c).doc(id).get()).exists;

/** The Team page's figures for one dentist, built exactly the way team/page.tsx and the sync build them. */
async function teamView(staffId: string) {
  const [ledgerSnap, claimsSnap, settleSnap, staffSnap] = await Promise.all([
    col("ledger").where("doctorId", "==", staffId).get(),
    col("insurance_claims").where("status", "in", ["treated", "sent"]).get(),
    col("staff_settlements").where("staffId", "==", staffId).get(),
    col("staff").doc(staffId).get(),
  ]);
  const ledger = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const claims = claimsSnap.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is NonNullable<typeof c> => c !== null);
  const settlements = settleSnap.docs.map((d) => parseSettlement(d.id, d.data())).filter((s): s is NonNullable<typeof s> => s !== null);
  const staff = [{ id: staffId, name: String(staffSnap.get("name") ?? "") }];
  const insuranceRowIds = new Set(claims.flatMap((c) => Object.values(c.ledgerIds).map((l) => l.ledgerId)));
  const priv = commissionByStaff(ledger, staff, insuranceRowIds).get(staffId) ?? NO_COMMISSION;
  const ins = insuranceWorkByStaff(claims).get(staffId) ?? NO_INSURANCE_WORK;
  const earnings = [
    ...priv.entries.map((e) => ({ key: e.id, date: e.date, amount: e.amount })),
    ...ins.entries.map((e) => ({ key: `${e.claimId}#${e.lineIndex}`, date: e.date, amount: e.share })),
  ];
  const r = settleEarnings(earnings, settlements);
  return { ...r, privateTotal: priv.total, insuranceTotal: ins.total };
}

// --- clinic ---------------------------------------------------------------------------------------
async function wipe() {
  for (const d of (await db.collection("deleted_records").where("clinicId", "in", [CLINIC, OTHER]).get()).docs) await db.recursiveDelete(d.ref);
  await db.recursiveDelete(clinic);
  await db.recursiveDelete(db.collection("clinics").doc(OTHER));
  for (const u of ["adm", "own", "desk", "multi"]) await db.recursiveDelete(db.collection("users").doc(u));
}
await wipe();

const ACTIVE = { status: "Active", subscriptionTier: "Premium", features: { insurance: true } };
await clinic.set({ name: "Commission Scenarios", ...ACTIVE });
await db.collection("clinics").doc(OTHER).set({ name: "Sister Clinic", ...ACTIVE });

const DESK_PERMS = ["finance.add", "finance.edit", "finance.delete", "finance.view", "clinical.edit", "patients.edit"];
await db.collection("users").doc("adm").set({ name: "Admin Hala", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc("own").set({ name: "Owner Karim", clinicRoles: { [CLINIC]: "Owner" } });
await db.collection("users").doc("desk").set({ name: "Desk Mona", role: "Assistant", clinicRoles: { [CLINIC]: "Assistant" }, clinicPermissions: { [CLINIC]: DESK_PERMS }, permissions: DESK_PERMS });
// Receptionist here, admin of the sister clinic, and this clinic is her default.
await db.collection("users").doc("multi").set({ name: "Multi Rana", role: "Assistant", defaultClinicId: CLINIC, clinicRoles: { [CLINIC]: "Assistant", [OTHER]: "Admin" }, clinicPermissions: { [CLINIC]: ["finance.view"] }, permissions: ["finance.view"] });

await col("settings").doc("payers").set({
  payers: [
    { id: "private", name: "Private", isDefault: true, active: true },
    { id: "axa", name: "AXA", priceListId: "axa-list", dentistRate: 25, active: true },
    { id: "misr", name: "Misr Insurance", priceListId: "misr-list", active: true },
    { id: "metlife", name: "MetLife", format: "metlife", providerCode: "DNC0001", active: true },
  ],
});
await col("settings").doc("price_lists").set({
  lists: [
    { id: "standard", name: "Standard", isDefault: true, active: true },
    { id: "axa-list", name: "AXA tariff", active: true },
    { id: "misr-list", name: "Misr tariff", active: true },
    { id: "vip-list", name: "VIP", active: true },
  ],
});
await col("services").doc("svc-filling").set({ name: "Filling", price: 1000, pricingMode: "flat" });
await col("services").doc("svc-crown").set({ name: "Crown", price: 1000, pricingMode: "flat", requiresLab: true, estimatedLabFee: 300 });
await col("services").doc("svc-scaling").set({ name: "Scaling", price: 500, pricingMode: "flat" });

const STAFF: Record<string, Json> = {
  dA: { name: "Dr Amr", role: "Dentist", commissionPercentage: 40 },
  dB: { name: "Dr Basma", role: "Dentist", commissionPercentage: 30 },
  dP: { name: "Dr Payer", role: "Dentist", commissionPercentage: 40, commissionByPayer: { axa: 30 } },
  dL: { name: "Dr List", role: "Dentist", commissionPercentage: 40, commissionByList: { "axa-list": 35, "vip-list": 50 } },
  dPL: { name: "Dr Both", role: "Dentist", commissionPercentage: 40, commissionByPayer: { axa: 30 }, commissionByList: { "axa-list": 35 } },
  dC: { name: "Dr Company", role: "Dentist", commissionPercentage: 40 },
  dZ: { name: "Dr Zero", role: "Dentist", commissionPercentage: 40, commissionByPayer: { misr: 0 } },
  dR: { name: "Dr Rate", role: "Dentist", commissionPercentage: 40 },
  dX: { name: "Dr Xavier", role: "Dentist", commissionPercentage: 40 },
  dY: { name: "Dr Yasmin", role: "Dentist", commissionPercentage: 30 },
  dS1: { name: "Dr Settle", role: "Dentist", commissionPercentage: 40 },
  dS2: { name: "Dr Ahead", role: "Dentist", commissionPercentage: 40 },
  dS3: { name: "Dr Late", role: "Dentist", commissionPercentage: 40 },
  dI: { name: "Dr Insured", role: "Dentist", commissionPercentage: 40, commissionByPayer: { metlife: 20 } },
  dN: { name: "Dr Nopct", role: "Dentist" },
  dK: { name: "Dr Lab", role: "Dentist", commissionPercentage: 40 },
  dT: { name: "Dr Thirds", role: "Dentist", commissionPercentage: 35 },
  dF: { name: "Dr Finance", role: "Dentist", commissionPercentage: 40 },
  dM: { name: "Dr Manual", role: "Dentist", commissionPercentage: 40 },
};
for (const [id, data] of Object.entries(STAFF)) await col("staff").doc(id).set(data);
for (let i = 51; i <= 75; i += 1) await col("patients").doc(`P${i}`).set({ name: i === 67 ? "EXAMPLE PATIENT NAME" : `Patient ${i}`, phone: `+2010000000${i}` });
await col("patients").doc("P55b").set({ name: "Patient 55b" });
await col("patients").doc("P55c").set({ name: "Patient 55c" });
await col("patients").doc("P55d").set({ name: "Patient 55d" });
await col("patients").doc("P56b").set({ name: "Patient 56b" });
await col("patients").doc("P54b").set({ name: "Patient 54b" });

// ===================================================================================================
scenario("D51 Dr Amr (40%) does a 1,000 filling; the patient pays 600 now and 400 two weeks later");
{
  const t = await treat({ patientId: "P51", doctorId: "dA", date: "2026-09-01" });
  check("treatment saved", t.res.status === 200 && !!t.ledgerId, t.res.json);
  const proc = await row(t.ledgerId);
  check("charge 1,000 at 40% → 400 owed on the charge", eq(proc.cost, 1000) && eq(proc.doctorCommissionPercentage, 40) && eq(proc.doctorCommissionAmount, 400), proc);
  const p1 = await pay("P51", t.ledgerId, 600, "2026-09-02");
  const p2 = await pay("P51", t.ledgerId, 400, "2026-09-15");
  check("both payments accepted", p1.res.status === 200 && p2.res.status === 200, [p1.res.json, p2.res.json]);
  const r1 = await row(p1.id);
  const r2 = await row(p2.id);
  check("600 instalment earns 240", eq(r1.doctorCommissionAmount, 240) && eq(r1.doctorCommissionPercentage, 40) && r1.doctorId === "dA", r1);
  check("400 instalment earns 160", eq(r2.doctorCommissionAmount, 160) && r2.doctorId === "dA", r2);
  check("clinic keeps 360 + 240", eq(r1.clinicProfit, 360) && eq(r2.clinicProfit, 240), [r1.clinicProfit, r2.clinicProfit]);
  check("charge shows 1,000 paid", eq((await row(t.ledgerId)).paid, 1000));
  const extra = await pay("P51", t.ledgerId, 1, "2026-09-16");
  check("a 1 EGP over-payment is refused (no extra commission)", extra.res.status === 409 && extra.res.json.reason, extra.res.json);
  const view = await teamView("dA");
  check("Dr Amr has earned 400 on this case", eq(view.privateTotal, 400), view.privateTotal);
}

// ===================================================================================================
scenario("D52 Admin gives 20% off a 1,000 filling (Dr Amr 40%) → commission is on the 800 actually charged");
{
  const t = await treat({ patientId: "P52", doctorId: "dA", discountMode: "percent", discountValue: 20, discountReason: "Promotion", date: "2026-09-02" });
  const proc = await row(t.ledgerId);
  check("charge is 800 after a 200 discount", t.res.status === 200 && eq(proc.cost, 800) && eq(proc.listPrice, 1000) && eq(proc.discountAmount, 200), proc);
  check("commission on the charge is 320, not 400", eq(proc.doctorCommissionAmount, 320), proc.doctorCommissionAmount);
  const p = await pay("P52", t.ledgerId, 800, "2026-09-03");
  const pr = await row(p.id);
  check("the 800 payment earns 320", eq(pr.doctorCommissionAmount, 320), pr);
  const over = await pay("P52", t.ledgerId, 200, "2026-09-03");
  check("paying the old list price (200 more) is refused", over.res.status === 409, over.res.json);

  // The receptionist corrects only the DATE of the discounted charge on the finance screen.
  const upd = await ledgerAction({ action: "update", id: t.ledgerId, patch: { date: "2026-09-04" } });
  const after = await row(t.ledgerId);
  check("date edit accepted", upd.status === 200, upd.json);
  check("a date-only edit keeps the 800 charge (discount not lost)", eq(after.cost, 800) && eq(after.amount, 800), { cost: after.cost, amount: after.amount, discountAmount: after.discountAmount });
  check("…and the dentist's share on the charge stays 320", eq(after.doctorCommissionAmount, 320), after.doctorCommissionAmount);

  const tf = await treat({ patientId: "P52", doctorId: "dA", discountMode: "fixed", discountValue: 150, discountReason: "Family & friends", date: "2026-09-05" });
  const pf = await row(tf.ledgerId);
  check("a fixed 150 off → 850 charged, 340 commission", eq(pf.cost, 850) && eq(pf.doctorCommissionAmount, 340), pf);
  // The exact patch PatientFinance.tsx sends when the edit dialog is saved with only the date changed:
  // it opens on the raw row, which (written by the clinical route) has discountValue, not discountFixed.
  const ui = await ledgerAction({
    action: "update", id: tf.ledgerId,
    patch: { date: "2026-09-06", description: pf.description, listPrice: pf.listPrice, discountMode: pf.discountMode, discountPercent: pf.discountPercent ?? null, discountFixed: pf.discountFixed ?? null, discountReason: pf.discountReason },
  });
  const pfAfter = await row(tf.ledgerId);
  check("saving the Finance edit dialog with only a new date keeps 850 / 340", ui.status === 200 && eq(pfAfter.cost, 850) && eq(pfAfter.doctorCommissionAmount, 340), { status: ui.status, cost: pfAfter.cost, share: pfAfter.doctorCommissionAmount, discountAmount: pfAfter.discountAmount });
}

// ===================================================================================================
scenario("D53 Crown 1,000 with a 300 lab fee (Dr Amr 40%): patient pays 200, then 800");
{
  const t = await treat({ patientId: "P53", doctorId: "dA", procedures: ["Crown"], date: "2026-10-01" });
  const proc = await row(t.ledgerId);
  check("charge 1,000, lab 300, share 280 (40% of 700)", eq(proc.cost, 1000) && eq(proc.labFee, 300) && eq(proc.doctorCommissionAmount, 280) && eq(proc.clinicProfit, 420), proc);
  const p1 = await pay("P53", t.ledgerId, 200, "2026-10-01");
  let r1 = await row(p1.id);
  // By design (labFeeShares): a fee no payment has absorbed yet sits whole on the earliest row.
  check("first 200 earns 0; until more money comes the whole 300 lab sits on it (clinic −100)", eq(r1.labFee, 300) && eq(r1.doctorCommissionAmount, 0) && eq(r1.clinicProfit, -100), { lab: r1.labFee, c: r1.doctorCommissionAmount, p: r1.clinicProfit });
  const p2 = await pay("P53", t.ledgerId, 800, "2026-10-05");
  r1 = await row(p1.id);
  const r2 = await row(p2.id);
  check("second 800 carries the remaining 100 of lab", eq(r2.labFee, 100) && eq(r1.labFee, 200), [r1.labFee, r2.labFee]);
  check("second 800 earns 280 (40% of 700)", eq(r2.doctorCommissionAmount, 280) && eq(r2.clinicProfit, 420), r2);
  check("total commission 280, lab paid exactly once (300)", eq(Number(r1.doctorCommissionAmount) + Number(r2.doctorCommissionAmount), 280) && eq(Number(r1.labFee) + Number(r2.labFee), 300));
}

// ===================================================================================================
scenario("D54 AXA patient: Dr Payer earns 40% usually, 30% for AXA; AXA's own dentist rate is 25%");
{
  const t = await treat({ patientId: "P54", doctorId: "dP", payerId: "axa", date: "2026-09-10" });
  const proc = await row(t.ledgerId);
  check("charged to AXA on AXA's list", t.res.status === 200 && proc.payerId === "axa" && proc.priceListId === "axa-list", { payerId: proc.payerId, list: proc.priceListId });
  check("charge stamped at the dentist's own AXA rate 30% → 300", eq(proc.doctorCommissionPercentage, 30) && eq(proc.doctorCommissionAmount, 300), proc);
  const p = await pay("P54", t.ledgerId, 1000, "2026-09-11");
  const pr = await row(p.id);
  check("payment earns 300 at 30% and names AXA", eq(pr.doctorCommissionAmount, 300) && eq(pr.doctorCommissionPercentage, 30) && pr.payerId === "axa", pr);
  const tp = await treat({ patientId: "P54b", doctorId: "dP", date: "2026-09-10" });
  const pp = await pay("P54b", tp.ledgerId, 1000, "2026-09-11");
  check("same dentist on private work earns the usual 40% → 400", eq((await row(pp.id)).doctorCommissionAmount, 400));
}

// ===================================================================================================
scenario("D55 Which rate wins: dentist's company rate → dentist's list rate → company rate → usual");
{
  const a = await treat({ patientId: "P55", doctorId: "dL", payerId: "axa", date: "2026-09-12" });
  const pa = await pay("P55", a.ledgerId, 1000, "2026-09-12");
  check("Dr List on AXA (list 35%, company 25%) → 35% = 350", eq((await row(pa.id)).doctorCommissionAmount, 350) && eq((await row(pa.id)).doctorCommissionPercentage, 35), await row(pa.id));
  const b = await treat({ patientId: "P55b", doctorId: "dC", payerId: "axa", date: "2026-09-12" });
  const pb = await pay("P55b", b.ledgerId, 1000, "2026-09-12");
  check("Dr Company (no own rates) on AXA → company 25% = 250", eq((await row(pb.id)).doctorCommissionAmount, 250), await row(pb.id));
  const c = await treat({ patientId: "P55c", doctorId: "dL", priceListId: "vip-list", date: "2026-09-12" });
  const cProc = await row(c.ledgerId);
  const pc = await pay("P55c", c.ledgerId, 1000, "2026-09-12");
  check("Dr List on the VIP list (private) → list rate 50% = 500", cProc.payerId === "private" && eq((await row(pc.id)).doctorCommissionAmount, 500), { payer: cProc.payerId, pay: (await row(pc.id)).doctorCommissionAmount });
  const d = await treat({ patientId: "P55d", doctorId: "dPL", payerId: "axa", date: "2026-09-12" });
  const pd = await pay("P55d", d.ledgerId, 1000, "2026-09-12");
  check("Dr Both (AXA 30%, AXA-list 35%) → own company rate wins: 300", eq((await row(pd.id)).doctorCommissionAmount, 300), await row(pd.id));
}

// ===================================================================================================
scenario("D56 Dr Zero is set to an explicit 0% for Misr Insurance; Dr Amr has no Misr entry");
{
  const z = await treat({ patientId: "P56", doctorId: "dZ", payerId: "misr", date: "2026-09-14" });
  const pz = await pay("P56", z.ledgerId, 1000, "2026-09-14");
  const rz = await row(pz.id);
  check("Misr work earns Dr Zero exactly 0 (pct 0)", eq(rz.doctorCommissionAmount, 0) && rz.doctorCommissionPercentage === 0 && eq(rz.clinicProfit, 1000), rz);
  const a = await treat({ patientId: "P56b", doctorId: "dA", payerId: "misr", date: "2026-09-14" });
  const pa = await pay("P56b", a.ledgerId, 1000, "2026-09-14");
  check("absent entry = usual rate: Dr Amr earns 40% = 400 on Misr", eq((await row(pa.id)).doctorCommissionAmount, 400));
  const view = await teamView("dZ");
  check("Dr Zero's Team page shows nothing earned / owed", eq(view.earned, 0) && eq(view.owed, 0), view);
}

// ===================================================================================================
scenario("D57 Dr Rate is on 40%; after the first 500 instalment the owner raises her to 50%");
{
  const t = await treat({ patientId: "P57", doctorId: "dR", date: "2026-09-01" });
  const p1 = await pay("P57", t.ledgerId, 500, "2026-09-02");
  check("first instalment earns 200 at 40%", eq((await row(p1.id)).doctorCommissionAmount, 200));
  await col("staff").doc("dR").update({ commissionPercentage: 50 });
  const p2 = await pay("P57", t.ledgerId, 500, "2026-09-20");
  const r2 = await row(p2.id);
  check("second instalment earns 250 at the new 50%", eq(r2.doctorCommissionAmount, 250) && eq(r2.doctorCommissionPercentage, 50), r2);
  const r1 = await row(p1.id);
  // OWNER DECISION PENDING (2026-10-08): today a rate change re-prices every instalment of the
  // treatment on the next payment (ledgerSync reads the live rate for all of them). These two
  // checks pin TODAY's behaviour; if the owner says "only new payments", flip them to 200 @ 40%
  // and 450.
  check("CURRENT RULE: the earlier instalment is re-priced to 250 at 50% on the next payment", eq(r1.doctorCommissionAmount, 250) && eq(r1.doctorCommissionPercentage, 50), { pct: r1.doctorCommissionPercentage, amount: r1.doctorCommissionAmount });
  const view = await teamView("dR");
  check("CURRENT RULE: Dr Rate's total on the case is 500", eq(view.privateTotal, 500), view.privateTotal);
}

// ===================================================================================================
scenario("D58 Dr Xavier (40%) starts a 1,000 case, is paid for it, then the case is reassigned to Dr Yasmin (30%)");
{
  const t = await treat({ patientId: "P58", doctorId: "dX", date: "2026-09-01" });
  const p1 = await pay("P58", t.ledgerId, 400, "2026-09-02");
  check("first 400 earns Dr Xavier 160", eq((await row(p1.id)).doctorCommissionAmount, 160) && (await row(p1.id)).doctorId === "dX");
  const po = await payout("dX", 160, "2026-09-05");
  check("owner pays Dr Xavier 160", po.status === 200, po.json);
  check("the payment is stamped 160 paid", eq((await row(p1.id)).doctorCommissionPaid, 160));
  const upd = await call(proceduresRoute.POST, "POST", "/api/clinical/procedures", { action: "update", noteId: t.noteId, ...txBody({ patientId: "P58", doctorId: "dY", date: "2026-09-01" }) });
  check("treatment re-saved under Dr Yasmin", upd.status === 200, upd.json);
  const r1 = await row(p1.id);
  check("by the owner's rule the earlier receipt now names Dr Yasmin at 30% → 120", r1.doctorId === "dY" && eq(r1.doctorCommissionAmount, 120), { doctorId: r1.doctorId, amount: r1.doctorCommissionAmount });
  check("the moved receipt is no longer stamped 'paid 160' (that cash went to Dr Xavier, not Dr Yasmin)", eq(r1.doctorCommissionPaid ?? 0, 0), { doctorCommissionPaid: r1.doctorCommissionPaid });
  const p2 = await pay("P58", t.ledgerId, 600, "2026-09-10");
  check("the rest (600) earns Dr Yasmin 180", eq((await row(p2.id)).doctorCommissionAmount, 180));
  const vx = await teamView("dX");
  const vy = await teamView("dY");
  check("Dr Xavier: earned 0, paid 160 → owed −160 (paid ahead)", eq(vx.earned, 0) && eq(vx.owed, -160), { earned: vx.earned, owed: vx.owed });
  check("Dr Yasmin: earned 300, owed 300", eq(vy.earned, 300) && eq(vy.owed, 300), { earned: vy.earned, owed: vy.owed });
}

// ===================================================================================================
scenario("D59 One visit, two dentists: Dr Amr's filling (40%) and Dr Basma's scaling (30%)");
{
  await col("appointments").doc("A59").set({ patientId: "P59", date: "2026-09-20", time: "18:00" });
  const f = await treat({ patientId: "P59", doctorId: "dA", procedures: ["Filling"], appointmentId: "A59", date: "2026-09-20" });
  const s = await treat({ patientId: "P59", doctorId: "dB", procedures: ["Scaling"], appointmentId: "A59", date: "2026-09-20" });
  const appt = (await col("appointments").doc("A59").get()).data() ?? {};
  check("the visit lists both treatments, 1,500 total", Array.isArray(appt.services) && appt.services.length === 2 && eq(appt.cost, 1500), appt);
  const pf = await pay("P59", f.ledgerId, 1000, "2026-09-20");
  const ps = await pay("P59", s.ledgerId, 500, "2026-09-20");
  const rf = await row(pf.id);
  const rs = await row(ps.id);
  check("filling payment → Dr Amr 400", rf.doctorId === "dA" && eq(rf.doctorCommissionAmount, 400), rf);
  check("scaling payment → Dr Basma 150", rs.doctorId === "dB" && eq(rs.doctorCommissionAmount, 150), rs);
}

// ===================================================================================================
let S1: { p1: string; p2: string; p3: string; payoutId: string; ledgerId: string } = { p1: "", p2: "", p3: "", payoutId: "", ledgerId: "" };
scenario("D60 Dr Settle earned 200, 300 and 400 in September; the owner pays her 500 on 1 Oct");
{
  const ids: string[] = [];
  for (const [cost, date] of [[500, "2026-09-01"], [750, "2026-09-10"], [1000, "2026-09-20"]] as const) {
    const t = await treat({ patientId: "P60", doctorId: "dS1", unitCost: cost, date });
    ids.push((await pay("P60", t.ledgerId, cost, date)).id);
  }
  S1 = { ...S1, p1: ids[0], p2: ids[1], p3: ids[2] };
  check("commissions 200 / 300 / 400", eq((await row(ids[0])).doctorCommissionAmount, 200) && eq((await row(ids[1])).doctorCommissionAmount, 300) && eq((await row(ids[2])).doctorCommissionAmount, 400));
  const po = await payout("dS1", 500, "2026-10-01", { note: "September" });
  check("payout saved with a ledger id", po.status === 200 && !!po.json.id && !!po.json.ledgerId, po.json);
  S1 = { ...S1, payoutId: po.json.id, ledgerId: po.json.ledgerId };
  const s = (await col("staff_settlements").doc(po.json.id).get()).data() ?? {};
  check("settlement stored: payout 500, Cash, linked to the ledger row", s.kind === "payout" && eq(s.amount, 500) && s.method === "Cash" && s.ledgerId === po.json.ledgerId && s.staffName === "Dr Settle", s);
  const salary = await row(po.json.ledgerId);
  check("a Salary expense of 500 is on the ledger", salary.type === "expense" && salary.category === "Salary" && eq(salary.cost, 500) && eq(salary.amount, 500) && eq(salary.paid, 0), salary);
  check("…dated 1 Oct, naming the dentist, linked back", salary.date === "2026-10-01" && salary.description === "Staff pay – Dr Settle" && salary.settlementId === po.json.id && salary.staffId === "dS1" && salary.patientId === null, salary);
  const [a, b, c] = await Promise.all(ids.map(row));
  check("oldest first: 200 fully paid, 300 fully paid, 400 untouched", eq(a.doctorCommissionPaid, 200) && eq(b.doctorCommissionPaid, 300) && eq(c.doctorCommissionPaid ?? 0, 0), [a.doctorCommissionPaid, b.doctorCommissionPaid, c.doctorCommissionPaid]);
  const v = await teamView("dS1");
  check("Team page: earned 900, paid 500, owed 400", eq(v.earned, 900) && eq(v.paid, 500) && eq(v.owed, 400), { earned: v.earned, paid: v.paid, owed: v.owed });
}

// ===================================================================================================
scenario("D61 Dr Ahead earned 400 but the owner hands her 1,000 (an advance)");
{
  const t = await treat({ patientId: "P61", doctorId: "dS2", date: "2026-09-05" });
  const p = await pay("P61", t.ledgerId, 1000, "2026-09-05");
  const po = await payout("dS2", 1000, "2026-09-30", { method: "InstaPay" });
  check("payout of 1,000 accepted", po.status === 200, po.json);
  check("the one payment is stamped 400 paid (never more than it earned)", eq((await row(p.id)).doctorCommissionPaid, 400));
  check("the Salary row is 1,000 by InstaPay", eq((await row(po.json.ledgerId)).cost, 1000) && (await row(po.json.ledgerId)).method === "InstaPay");
  let v = await teamView("dS2");
  check("owed is −600 (paid ahead), not 0", eq(v.owed, -600) && eq(v.ahead, 600), { owed: v.owed, ahead: v.ahead });
  const t2 = await treat({ patientId: "P61", doctorId: "dS2", date: "2026-10-06" });
  await pay("P61", t2.ledgerId, 1000, "2026-10-06");
  v = await teamView("dS2");
  check("new 400 of work eats into the advance: owed −200", eq(v.owed, -200), v.owed);
}

// ===================================================================================================
scenario("D62 Dr Settle broke a handpiece: the owner holds back 100 on 2 Oct");
{
  const ledgerBefore = (await col("ledger").get()).size;
  const d = await deduction("dS1", 100, "2026-10-02", "Broken handpiece");
  check("deduction saved, no ledger row", d.status === 200 && d.json.ledgerId === null, d.json);
  check("nothing new on the ledger", (await col("ledger").get()).size === ledgerBefore);
  check("no ledger row points at the deduction", (await col("ledger").where("settlementId", "==", d.json.id).get()).empty);
  const c = await row(S1.p3);
  check("the 100 is taken from the oldest unpaid line (the 400)", eq(c.doctorCommissionDeducted, 100) && eq(c.doctorCommissionPaid, 0), c);
  const v = await teamView("dS1");
  check("owed 900 − 500 − 100 = 300", eq(v.owed, 300) && eq(v.deducted, 100), { owed: v.owed, deducted: v.deducted });
}

// ===================================================================================================
scenario("D63 The owner corrects the 1 Oct payout: it was 250 by InstaPay on 3 Oct");
{
  const u = await settle({ action: "update", id: S1.payoutId, amount: 250, date: "2026-10-03", method: "InstaPay" });
  check("edit accepted", u.status === 200, u.json);
  const salary = await row(S1.ledgerId);
  check("the Salary row follows: 250, 3 Oct, InstaPay", eq(salary.amount, 250) && eq(salary.cost, 250) && salary.date === "2026-10-03" && salary.method === "InstaPay", salary);
  const [a, b, c] = await Promise.all([S1.p1, S1.p2, S1.p3].map(row));
  // Deduction (2 Oct) now comes before the payout (3 Oct): 100 deducted on the 200, then 100 + 150 paid.
  check("deduction now pours first: line 1 = 100 deducted + 100 paid", eq(a.doctorCommissionDeducted, 100) && eq(a.doctorCommissionPaid, 100), [a.doctorCommissionPaid, a.doctorCommissionDeducted]);
  check("line 2 = 150 paid, line 3 = nothing", eq(b.doctorCommissionPaid, 150) && eq(b.doctorCommissionDeducted ?? 0, 0) && eq(c.doctorCommissionPaid, 0) && eq(c.doctorCommissionDeducted, 0), [b, c].map((r) => [r.doctorCommissionPaid, r.doctorCommissionDeducted]));
  const v = await teamView("dS1");
  check("owed 900 − 250 − 100 = 550", eq(v.owed, 550), v.owed);
}

// ===================================================================================================
scenario("D64 The payout was entered by mistake: the owner deletes it");
{
  const del = await settle({ action: "delete", id: S1.payoutId });
  check("delete accepted", del.status === 200, del.json);
  check("the settlement and its Salary row are both gone", !(await exists("staff_settlements", S1.payoutId)) && !(await exists("ledger", S1.ledgerId)));
  const [a, b] = await Promise.all([S1.p1, S1.p2].map(row));
  check("stamps follow: line 1 only 100 deducted, nothing paid anywhere", eq(a.doctorCommissionPaid, 0) && eq(a.doctorCommissionDeducted, 100) && eq(b.doctorCommissionPaid, 0), [a.doctorCommissionPaid, a.doctorCommissionDeducted, b.doctorCommissionPaid]);
  const audit = await col("ledger_audit").where("via", "==", "staff/settlements:delete").get();
  check("the removed Salary row leaves an audit entry", audit.size >= 1, audit.size);
  const again = await settle({ action: "delete", id: S1.payoutId });
  check("deleting it twice says it no longer exists (404)", again.status === 404, again.json);
  const v = await teamView("dS1");
  check("owed back to 800", eq(v.owed, 800), v.owed);
}

// ===================================================================================================
scenario("D65 Someone tries to change or delete a staff-pay Salary row from the Finance page");
{
  const po = await payout("dS1", 200, "2026-10-04");
  const id = po.json.ledgerId as string;
  const edit = await ledgerAction({ action: "update", id, patch: { amount: 1 } });
  check("admin edit of the Salary row is refused (409, points to the Team page)", edit.status === 409 && /Team page/.test(edit.json.error ?? ""), edit.json);
  const del = await ledgerAction({ action: "delete", id });
  check("admin delete of the Salary row is refused (409)", del.status === 409, del.json);
  const deskDel = await asUser("desk", () => ledgerAction({ action: "delete", id }));
  check("receptionist delete is refused too", deskDel.status === 409, deskDel.json);
  const dateOnly = await ledgerAction({ action: "update", id, patch: { date: "2026-10-09" } });
  check("even a date-only edit is refused", dateOnly.status === 409, dateOnly.json);
  const r = await row(id);
  check("the row is untouched: 200 on 4 Oct", eq(r.cost, 200) && r.date === "2026-10-04", r);
  check("the settlement still links to it", (await col("staff_settlements").doc(po.json.id).get()).get("ledgerId") === id);
}

// ===================================================================================================
scenario("D66 Dr Late was paid 400 on 1 Oct; then a forgotten payment dated 1 Sep is entered");
{
  const t = await treat({ patientId: "P66", doctorId: "dS3", date: "2026-09-10" });
  const old = await pay("P66", t.ledgerId, 1000, "2026-09-10");
  const po = await payout("dS3", 400, "2026-10-01");
  check("the 400 line is stamped fully paid", eq((await row(old.id)).doctorCommissionPaid, 400), po.json);
  const t2 = await treat({ patientId: "P66", doctorId: "dS3", unitCost: 500, date: "2026-09-01" });
  const late = await pay("P66", t2.ledgerId, 500, "2026-09-01");
  check("the late payment earns 200", eq((await row(late.id)).doctorCommissionAmount, 200));
  const v = await teamView("dS3");
  check("Team page (live): the older 200 is covered first, 200 of the 400 remains", eq(v.byKey.get(late.id)?.paid ?? -1, 200) && eq(v.byKey.get(old.id)?.paid ?? -1, 200) && eq(v.owed, 200), [v.byKey.get(late.id), v.byKey.get(old.id), v.owed]);
  const staleOld = (await row(old.id)).doctorCommissionPaid;
  const staleLate = (await row(late.id)).doctorCommissionPaid ?? 0;
  check("(documented limit) stored stamps still say 400 / 0 until the next settlement write", eq(staleOld, 400) && eq(staleLate, 0), [staleOld, staleLate]);
  await settle({ action: "update", id: po.json.id, note: "re-save" });
  check("after any settlement write the stamps agree with FIFO: 200 / 200", eq((await row(late.id)).doctorCommissionPaid, 200) && eq((await row(old.id)).doctorCommissionPaid, 200));
}

// ===================================================================================================
let CLAIM67 = "";
scenario("D67 Dr Insured: MetLife approval (20%) treated 1 Oct + private 1,000 filling (40%) paid 5 Oct; paid 300 on 8 Oct");
{
  const t = await treat({ patientId: "P67", doctorId: "dI", date: "2026-10-05" });
  const pp = await pay("P67", t.ledgerId, 1000, "2026-10-05");
  check("private payment earns 400", eq((await row(pp.id)).doctorCommissionAmount, 400));
  const extraction = { ...SAMPLE_RAW, header: { ...SAMPLE_RAW.header, approvalNumber: "D6000067" } };
  const c = await call(claimsRoute.POST, "POST", "/api/insurance/claims", { clinicId: CLINIC, docId: "doc-67", payerId: "metlife", extraction, patient: { id: "P67" }, dentistId: "dI", treatedDate: "2026-10-01" });
  check("approval saved as treated on 1 Oct", c.status === 201, c.json);
  CLAIM67 = "metlife_d6000067";
  const claim = (await col("insurance_claims").doc(CLAIM67).get()).data() ?? {};
  const shares = [0, 1, 2, 3, 4].map((i) => claim.dentists?.[i]?.share);
  check("each line stamped at Dr Insured's MetLife 20%: 12, 12, 120, 60, 48", JSON.stringify(shares) === JSON.stringify([12, 12, 120, 60, 48]) && claim.dentists?.[0]?.rate === 20, claim.dentists);
  let v = await teamView("dI");
  check("Team page: 400 private + 252 insurance = 652 owed", eq(v.privateTotal, 400) && eq(v.insuranceTotal, 252) && eq(v.owed, 652), { p: v.privateTotal, i: v.insuranceTotal, owed: v.owed });
  const po = await payout("dI", 300, "2026-10-08");
  check("payout 300 accepted", po.status === 200, po.json);
  const after = (await col("insurance_claims").doc(CLAIM67).get()).data() ?? {};
  const paidLines = [0, 1, 2, 3, 4].map((i) => after.dentists?.[i]?.paid ?? 0);
  check("insurance lines (treated 1 Oct) are paid first, in full: 252", JSON.stringify(paidLines) === JSON.stringify([12, 12, 120, 60, 48]), paidLines);
  check("the private payment (5 Oct) gets the remaining 48", eq((await row(pp.id)).doctorCommissionPaid, 48));
  // The desk corrects the treated date to 7 Oct: the insurance work is now NEWER than the private payment.
  const pt = await call(claimsRoute.PATCH, "PATCH", "/api/insurance/claims", { clinicId: CLINIC, claimId: CLAIM67, patch: { treatedDate: "2026-10-07" } });
  check("treated date moved to 7 Oct", pt.status === 200, pt.json);
  await settle({ action: "update", id: po.json.id, note: "re-save after date fix" });
  const moved = (await col("insurance_claims").doc(CLAIM67).get()).data() ?? {};
  const paidMoved = [0, 1, 2, 3, 4].map((i) => moved.dentists?.[i]?.paid ?? 0);
  check("now the 5 Oct private payment is covered first: 300 of its 400", eq((await row(pp.id)).doctorCommissionPaid, 300), (await row(pp.id)).doctorCommissionPaid);
  check("and the insurance lines are back to 0 paid", paidMoved.every((x: number) => x === 0), paidMoved);
  v = await teamView("dI");
  check("owed 652 − 300 = 352", eq(v.owed, 352), v.owed);
}

// ===================================================================================================
scenario("D68 MetLife pays its 1,260 against the approval: no extra commission for Dr Insured");
{
  const p = await call(claimsRoute.PATCH, "PATCH", "/api/insurance/claims", { clinicId: CLINIC, claimId: CLAIM67, patch: { insurerPaid: true } });
  check("insurer payment recorded", p.status === 200, p.json);
  const insurerRows = (await col("ledger").where("claimId", "==", CLAIM67).where("type", "==", "payment").get()).docs.map((d) => d.data());
  const cash = insurerRows.reduce((s, r) => s + Number(r.paid || 0), 0);
  check("five insurer payment rows totalling 1,260", insurerRows.length === 5 && eq(cash, 1260), { n: insurerRows.length, cash });
  check("every insurer payment carries 0 commission", insurerRows.every((r) => Number(r.doctorCommissionAmount || 0) === 0), insurerRows.map((r) => r.doctorCommissionAmount));
  const v = await teamView("dI");
  check("Dr Insured still earned exactly 400 private + 252 insurance", eq(v.privateTotal, 400) && eq(v.insuranceTotal, 252) && eq(v.earned, 652), { p: v.privateTotal, i: v.insuranceTotal });
}

// ===================================================================================================
scenario("D69 The receptionist (all finance permissions, not admin) tries to record a payout");
{
  const before = (await col("staff_settlements").get()).size;
  const r = await asUser("desk", () => payout("dA", 500, "2026-10-08"));
  check("refused: admin only (403)", r.status === 403, r.json);
  const d = await asUser("desk", () => deduction("dA", 50, "2026-10-08"));
  check("a deduction is refused too", d.status === 403, d.json);
  check("nothing was written", (await col("staff_settlements").get()).size === before);
  const bad0 = await payout("dA", 0, "2026-10-08");
  const badDate = await payout("dA", 100, "8/10/2026");
  const badStaff = await payout("ghost", 100, "2026-10-08");
  const badKind = await settle({ action: "create", staffId: "dA", kind: "bonus", amount: 100, date: "2026-10-08" });
  check("0 EGP, a bad date, an unknown dentist and an unknown kind are all refused", bad0.status === 400 && badDate.status === 400 && badStaff.status === 404 && badKind.status === 400, [bad0.status, badDate.status, badStaff.status, badKind.status]);
  const owner = await asUser("own", () => payout("dA", 100, "2026-10-08"));
  check("the clinic Owner can record one", owner.status === 200, owner.json);
  if (owner.json.id) await settle({ action: "delete", id: owner.json.id });
}

// ===================================================================================================
scenario("D70 Rana is a receptionist here but admin of the sister clinic; she posts a payout without naming the clinic");
{
  const before = (await col("staff_settlements").get()).size;
  const named = await asUser("multi", () => settle({ action: "create", staffId: "dA", kind: "payout", amount: 700, date: "2026-10-08" }));
  check("with this clinic named: refused (403)", named.status === 403, named.json);
  const res = await asUser("multi", () =>
    call(settleRoute.POST, "POST", "/api/staff/settlements", { action: "create", staffId: "dA", kind: "payout", amount: 700, date: "2026-10-08" }),
  );
  const after = (await col("staff_settlements").get()).size;
  check("without a clinic id: still refused, nothing written in this clinic", res.status === 403 && after === before, { status: res.status, json: res.json, written: after - before });
  if (res.json.id) {
    const salary = await row(res.json.ledgerId);
    console.log(`        (wrote settlement ${res.json.id} and a ${salary.cost} EGP Salary row in ${CLINIC}, by ${salary.addedBy})`);
    await settle({ action: "delete", id: res.json.id });
  }
  // Same door on the ledger route: she re-splits one of Dr Amr's payments to 100%.
  const t = await treat({ patientId: "P70", doctorId: "dA", date: "2026-10-01" });
  const p = await pay("P70", t.ledgerId, 1000, "2026-10-01");
  const sc = await asUser("multi", () => call(ledgerRoute.POST, "POST", "/api/finance/ledger", { action: "set-commission", id: p.id, commissionPercentage: 100 }));
  const r = await row(p.id);
  check("without a clinic id she cannot re-split a payment here either", sc.status === 403 && eq(r.doctorCommissionAmount, 400), { status: sc.status, commission: r.doctorCommissionAmount });
}

// ===================================================================================================
scenario("D71 Dr Nopct has no commission % on file at all");
{
  const t = await treat({ patientId: "P71", doctorId: "dN", date: "2026-09-15" });
  const p = await pay("P71", t.ledgerId, 1000, "2026-09-15");
  const r = await row(p.id);
  check("payment earns 0 at 0%, clinic keeps 1,000", r.doctorId === "dN" && r.doctorCommissionPercentage === 0 && eq(r.doctorCommissionAmount, 0) && eq(r.clinicProfit, 1000), r);
  const po = await payout("dN", 100, "2026-10-01");
  check("a 100 payout is still allowed", po.status === 200, po.json);
  const v = await teamView("dN");
  check("owed −100, and the zero-earning payment is stamped 0", eq(v.owed, -100) && eq((await row(p.id)).doctorCommissionPaid ?? 0, 0), { owed: v.owed });
}

// ===================================================================================================
scenario("D72 Crown with a 300 lab fee: the patient first pays only 100; and a cheap crown below its lab cost");
{
  const t = await treat({ patientId: "P72", doctorId: "dK", procedures: ["Crown"], date: "2026-10-01" });
  const p1 = await pay("P72", t.ledgerId, 100, "2026-10-01");
  const r1 = await row(p1.id);
  check("100 payment: commission 0; the unabsorbed 300 lab sits on it for now (clinic −200)", eq(r1.labFee, 300) && eq(r1.doctorCommissionAmount, 0) && eq(r1.clinicProfit, -200), { lab: r1.labFee, p: r1.clinicProfit });
  const p2 = await pay("P72", t.ledgerId, 900, "2026-10-02");
  const r2 = await row(p2.id);
  check("once 900 arrives the first row drops back to lab 100 / clinic 0", eq((await row(p1.id)).labFee, 100) && eq((await row(p1.id)).clinicProfit, 0), await row(p1.id));
  check("900 payment: lab 200, commission 280 (40% of 700), clinic 420", eq(r2.labFee, 200) && eq(r2.doctorCommissionAmount, 280) && eq(r2.clinicProfit, 420), r2);
  check("charge keeps its 300 lab fee", eq((await row(t.ledgerId)).labFee, 300));
  const cheap = await treat({ patientId: "P72", doctorId: "dK", procedures: ["Crown"], unitCost: 200, date: "2026-10-03" });
  const cp = await row(cheap.ledgerId);
  check("a 200 crown with a 300 lab: dentist 0, clinic −100 on the charge", eq(cp.cost, 200) && eq(cp.doctorCommissionAmount, 0) && eq(cp.clinicProfit, -100), cp);
  const p3 = await pay("P72", cheap.ledgerId, 200, "2026-10-03");
  const r3 = await row(p3.id);
  check("its 200 payment: commission 0, the whole 300 lab sits on it (clinic −100)", eq(r3.doctorCommissionAmount, 0) && eq(r3.labFee, 300) && eq(r3.clinicProfit, -100), r3);
}

// ===================================================================================================
scenario("D73 Dr Thirds (35%) on a 999.99 filling paid in three 333.33 instalments");
{
  const t = await treat({ patientId: "P73", doctorId: "dT", unitCost: 999.99, date: "2026-09-01" });
  const proc = await row(t.ledgerId);
  check("charge 999.99, share 350.00 on the charge", eq(proc.cost, 999.99) && eq(proc.doctorCommissionAmount, 350), proc.doctorCommissionAmount);
  const ids: string[] = [];
  for (const d of ["2026-09-02", "2026-09-03", "2026-09-04"]) ids.push((await pay("P73", t.ledgerId, 333.33, d)).id);
  const rs = await Promise.all(ids.map(row));
  check("each instalment earns 116.67", rs.every((r) => eq(r.doctorCommissionAmount, 116.67)), rs.map((r) => r.doctorCommissionAmount));
  const total = Number(rs.reduce((s, r) => s + Number(r.doctorCommissionAmount), 0).toFixed(2));
  check("instalments total 350.01 vs 350.00 on the charge (1 piaster per-row rounding)", eq(total, 350.01), total);
  const po = await payout("dT", 350.01, "2026-10-01");
  const stamps = (await Promise.all(ids.map(row))).map((r) => r.doctorCommissionPaid);
  check("paying 350.01 settles all three exactly, owed 0", po.status === 200 && stamps.every((x) => eq(x, 116.67)) && eq((await teamView("dT")).owed, 0), stamps);
  const odd = await payout("dT", 10.005, "2026-10-02");
  const oddAmt = (await col("staff_settlements").doc(odd.json.id).get()).get("amount");
  check("a 10.005 payout is stored to the piaster (10 or 10.01)", eq(oddAmt, 10.01) || eq(oddAmt, 10), oddAmt);
  await settle({ action: "delete", id: odd.json.id });
}

// ===================================================================================================
scenario("D74 Finance net: 1,000 collected, Dr Finance's 400 share, then the owner pays her 400");
{
  const t = await treat({ patientId: "P74", doctorId: "dF", date: "2026-11-02" });
  const p = await pay("P74", t.ledgerId, 1000, "2026-11-02");
  const rowsBefore = [await row(t.ledgerId), await row(p.id)];
  const before = summarizeLedger(rowsBefore as never);
  check("before the payout: income 1,000, commission 400 shown, net 1,000 (not 600)", eq(before.income, 1000) && eq(before.commissions, 400) && eq(before.net, 1000), before);
  const po = await payout("dF", 400, "2026-11-05");
  const after = summarizeLedger([...rowsBefore, await row(po.json.ledgerId)] as never);
  check("after: expenses 400, net 600 — the share is subtracted once, as cash", eq(after.expenses, 400) && eq(after.net, 600) && eq(after.commissions, 400), after);
}

// ===================================================================================================
scenario("D75 A one-off 50% split on Dr Manual's first instalment survives the second; then she is paid 900");
{
  const t = await treat({ patientId: "P75", doctorId: "dM", unitCost: 2000, date: "2026-09-01" });
  const p1 = await pay("P75", t.ledgerId, 1000, "2026-09-02");
  const sc = await ledgerAction({ action: "set-commission", id: p1.id, commissionPercentage: 50 });
  check("admin sets the first instalment to 50% → 500", sc.status === 200 && eq((await row(p1.id)).doctorCommissionAmount, 500) && (await row(p1.id)).commissionSetManually === true, sc.json);
  const p2 = await pay("P75", t.ledgerId, 1000, "2026-09-10");
  check("second instalment at the standing 40% → 400", eq((await row(p2.id)).doctorCommissionAmount, 400));
  check("the hand-set 500 is still 500", eq((await row(p1.id)).doctorCommissionAmount, 500) && eq((await row(p1.id)).doctorCommissionPercentage, 50));
  const po = await payout("dM", 900, "2026-10-01");
  check("a 900 payout covers both exactly: 500 + 400, owed 0", po.status === 200 && eq((await row(p1.id)).doctorCommissionPaid, 500) && eq((await row(p2.id)).doctorCommissionPaid, 400) && eq((await teamView("dM")).owed, 0));
  const deskSet = await asUser("desk", () => ledgerAction({ action: "set-commission", id: p2.id, commissionPercentage: 100 }));
  check("(permission model) a receptionist with finance.edit may also re-split a payment", deskSet.status === 200, deskSet.json);
  const v = await teamView("dM");
  check("…which silently makes the dentist owed 600 more (paid stamps stay stale until the next settlement write)", eq(v.owed, 600) && eq((await row(p2.id)).doctorCommissionPaid, 400), { owed: v.owed, stamp: (await row(p2.id)).doctorCommissionPaid });
}

await wipe();
authServer.close();
console.log(`\ncommission scenarios: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
