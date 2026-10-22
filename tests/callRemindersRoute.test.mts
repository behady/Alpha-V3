/**
 * /api/call-reminders end to end, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/callRemindersRoute.test.mts
 *
 * Runs the real route handler with nothing mocked but the login check (a tiny server answers the
 * one lookup verifyIdToken makes), as tests/recycleBinCascade.test.mts does.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-call-reminders-route";
const CLINIC = "C1";
const OTHER = "C2";
const DESK = "desk-1";
const DESK2 = "desk-2";
const ADMIN = "admin-1";
const STRANGER = "stranger-1";

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
const route = await import("../src/app/api/call-reminders/route");
const { computeFireAt, quickDate } = await import("../src/lib/callReminders");
const { ymdInTimeZone } = await import("../src/lib/clinicDate");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const col = (name: string) => clinic.collection(name);

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FAIL  ${label} — ${JSON.stringify(detail)}`);
  }
}

type Json = Record<string, any>;
async function post(uid: string, body: Json): Promise<{ status: number; json: Json }> {
  const res = await route.POST(
    new Request("http://localhost/api/call-reminders", {
      method: "POST",
      headers: { authorization: `Bearer ${idToken(uid)}`, "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const read = async (id: string) => (await col("call_reminders").doc(id).get()).data() as Json | undefined;

async function wipe() {
  await db.recursiveDelete(clinic);
  for (const uid of [DESK, DESK2, ADMIN, STRANGER]) await db.recursiveDelete(db.collection("users").doc(uid));
}

await wipe();
await clinic.set({ name: "Calls Test", status: "Active", ownerId: ADMIN });
await db.collection("users").doc(DESK).set({ name: "سارة", clinicRoles: { [CLINIC]: "Receptionist" }, clinicPermissions: { [CLINIC]: [] } });
await db.collection("users").doc(DESK2).set({ name: "منى", clinicRoles: { [CLINIC]: "Receptionist" }, clinicPermissions: { [CLINIC]: [] } });
await db.collection("users").doc(ADMIN).set({ name: "Dr Ahmed", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc(STRANGER).set({ name: "Elsewhere", clinicRoles: { [OTHER]: "Admin" } });
await col("settings").doc("clinic_info").set({ alertPreferences: { timings: { callReminderDue: { hour: 9 } } } });
await col("patients").doc("P1").set({ name: "منى أحمد", phone: "01012345678" });

const today = ymdInTimeZone("Africa/Cairo", new Date());
const tomorrow = quickDate(today, "tomorrow");
const input = {
  patientId: "P1",
  date: tomorrow,
  time: null,
  reason: "  سعر\nالتركيبة ",
  recipient: { kind: "role", role: "Receptionist" },
  source: "patient",
};

/* --- create ----------------------------------------------------------------------------------- */
let firstId = "";
{
  const { status, json } = await post(DESK, { action: "create", branchId: "b1", ...input });
  check("create answers with the new id", status === 200 && typeof json.id === "string", json);
  firstId = json.id;
  const d = (await read(firstId)) || {};
  check("open", d.status === "open", d);
  check("fires at the clinic's morning hour", d.fireAt?.toMillis() === computeFireAt(tomorrow, null, 9).getTime(), d.fireAt?.toDate?.());
  check("pending until sent", d.pendingFireAt?.toMillis() === d.fireAt?.toMillis());
  check("the reason is cleaned", d.reason === "سعر التركيبة", d.reason);
  check("the creator is recorded", d.createdBy?.uid === DESK && d.createdBy?.name === "سارة", d.createdBy);
  check("the patient is snapshotted", d.patientName === "منى أحمد" && d.patientPhone === "01012345678", d);
  check("the branch on screen is kept", d.branchId === "b1", d.branchId);
  check("no undefined fields were written", !Object.values(d).some((v) => v === undefined));
}
{
  const { status, json } = await post(DESK, { action: "create", ...input, date: "2020-01-01" });
  check("a past day is refused", status === 400 && json.error === "date", json);
}
{
  const { status, json } = await post(DESK, { action: "create", ...input, patientId: "NOPE" });
  check("an unknown patient is 404", status === 404 && json.error === "not-found", json);
}
{
  const { status, json } = await post(STRANGER, { action: "create", ...input });
  check("someone from another clinic is refused", status === 403, json);
}

/* --- done ------------------------------------------------------------------------------------- */
{
  const { status } = await post(DESK, { action: "done", id: firstId, note: "قالت هتيجي السبت" });
  const d = (await read(firstId)) || {};
  check("done answers ok", status === 200);
  check("done: closed with the note and who", d.status === "done" && d.note === "قالت هتيجي السبت" && d.handledBy?.uid === DESK && d.handledAt != null, d);
  check("done: no longer pending", d.pendingFireAt === undefined);
  const again = await post(DESK, { action: "done", id: firstId });
  check("handling it twice is refused", again.status === 409 && again.json.error === "already-handled", again.json);
}

/* --- call again ------------------------------------------------------------------------------- */
{
  const created = await post(DESK, { action: "create", ...input });
  const id = created.json.id;
  const later = quickDate(today, "week");
  const { status, json } = await post(DESK2, { action: "reschedule", id, date: later, time: "16:30", note: "ما ردتش" });
  const old = (await read(id)) || {};
  const next = (await read(json.id)) || {};
  check("call again answers with the new id", status === 200 && typeof json.id === "string" && json.id !== id, json);
  check("the old one is closed and points forward", old.status === "rescheduled" && old.nextId === json.id && old.note === "ما ردتش" && old.handledBy?.uid === DESK2, old);
  check("the new one is open, same people and reason, points back", next.status === "open" && next.previousId === id && next.reason === old.reason && JSON.stringify(next.recipient) === JSON.stringify(old.recipient), next);
  check("the new one fires at its own time", next.fireAt?.toMillis() === computeFireAt(later, "16:30", 9).getTime());
}

/* --- book ------------------------------------------------------------------------------------- */
{
  const created = await post(DESK, { action: "create", ...input });
  const id = created.json.id;
  const { status } = await post(DESK, { action: "book", id, appointmentId: "A9", appointmentDate: "2026-11-02" });
  const d = (await read(id)) || {};
  check("book answers ok", status === 200);
  check("booked, with the appointment and the note", d.status === "booked" && d.appointmentId === "A9" && d.note === "اتحجز ميعاد يوم 2026-11-02", d);
}

/* --- delete ----------------------------------------------------------------------------------- */
{
  const mine = (await post(DESK, { action: "create", ...input })).json.id;
  const theirs = await post(DESK2, { action: "delete", id: mine });
  check("another receptionist cannot delete it", theirs.status === 403, theirs.json);
  const own = await post(DESK, { action: "delete", id: mine });
  check("the creator can", own.status === 200 && !(await read(mine)), own.json);

  const other = (await post(DESK, { action: "create", ...input })).json.id;
  const byAdmin = await post(ADMIN, { action: "delete", id: other });
  check("an admin can", byAdmin.status === 200 && !(await read(other)), byAdmin.json);
}

/* --- nonsense ----------------------------------------------------------------------------------- */
{
  const { status, json } = await post(DESK, { action: "explode" });
  check("an unknown action is refused", status === 400 && json.error === "bad-action", json);
}

await wipe();
authServer.close();
console.log(`call reminders route: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
