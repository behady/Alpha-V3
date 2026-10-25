// Money on account that a treatment could now take (lib/creditSuggestions): the deposit paid before
// the implant was recorded, offered to the implant once it is.
//
// The failures that matter: offering a link the ledger route will refuse (more than the treatment
// has left, the insurer's own payment, a contract company's treatment), offering a payment that
// already settles something, and offering the oldest treatment first when the deposit was for the
// one just added.
//
// Run with tsx: npm run test:credit-suggestions
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creditSuggestions, type CreditRow } from "../src/lib/creditSuggestions";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const at = (ms: number) => ({ toMillis: () => ms });

// DENT INN, 24 Oct 2026, after the edits.
const implantCase: CreditRow[] = [
  { id: "dep", type: "payment", date: "2026-10-21", paid: 1500, amount: 1500, method: "Cash", procedureId: null, createdAt: at(100) },
  { id: "imp", type: "procedure", date: "2026-10-24", serviceName: "زرعة", cost: 20000, amount: 20000, createdAt: at(200) },
  { id: "pay", type: "payment", date: "2026-10-24", paid: 8500, method: "Cash", procedureId: "imp", createdAt: at(300) },
  { id: "ten", type: "payment", date: "2026-10-21", paid: 10000, method: "Cash", procedureId: "imp", createdAt: at(310) },
];

{
  eq(creditSuggestions(implantCase), [
    { paymentId: "dep", amount: 1500, date: "2026-10-21", branchId: "", targets: [{ procedureId: "imp", name: "زرعة", date: "2026-10-24", remaining: 1500 }] },
  ], "the deposit is offered to the implant, which has exactly 1,500 left");

  const linked = implantCase.map((r) => (r.id === "dep" ? { ...r, procedureId: "imp" } : r));
  eq(creditSuggestions(linked), [], "once linked, nothing is left to offer");
}

{
  const rows: CreditRow[] = [
    { id: "dep", type: "payment", date: "2026-10-01", paid: 1000, method: "Cash", createdAt: at(1) },
    { id: "old", type: "procedure", date: "2026-09-01", description: "Scaling | 1x1200=1200", cost: 1200, createdAt: at(2) },
    { id: "new", type: "procedure", date: "2026-10-05", description: "Root canal (T: 36) | 1x3000=3000", cost: 3000, createdAt: at(3) },
    { id: "small", type: "procedure", date: "2026-10-06", serviceName: "X-ray", cost: 300, createdAt: at(4) },
    { id: "paid", type: "procedure", date: "2026-10-07", serviceName: "Filling", cost: 900, createdAt: at(5) },
    { id: "p1", type: "payment", date: "2026-10-07", paid: 900, method: "Cash", procedureId: "paid", createdAt: at(6) },
    { id: "gasco", type: "procedure", date: "2026-10-08", serviceName: "Crown", cost: 5000, payerId: "gasco", createdAt: at(7) },
    { id: "gone", type: "procedure", date: "2026-10-09", serviceName: "Gone", cost: 5000, status: "deleted", createdAt: at(8) },
  ];
  const [s] = creditSuggestions(rows);
  eq(s.targets.map((t) => [t.procedureId, t.name, t.remaining]), [["new", "Root canal", 3000], ["old", "Scaling", 1200]],
    "newest first; too small, fully paid, a contract company's and a deleted treatment are not offered");

  const ins: CreditRow[] = [...rows, { id: "insurer", type: "payment", date: "2026-10-01", paid: 500, method: "Insurance", createdAt: at(9) }];
  eq(creditSuggestions(ins).map((x) => x.paymentId), ["dep"], "the insurer's own payment is not the patient's credit");

  const big: CreditRow[] = [{ id: "dep", type: "payment", date: "2026-10-01", paid: 5000, method: "Cash", createdAt: at(1) }, ...rows.slice(1)];
  eq(creditSuggestions(big), [], "a payment bigger than anything left is not offered: one row settles one treatment, and the route refuses an overpay");
}

{
  const approval: CreditRow[] = [
    { id: "dep", type: "payment", date: "2026-10-01", paid: 665, method: "Cash", branchId: "nasr", createdAt: at(1) },
    { id: "a", type: "procedure", date: "2026-10-02", serviceName: "RCT", payerId: "nextcare", claimId: "c1", cost: 2665, insurerCovered: 2000, createdAt: at(2) },
  ];
  eq(creditSuggestions(approval).map((x) => [x.branchId, x.targets[0].remaining]), [["nasr", 665]], "an approval treatment: only the patient's part is room for their money");
  eq(creditSuggestions([{ id: "z", type: "payment", paid: 0, amount: 0, createdAt: at(1) }, ...approval.slice(1)]), [], "a zero row is not credit");
}

// --- Wiring: the screen offers it to money editors and links through the route -------------------
{
  const screen = readFileSync(new URL("../src/components/PatientFinance.tsx", import.meta.url), "utf8");
  eq(/const credits = hasEditAccess && !isReadOnly\s+\? creditSuggestions\(/.test(screen), true, "only for someone who may edit money");
  eq(/updateLedgerRow\(paymentId, \{ procedureId \}, clinic\?\.id\)/.test(screen), true, "the link alone, through the ledger route");
  eq(/<CreditSuggestionsCard suggestions=\{credits\}/.test(screen), true, "the card is on the patient's money screen");
}

console.log(`credit suggestions: ${checks} checks passed`);
