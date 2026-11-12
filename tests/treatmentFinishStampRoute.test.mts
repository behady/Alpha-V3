/**
 * The day a treatment was finished, through the real procedures route, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:finish-stamp-route
 *
 * "What did we finish this month" needs a finish day that is not the day the card was written.
 * The route stamps it when a card becomes Completed. What must hold:
 *
 *   - written up as already done: the visit's own day, not the day of typing;
 *   - marked done later: the day it was marked;
 *   - an edit to a finished card never moves the day;
 *   - reopening removes it;
 *   - a card finished before the stamp existed is left alone, not given today's date;
 *   - a continuation never inherits one.
 *
 * Same harness as stagedProcedureOnce.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-finish-stamp";
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
const { clinicTimeZone, ymdInTimeZone } = await import("../src/lib/clinicDate");
const proceduresRoute = await import("../src/app/api/clinical/procedures/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);
const TOKEN = idToken(UID);
const TODAY = ymdInTimeZone(clinicTimeZone());

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
async function call(action: string, body: Json): Promise<{ status: number; json: Json }> {
  const res = await proceduresRoute.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action, clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const noteOf = async (id: string) => ((await col("clinical_notes").doc(id).get()).data() || {}) as Json;

async function wipe() {
  await db.recursiveDelete(clinic);
  await db.recursiveDelete(db.collection("users").doc(UID));
}

await wipe();
await clinic.set({ name: "Finish Stamp", status: "Active", subscriptionTier: "Premium" });
await db.collection("users").doc(UID).set({ name: "Desk", clinicRoles: { [CLINIC]: "Admin" } });
await col("staff").doc("D1").set({ name: "Dr One", role: "Dentist", commissionPercentage: 50 });
await col("services").doc("S1").set({ name: "Crown", price: 1500, pricingMode: "per_tooth" });
await col("patients").doc("P1").set({ name: "Mona Adel" });
await col("appointments").doc("A2").set({ patientId: "P1", patientName: "Mona Adel", date: "2026-10-20", time: "07:30 PM", status: "Confirmed", services: [] });

const OLD_DAY = "2026-10-13";
const crown = (extra: Json = {}) => ({
  patientId: "P1",
  appointmentId: null,
  procedures: ["Crown"],
  selectedTeeth: ["26"],
  tooth: "26",
  unitCost: 1500,
  pricingMode: "per_tooth",
  priceListId: null,
  doctorId: "D1",
  status: "Planned",
  date: OLD_DAY,
  addToLedger: true,
  ...extra,
});

console.log("\nWritten up as already done");
const done = await call("create", crown({ status: "Completed" }));
check("is accepted", done.status === 200 && done.json.ok === true, done);
check("and finished on the visit's own day", (await noteOf(done.json.noteId)).completedDate === OLD_DAY, await noteOf(done.json.noteId));

console.log("\nPlanned first, marked done later");
const planned = await call("create", crown());
const id = String(planned.json.noteId);
check("a planned card has no finish day", planned.status === 200 && !("completedDate" in (await noteOf(id))), await noteOf(id));
const ongoing = await call("update", { noteId: id, ...crown({ status: "Ongoing" }) });
check("nor has one in progress", ongoing.status === 200 && !("completedDate" in (await noteOf(id))), ongoing);
const finished = await call("update", { noteId: id, ...crown({ status: "Completed" }) });
const afterFinish = await noteOf(id);
check("marking it done stamps the day it was marked", finished.status === 200 && afterFinish.completedDate === TODAY, afterFinish.completedDate);
check("and leaves the card's own date where it was", afterFinish.date === OLD_DAY, afterFinish.date);

console.log("\nEditing a finished card");
await col("clinical_notes").doc(id).update({ completedDate: "2026-11-02" });
const edited = await call("update", { noteId: id, ...crown({ status: "Completed", note: "cemented" }) });
check("does not move the finish day", edited.status === 200 && (await noteOf(id)).completedDate === "2026-11-02", (await noteOf(id)).completedDate);

console.log("\nReopening");
const reopened = await call("update", { noteId: id, ...crown({ status: "Ongoing" }) });
check("removes the finish day", reopened.status === 200 && !("completedDate" in (await noteOf(id))), await noteOf(id));

console.log("\nA card finished before the stamp existed");
await col("clinical_notes").doc(id).update({ status: "Completed" });
const legacy = await call("update", { noteId: id, ...crown({ status: "Completed", note: "old one" }) });
check("is not given today's date by an edit", legacy.status === 200 && !("completedDate" in (await noteOf(id))), await noteOf(id));

console.log("\nContinuing a treatment into another visit");
const cont = await call("continue", { noteId: String(done.json.noteId), targetAppointmentId: "A2" });
const contNote = await noteOf(String(cont.json.noteId));
check("the continuation is in progress, with no finish day", cont.status === 200 && contNote.status === "Ongoing" && !("completedDate" in contNote), contNote);
check("and the first card keeps its own", (await noteOf(done.json.noteId)).completedDate === OLD_DAY);

await wipe();
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
