/**
 * /api/automation/attendance-autoclose end to end, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/attendanceAutoCloseRoute.test.mts
 *
 * The real route handler, called the way the scheduler calls it. What it must prove:
 *   - a forgotten shift is closed at shift end + the clinic's hours, and marked as automatic;
 *   - a shift still inside its allowance is left open;
 *   - a clinic that never set the hours is not touched at all;
 *   - a suspended clinic is not touched;
 *   - nobody without the scheduler's secret can run it.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-attendance-autoclose";
const SECRET = "test-cron-secret";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.CRON_SECRET = SECRET;

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { Timestamp } = await import("firebase-admin/firestore");
const { GET } = await import("../src/app/api/automation/attendance-autoclose/route");

const db = adminDb();
const TZ = "Africa/Cairo";

/** The instant the clock in Cairo read `hm` on the Cairo date `daysAgo` days back. */
function cairo(daysAgo: number, hm: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() - daysAgo * 86_400_000));
  for (const offset of ["+02:00", "+03:00"]) {
    const d = new Date(`${ymd}T${hm}:00${offset}`);
    const shown = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    if (shown === hm) return d;
  }
  throw new Error(`could not place ${hm} in Cairo`);
}

const everyDay = (start: string, end: string) =>
  Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), { active: true, start, end }]));

async function seedClinic(id: string, opts: { status?: string; hours?: string }) {
  await db.doc(`clinics/${id}`).set({ name: id, status: opts.status ?? "Active" });
  await db.doc(`clinics/${id}/settings/clinic_info`).set({
    name: id,
    schedule: { start: "09:00", end: "21:00" },
    ...(opts.hours !== undefined ? { attendanceAutoCloseHours: opts.hours } : {}),
  });
  await db.doc(`clinics/${id}/staff/s-evening`).set({ name: "Evening", uid: "u-evening", attendanceSchedule: everyDay("13:00", "21:00") });
  await db.doc(`clinics/${id}/staff/s-morning`).set({ name: "Morning", uid: "u-morning", attendanceSchedule: everyDay("09:00", "15:00") });
}

const openLog = (staffId: string, userId: string, checkIn: Date) => ({
  userId,
  staffId,
  userName: staffId,
  date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(checkIn),
  checkIn: Timestamp.fromDate(checkIn),
  checkOut: null,
  durationMinutes: 0,
  status: "active",
});

const call = (auth?: string) =>
  GET(new Request("http://localhost/api/automation/attendance-autoclose", { headers: auth ? { authorization: auth } : {} }));

let passed = 0;
const check = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

// --- seed ---------------------------------------------------------------------------------
await seedClinic("ON", { hours: "2" });
await seedClinic("OFF", {});
await seedClinic("EMPTY", { hours: "" });
await seedClinic("SUSPENDED", { status: "Suspended", hours: "2" });

const forgotten = cairo(2, "13:05");
const forgottenMorning = cairo(1, "09:00");
const justNow = new Date(Date.now() - 10 * 60_000);

const at = (clinic: string, id: string) => db.doc(`clinics/${clinic}/attendance/${id}`);
await at("ON", "forgotten").set(openLog("s-evening", "u-evening", forgotten));
await at("ON", "forgotten-morning").set(openLog("s-morning", "u-morning", forgottenMorning));
// Older rows carry no staffId; the person is found by their sign-in id instead.
await at("ON", "forgotten-old-row").set({ ...openLog("", "u-morning", forgottenMorning), staffId: null });
await at("ON", "working-now").set(openLog("s-evening", "u-evening", justNow));
// A waiting-room row (a patient, not staff) shares this collection. It has no userId.
await at("ON", "patient-row").set({ status: "active", patientId: "p1", checkIn: Timestamp.fromDate(forgotten) });
await at("ON", "already-done").set({
  ...openLog("s-evening", "u-evening", cairo(3, "13:00")),
  checkOut: Timestamp.fromDate(cairo(3, "20:00")),
  durationMinutes: 420,
  status: "completed",
});
for (const clinic of ["OFF", "EMPTY", "SUSPENDED"]) {
  await at(clinic, "forgotten").set(openLog("s-evening", "u-evening", forgotten));
}

// --- run ----------------------------------------------------------------------------------
console.log("who may run it");

await check("no secret -> refused", async () => {
  const res = await call();
  assert.notEqual(res.status, 200);
});

await check("wrong secret -> refused", async () => {
  const res = await call("Bearer nope");
  assert.notEqual(res.status, 200);
});

await check("nothing was changed by the refused calls", async () => {
  assert.equal((await at("ON", "forgotten").get()).data()?.status, "active");
});

console.log("the scheduled run");

let body: { ok: boolean; closed: number; clinicsEnabled: number; failed: unknown[] };
await check("runs and reports 3 shifts closed in 1 clinic", async () => {
  const res = await call(`Bearer ${SECRET}`);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.failed, []);
  assert.equal(body.clinicsEnabled, 1);
  assert.equal(body.closed, 3);
});

await check("forgotten evening shift: closed at 23:00 that night (21:00 + 2h), 9h55m, marked automatic", async () => {
  const d = (await at("ON", "forgotten").get()).data()!;
  assert.equal(d.status, "completed");
  assert.equal(d.autoClosed, true);
  assert.equal(d.autoCloseHours, 2);
  assert.equal(d.checkOut.toDate().toISOString(), cairo(2, "23:00").toISOString());
  assert.equal(d.durationMinutes, 595);
  assert.ok(d.autoClosedAt, "records when the system closed it");
});

await check("forgotten morning shift uses that person's own hours: closed at 17:00 (15:00 + 2h)", async () => {
  const d = (await at("ON", "forgotten-morning").get()).data()!;
  assert.equal(d.checkOut.toDate().toISOString(), cairo(1, "17:00").toISOString());
  assert.equal(d.durationMinutes, 480);
});

await check("an old row with no staff id is matched by sign-in id and closed the same way", async () => {
  const d = (await at("ON", "forgotten-old-row").get()).data()!;
  assert.equal(d.status, "completed");
  assert.equal(d.checkOut.toDate().toISOString(), cairo(1, "17:00").toISOString());
});

await check("someone working right now is left clocked in", async () => {
  const d = (await at("ON", "working-now").get()).data()!;
  assert.equal(d.status, "active");
  assert.equal(d.checkOut, null);
  assert.equal(d.autoClosed, undefined);
});

await check("a shift that was already clocked out is not rewritten", async () => {
  const d = (await at("ON", "already-done").get()).data()!;
  assert.equal(d.durationMinutes, 420);
  assert.equal(d.autoClosed, undefined);
});

await check("a patient waiting-room row in the same collection is never touched", async () => {
  const snap = await at("ON", "patient-row").get();
  assert.equal(snap.data()!.status, "active");
  assert.equal(snap.updateTime!.toMillis(), snap.createTime!.toMillis());
});

console.log("clinics that must not be touched");

for (const [clinic, why] of [
  ["OFF", "never set the hours"],
  ["EMPTY", "left the box empty"],
  ["SUSPENDED", "is suspended"],
] as const) {
  await check(`a clinic that ${why} keeps its open shift exactly as it was`, async () => {
    const snap = await at(clinic, "forgotten").get();
    const d = snap.data()!;
    assert.equal(d.status, "active");
    assert.equal(d.checkOut, null);
    assert.equal(d.autoClosed, undefined);
    assert.equal(snap.updateTime!.toMillis(), snap.createTime!.toMillis(), "the document was never written to");
  });
}

console.log("running it again");

await check("a second run closes nothing more and changes nothing", async () => {
  const before = (await at("ON", "forgotten").get()).updateTime!.toMillis();
  const res = await call(`Bearer ${SECRET}`);
  const again = await res.json();
  assert.equal(again.closed, 0);
  assert.equal((await at("ON", "forgotten").get()).updateTime!.toMillis(), before);
});

console.log(`\nAll assertions passed. ${passed} checks.`);
process.exit(0);
