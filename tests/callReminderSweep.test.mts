/**
 * The 10-minute sweep's call-reminder steps, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/callReminderSweep.test.mts
 *
 * Delivery is the one thing replaced: a recorder stands in for deliverClinicNotification, so the
 * test sees exactly who would have been told what, and how many times.
 */

import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-call-reminders";
const CLINIC = "C1";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { Timestamp } = await import("firebase-admin/firestore");
const { sendDueCallReminders, sendMissedCalls } = await import("../src/lib/alerts/callReminderSweep");
const { reminderWhatsappText, missedSummaryText, recipientLabel, reminderFromDoc } = await import("../src/lib/callReminders");

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
    console.error(`FAIL ${label}`, detail);
  }
}

type Call = { title: string; body: string; opts: Record<string, unknown> };
function recorder() {
  const calls: Call[] = [];
  const deliver = (async (_clinicId: string, n: { title: string; body: string }, opts: Record<string, unknown> = {}) => {
    calls.push({ title: n.title, body: n.body, opts });
    return { raised: true, bellWritten: true, pushed: 1, whatsapped: 1 };
  }) as never;
  return { calls, deliver };
}

async function wipe() {
  for (const name of ["call_reminders", "staff", "patients", "alert_marks", "settings"]) {
    const snap = await col(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function seed() {
  await wipe();
  await clinic.set({ ownerId: "owner-1", status: "Active" });
  await col("staff").doc("s-a").set({ uid: "rec-a", role: "Receptionist", name: "سارة", branchIds: ["b1"] });
  await col("staff").doc("s-b").set({ uid: "rec-b", role: "Receptionist", name: "منى", branchIds: ["b2"] });
  await col("staff").doc("s-c").set({ uid: "rec-c", role: "Receptionist", name: "هبة" });
  await col("patients").doc("p1").set({ name: "منى أحمد", phone: "01012345678" });
}

const NOW = new Date("2026-10-22T10:00:00Z"); // 13:00 in Cairo (summer time)
const ago = (min: number) => Timestamp.fromMillis(NOW.getTime() - min * 60000);

async function addReminder(id: string, over: Record<string, unknown> = {}) {
  const fireAt = (over.fireAt as unknown) ?? ago(5);
  await col("call_reminders").doc(id).set({
    patientId: "p1",
    patientName: "منى أحمد",
    patientPhone: "01012345678",
    branchId: "b1",
    reason: "سعر التركيبة",
    source: "patient",
    date: "2026-10-22",
    time: null,
    fireAt,
    pendingFireAt: fireAt,
    recipient: { kind: "role", role: "Receptionist" },
    status: "open",
    createdBy: { uid: "rec-a", name: "سارة" },
    createdAt: Timestamp.fromMillis(Date.parse("2026-10-20T09:00:00Z")),
    ...over,
  });
}
const read = async (id: string) => (await col("call_reminders").doc(id).get()).data() || {};

/* --- a due reminder goes out once, to its people ------------------------------------------------ */
{
  await seed();
  await addReminder("r1");
  const { calls, deliver } = recorder();
  const out: string[] = [];
  const sent = await sendDueCallReminders(CLINIC, NOW, out, { deliver });
  const after = await read("r1");
  check("sends one reminder", sent === 1 && calls.length === 1, { sent, calls: calls.length });
  check("to the b1 receptionists and the one who works everywhere", JSON.stringify(calls[0]?.opts.uids) === JSON.stringify(["rec-a", "rec-c"]), calls[0]?.opts.uids);
  check("as the callReminderDue event", calls[0]?.opts.event === "callReminderDue");
  check("opens the reminder on the Calls page", calls[0]?.opts.actionUrl === "/calls?id=r1");
  check("titled as a call reminder", calls[0]?.title === "📞 تذكير بمكالمة");
  const expected = reminderWhatsappText(reminderFromDoc("r1", after), "https://alphadental.app/calls?id=r1");
  check("with the reminder's WhatsApp text", calls[0]?.opts.whatsappText === expected, calls[0]?.opts.whatsappText);
  check("marked as sent", after.notifiedAt != null && after.pendingFireAt === undefined, after);
  check("reported to the sweep", out.includes("callReminderDue:r1"), out);
}

/* --- two overlapping sweeps send it once ------------------------------------------------------- */
{
  await seed();
  await addReminder("r2");
  const { calls, deliver } = recorder();
  await Promise.all([sendDueCallReminders(CLINIC, NOW, [], { deliver }), sendDueCallReminders(CLINIC, NOW, [], { deliver })]);
  check("two sweeps, one delivery", calls.length === 1, calls.length);
}

/* --- not yet due is left alone ----------------------------------------------------------------- */
{
  await seed();
  await addReminder("r3", { fireAt: ago(-60) });
  const { calls, deliver } = recorder();
  await sendDueCallReminders(CLINIC, NOW, [], { deliver });
  const after = await read("r3");
  check("an hour early: nothing sent", calls.length === 0);
  check("an hour early: still pending", after.pendingFireAt != null);
}

/* --- the patient is gone ----------------------------------------------------------------------- */
{
  await seed();
  await col("patients").doc("p1").delete();
  await addReminder("r4");
  const { calls, deliver } = recorder();
  await sendDueCallReminders(CLINIC, NOW, [], { deliver });
  const after = await read("r4");
  check("missing patient: nothing sent", calls.length === 0);
  check("missing patient: recorded and no longer pending", after.deliveryError === "patient-missing" && after.pendingFireAt === undefined, after);
}

/* --- nobody left to receive it ----------------------------------------------------------------- */
{
  await seed();
  await addReminder("r5", { recipient: { kind: "person", uid: "gone-1", name: "رحاب" } });
  const { calls, deliver } = recorder();
  await sendDueCallReminders(CLINIC, NOW, [], { deliver });
  const after = await read("r5");
  check("nobody: nothing sent", calls.length === 0);
  check("nobody: recorded, still open, no longer pending", after.deliveryError === "nobody" && after.status === "open" && after.pendingFireAt === undefined, after);
}

/* --- the message uses the patient as they are now --------------------------------------------- */
{
  await seed();
  await addReminder("r6");
  await col("patients").doc("p1").update({ name: "منى أحمد علي", phone: "01099999999" });
  const { calls, deliver } = recorder();
  await sendDueCallReminders(CLINIC, NOW, [], { deliver });
  const text = String(calls[0]?.opts.whatsappText || "");
  check("current name and phone", text.includes("منى أحمد علي — 01099999999"), text);
}

/* --- a handled reminder is never sent ---------------------------------------------------------- */
{
  await seed();
  await addReminder("r7", { status: "done" });
  const { calls, deliver } = recorder();
  await sendDueCallReminders(CLINIC, NOW, [], { deliver });
  check("done before it fired: nothing sent", calls.length === 0);
}

/* --- the evening list -------------------------------------------------------------------------- */
const prefsAt = (hour: number) => ({ timings: { callRemindersMissed: { hour } } }) as never;
const EVENING = new Date("2026-10-22T18:05:00Z"); // 21:05 in Cairo
{
  await seed();
  await addReminder("m1", { fireAt: Timestamp.fromMillis(Date.parse("2026-10-22T07:00:00Z")), pendingFireAt: null });
  await addReminder("m2", { fireAt: Timestamp.fromMillis(Date.parse("2026-10-22T09:00:00Z")), pendingFireAt: null, patientName: "كريم علي", recipient: { kind: "person", uid: "rec-a", name: "سارة" } });
  await addReminder("m3", { fireAt: Timestamp.fromMillis(Date.parse("2026-10-22T08:00:00Z")), pendingFireAt: null, status: "done" });
  await addReminder("m4", { date: "2026-10-20", fireAt: Timestamp.fromMillis(Date.parse("2026-10-20T07:00:00Z")), pendingFireAt: null });
  const { calls, deliver } = recorder();
  const first = await sendMissedCalls(CLINIC, prefsAt(21), "2026-10-22", EVENING, [], { deliver });
  const second = await sendMissedCalls(CLINIC, prefsAt(21), "2026-10-22", EVENING, [], { deliver });
  check("evening: one message a day", first === true && second === false && calls.length === 1, { first, second, n: calls.length });
  check("evening: as callRemindersMissed", calls[0]?.opts.event === "callRemindersMissed");
  const today = [reminderFromDoc("m1", await read("m1")), reminderFromDoc("m2", await read("m2"))];
  const expected = missedSummaryText(today, 1, (role) => recipientLabel({ kind: "role", role: role as "Receptionist" }, true));
  check("evening: the list of today's misses plus the older count", calls[0]?.opts.whatsappText === expected, calls[0]?.opts.whatsappText);
}
{
  await seed();
  await addReminder("m5", { fireAt: Timestamp.fromMillis(Date.parse("2026-10-22T07:00:00Z")), pendingFireAt: null, status: "done" });
  const { calls, deliver } = recorder();
  const sent = await sendMissedCalls(CLINIC, prefsAt(21), "2026-10-22", EVENING, [], { deliver });
  check("evening: nothing missed, nothing sent", sent === false && calls.length === 0);
}
{
  await seed();
  await addReminder("m6", { fireAt: Timestamp.fromMillis(Date.parse("2026-10-22T07:00:00Z")), pendingFireAt: null });
  const { calls, deliver } = recorder();
  const sent = await sendMissedCalls(CLINIC, prefsAt(22), "2026-10-22", EVENING, [], { deliver });
  check("evening: not before the configured hour", sent === false && calls.length === 0);
}

await wipe();
console.log(`call reminder sweep: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
