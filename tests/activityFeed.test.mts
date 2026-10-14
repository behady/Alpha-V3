/**
 * Activity log v2, the page's pure half: date ranges on the clinic's clock (Egypt has summer
 * time), which day an entry is filed under, the tab/person/patient/branch/flag filters, folding a
 * visit discount's lines into one, the per-person summary strip, and splitting a sentence around
 * the patient's name so it can be a link.
 *
 * Run: npx tsx tests/activityFeed.test.mts
 */

import assert from "node:assert/strict";
import { instantAtYmd, ymdInTimeZone } from "../src/lib/clinicDate";
import {
  dayKey,
  filterEntries,
  foldGroups,
  personKey,
  rangeFor,
  splitOnName,
  summarize,
  summaryItemText,
} from "../src/lib/activity/feed";

let checks = 0;
const eq = <T,>(a: T, b: T, msg?: string) => {
  checks++;
  assert.equal(a, b, msg);
};
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};
const deep = (a: unknown, b: unknown, msg?: string) => {
  checks++;
  assert.deepEqual(a, b, msg);
};

const tz = "Africa/Cairo";

// --- 1. the brief's cases ---
const r = rangeFor("today", new Date("2026-10-13T22:30:00Z"), tz); // 01:30 Cairo on the 14th
eq(r.start.toISOString(), "2026-10-13T21:00:00.000Z");
eq(r.end.toISOString(), "2026-10-14T21:00:00.000Z");
const late = { id: "l", timestamp: new Date("2026-10-13T20:30:00Z") }; // 23:30 Cairo on the 13th
eq(dayKey(late, tz), "2026-10-13");
const y = rangeFor("yesterday", new Date("2026-10-14T09:00:00Z"), tz);
ok(late.timestamp >= y.start && late.timestamp < y.end, "23:30 Cairo on the 13th is yesterday on the 14th");
const g = foldGroups([
  { id: "1", event: "discount.given", groupId: "g", amount: 100, patientName: "عمر" },
  { id: "2", event: "discount.given", groupId: "g", amount: 200, patientName: "عمر" },
  { id: "3", event: "payment.received", amount: 50 },
]);
eq(g.length, 2);
eq(g[0].members.length, 2);
eq(g[0].log.amount, 300);
const s = summarize([
  { id: "a", v: 2, event: "discount.given", categories: ["discount", "money"], userId: "m", userName: "Malak", amount: 200 },
  { id: "b", v: 2, event: "discount.removed", categories: ["discount", "money"], userId: "m", userName: "Malak", amount: 50 },
], "discount");
deep(s, [{ userId: "m", userName: "Malak", items: [{ key: "discounts", count: 1, amount: 150 }] }]);
eq(filterEntries([{ id: "x", module: "appointments", details: "Booked عمر" }], { tab: "appointment", patient: "عمر" }).length, 1);
eq(filterEntries([{ id: "x", module: "finance" }], { tab: "all", flaggedOnly: true }).length, 0);

// --- 2. instantAtYmd: that zone's midnight, both sides of Egypt's summer time ---
eq(instantAtYmd(tz, "2026-01-15").toISOString(), "2026-01-14T22:00:00.000Z", "winter is UTC+2");
eq(instantAtYmd(tz, "2026-07-01").toISOString(), "2026-06-30T21:00:00.000Z", "summer is UTC+3");
// Summer time starts on Friday 24 April 2026: 00:00 never happens, the day opens at 01:00 (+3).
eq(instantAtYmd(tz, "2026-04-24").toISOString(), "2026-04-23T22:00:00.000Z", "the spring-forward day opens at the jump");
eq(instantAtYmd(tz, "2026-04-25").toISOString(), "2026-04-24T21:00:00.000Z");
// It ends at midnight closing Thursday 29 October 2026: Friday opens once, on +2.
eq(instantAtYmd(tz, "2026-10-29").toISOString(), "2026-10-28T21:00:00.000Z");
eq(instantAtYmd(tz, "2026-10-30").toISOString(), "2026-10-29T22:00:00.000Z", "the fall-back day opens on winter time");
// Whatever the transition rules in this Node's tz data, the instant must open that day and no earlier.
for (const ymd of ["2026-04-23", "2026-04-24", "2026-04-25", "2026-10-29", "2026-10-30", "2026-10-31"]) {
  const at = instantAtYmd(tz, ymd);
  eq(ymdInTimeZone(tz, at), ymd, `${ymd} starts inside ${ymd}`);
  ok(ymdInTimeZone(tz, new Date(at.getTime() - 1)) !== ymd, `${ymd}: a millisecond earlier is the day before`);
}

// --- 3. ranges ---
const noon14 = new Date("2026-10-14T09:00:00Z"); // 12:00 Cairo, Wednesday 14 October
const wk = rangeFor("week", noon14, tz);
eq(wk.start.toISOString(), "2026-10-07T21:00:00.000Z", "week starts six days back");
eq(wk.end.toISOString(), "2026-10-14T21:00:00.000Z", "week ends at the end of today");
const mo = rangeFor("month", noon14, tz);
eq(mo.start.toISOString(), "2026-09-30T21:00:00.000Z", "month starts on the 1st, Cairo midnight");
eq(mo.end.toISOString(), "2026-10-14T21:00:00.000Z");
const firstOfMonth = rangeFor("month", new Date("2026-09-30T22:30:00Z"), tz); // 01:30 Cairo on 1 October
eq(firstOfMonth.start.toISOString(), "2026-09-30T21:00:00.000Z", "just after midnight on the 1st is already the new month");
const custom = rangeFor({ from: "2026-10-01", to: "2026-10-03" }, noon14, tz);
eq(custom.start.toISOString(), "2026-09-30T21:00:00.000Z");
eq(custom.end.toISOString(), "2026-10-03T21:00:00.000Z", "custom 'to' is inclusive");
const swapped = rangeFor({ from: "2026-10-03", to: "2026-10-01" }, noon14, tz);
eq(swapped.start.toISOString(), custom.start.toISOString(), "a reversed pair is read the right way round");
eq(swapped.end.toISOString(), custom.end.toISOString());
// Across the October clock change (Thursday 29th at midnight in 2026 tz data): the day still has its own midnight.
const acrossDst = rangeFor({ from: "2026-10-30", to: "2026-10-30" }, noon14, tz);
eq(ymdInTimeZone(tz, acrossDst.start), "2026-10-30");
eq(ymdInTimeZone(tz, new Date(acrossDst.end.getTime() - 1)), "2026-10-30");

// --- 4. dayKey: Firestore Timestamps, Dates, and the legacy `date` fallback ---
eq(dayKey({ id: "t", timestamp: { toDate: () => new Date("2026-10-13T21:00:00Z") } }, tz), "2026-10-14", "Cairo midnight is the new day");
eq(dayKey({ id: "t", timestamp: null, date: "2026-10-02T08:00:00.000Z" }, tz), "2026-10-02");
eq(dayKey({ id: "t" }, tz), "", "no time at all files under no day");

// --- 5. filters ---
const logs = [
  { id: "1", v: 2 as const, event: "payment.received" as const, categories: ["money" as const], userId: "u1", userName: "Malak", patientName: "Omar Hassan", branchId: "b1", flag: false },
  { id: "2", v: 2 as const, event: "payment.deleted" as const, categories: ["money" as const], userId: "u2", userName: "Sara", patientName: "Mona", branchId: "b2", flag: true },
  { id: "3", v: 2 as const, event: "appointment.created" as const, categories: ["appointment" as const], userId: "u1", userName: "Malak", patientName: "omar hassan" },
  { id: "4", module: "finance", userName: "Old Desk", details: "Payment from OMAR" },
  { id: "5", v: 2 as const, event: "settings.labs" as const, categories: ["settings" as const], userId: "u2", userName: "Sara" },
];
deep(filterEntries(logs, { tab: "money" }).map((l) => l.id), ["1", "2", "4"], "legacy finance rows sit under Money");
deep(filterEntries(logs, { tab: "all", userId: "u1" }).map((l) => l.id), ["1", "3"]);
deep(filterEntries(logs, { tab: "all", userId: personKey(logs[3]) }).map((l) => l.id), ["4"], "a legacy row without a uid is still a person");
deep(filterEntries(logs, { tab: "all", patient: "OMAR" }).map((l) => l.id), ["1", "3", "4"], "patient match is case-insensitive, legacy via details");
deep(filterEntries([{ id: "v", v: 2, event: "payment.received", details: "Payment from Omar" }], { tab: "all", patient: "omar" }).map((l) => l.id), [],
  "a v2 row is matched on its patientName, not its English details");
deep(filterEntries(logs, { tab: "all", patient: "  " }).length, 5, "a blank patient box filters nothing");
deep(filterEntries(logs, { tab: "all", branchId: "b2" }).map((l) => l.id), ["2"]);
deep(filterEntries(logs, { tab: "all", flaggedOnly: true }).map((l) => l.id), ["2"]);
deep(filterEntries(logs, { tab: "settings" }).map((l) => l.id), ["5"]);

// --- 6. folding ---
const fold = foldGroups([
  { id: "a", v: 2, event: "discount.given", groupId: "g1", amount: 100, patientName: "عمر", refs: { procedure: "Filling" },
    changes: [{ field: "price", from: 500, to: 400 }] },
  { id: "b", v: 2, event: "discount.given", groupId: "g1", amount: 50, patientName: "عمر", refs: { procedure: "Scaling" } },
  { id: "c", v: 2, event: "discount.given", groupId: "g2", amount: 70, patientName: "Mona" },
  { id: "d", v: 2, event: "payment.received", groupId: "g1", amount: 10 },
  { id: "e", v: 2, event: "discount.given", groupId: "g1", amount: 25, patientName: "عمر", refs: { procedure: "Crown" } },
]);
deep(fold.map((f) => f.log.id), ["a", "c", "d"], "a group sits where its newest line was");
eq(fold[0].members.length, 3);
eq(fold[0].log.amount, 175);
eq(fold[0].log.refs?.procedure, undefined, "different procedures: the folded line names none");
eq(fold[0].log.changes, undefined, "one line's price arrow does not speak for the group");
eq(fold[1].members.length, 1, "a lone discount is its own entry");
eq(fold[2].members.length, 1, "only discount lines fold");
const same = foldGroups([
  { id: "a", v: 2, event: "discount.given", groupId: "g", amount: 10, refs: { procedure: "Filling" } },
  { id: "b", v: 2, event: "discount.given", groupId: "g", amount: 20, refs: { procedure: "Filling" } },
]);
eq(same[0].log.refs?.procedure, "Filling", "one procedure throughout is still named");
const reasons = foldGroups([
  { id: "a", v: 2, event: "discount.given", groupId: "g", amount: 10, reason: "قريب الدكتور" },
  { id: "b", v: 2, event: "discount.given", groupId: "g", amount: 20, reason: "قريب الدكتور" },
  { id: "c", v: 2, event: "discount.given", groupId: "h", amount: 10, reason: "A" },
  { id: "d", v: 2, event: "discount.given", groupId: "h", amount: 20, reason: "B" },
]);
eq(reasons[0].log.reason, "قريب الدكتور", "one reason for the visit is the group's");
eq(reasons[1].log.reason, undefined, "differing reasons stay on their own lines");
const mixed = foldGroups([
  { id: "a", v: 2, event: "discount.given", groupId: "g", amount: 10 },
  { id: "b", v: 2, event: "discount.removed", groupId: "g", amount: 20 },
]);
eq(mixed.length, 2, "given and removed under one group stay apart");

// --- 7. summary strip ---
const money = summarize([
  { id: "1", v: 2, event: "payment.received", categories: ["money"], userId: "s", userName: "Sara", amount: 300 },
  { id: "2", v: 2, event: "payment.received", categories: ["money"], userId: "s", userName: "Sara", amount: 200 },
  { id: "3", v: 2, event: "payment.edited", categories: ["money"], userId: "s", userName: "Sara", amount: 999 },
  { id: "4", v: 2, event: "procedure.deleted", categories: ["money"], userId: "m", userName: "Malak", amount: 900 },
  { id: "5", v: 2, event: "expense.edited", categories: ["money"], userId: "m", userName: "Malak", amount: 5 },
  { id: "6", v: 2, event: "appointment.deleted", categories: ["appointment"], userId: "m", userName: "Malak", amount: 400 },
  { id: "7", module: "finance", userName: "Old Desk", action: "Payment Received" },
], "money");
deep(money, [
  { userId: "m", userName: "Malak", items: [{ key: "edited", count: 1, amount: 0 }, { key: "deleted", count: 1, amount: 900 }] },
  { userId: "s", userName: "Sara", items: [{ key: "received", count: 2, amount: 500 }, { key: "edited", count: 1, amount: 0 }] },
], "people by total money, edits counted not summed, non-money deletes left out, legacy rows ignored");
const disc = summarize([
  { id: "1", v: 2, event: "discount.given", categories: ["discount", "money"], userId: "m", userName: "Malak", amount: 100, groupId: "g" },
  { id: "2", v: 2, event: "discount.given", categories: ["discount", "money"], userId: "m", userName: "Malak", amount: 50, groupId: "g" },
  { id: "3", v: 2, event: "discount.changed", categories: ["discount", "money"], userId: "m", userName: "Malak", amount: 30 },
], "discount");
deep(disc, [{ userId: "m", userName: "Malak", items: [{ key: "discounts", count: 2, amount: 180 }] }], "a visit discount counts once");
const ins = summarize([
  { id: "1", v: 2, event: "insurance.created", categories: ["insurance"], userId: "a", userName: "Aya" },
  { id: "2", v: 2, event: "insurance.status", categories: ["insurance"], userId: "a", userName: "Aya", changes: [{ field: "status", from: "pending", to: "approved" }] },
  { id: "3", v: 2, event: "insurance.status", categories: ["insurance"], userId: "a", userName: "Aya", changes: [{ field: "status", from: "approved", to: "cancelled" }] },
  { id: "4", v: 2, event: "insurer.collected", categories: ["insurance", "money"], userId: "b", userName: "Badr", amount: 5000 },
], "insurance");
deep(ins, [
  { userId: "b", userName: "Badr", items: [{ key: "insCollected", count: 1, amount: 5000 }] },
  { userId: "a", userName: "Aya", items: [
    { key: "insCreated", count: 1, amount: 0 }, { key: "insStatus", count: 1, amount: 0 }, { key: "insCancelled", count: 1, amount: 0 },
  ] },
]);
eq(summaryItemText({ key: "discounts", count: 6, amount: 1200 }, "ar"), "6 خصومات · 1,200 ج");
eq(summaryItemText({ key: "discounts", count: 2, amount: 300 }, "ar"), "خصمين · 300 ج");
eq(summaryItemText({ key: "edited", count: 3, amount: 0 }, "ar"), "3 تعديلات");
eq(summaryItemText({ key: "received", count: 1, amount: 500 }, "en"), "1 payment received · 500 EGP");
for (const key of ["received", "edited", "deleted", "discounts", "insCreated", "insStatus", "insCancelled", "insCollected"] as const) {
  for (const lang of ["ar", "en"] as const) {
    for (const count of [1, 2, 5, 11]) {
      const t = summaryItemText({ key, count, amount: 10 }, lang);
      ok(!!t && !t.includes("undefined") && !t.includes("NaN"), `${key}/${lang}/${count} reads: ${t}`);
    }
  }
}

// --- 8. splitting a sentence around the patient's name ---
deep(splitOnName("استلام 500 ج كاش من عمر حسام", "عمر حسام"), ["استلام 500 ج كاش من ", "عمر حسام", ""]);
eq(splitOnName("Payment received", "Omar"), null, "no name in the sentence: nothing to link");
eq(splitOnName("Payment received", ""), null);

console.log(`activityFeed: ${checks} checks passed`);
