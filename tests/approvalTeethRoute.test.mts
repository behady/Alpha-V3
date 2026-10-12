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
const { buildNextcareStatement } = await import("../src/lib/insuranceStatementNextcare");
const { parseClaim } = await import("../src/lib/insurance/claims");

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
async function update(body: Json): Promise<{ status: number; json: Json }> {
  const res = await route.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
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

await db.recursiveDelete(clinic);
authServer.close();
console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
