/**
 * Call reminders: when one fires, who it reaches, and what the messages say.
 * Run: npm run test:calls
 */
import assert from "node:assert/strict";
import {
  REASON_MAX,
  cairoInstant,
  cleanReason,
  computeFireAt,
  daysLate,
  missedSummaryText,
  quickDate,
  recipientLabel,
  reminderFromDoc,
  reminderWhatsappText,
  resolveRecipients,
  sortForCard,
  validateReminderInput,
  type CallReminder,
  type ReminderInput,
} from "../src/lib/callReminders";

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks += 1; };

/* --- fire time, on the Cairo clock ---------------------------------------------------------- */

eq(computeFireAt("2026-07-15", "10:00", 10).toISOString(), "2026-07-15T07:00:00.000Z", "summer: Cairo is UTC+3");
eq(computeFireAt("2026-12-15", "10:00", 10).toISOString(), "2026-12-15T08:00:00.000Z", "winter: Cairo is UTC+2");
eq(computeFireAt("2026-12-15", null, 9).toISOString(), "2026-12-15T07:00:00.000Z", "no time = the clinic's morning hour");
eq(computeFireAt("2026-07-15", "16:30", 10).toISOString(), "2026-07-15T13:30:00.000Z", "minutes are kept");
eq(cairoInstant("2026-01-05", "00:00").toISOString(), "2026-01-04T22:00:00.000Z", "midnight lands on the previous UTC day");

/* --- what a person may save ----------------------------------------------------------------- */

const valid: ReminderInput = {
  patientId: "p1",
  date: "2026-10-23",
  time: null,
  reason: "سعر التركيبة",
  recipient: { kind: "person", uid: "u1", name: "سارة" },
  source: "patient",
};
eq(validateReminderInput({ ...valid, date: "2026-10-21" }, "2026-10-22"), { ok: false, error: "date" }, "a past day is refused");
eq(validateReminderInput({ ...valid, date: "2026-10-22" }, "2026-10-22").ok, true, "today is allowed");
eq(validateReminderInput({ ...valid, date: "22/10/2026" }, "2026-10-22"), { ok: false, error: "date" }, "a malformed day is refused");
eq(validateReminderInput({ ...valid, time: "25:00" }, "2026-10-22"), { ok: false, error: "time" }, "an impossible time is refused");
eq(validateReminderInput({ ...valid, time: "16:30" }, "2026-10-22").ok, true, "a real time is fine");
eq(validateReminderInput({ ...valid, reason: "   " }, "2026-10-22"), { ok: false, error: "reason" }, "a blank reason is refused");
eq(
  validateReminderInput({ ...valid, recipient: { kind: "person", uid: "", name: "" } }, "2026-10-22"),
  { ok: false, error: "recipient" },
  "a person recipient needs a uid",
);
eq(
  validateReminderInput({ ...valid, recipient: { kind: "role", role: "Owner" as never } }, "2026-10-22"),
  { ok: false, error: "recipient" },
  "only the four roles can be addressed",
);
const cleaned = validateReminderInput({ ...valid, reason: "  سعر\nالتركيبة  " }, "2026-10-22");
eq(cleaned.ok && cleaned.value.reason, "سعر التركيبة", "the saved reason is cleaned");

eq(cleanReason("  سعر\nالتركيبة  "), "سعر التركيبة", "whitespace and newlines collapse to one space");
eq(cleanReason("x".repeat(400)).length, REASON_MAX, "a long reason is cut to the maximum");

/* --- who receives it ------------------------------------------------------------------------ */

const staff = [
  { uid: "a", role: "Receptionist", branchIds: ["b1"] },
  { uid: "b", role: "Receptionist", branchIds: ["b2"] },
  { uid: "c", role: "Receptionist" },
  { uid: "d", role: "Dentist" },
];
eq(resolveRecipients({ kind: "role", role: "Receptionist" }, "b1", staff), ["a", "c"], "a role reaches its people at that branch; no branch list = everywhere");
eq(resolveRecipients({ kind: "role", role: "Receptionist" }, null, staff), ["a", "b", "c"], "no branch on the reminder = the whole clinic");
eq(
  resolveRecipients({ kind: "role", role: "Admin" }, null, [{ uid: "o", role: "Owner" }, { uid: "x", role: "Admin" }]),
  ["o", "x"],
  "the owner is addressed as an admin",
);
eq(resolveRecipients({ kind: "person", uid: "zz", name: "سارة" }, null, staff), [], "someone no longer on staff reaches nobody");
eq(resolveRecipients({ kind: "person", uid: "b", name: "منى" }, "b1", staff), ["b"], "a named person is reached whatever their branch");

/* --- quick days ----------------------------------------------------------------------------- */

eq(quickDate("2026-10-31", "tomorrow"), "2026-11-01", "tomorrow crosses the month");
eq(quickDate("2026-10-31", "3days"), "2026-11-03", "in three days");
eq(quickDate("2026-10-31", "week"), "2026-11-07", "in a week");
eq(quickDate("2026-10-31", "month"), "2026-11-30", "a month from the 31st lands on the month's last day");

/* --- the card ------------------------------------------------------------------------------- */

const base = (over: Partial<CallReminder>): CallReminder => ({
  id: "r",
  patientId: "p1",
  patientName: "منى أحمد",
  patientPhone: "01012345678",
  branchId: null,
  reason: "سعر التركيبة، قالت هتفكر",
  source: "patient",
  date: "2026-10-22",
  time: null,
  fireAtMs: Date.parse("2026-10-22T07:00:00Z"),
  recipient: { kind: "person", uid: "u1", name: "سارة" },
  status: "open",
  createdBy: { uid: "u1", name: "سارة" },
  createdAtMs: Date.parse("2026-10-20T09:00:00Z"),
  ...over,
});
const late = base({ id: "late", date: "2026-10-20", fireAtMs: Date.parse("2026-10-20T07:00:00Z") });
const noon = base({ id: "noon", time: "12:00", fireAtMs: Date.parse("2026-10-22T09:00:00Z") });
const morning = base({ id: "morning" });
eq(sortForCard([noon, morning, late], Date.parse("2026-10-22T10:00:00Z")).map((r) => r.id), ["late", "morning", "noon"], "overdue first, then today's by time");
eq(daysLate(late, "2026-10-22"), 2, "two days late");
eq(daysLate(morning, "2026-10-22"), 0, "due today is not late");

/* --- the texts ------------------------------------------------------------------------------ */

eq(
  reminderWhatsappText(base({}), "https://alphadental.app/calls?id=r1"),
  [
    "📞 تذكير بمكالمة",
    "المريض: منى أحمد — 01012345678",
    "السبب: سعر التركيبة، قالت هتفكر",
    "من: سارة · يوم 20 أكتوبر",
    "افتح: https://alphadental.app/calls?id=r1",
  ].join("\n"),
  "the reminder's WhatsApp text",
);

const roleLabel = (role: string) => recipientLabel({ kind: "role", role: role as "Receptionist" }, true);
eq(missedSummaryText([], 0, roleLabel), null, "no misses, no message");
eq(
  missedSummaryText(
    [
      base({ id: "1" }),
      base({ id: "2", patientName: "كريم علي", recipient: { kind: "role", role: "Receptionist" } }),
    ],
    5,
    roleLabel,
  ),
  ["⚠️ ٢ مكالمات ما اتعملتش النهارده:", "منى أحمد (سارة) · كريم علي (الاستقبال)", "و٥ متأخرة من أيام قبل كده"].join("\n"),
  "the evening list",
);
eq(
  missedSummaryText([base({ id: "1" })], 0, roleLabel),
  ["⚠️ ١ مكالمات ما اتعملتش النهارده:", "منى أحمد (سارة)"].join("\n"),
  "no older line when nothing older is open",
);

eq(recipientLabel({ kind: "role", role: "Assistant" }, true), "المساعدين", "role label in Arabic");
eq(recipientLabel({ kind: "role", role: "Assistant" }, false), "Assistants", "role label in English");
eq(recipientLabel({ kind: "person", uid: "u", name: "سارة" }, false), "سارة", "a person shows their name");

/* --- a Firestore document becomes a reminder ------------------------------------------------ */

const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const fromDoc = reminderFromDoc("r9", {
  patientId: "p1",
  patientName: "منى",
  patientPhone: "010",
  branchId: "b1",
  reason: "x",
  source: "booking",
  date: "2026-10-22",
  time: "12:00",
  fireAt: ts("2026-10-22T09:00:00Z"),
  recipient: { kind: "role", role: "Receptionist" },
  status: "open",
  createdBy: { uid: "u1", name: "سارة" },
  createdAt: ts("2026-10-20T09:00:00Z"),
});
eq(fromDoc.id, "r9", "id carried");
eq(fromDoc.fireAtMs, Date.parse("2026-10-22T09:00:00Z"), "timestamps become epoch ms");
eq(fromDoc.handledAtMs, undefined, "absent optional fields stay absent");

/* --- where reminders are created (source checks) -------------------------------------------- */

const { readFileSync } = await import("node:fs");
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

for (const rel of ["src/app/(dashboard)/patients/[id]/page.tsx", "src/components/BookingModal.tsx", "src/components/clinical-notes/index.tsx"]) {
  eq(src(rel).includes("CallReminderDialog"), true, `${rel} opens the call reminder window`);
}
{
  const dialog = src("src/components/calls/CallReminderDialog.tsx");
  for (const chip of ["بكرة", "بعد ٣ أيام", "بعد أسبوع", "بعد شهر"]) eq(dialog.includes(chip), true, `the window offers "${chip}"`);
  eq(dialog.includes("createCallReminder("), true, "the window saves through the route");
}
eq(/headerPatientId\s*&&[\s\S]{0,400}CallReminderDialog|setCallReminderOpen\(true\)/.test(src("src/components/BookingModal.tsx")), true, "the booking pop-up offers it for a chosen patient");
eq(/!isNewPatient|headerPatientId/.test(src("src/components/BookingModal.tsx").split("setCallReminderOpen(true)")[0].slice(-600)), true, "never for a patient not yet saved");
eq(src("src/app/(dashboard)/patients/[id]/page.tsx").includes("<PatientCallsPanel"), true, "the patient file lists its calls");

/* --- the dashboard card ----------------------------------------------------------------------- */

{
  const { dueOnCard } = await import("../src/lib/callReminders");
  const now = Date.parse("2026-10-22T10:00:00Z");
  const tomorrowRow = base({ id: "tomorrow", date: "2026-10-23", fireAtMs: Date.parse("2026-10-23T07:00:00Z") });
  const doneRow = base({ id: "done", status: "done" });
  eq(dueOnCard([tomorrowRow, noon, doneRow, late, morning], now, "2026-10-22").map((r) => r.id), ["late", "morning", "noon"], "today's and overdue open calls, overdue first; not tomorrow's, not handled ones");

  const host = src("src/components/calls/CallBookingHost.tsx");
  const save = host.indexOf("await saveBooking(");
  const book = host.indexOf("markCallBooked(");
  eq(save > -1 && book > save, true, "a call is marked booked only after the booking itself saved");
  for (const rel of ["src/components/dashboard/DesktopDashboard.tsx", "src/components/dashboard/OwnerHome.tsx"]) {
    eq(src(rel).includes("<CallsTodayCard"), true, `${rel} shows today's calls`);
  }
}

/* --- the Calls page ---------------------------------------------------------------------------- */

{
  const { callsTab } = await import("../src/lib/callReminders");
  const now = Date.parse("2026-10-22T10:00:00Z");
  eq(callsTab(morning, now, "2026-10-22"), "today", "open and due today");
  eq(callsTab(late, now, "2026-10-22"), "late", "open from an earlier day");
  eq(callsTab(base({ date: "2026-10-25" }), now, "2026-10-22"), "upcoming", "open for a later day");
  eq(callsTab(base({ status: "booked" }), now, "2026-10-22"), "done", "anything handled");

  const layout = src("src/app/(dashboard)/layout.tsx");
  eq(layout.includes('href: "/calls"'), true, "the menu links the Calls page");
  eq(/key === 'calls'\) return canAccessNavItem\('patients'/.test(layout), true, "whoever works the patient list sees it");
  eq(src("src/app/(dashboard)/calls/page.tsx").includes("CallRow"), true, "the page lists calls with their actions");
}

console.log(`call reminders: ${checks} checks passed`);
