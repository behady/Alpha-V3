// The booking popup's Payment tab: the patient's own figures, with an insurance approval's
// insurer part and the insurer's payments kept out. Invented figures only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patientAccount } from "../src/lib/ledgerInsurer";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

// A private filling, a contract-company row added by hand, and one approval line: approved 868.25
// plus a patient share of 100.
const privateRow = { id: "p1", type: "procedure", cost: 800, paid: 800, discountAmount: 0 };
const contractRow = { id: "g1", type: "procedure", cost: 1584, paid: 1584, payerId: "gasco" };
const approvalRow = {
  id: "a1", type: "procedure", cost: 968.25, paid: 0, claimId: "nextcare_C1", insurerCovered: 868.25,
  listPrice: 1200, discountAmount: 231.75,
};
const cash = (id: string, procedureId: string, paid: number) => ({ id, type: "payment", paid, amount: paid, method: "Cash", procedureId });

check("an unpaid approval: only the share is the patient's", () => {
  const a = patientAccount([privateRow, contractRow, approvalRow, cash("x1", "p1", 800), cash("x2", "g1", 1584)]);
  assert.equal(a.cost, 800 + 1584 + 100);
  assert.equal(a.paid, 2384);
  assert.equal(a.remaining, 100);
  // The approval's gross-to-approved gap is the insurer's tariff, not the patient's discount.
  assert.equal(a.discount, 0);
  const side = a.byCharge.get("a1")!;
  assert.deepEqual(side, { approval: true, insurerPart: 868.25, insurerPaid: 0, patientDue: 100, patientPaid: 0, patientLeft: 100 });
  assert.equal(a.byCharge.get("g1")!.approval, false, "a hand-added insurer row is the patient's to settle");
});

check("the insurer's cheque is not the patient's money", () => {
  const rows = [
    privateRow,
    { ...approvalRow, paid: 868.25, insurerPaidAt: "2026-10-10" },
    cash("x1", "p1", 800),
    { id: "ins", type: "payment", paid: 868.25, amount: 868.25, method: "Insurance", procedureId: "a1" },
  ];
  const a = patientAccount(rows);
  assert.equal(a.paid, 800);
  assert.equal(a.remaining, 100);
  assert.equal(a.byCharge.get("a1")!.insurerPaid, 868.25);
  assert.equal(a.byCharge.get("a1")!.patientLeft, 100);
});

check("the share collected, the insurer paid: nothing left either way", () => {
  const a = patientAccount([
    { ...approvalRow, paid: 968.25 },
    cash("s", "a1", 100),
    { id: "ins", type: "payment", paid: 868.25, method: "Insurance", procedureId: "a1" },
  ]);
  assert.equal(a.cost, 100);
  assert.equal(a.paid, 100);
  assert.equal(a.remaining, 0);
  assert.equal(a.byCharge.get("a1")!.patientLeft, 0);
});

check("a payment marked Insurance on an ordinary row stays the patient's", () => {
  const a = patientAccount([privateRow, { id: "x", type: "payment", paid: 800, method: "Insurance", procedureId: "p1" }]);
  assert.equal(a.paid, 800);
  assert.equal(a.remaining, 0);
});

check("an approval with no patient share costs the patient nothing", () => {
  const a = patientAccount([{ ...approvalRow, cost: 868.25 }]);
  assert.equal(a.cost, 0);
  assert.equal(a.remaining, 0);
  assert.equal(a.byCharge.get("a1")!.patientDue, 0);
});

check("the Payment tab reads its figures from patientAccount", () => {
  const tab = readFileSync(new URL("../src/components/appointments/AppointmentMoneyTab.tsx", import.meta.url), "utf8");
  assert.match(tab, /patientAccount\(ledger\)/, "the tab adds the insurer's part into the patient's bill again");
  assert.match(tab, /const totalPaid = account\.paid/, "the tab counts the insurer's payment as the patient's");
});

console.log(`\n${passed} checks passed`);
