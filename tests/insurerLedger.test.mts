// An insurance company's rows on the Finance page: what it owes, and the patient/insurer split.
import assert from "node:assert/strict";
import { insurerRows, insurerTotals, type LedgerLite } from "../src/lib/insurerLedger";

const charge = (id: string, extra: Partial<LedgerLite> = {}): LedgerLite => ({
  id, type: "procedure", payerId: "gasco", payerName: "GASCO", cost: 1584, amount: 1584, paid: 0, patientId: "P1", patientName: "Leila Hany", ...extra,
});
const pay = (id: string, procedureId: string, amount: number, method: string, extra: Partial<LedgerLite> = {}): LedgerLite => ({
  id, type: "payment", procedureId, paid: amount, amount, method, payerId: "gasco", ...extra,
});

// A Gasco charge of 1584, 500 paid in cash by the patient and 300 already paid by the company.
{
  const rows = [charge("C1", { paid: 800 }), pay("P1", "C1", 500, "Cash"), pay("P2", "C1", 300, "Insurance")];
  const out = insurerRows(rows, "gasco");
  assert.equal(out.length, 1, "only the charge is a row; its payments are folded in");
  assert.equal(out[0].charge.id, "C1");
  assert.equal(out[0].cost, 1584);
  assert.equal(out[0].patientPaid, 500);
  assert.equal(out[0].insurerPaid, 300);
  assert.equal(out[0].outstanding, 784);
  assert.equal(out[0].collectable, true);
}

// A charge with no payments: the company owes all of it.
{
  const out = insurerRows([charge("C1")], "gasco");
  assert.deepEqual([out[0].patientPaid, out[0].insurerPaid, out[0].outstanding, out[0].collectable], [0, 0, 1584, true]);
}

// A settled charge is not collectable, and never goes negative.
{
  const rows = [charge("C1", { cost: 400, amount: 400 }), pay("P1", "C1", 150, "Cash"), pay("P2", "C1", 250, "Insurance")];
  const out = insurerRows(rows, "gasco");
  assert.equal(out[0].outstanding, 0);
  assert.equal(out[0].collectable, false, "nothing left to collect");
  const over = insurerRows([charge("C1", { cost: 400, amount: 400 }), pay("P1", "C1", 500, "Cash")], "gasco");
  assert.equal(over[0].outstanding, 0, "overpaid never reads negative");
}

// A row written by an approval (claimId) is listed but collected on the Insurance page.
{
  const out = insurerRows([charge("C1", { claimId: "metlife_d1" })], "gasco");
  assert.equal(out.length, 1);
  assert.equal(out[0].outstanding, 1584);
  assert.equal(out[0].collectable, false, "approval rows are collected on the Insurance page");
}

// Private work, another company's work, and non-treatment rows are not this company's.
{
  const rows = [
    charge("C1"),
    charge("C2", { payerId: "private" }),
    charge("C3", { payerId: "axa" }),
    charge("C4", { payerId: undefined }),
    { id: "E1", type: "expense", payerId: "gasco", cost: 50 } as LedgerLite,
    pay("P1", "C2", 100, "Cash", { payerId: "private" }),
  ];
  assert.deepEqual(insurerRows(rows, "gasco").map((r) => r.charge.id), ["C1"]);
  assert.deepEqual(insurerRows(rows, "axa").map((r) => r.charge.id), ["C3"]);
}

// A payment against another charge does not leak onto this one; an unlinked payment belongs to nobody.
{
  const rows = [charge("C1"), charge("C2"), pay("P1", "C2", 100, "Cash"), pay("P2", "", 999, "Cash")];
  const out = insurerRows(rows, "gasco");
  assert.equal(out.find((r) => r.charge.id === "C1")!.patientPaid, 0);
  assert.equal(out.find((r) => r.charge.id === "C2")!.patientPaid, 100);
}

// Cost falls back to amount, like every other reader of a charge.
{
  const out = insurerRows([charge("C1", { cost: 0, amount: 700 })], "gasco");
  assert.equal(out[0].cost, 700);
}

// Totals.
{
  const rows = [
    charge("C1"), pay("P1", "C1", 500, "Cash"), pay("P2", "C1", 300, "Insurance"),
    charge("C2", { cost: 1000, amount: 1000 }), pay("P3", "C2", 1000, "Insurance"),
  ];
  const t = insurerTotals(insurerRows(rows, "gasco"));
  assert.deepEqual(t, { billed: 2584, patientPaid: 500, insurerPaid: 1300, outstanding: 784 });
  assert.deepEqual(insurerTotals([]), { billed: 0, patientPaid: 0, insurerPaid: 0, outstanding: 0 });
}

console.log("insurerLedger: all cases pass");
