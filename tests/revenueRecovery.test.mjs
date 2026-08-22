// Fixture test for the Revenue Recovery detectors. Run with tsx so the TS module loads directly.
import assert from "node:assert/strict";
import { analyzeRecovery } from "../src/lib/revenueRecovery.ts";

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const ledger = [
  // Ali: charged 1000, paid 400 → owes 600, last activity 90 days ago → STALE, should flag.
  { id: "L1", patientId: "p_ali", patientName: "Ali", type: "procedure", amount: 1000, date: daysAgo(120), description: "Crown" },
  { id: "L2", patientId: "p_ali", patientName: "Ali", type: "payment", paid: 400, date: daysAgo(90) },

  // Sara: charged 500, paid 500 → settled, must NOT appear.
  { id: "L3", patientId: "p_sara", patientName: "Sara", type: "procedure", amount: 500, date: daysAgo(200), description: "Filling" },
  { id: "L4", patientId: "p_sara", patientName: "Sara", type: "payment", paid: 500, date: daysAgo(200) },

  // Omar: owes 300 but was seen 5 days ago → mid-treatment, must NOT appear.
  { id: "L5", patientId: "p_omar", patientName: "Omar", type: "procedure", amount: 300, date: daysAgo(5), description: "Filling" },

  // Duplicated payment for Nour — same everything, entered twice.
  { id: "L6", patientId: "p_nour", patientName: "Nour", type: "payment", paid: 250, date: daysAgo(60), description: "Cash" },
  { id: "L7", patientId: "p_nour", patientName: "Nour", type: "payment", paid: 250, date: daysAgo(60), description: "Cash" },

  // Underpriced: Filling list price is 500, charged 300, single unit.
  { id: "L8", patientId: "p_hana", patientName: "Hana", type: "procedure", amount: 300, unitsCount: 1, date: daysAgo(30), description: "Filling" },

  // Multi-unit procedure below list price — legitimately scaled, must NOT flag.
  { id: "L9", patientId: "p_hana", patientName: "Hana", type: "procedure", amount: 400, unitsCount: 3, date: daysAgo(30), description: "Filling" },

  // Clinic expense — must never count as a patient debt.
  { id: "L10", patientId: "p_ali", type: "expense", cost: 900, date: daysAgo(10) },

  // Real-world shape from ServiceEditorDrawer: description is "{name} (T: {tooth}) | {formula}=
  // {cost}", not the plain service name. List price 3500, charged 3000 → should still flag 500.
  { id: "L11", patientId: "p_karim", patientName: "Karim", type: "procedure", amount: 3000, unitsCount: 1, date: daysAgo(10), description: "Zirconia Crown (T: 14) | Flat=3000" },

  // Real-world legacy payment shape (confirmed against live clinic data): amount is left at 0 as
  // a placeholder and the real value lives in `paid`. Mahmoud's two payments are genuinely
  // different (150 vs 147) but share date/description — must NOT be flagged as a duplicate.
  { id: "L12", patientId: "p_mahmoud", patientName: "Mahmoud", type: "payment", amount: 0, paid: 150, date: daysAgo(2), description: "Payment for scaling" },
  { id: "L13", patientId: "p_mahmoud", patientName: "Mahmoud", type: "payment", amount: 0, paid: 147, date: daysAgo(2), description: "Payment for scaling" },

  // Same legacy shape, but genuinely duplicated (both paid=200) — must still be caught, and the
  // reported amount must be the real 200, not the placeholder 0.
  { id: "L14", patientId: "p_nesreen", patientName: "Nesreen", type: "payment", amount: 0, paid: 200, date: daysAgo(1), description: "Payment for whitening" },
  { id: "L15", patientId: "p_nesreen", patientName: "Nesreen", type: "payment", amount: 0, paid: 200, date: daysAgo(1), description: "Payment for whitening" },
];

const notes = [
  // Billed correctly — has ledgerId, must NOT appear.
  { id: "N1", patientId: "p_ali", patientName: "Ali", procedure: "Crown", cost: 1000, ledgerId: "L1", date: daysAgo(120) },
  // Work done, never posted to the ledger → should flag 750.
  { id: "N2", patientId: "p_sara", patientName: "Sara", procedure: "Root Canal", cost: 750, date: daysAgo(40) },
  // Zero-cost note (comped/follow-up) → must NOT flag.
  { id: "N3", patientId: "p_omar", patientName: "Omar", procedure: "Check-up", cost: 0, date: daysAgo(3) },

  // Real-world shape: clinical_notes never stores patientName in this app (confirmed against live
  // data — only patientId is written). Name must resolve through patientNameById, not the row.
  { id: "N4", patientId: "p_zainab", procedure: "Bridge", cost: 450, date: daysAgo(5) },
];

// Renamed in the price list ("Scaling" -> "Deep Cleaning") but the ledger row still carries the
// description written when it was billed. Name matching cannot find this; the serviceId can.
ledger.push({
  id: "L12", patientId: "p_renamed", patientName: "Renamed", type: "procedure",
  amount: 300, cost: 300, unitsCount: 1, date: daysAgo(6),
  description: "Scaling (T: Gen) | 300*1=300",
  serviceId: "S4",
});
// Same service, same charge, but written before serviceId existed — must still fall back to the
// description, and must NOT match, because the price list no longer holds that name.
ledger.push({
  id: "L13", patientId: "p_legacy", patientName: "Legacy", type: "procedure",
  amount: 300, cost: 300, unitsCount: 1, date: daysAgo(6),
  description: "Scaling (T: Gen) | 300*1=300",
});

const services = [
  { id: "S1", name: "Filling", price: 500 },
  { id: "S2", name: "Crown", price: 1000 },
  { id: "S3", name: "Zirconia Crown", price: 3500 },
  { id: "S4", name: "Deep Cleaning", price: 800 },
];

const patientNameById = new Map([["p_zainab", "Zainab Test"]]);

const r = analyzeRecovery("clinic_test", ledger, notes, services, patientNameById);
const kinds = (k) => r.findings.filter((f) => f.kind === k);

// --- unbilled work ---
assert.equal(kinds("unbilled_work").length, 2, "Sara's note plus Zainab's nameless note");
const sara = kinds("unbilled_work").find((f) => f.patientName === "Sara");
assert.equal(sara.amount, 750);
const zainab = kinds("unbilled_work").find((f) => f.patientId === "p_zainab");
assert.ok(zainab, "note with no patientName field must still produce a finding");
assert.equal(zainab.patientName, "Zainab Test", "resolved via patientNameById, not left as Unknown");
assert.equal(zainab.amount, 450);

// --- outstanding balances ---
const balances = kinds("outstanding_balance");
assert.equal(balances.length, 1, "only the stale balance should surface");
assert.equal(balances[0].patientName, "Ali");
assert.equal(balances[0].amount, 600, "1000 charged - 400 paid, expense excluded");
assert.ok(!balances.some((f) => f.patientName === "Sara"), "settled patient excluded");
assert.ok(!balances.some((f) => f.patientName === "Omar"), "recently-seen patient excluded");

// --- duplicates ---
// Nour's genuine dupe, plus Nesreen's legacy-shape dupe. Mahmoud's two genuinely-different
// payments (150 vs 147, both stored with amount:0) must NOT appear here — that was the bug: a
// naive amount:0 read made two different payments look identical.
const dupes = kinds("duplicate_entry");
assert.equal(dupes.length, 2, "Nour + Nesreen only; Mahmoud's real-but-different payments excluded");
assert.ok(!dupes.some((f) => f.patientName === "Mahmoud"), "different paid amounts must not collide via the amount:0 placeholder");

const nourFinding = dupes.find((f) => f.patientName === "Nour");
assert.equal(nourFinding.amount, 250);
assert.equal(nourFinding.evidence.length, 2, "both copies cited as evidence");

const nesreenFinding = dupes.find((f) => f.patientName === "Nesreen");
assert.ok(nesreenFinding, "legacy amount:0/paid shape must still catch a real duplicate");
assert.equal(nesreenFinding.amount, 200, "must report the real paid value, not the amount:0 placeholder");

// --- underpriced ---
// Two single-unit fillings were charged 300 against a 500 list price (Omar L5, Hana L8), plus
// Karim's composite-description crown (L11). The 3-unit row (L9) must NOT appear.
const under = kinds("underpriced_procedure");
assert.equal(under.length, 4, "both plain-name rows, the composite-description row, and the renamed-service row");
assert.ok(!under.some((f) => f.evidence[0].docId === "L9"), "multi-unit row must not be flagged");

// The renamed service: found by id, and reported under its CURRENT name so the owner recognises it.
const renamedFinding = under.find((f) => f.patientName === "Renamed");
assert.ok(renamedFinding, "a row carrying serviceId must match even when its description is a stale name");
assert.equal(renamedFinding.amount, 500, "800 list - 300 charged");
assert.ok(
  renamedFinding.detail.includes("Deep Cleaning"),
  "the finding must name the service as the price list calls it today, not as the ledger row spells it"
);

// The same charge without a serviceId cannot be matched, and must not be guessed at.
assert.ok(
  !under.some((f) => f.patientName === "Legacy"),
  "a legacy row whose description no longer matches any price-list name must not be flagged"
);

const karimFinding = under.find((f) => f.patientName === "Karim");
assert.ok(karimFinding, "composite ServiceEditorDrawer-style description must still match the price list");
assert.equal(karimFinding.amount, 500, "3500 list - 3000 charged");

// --- totals ---
assert.equal(r.totals.unbilledWork, 1200, "750 (Sara) + 450 (Zainab)");
assert.equal(r.totals.outstandingBalance, 600);
assert.equal(r.totals.duplicates, 450, "250 (Nour) + 200 (Nesreen)");
assert.equal(r.totals.underpriced, 1400, "200 + 200 + 500 + 500");
assert.equal(r.totals.recoverable, 2250, "1200 + 600 + 450; underpriced excluded by design");

// --- ranking ---
assert.equal(r.findings[0].amount, 750, "largest finding sorts first");

console.log("All assertions passed.");
console.log("  recoverable total:", r.totals.recoverable);
console.log("  findings:", r.findings.length, JSON.stringify(r.counts));
