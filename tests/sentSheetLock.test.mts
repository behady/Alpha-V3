/**
 * A treatment on a company sheet that was already sent is locked in the patient's file too
 * (/api/clinical/procedures: update, delete, move). Staff are refused; an Owner or Admin is asked
 * to confirm, and the same call with `confirmSentSheet: true` goes through.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/sentSheetLock.test.mts
 *
 * Same harness as companySheetRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-sent-sheet-lock";
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

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const DENTIST = "dentist-1";
const asAdmin = idToken(UID);
const asDentist = idToken(DENTIST);

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
async function post(body: Json, token: string): Promise<{ status: number; json: Json }> {
  const res = await route.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const exists = async (col: string, id: string) => (await clinic.collection(col).doc(id).get()).exists;

await db.recursiveDelete(clinic);
await clinic.set({ name: "Sent Sheet Lock Test", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("users").doc(UID).set({ name: "Dr Owner", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc(DENTIST).set({
  name: "Dr Staff",
  clinicRoles: { [CLINIC]: "Dentist" },
  clinicPermissions: { [CLINIC]: ["clinical.edit", "clinical.delete", "finance.add", "patients.edit"] },
});
await clinic.collection("settings").doc("payers").set({ payers: [{ id: "gasco", name: "GASCO", active: true }] });
await clinic.collection("patients").doc("p1").set({ name: "Patient One" });
await clinic.collection("appointments").doc("A2").set({ patientId: "p1", date: "2026-11-20" });

const treatment = async (n: string, payerId: string) => {
  await clinic.collection("clinical_notes").doc(`N${n}`).set({ patientId: "p1", date: "2026-11-03", status: "Completed", completedDate: "2026-11-03", procedure: "Filling", payerId, ledgerId: `L${n}` });
  await clinic.collection("ledger").doc(`L${n}`).set({ type: "procedure", payerId, patientId: "p1", patientName: "Patient One", date: "2026-11-03", amount: 500, cost: 500, paid: 0, clinicalNoteId: `N${n}`, description: "Filling" });
};
await treatment("1", "gasco"); // on the sent November sheet
await treatment("2", "gasco"); // the company's, but on no sent sheet
await treatment("3", "private"); // nobody's sheet
await treatment("4", "gasco"); // sent too: the admin's confirmed delete
const sentRef = clinic.collection("settings").doc("company_sheet_gasco_2026-11");
await sentRef.set({ payerId: "gasco", month: "2026-11", chargeIds: ["L1", "L4"] });
// A settings document that merely lists the charge is not a sent sheet.
await clinic.collection("settings").doc("something_else").set({ chargeIds: ["L2"], month: "2026-11", payerId: "gasco" });

console.log("staff: locked");
{
  let r = await post({ action: "delete", noteId: "N1" }, asDentist);
  check("deleting a sent treatment is refused", r.status === 409 && r.json.reason === "sheet_sent" && r.json.month === "2026-11", r);
  r = await post({ action: "update", noteId: "N1", patientId: "p1", procedures: ["Filling"], status: "Ongoing" }, asDentist);
  check("editing it is refused", r.status === 409 && r.json.reason === "sheet_sent", r);
  r = await post({ action: "move", noteId: "N1", targetAppointmentId: "A2" }, asDentist);
  check("moving it to another visit is refused", r.status === 409 && r.json.reason === "sheet_sent", r);
  r = await post({ action: "status", noteId: "N1", status: "Planned" }, asDentist);
  check("reopening it from the Treatments report is refused", r.status === 409 && r.json.reason === "sheet_sent", r);
  check("and its state did not move", (await clinic.collection("clinical_notes").doc("N1").get()).data()?.status === "Completed");
  r = await post({ action: "status", noteId: "N1", status: "Completed" }, asDentist);
  check("picking the state it already has is no change, so nobody is refused", r.status === 200, r);
  r = await post({ action: "delete", noteId: "N1", confirmSentSheet: true }, asDentist);
  check("sending the confirmation themselves changes nothing", r.status === 409 && r.json.reason === "sheet_sent", r);
  check("the treatment and its charge are still there", (await exists("clinical_notes", "N1")) && (await exists("ledger", "L1")));
}

console.log("owner / admin: asked first");
{
  let r = await post({ action: "delete", noteId: "N4" }, asAdmin);
  check("without the confirmation an admin is asked", r.status === 409 && r.json.reason === "sheet_sent_confirm" && r.json.month === "2026-11", r);
  check("and nothing is deleted yet", (await exists("clinical_notes", "N4")) && (await exists("ledger", "L4")));
  r = await post({ action: "move", noteId: "N4", targetAppointmentId: "A2" }, asAdmin);
  check("the same for a move", r.status === 409 && r.json.reason === "sheet_sent_confirm", r);
  r = await post({ action: "update", noteId: "N4", patientId: "p1", procedures: ["Filling"], status: "Ongoing" }, asAdmin);
  check("and for an edit", r.status === 409 && r.json.reason === "sheet_sent_confirm", r);
  r = await post({ action: "status", noteId: "N4", status: "Ongoing" }, asAdmin);
  check("and for the Treatments report's state dropdown", r.status === 409 && r.json.reason === "sheet_sent_confirm", r);
  r = await post({ action: "status", noteId: "N4", status: "Ongoing", confirmSentSheet: true }, asAdmin);
  check("with the confirmation the state changes", r.status === 200 && (await clinic.collection("clinical_notes").doc("N4").get()).data()?.status === "Ongoing", r);
  r = await post({ action: "move", noteId: "N4", targetAppointmentId: "A2", confirmSentSheet: true }, asAdmin);
  check("with the confirmation the move goes through", r.status === 200, r);
  r = await post({ action: "delete", noteId: "N4", confirmSentSheet: true }, asAdmin);
  check("and so does the delete", r.status === 200 && !(await exists("clinical_notes", "N4")), r);
}

console.log("everything else is untouched");
{
  let r = await post({ action: "status", noteId: "N2", status: "Ongoing" }, asDentist);
  check("the company's treatment on no sent sheet changes state as before", r.status === 200, r);
  r = await post({ action: "status", noteId: "N3", status: "Ongoing" }, asDentist);
  check("and so does a private one", r.status === 200, r);
  r = await post({ action: "move", noteId: "N2", targetAppointmentId: "A2" }, asDentist);
  check("the company's treatment on no sent sheet moves as before", r.status === 200, r);
  r = await post({ action: "delete", noteId: "N2" }, asDentist);
  check("and deletes as before", r.status === 200 && !(await exists("clinical_notes", "N2")), r);
  r = await post({ action: "delete", noteId: "N3" }, asDentist);
  check("a private treatment is never looked up", r.status === 200 && !(await exists("clinical_notes", "N3")), r);
  await sentRef.delete();
  r = await post({ action: "delete", noteId: "N1" }, asDentist);
  check("once the month is marked not sent, staff can change it again", r.status === 200 && !(await exists("clinical_notes", "N1")), r);
}

authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
