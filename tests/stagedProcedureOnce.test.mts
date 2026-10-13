/**
 * A treatment staged in the booking form is written once, however many times its save is sent.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:staged-once
 *
 * Runs the real `/api/clinical/procedures` handler against the Firestore emulator, with nothing
 * mocked but the login check (see tests/recycleBinCascade.test.mts for how that works).
 *
 * The story: the booking form keeps staged treatments in memory and sends them with every save of
 * the visit. The side-drawer editor autosaved an existing visit while those treatments were still
 * staged, and every later autosave sent them again — so one filling became two charges. The fix
 * gives each staged treatment a request key; the server writes the first request carrying a key
 * and answers every repeat with the treatment it already wrote.
 *
 * A clinic that really does two fillings records them as two separate adds with no shared key,
 * and that must keep working — it is the case the clinic's own duplicates may turn out to be.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-staged-once";
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
const proceduresRoute = await import("../src/app/api/clinical/procedures/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);
const TOKEN = idToken(UID);

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
async function create(body: Json): Promise<{ status: number; json: Json }> {
  const res = await proceduresRoute.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "create", clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const countFor = async (collection: string, field: string, value: string) =>
  (await col(collection).where(field, "==", value).count().get()).data().count;
const servicesOn = async (appointmentId: string) =>
  ((await col("appointments").doc(appointmentId).get()).data()?.services ?? []) as Json[];

async function wipe() {
  await db.recursiveDelete(clinic);
  await db.recursiveDelete(db.collection("users").doc(UID));
}

// --- one clinic, one dentist, one filling on the menu, two patients with a visit each -----------
await wipe();
await clinic.set({ name: "Staged Once", status: "Active", subscriptionTier: "Premium" });
await db.collection("users").doc(UID).set({ name: "Desk", clinicRoles: { [CLINIC]: "Admin" } });
await col("staff").doc("D1").set({ name: "Dr One", role: "Dentist", commissionPercentage: 50 });
await col("services").doc("S1").set({ name: "Kids filling", price: 800, pricingMode: "per_tooth" });
await col("patients").doc("P1").set({ name: "Child Patient" });
await col("patients").doc("P2").set({ name: "Other Patient" });
await col("appointments").doc("A1").set({ patientId: "P1", patientName: "Child Patient", date: "2026-10-13", time: "07:30 PM", status: "Checked In", services: [] });
await col("appointments").doc("A2").set({ patientId: "P1", patientName: "Child Patient", date: "2026-10-13", time: "08:00 PM", status: "Checked In", services: [] });

/** Exactly what bookingService.writeSessionProcedures sends for one staged treatment. */
const staged = (appointmentId: string, extra: Json = {}) => ({
  patientId: "P1",
  appointmentId,
  procedures: ["Kids filling"],
  selectedTeeth: [],
  tooth: "Gen",
  unitCost: 800,
  pricingMode: "per_tooth",
  priceListId: null,
  doctorId: "D1",
  status: "Completed",
  date: "2026-10-13",
  addToLedger: true,
  ...extra,
});

console.log("\nThe same staged treatment sent by two saves of the visit");
const KEY = "stg_3f1c9a7e-2b44-4d0e-9a51-7c6d2e8b1f00";
const first = await create(staged("A1", { requestKey: KEY }));
const second = await create(staged("A1", { requestKey: KEY }));
check("the first save is accepted", first.status === 200 && first.json.ok === true, first);
check("the repeat is accepted too (the form must not show an error)", second.status === 200 && second.json.ok === true, second);
check("the repeat answers with the treatment already written", second.json.noteId === first.json.noteId && second.json.ledgerId === first.json.ledgerId, { first: first.json, second: second.json });
check("one clinical note on the visit", (await countFor("clinical_notes", "appointmentId", "A1")) === 1, await countFor("clinical_notes", "appointmentId", "A1"));
check("one charge in the ledger", (await countFor("ledger", "appointmentId", "A1")) === 1, await countFor("ledger", "appointmentId", "A1"));
check("the visit lists the service once", (await servicesOn("A1")).length === 1, await servicesOn("A1"));
const firstNote = (await col("clinical_notes").doc(String(first.json.noteId)).get()).data() || {};
check("the note keeps the key it was written under", firstNote.requestKey === KEY, firstNote.requestKey);

console.log("\nTwo fillings recorded on purpose, one add each (no shared key)");
const a = await create(staged("A2"));
const b = await create(staged("A2"));
check("both adds are accepted", a.status === 200 && b.status === 200, { a, b });
check("two clinical notes on the visit", (await countFor("clinical_notes", "appointmentId", "A2")) === 2);
check("two charges in the ledger", (await countFor("ledger", "appointmentId", "A2")) === 2);

console.log("\nA key reused for a different patient");
const stolen = await create({ ...staged("A1", { requestKey: KEY }), patientId: "P2", appointmentId: null });
check("is refused, not answered with someone else's treatment", stolen.status === 409 && stolen.json.ok === false, stolen);
check("and writes nothing for that patient", (await countFor("clinical_notes", "patientId", "P2")) === 0);

console.log("\nA malformed key");
const junk = await create(staged("A1", { requestKey: "../../patients/P1" }));
check("is refused before anything is written", junk.status === 400, junk);
check("the visit still has its one note", (await countFor("clinical_notes", "appointmentId", "A1")) === 1);

await wipe();
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
