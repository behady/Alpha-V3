// @ts-nocheck — a scenario script: rows are read back as loose Firestore data on purpose.
/**
 * Insurance & payers: 25 clinic workflow scenarios (I26–I50), end to end against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/scenarios/insurance.test.mts
 *
 * Runs the real route handlers — insurance claims (save/edit/pay), clinical procedures, finance
 * ledger, records delete/restore — with nothing mocked but the login check (a tiny fake Auth
 * emulator answers verifyIdToken's one lookup, as in tests/recycleBinCascade.test.mts). Reports,
 * statements and payroll are the real pure builders fed with what the routes stored.
 *
 * Every patient, dentist and number here is invented. Checks tagged [expect] state the owner's
 * rule; a FAIL on one of them is a product finding, not a harness problem.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { SAMPLE_RAW } from "../fixtures/insuranceMetlife.fixture";
import { NEXTCARE_RAW } from "../fixtures/insuranceNextcare.fixture";

const PROJECT = "demo-scn-insurance";
const CLINIC = "SCN-INS";
const LOCKED_CLINIC = "SCN-INS-NOADDON";
const ADMIN = "scn-ins-admin";
const DESK = "scn-ins-desk"; // receptionist: patients.edit + clinical.edit, no finance
const CASHIER = "scn-ins-cashier"; // finance.add + patients.edit
const OUTSIDER = "scn-ins-outsider"; // no permissions at all in this clinic

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
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error("Refusing to run off the emulator.");

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
const { liveEntryId } = await import("../../src/lib/server/recycleBinStore");
const claimsRoute = await import("../../src/app/api/insurance/claims/route");
const proceduresRoute = await import("../../src/app/api/clinical/procedures/route");
const ledgerRoute = await import("../../src/app/api/finance/ledger/route");
const deleteRoute = await import("../../src/app/api/records/delete/route");
const restoreRoute = await import("../../src/app/api/records/restore/route");
const { parseClaim } = await import("../../src/lib/insurance/claims");
const { lineSyncPatch } = await import("../../src/lib/insurance/appointments");
const { fromNextcareModel, normalizeNextcare } = await import("../../src/lib/insurance/nextcare");
const { buildPayerReport } = await import("../../src/lib/payerReport");
const { buildMetlifeStatement } = await import("../../src/lib/insuranceStatementMetlife");
const { buildNextcareStatement } = await import("../../src/lib/insuranceStatementNextcare");
const { buildInsuranceStatement } = await import("../../src/lib/insuranceStatement");
const { insuranceWorkByStaff, unassignedLines } = await import("../../src/lib/staffInsurance");
const { parsePayers, payerOf } = await import("../../src/lib/payers");
const { readMemberNumbers } = await import("../../src/lib/patientInsurance");
const { patientPortion, insurerOutstanding } = await import("../../src/lib/ledgerInsurer");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);

let passed = 0;
let failed = 0;
const failures: string[] = [];
let current = "";
function scenario(id: string, story: string) {
  current = id;
  console.log(`\n${id} — ${story}`);
}
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    const d = detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : "";
    console.log(`  FAIL  ${label}${d}`);
    failures.push(`${current}: ${label}`);
    failed += 1;
  }
}

type Json = Record<string, any>;
let as = ADMIN;
async function call(handler: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${idToken(as)}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const before = as;
  as = uid;
  try {
    return await fn();
  } finally {
    as = before;
  }
}

const saveClaim = (body: Json) => call(claimsRoute.POST, "POST", "/api/insurance/claims", { clinicId: CLINIC, docId: `doc-${Math.random().toString(36).slice(2)}`, ...body });
const patchClaim = (claimId: string, patch: Json) => call(claimsRoute.PATCH, "PATCH", "/api/insurance/claims", { clinicId: CLINIC, claimId, patch });
const proc = (body: Json) => call(proceduresRoute.POST, "POST", "/api/clinical/procedures", { clinicId: CLINIC, ...body });
const money = (body: Json) => call(ledgerRoute.POST, "POST", "/api/finance/ledger", { clinicId: CLINIC, ...body });

const getDoc = async (collection: string, id: string) => (await col(collection).doc(id).get()).data() as Json | undefined;
const claimOf = async (id: string) => {
  const snap = await col("insurance_claims").doc(id).get();
  return snap.exists ? parseClaim(id, snap.data()) : null;
};
const rowsOf = async (claimId: string) => {
  const snap = await col("ledger").where("claimId", "==", claimId).where("type", "==", "procedure").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
};
const ledgerWhere = async (field: string, value: unknown) => (await col("ledger").where(field, "==", value).get()).docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
const payersNow = async () => parsePayers((await col("settings").doc("payers").get()).data());
const approx = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.005;

/** Every ledger row dated inside [from, to], split as the Reports Center splits them. */
async function booksBetween(from: string, to: string) {
  const snap = await col("ledger").where("date", ">=", from).where("date", "<=", to).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Json) }));
  return { procedures: rows.filter((r) => r.type === "procedure"), payments: rows.filter((r) => r.type === "payment") };
}
async function allClaims() {
  return (await col("insurance_claims").get()).docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is NonNullable<typeof c> => !!c);
}

type PaperLine = { code: string; desc: string; req: number; appr: number; share?: number; units?: number };
/** A MetLife paper (the model's raw shape) whose printed totals add up to its lines. */
function metlifePaper(approvalNumber: string, ddmmyyyy: string, lines: PaperLine[], name = "SCENARIO PATIENT", cert = "555", dep = "1") {
  const sum = (f: (l: PaperLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  return {
    header: {
      ...SAMPLE_RAW.header,
      approvalNumber,
      approvalDate: ddmmyyyy,
      certificateNumber: cert,
      dependentCode: dep,
      paperPatientName: name,
      estimatedCost: sum((l) => l.req * (l.units ?? 1)),
      requestedTotal: sum((l) => l.req * (l.units ?? 1)),
      approvedTotal: sum((l) => l.appr),
      patientShareTotal: sum((l) => l.share ?? 0),
      collectNote: sum((l) => l.share ?? 0),
    },
    lines: lines.map((l) => ({
      code: l.code,
      description: l.desc,
      unitsRequested: l.units ?? 1,
      grossPerUnit: l.req,
      grossTotal: l.req * (l.units ?? 1),
      unitsApproved: l.appr > 0 || (l.share ?? 0) > 0 ? l.units ?? 1 : 0,
      patientShare: l.share ?? 0,
      approvedAmount: l.appr,
      comment: "",
      confidence: 0.95,
    })),
  };
}
const FIVE: PaperLine[] = [
  { code: "D0120", desc: "PERIODIC ORAL EVALUATION", req: 60, appr: 60 },
  { code: "D0270", desc: "BITEWING - SINGLE FILM", req: 60, appr: 60 },
  { code: "D2650", desc: "INLAY - RESIN-BASED COMPOSITE", req: 600, appr: 600 },
  { code: "D3120", desc: "PULP CAP - INDIRECT", req: 300, appr: 300 },
  { code: "D4220", desc: "GINGIVAL CURETTAGE", req: 240, appr: 240 },
];

async function newPatient(id: string, name: string, extra: Json = {}) {
  await col("patients").doc(id).set({ name, phone: `+2010${String(Math.abs(hash(id)) % 1e8).padStart(8, "0")}`, ...extra });
}
function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

// --- the clinic ---------------------------------------------------------------------------------------
async function wipe() {
  for (const c of [CLINIC, LOCKED_CLINIC]) {
    for (const d of (await db.collection("deleted_records").where("clinicId", "==", c).get()).docs) await db.recursiveDelete(d.ref);
    await db.recursiveDelete(db.collection("clinics").doc(c));
  }
  for (const u of [ADMIN, DESK, CASHIER, OUTSIDER]) await db.recursiveDelete(db.collection("users").doc(u));
}
await wipe();

await clinic.set({ name: "Scenario Insurance Clinic", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("clinics").doc(LOCKED_CLINIC).set({ name: "No Add-on Clinic", status: "Active", subscriptionTier: "Premium", features: { insurance: false } });
await db.collection("users").doc(ADMIN).set({ name: "Owner Tester", clinicRoles: { [CLINIC]: "Admin", [LOCKED_CLINIC]: "Admin" } });
await db.collection("users").doc(DESK).set({
  name: "Desk Tester",
  role: "Receptionist",
  clinicRoles: { [CLINIC]: "Receptionist" },
  clinicPermissions: { [CLINIC]: ["patients.edit", "clinical.edit"] },
  permissions: ["patients.edit", "clinical.edit"],
});
await db.collection("users").doc(CASHIER).set({
  name: "Cashier Tester",
  role: "Receptionist",
  clinicRoles: { [CLINIC]: "Receptionist" },
  clinicPermissions: { [CLINIC]: ["patients.edit", "clinical.edit", "finance.add"] },
  permissions: ["patients.edit", "clinical.edit", "finance.add"],
});
await db.collection("users").doc(OUTSIDER).set({ name: "Outsider", role: "Assistant", clinicRoles: { [CLINIC]: "Assistant" }, clinicPermissions: { [CLINIC]: [] }, permissions: [] });

// Dentists. Omar: 40% private, 25% MetLife. Mona: 30% usual, 35% on AXA. A nurse who is not a dentist.
await col("staff").doc("omar").set({ name: "Dr Omar Test", role: "Dentist", commissionPercentage: 40, commissionByPayer: { metlife: 25 } });
await col("staff").doc("mona").set({ name: "Dr Mona Test", role: "Dentist", commissionPercentage: 30, commissionByPayer: { axa: 35 } });
await col("staff").doc("nurse").set({ name: "Nurse Test", role: "Assistant", commissionPercentage: 0 });

await col("settings").doc("price_lists").set({
  lists: [
    { id: "standard", name: "Standard", generalDiscountPercent: 0, active: true, isDefault: true },
    { id: "list-axa", name: "AXA Egypt", generalDiscountPercent: 0, active: true, isDefault: false },
    { id: "list-gasco", name: "GASCO", generalDiscountPercent: 0, active: true, isDefault: false },
    { id: "list-orphan", name: "AXA", generalDiscountPercent: 0, active: true, isDefault: false },
    { id: "list-allianz", name: "Allianz", generalDiscountPercent: 0, active: true, isDefault: false },
    { id: "list-vip", name: "VIP", generalDiscountPercent: 0, active: true, isDefault: false },
  ],
});
await col("settings").doc("payers").set({
  payers: [
    { id: "private", name: "Private", active: true, isDefault: true },
    { id: "metlife", name: "MetLife", format: "metlife", providerCode: "DNC0001", active: true, isDefault: false },
    { id: "nextcare", name: "NextCare", format: "nextcare", active: true, isDefault: false },
    { id: "axa", name: "AXA Egypt", priceListId: "list-axa", dentistRate: 20, active: true, isDefault: false },
    { id: "gasco", name: "GASCO", priceListId: "list-gasco", dentistRate: 0, active: true, isDefault: false },
    { id: "bupa", name: "Bupa", active: true, isDefault: false },
    { id: "allianz", name: "Allianz", priceListId: "list-allianz", active: true, isDefault: false },
  ],
});
await col("services").doc("svc-crown").set({ name: "Crown", price: 2000, prices: { "list-axa": 1500, "list-gasco": 1200, "list-orphan": 1700, "list-allianz": 1600 }, pricingMode: "flat" });
await col("services").doc("svc-fill").set({ name: "Composite Filling", price: 600, prices: { "list-axa": 450 }, pricingMode: "per_tooth" });
await col("services").doc("svc-xray").set({ name: "X-Ray", price: 100, pricingMode: "flat" });

// =====================================================================================================
scenario("I26", "MetLife paper saved at the desk: exam done today, the rest planned, Dr Omar on the paper");
// =====================================================================================================
await newPatient("p26", "Karim Scenario", {});
let C26 = "";
{
  const paper = metlifePaper("D7000026", "01/10/2026", FIVE, "KARIM SCENARIO");
  const { status, json } = await saveClaim({
    payerId: "metlife",
    extraction: paper,
    patient: { id: "p26" },
    dentistId: "omar",
    lines: { 1: { status: "Planned" }, 2: { status: "Planned" }, 3: { status: "Planned" }, 4: { status: "Planned" } },
  });
  check("saved as a treated claim (201)", status === 201 && json.claimId === "metlife_d7000026", json);
  C26 = json.claimId;
  const claim = await claimOf(C26);
  check("status treated, treated date defaults to the approval date", claim?.status === "treated" && claim?.treatedDate === "2026-10-01", claim?.treatedDate);
  check("line 0 Completed, lines 1-4 Planned", claim?.lineStatus[1] === "Planned" && claim?.lineStatus[4] === "Planned" && !claim?.lineStatus[0], claim?.lineStatus);
  check("Dr Omar stamped on every line at his MetLife rate (25%)", Object.values(claim?.dentists ?? {}).length === 5 && claim!.dentists[2].rate === 25 && claim!.dentists[2].share === 150, claim?.dentists);
  const rows = await rowsOf(C26);
  check("one ledger charge per approved line (5)", rows.length === 5, rows.length);
  check("charges stamped MetLife, dated 2026-10-01, total 1260", rows.every((r) => r.payerId === "metlife" && r.payerName === "MetLife" && r.date === "2026-10-01") && approx(rows.reduce((t, r) => t + r.amount, 0), 1260));
  check("the inlay charge carries Omar's 150 share, clinic profit 450", rows.some((r) => r.serviceCode === "D2650" && r.doctorId === "omar" && r.doctorCommissionAmount === 150 && r.clinicProfit === 450));
  const notes = (await col("clinical_notes").where("claimId", "==", C26).get()).docs.map((d) => d.data());
  check("the clinical notes carry the line states (1 Completed, 4 Planned)", notes.filter((n) => n.status === "Completed").length === 1 && notes.filter((n) => n.status === "Planned").length === 4);
  const patient = await getDoc("patients", "p26");
  check("the patient's MetLife membership is learned from the paper (555/1)", patient?.insurance?.metlife?.memberNumber === "555/1", patient?.insurance);
  const payroll = insuranceWorkByStaff((await allClaims()).filter((c) => c.id === C26));
  check("payroll counts only the Completed exam for Omar (15)", payroll.get("omar")?.total === 15, payroll.get("omar"));
}

// =====================================================================================================
scenario("I27", "The bitewing is done a week later by Dr Mona: the visit tells the approval");
// =====================================================================================================
{
  // The approval is from September; the visit happens in October (the owner's July→October case).
  await newPatient("p27", "Nadia Scenario");
  const paper = metlifePaper("D7000027", "20/09/2026", FIVE.slice(0, 2), "NADIA SCENARIO");
  const saved = await saveClaim({ payerId: "metlife", extraction: paper, patient: { id: "p27" }, dentistId: "omar", lines: { 1: { status: "Planned" } } });
  check("September paper saved, exam done, bitewing planned", saved.status === 201, saved.json);
  const id = saved.json.claimId as string;
  const appt = { id: "a27", claimLinks: [{ claimId: id, claimLine: 1 }], claimId: id, claimLine: 1, status: "Completed", date: "2026-10-08", time: "11:00", doctorId: "mona", doctor: "Dr Mona Test" };
  await col("appointments").doc("a27").set({ patientId: "p27", ...appt });
  const patch = lineSyncPatch((await claimOf(id))!, appt);
  check("the visit yields: line 1 Completed, Mona, treated date 2026-10-08", JSON.stringify(patch) === JSON.stringify({ lineStatus: { 1: "Completed" }, dentists: { 1: "mona" }, treatedDate: "2026-10-08" }), patch);
  const r = await patchClaim(id, patch as Json);
  check("the claims route accepts the visit's patch", r.status === 200, r.json);
  const claim = await claimOf(id);
  check("claim: line 1 Completed, Mona at her usual 30% (18 on 60), treated 2026-10-08", claim?.lineStatus[1] === "Completed" && claim?.dentists[1]?.staffId === "mona" && claim?.dentists[1]?.share === 18 && claim?.treatedDate === "2026-10-08", claim && { ls: claim.lineStatus, d: claim.dentists[1], t: claim.treatedDate });
  const rows = await rowsOf(id);
  const bitewing = rows.find((x) => x.serviceCode === "D0270");
  check("the bitewing charge now names Mona with her share", bitewing?.doctorId === "mona" && bitewing?.doctorCommissionAmount === 18, bitewing);
  const note = bitewing ? await getDoc("clinical_notes", bitewing.clinicalNoteId) : null;
  check("the bitewing's clinical note is Completed", note?.status === "Completed", note?.status);
  // Payroll moves the work to October; the books must move with it, or Finance and payroll disagree.
  const octPay = insuranceWorkByStaff([claim!], {}, { start: "2026-10-01", end: "2026-10-31" });
  check("October payroll pays Mona's bitewing share", octPay.get("mona")?.total === 18, octPay.get("mona"));
  check("[expect] the bitewing charge in the books is dated the visit day (2026-10-08), like payroll", bitewing?.date === "2026-10-08", { ledgerDate: bitewing?.date, claimTreatedDate: claim?.treatedDate });
  const oct = await booksBetween("2026-10-01", "2026-10-31");
  const octReport = buildPayerReport(oct.procedures.filter((p) => p.claimId === id), [], await payersNow());
  const metOct = octReport.payers.find((p) => p.payerId === "metlife");
  check("[expect] October's payer report counts the October work it pays Mona for", (metOct?.cases ?? 0) >= 1, { metlifeCasesInOctober: metOct?.cases ?? 0 });
}

// =====================================================================================================
scenario("I28", "The same MetLife paper is saved twice (two receptionists), then once more for the wrong patient");
// =====================================================================================================
{
  await newPatient("p28", "Hany Scenario");
  await newPatient("p28b", "Other Scenario");
  const paper = metlifePaper("D7000028", "02/10/2026", FIVE.slice(0, 3), "HANY SCENARIO");
  const [a, b] = await Promise.all([
    saveClaim({ payerId: "metlife", extraction: paper, patient: { id: "p28" } }),
    saveClaim({ payerId: "metlife", extraction: paper, patient: { id: "p28" } }),
  ]);
  const codes = [a.status, b.status].sort();
  check("exactly one save wins, the other is told it is a duplicate (201 + 409)", codes[0] === 201 && codes[1] === 409, [a.json, b.json]);
  const dup = a.status === 409 ? a.json : b.json;
  check("the duplicate answer names the saved claim", dup.duplicate?.claimId === "metlife_d7000028", dup);
  check("only one set of treatment rows (3)", (await rowsOf("metlife_d7000028")).length === 3);
  const wrong = await saveClaim({ payerId: "metlife", extraction: { ...paper, header: { ...paper.header, approvalNumber: " d7000028 " } }, patient: { id: "p28b" } });
  check("the same number typed differently for another patient is still a duplicate", wrong.status === 409 && wrong.json.duplicate?.claimId === "metlife_d7000028", wrong.json);
  check("nothing was charged to the other patient", (await ledgerWhere("patientId", "p28b")).length === 0);
}

// =====================================================================================================
scenario("I29", "A NextCare paper saved on the same claim record: two services refused, two approved");
// =====================================================================================================
let C29 = "";
{
  await newPatient("p29", "Mariam Scenario");
  const extraction = normalizeNextcare(fromNextcareModel(NEXTCARE_RAW));
  const { status, json } = await saveClaim({ payerId: "nextcare", extraction, patient: { id: "p29" }, dentistId: "mona" });
  check("saved (201) under a nextcare_ claim id", status === 201 && String(json.claimId).startsWith("nextcare_"), json);
  C29 = json.claimId;
  const claim = await claimOf(C29);
  check("insurer nextcare, 4 service lines (the printed total row dropped)", claim?.insurer === "nextcare" && claim?.lines.length === 4, claim?.lines.length);
  check("totals: approved 1673.25, no patient share", claim?.totals.approved === 1673.25 && claim?.totals.patientShare === 0, claim?.totals);
  const rows = await rowsOf(C29);
  check("only the two approved services become charges", rows.length === 2 && approx(rows.reduce((t, r) => t + r.amount, 0), 1673.25), rows.map((r) => r.amount));
  check("charges are NextCare's, dated the approval day 2026-07-04", rows.every((r) => r.payerId === "nextcare" && r.date === "2026-07-04"));
  const filling = rows.find((r) => r.amount === 1610);
  check("the composite charge names its teeth from the conditions (L.R 4-6 = 44,46)", typeof filling?.description === "string" && /T: 44,46/.test(filling.description), filling?.description);
  const monaWork = insuranceWorkByStaff([claim!]).get("mona");
  check("refused lines earn Mona nothing; payroll = 30% of the two approved services", monaWork?.entries.filter((e) => e.share > 0).length === 2 && approx(monaWork?.total ?? 0, (claim!.dentists[2]?.share ?? 0) + (claim!.dentists[3]?.share ?? 0)) && (claim!.dentists[0]?.share ?? 0) === 0, monaWork);
  const patient = await getDoc("patients", "p29");
  check("membership: card number and the bracket code AB12 as member number", patient?.insurance?.nextcare?.memberNumber === "AB12" && patient?.insurance?.nextcare?.certificateNumber === "AB12-CD34-EF56-7890", patient?.insurance);
  const july = buildNextcareStatement({ claims: [claim!], payerId: "nextcare", payerName: "NextCare", from: "2026-07-01", to: "2026-07-31", wording: {} });
  check("July statement: one case, 1673.25, printed as (AB12)patient", july.cases.length === 1 && july.total === 1673.25 && july.cases[0].memberNumber === "AB12", july);
}

// =====================================================================================================
scenario("I30", "The NextCare filling is actually done in October: the statement moves, do the books?");
// =====================================================================================================
{
  const before = await claimOf(C29);
  const appt = { id: "a30", claimLinks: [{ claimId: C29, claimLine: 2 }], status: "Completed", date: "2026-10-06", time: "12:00", doctorId: "mona" };
  const patch = lineSyncPatch(before!, appt);
  check("the visit moves only the treated date (line already Completed, same dentist)", JSON.stringify(patch) === JSON.stringify({ treatedDate: "2026-10-06" }), patch);
  const r = await patchClaim(C29, patch as Json);
  check("patched", r.status === 200, r.json);
  const after = await claimOf(C29);
  const oct = buildNextcareStatement({ claims: [after!], payerId: "nextcare", payerName: "NextCare", from: "2026-10-01", to: "2026-10-31", wording: {} });
  const jul = buildNextcareStatement({ claims: [after!], payerId: "nextcare", payerName: "NextCare", from: "2026-07-01", to: "2026-07-31", wording: {} });
  check("NextCare's October sheet now bills it; July's no longer does", oct.total === 1673.25 && jul.cases.length === 0, { oct: oct.total, jul: jul.cases.length });
  const rows = await rowsOf(C29);
  check("[expect] the charges in the books follow to 2026-10-06 (Finance agrees with the sheet)", rows.every((x) => x.date === "2026-10-06"), rows.map((x) => x.date));
  const octBooks = await booksBetween("2026-10-01", "2026-10-31");
  const rep = buildPayerReport(octBooks.procedures, [], await payersNow()).payers.find((p) => p.payerId === "nextcare");
  check("[expect] October payer report shows the 1673.25 NextCare billed in October", approx(rep?.charged ?? 0, 1673.25), { nextcareChargedOctober: rep?.charged });
}

// =====================================================================================================
scenario("I31", "Month-end payer report for August: one patient, MetLife paper + AXA filling + private crown");
// =====================================================================================================
{
  await newPatient("p31", "Samir Scenario");
  const met = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000031", "10/08/2026", FIVE, "SAMIR SCENARIO"), patient: { id: "p31" }, dentistId: "omar" });
  check("MetLife paper saved for August", met.status === 201, met.json);
  const crown = await proc({ action: "create", patientId: "p31", procedures: ["Crown"], doctorId: "omar", payerId: "private", date: "2026-08-10", status: "Completed" });
  const fill = await proc({ action: "create", patientId: "p31", procedures: ["Composite Filling"], selectedTeeth: ["16", "17"], doctorId: "omar", payerId: "axa", date: "2026-08-10", status: "Completed" });
  check("private crown 2000 and AXA filling 2x450 recorded", crown.json.cost === 2000 && fill.json.cost === 900, [crown.json, fill.json]);
  const pay = await money({ action: "create-payment", patientId: "p31", procedureId: crown.json.ledgerId, amount: 2000, date: "2026-08-12", method: "Cash" });
  check("patient pays the crown in full", pay.status === 200, pay.json);
  const books = await booksBetween("2026-08-01", "2026-08-31");
  const report = buildPayerReport(books.procedures, books.payments, await payersNow());
  const by = (id: string) => report.payers.find((p) => p.payerId === id)!;
  check("Private: 1 case, charged 2000, collected 2000, commission 800 (Omar 40%)", by("private").cases === 1 && by("private").charged === 2000 && by("private").collected === 2000 && by("private").commission === 800, by("private"));
  check("AXA: 1 case, charged 900, nothing collected, no commission until paid", by("axa").cases === 1 && by("axa").charged === 900 && by("axa").collected === 0 && by("axa").commission === 0, by("axa"));
  check("MetLife: 5 cases, charged 1260, commission 315 (Omar 25% on approved)", by("metlife").cases === 5 && by("metlife").charged === 1260 && by("metlife").commission === 315, by("metlife"));
  check("Omar's MetLife row shows rate 25", by("metlife").doctors[0]?.doctorId === "omar" && by("metlife").doctors[0]?.ratePct === 25, by("metlife").doctors);
  check("one patient across three payers is one patient in the totals", report.totals.patients === 1 && by("axa").patients === 1 && by("metlife").patients === 1, report.totals);
  check("grand totals add up (charged 4160, collected 2000)", report.totals.charged === 4160 && report.totals.collected === 2000, report.totals);
  check("no unstamped rows", report.unstamped.procedures === 0 && report.unstamped.payments === 0, report.unstamped);
}

// =====================================================================================================
scenario("I32", "Same patient, same day: a private filling and an AXA crown, by the same dentist");
// =====================================================================================================
{
  await newPatient("p32", "Laila Scenario");
  const a = await proc({ action: "create", patientId: "p32", procedures: ["Composite Filling"], selectedTeeth: ["26"], doctorId: "omar", payerId: "private", date: "2026-10-05", status: "Completed" });
  const b = await proc({ action: "create", patientId: "p32", procedures: ["Crown"], doctorId: "omar", payerId: "axa", date: "2026-10-05", status: "Completed" });
  check("both recorded", a.status === 200 && b.status === 200, [a.json, b.json]);
  const ra = await getDoc("ledger", a.json.ledgerId);
  const rb = await getDoc("ledger", b.json.ledgerId);
  check("filling: Private, standard 600, Omar 40% = 240", ra?.payerId === "private" && ra?.cost === 600 && ra?.priceListId === "standard" && ra?.doctorCommissionPercentage === 40 && ra?.doctorCommissionAmount === 240, ra);
  check("crown: AXA Egypt, prefilled from the AXA list 1500, Omar at AXA's company rate 20% = 300", rb?.payerId === "axa" && rb?.payerName === "AXA Egypt" && rb?.cost === 1500 && rb?.priceListId === "list-axa" && rb?.doctorCommissionPercentage === 20 && rb?.doctorCommissionAmount === 300, rb);
  const na = await getDoc("clinical_notes", a.json.noteId);
  const nb = await getDoc("clinical_notes", b.json.noteId);
  check("each clinical note carries its own payer", na?.payerId === "private" && nb?.payerId === "axa");
  const rep = buildPayerReport([ra!, rb!], [], await payersNow());
  check("the report splits the visit: Private 600, AXA 1500", rep.payers.find((p) => p.payerId === "private")?.charged === 600 && rep.payers.find((p) => p.payerId === "axa")?.charged === 1500);
}

// =====================================================================================================
scenario("I33", "AXA price list prefills; the desk types a different price, then a free one");
// =====================================================================================================
{
  await newPatient("p33", "Tarek Scenario");
  const pre = await proc({ action: "create", patientId: "p33", procedures: ["Crown"], doctorId: "mona", payerId: "axa", date: "2026-10-05" });
  const typed = await proc({ action: "create", patientId: "p33", procedures: ["Crown"], doctorId: "mona", payerId: "axa", unitCost: 1800, date: "2026-10-05" });
  const free = await proc({ action: "create", patientId: "p33", procedures: ["Crown"], doctorId: "mona", payerId: "axa", unitCost: 0, date: "2026-10-05" });
  check("prefill from the AXA list: 1500", pre.json.cost === 1500, pre.json);
  check("typed price wins: 1800", typed.json.cost === 1800, typed.json);
  check("typed 0 = free: cost 0 and no charge in the books", free.status === 200 && free.json.cost === 0 && free.json.ledgerId === null, free.json);
  const freeNote = await getDoc("clinical_notes", free.json.noteId);
  check("the free crown is still on the patient's chart under AXA", freeNote?.payerId === "axa" && freeNote?.cost === 0 && freeNote?.ledgerId === null, freeNote);
  const typedRow = await getDoc("ledger", typed.json.ledgerId);
  check("typed row: list price 1800, no discount invented from the 1500 tariff", typedRow?.listPrice === 1800 && typedRow?.discountAmount === 0, typedRow);
  check("Mona earns her own AXA rate 35% (beats the company's 20%): 630", typedRow?.doctorCommissionPercentage === 35 && typedRow?.doctorCommissionAmount === 630, typedRow);
}

// =====================================================================================================
scenario("I34", "Any service to any payer: an X-ray AXA never priced is billed to AXA at the clinic price");
// =====================================================================================================
{
  // AXA's own list covers only crowns and fillings, and hides the X-ray from its menu.
  const payers = (await col("settings").doc("payers").get()).data()!.payers as Json[];
  await col("settings").doc("payers").set({ payers: payers.map((p) => (p.id === "axa" ? { ...p, services: ["svc-crown", "svc-fill"] } : p)) });
  await newPatient("p34", "Rana Scenario");
  const r = await proc({ action: "create", patientId: "p34", procedures: ["X-Ray"], doctorId: "omar", payerId: "axa", date: "2026-10-05" });
  const row = r.json.ledgerId ? await getDoc("ledger", r.json.ledgerId) : null;
  check("recorded (the owner's rule: any service, any payer)", r.status === 200, r.json);
  check("billed to AXA, not silently moved to Private", row?.payerId === "axa", row?.payerId);
  check("priced at the standard 100 (AXA has no X-ray price)", row?.cost === 100, row?.cost);
  await col("settings").doc("payers").set({ payers });
}

// =====================================================================================================
scenario("I35", "Company dentist rate vs a dentist's own rate, and the payment that follows");
// =====================================================================================================
{
  await newPatient("p35", "Yasser Scenario");
  const omarAxa = await proc({ action: "create", patientId: "p35", procedures: ["Crown"], doctorId: "omar", payerId: "axa", date: "2026-10-06" });
  const omarGasco = await proc({ action: "create", patientId: "p35", procedures: ["Crown"], doctorId: "omar", payerId: "gasco", date: "2026-10-06" });
  const rAxa = await getDoc("ledger", omarAxa.json.ledgerId);
  const rGas = await getDoc("ledger", omarGasco.json.ledgerId);
  check("Omar on AXA: company rate 20%", rAxa?.doctorCommissionPercentage === 20, rAxa?.doctorCommissionPercentage);
  check("Omar on GASCO: company rate 0% is a real zero, not 'use his 40%'", rGas?.doctorCommissionPercentage === 0 && rGas?.doctorCommissionAmount === 0, rGas);
  const pay = await money({ action: "create-payment", patientId: "p35", procedureId: omarAxa.json.ledgerId, amount: 1500, date: "2026-10-06", method: "Cash" });
  const p = pay.json.id ? await getDoc("ledger", pay.json.id) : null;
  check("the AXA payment carries AXA's payer and Omar at 20% = 300", p?.payerId === "axa" && p?.doctorId === "omar" && p?.doctorCommissionPercentage === 20 && p?.doctorCommissionAmount === 300, p);
  const payG = await money({ action: "create-payment", patientId: "p35", procedureId: omarGasco.json.ledgerId, amount: 1200, date: "2026-10-06", method: "Cash" });
  const pg = payG.json.id ? await getDoc("ledger", payG.json.id) : null;
  check("the GASCO payment pays Omar nothing", pg?.doctorCommissionAmount === 0 && pg?.payerId === "gasco", pg);
}

// =====================================================================================================
scenario("I36", "GASCO contract company: no approval paper, the work still reaches report and statement");
// =====================================================================================================
{
  await newPatient("p36", "Fathy Scenario", { insurance: { gasco: { memberNumber: "G-7781" } } });
  const t = await proc({ action: "create", patientId: "p36", procedures: ["Crown"], doctorId: "mona", payerId: "gasco", date: "2026-10-07", status: "Completed" });
  const row = await getDoc("ledger", t.json.ledgerId);
  check("GASCO crown priced from GASCO's list: 1200", row?.cost === 1200 && row?.payerName === "GASCO", row);
  const paper = await saveClaim({ payerId: "gasco", extraction: metlifePaper("D7000036", "07/10/2026", FIVE.slice(0, 1)), patient: { id: "p36" } });
  check("there is no approval paper to save for GASCO (403, no document format)", paper.status === 403, paper.json);
  const books = await booksBetween("2026-10-01", "2026-10-31");
  const rep = buildPayerReport(books.procedures, books.payments, await payersNow()).payers.find((p) => p.payerId === "gasco");
  check("GASCO appears in October's payer report with the crown", (rep?.cases ?? 0) >= 1 && (rep?.patientList ?? []).some((x) => x.patientId === "p36"), rep);
  const members = new Map<string, string>();
  for (const d of (await col("patients").get()).docs) {
    const m = readMemberNumbers(d.data())["gasco"];
    if (m) members.set(d.id, m);
  }
  const st = buildInsuranceStatement({ rows: books.procedures as never, payerId: "gasco", payerName: "GASCO", month: "2026-10", memberNumbers: members });
  const c36 = st.cases.find((c) => c.patientId === "p36");
  check("GASCO's October statement lists the crown at 1200 with member number G-7781", c36?.subtotal === 1200 && c36?.memberNumber === "G-7781", c36);
}

// =====================================================================================================
scenario("I37", "Bupa has no price list: the treatment is priced at the clinic's own price, billed to Bupa");
// =====================================================================================================
{
  await newPatient("p37", "Huda Scenario");
  const t = await proc({ action: "create", patientId: "p37", procedures: ["Crown"], doctorId: "mona", payerId: "bupa", date: "2026-10-07" });
  const row = await getDoc("ledger", t.json.ledgerId);
  check("Bupa crown: standard 2000, standard list, payer Bupa", row?.cost === 2000 && row?.priceListId === "standard" && row?.payerId === "bupa" && row?.payerName === "Bupa", row);
  check("Mona's usual 30% (no Bupa rate anywhere)", row?.doctorCommissionPercentage === 30, row?.doctorCommissionPercentage);
}

// =====================================================================================================
scenario("I38", "A list called 'AXA' that no payer points to: prices prefill, the bill is Private");
// =====================================================================================================
{
  await newPatient("p38", "Omnia Scenario");
  const t = await proc({ action: "create", patientId: "p38", procedures: ["Crown"], doctorId: "omar", priceListId: "list-orphan", date: "2026-10-07" });
  const row = await getDoc("ledger", t.json.ledgerId);
  check("priced from the 'AXA' list: 1700", row?.cost === 1700 && row?.priceListName === "AXA", row);
  check("billed as Private, not AXA Egypt", row?.payerId === "private" && row?.payerName === "Private", row?.payerId);
  check("Omar's private 40%", row?.doctorCommissionPercentage === 40, row?.doctorCommissionPercentage);
}

// =====================================================================================================
scenario("I39", "Allianz is retired: its old cases keep the name, new work cannot be billed to it");
// =====================================================================================================
let N39 = "";
let L39 = "";
{
  await newPatient("p39", "Wael Scenario");
  const t = await proc({ action: "create", patientId: "p39", procedures: ["Crown"], doctorId: "omar", payerId: "allianz", date: "2026-09-15", status: "Planned" });
  N39 = t.json.noteId;
  L39 = t.json.ledgerId;
  check("an Allianz crown recorded in September (1600)", t.json.cost === 1600, t.json);
  // Settings → the list stops being an insurance company's list: the payer is retired, not deleted.
  const payers = (await col("settings").doc("payers").get()).data()!.payers as Json[];
  await col("settings").doc("payers").set({ payers: payers.map((p) => (p.id === "allianz" ? { ...p, active: false } : p)) });
  const row = await getDoc("ledger", L39);
  check("the old charge still reads Allianz", row?.payerId === "allianz" && row?.payerName === "Allianz" && payerOf(row!).payerName === "Allianz");
  const sept = await booksBetween("2026-09-01", "2026-09-30");
  const rep = buildPayerReport(sept.procedures, sept.payments, await payersNow());
  check("September's payer report still has an Allianz column with the crown", rep.payers.some((p) => p.payerId === "allianz" && p.payerName === "Allianz" && p.charged === 1600), rep.payers.map((p) => [p.payerId, p.charged]));
  const fresh = await proc({ action: "create", patientId: "p39", procedures: ["Crown"], doctorId: "omar", payerId: "allianz", date: "2026-10-07" });
  check("new work naming the retired payer is refused (400)", fresh.status === 400 && /payer/i.test(fresh.json.error ?? ""), fresh.json);
  const onList = await proc({ action: "create", patientId: "p39", procedures: ["Crown"], doctorId: "omar", priceListId: "list-allianz", date: "2026-10-07" });
  const onListRow = await getDoc("ledger", onList.json.ledgerId);
  check("charged on the retired company's list without a payer: Private (by the owner's rule)", onListRow?.payerId === "private", onListRow?.payerId);
}

// =====================================================================================================
scenario("I40", "Marking the old Allianz crown Completed after Allianz was retired (web editor, then phone)");
// =====================================================================================================
{
  const note = (await getDoc("clinical_notes", N39))!;
  // The web editor reopens the note on its stored payer (shown as "Allianz (retired)") and re-sends it.
  const web = await proc({
    action: "update", noteId: N39, patientId: "p39", procedures: note.procedures, selectedTeeth: [], tooth: note.tooth,
    unitCost: note.unitCost, doctorId: "omar", status: "Completed", note: "", date: note.date,
    payerId: note.payerId, priceListId: note.priceListId, discountMode: "none", discountValue: null, discountReason: null,
  });
  check("[expect] the web edit of a retired insurer's old treatment saves", web.status === 200, web.json);
  const afterWeb = await getDoc("ledger", L39);
  check("[expect] and the charge still says Allianz, 1600", afterWeb?.payerId === "allianz" && afterWeb?.payerName === "Allianz" && afterWeb?.cost === 1600, afterWeb && { payerId: afterWeb.payerId, cost: afterWeb.cost });
  // The phone's editor sends no payer at all.
  const phone = await proc({ action: "update", noteId: N39, patientId: "p39", procedures: note.procedures, unitCost: note.unitCost, doctorId: "omar", status: "Completed", date: note.date, priceListId: note.priceListId });
  const afterPhone = await getDoc("ledger", L39);
  check("phone edit saves", phone.status === 200, phone.json);
  check("[expect] the phone edit keeps the old case on Allianz (history keeps its stamped name)", afterPhone?.payerId === "allianz" && afterPhone?.payerName === "Allianz", { payerId: afterPhone?.payerId, payerName: afterPhone?.payerName, rate: afterPhone?.doctorCommissionPercentage });
}

// =====================================================================================================
scenario("I41", "Deleting price lists: VIP with only prices typed vs GASCO with recorded work");
// =====================================================================================================
{
  // countListUsage (lib/priceListUsage, client SDK) asks exactly this of ledger + clinical_notes.
  const usage = async (listId: string) => {
    const [l, n] = await Promise.all([
      col("ledger").where("priceListId", "==", listId).count().get(),
      col("clinical_notes").where("priceListId", "==", listId).count().get(),
    ]);
    return l.data().count + n.data().count;
  };
  check("VIP (prices only, nothing recorded) is free to delete", (await usage("list-vip")) === 0);
  check("GASCO has recorded work, so it can only be deactivated", (await usage("list-gasco")) > 0);
  await newPatient("p41", "Free Scenario");
  const free = await proc({ action: "create", patientId: "p41", procedures: ["Crown"], doctorId: "omar", priceListId: "list-vip", unitCost: 0, date: "2026-10-07" });
  check("a free (unbilled) treatment on VIP is still recorded work on VIP", free.status === 200 && (await usage("list-vip")) === 1, free.json);
  // Deactivate GASCO's list: old rows keep it, new work naming it falls back to the clinic's default.
  const lists = (await col("settings").doc("price_lists").get()).data()!.lists as Json[];
  await col("settings").doc("price_lists").set({ lists: lists.map((l) => (l.id === "list-gasco" ? { ...l, active: false } : l)) });
  const after = await proc({ action: "create", patientId: "p41", procedures: ["Crown"], doctorId: "omar", priceListId: "list-gasco", date: "2026-10-07" });
  const row = await getDoc("ledger", after.json.ledgerId);
  check("a request naming the deactivated list does not resurrect its 1200 tariff", row?.priceListId !== "list-gasco" && row?.cost !== 1200, row && { list: row.priceListId, cost: row.cost, payer: row.payerId });
  const old = (await ledgerWhere("patientId", "p36"))[0];
  check("the September/October GASCO charge keeps its list name and price", old?.priceListId === "list-gasco" && old?.priceListName === "GASCO" && old?.cost === 1200, old);
  await col("settings").doc("price_lists").set({ lists });
}

// =====================================================================================================
scenario("I42", "An approval for a patient who is later deleted, restored, and the paper re-saved");
// =====================================================================================================
{
  await newPatient("p42", "Deleted Scenario");
  const saved = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000042", "03/10/2026", FIVE.slice(0, 2), "DELETED SCENARIO"), patient: { id: "p42" } });
  const id = saved.json.claimId as string;
  check("approval saved with 2 charges", saved.status === 201 && (await rowsOf(id)).length === 2, saved.json);
  const del = await call(deleteRoute.POST, "POST", "/api/records/delete", { clinicId: CLINIC, items: [{ collection: "patients", documentId: "p42" }], acknowledgeOrphans: true });
  check("the patient is deleted with their file", del.json.results?.[0]?.status === "deleted", del.json);
  check("the approval and its MetLife charges leave the books", !(await col("insurance_claims").doc(id).get()).exists && (await rowsOf(id)).length === 0);
  const oct = await booksBetween("2026-10-01", "2026-10-31");
  check("October's MetLife column no longer counts them", !oct.procedures.some((r) => r.claimId === id));
  const again = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000042", "03/10/2026", FIVE.slice(0, 2), "DELETED SCENARIO"), patient: { create: { name: "Deleted Scenario" } } });
  check("re-saving the paper is refused and points at Recently Deleted", again.status === 409 && again.json.inBin?.withParent === "Deleted Scenario", again.json);
  const res = await call(restoreRoute.POST, "POST", "/api/records/restore", { clinicId: CLINIC, entryId: liveEntryId(CLINIC, "patients", "p42") });
  check("restoring the patient brings the approval and both charges back", res.status === 200 && (await col("insurance_claims").doc(id).get()).exists && (await rowsOf(id)).length === 2, res.json);
}

// =====================================================================================================
scenario("I43", "October MetLife statement: treated, held-back and cancelled papers; member numbers");
// =====================================================================================================
{
  await newPatient("p43", "Statement Scenario");
  await col("settings").doc("insurance_wording").set({ metlife: { D0120: { ar: "كشف" } } });
  const t = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000043", "04/10/2026", FIVE.slice(0, 2), "STATEMENT SCENARIO", "777", "2"), patient: { id: "p43" } });
  const h = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000044", "04/10/2026", FIVE.slice(2, 3), "STATEMENT SCENARIO", "777", "2"), patient: { id: "p43" }, status: "approved" });
  const x = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000045", "04/10/2026", FIVE.slice(3, 4), "STATEMENT SCENARIO", "777", "2"), patient: { id: "p43" } });
  check("three papers saved (treated, approved, treated)", t.status === 201 && h.status === 201 && x.status === 201, [t.json, h.json, x.json]);
  check("the held (approved) paper wrote no charges yet", (await rowsOf("metlife_d7000044")).length === 0);
  const cancel = await patchClaim("metlife_d7000045", { status: "cancelled" });
  check("cancelling the third paper removes its charge", cancel.status === 200 && (await rowsOf("metlife_d7000045")).length === 0, cancel.json);
  const mine = (await allClaims()).filter((c) => c.patientId === "p43");
  const wording = { D0120: "كشف" };
  const st = buildMetlifeStatement({ claims: mine, from: "2026-10-01", to: "2026-10-31", wording });
  check("one case on the sheet, one held back", st.cases.length === 1 && st.heldBack === 1, st);
  const c = st.cases[0];
  check("the case: approval D7000043, certificate 777 / dependent 2, dated 2026-10-04", c?.approvalNumber === "D7000043" && c?.certificateNumber === "777" && c?.dependentCode === "2" && c?.date === "2026-10-04", c);
  check("lines in the clinic's wording where it has one; subtotal 120", c?.lines[0].text === "كشف" && c?.lines[1].text === "BITEWING - SINGLE FILM" && c?.subtotal === 120, c?.lines);
  check("the uncovered wording is reported for the desk", st.missingWording.includes("D0270"), st.missingWording);
  const patient = await getDoc("patients", "p43");
  check("the patient's member number is 777/2", readMemberNumbers(patient!).metlife === "777/2", patient?.insurance);
  // the approved paper treated later: its charges appear dated the day it is marked
  const treat = await patchClaim("metlife_d7000044", { status: "treated", treatedDate: "2026-10-07" });
  const rows = await rowsOf("metlife_d7000044");
  check("marking the held paper treated writes its charge dated 2026-10-07", treat.status === 200 && rows.length === 1 && rows[0].date === "2026-10-07", rows.map((r) => r.date));
}

// =====================================================================================================
scenario("I44", "Crown with a co-pay: MetLife approves 500 of 2700, the patient pays 100");
// =====================================================================================================
let C44 = "";
{
  await newPatient("p44", "Copay Scenario");
  const saved = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000046", "05/10/2026", [{ code: "D2740", desc: "CROWN - PORCELAIN", req: 2700, appr: 500, share: 100 }], "COPAY SCENARIO"), patient: { id: "p44" } });
  C44 = saved.json.claimId;
  check("saved", saved.status === 201, saved.json);
  const [row] = await rowsOf(C44);
  check("charge 600 = 500 insurer + 100 patient; list 2700, discount 2100 with MetLife's reason", row?.amount === 600 && row?.insurerCovered === 500 && row?.patientShare === 100 && row?.listPrice === 2700 && row?.discountAmount === 2100 && /MetLife approved 500 of 2700/.test(row?.discountReason ?? ""), row);
  check("the patient owes only their 100 while MetLife owes 500", patientPortion(row) === 100 && insurerOutstanding(row) === 500);
  const noDentist = await asUser(CASHIER, () => patchClaim(C44, { collectShare: true }));
  check("collecting the share with no dentist named is refused (409)", noDentist.status === 409 && /dentist/i.test(noDentist.json.error ?? ""), noDentist.json);
  const pick = await patchClaim(C44, { dentists: { 0: "mona" } });
  check("Mona picked (30% of 500 = 150)", pick.status === 200 && (await claimOf(C44))?.dentists[0]?.share === 150, pick.json);
  const share = await asUser(CASHIER, () => patchClaim(C44, { collectShare: true }));
  check("the cashier collects the 100 share", share.status === 200 && share.json.payments?.length === 1, share.json);
  const sharePay = share.json.payments ? await getDoc("ledger", share.json.payments[0]) : null;
  check("share payment: 100 Cash, MetLife-stamped, Mona named, no commission on it", sharePay?.paid === 100 && sharePay?.method === "Cash" && sharePay?.payerId === "metlife" && sharePay?.doctorId === "mona" && sharePay?.doctorCommissionAmount === 0, sharePay);
  const twice = await asUser(CASHIER, () => patchClaim(C44, { collectShare: true }));
  check("collecting again is refused", twice.status === 409, twice.json);
  const ins = await asUser(CASHIER, () => patchClaim(C44, { insurerPaid: true }));
  check("MetLife's payment recorded: 500 by Insurance", ins.status === 200, ins.json);
  const insPay = ins.json.payments ? await getDoc("ledger", ins.json.payments[0]) : null;
  check("insurer payment 500, method Insurance, category Insurance Payment", insPay?.paid === 500 && insPay?.method === "Insurance" && insPay?.category === "Insurance Payment", insPay);
  const settled = await getDoc("ledger", row.id);
  check("the crown is fully paid (600) and stamped insurer-paid", settled?.paid === 600 && !!settled?.insurerPaidAt && insurerOutstanding(settled) === 0, settled);
  const claim = await claimOf(C44);
  check("the claim records both: share 100, insurer 500", claim?.shareCollected?.amount === 100 && claim?.insurerPaid?.amount === 500, claim && { s: claim.shareCollected, i: claim.insurerPaid });
  const books = await booksBetween("2026-10-01", "2026-10-31");
  const rep = buildPayerReport(books.procedures.filter((r) => r.claimId === C44), books.payments.filter((r) => r.claimId === C44), await payersNow());
  const m = rep.payers.find((p) => p.payerId === "metlife")!;
  check("payer report: charged 600, collected 600, commission 150 once (not on the payments too)", m.charged === 600 && m.collected === 600 && m.commission === 150, m);
}

// =====================================================================================================
scenario("I45", "The approval is corrected after treatment: the inlay was approved for 400, not 600");
// =====================================================================================================
{
  await newPatient("p45", "Edit Scenario");
  const saved = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000047", "05/10/2026", FIVE.slice(0, 3), "EDIT SCENARIO"), patient: { id: "p45" }, dentistId: "omar" });
  const id = saved.json.claimId as string;
  const before = await rowsOf(id);
  check("saved with 3 charges, Omar 150 on the 600 inlay", before.length === 3 && before.some((r) => r.amount === 600 && r.doctorCommissionAmount === 150));
  const claim = (await claimOf(id))!;
  const lines = claim.lines.map((l, i) => (i === 2 ? { ...l, approvedAmount: 400 } : l));
  const edit = await patchClaim(id, { lines, metlife: { approvedTotal: 520 } });
  check("the edit saves while nothing is paid", edit.status === 200, edit.json);
  const after = await rowsOf(id);
  const inlay = after.find((r) => r.serviceCode === "D2650");
  check("the old charges are replaced: 3 rows, inlay now 400", after.length === 3 && inlay?.amount === 400 && !after.some((r) => before.some((b) => b.id === r.id)), after.map((r) => r.amount));
  const edited = await claimOf(id);
  check("claim totals follow: approved 520", edited?.totals.approved === 520, edited?.totals);
  check("[expect] Omar's share follows the new approved amount (25% of 400 = 100)", edited?.dentists[2]?.share === 100 && inlay?.doctorCommissionAmount === 100, { claimShare: edited?.dentists[2]?.share, rowShare: inlay?.doctorCommissionAmount, rowCost: inlay?.amount });
  const pay = await money({ action: "create-payment", patientId: "p45", procedureId: after[0].id, amount: 10, date: "2026-10-07" });
  check("a 10 EGP payment is taken against one of the charges", pay.status === 200, pay.json);
  const again = await patchClaim(id, { lines: claim.lines, metlife: { approvedTotal: 720 } });
  check("editing the paper once money sits on it is refused (409)", again.status === 409, again.json);
}

// =====================================================================================================
scenario("I46", "A paper with a rejected line (approved 0) beside approved ones");
// =====================================================================================================
{
  await newPatient("p46", "Zero Scenario");
  const lines: PaperLine[] = [
    { code: "D0120", desc: "PERIODIC ORAL EVALUATION", req: 60, appr: 60 },
    { code: "D9999", desc: "WHITENING", req: 1500, appr: 0 },
    { code: "D0270", desc: "BITEWING - SINGLE FILM", req: 60, appr: 60 },
  ];
  const saved = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000048", "05/10/2026", lines, "ZERO SCENARIO"), patient: { id: "p46" }, dentistId: "omar" });
  const id = saved.json.claimId as string;
  check("saved", saved.status === 201, saved.json);
  const claim = (await claimOf(id))!;
  check("the rejected line writes no charge: 2 charges, ledgerIds on lines 0 and 2 only", (await rowsOf(id)).length === 2 && Object.keys(claim.ledgerIds).sort().join() === "0,2", claim.ledgerIds);
  check("the rejected line earns nothing (share 0)", claim.dentists[1]?.share === 0, claim.dentists[1]);
  const st = buildMetlifeStatement({ claims: [claim], from: "2026-10-01", to: "2026-10-31", wording: {} });
  check("the MetLife sheet still prints the rejected line at 0; subtotal 120", st.cases[0]?.lines.length === 3 && st.cases[0]?.lines[1].approved === 0 && st.cases[0]?.subtotal === 120, st.cases[0]);
  const ins = await patchClaim(id, { insurerPaid: true });
  check("the insurer's payment settles the two real charges (120)", ins.status === 200 && ins.json.payments?.length === 2, ins.json);
  check("payroll pays Omar 30 (two lines at 25% of 60)", insuranceWorkByStaff([claim]).get("omar")?.total === 30);
  const un = unassignedLines([{ ...claim, dentists: {} }]);
  check("with nobody assigned, the unassigned-money figure is 120 (the 0 line adds nothing)", un.approved === 120, un);
}

// =====================================================================================================
scenario("I47", "Paper assigned to Dr Omar; Dr Mona does the work; then the dentist corrects it from the chart");
// =====================================================================================================
{
  await newPatient("p47", "Switch Scenario");
  const saved = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000049", "06/10/2026", [{ code: "D2650", desc: "INLAY - RESIN-BASED COMPOSITE", req: 600, appr: 500, share: 100 }], "SWITCH SCENARIO"), patient: { id: "p47" }, dentistId: "omar", lines: { 0: { status: "Planned" } } });
  const id = saved.json.claimId as string;
  const [row] = await rowsOf(id);
  check("Omar on the inlay at 25% of 500 = 125", row?.doctorId === "omar" && row?.doctorCommissionAmount === 125, row);
  const cash = await asUser(CASHIER, () => money({ action: "create-payment", patientId: "p47", procedureId: row.id, amount: 100, date: "2026-10-06" }));
  check("the patient pays their 100 at the Finance counter", cash.status === 200, cash.json);
  const appt = { id: "a47", claimLinks: [{ claimId: id, claimLine: 0 }], status: "Checking Out", date: "2026-10-08", doctorId: "mona" };
  const patch = lineSyncPatch((await claimOf(id))!, appt);
  const r = await patchClaim(id, patch as Json);
  check("Mona finishes the visit: patch applied", r.status === 200 && !!patch?.dentists, { patch, res: r.json });
  const claim = await claimOf(id);
  const after = await getDoc("ledger", row.id);
  check("the line is Completed and Mona's (30% of 500 = 150)", claim?.lineStatus[0] === "Completed" && claim?.dentists[0]?.staffId === "mona" && claim?.dentists[0]?.share === 150, claim?.dentists);
  check("the charge names Mona with 150, clinic profit 450", after?.doctorId === "mona" && after?.doctorCommissionAmount === 150 && after?.clinicProfit === 450, after);
  const receipt = cash.json.id ? await getDoc("ledger", cash.json.id) : null;
  check("the receipt already taken now names Mona too", receipt?.doctorId === "mona", receipt?.doctorId);
  const pay = insuranceWorkByStaff([claim!]);
  check("payroll credits Mona, not Omar", pay.get("mona")?.total === 150 && !pay.get("omar"), [...pay.keys()]);
  // Omar says it was his after all, from the clinical chart.
  const note = (await getDoc("clinical_notes", row.clinicalNoteId))!;
  const chart = await proc({ action: "update", noteId: row.clinicalNoteId, procedures: note.procedures, tooth: note.tooth, doctorId: "omar", note: note.note });
  const back = await claimOf(id);
  check("the chart edit moves the line back to Omar on the approval (125)", chart.status === 200 && back?.dentists[0]?.staffId === "omar" && back?.dentists[0]?.share === 125, { res: chart.json, d: back?.dentists[0] });
  const nurse = await patchClaim(id, { dentists: { 0: "nurse" } });
  check("a nurse cannot be put on an insurance line (400)", nurse.status === 400, nurse.json);
}

// =====================================================================================================
scenario("I48", "The patient pays an insurer-covered row in cash at Finance; then MetLife pays");
// =====================================================================================================
{
  await newPatient("p48", "Cash Scenario");
  const saved = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000050", "06/10/2026", FIVE.slice(2, 4), "CASH SCENARIO"), patient: { id: "p48" }, dentistId: "omar" });
  const id = saved.json.claimId as string;
  const rows = await rowsOf(id);
  const pulp = rows.find((r) => r.serviceCode === "D3120")!;
  const inlay = rows.find((r) => r.serviceCode === "D2650")!;
  const over = await money({ action: "create-payment", patientId: "p48", procedureId: pulp.id, amount: 350, date: "2026-10-07" });
  check("paying 350 on a 300 charge is refused (over-allocation)", over.status === 409 || over.status === 400, over.json);
  const cash = await money({ action: "create-payment", patientId: "p48", procedureId: pulp.id, amount: 300, date: "2026-10-07" });
  const p = cash.json.id ? await getDoc("ledger", cash.json.id) : null;
  check("300 cash taken; the payment carries no commission (the share is on the charge)", cash.status === 200 && p?.doctorCommissionAmount === 0 && p?.payerId === "metlife", p);
  const ins = await patchClaim(id, { insurerPaid: true });
  const insRows = (ins.json.payments ?? []) as string[];
  const insDocs = await Promise.all(insRows.map((x) => getDoc("ledger", x)));
  check("MetLife's settlement pays only what is still open: 600 on the inlay, nothing on the pulp cap", ins.status === 200 && insDocs.length === 1 && insDocs[0]?.paid === 600 && insDocs[0]?.procedureId === inlay.id, insDocs.map((d) => [d?.procedureId, d?.paid]));
  const pulpAfter = await getDoc("ledger", pulp.id);
  check("both rows are stamped insurer-paid; the pulp cap paid 300, never 600", pulpAfter?.paid === 300 && !!pulpAfter?.insurerPaidAt, pulpAfter);
  check("the claim records MetLife's 600, not the paper's 900", (await claimOf(id))?.insurerPaid?.amount === 600);
}

// =====================================================================================================
scenario("I49", "Approval rows are locked outside the Insurance tab (Finance + chart), but a visit move?");
// =====================================================================================================
{
  const [row] = await rowsOf(C26);
  const price = await money({ action: "update", id: row.id, patch: { amount: 10, cost: 10 } });
  check("Finance cannot reprice an approval's charge (refused, 400)", price.status === 400 && /Insurance tab/.test(price.json.error ?? ""), price.json);
  const payerMove = await money({ action: "update", id: row.id, patch: { payerId: "private" } });
  check("Finance cannot move it to Private (refused, 400)", payerMove.status === 400 && /Insurance tab/.test(payerMove.json.error ?? ""), payerMove.json);
  const desc = await money({ action: "update", id: row.id, patch: { description: `${row.description} (checked)` } });
  check("its description may still be edited", desc.status === 200, desc.json);
  const note = (await getDoc("clinical_notes", row.clinicalNoteId))!;
  const reprice = await proc({ action: "update", noteId: row.clinicalNoteId, procedures: note.procedures, tooth: note.tooth, doctorId: note.doctorId, unitCost: 9999, note: note.note });
  check("the chart cannot reprice it (409)", reprice.status === 409, reprice.json);
  const del = await proc({ action: "delete", noteId: row.clinicalNoteId });
  check("the chart cannot delete it (409)", del.status === 409, del.json);
  await col("appointments").doc("a49").set({ patientId: "p26", date: "2026-10-09", time: "10:00", status: "Scheduled" });
  const move = await proc({ action: "move", noteId: row.clinicalNoteId, targetAppointmentId: "a49" });
  const moved = await getDoc("ledger", row.id);
  const claim = await claimOf(C26);
  check("[expect] moving an approval's treatment to another visit keeps the approval and the books on one date",
    move.status === 409 || (moved?.date === claim?.treatedDate),
    { moveStatus: move.status, ledgerDate: moved?.date, claimTreatedDate: claim?.treatedDate });
}

// =====================================================================================================
scenario("I50", "Who may do what: add-on off, no permission, cash without finance, other clinic");
// =====================================================================================================
{
  const locked = await call(claimsRoute.POST, "POST", "/api/insurance/claims", { clinicId: LOCKED_CLINIC, docId: "d50", payerId: "metlife", extraction: metlifePaper("D7000051", "06/10/2026", FIVE.slice(0, 1)), patient: { create: { name: "Nobody" } } });
  check("a clinic without the insurance add-on cannot save approvals (403 feature_locked)", locked.status === 403 && locked.json.reason === "feature_locked", locked.json);
  const noPerm = await asUser(OUTSIDER, () => saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000052", "06/10/2026", FIVE.slice(0, 1)), patient: { id: "p26" } }));
  check("staff without patients.edit cannot save approvals (403)", noPerm.status === 403, noPerm.json);
  const desk = await asUser(DESK, () => patchClaim(C26, { insurerPaid: true }));
  check("the desk without finance.add cannot record the insurer's money (403)", desk.status === 403, desk.json);
  const deskSave = await asUser(DESK, () => saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000053", "06/10/2026", FIVE.slice(0, 1), "KARIM SCENARIO"), patient: { id: "p26" } }));
  check("the desk with patients.edit can save an approval", deskSave.status === 201, deskSave.json);
  const elsewhere = await asUser(DESK, () => call(claimsRoute.PATCH, "PATCH", "/api/insurance/claims", { clinicId: LOCKED_CLINIC, claimId: C26, patch: { status: "sent" } }));
  check("the desk cannot touch another clinic's claims (403)", elsewhere.status === 403, elsewhere.json);
  const retired = await saveClaim({ payerId: "allianz", extraction: metlifePaper("D7000054", "06/10/2026", FIVE.slice(0, 1)), patient: { id: "p26" } });
  check("a retired payer takes no new approvals (403)", retired.status === 403, retired.json);
  const future = await saveClaim({ payerId: "metlife", extraction: metlifePaper("D7000055", "30/12/2026", FIVE.slice(0, 1), "KARIM SCENARIO"), patient: { id: "p26" } });
  check("a paper dated in the future fails the hard checks (400)", future.status === 400 && Array.isArray(future.json.checks), future.json.error);
}

await wipe();
authServer.close();
console.log(`\ninsurance scenarios: ${passed} passed, ${failed} failed`);
if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
process.exit(failed ? 1 : 0);
