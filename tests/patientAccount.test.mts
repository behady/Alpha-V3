// The booking popup's Payment tab: the patient's own figures, with an insurance approval's
// insurer part and the insurer's payments kept out. Invented figures only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { insurerOutstanding, isCompanyRow, patientAccount, patientPortion } from "../src/lib/ledgerInsurer";

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
  const a = patientAccount([privateRow, { ...contractRow, paid: 0 }, approvalRow, cash("x1", "p1", 800)]);
  assert.equal(a.cost, 800 + 100);
  assert.equal(a.paid, 800);
  assert.equal(a.remaining, 100);
  // The approval's gross-to-approved gap is the insurer's tariff, not the patient's discount.
  assert.equal(a.discount, 0);
  const side = a.byCharge.get("a1")!;
  assert.deepEqual(side, { approval: true, company: false, insurerPart: 868.25, insurerPaid: 0, patientDue: 100, patientPaid: 0, patientLeft: 100 });
  assert.deepEqual(a.byCharge.get("g1"), { approval: false, company: true, insurerPart: 1584, insurerPaid: 0, patientDue: 0, patientPaid: 0, patientLeft: 0 });
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

check("a company row (Gasco, no paper) is not the patient's bill", () => {
  // The owner's screenshot, 2026-10-14: a GASCO visit of 1,584 + 66 + 66 read "Remaining 1,980".
  const rows = [
    { id: "g1", type: "procedure", cost: 1584, paid: 0, payerId: "gasco", payerName: "Gasco", discountAmount: 50 },
    { id: "g2", type: "procedure", cost: 66, paid: 0, payerId: "gasco", payerName: "Gasco" },
    { id: "g3", type: "procedure", cost: 66, paid: 0, payerId: "gasco", payerName: "Gasco" },
    { ...privateRow, paid: 0 },
  ];
  const a = patientAccount(rows);
  assert.equal(a.cost, 800, "only the private filling is the patient's");
  assert.equal(a.paid, 0);
  assert.equal(a.remaining, 800);
  assert.equal(a.discount, 0, "a discount on Gasco's bill is not the patient's");
  assert.deepEqual(a.byCharge.get("g1"), { approval: false, company: true, insurerPart: 1584, insurerPaid: 0, patientDue: 0, patientPaid: 0, patientLeft: 0 });
});

check("the patient's cash on a company row is their credit; Gasco still owes the whole price", () => {
  // The owner's rule, 2026-10-14: never subtracted from Gasco. (The route now refuses such a
  // payment; this is a row from before that.)
  const a = patientAccount([
    { id: "g1", type: "procedure", cost: 1000, paid: 1200, payerId: "gasco" },
    cash("c", "g1", 200),
    { id: "ins", type: "payment", paid: 1000, amount: 1000, method: "Insurance", procedureId: "g1" },
  ]);
  assert.equal(a.cost, 0);
  assert.equal(a.paid, 200);
  assert.equal(a.remaining, -200, "200 of credit");
  assert.deepEqual(a.byCharge.get("g1"), { approval: false, company: true, insurerPart: 1000, insurerPaid: 1000, patientDue: 0, patientPaid: 0, patientLeft: 0 });
});

check("payer Private, blank or absent is the patient's own work", () => {
  for (const payerId of ["private", "", undefined, "  "]) {
    const a = patientAccount([{ id: "p", type: "procedure", cost: 500, paid: 0, payerId }]);
    assert.equal(a.remaining, 500, `payerId ${JSON.stringify(payerId)}`);
    assert.equal(a.byCharge.get("p")!.company, false);
  }
});

check("patientPortion: the patient file, reminders and receipts agree on a company row", () => {
  const unpaid = { type: "procedure", cost: 1584, paid: 0, payerId: "gasco" };
  assert.equal(isCompanyRow(unpaid), true);
  assert.equal(insurerOutstanding(unpaid), 1584);
  assert.equal(patientPortion(unpaid), 0, "a reminder would ask the patient for Gasco's 1,584");
  // Collected from Gasco: the company's payment and the portion cancel out in every tally.
  assert.equal(insurerOutstanding({ ...unpaid, paid: 1584, insurerPaidAt: "2026-10-14" }), 0);
  assert.equal(patientPortion({ ...unpaid, paid: 1584, insurerPaidAt: "2026-10-14" }), 1584);
  // The collection deleted: `paid` is recomputed to 0 but the stamp stays. Gasco owes it again.
  assert.equal(insurerOutstanding({ ...unpaid, paid: 0, insurerPaidAt: "2026-10-14" }), 1584);
  // An approval row keeps its own rule even with a payer on it.
  const approval = { type: "procedure", cost: 968.25, paid: 0, claimId: "c1", payerId: "nextcare", insurerCovered: 868.25 };
  assert.equal(isCompanyRow(approval), false);
  assert.equal(patientPortion(approval), 100);
  assert.equal(patientPortion({ type: "procedure", cost: 500, payerId: "private" }), 500);
});

check("the Payment tab reads its figures from patientAccount", () => {
  const tab = readFileSync(new URL("../src/components/appointments/AppointmentMoneyTab.tsx", import.meta.url), "utf8");
  assert.match(tab, /patientAccount\(ledger\)/, "the tab adds the insurer's part into the patient's bill again");
  assert.match(tab, /const totalPaid = account\.paid/, "the tab counts the insurer's payment as the patient's");
});

console.log(`\n${passed} checks passed`);
