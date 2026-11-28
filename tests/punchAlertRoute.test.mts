/**
 * End-to-end test for /api/attendance/punch-alert against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:punch-alert-route
 *
 * The real route and the real alert gate, nothing mocked but the login check (a tiny server that
 * answers the one lookup verifyIdToken makes). The story: an owner who switched "Someone clocked
 * in or out" on sees Sohila's clock-in and clock-out in the bell, worded from the saved record;
 * nobody else can ring it for her, it rings once per punch, never for the automatic night
 * clock-out, never for an old punch, and never in a clinic that left the alert off.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-punch-alert";
const OWNER = "owner-1";
const SOHILA = "sohila-uid";
const FATEN = "faten-uid";
const TZ = "Africa/Cairo";

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
process.env.CLINIC_TIMEZONE = TZ;

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
const { Timestamp } = await import("firebase-admin/firestore");
const { POST } = await import("../src/app/api/attendance/punch-alert/route");

const db = adminDb();
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" }).format(d);

async function seedClinic(id: string, alertOn: boolean) {
  await db.doc(`clinics/${id}`).set({ status: "Active", ownerId: OWNER, name: id });
  await db.doc(`clinics/${id}/settings/clinic_info`).set(
    alertOn ? { alertPreferences: { events: { staffClockInOut: { bell: true, push: true } } } } : {},
  );
  // Sohila's shift started 25 minutes ago, on every day of the week.
  const start = hhmm(new Date(Date.now() - 25 * 60_000));
  const everyDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { active: true, start, end: "23:59" }]));
  await db.doc(`clinics/${id}/staff/st-sohila`).set({ name: "sohila ahmed", uid: SOHILA, role: "Receptionist", attendanceSchedule: everyDay });
  await db.doc(`clinics/${id}/staff/st-faten`).set({ name: "faten", uid: FATEN, role: "Receptionist" });
  for (const [uid, role] of [[OWNER, "Owner"], [SOHILA, "Receptionist"], [FATEN, "Receptionist"]] as const) {
    await db.doc(`users/${uid}`).set({ clinicRoles: { [id]: role } }, { merge: true });
  }
  return start;
}

const call = (as: string, body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/attendance/punch-alert", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken(as)}` },
      body: JSON.stringify(body),
    }),
  );

const bell = async (clinic: string) =>
  (await db.collection(`clinics/${clinic}/notifications`).get()).docs.map((d) => d.data() as { title: string; body: string; audience: string[]; eventType: string });

let passed = 0;
const check = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

// --- seed -----------------------------------------------------------------------------------
const shiftStart = await seedClinic("ON", true);
await seedClinic("OFF", false);
const lateIn = new Date(Date.now() - 4 * 60_000); // 21 minutes after a shift that began 25 minutes ago
const punch = (over: Record<string, unknown> = {}) => ({
  userId: SOHILA,
  userName: "Sohila",
  staffId: "st-sohila",
  date: ymd(lateIn),
  checkIn: Timestamp.fromDate(lateIn),
  checkOut: null,
  durationMinutes: 0,
  status: "active",
  checkInBranchName: "التجمع الخامس",
  ...over,
});
await db.doc("clinics/ON/attendance/a1").set(punch());
await db.doc("clinics/OFF/attendance/a1").set(punch());
await db.doc("clinics/ON/attendance/old").set(punch({ checkIn: Timestamp.fromDate(new Date(Date.now() - 3 * 3600_000)) }));

// --- run ------------------------------------------------------------------------------------
console.log("clock-in");

await check("the owner gets Sohila's clock-in, worded from the saved record", async () => {
  const res = await call(SOHILA, { clinicId: "ON", attendanceId: "a1", direction: "in" });
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(answer.raised, true, JSON.stringify(answer));
  const rows = await bell("ON");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, "staffClockInOut");
  assert.deepEqual(rows[0].audience, [OWNER]);
  assert.equal(rows[0].title, `🟢 sohila ahmed: حضور ${hhmm(lateIn)}`);
  assert.equal(rows[0].body, `تأخير 21 دقيقة (الشيفت ${shiftStart}) · فرع التجمع الخامس`);
});

await check("the same punch never rings twice", async () => {
  const res = await call(SOHILA, { clinicId: "ON", attendanceId: "a1", direction: "in" });
  assert.equal((await res.json()).raised, false);
  assert.equal((await bell("ON")).length, 1);
});

await check("somebody else cannot ring it for her", async () => {
  const res = await call(FATEN, { clinicId: "ON", attendanceId: "a1", direction: "out" });
  assert.equal(res.status, 403);
});

await check("a punch from hours ago does not ring", async () => {
  const res = await call(SOHILA, { clinicId: "ON", attendanceId: "old", direction: "in" });
  assert.equal((await res.json()).raised, false);
  assert.equal((await bell("ON")).length, 1);
});

await check("a clinic that left the alert off hears nothing", async () => {
  const res = await call(SOHILA, { clinicId: "OFF", attendanceId: "a1", direction: "in" });
  assert.equal((await res.json()).raised, false);
  assert.equal((await bell("OFF")).length, 0);
});

console.log("clock-out");

await check("the clock-out says how long she worked", async () => {
  await db.doc("clinics/ON/attendance/a1").set(
    { checkOut: Timestamp.fromDate(new Date()), durationMinutes: 7 * 60 + 44, status: "completed", checkOutBranchName: "التجمع الخامس" },
    { merge: true },
  );
  const res = await call(SOHILA, { clinicId: "ON", attendanceId: "a1", direction: "out" });
  assert.equal((await res.json()).raised, true);
  const out = (await bell("ON")).find((r) => r.title.startsWith("🔴"));
  assert.ok(out, "no clock-out row in the bell");
  assert.equal(out.body, "مدة الشغل 7 ساعات و44 دقيقة · فرع التجمع الخامس");
});

await check("the automatic night clock-out does not ring", async () => {
  await db.doc("clinics/ON/attendance/auto").set(punch({ checkOut: Timestamp.fromDate(new Date()), autoClosed: true, status: "completed" }));
  const res = await call(SOHILA, { clinicId: "ON", attendanceId: "auto", direction: "out" });
  assert.equal((await res.json()).raised, false);
  assert.equal((await bell("ON")).length, 2);
});

await check("a bad request is refused, not guessed", async () => {
  assert.equal((await call(SOHILA, { clinicId: "ON", attendanceId: "a1" })).status, 400);
  assert.equal((await call(SOHILA, { clinicId: "ON", attendanceId: "../x", direction: "in" })).status, 400);
});

console.log(`\n${passed} passed`);
authServer.close();
process.exit(0);
