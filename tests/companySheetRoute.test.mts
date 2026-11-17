/**
 * The company (GASCO) monthly sheet's route: the dentist's per-patient switch and the sent lock,
 * against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/companySheetRoute.test.mts
 *
 * Same harness as insuranceLineDatesRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-company-sheet";
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
const route = await import("../src/app/api/insurance/company-sheet/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
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
async function post(body: Json, token: string | null = as): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await route.POST(new Request("http://localhost/api/insurance/company-sheet", { method: "POST", headers, body: JSON.stringify({ clinicId: CLINIC, payerId: "gasco", month: "2026-11", ...body }) }));
  return { status: res.status, json: (await res.json()) as Json };
}
const marksOf = async () => ((await clinic.collection("settings").doc("company_sheet_gasco").get()).data()?.marks ?? {}) as Json;
const sentDoc = () => clinic.collection("settings").doc("company_sheet_gasco_2026-11").get();

await db.recursiveDelete(clinic);
await clinic.set({ name: "Company Sheet Test", status: "Active", subscriptionTier: "Premium", features: { insurance: true } });
await db.collection("users").doc(UID).set({ name: "Dr Tester", clinicRoles: { [CLINIC]: "Admin" } });
await clinic.collection("settings").doc("payers").set({
  payers: [
    { id: "gasco", name: "GASCO", active: true },
    { id: "gasco_empty", name: "Empty Co", active: true },
    { id: "metlife", name: "MetLife", active: true, format: "metlife" },
  ],
});
const charge = (id: string, patientId: string, noteId: string, amount: number) =>
  clinic.collection("ledger").doc(id).set({ type: "procedure", payerId: "gasco", patientId, patientName: patientId.toUpperCase(), date: "2026-11-03", amount, cost: amount, paid: 0, clinicalNoteId: noteId, description: "Filling" });
const card = (id: string, patientId: string, status: string) =>
  clinic.collection("clinical_notes").doc(id).set({ patientId, date: "2026-11-03", status, completedDate: status === "Completed" ? "2026-11-05" : null, procedure: "Filling" });
await charge("L1", "p1", "N1", 500);
await card("N1", "p1", "Completed");
await charge("L2a", "p2", "N2a", 300);
await card("N2a", "p2", "Completed");
await charge("L2b", "p2", "N2b", 200);
await card("N2b", "p2", "Ongoing");

console.log("the switch");
{
  let r = await post({ action: "mark", patientId: "p1", choice: "hold" });
  check("hold p1 is accepted", r.status === 200 && r.json.ok === true, r);
  check("and stored under the patient and month", (await marksOf())["p1__2026-11"] === "hold", await marksOf());
  r = await post({ action: "mark", patientId: "p1", choice: null });
  check("clearing it is accepted", r.status === 200, r);
  check("and the key is gone", !("p1__2026-11" in (await marksOf())), await marksOf());
  r = await post({ action: "mark", patientId: "p2", choice: "include" });
  check("include for a patient with work still waiting is refused", r.status === 409 && r.json.reason === "not_finished", r);
  r = await post({ action: "mark", patientId: "p2", choice: "hold" });
  check("hold for him is fine", r.status === 200, r);
  r = await post({ action: "mark", patientId: "p2", choice: "include" });
  check("a hold tick does not hide that he is unfinished", r.status === 409 && r.json.reason === "not_finished", r);
  await post({ action: "mark", patientId: "p2", choice: null });
}

console.log("a long chain of continuation cards");
{
  // Eight cards, each continuing the one before; only the newest is Completed. The server must follow
  // the whole chain (not stop after a few rounds) to see the treatment as finished.
  await charge("L3", "p3", "K0", 400);
  for (let i = 0; i < 8; i++) {
    await clinic.collection("clinical_notes").doc(`K${i}`).set({
      patientId: "p3",
      date: `2026-11-${String(3 + i).padStart(2, "0")}`,
      status: i === 7 ? "Completed" : "Ongoing",
      completedDate: i === 7 ? "2026-11-10" : null,
      continuedFromNoteId: i === 0 ? null : `K${i - 1}`,
      procedure: "Filling",
    });
  }
  const r = await post({ action: "mark", patientId: "p3", choice: "include" });
  check("a chain of 8 cards, only the newest Completed, reads as finished", r.status === 200, r);
  await post({ action: "mark", patientId: "p3", choice: null });
  await clinic.collection("ledger").doc("L3").delete();
  for (let i = 0; i < 8; i++) await clinic.collection("clinical_notes").doc(`K${i}`).delete();
}

console.log("refusals before anything is written");
{
  check("a document-format insurer is refused", (await post({ action: "mark", patientId: "p1", choice: "hold", payerId: "metlife" })).status === 400);
  check("an unknown company is refused", (await post({ action: "mark", patientId: "p1", choice: "hold", payerId: "nobody" })).status === 400);
  check("a month before the start is refused", (await post({ action: "mark", patientId: "p1", choice: "hold", month: "2026-10" })).status === 400);
  check("a month that is not a month is refused", (await post({ action: "mark", patientId: "p1", choice: "hold", month: "2026-13" })).status === 400);
  check("a month still to come is refused", (await post({ action: "send", month: "2999-01" })).status === 400);
  check("a bad choice is refused", (await post({ action: "mark", patientId: "p1", choice: "maybe" })).status === 400);
  check("no token is a 401", (await post({ action: "send" }, null)).status === 401);
  // A second clinic without the add-on (the server caches a clinic's features for a minute).
  const bare = db.collection("clinics").doc("C2");
  await bare.set({ name: "No Add-on", status: "Active", subscriptionTier: "Premium", features: { insurance: false } });
  await db.collection("users").doc(UID).update({ "clinicRoles.C2": "Admin" });
  const locked = await post({ action: "send", clinicId: "C2" });
  check("add-on off is feature_locked", locked.status === 403 && locked.json.reason === "feature_locked", locked);
  await db.recursiveDelete(bare);
}

console.log("sending the month");
{
  let r = await post({ action: "send" });
  check("send is accepted", r.status === 200, r);
  const d = (await sentDoc()).data() as Json;
  check("the server stored its own list: only p1's charge", JSON.stringify(d?.chargeIds) === JSON.stringify(["L1"]), d?.chargeIds);
  check("with the case count and total", d?.cases === 1 && d?.total === 500 && d?.payerId === "gasco" && d?.month === "2026-11", d);
  check("and who sent it", d?.sentBy === UID && d?.sentByName === "Dr Tester" && !!d?.sentAt, d);
  r = await post({ action: "send" });
  check("a second send is already_sent", r.status === 409 && r.json.reason === "already_sent", r);
  r = await post({ action: "mark", patientId: "p1", choice: "hold" });
  check("the switch is locked once sent", r.status === 409 && r.json.reason === "sent_locked", r);
  check("nothing was written by the refused switch", !("p1__2026-11" in (await marksOf())), await marksOf());
  const logs = await clinic.collection("system_logs").get();
  check("each success left an activity row", logs.size >= 3, logs.size);
}

console.log("taking it back");
{
  let r = await post({ action: "unsend" });
  check("unsend is accepted", r.status === 200, r);
  check("the sent document is gone", !(await sentDoc()).exists);
  r = await post({ action: "unsend" });
  check("unsend again is not_sent", r.status === 409 && r.json.reason === "not_sent", r);
  r = await post({ action: "send", payerId: "gasco_empty" });
  check("a month with nothing to print is empty", r.status === 409 && r.json.reason === "empty", r);
}

authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
