/**
 * The company (GASCO) monthly sheet's route: the patient drawer's finish-date actions and the sent
 * lock, against the Firestore emulator.
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
const note = async (id: string) => ((await clinic.collection("clinical_notes").doc(id).get()).data() ?? {}) as Json;
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
await clinic.collection("clinical_notes").doc("N1").update({ appointmentId: "A1" });
await clinic.collection("appointments").doc("A1").set({ date: "2026-11-03", services: [{ clinicalNoteId: "N1", status: "Completed", cost: 500 }, { clinicalNoteId: "X", status: "Planned" }] });

console.log("the drawer: finish date, undo, mark finished");
{
  let r = await post({ action: "finishDate", noteId: "N1", date: "2026-11-07" });
  check("changing a finish date is accepted", r.status === 200 && r.json.ok === true, r);
  let n = await note("N1");
  check("the card carries the new day", n.completedDate === "2026-11-07", n.completedDate);
  check("and one log line saying who and from what", n.finishLog?.length === 1 && n.finishLog[0].kind === "date" && n.finishLog[0].from === "2026-11-05" && n.finishLog[0].to === "2026-11-07" && n.finishLog[0].byName === "Dr Tester" && /^\d{4}-\d{2}-\d{2}$/.test(n.finishLog[0].day), n.finishLog);
  check("a day before the visit is refused", (await post({ action: "finishDate", noteId: "N1", date: "2026-11-01" })).json.reason === "before_visit");
  check("a day after today is refused", (await post({ action: "finishDate", noteId: "N1", date: "2999-01-01" })).json.reason === "future_date");
  check("a day that is not a day is refused", (await post({ action: "finishDate", noteId: "N1", date: "2026-13-01" })).json.reason === "bad_date");
  r = await post({ action: "finishDate", noteId: "N2b", date: "2026-11-06" });
  check("an unfinished treatment has no finish date to change", r.status === 409 && r.json.reason === "not_done", r);
  r = await post({ action: "finishDate", noteId: "nope", date: "2026-11-06" });
  check("a card that is not this company's is not_found", r.status === 404 && r.json.reason === "not_found", r);

  r = await post({ action: "reopen", noteId: "N1" });
  check("undo (not finished) is accepted", r.status === 200, r);
  n = await note("N1");
  check("the card is back to Ongoing with no finish day", n.status === "Ongoing" && !("completedDate" in n), n);
  check("the log says it was reopened from the 7th", n.finishLog?.length === 2 && n.finishLog[1].kind === "reopened" && n.finishLog[1].from === "2026-11-07", n.finishLog);
  const appt = (await clinic.collection("appointments").doc("A1").get()).data() as Json;
  check("the visit's line follows; the other line is untouched", appt.services[0].status === "Ongoing" && appt.services[1].status === "Planned" && appt.services[0].cost === 500, appt.services);
  check("undo twice is not_done", (await post({ action: "reopen", noteId: "N1" })).json.reason === "not_done");

  r = await post({ action: "finish", noteId: "N1" });
  check("mark finished is accepted", r.status === 200, r);
  n = await note("N1");
  check("Completed today", n.status === "Completed" && /^\d{4}-\d{2}-\d{2}$/.test(n.completedDate) && n.finishLog?.length === 3 && n.finishLog[2].kind === "finished", n);
  check("finishing twice is already_done", (await post({ action: "finish", noteId: "N1" })).json.reason === "already_done");
  r = await post({ action: "finishDate", noteId: "N1", date: "2026-11-05" });
  check("and its day can be set back", r.status === 200 && (await note("N1")).completedDate === "2026-11-05", r);

  await charge("L9", "p9", "N9", 100);
  await clinic.collection("clinical_notes").doc("N9").set({ patientId: "p9", date: "2026-11-03", status: "Completed", completedDate: "2026-11-03", claimId: "CL1" });
  r = await post({ action: "reopen", noteId: "N9" });
  check("an approval's treatment is not touched here", r.status === 409 && r.json.reason === "approval", r);
  await clinic.collection("ledger").doc("L9").delete();
  await clinic.collection("clinical_notes").doc("N9").delete();
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
  let r = await post({ action: "finishDate", noteId: "K7", date: "2026-11-11" });
  check("the newest of 8 chained cards is the one the drawer acts on", r.status === 200, r);
  r = await post({ action: "finishDate", noteId: "K0", date: "2026-11-11" });
  check("an older card of the chain is not_found", r.status === 404 && r.json.reason === "not_found", r);
  await clinic.collection("ledger").doc("L3").delete();
  for (let i = 0; i < 8; i++) await clinic.collection("clinical_notes").doc(`K${i}`).delete();
}

console.log("refusals before anything is written");
{
  check("a document-format insurer is refused", (await post({ action: "send", payerId: "metlife" })).status === 400);
  check("an unknown company is refused", (await post({ action: "send", payerId: "nobody" })).status === 400);
  check("a month before the start is refused", (await post({ action: "send", month: "2026-10" })).status === 400);
  check("a month that is not a month is refused", (await post({ action: "send", month: "2026-13" })).status === 400);
  check("a month still to come is refused", (await post({ action: "send", month: "2999-01" })).status === 400);
  check("the old switch is gone", (await post({ action: "mark", patientId: "p1", choice: "hold" })).status === 400);
  check("no note id is refused", (await post({ action: "reopen" })).status === 400);
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
  r = await post({ action: "finishDate", noteId: "N1", date: "2026-11-06" });
  check("a sent treatment is locked", r.status === 409 && r.json.reason === "sent_locked", r);
  r = await post({ action: "reopen", noteId: "N1" });
  check("and cannot be undone either", r.status === 409 && r.json.reason === "sent_locked", r);
  const after = await note("N1");
  check("nothing was written by the refusals", after.completedDate === "2026-11-05" && after.status === "Completed", after);
  r = await post({ action: "finishDate", noteId: "N2a", date: "2026-11-06" });
  check("a finish day inside the sent month is refused", r.status === 409 && r.json.reason === "month_sent", r);
  const logs = await clinic.collection("system_logs").get();
  check("each success left an activity row", logs.size >= 6, logs.size);
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
