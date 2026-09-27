// The owner's three-line day, without a model.
//
// The AI version is handed the same fact sheet these pin; when the AI is off, these words ARE the
// line. A line that pads ("0 no-shows") or invents ("a great day!") is worse than a short one.
//
// Run with tsx: npm run test:owner-summary
import assert from "node:assert/strict";
import { digestMessage, factSheet, plainSummary, summaryFacts, type DayFacts } from "../src/lib/ownerSummaryText";
import type { Briefing } from "../src/lib/automation/briefing/types";

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const facts: DayFacts = {
  dateKey: "2026-09-26",
  visits: 9,
  attended: 7,
  cancelled: 1,
  noShows: 1,
  collected: 8400,
  expenses: 900,
  net: 7500,
  sameWeekdayCollected: 7000,
  newPatients: 2,
  topDentist: { name: "Dr. Omar", collected: 5000 },
  unconfirmedTomorrow: 3,
  labLate: 0,
  outOfStock: 1,
  waitingLongest: null,
};

// --- 1. Plain words, English --------------------------------------------------------------------------
{
  const lines = plainSummary(facts, "en");
  eq(lines.length, 3, "three lines");
  eq(lines[0], "7 of 9 visits seen · 1 no-show, 1 cancelled · 2 new patients.", "what happened");
  eq(lines[1], "Collected 8,400 EGP (up 20% on the same day last week) · expenses 900 · net 7,500 · top Dr. Omar 5,000.", "the money, against the same day last week");
  eq(lines[2], "Waiting: 3 unconfirmed for tomorrow · 1 item out of stock.", "what is waiting, and only what is");
}

// --- 2. Quiet days say less ------------------------------------------------------------------------------
{
  const quiet = plainSummary({ ...facts, cancelled: 0, noShows: 0, newPatients: 0, unconfirmedTomorrow: 0, outOfStock: 0, topDentist: null, sameWeekdayCollected: null }, "en");
  eq(quiet[0], "7 of 9 visits seen.", "no misses, no new patients: nothing padded in");
  eq(quiet[1], "Collected 8,400 EGP · expenses 900 · net 7,500.", "no comparison, no top dentist");
  eq(quiet[2], "Nothing waiting.", "an empty third line says so");
}

// --- 3. Money hidden -----------------------------------------------------------------------------------------
{
  const hidden = plainSummary({ ...facts, collected: null, expenses: null, net: null }, "en");
  eq(hidden.length, 2, "no money line for a reader who may not see money");
}

// --- 4. Arabic --------------------------------------------------------------------------------------------------
{
  const ar = plainSummary(facts, "ar");
  ok(ar[0].includes("٧ زيارة من ٩") || ar[0].includes("7 زيارة من 9"), "Arabic first line carries the counts");
  ok(ar[1].startsWith("اتحصّل"), "Arabic money line");
  ok(ar[2].startsWith("مستني:"), "Arabic waiting line");
}

// --- 5. The WhatsApp digest and the model's fact sheet ------------------------------------------------------
{
  const msg = digestMessage(facts, plainSummary(facts, "en"), "Alpha Dental", "en");
  ok(msg.startsWith("Alpha Dental · 2026-09-26\n• 7 of 9"), "the digest is the heading and the bulleted lines");
  const sheet = factSheet(facts);
  ok(sheet.includes("cash collected: 8400 EGP") && sheet.includes("no-shows: 1") && sheet.includes("top dentist by cash: Dr. Omar"), "the fact sheet carries every number the model may use");
  ok(!factSheet({ ...facts, collected: null }).includes("cash collected"), "…and no money when money is hidden");
}

// --- 6. Facts off a brief --------------------------------------------------------------------------------------
{
  const brief = {
    dateKey: "2026-09-26",
    appointments: [{ status: "Completed" }, { status: "No Show" }, { status: "Cancelled" }],
    counts: { total: 3, attended: 1, cancelled: 1, stillScheduled: 0 },
    money: { collected: 500, expenses: 100, netCash: 400, comparison: { sameWeekdayCollected: 250 } },
    production: { doctors: [{ name: "A", collected: 200 }, { name: "B", collected: 300 }] },
    growth: { newPatients: 1 },
    actions: { unconfirmedAhead: 2 },
    stock: { outOfStockCount: 0 },
  } as unknown as Briefing;
  const f = summaryFacts(brief);
  eq([f.visits, f.attended, f.cancelled, f.noShows, f.newPatients, f.unconfirmedTomorrow], [3, 1, 1, 1, 1, 2], "counts come off the brief");
  eq(f.topDentist, { name: "B", collected: 300 }, "the top dentist is by cash");
  eq(summaryFacts({ ...brief, money: undefined } as unknown as Briefing).collected, null, "no money section: money is null");
}

console.log(`ownerSummary: ${checks} checks passed`);
