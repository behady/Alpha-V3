// The arithmetic behind the twenty newer reports.
//
// Every one of these tabs ends in a figure an owner will act on — call a patient, question a
// dentist, change a price, chase a lab. The failures that matter are quiet ones: a comparison
// where the two sides were added up by different rules, a balance aged from the wrong date, a
// retention rate that counts a patient twice, a remake rate over the wrong denominator.
//
// Run with tsx: npm run test:report-suite
import assert from "node:assert/strict";
import { previousRange, lastYearRange, trailingMonths, monthsBetween, clinicWeekday, daysIn, monthEnd } from "../src/lib/reports/periods";
import { summarizeLedger, delta, totalsByMonth, compareServices, dentistTrend, heatmap, pnlByMonth, discountLines, paymentMethods, normalizeMethod, expenseLines, expensesByCategory } from "../src/lib/reports/ledgerStats";
import { receivables, bucketFor } from "../src/lib/reports/receivables";
import { retention, lifetimeValue, demographics, recallDue, ageBand, ageOf } from "../src/lib/reports/patientStats";
import { appointmentStats, outcomeOf, labStats, inventoryStats, staffLines } from "../src/lib/reports/opsStats";
import { planStats } from "../src/lib/reports/plansStats";
import { whatsappStats } from "../src/lib/reports/whatsappStats";
import { incomeSources, expenseMatrix, compareExpenseCategories, cashflow } from "../src/lib/reports/financeStats";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}

// --- periods --------------------------------------------------------------------------------------

eq(previousRange({ start: "2026-09-01", end: "2026-09-30" }), { start: "2026-08-01", end: "2026-08-31" }, "a whole month steps back a month, whatever its length");
eq(previousRange({ start: "2026-03-01", end: "2026-03-31" }), { start: "2026-02-01", end: "2026-02-28" }, "March against February, 28 days");
eq(previousRange({ start: "2026-09-10", end: "2026-09-16" }), { start: "2026-09-03", end: "2026-09-09" }, "a custom week steps back exactly seven days");
eq(previousRange({ start: "2026-07-01", end: "2026-09-30" }), { start: "2026-04-01", end: "2026-06-30" }, "a quarter steps back a quarter");
eq(lastYearRange({ start: "2026-09-01", end: "2026-09-27" }), { start: "2025-09-01", end: "2025-09-27" }, "same dates a year earlier");
eq(lastYearRange({ start: "2028-02-29", end: "2028-02-29" }), { start: "2027-02-28", end: "2027-02-28" }, "29 Feb lands on 28 Feb");
eq(lastYearRange({ start: "2028-02-01", end: "2028-02-29" }), { start: "2027-02-01", end: "2027-02-28" }, "a whole leap February keeps its month end");
eq(trailingMonths("2026-09-27", 12).range, { start: "2025-10-01", end: "2026-09-30" }, "twelve months ending with the month on screen");
eq(trailingMonths("2026-09-27", 12).months.length, 12, "and twelve keys");
eq(monthsBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"], "months across a year end");
eq(clinicWeekday("2026-09-26"), 0, "Saturday is day 0 of the clinic's week");
eq(clinicWeekday("2026-10-02"), 6, "Friday is day 6");
eq(daysIn({ start: "2026-09-01", end: "2026-09-01" }), 1, "a single day is one day");
eq(monthEnd("2026-02"), "2026-02-28", "February 2026 has 28 days");

// --- ledger figures, one rule -----------------------------------------------------------------------

const L = [
  { id: "c1", type: "procedure", patientId: "p1", doctorName: "Dr. Omar", serviceName: "Crown", serviceId: "svc-crown", cost: 1500, paid: 1500, labFee: 400, discountAmount: 100, listPrice: 1600, discountReason: "friend", normDate: "2026-09-05", date: "2026-09-05" },
  { id: "c2", type: "procedure", patientId: "p2", doctorName: "Sara", serviceName: "Filling", serviceId: "svc-fill", cost: 300, paid: 0, normDate: "2026-09-12", date: "2026-09-12" },
  { id: "y1", type: "payment", patientId: "p1", doctorName: "Omar", procedureId: "c1", paid: 1500, amount: 0, doctorCommissionAmount: 300, method: "Visa", normDate: "2026-09-05", date: "2026-09-05", createdAt: "2026-09-05T14:30:00" },
  { id: "y2", type: "payment", patientId: "p3", paid: 200, method: "instapay", normDate: "2026-09-20", date: "2026-09-20" },
  { id: "e1", type: "expense", cost: 5000, category: "Rent", isRecurring: true, description: "September rent", normDate: "2026-09-01", date: "2026-09-01" },
  { id: "e2", type: "expense", cost: 250, category: "Supplies", description: "Gloves", normDate: "2026-09-03", date: "2026-09-03" },
  { id: "i1", type: "income", paid: 100, description: "X-ray CD", normDate: "2026-09-08", date: "2026-09-08" },
];

const t = summarizeLedger(L);
eq(t.income, 1800, "income = payments + income rows; the procedure's mirrored paid is NOT added");
eq(t.charged, 1800, "charged = procedure prices");
eq(t.commissions, 300, "commission off the payment row");
eq(t.labFees, 400, "lab fee off the procedure row");
eq(t.expenses, 5250, "both expenses");
eq(t.discounts, 100, "the discount");
eq(t.net, 1800 - 400 - 5250, "net = income − lab − expenses; commission is owed, and comes off as a Salary expense when paid");
eq(t.procedures, 2, "two treatments");
eq(t.payments, 3, "three money-in rows (income counts as a payment)");
eq(t.patients, 3, "three distinct patients");

eq(delta(100, 112), { from: 100, to: 112, abs: 12, pct: 12 }, "a 12% rise");
eq(delta(0, 50).pct, null, "growth from nothing has no percentage");
eq(delta(0, 0).pct, 0, "nothing to nothing is flat, not undefined");
eq(delta(-100, -50).pct, 50, "a loss halving is +50%, measured against the size of the loss");

const bm = totalsByMonth(L, ["2026-08", "2026-09"]);
eq(bm[0].income, 0, "an empty month is present and zero");
eq(bm[1].income, 1800, "the month with the rows");

// The August crown was paid before the catalogue id existed: it carries a description only.
const prev = [{ id: "z", type: "payment", patientId: "p9", description: "Payment for Crown (T: 14) | 1x1000=1000", paid: 1000, normDate: "2026-08-10" }, { id: "zz", type: "payment", patientId: "p9", serviceId: "svc-white", serviceName: "Whitening", paid: 700, normDate: "2026-08-11" }];
const cs = compareServices(L, prev);
const crown = cs.find((s) => s.name === "Crown")!;
eq([crown.income, crown.prevIncome, crown.incomeDelta.pct], [1500, 1000, 50], "a service present in both periods compares — matched by NAME when the old rows predate the catalogue id");
const whitening = cs.find((s) => s.name === "Whitening")!;
eq([whitening.income, whitening.prevIncome], [0, 700], "a service that disappeared is still listed, at zero now");
eq(cs[0].name, "Whitening", "sorted by the size of the change, whichever way — −700 beats +500");

const dt = dentistTrend(L, ["2026-08", "2026-09"]);
eq(dt[0].doctor, "Omar", "Dr. Omar and Omar are one dentist, and the top earner");
eq(dt[0].byMonth[1].income, 1500, "in September");
eq(dt[0].byMonth[1].cases, 1, "one case");

const hm = heatmap(L.filter((r) => r.type === "payment"), (r) => r.normDate, (r) => (r.createdAt ? new Date(String(r.createdAt)).getHours() : null), (r) => Number(r.paid));
const sat = hm.find((c) => c.weekday === clinicWeekday("2026-09-05") && c.hour === 14)!;
eq(sat.value, 1500, "a payment lands in its weekday and hour");
ok(hm.some((c) => c.hour === -1 && c.value === 200), "a payment with no time counts in the weekday only");

const pnl = pnlByMonth(L, ["2026-09"])[0];
eq(pnl.expensesByCategory, { Rent: 5000, Supplies: 250 }, "expenses by category");
eq(pnl.marginPct, Number((((1800 - 400 - 5250) / 1800) * 100).toFixed(1)), "margin as a share of income");

const dl = discountLines(L);
eq(dl.length, 1, "one discounted treatment");
eq([dl[0].listPrice, dl[0].discount, dl[0].pct, dl[0].reason, dl[0].doctor], [1600, 100, 6.3, "friend", "Omar"], "list, amount, share, reason, dentist");

eq(normalizeMethod("Visa"), "Card", "Visa is a card");
eq(normalizeMethod("InstaPay"), "InstaPay", "InstaPay however spelt");
eq(normalizeMethod(""), "Cash", "no method is cash");
const pm = paymentMethods(L);
eq(pm.totals.map((m) => [m.method, m.total]), [["Card", 1500], ["InstaPay", 200], ["Cash", 100]], "by method, biggest first; the income row is cash");
eq(pm.byDay[0].date, "2026-09-20", "days newest first");

const el = expenseLines(L);
eq(el.length, 2, "two expense lines");
eq(expensesByCategory(el)[0], { category: "Rent", total: 5000, count: 1, recurring: 5000, share: 95.2 }, "rent is 95% of spending and recurring");

// --- receivables ------------------------------------------------------------------------------------

const RL = [
  { id: "a1", type: "procedure", patientId: "p1", patientName: "Mona", cost: 1000, normDate: "2026-06-01", payerId: "ins-1", payerName: "AXA" },
  { id: "a2", type: "procedure", patientId: "p1", patientName: "Mona", cost: 500, normDate: "2026-09-01" },
  { id: "a3", type: "payment", patientId: "p1", paid: 1000, normDate: "2026-06-05", payerId: "ins-1", payerName: "AXA" },
  { id: "b1", type: "procedure", patientId: "p2", patientName: "Karim", cost: 800, normDate: "2026-05-01" },
  { id: "b2", type: "payment", patientId: "p2", paid: 100, normDate: "2026-05-01" },
  { id: "c1", type: "procedure", patientId: "p3", patientName: "Hana", cost: 300, normDate: "2026-09-10" },
  { id: "c2", type: "payment", patientId: "p3", paid: 500, normDate: "2026-09-10" },
  // A treatment recorded from a MetLife approval: 600 charged, 500 of it the insurer's, 100 the patient's share, nothing paid yet.
  { id: "d1", type: "procedure", patientId: "p4", patientName: "Omar", cost: 600, normDate: "2026-09-20", payerId: "metlife", payerName: "MetLife", insurerCovered: 500, patientShare: 100 },
];
const rv = receivables(RL, [{ id: "p2", name: "Karim Said", phone: "0100" }], "2026-09-27");
eq(rv.lines.map((l) => l.patientId), ["p2", "p1", "p4"], "biggest balance first; Omar owes only his share");
const omar = rv.lines[2];
eq([omar.balance, omar.oldestUnpaid, omar.bucket], [100, "2026-09-20", "0-30"], "the insurer's 500 is not the patient's debt");
const metlife = rv.byPayer.find((p) => p.payerId === "metlife")!;
eq([metlife.charged, metlife.collected, metlife.balance], [600, 0, 600], "the insurer's own ledger carries the whole charge until it pays");
const karim = rv.lines[0];
eq([karim.patientName, karim.phone, karim.balance, karim.oldestUnpaid, karim.ageDays, karim.bucket], ["Karim Said", "0100", 700, "2026-05-01", 149, "90+"], "name from the file, balance, aged from the unpaid treatment");
const mona = rv.lines[1];
eq([mona.balance, mona.oldestUnpaid, mona.bucket], [500, "2026-09-01", "0-30"], "her June crown was paid in full, so the age counts from September's filling");
eq(rv.totals, { balance: 1300, patients: 3, credits: 200, creditPatients: 1 }, "Hana paid ahead and is a credit, not a debt; Omar's 100 counts");
eq(rv.aging.map((a) => [a.bucket, a.total]), [["0-30", 600], ["31-60", 0], ["61-90", 0], ["90+", 700]], "aging buckets");
const axa = rv.byPayer.find((p) => p.payerId === "ins-1")!;
eq([axa.charged, axa.collected, axa.balance], [1000, 1000, 0], "the insurer's own ledger balances");
eq(bucketFor(30), "0-30", "day 30 is still the first bucket");
eq(bucketFor(91), "90+", "day 91 is the last");

// --- patients -----------------------------------------------------------------------------------------

const PL = [
  { id: "1", type: "payment", patientId: "p1", paid: 100, normDate: "2025-03-01" },
  { id: "2", type: "payment", patientId: "p1", paid: 100, normDate: "2026-03-01" },
  { id: "3", type: "payment", patientId: "p2", paid: 100, normDate: "2025-06-01" },
  { id: "4", type: "payment", patientId: "p3", paid: 100, normDate: "2026-06-01" },
];
const earlier = { start: "2024-10-01", end: "2025-09-30" };
const later = { start: "2025-10-01", end: "2026-09-30" };
const rt = retention(PL, [{ patientId: "p2", status: "Completed", date: "2026-01-15" }], [{ id: "p3", createdAt: "2025-05-01" }, { id: "p1", createdAt: "2024-01-01" }], earlier, later, "2026-09-27");
eq([rt.before, rt.retained, rt.lost, rt.newcomers], [2, 2, 0, 1], "p2's attended appointment counts as a visit, so both earlier patients came back");
eq(rt.retentionPct, 100, "all of them");
eq(rt.newReturned, { opened: 1, returned: 1, pct: 100 }, "p3's file opened in the earlier window and they came back");
eq(rt.medianGapMonths, 12, "p1: twelve months apart, p2: seven and a half; the upper middle of two gaps");

const ltv = lifetimeValue(PL, [{ id: "p1", name: "Mona", referral: "Instagram" }, { id: "p2", name: "Karim", source: "whatsapp_bot" }]);
eq(ltv.lines[0].paid, 200, "Mona's lifetime");
eq(ltv.lines[0].visits, 2, "over two visits");
eq(ltv.lines[0].perVisit, 100, "100 a visit");
eq(ltv.bySource.find((s) => s.source === "Instagram")!.average, 200, "Instagram's average patient");
eq(ltv.average, Number(((200 + 100 + 100) / 3).toFixed(2)), "the clinic's average");

eq(ageOf({ id: "x", dateOfBirth: "1990-09-28" }, "2026-09-27"), 35, "the day before a birthday is still the old age");
eq(ageOf({ id: "x", age: "42" }, "2026-09-27"), 42, "legacy age field");
eq(ageOf({ id: "x" }, "2026-09-27"), null, "nothing known");
eq(ageBand(11), "0-11", "eleven is a child");
eq(ageBand(60), "46-60", "sixty is the top of its band");
eq(ageBand(null), "?", "unknown band");
const dm = demographics([{ id: "p1", gender: "Female", dateOfBirth: "1990-01-01", createdAt: "2026-09-02" }, { id: "p2", gender: "m", age: 8 }], [{ id: "c", type: "procedure", patientId: "p2", serviceId: "svc-fl", serviceName: "Fluoride", normDate: "2026-09-03" }, { id: "y", type: "payment", patientId: "p1", paid: 300, normDate: "2026-09-03" }], { start: "2026-09-01", end: "2026-09-30" }, "2026-09-27");
eq(dm.newInPeriod, 1, "one new file in the period");
eq(dm.bands.find((b) => b.band === "0-11")!.topServices, [{ name: "Fluoride", count: 1 }], "children come for fluoride");
eq(dm.gender.find((g) => g.gender === "Female")!.paid, 300, "and women paid 300");
eq(dm.averageAge, 22, "average of 36 and 8");

const rd = recallDue(
  [{ id: "p1", name: "Mona", phone: "1" }, { id: "p2", name: "Karim" }, { id: "p3", name: "Hana" }, { id: "p4", name: "Never" }],
  [{ id: "1", type: "payment", patientId: "p1", paid: 1, normDate: "2026-01-10" }, { id: "2", type: "payment", patientId: "p2", paid: 1, normDate: "2026-01-10" }, { id: "3", type: "payment", patientId: "p3", paid: 1, normDate: "2026-08-10" }],
  [{ patientId: "p2", status: "Confirmed", date: "2026-10-05" }],
  "2026-09-27",
  6,
);
eq(rd.lines.map((l) => l.patientId), ["p1"], "Mona is due; Karim is booked; Hana is not due yet; Never was never seen");
eq(rd.lines[0].bucket, "1-3m", "about eight and a half months since January: two and a half past the six");
eq([rd.booked, rd.neverSeen], [1, 1], "the two exclusions are counted");

// --- operations ---------------------------------------------------------------------------------------

const AP = [
  { id: "a", status: "Completed", date: "2026-09-05", time: "10:00 AM", doctorName: "Dr. Omar", duration: 30, createdAt: "2026-09-01", checkInTime: "2026-09-05T09:55:00", statusHistory: [{ status: "In Chair", timestamp: "2026-09-05T10:10:00" }] },
  { id: "b", status: "No Show", date: "2026-09-05", time: "11:00 AM", doctorName: "Omar", source: "online" },
  { id: "c", status: "Cancelled", date: "2026-09-06", doctorName: "Sara" },
  { id: "d", status: "Confirmed", date: "2026-09-01", doctorName: "Sara" },
  { id: "e", status: "Scheduled", date: "2026-10-01", doctorName: "Sara", source: "whatsapp_bot", duration: 45 },
  { id: "f", status: "Arrived", date: "2026-09-07", doctorName: "Sara" },
];
eq(outcomeOf(AP[0], "2026-09-27"), "seen", "completed is seen");
eq(outcomeOf(AP[3], "2026-09-27"), "noShow", "a past booking nobody closed is a miss");
eq(outcomeOf(AP[4], "2026-09-27"), "open", "a future booking is ahead");
eq(outcomeOf(AP[5], "2026-09-27"), "seen", "the legacy 'Arrived' is checked in, so seen");
const as = appointmentStats(AP, "2026-09-27");
eq([as.overall.seen, as.overall.noShow, as.overall.cancelled, as.overall.open], [2, 2, 1, 1], "the four outcomes");
eq(as.overall.noShowPct, 50, "two misses over four decided");
eq(as.unclosed, 1, "one of the misses was never marked");
eq(as.byDentist.find((d) => d.doctor === "Omar")!.total, 2, "Dr. Omar and Omar are one dentist");
eq(as.bySource.map((s) => s.source), ["desk", "online", "whatsapp_bot"], "desk first, it has the most");
eq(as.waitMinutes, 15, "check-in to chair");
eq(as.leadDays, 4, "booked four days ahead");
eq(as.minutesPerDay, 35, "chair minutes over the three days with seen or open bookings (30, 45, 30); a no-show books no chair");

const LC = [
  { id: "l1", status: "fitted", labId: "L1", labName: "Smile Lab", agreedPrice: 500, sentAt: "2026-09-01", receivedAt: "2026-09-06", workType: "zirconia" },
  { id: "l2", status: "at_lab", labId: "L1", labName: "Smile Lab", agreedPrice: 700, sentAt: "2026-09-10", dueDate: "2026-09-20", workType: "emax", code: "MAD-2", patientName: "Mona" },
  { id: "l3", status: "back", labId: "L2", labName: "Other", agreedPrice: 0, sentAt: "2026-09-12", receivedAt: "2026-09-14", remakeOfId: "l1", remakeFault: "lab", workType: "zirconia" },
  { id: "l4", status: "draft", labId: "L2", labName: "Other", agreedPrice: 900, workType: "pmma" },
];
const ls = labStats(LC, [{ labId: "L1", amount: 300 }], "2026-09-27");
eq([ls.total, ls.atLab, ls.overdue, ls.remakes], [4, 1, 1, 1], "counts");
eq(ls.remakePct, 33.3, "one remake over three cases sent — the draft never left");
eq(ls.cost, 500, "only cases back or fitted are owed for: the remake was free, the draft never left");
eq(ls.turnaroundDays, 3.5, "five days and two days");
const smile = ls.byLab.find((l) => l.labId === "L1")!;
eq([smile.sent, smile.fitted, smile.overdue, smile.cost, smile.paid, smile.turnaroundDays], [2, 1, 1, 500, 300, 5], "Smile Lab's line");
eq(ls.overdueCases[0], { code: "MAD-2", labName: "Smile Lab", patientName: "Mona", dueDate: "2026-09-20", daysLate: 7, workType: "emax" }, "the overdue case, seven days late");
eq(ls.remakeFault, [{ fault: "lab", count: 1 }], "whose fault");

const inv = inventoryStats(
  [{ id: "i1", name: "Gloves", category: "Consumables", stock: 5, minStock: 10, costPerUnit: 50, unit: "box" }, { id: "i2", name: "Composite", stock: 40, minStock: 0, costPerUnit: 200, isPercentage: true }],
  [{ itemId: "i1", change: -3 }, { itemId: "i1", change: 10 }, { itemId: "i2", change: -20 }],
);
eq(inv.stockValue, 5 * 50 + 0.4 * 200, "a percentage item is worth its fraction of the unit cost");
eq(inv.belowMin, 1, "gloves are low");
eq(inv.reorder[0].reorderQty, 15, "back to twice the threshold");
eq(inv.usedCost, 3 * 50 + 0.2 * 200, "consumption at cost");
eq(inv.lines.find((l) => l.itemId === "i1")!.added, 10, "and what came in");

const sl = staffLines([{ staffId: "s1", name: "Omar", role: "Dentist", hasSchedule: true, daysWorked: 20, minutesWorked: 9600, lateMinutes: 30, lateDays: 2, absentDays: 0, overtimeApprovedMinutes: 0, overtimePendingMinutes: 60, estimatedPay: 8000 }], new Map([["s1", 2500]]));
eq([sl[0].hours, sl[0].commission, sl[0].total], [160, 2500, 10500], "hours, commission and the sum");

// --- treatment plans --------------------------------------------------------------------------------

const plans = [
  { id: "t1", patientId: "p1", patientName: "Mona", status: "accepted", total: 3000, doctorName: "Dr. Sara", createdAt: "2026-08-01", steps: [{ serviceId: "svc-crown" }, { serviceId: "svc-fill" }] },
  { id: "t2", patientId: "p2", status: "declined", total: 900, doctorName: "Sara", createdAt: "2026-08-15", steps: [] },
  { id: "t3", patientId: "p3", status: "draft", total: 400, doctorName: "Omar", createdAt: "2026-09-01", steps: [] },
  { id: "t4", patientId: "p4", status: "presented", total: 1200, doctorName: "Omar", createdAt: "2026-09-10", steps: [] },
];
const planLedger = [
  { id: "x1", type: "procedure", patientId: "p1", serviceId: "svc-crown", cost: 1500, normDate: "2026-08-20" },
  { id: "x2", type: "procedure", patientId: "p1", serviceId: "svc-crown", cost: 1500, normDate: "2026-07-01" },
  { id: "x3", type: "procedure", patientId: "p1", serviceId: "svc-other", cost: 999, normDate: "2026-08-25" },
];
const ps = planStats(plans, planLedger, ["2026-08", "2026-09"]);
eq(ps.acceptancePct, 33.3, "one accepted of three shown; the draft was never shown");
eq([ps.acceptedValue, ps.realizedValue, ps.remainingValue], [3000, 1500, 1500], "the crown after the plan counts; the one before it and the unrelated service do not");
eq(ps.byDoctor.find((d) => d.doctor === "Sara")!.acceptancePct, 50, "Dr. Sara and Sara are one person: one accepted of two shown");
eq(ps.byMonth.map((m) => [m.month, m.presented, m.accepted]), [["2026-08", 2, 1], ["2026-09", 1, 0]], "by month written");
eq(ps.lines[0].id, "t1", "the plan with the most money still in it comes first");

// --- whatsapp ------------------------------------------------------------------------------------------

const day = (s: string) => new Date(`2026-09-${s}`).getTime();
const convs = [
  { id: "2010", outcome: "booked", aiUsed: true, lastMessageAt: day("05T10:00:00") },
  { id: "2011", outcome: "handoff", lastMessageAt: day("06T10:00:00"), handoffAtMs: day("06T09:00:00"), humanActiveAtMs: day("06T09:20:00"), handledAtMs: day("06T09:20:00"), severity: "urgent", handoffReason: "pain", needsHuman: false },
  { id: "2012", outcome: "handoff", lastMessageAt: day("07T10:00:00"), handoffAtMs: day("07T09:00:00"), needsHuman: true, handledAtMs: 0, severity: "normal", handoffReason: "price" },
  { id: "play_abc", outcome: "booked", lastMessageAt: day("05T11:00:00") },
  { id: "2013", outcome: "quiet", lastMessageAt: day("01T10:00:00") },
];
const ws = whatsappStats(
  convs,
  [{ source: "whatsapp_bot", createdAt: "2026-09-05T10:05:00" }, { source: "whatsapp_bot", createdAt: "2026-08-05" }, { rescheduledVia: "whatsapp_bot", rescheduledAt: "2026-09-08" }],
  [{ type: "appointment_reminder24h", status: "success" }, { type: "appointment_reminder24h", status: "failed" }],
  [{ type: "reminder24h", status: "sent" }],
  [{ id: "p1", whatsappOptOut: true, optOutAt: "2026-09-09" }, { id: "p2", whatsappOptOut: true, optOutAt: "2026-01-01" }],
  { start: "2026-09-02", end: "2026-09-30" },
);
eq(ws.conversations, 3, "the rehearsal thread and the one before the range are out");
eq([ws.botAlone, ws.botAlonePct], [1, 33.3], "one closed without a person");
eq(ws.aiUsed, 1, "one used the model");
eq([ws.handoffs.total, ws.handoffs.open, ws.handoffs.resolved, ws.handoffs.medianMinutes, ws.handoffs.withinHour], [2, 1, 1, 20, 1], "handoffs: one answered in twenty minutes, one still open");
eq(ws.bookingsByBot, 1, "bookings by the bot, by the date they were made");
eq(ws.reschedulesByBot, 1, "and one move");
eq(ws.sends, [{ type: "appointment_reminder24h", sent: 1, failed: 1, queued: 0, manual: 0 }], "reminder sends and failures");
eq(ws.sms, [{ type: "reminder24h", sent: 1, failed: 0, queued: 0 }], "sms sends");
eq(ws.optOuts, { inPeriod: 1, total: 2 }, "one opted out this month, two ever");

// --- finance: sources, expense comparison, cash flow ---------------------------------------------------

const FP = [
  { id: "p1", referral: "Instagram", createdAt: "2026-09-02" },
  { id: "p2", source: "whatsapp_bot", createdAt: "2025-01-01" },
  { id: "p3", createdAt: "2025-06-01" },
];
const FPREV = [
  { id: "c0", type: "procedure", patientId: "p2", doctorName: "Sara", serviceName: "Filling", serviceId: "svc-fill", cost: 300, normDate: "2026-08-10", date: "2026-08-10" },
  { id: "y0", type: "payment", patientId: "p2", procedureId: "c0", paid: 300, method: "cash", normDate: "2026-08-10", date: "2026-08-10" },
  { id: "y00", type: "payment", patientId: "p9", serviceName: "Whitening", serviceId: "svc-white", paid: 900, method: "cash", normDate: "2026-08-11", date: "2026-08-11" },
];
const src = incomeSources(L, FPREV, FP, { start: "2026-09-01", end: "2026-09-30" }, { start: "2026-08-01", end: "2026-08-31" });
eq([src.total, src.prevTotal], [1800, 1200], "income both sides by the one rule: payments + income rows");
eq(src.dentists.map((g) => [g.name, g.total, g.share]), [["Omar", 1500, 83.3], ["Unassigned", 300, 16.7], ["Sara", 0, 0]], "by dentist: the payment names Omar; the rest are unassigned; Sara earned last period so she is kept at zero");
eq(src.methods.map((g) => [g.name, g.total]), [["Card", 1500], ["InstaPay", 200], ["Cash", 100]], "by method, folded into the five buckets");
eq(src.methods.find((g) => g.name === "Cash")?.prev, 1200, "and what cash was worth the period before");
eq(src.newness.map((g) => [g.name, g.total]), [["New patients", 1500], ["Returning patients", 200], ["Other income", 100]], "new = file opened inside the period; the X-ray CD has no patient");
eq(src.channels.map((g) => [g.name, g.total]), [["Instagram", 1500], ["Unknown / Walk-in", 300], ["whatsapp_bot", 0]], "by channel, off the patient's file; the bot's patient paid last period only");
eq(src.payers.map((g) => [g.name, g.total, g.prev]), [["Private (patient pays)", 1800, 1200]], "no payer stamped anywhere = private");
const gone = src.services.find((g) => g.name === "Whitening");
eq([gone?.total, gone?.prev, gone?.delta.pct], [0, 900, -100], "a service that earned last period and nothing this period still appears, at zero");

const M3 = ["2026-07", "2026-08", "2026-09"];
const FM = [
  ...L,
  { id: "e3", type: "expense", cost: 5000, category: "Rent", normDate: "2026-08-01", date: "2026-08-01" },
  { id: "e4", type: "expense", cost: 750, category: "Supplies", normDate: "2026-08-15", date: "2026-08-15" },
  { id: "y3", type: "payment", patientId: "p2", paid: 4000, normDate: "2026-08-15", date: "2026-08-15" },
];
const mx = expenseMatrix(FM, M3);
eq(mx.totals, [0, 5750, 5250], "expenses per month, July empty");
eq(mx.activeMonths, 2, "July had nothing at all, so it does not drag the average down");
eq([mx.total, mx.average], [11000, 5500], "total and the average over active months");
eq(mx.categories.map((c) => [c.category, c.byMonth, c.total, c.share]), [["Rent", [0, 5000, 5000], 10000, 90.9], ["Supplies", [0, 750, 250], 1000, 9.1]], "category by month, largest first");
eq(mx.categories[1].delta.pct, -66.7, "supplies fell two thirds on the month before");
eq(mx.incomeShare, [null, 143.8, 291.7], "expenses as a share of that month's income; null when nothing came in");
eq(mx.peak, { month: "2026-08", value: 5750 }, "the heaviest month");

const cmp = compareExpenseCategories(L, [{ id: "e3", type: "expense", cost: 5000, category: "Rent", normDate: "2026-08-01" }, { id: "e5", type: "expense", cost: 400, category: "Lab", normDate: "2026-08-02" }]);
eq(cmp.map((c) => [c.category, c.then, c.now, c.delta.pct]), [["Lab", 400, 0, -100], ["Supplies", 0, 250, null], ["Rent", 5000, 5000, 0]], "category against the period before, biggest move first; a category that vanished is kept at zero");

const cf = cashflow(FM, M3);
eq(cf.months.map((m) => [m.inflow, m.outflow, m.net, m.running]), [[0, 0, 0, 0], [4000, 5750, -1750, -1750], [1800, 5650, -3850, -5600]], "in, out (expenses + lab; commission leaves as a Salary expense when paid), net and the running total");
eq([cf.inflow, cf.outflow, cf.net, cf.averageNet, cf.monthsInRed], [5800, 11400, -5600, -2800, 2], "totals over the window, the average over active months, months in the red");
eq([cf.best?.month, cf.worst?.month], ["2026-08", "2026-09"], "best and worst month by net");

console.log(`reportSuite: ${checks} checks passed`);
