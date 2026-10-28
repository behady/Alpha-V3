/**
 * Correcting a saved approval's date, through the real claims route, against the Firestore emulator.
 * DENT INN's D6984719 was read as 26 Oct 2020 instead of 2026 and fell off every MetLife sheet.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/approvalDateRoute.test.mts
 *
 * Same harness as approvalTeethRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-approval-date";
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
const route = await import("../src/app/api/insurance/claims/route");
const { buildMetlifeStatement, DEFAULT_METLIFE_WORDING } = await import("../src/lib/insuranceStatementMetlife");
const { parseClaim } = await import("../src/lib/insurance/claims");
const { ymdInTimeZone, clinicTimeZone } = await import("../src/lib/clinicDate");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const claims = clinic.collection("insurance_claims");
const ledger = clinic.collection("ledger");
const notes = clinic.collection("clinical_notes");
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
async function patch(claimId: string, p: Json): Promise<{ status: number; json: Json }> {
  const res = await route.PATCH(
    new Request("http://localhost/api/insurance/claims", {
      method: "PATCH",
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, claimId, patch: p }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const line = (code: string, description: string, units: number, amount: number) => ({
  code, description, unitsRequested: units, grossPerUnit: amount / units, grossTotal: amount,
  unitsApproved: units, patientShare: 0, approvedAmount: amount, comment: "", confidence: 1,
});
const metlife = { policyNumber: "6480600000", employer: "", certificateNumber: "124", dependentCode: "1", paperPatientNameAr: "مصطفى سيد" };

/** A treated approval with its two treatment rows, dated by `rowDate`. */
async function seed(id: string, approvalDate: string, treatedDate: string | null, rowDate: string, paid = 0) {
  await claims.doc(id).set({
    insurer: "metlife", payerId: "metlife", status: "treated", approvalNumber: id.toUpperCase(), approvalDate, treatedDate,
    patientId: "P1", patientName: "مصطفى سيد", paperPatientName: "MOSTAFA SAYED", metlife,
    lines: [line("D0120", "EXAMINATION / ORAL EVALUATION", 1, 60), line("D4220", "GINGIVAL CURETTAGE", 4, 960)],
    totals: { requested: 1020, approved: 1020, patientShare: 0 },
    ledgerIds: { 0: { ledgerId: `${id}-L0`, noteId: `${id}-N0` }, 1: { ledgerId: `${id}-L1`, noteId: `${id}-N1` } },
    dentists: {}, lineStatus: {},
  });
  for (const i of [0, 1]) {
    await ledger.doc(`${id}-L${i}`).set({ patientId: "P1", type: "procedure", claimId: id, date: rowDate, amount: 100, cost: 100, paid: i === 0 ? paid : 0 });
    await notes.doc(`${id}-N${i}`).set({ patientId: "P1", claimId: id, date: rowDate, status: "Completed" });
  }
}
const claimOf = async (id: string) => parseClaim(id, (await claims.doc(id).get()).data())!;
const dates = async (id: string) => [
  ...(await Promise.all([0, 1].map(async (i) => (await ledger.doc(`${id}-L${i}`).get()).data()?.date))),
  ...(await Promise.all([0, 1].map(async (i) => (await notes.doc(`${id}-N${i}`).get()).data()?.date))),
];

await db.recursiveDelete(clinic);
await clinic.set({ name: "Date Test", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("users").doc(UID).set({ name: "Dr Tester", clinicRoles: { [CLINIC]: "Admin" } });
await clinic.collection("patients").doc("P1").set({ name: "مصطفى سيد" });

console.log("a year misread as 2020, treated on the day");
{
  await seed("metlife_d6984719", "2020-10-26", "2026-10-26", "2026-10-26");
  const range = { from: "2026-10-01", to: "2026-10-31", wording: DEFAULT_METLIFE_WORDING };
  check("before: the October sheet misses it", buildMetlifeStatement({ claims: [await claimOf("metlife_d6984719")], ...range }).cases.length === 0);
  const r = await patch("metlife_d6984719", { approvalDate: "2026-10-26" });
  check("the date fix is accepted", r.status === 200, r.json);
  const claim = await claimOf("metlife_d6984719");
  check("the approval now reads 2026-10-26", claim.approvalDate === "2026-10-26", claim.approvalDate);
  check("the October sheet lists it", buildMetlifeStatement({ claims: [claim], ...range }).cases.length === 1);
  check("its services, totals and rows are untouched", claim.lines.length === 2 && claim.totals.approved === 1020 && claim.ledgerIds[0]?.ledgerId === "metlife_d6984719-L0", claim);
  check("rows dated by the treated day stay put", (await dates("metlife_d6984719")).every((d) => d === "2026-10-26"), await dates("metlife_d6984719"));
}

console.log("an approval with no treated date: its rows follow the approval date");
{
  await seed("metlife_d6000002", "2020-09-14", null, "2020-09-14");
  const r = await patch("metlife_d6000002", { approvalDate: "2026-09-14" });
  check("accepted", r.status === 200, r.json);
  check("charges and notes moved to 2026-09-14", (await dates("metlife_d6000002")).every((d) => d === "2026-09-14"), await dates("metlife_d6000002"));
  const audit = await clinic.collection("ledger_audit").where("documentId", "==", "metlife_d6000002-L0").get();
  check("the move is in the money audit", audit.size >= 1, audit.size);
}

console.log("money on the rows does not block a date-only fix");
{
  await seed("metlife_d6000003", "2020-10-20", "2026-10-20", "2026-10-20", 60);
  const r = await patch("metlife_d6000003", { approvalDate: "2026-10-20" });
  check("accepted although a row is paid", r.status === 200, r.json);
  check("the paid row was not rewritten", (await ledger.doc("metlife_d6000003-L0").get()).data()?.paid === 60);
}

console.log("what is refused");
{
  const tomorrow = new Date(`${ymdInTimeZone(clinicTimeZone())}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
  const future = await patch("metlife_d6984719", { approvalDate: tomorrow.toISOString().slice(0, 10) });
  check("a date after tomorrow is a 400", future.status === 400, future.json);
  const junk = await patch("metlife_d6984719", { approvalDate: "26/10/2026" });
  check("a date not in yyyy-mm-dd is a 400", junk.status === 400, junk.json);
  check("and the stored date did not change", (await claimOf("metlife_d6984719")).approvalDate === "2026-10-26");
}

console.log("other edits are unchanged");
{
  const r = await patch("metlife_d6984719", { lineStatus: { 1: "Ongoing" } });
  check("a state change still works on its own", r.status === 200 && (await claimOf("metlife_d6984719")).lineStatus[1] === "Ongoing", r.json);
  check("and leaves the date alone", (await claimOf("metlife_d6984719")).approvalDate === "2026-10-26");
}

authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
