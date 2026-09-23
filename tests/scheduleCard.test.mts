// What an appointment card on the day schedule says with the room it has.
//
// A card is as tall as the visit is long, and used to fill that height with white space between a
// name pinned to the top and a treatment pinned to the bottom. These pin the rules that replaced it:
// what fits at which height, in which order, and the arithmetic behind each line — which is where a
// card would quietly lie (a patient shown as owing money they paid last week, a visit shown on time
// when it is twenty minutes over).
//
// Run with tsx: npm run test:schedule-card
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_BASE_PX,
  CARD_LINE_PX,
  LONG_WAIT_MIN,
  cardTiming,
  detailLines,
  detailOrder,
  historyByPatient,
  medicalAlert,
  moneyByAppointment,
  planDetails,
  timeRange,
  toDateLoose,
} from "../src/lib/scheduleCard";

const REPO = join(import.meta.dirname, "..");
let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. What fits -------------------------------------------------------------------------------
{
  eq(detailLines(120), 0, "the minimum card holds only what it always held");
  eq(detailLines(CARD_BASE_PX + CARD_LINE_PX - 1), 0, "a line that would not fully fit is not drawn half-cut");
  eq(detailLines(CARD_BASE_PX + CARD_LINE_PX), 1, "and one that fits is");
  eq(detailLines(-50), 0, "never negative");

  // The real heights: 148px per 30-minute slot on this schedule.
  const at = (min: number) => Math.max(min * (148 / 30), 120);
  const arrivedAll = detailOrder(true, { alert: true, timing: true, money: true, owes: true, status: true });
  const shown = (min: number) => [...planDetails(at(min), arrivedAll, true).show];

  eq(shown(15), [], "a 15-minute card stays exactly as it was — the badge beside the name carries the alert");
  eq(shown(30), ["alert"], "30 minutes: one line, and it is the medical alert");
  eq(shown(45), ["alert", "timing", "money", "owes"], "45 minutes: the four lines that matter once they are here");
  eq(planDetails(at(120), arrivedAll, true).noteLines, 4, "a long visit shows up to four lines of note, and no more");
  eq(planDetails(at(45), arrivedAll, false).noteLines, 0, "no note, no note line");
}

// --- 2. The order depends on whether they have arrived ------------------------------------------
{
  const all = { alert: true, timing: true, money: true, owes: true, status: true };
  eq(
    detailOrder(false, all),
    ["alert", "owes", "status", "money"],
    "before they arrive: is it safe, do they owe us, are they coming, and what is already charged"
  );
  eq(
    detailOrder(true, all),
    ["alert", "timing", "money", "owes"],
    "after: is it safe, how long have they been here, what does this visit come to, what is owed from before"
  );
  ok(!detailOrder(true, all).includes("status"), "confirmation and history stop mattering the moment they walk in");
  ok(!detailOrder(false, all).includes("timing"), "and there is no timing before they arrive");
  eq(detailOrder(false, { status: true }), ["status"], "a detail with nothing to say is not in the list at all");

  // A missing line gives its space to the next one, in order.
  const at45 = 45 * (148 / 30);
  eq(
    [...planDetails(at45, detailOrder(false, { owes: true, status: true }), true).show],
    ["owes", "status"],
    "no alert and nothing charged: the two lines that exist move up"
  );
  ok(
    planDetails(at45, detailOrder(false, { status: true }), true).noteLines >
      planDetails(at45, detailOrder(false, { owes: true, status: true }), true).noteLines,
    "and the note gets the lines that were not needed"
  );
  const tight = planDetails(CARD_BASE_PX + CARD_LINE_PX, detailOrder(true, all), true);
  eq([...tight.show], ["alert"], "with only one line, the medical alert wins over everything");
  eq(tight.noteLines, 0, "and the note waits");
}

// --- 2b. Medical alerts --------------------------------------------------------------------------
{
  eq(medicalAlert({ allergies: "Penicillin", medicalHistory: "Diabetic" }), "Penicillin \u00b7 Diabetic", "both, on one line");
  eq(medicalAlert({ allergies: "Penicillin" }), "Penicillin", "one is enough");
  eq(medicalAlert(null), "", "no patient, no alert");
  for (const nothing of ["None", "none", "No", "N/A", "na", "-", "--", ".", "0", "\u0644\u0627", "\u0644\u0627 \u064a\u0648\u062c\u062f", "\u0645\u0641\u064a\u0634", "\u0633\u0644\u064a\u0645", "   "]) {
    eq(
      medicalAlert({ allergies: nothing }),
      "",
      `"${nothing}" means nothing — flagging it in red on every card would teach the desk to ignore the red`
    );
  }
  eq(medicalAlert({ allergies: "None", medicalHistory: "Hypertension" }), "Hypertension", "a 'None' in one field does not hide a real entry in the other");
  eq(medicalAlert({ medicalHistory: "  on   warfarin  " }), "on warfarin", "spacing is tidied");
}

// --- 2c. What the clinic already knows about a patient ------------------------------------------
{
  const rows = [
    { type: "procedure", patientId: "p1", date: "2026-08-01", cost: 1000, paid: 400 },
    { type: "procedure", patientId: "p1", date: "2026-08-01", cost: 200, paid: 200 },
    { type: "procedure", patientId: "p1", date: "2026-09-10", cost: 500, paid: 700 },
    // TODAY's treatment: already on the card as "this visit", so it is not "from before".
    { type: "procedure", patientId: "p1", date: "2026-09-23", cost: 900, paid: 0 },
    { type: "payment", patientId: "p1", date: "2026-09-01", paid: 5000 },
    { type: "procedure", patientId: "p1", date: "2026-07-01", cost: 800, paid: 0, status: "deleted" },
    { type: "procedure", patientId: "p2", date: "2026-09-23", cost: 300, paid: 0 },
  ];
  const map = historyByPatient(rows, "2026-09-23");
  const p1 = map.get("p1")!;
  eq(p1.owedBefore, 600, "unpaid from earlier visits only — the overpaid filling does not cancel the unpaid crown");
  eq(p1.visits, 2, "two days with treatment, however many lines each had");
  eq(p1.lastVisit, "2026-09-10", "the last day before the one being viewed");
  eq(map.has("p2"), false, "somebody whose only treatment is today has no history — they are a first visit");
}

// --- 3. Timing -----------------------------------------------------------------------------------
{
  const now = new Date("2026-09-23T10:20:00");
  const ts = (iso: string) => ({ toDate: () => new Date(iso) });

  eq(cardTiming({ status: "Scheduled" }, now), { kind: "none" }, "not arrived yet: nothing to say");
  eq(cardTiming({ status: "Checked In" }, now), { kind: "none" }, "checked in with no time recorded: say nothing rather than invent one");

  const waiting = cardTiming({ status: "Checked In", checkInTime: ts("2026-09-23T10:12:00") }, now);
  assert.equal(waiting.kind, "waiting");
  if (waiting.kind === "waiting") {
    eq(waiting.waitedMin, 8, "minutes since they arrived");
    eq(waiting.long, false, "eight minutes is not a long wait");
  }
  checks++;

  const longWait = cardTiming({ status: "Checked In", checkInTime: ts("2026-09-23T09:50:00") }, now);
  eq(longWait.kind === "waiting" && longWait.long, true, `${LONG_WAIT_MIN}+ minutes is flagged, so the desk knows who to go and check on`);

  // Arrival can also come only from the history, for visits written before checkInTime existed.
  const fromHistory = cardTiming(
    { status: "Checked In", statusHistory: [{ status: "Checked In", timestamp: ts("2026-09-23T10:00:00") }] },
    now,
  );
  eq(fromHistory.kind === "waiting" && fromHistory.waitedMin, 20, "arrival is read from the status history when the field is missing");

  const inChair = cardTiming(
    {
      status: "In Chair",
      duration: 30,
      checkInTime: ts("2026-09-23T09:40:00"),
      statusHistory: [
        { status: "Checked In", timestamp: ts("2026-09-23T09:40:00") },
        { status: "In Chair", timestamp: ts("2026-09-23T10:05:00") },
      ],
    },
    now,
  );
  assert.equal(inChair.kind, "inChair");
  if (inChair.kind === "inChair") {
    eq(inChair.elapsedMin, 15, "seated at 10:05, so fifteen minutes in");
    eq(inChair.progress, 0.5, "halfway through a 30-minute booking");
    eq(inChair.overMin, 0, "and not over");
  }
  checks++;

  const over = cardTiming(
    { status: "In Chair", duration: 15, statusHistory: [{ status: "In Chair", timestamp: ts("2026-09-23T09:55:00") }] },
    now,
  );
  eq(over.kind === "inChair" && over.overMin, 10, "25 minutes into a 15-minute booking is ten minutes over");
  ok(over.kind === "inChair" && over.progress > 1, "and the progress runs past full, which is what turns the bar red");

  // Seated twice (sent back to the waiting room and called in again): the LATEST seating counts.
  const reseated = cardTiming(
    {
      status: "In Chair",
      duration: 30,
      statusHistory: [
        { status: "In Chair", timestamp: ts("2026-09-23T09:30:00") },
        { status: "Checked In", timestamp: ts("2026-09-23T09:45:00") },
        { status: "In Chair", timestamp: ts("2026-09-23T10:10:00") },
      ],
    },
    now,
  );
  eq(reseated.kind === "inChair" && reseated.elapsedMin, 10, "a second seating restarts the clock, rather than showing the first one as running over");

  eq(cardTiming({ status: "In Chair", statusHistory: [] }, now), { kind: "none" }, "in the chair with no seating recorded: say nothing");
  eq(cardTiming({ status: "Completed" }, now).kind, "done", "a finished visit says so");
}

// --- 4. Money: from the treatment rows, so it survives payments on another day ------------------
{
  const rows = [
    { type: "procedure", appointmentId: "a1", cost: 1000, paid: 400 },
    { type: "procedure", appointmentId: "a1", cost: 500, paid: 500 },
    // A payment row is not a second charge — the treatment's `paid` already counts it.
    { type: "payment", appointmentId: "a1", paid: 400 },
    { type: "procedure", appointmentId: "a2", cost: 300, paid: 350 },
    { type: "procedure", appointmentId: "a3", cost: 800, paid: 0, status: "cancelled" },
    { type: "procedure", cost: 900, paid: 0 },
  ];
  const map = moneyByAppointment(rows);
  eq(map.get("a1"), { charged: 1500, paid: 900, owed: 600 }, "two treatments on one visit add up, and payments are not counted twice");
  eq(map.get("a2")?.owed, 0, "an overpaid visit is settled, not negative debt");
  eq(map.has("a3"), false, "a cancelled treatment is not money owed");
  eq(map.size, 2, "a treatment recorded on no appointment belongs to no card");
}

// --- 5. Small things that are easy to get wrong -------------------------------------------------
{
  eq(timeRange("09:00", 45), "09:00 – 09:45", "start and end");
  eq(timeRange("9:30", 90), "09:30 – 11:00", "across an hour, padded");
  eq(timeRange("23:30", 60), "23:30 – 00:30", "past midnight wraps rather than printing 24:30");
  eq(timeRange("", 30), "", "no time is not invented");

  eq(toDateLoose(null), null, "nothing is null");
  eq(toDateLoose({ seconds: 0 })?.getTime(), 0, "a plain {seconds} object — how a Timestamp arrives when it has been through JSON");
  eq(toDateLoose("not a date"), null, "garbage is null, not an Invalid Date");
}

// --- 6. The dashboard keeps the promises ---------------------------------------------------------
{
  const dash = readFileSync(join(REPO, "src/components/dashboard/DesktopDashboard.tsx"), "utf8");
  ok(/planDetails\(height,/.test(dash), "the card decides what to show from its real HEIGHT, which is what the eye compares");
  ok(/<AlertBadge alert=\{alert\}/.test(dash), "the medical alert badge is not beside the name — it must show on every card, whatever its height");
  ok(
    /where\("patientId", "in", chunk\)/.test(dash),
    "patient history is read one card at a time instead of in one chunked read for the day"
  );
  ok(
    /where\("date", "==", scheduleViewDate\)/.test(dash),
    "the money listener is keyed to the day ON SCREEN — the income listener is pinned to today, which is wrong for Thursday's schedule"
  );
  ok(/<ChairProgress timing=\{timing\} \/>/.test(dash), "the in-chair bar is not drawn");
  ok(/timeRange\(apt\.time/.test(dash), "the card still prints '09:00 (45m)' instead of the end time");
  ok(
    !/lg:text-base";\s*let timeFontSize/.test(dash),
    "the old tiers set the same lg: size on every tier, so the text never grew on a laptop"
  );
}

console.log(`scheduleCard: ${checks} checks passed`);
