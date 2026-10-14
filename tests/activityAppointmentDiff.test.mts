/**
 * Activity log v2, appointments: what an appointment save, a drag or a room move writes to the log.
 * The diff helper must report only what really changed — a notes-only autosave, an untouched
 * re-save or a re-typed time is no event — and split a visit discount into its own discount event.
 *
 * Run: npx tsx tests/activityAppointmentDiff.test.mts
 */

import assert from "node:assert/strict";
import {
  APPOINTMENT_FIELDS,
  appointmentEvents,
  appointmentMoveEvent,
} from "../src/lib/activity/appointmentDiff";
import { fieldLabel, sentence } from "../src/lib/activity/catalogue";

let checks = 0;
const eq = <T,>(a: T, b: T, msg?: string) => {
  checks++;
  assert.equal(a, b, msg);
};
const deep = (a: unknown, b: unknown, msg?: string) => {
  checks++;
  assert.deepEqual(a, b, msg);
};
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

const ctx = { patientId: "p1", patientName: "عمر حسام علي", appointmentId: "a1" };

deep(APPOINTMENT_FIELDS, ["date", "time", "duration", "doctor", "status", "roomName", "branchId", "treatment", "cost"]);

// --- 1. nothing that matters changed: no event (the autosave noise) ---
deep(appointmentEvents({ time: "05:00 PM", notes: "a" }, { time: "05:00 PM", notes: "b" }, ctx), []);
deep(appointmentEvents({}, {}, ctx), []);
deep(appointmentEvents(
  { time: "05:00 PM", waitingMood: "ok", modifiedBy: "A", updatedAt: 1 },
  { time: "05:00 PM", waitingMood: "angry", modifiedBy: "B", updatedAt: 2 }, ctx), [], "ignored fields");
// A re-typed but identical time or date is not an edit.
deep(appointmentEvents({ time: "5:00 PM", date: "2026-10-14" }, { time: "05:00 PM", date: "2026-10-14" }, ctx), []);
// A field the save did not carry is not a change (the room move sends two fields only).
deep(appointmentEvents({ time: "05:00 PM", doctor: "X", roomName: "R1" }, { roomName: "R1" }, ctx), []);
// Old docs with no duration/status read as the booking defaults, not as a change.
deep(appointmentEvents({ time: "05:00 PM" }, { time: "05:00 PM", duration: 30, status: "Scheduled" }, ctx), []);

// --- 2. a real edit: one appointment.edited, changes in field order ---
const ev = appointmentEvents({ time: "05:00 PM", doctor: "محمد إيهاب" }, { time: "06:30 PM", doctor: "أحمد طارق" }, ctx);
eq(ev.length, 1);
eq(ev[0].event, "appointment.edited");
deep(ev[0].changes, [{ field: "time", from: "05:00 PM", to: "06:30 PM" }, { field: "doctor", from: "محمد إيهاب", to: "أحمد طارق" }]);
eq(ev[0].patientId, "p1");
eq(ev[0].patientName, "عمر حسام علي");
eq(ev[0].refs?.appointmentId, "a1");
eq(ev[0].refs?.time, "06:30 PM", "the sentence shows where the visit now sits");

// --- 3. the visit discount is its own event, by the shared old/new rule ---
const d = appointmentEvents({ discountAmount: 0, cost: 1500 }, { discountAmount: 200, cost: 1300 }, ctx);
deep(d.map((e) => e.event), ["appointment.edited", "discount.given"]);
eq(d[1].amount, 200);
deep(d[0].changes, [{ field: "cost", from: 1500, to: 1300 }]);
eq(d[1].patientName, "عمر حسام علي");
eq(d[1].refs?.appointmentId, "a1");
// Missing discount on an old doc reads as 0.
deep(appointmentEvents({ cost: 1500 }, { discountAmount: 100, cost: 1500 }, ctx).map((e) => [e.event, e.amount]), [["discount.given", 100]]);
deep(appointmentEvents({ discountAmount: 300 }, { discountAmount: 0 }, ctx).map((e) => [e.event, e.amount]), [["discount.removed", 300]]);
deep(appointmentEvents({ discountAmount: 200 }, { discountAmount: 300 }, ctx).map((e) => [e.event, e.amount]), [["discount.changed", 100]]);
// The save did not send a discount: no discount event, even with an old one stored.
deep(appointmentEvents({ discountAmount: 300, cost: 1 }, { cost: 1 }, ctx), []);
// null (a visit not charged) counts as no discount.
deep(appointmentEvents({ discountAmount: 0 }, { discountAmount: null }, ctx), []);

// --- 4. room and branch read as words, never as ids ---
const room = appointmentEvents(
  { roomName: "غرفة 1", branchId: "b1", branchName: "مصر الجديدة" },
  { roomName: "غرفة 2", branchId: "b2", branchName: "التجمع" }, ctx);
deep(room[0].changes, [{ field: "room", from: "غرفة 1", to: "غرفة 2" }, { field: "branch", from: "مصر الجديدة", to: "التجمع" }]);
// A branch with no name to show is named by its label alone, not by its id.
const noName = appointmentEvents({ branchId: "b1" }, { branchId: "b2" }, ctx);
deep(noName[0].changes, [{ field: "branch", from: null, to: null }]);
ok(!sentence(noName[0], "en").includes("b2"), "no raw branch id");
// Same branch id, different stored name: not a change.
deep(appointmentEvents({ branchId: "b1", branchName: "Old" }, { branchId: "b1", branchName: "New" }, ctx), []);
eq(room[0].branchId, "b2", "filed under the appointment's branch");

// --- 5. status, treatment and labels ---
const st = appointmentEvents({ status: "Scheduled", treatment: "كشف" }, { status: "Cancelled", treatment: "حشو" }, ctx);
deep(st[0].changes, [{ field: "status", from: "Scheduled", to: "Cancelled" }, { field: "treatment", from: "كشف", to: "حشو" }]);
eq(fieldLabel("room", "en"), "Room");
eq(fieldLabel("room", "ar"), "الغرفة");
eq(fieldLabel("treatment", "en"), "Visit reason");
eq(fieldLabel("treatment", "ar"), "سبب الزيارة");
const stAr = sentence(st[0], "ar");
ok(stAr.includes("غير مؤكد") && stAr.includes("ملغي"), `appointment status in Arabic words: ${stAr}`);
ok(!stAr.includes("Scheduled"), "no English status inside the Arabic sentence");
ok(!/undefined/.test(sentence(st[0], "en")) && !/undefined/.test(stAr), "no undefined");

// --- 5b. patient, service and approval link (Ruling R8) ---
const swap = appointmentEvents(
  { patientId: "pOld", patientName: "سارة", time: "05:00 PM" },
  { patientId: "pNew", patientName: "عمر", time: "05:00 PM" },
  { patientId: "pNew", patientName: "عمر", appointmentId: "a1" });
deep(swap.map((e) => [e.event, e.patientId, e.patientName]), [["appointment.edited", "pNew", "عمر"], ["appointment.edited", "pOld", "سارة"]]);
deep(swap[0].changes, [{ field: "patient", from: "سارة", to: "عمر" }]);
deep(swap[1].changes, swap[0].changes, "same changes in both files");
ok(!sentence(swap[0], "en").includes("pOld") && !sentence(swap[0], "en").includes("pNew"), "no patient ids in the sentence");
// Same patient re-sent: nothing.
deep(appointmentEvents({ patientId: "p1", patientName: "عمر" }, { patientId: "p1", patientName: "عمر" }, ctx), []);
// Service swapped at the same price.
const svc = appointmentEvents({ serviceName: "حشو", cost: 500 }, { serviceName: "تنظيف", cost: 500 }, ctx);
eq(svc.length, 1);
eq(svc[0].event, "appointment.edited");
deep(svc[0].changes, [{ field: "service", from: "حشو", to: "تنظيف" }]);
// Approval linked, unlinked, unchanged (old pair vs new list form).
const link = appointmentEvents({ claimLinks: [] }, { claimLinks: [{ claimId: "c1", claimLine: 0 }], claimId: "c1", claimLine: 0 }, ctx);
deep(link[0].changes, [{ field: "approval", from: null, to: null }]);
deep(appointmentEvents({ claimId: "c1", claimLine: 0 }, { claimLinks: [], claimId: null, claimLine: null }, ctx)[0].changes,
  [{ field: "approval", from: null, to: null }], "unlinked");
deep(appointmentEvents({ claimId: "c1", claimLine: 0 }, { claimLinks: [{ claimId: "c1", claimLine: 0 }], claimId: "c1", claimLine: 0 }, ctx), [], "same link, old shape");
deep(appointmentEvents({ claimId: "c1", claimLine: 0, serviceName: "حشو" }, { time: "05:00 PM" }, { ...ctx }).filter((e) => e.changes?.some((c) => c.field !== "time")), [], "not sent = not compared");
eq(fieldLabel("service", "ar"), "الخدمة");
eq(fieldLabel("approval", "en"), "Insurance approval");
ok(!sentence(link[0], "ar").includes("c1"), "no claim id in the sentence");

// --- 6. drag to move ---
const mv = appointmentMoveEvent(
  { date: "2026-10-14", time: "05:00 PM", doctor: "د. سارة", patientId: "p1", patientName: "عمر", branchId: "b1" },
  "a1", "2026-10-15", "05:00 PM");
eq(mv?.event, "appointment.moved");
deep(mv?.changes, [{ field: "date", from: "2026-10-14", to: "2026-10-15" }]);
eq(mv?.patientId, "p1");
eq(mv?.branchId, "b1");
eq(mv?.refs?.appointmentId, "a1");
eq(appointmentMoveEvent({ date: "2026-10-14", time: "5:00 PM" }, "a1", "2026-10-14", "05:00 PM"), null, "dropped where it was");
const mvBoth = appointmentMoveEvent({ date: "2026-10-14", time: "05:00 PM" }, "a1", "2026-10-15", "06:00 PM");
deep(mvBoth?.changes?.map((c) => c.field), ["date", "time"]);
eq(mvBoth?.branchId, undefined, "no branch on the appointment: the writer fills the branch on screen");
ok(!/undefined/.test(sentence(mvBoth!, "ar")), "moved sentence has no undefined");

console.log(`activityAppointmentDiff: ${checks} checks passed`);
