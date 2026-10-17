/**
 * Renaming a member of staff through the real route, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:rename-route
 *
 * Same harness as notePhotosRoute.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-rename-staff";
const CLINIC = "C1";
const OTHER_CLINIC = "C2";
const ADMIN = "admin-1";
const DESK = "desk-1";
const NORHAN_UID = "norhan-uid";
const NORHAN_STAFF = "norhanStaff";
const OWNER_UID = "owner-uid";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const displayNames: Record<string, string> = {};
const authServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const json = JSON.parse(body || "{}");
    if (req.url?.includes("accounts:lookup")) {
      const ids = (json.localId as string[] | undefined) ?? [];
      res.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: false, validSince: "0" })) }));
      return;
    }
    if (req.url?.includes("accounts:update")) {
      displayNames[json.localId] = json.displayName;
      res.end(JSON.stringify({ localId: json.localId }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
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
const route = await import("../src/app/api/admin/rename-staff/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const other = db.collection("clinics").doc(OTHER_CLINIC);

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
async function rename(as: string, body: Json): Promise<{ status: number; json: Json }> {
  const res = await route.POST(
    new Request("http://localhost/api/admin/rename-staff", {
      method: "POST",
      headers: { authorization: `Bearer ${idToken(as)}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const data = async (path: string): Promise<Json> => (await db.doc(`clinics/${CLINIC}/${path}`).get()).data() ?? {};

await db.recursiveDelete(clinic);
await db.recursiveDelete(other);
await clinic.set({ name: "Rename Test", status: "Active", subscriptionTier: "Premium" });
await other.set({ name: "Elsewhere", status: "Active" });
await db.collection("users").doc(ADMIN).set({ name: "Boss", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc(DESK).set({ name: "Desk", clinicRoles: { [CLINIC]: "Receptionist" }, clinicPermissions: { [CLINIC]: [] } });
await db.collection("users").doc(NORHAN_UID).set({ name: "Norhan", clinicRoles: { [CLINIC]: "Dentist" } });
await db.collection("users").doc(OWNER_UID).set({ name: "Owner", clinicRoles: { [CLINIC]: "Owner" } });
await clinic.collection("staff").doc(NORHAN_STAFF).set({ name: "Norhan", uid: NORHAN_UID, role: "Dentist" });
await clinic.collection("staff").doc("ownerStaff").set({ name: "Owner", uid: OWNER_UID, role: "Owner" });

await clinic.collection("appointments").doc("A1").set({
  patientName: "Norhan",
  doctor: "Norhan",
  doctorId: NORHAN_STAFF,
  addedBy: "Malak",
  statusHistory: [{ status: "Scheduled", modifiedBy: "Norhan" }],
});
await clinic.collection("appointments").doc("A2").set({ patientName: "Sara", doctor: "Ramy", doctorId: "ramyStaff" });
await clinic.collection("ledger").doc("L1").set({ doctorId: NORHAN_STAFF, doctorName: "Norhan", amount: 3000, createdBy: NORHAN_UID });
await clinic.collection("clinical_notes").doc("N1").set({ doctor: "Norhan", createdByUid: NORHAN_UID, createdByName: "Norhan" });
await clinic.collection("attendance").doc("P1").set({ userId: NORHAN_UID, userName: "Norhan" });
await other.collection("appointments").doc("X1").set({ doctor: "Norhan" });
// Enough rows to cross a page boundary of the walk.
const batch = db.batch();
for (let i = 0; i < 520; i++) batch.set(clinic.collection("system_logs").doc(`log${String(i).padStart(4, "0")}`), { userName: i === 519 ? "Norhan" : "Malak" });
await batch.commit();

console.log("who may rename");
{
  const desk = await rename(DESK, { staffId: NORHAN_STAFF, name: "Norhan Adel" });
  check("a receptionist is refused", desk.status === 403, desk.json);
  const owner = await rename(ADMIN, { staffId: "ownerStaff", name: "Someone Else" });
  check("an admin cannot rename the owner", owner.status === 403, owner.json);
  const blank = await rename(ADMIN, { staffId: NORHAN_STAFF, name: "   " });
  check("a blank name is refused", blank.status === 400, blank.json);
  const ghost = await rename(ADMIN, { staffId: "nobody", name: "X" });
  check("an unknown staff row is a 404", ghost.status === 404, ghost.json);
  check("nothing changed yet", (await data(`staff/${NORHAN_STAFF}`)).name === "Norhan");
}

console.log("renaming");
{
  const { status, json } = await rename(ADMIN, { staffId: NORHAN_STAFF, name: "  Norhan   Adel " });
  check("succeeds", status === 200 && json.ok, json);
  check("reports the records it changed", json.documents === 5, json);
  check("staff row renamed, spacing tidied", (await data(`staff/${NORHAN_STAFF}`)).name === "Norhan Adel");
  check("login profile renamed", (await db.collection("users").doc(NORHAN_UID).get()).data()?.name === "Norhan Adel");
  check("sign-in display name renamed", displayNames[NORHAN_UID] === "Norhan Adel", displayNames);

  const a1 = await data("appointments/A1");
  check("booking's dentist renamed", a1.doctor === "Norhan Adel", a1);
  check("status history renamed", a1.statusHistory?.[0]?.modifiedBy === "Norhan Adel", a1);
  check("a patient who shares the name keeps it", a1.patientName === "Norhan", a1);
  check("someone else's field untouched", a1.addedBy === "Malak", a1);
  check("another dentist's booking untouched", (await data("appointments/A2")).doctor === "Ramy");
  const l1 = await data("ledger/L1");
  check("payment's dentist renamed, money untouched", l1.doctorName === "Norhan Adel" && l1.amount === 3000, l1);
  check("treatment renamed", (await data("clinical_notes/N1")).createdByName === "Norhan Adel");
  check("attendance renamed", (await data("attendance/P1")).userName === "Norhan Adel");
  check("a row past the first page is reached", (await data("system_logs/log0519")).userName === "Norhan Adel");
  check("another clinic is untouched", (await other.collection("appointments").doc("X1").get()).data()?.doctor === "Norhan");
}

console.log("running it again");
{
  const { status, json } = await rename(ADMIN, { staffId: NORHAN_STAFF, name: "Norhan Adel" });
  check("same name again changes nothing", status === 200 && json.documents === 0, json);
}

await db.recursiveDelete(clinic);
await db.recursiveDelete(other);
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
