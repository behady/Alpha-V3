/**
 * Teeth on a treatment an insurance approval wrote, through the real procedures route, against the
 * Firestore emulator: they reach the approval's line, so the monthly sheet prints them.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/approvalTeethRoute.test.mts
 *
 * Same harness as notePhotosRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-approval-teeth";
const CLINIC = "C1";
const UID = "admin-1";

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
const route = await import("../src/app/api/clinical/procedures/route");
const claimsRoute = await import("../src/app/api/insurance/claims/route");
const { buildNextcareStatement, sheetTeethOf } = await import("../src/lib/insuranceStatementNextcare");
const { parseClaim, insuranceTreatmentRows } = await import("../src/lib/insurance/claims");
const { parseTypedTeeth } = await import("../src/lib/insurance/nextcare");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const claimRef = clinic.collection("insurance_claims").doc("nextcare_c1");
const noteRef = clinic.collection("clinical_notes").doc("N1");
const ledgerRef = clinic.collection("ledger").doc("L1");
const as = idToken(UID);

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
async function update(body: Json, token = as): Promise<{ status: number; json: Json }> {
  const res = await route.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "update", clinicId: CLINIC, noteId: "N1", patientId: "P1", status: "Completed", doctorId: null, note: "", ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const line = (code: string, description: string, units: number, amount: number) => ({
  code, description, unitsRequested: units, grossPerUnit: amount / units, grossTotal: amount,
  unitsApproved: units, patientShare: 0, approvedAmount: amount, comment: "", confidence: 1,
});

await db.recursiveDelete(clinic);
await clinic.set({ name: "Teeth Test", status: "Active", subscriptionTier: "Premium" });
await db.collection("users").doc(UID).set({ name: "Dr Tester", clinicRoles: { [CLINIC]: "Admin" } });
// An approval whose paper named no teeth, already treated: its rows exist, so the Insurance tab refuses line edits.
await claimRef.set({
  insurer: "nextcare", payerId: "nc", status: "treated", approvalNumber: "C1/1", approvalDate: "2026-09-10", treatedDate: "2026-09-12",
  patientId: "P1", patientName: "Test Patient", paperPatientName: "", metlife: { memberCode: "AB12" },
  lines: [line("DE-1", "Consultation - كشف", 1, 34.5), line("DEN-14", "Composite - حشو كمبوزيت", 2, 1610)],
  ledgerIds: { 1: { ledgerId: "L1", noteId: "N1" } }, dentists: {}, lineStatus: {},
});
await noteRef.set({ patientId: "P1", claimId: "nextcare_c1", tooth: "Gen", procedure: "حشو كمبوزيت", cost: 1610, status: "Completed", note: "", doctorId: null, payerId: "nc" });
await ledgerRef.set({ patientId: "P1", type: "procedure", claimId: "nextcare_c1", amount: 1610, cost: 1610, description: "حشو كمبوزيت (T: Gen) | NextCare C1/1" });

console.log("teeth picked on an approval's treatment");
{
  const { status, json } = await update({ selectedTeeth: ["24", "25"] });
  check("the save is accepted", status === 200, json);
  check("the treatment shows the teeth", (await noteRef.get()).data()?.tooth === "24,25");
  check("its charge says the same", (await ledgerRef.get()).data()?.description === "حشو كمبوزيت (T: 24,25) | NextCare C1/1", (await ledgerRef.get()).data()?.description);
  check("the charge's money did not move", (await ledgerRef.get()).data()?.amount === 1610);
  const claim = parseClaim("nextcare_c1", (await claimRef.get()).data())!;
  check("the approval's line has them", JSON.stringify(claim.lines[1].teeth) === JSON.stringify(["24", "25"]), claim.lines[1]);
  check("the other line is untouched", !claim.lines[0].teeth || claim.lines[0].teeth.length === 0, claim.lines[0]);
  const sheet = buildNextcareStatement({ claims: [claim], payerId: "nc", payerName: "NextCare", from: "2026-09-01", to: "2026-09-30", wording: {} });
  check("the monthly sheet prints them", sheet.cases[0]?.lines[1]?.text === "2حشو كمبوزيت رقم 4-5", sheet.cases[0]?.lines);
  check("the exam prints no tooth", sheet.cases[0]?.lines[0]?.text === "كشف", sheet.cases[0]?.lines);
}

console.log("what is still refused");
{
  const wrong = await update({ selectedTeeth: ["24", "99"] });
  check("a number that is not a tooth is refused", wrong.status === 400, wrong.json);
  check("and nothing changed", (await noteRef.get()).data()?.tooth === "24,25");
  const price = await update({ selectedTeeth: ["24", "25"], unitCost: 1 });
  check("the price is still the approval's", price.status === 409, price.json);
}

console.log("taking the teeth off");
{
  const { status } = await update({ selectedTeeth: [], tooth: "" });
  check("clearing is accepted", status === 200);
  check("the treatment is general again", (await noteRef.get()).data()?.tooth === "Gen");
  const claim = parseClaim("nextcare_c1", (await claimRef.get()).data())!;
  check("the approval's line has none", !claim.lines[1].teeth || claim.lines[1].teeth.length === 0, claim.lines[1]);
}

// --- the same teeth, typed on the Insurance page (PATCH /api/insurance/claims { lineTeeth }) -------------
async function typeTeeth(claimId: string, patch: Json, token = as, extra: Json = {}): Promise<{ status: number; json: Json }> {
  const res = await claimsRoute.PATCH(
    new Request("http://localhost/api/insurance/claims", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, claimId, patch, ...extra }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const claimNow = async (id = "nextcare_c1") => parseClaim(id, (await clinic.collection("insurance_claims").doc(id).get()).data())!;
await clinic.set({ features: { insurance: true } }, { merge: true });

console.log("teeth typed on the Insurance page");
{
  const stored = (await claimRef.get()).data() as Json;
  const { status, json } = await typeTeeth("nextcare_c1", { lineTeeth: { 1: ["46", "47", "46"] } });
  check("the save is accepted", status === 200, json);
  const claim = await claimNow();
  check("the approval's line has them, each once", JSON.stringify(claim.lines[1].teeth) === JSON.stringify(["46", "47"]), claim.lines[1]);
  check("the other line is untouched", !claim.lines[0].teeth || claim.lines[0].teeth.length === 0, claim.lines[0]);
  check("the treatment in the patient's file says the same", (await noteRef.get()).data()?.tooth === "46,47", (await noteRef.get()).data()?.tooth);
  check("and so does its charge", (await ledgerRef.get()).data()?.description === "حشو كمبوزيت (T: 46,47) | NextCare C1/1", (await ledgerRef.get()).data()?.description);
  check("the charge's money did not move", (await ledgerRef.get()).data()?.amount === 1610 && (await ledgerRef.get()).data()?.cost === 1610);
  const after = (await claimRef.get()).data() as Json;
  const rest = (d: Json) => JSON.stringify({ ...d, lines: undefined, updatedAt: undefined, updatedBy: undefined });
  check("nothing else on the approval changed: status, dates, totals, links", rest(after) === rest(stored), [rest(stored), rest(after)]);
  check("the line's own money is as it was", claim.lines[1].approvedAmount === 1610 && claim.lines[1].unitsApproved === 2);
  const sheet = buildNextcareStatement({ claims: [claim], payerId: "nc", payerName: "NextCare", from: "2026-09-01", to: "2026-09-30", wording: {} });
  check("the monthly sheet prints them", sheet.cases[0]?.lines[1]?.text === "2حشو كمبوزيت رقم 6-7", sheet.cases[0]?.lines);
  check("the page's box shows what the sheet prints", JSON.stringify(sheetTeethOf(claim)[1]) === JSON.stringify(["46", "47"]));
  const audit = await clinic.collection("ledger_audit").where("documentId", "==", "N1").get();
  const mine = audit.docs.map((d) => d.data()).filter((d) => d.via === "insurance/claims:line-teeth");
  check("the change is in the audit, with the new teeth", mine.length === 1 && mine[0].after?.tooth === "46,47", audit.docs.map((d) => d.data()));
  const again = await typeTeeth("nextcare_c1", { lineTeeth: { 1: ["46", "47"] } });
  const auditAgain = (await clinic.collection("ledger_audit").where("documentId", "==", "N1").get()).docs.filter((d) => d.data().via === "insurance/claims:line-teeth");
  check("typing the same teeth again changes and logs nothing", again.status === 200 && auditAgain.length === 1, auditAgain.length);
}

console.log("what the Insurance page refuses");
{
  const frozen = async () => JSON.stringify([(await claimRef.get()).data()?.lines, (await noteRef.get()).data()?.tooth, (await ledgerRef.get()).data()?.description]);
  const before = await frozen();
  let r = await typeTeeth("nextcare_c1", { lineTeeth: { 1: ["46", "99"] } });
  check("a number that is not a tooth", r.status === 400 && r.json.reason === "bad_teeth", r);
  r = await typeTeeth("nextcare_c1", { lineTeeth: { 1: "46" } });
  check("teeth that are not a list", r.status === 400, r);
  r = await typeTeeth("nextcare_c1", { lineTeeth: { 0: ["11"], 1: ["46"] } });
  check("two services at once", r.status === 400, r);
  r = await typeTeeth("nextcare_c1", { lineTeeth: { 7: ["46"] } });
  check("a service that is not on the approval", r.status === 400 && r.json.reason === "no_line", r);
  r = await typeTeeth("nextcare_c1", { lineTeeth: { 1: ["46"] }, status: "sent" });
  check("teeth mixed with another change", r.status === 400, r);
  check("and none of it changed anything", (await frozen()) === before);

  const STAFF = "desk-teeth";
  await db.collection("users").doc(STAFF).set({ name: "Sara Desk", clinicRoles: { [CLINIC]: "Receptionist" }, clinicPermissions: { [CLINIC]: ["patients.edit"] } });
  r = await typeTeeth("nextcare_c1", { lineTeeth: { 1: ["45"] } }, idToken(STAFF));
  check("an account from before the insurance permissions can type teeth", r.status === 200 && (await noteRef.get()).data()?.tooth === "45", r);
  await db.collection("users").doc(STAFF).update({ [`clinicPermissions.${CLINIC}`]: ["patients.edit", "no:insurance.edit"] });
  r = await typeTeeth("nextcare_c1", { lineTeeth: { 1: ["46"] } }, idToken(STAFF));
  check("insurance.edit switched off: refused, nothing changed", r.status === 403 && r.json.reason === "no_permission" && (await noteRef.get()).data()?.tooth === "45", r);

  // MetLife's paper and sheet name no teeth, and its lines keep none.
  await clinic.collection("insurance_claims").doc("metlife_m1").set({
    insurer: "metlife", payerId: "metlife", status: "treated", approvalNumber: "M1", approvalDate: "2026-09-10", treatedDate: "2026-09-12",
    patientId: "P1", patientName: "Test Patient", paperPatientName: "", metlife: { certificateNumber: "124", dependentCode: "1" },
    lines: [line("D2391", "COMPOSITE ONE SURFACE", 1, 400)], ledgerIds: {}, dentists: {}, lineStatus: {},
  });
  r = await typeTeeth("metlife_m1", { lineTeeth: { 0: ["46"] } });
  check("a MetLife approval has no teeth to type", r.status === 409 && r.json.reason === "no_teeth", r);
}

console.log("teeth on an approval that is not treated yet, sent, or cancelled");
{
  const seedPlain = (id: string, statusNow: string, extra: Json = {}) =>
    clinic.collection("insurance_claims").doc(id).set({
      insurer: "nextcare", payerId: "nc", status: statusNow, approvalNumber: id.toUpperCase(), approvalDate: "2026-09-10", treatedDate: statusNow === "approved" ? null : "2026-09-12",
      patientId: "P1", patientName: "Test Patient", paperPatientName: "", metlife: { memberCode: "AB12" },
      lines: [line("DE-1", "Consultation - كشف", 1, 34.5), line("DEN-14", "Composite - حشو كمبوزيت", 2, 1610)],
      ledgerIds: {}, dentists: {}, lineStatus: {}, ...extra,
    });
  await seedPlain("nextcare_c2", "approved");
  let r = await typeTeeth("nextcare_c2", { lineTeeth: { 1: ["36", "37"] } });
  check("not treated yet (no treatment rows): the approval takes them", r.status === 200 && JSON.stringify((await claimNow("nextcare_c2")).lines[1].teeth) === JSON.stringify(["36", "37"]), r);

  // The paper's conditions named the teeth; typing over them wins.
  await seedPlain("nextcare_c3", "treated", { metlife: { memberCode: "AB12", comment: "L.R 4-6" } });
  check("with nothing typed the box shows the paper's teeth", JSON.stringify(sheetTeethOf(await claimNow("nextcare_c3"))[1]) === JSON.stringify(["44", "46"]), sheetTeethOf(await claimNow("nextcare_c3")));
  r = await typeTeeth("nextcare_c3", { lineTeeth: { 1: ["45", "46"] } });
  check("typed teeth replace them on the sheet", r.status === 200 && JSON.stringify(sheetTeethOf(await claimNow("nextcare_c3"))[1]) === JSON.stringify(["45", "46"]), r);

  // Sent to the company: its teeth are on the sheet the company holds. Owner / Admin only, after the warning.
  await seedPlain("nextcare_c4", "sent");
  const DESK = "desk-sent";
  await db.collection("users").doc(DESK).set({ name: "Mona Desk", clinicRoles: { [CLINIC]: "Receptionist" }, clinicPermissions: { [CLINIC]: ["patients.edit"] } });
  r = await typeTeeth("nextcare_c4", { lineTeeth: { 1: ["36", "37"] } }, idToken(DESK));
  check("sent: staff are refused", r.status === 409 && r.json.reason === "approval_sent", r);
  r = await typeTeeth("nextcare_c4", { lineTeeth: { 1: ["36", "37"] } }, idToken(DESK), { confirmSent: true });
  check("sent: staff are refused even when the call says 'confirmed'", r.status === 409 && r.json.reason === "approval_sent", r);
  r = await typeTeeth("nextcare_c4", { lineTeeth: { 1: ["36", "37"] } });
  check("sent: an admin is asked to confirm first", r.status === 409 && r.json.reason === "approval_sent_confirm", r);
  check("sent: nothing changed so far", ((await claimNow("nextcare_c4")).lines[1].teeth ?? []).length === 0);
  r = await typeTeeth("nextcare_c4", { lineTeeth: { 1: ["36", "37"] } }, as, { confirmSent: true });
  const sent = await claimNow("nextcare_c4");
  check("sent: an admin who confirmed changes them, and it stays sent", r.status === 200 && sent.status === "sent" && JSON.stringify(sent.lines[1].teeth) === JSON.stringify(["36", "37"]), r);
  r = await typeTeeth("nextcare_c4", { lineTeeth: { 1: ["36", "37"] } }, idToken(DESK));
  check("sent: the same teeth again are no change, so nobody is refused", r.status === 200, r);

  // The same lock from the patient's file (the treatment's own teeth picker).
  await clinic.collection("insurance_claims").doc("nextcare_c8").set({
    insurer: "nextcare", payerId: "nc", status: "sent", approvalNumber: "C8/1", approvalDate: "2026-09-10", treatedDate: "2026-09-12",
    patientId: "P1", patientName: "Test Patient", paperPatientName: "", metlife: { memberCode: "AB12" },
    lines: [line("DE-1", "Consultation - كشف", 1, 34.5), { ...line("DEN-14", "Composite - حشو كمبوزيت", 2, 1610), teeth: ["16", "17"] }],
    ledgerIds: { 1: { ledgerId: "L8", noteId: "N8" } }, dentists: {}, lineStatus: {},
  });
  await clinic.collection("clinical_notes").doc("N8").set({ patientId: "P1", claimId: "nextcare_c8", tooth: "16,17", procedure: "حشو كمبوزيت", cost: 1610, status: "Completed", note: "", doctorId: null, payerId: "nc" });
  await clinic.collection("ledger").doc("L8").set({ patientId: "P1", type: "procedure", claimId: "nextcare_c8", amount: 1610, cost: 1610, description: "حشو كمبوزيت (T: 16,17) | NextCare C8/1" });
  const DENTIST = "dentist-sent";
  await db.collection("users").doc(DENTIST).set({ name: "Dr Staff", clinicRoles: { [CLINIC]: "Dentist" }, clinicPermissions: { [CLINIC]: ["clinical.edit", "patients.edit"] } });
  let f = await update({ noteId: "N8", selectedTeeth: ["16", "18"] }, idToken(DENTIST));
  check("patient's file, sent: staff are refused", f.status === 409 && f.json.reason === "approval_sent", f);
  f = await update({ noteId: "N8", selectedTeeth: ["16", "18"], confirmSentApproval: true }, idToken(DENTIST));
  check("patient's file, sent: staff are refused even when the call says 'confirmed'", f.status === 409 && f.json.reason === "approval_sent", f);
  f = await update({ noteId: "N8", selectedTeeth: ["16", "18"] });
  check("patient's file, sent: an admin is asked to confirm first", f.status === 409 && f.json.reason === "approval_sent_confirm", f);
  check("patient's file, sent: nothing changed", (await clinic.collection("clinical_notes").doc("N8").get()).data()?.tooth === "16,17");
  f = await update({ noteId: "N8", selectedTeeth: ["16", "18"], confirmSentApproval: true });
  check("patient's file, sent: confirmed, the teeth change everywhere", f.status === 200 && (await clinic.collection("clinical_notes").doc("N8").get()).data()?.tooth === "16,18" && JSON.stringify((await claimNow("nextcare_c8")).lines[1].teeth) === JSON.stringify(["16", "18"]), f);
  f = await update({ noteId: "N8", selectedTeeth: ["16", "18"], note: "polished" });
  check("patient's file, sent: a note with the same teeth needs no confirmation", f.status === 200, f);

  await seedPlain("nextcare_c5", "cancelled");
  r = await typeTeeth("nextcare_c5", { lineTeeth: { 1: ["36"] } });
  check("cancelled: refused", r.status === 400 && r.json.reason === "no_line", r);
}

console.log("typing on an Arabic keyboard");
{
  const typed = parseTypedTeeth("٤٤، ٤٦");
  check("٤٤، ٤٦ is read as 44, 46", typed.bad === null && JSON.stringify(typed.teeth) === JSON.stringify(["44", "46"]), typed);
  check("۴۵ (Persian digits) is read as 45", JSON.stringify(parseTypedTeeth("۴۵").teeth) === JSON.stringify(["45"]));
  check("44 46 44 is two teeth", JSON.stringify(parseTypedTeeth("44 46 44").teeth) === JSON.stringify(["44", "46"]));
  check("a number that is not a tooth is named", parseTypedTeeth("44, ٩٩").bad === "99", parseTypedTeeth("44, ٩٩"));
  check("an empty box is no teeth, not a mistake", parseTypedTeeth("  ").bad === null && parseTypedTeeth("  ").teeth.length === 0);
  const r = await typeTeeth("nextcare_c2", { lineTeeth: { 1: ["٣٥"] } });
  check("the server reads them too", r.status === 200 && JSON.stringify((await claimNow("nextcare_c2")).lines[1].teeth) === JSON.stringify(["35"]), r);
}

console.log("teeth the sheet only borrowed from the paper's note");
{
  // Treated before the file took the paper's teeth: the sheet prints 4-6, the patient's file says "Gen".
  const c6 = clinic.collection("insurance_claims").doc("nextcare_c6");
  const n6 = clinic.collection("clinical_notes").doc("N6");
  const l6 = clinic.collection("ledger").doc("L6");
  await c6.set({
    insurer: "nextcare", payerId: "nc", status: "treated", approvalNumber: "C6/1", approvalDate: "2026-09-10", treatedDate: "2026-09-12",
    patientId: "P1", patientName: "Test Patient", paperPatientName: "", metlife: { memberCode: "AB12", comment: "L.R 4-6" },
    lines: [line("DE-1", "Consultation - كشف", 1, 34.5), line("DEN-14", "Composite - حشو كمبوزيت", 2, 1610)],
    ledgerIds: { 1: { ledgerId: "L6", noteId: "N6" } }, dentists: {}, lineStatus: {},
  });
  await n6.set({ patientId: "P1", claimId: "nextcare_c6", tooth: "Gen", procedure: "حشو كمبوزيت", cost: 1610, status: "Completed", note: "", doctorId: null, payerId: "nc" });
  await l6.set({ patientId: "P1", type: "procedure", claimId: "nextcare_c6", amount: 1610, cost: 1610, description: "حشو كمبوزيت (T: Gen) | NextCare C6/1" });
  const sheetLine = async () => buildNextcareStatement({ claims: [await claimNow("nextcare_c6")], payerId: "nc", payerName: "NextCare", from: "2026-09-01", to: "2026-09-30", wording: {} }).cases[0]?.lines[1]?.text;
  check("before: the sheet prints the paper's teeth", (await sheetLine()) === "2حشو كمبوزيت رقم 4-6", await sheetLine());

  let r = await typeTeeth("nextcare_c6", { lineTeeth: { 1: ["44", "46"] } });
  check("typing the numbers shown saves them as the line's own", r.status === 200 && JSON.stringify((await claimNow("nextcare_c6")).lines[1].teeth) === JSON.stringify(["44", "46"]), r);
  check("and puts the patient's file right", (await n6.get()).data()?.tooth === "44,46" && (await l6.get()).data()?.description === "حشو كمبوزيت (T: 44,46) | NextCare C6/1", [(await n6.get()).data()?.tooth, (await l6.get()).data()?.description]);
  const audits = async () => (await clinic.collection("ledger_audit").where("documentId", "==", "N6").get()).docs.map((d) => d.data()).filter((d) => d.via === "insurance/claims:line-teeth");
  check("the audit says what the file said before", (await audits()).length === 1 && (await audits())[0].before?.tooth === "Gen", await audits());

  r = await typeTeeth("nextcare_c6", { lineTeeth: { 1: [] } });
  const cleared = await claimNow("nextcare_c6");
  check("clearing the box really clears: the paper's teeth do not come back", r.status === 200 && sheetTeethOf(cleared)[1].length === 0 && cleared.lines[1].noTeeth === true, cleared.lines[1]);
  check("the sheet prints no tooth for it", (await sheetLine()) === "2حشو كمبوزيت", await sheetLine());
  check("the patient's file is general", (await n6.get()).data()?.tooth === "Gen" && (await l6.get()).data()?.description === "حشو كمبوزيت (T: Gen) | NextCare C6/1");
  const stored = ((await c6.get()).data() as Json).lines[1];
  check("stored cleanly: the mark, and no empty teeth list", stored.noTeeth === true && !("teeth" in stored), stored);
  r = await typeTeeth("nextcare_c6", { lineTeeth: { 1: [] } });
  check("clearing again changes and logs nothing", r.status === 200 && (await audits()).length === 2, (await audits()).length);

  r = await typeTeeth("nextcare_c6", { lineTeeth: { 1: ["45"] } });
  const typedAgain = await claimNow("nextcare_c6");
  check("typed teeth lift the mark", r.status === 200 && typedAgain.lines[1].noTeeth !== true && JSON.stringify(typedAgain.lines[1].teeth) === JSON.stringify(["45"]), typedAgain.lines[1]);

  const f = await update({ noteId: "N6", selectedTeeth: [], tooth: "" });
  const fileCleared = await claimNow("nextcare_c6");
  check("cleared in the patient's file: the sheet prints none either", f.status === 200 && sheetTeethOf(fileCleared)[1].length === 0 && (await sheetLine()) === "2حشو كمبوزيت", [f, fileCleared.lines[1]]);
}

console.log("a new treatment takes the teeth the sheet prints");
{
  const base = {
    payerId: "nc", approvalNumber: "C7/1", approvalDate: "2026-09-10", treatedDate: "2026-09-12", patientId: "P1", patientName: "Test Patient",
    lines: [line("DE-1", "Consultation - كشف", 1, 34.5), line("DEN-14", "Composite - حشو كمبوزيت", 2, 1610)], dentists: {}, lineStatus: {},
  };
  const rowsOf = (claim: Json) => insuranceTreatmentRows({ claimId: "c7", claim: claim as never, payerName: "NextCare", wording: {}, actor: { uid: UID, name: "Dr Tester", role: "Admin" } });
  const tooth = (claim: Json, i: number) => rowsOf(claim).find((r) => r.lineIndex === i)?.note.tooth;
  const paper = { ...base, insurer: "nextcare", metlife: { comment: "L.R 4-6" } };
  check("the paper's teeth reach the patient's file", tooth(paper, 1) === "44,46", tooth(paper, 1));
  check("and the charge", String(rowsOf(paper).find((r) => r.lineIndex === 1)?.charge.description).includes("(T: 44,46)"), rowsOf(paper).find((r) => r.lineIndex === 1)?.charge.description);
  check("the exam stays general", tooth(paper, 0) === "Gen", tooth(paper, 0));
  const own = { ...paper, lines: [paper.lines[0], { ...paper.lines[1], teeth: ["36", "37"] }] };
  check("a line's own teeth win", tooth(own, 1) === "36,37", tooth(own, 1));
  const clearedLine = { ...paper, lines: [paper.lines[0], { ...paper.lines[1], noTeeth: true }] };
  check("teeth cleared by hand stay cleared", tooth(clearedLine, 1) === "Gen", tooth(clearedLine, 1));
  check("MetLife is general, whatever its comment says", tooth({ ...paper, insurer: "metlife" }, 1) === "Gen", tooth({ ...paper, insurer: "metlife" }, 1));
}

console.log("clearing the teeth from the Insurance page");
{
  const r = await typeTeeth("nextcare_c1", { lineTeeth: { 1: [] } });
  check("accepted", r.status === 200, r);
  check("the treatment is general again", (await noteRef.get()).data()?.tooth === "Gen");
  check("its charge too", (await ledgerRef.get()).data()?.description === "حشو كمبوزيت (T: Gen) | NextCare C1/1", (await ledgerRef.get()).data()?.description);
  const claim = await claimNow();
  check("the approval's line has none", !claim.lines[1].teeth || claim.lines[1].teeth.length === 0, claim.lines[1]);
}

await db.recursiveDelete(clinic);
authServer.close();
console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
