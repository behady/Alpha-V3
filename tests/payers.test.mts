// Insurance: who paid, what it was worth, and what each dentist earned on it.
//
// The clinic that asked for this works with several insurers, pays its dentists a different
// percentage on insurance work than on private, and wants a payroll sheet split by payer. Every
// failure mode here is silent — a wrong percentage pays a real person the wrong money and nothing
// throws — so the assertions below are mostly about refusals and about arithmetic that has to
// agree with itself.
//
// The rule underneath all of it: a payer, a rate and a commission are STAMPED when the money
// moves, and this report adds up history rather than recomputing it. Change a rate in Settings
// tomorrow and last month must say exactly what it said yesterday, or nobody can sign a payroll.
//
// Run with tsx so the TS modules load directly: npm run test:payers
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRIVATE_PAYER_ID,
  commissionRateFor,
  defaultPayer,
  hasOwnRate,
  parsePayers,
  payerIdFrom,
  payerOf,
  payerStamp,
  payersDocFrom,
  payerForPriceList,
  withCommissionRate,
  type Payer,
} from "../src/lib/payers";
import { buildPayerReport, byDoctor } from "../src/lib/payerReport";
import { parsePriceLists } from "../src/lib/priceLists";

const REPO = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. The payer list always makes sense, whatever is in the document ------------------------
{
  const empty = parsePayers(null);
  eq(empty.length, 1, "a clinic that has never opened the screen still has exactly one payer");
  eq(empty[0].id, PRIVATE_PAYER_ID, "and that payer is Private");
  ok(empty[0].isDefault && empty[0].active, "Private is active and preselected out of the box");

  // Private cannot be deleted or retired: every historical private case resolves to it, and a
  // walk-in would have nowhere to go.
  const withoutPrivate = parsePayers({ payers: [{ id: "metlife", name: "MetLife", active: true, isDefault: true }] });
  ok(withoutPrivate.some((p) => p.id === PRIVATE_PAYER_ID), "Private is put back when a document omits it");
  const retiredPrivate = parsePayers({
    payers: [{ id: PRIVATE_PAYER_ID, name: "Private", active: false, isDefault: false }],
  });
  ok(retiredPrivate[0].active, "Private cannot be retired");

  // Exactly one default among the active rows — a treatment screen cannot render two answers.
  const twoDefaults = parsePayers({
    payers: [
      { id: PRIVATE_PAYER_ID, name: "Private", active: true, isDefault: true },
      { id: "axa", name: "AXA", active: true, isDefault: true },
    ],
  });
  eq(twoDefaults.filter((p) => p.isDefault).length, 1, "two defaults collapse to one");
  const noDefault = parsePayers({
    payers: [
      { id: PRIVATE_PAYER_ID, name: "Private", active: true, isDefault: false },
      { id: "axa", name: "AXA", active: true, isDefault: false },
    ],
  });
  eq(noDefault.filter((p) => p.isDefault).length, 1, "no default at all promotes one");

  // Hand-editable text is re-validated, never trusted.
  const junk = parsePayers({
    payers: [
      { id: "", name: "No id" },
      { id: "ok", name: "" },
      { id: "axa", name: "AXA", active: true },
      { id: "axa", name: "AXA again", active: true },
      "nonsense",
      null,
    ],
  });
  eq(junk.filter((p) => p.id === "axa").length, 1, "a duplicated id is kept once, not twice");
  ok(!junk.some((p) => !p.name.trim()), "a payer with no name is dropped rather than rendered blank");

  // Ids become Firestore map keys on the staff record, so a dot would create a nested path.
  const tricky = payerIdFrom("Bupa / Egypt v2.0", []);
  ok(/^[a-z0-9_-]+$/.test(tricky), `"${tricky}" is not safe as a Firestore map key`);
  const taken: Payer[] = [{ id: "bupa", name: "Bupa", active: true, isDefault: false }];
  ok(payerIdFrom("Bupa", taken) !== "bupa", "a second payer with the same name gets its own id");

  eq(payersDocFrom([]).payers[0].id, PRIVATE_PAYER_ID, "Private is written first, so the screen opens on it");
}

// --- 2. The price list IS the insurer ---------------------------------------------------------
//
// There is no "paid by" question anywhere in the app. The receptionist picks a price list per
// treatment — the only control there has ever been — and that decides whose case it is. Two
// treatments in one visit on two different lists are two different payers, which is how a patient
// whose scaling is covered and whose filling is not gets both recorded honestly.
{
  const payers = parsePayers({
    payers: [
      { id: PRIVATE_PAYER_ID, name: "Private", active: true, isDefault: true },
      { id: "axa", name: "AXA", active: true, isDefault: false, priceListId: "payer-axa" },
      { id: "oldco", name: "OldCo", active: false, isDefault: false, priceListId: "payer-oldco" },
    ],
  });

  eq(payerForPriceList(payers, "payer-axa").id, "axa", "charging on the AXA list makes it AXA's case");
  eq(
    payerForPriceList(payers, "standard").id,
    PRIVATE_PAYER_ID,
    "a list no insurer owns is private work — the clinic's own list needs no configuration"
  );
  eq(payerForPriceList(payers, null).id, PRIVATE_PAYER_ID, "no list at all is private work");
  eq(
    payerForPriceList(payers, "payer-oldco").id,
    PRIVATE_PAYER_ID,
    "a retired insurer's list must not still claim cases — the same rule price lists follow"
  );
  eq(payerForPriceList(payers, "nothing-owns-this").id, PRIVATE_PAYER_ID, "an unknown list falls back, it does not throw");
  eq(defaultPayer(payers).id, PRIVATE_PAYER_ID, "the default is the one marked default");

  // The NAME is stamped beside the id so a renamed or deleted insurer still reads correctly on
  // the treatment that was done under it.
  eq(payerStamp(payers, "axa"), { payerId: "axa", payerName: "AXA" }, "the stamp carries the name");
  eq(
    payerStamp(payers, "vanished").payerName,
    "Private",
    "a stamp for an unknown payer names something rather than nothing"
  );
}

// --- 3. The rate: the exception, then the usual, and never a silent zero ----------------------
{
  const omar = { commissionPercentage: 40, commissionByPayer: { axa: 25 } };

  eq(commissionRateFor(omar, "axa"), 25, "a dentist's rate for this insurer wins");
  eq(commissionRateFor(omar, PRIVATE_PAYER_ID), 40, "their ordinary rate applies where there is no exception");
  eq(
    commissionRateFor(omar, "bupa"),
    40,
    "an insurer with no rate set must pay the dentist their usual percentage, NOT nothing — this is the one that would quietly underpay a real person"
  );
  eq(commissionRateFor(omar, null), 40, "a treatment with no payer at all uses the ordinary rate, as it always did");
  eq(commissionRateFor(null, "axa"), 0, "no staff record means no commission");

  // Zero is a real answer and must survive, because "this insurer's work earns them nothing" is a
  // deal clinics actually do.
  eq(commissionRateFor({ commissionPercentage: 40, commissionByPayer: { axa: 0 } }, "axa"), 0, "an explicit zero is honoured");
  ok(hasOwnRate({ commissionByPayer: { axa: 0 } }, "axa"), "an explicit zero counts as having its own rate");
  ok(!hasOwnRate({ commissionByPayer: {} }, "axa"), "an absent entry is not an own rate");

  // A typo cannot pay somebody more than the treatment earned.
  eq(commissionRateFor({ commissionPercentage: 400 }, null), 100, "a rate over 100 is clamped");
  eq(commissionRateFor({ commissionPercentage: -5 }, null), 0, "a negative rate is clamped");
  eq(commissionRateFor({ commissionPercentage: 40, commissionByPayer: { axa: "abc" } }, "axa"), 40, "an unreadable entry falls back");

  // Clearing a cell removes the key; it does not store a zero. Those are different answers.
  eq(withCommissionRate({ axa: 25 }, "axa", null), {}, "clearing a rate removes it so the dentist inherits again");
  eq(withCommissionRate({ axa: 25 }, "axa", 0), { axa: 0 }, "typing zero stores zero");
  eq(withCommissionRate(null, "axa", 30), { axa: 30 }, "a first rate on an empty record");
  eq(withCommissionRate({ bad: "x" } as Record<string, unknown>, "axa", 30), { axa: 30 }, "junk already stored is dropped on write");
}

// --- 4. Rows recorded before any of this existed ----------------------------------------------
{
  eq(payerOf({}).payerId, PRIVATE_PAYER_ID, "an unstamped row counts as private");
  eq(payerOf({ payerId: "  " }).payerId, PRIVATE_PAYER_ID, "so does a blank one");
  eq(payerOf({ payerId: "axa", payerName: "AXA" }), { payerId: "axa", payerName: "AXA" }, "a stamped row reads back exactly");
}

// --- 5. The report adds up, and agrees with itself --------------------------------------------
{
  const payers = parsePayers({
    payers: [
      { id: PRIVATE_PAYER_ID, name: "Private", active: true, isDefault: true },
      { id: "axa", name: "AXA", active: true, isDefault: false },
      { id: "quiet", name: "Quiet Insurer", active: true, isDefault: false },
    ],
  });

  const procedures = [
    { type: "procedure", payerId: "axa", payerName: "AXA", patientId: "p1", doctorId: "d1", doctorName: "Omar", cost: 1000, labFee: 200 },
    { type: "procedure", payerId: "axa", payerName: "AXA", patientId: "p2", doctorId: "d1", doctorName: "Omar", cost: 2000, labFee: 0 },
    { type: "procedure", payerId: PRIVATE_PAYER_ID, payerName: "Private", patientId: "p1", doctorId: "d2", doctorName: "Hana", cost: 800, labFee: 0 },
    // No payer at all: the pre-payers world.
    { type: "procedure", patientId: "p3", doctorId: "d2", doctorName: "Hana", cost: 500, labFee: 0 },
  ];
  const payments = [
    { type: "payment", payerId: "axa", payerName: "AXA", patientId: "p1", doctorId: "d1", doctorName: "Omar", paid: 1000, doctorCommissionAmount: 200, doctorCommissionPercentage: 25 },
    { type: "payment", payerId: "axa", payerName: "AXA", patientId: "p2", doctorId: "d1", doctorName: "Omar", paid: 2000, doctorCommissionAmount: 500, doctorCommissionPercentage: 25 },
    { type: "payment", payerId: PRIVATE_PAYER_ID, payerName: "Private", patientId: "p1", doctorId: "d2", doctorName: "Hana", paid: 800, doctorCommissionAmount: 320, doctorCommissionPercentage: 40 },
    // An expense in the same period must not land in anybody's column.
    { type: "expense", amount: 5000, paid: 5000 },
    // Clinic income that belongs to no payer and no dentist.
    { type: "income", amount: 300, paid: 300 },
  ];

  const report = buildPayerReport(procedures, payments, payers);
  const axa = report.payers.find((p) => p.payerId === "axa")!;
  const priv = report.payers.find((p) => p.payerId === PRIVATE_PAYER_ID)!;

  eq(report.payers[0].payerId, PRIVATE_PAYER_ID, "Private leads the table — it is the column most people read");
  ok(
    report.payers.some((p) => p.payerId === "quiet"),
    "an insurer that sent nothing this month still gets a row, or the report reads as if it were never set up"
  );

  eq(axa.cases, 2, "AXA's case count");
  eq(axa.patients, 2, "AXA's distinct patients");
  eq(axa.charged, 3000, "AXA charged");
  eq(axa.collected, 3000, "AXA collected");
  eq(axa.labFees, 200, "AXA lab fees");
  eq(axa.commission, 700, "AXA commission");
  eq(axa.clinicNet, 2100, "AXA clinic net is collected less commission less lab");

  eq(priv.cases, 2, "the unstamped treatment is counted as private");
  eq(report.unstamped.procedures, 1, "and it is reported as unstamped rather than buried");
  eq(report.unstamped.payments, 0, "no payment here was unstamped");

  eq(
    report.totals.collected,
    3800,
    "an expense and a clinic income in the same period must not inflate what the payers brought in"
  );
  eq(report.totals.cases, 4, "every treatment is counted exactly once");
  eq(
    report.totals.patients,
    3,
    "a patient treated under two payers is one patient — summing the columns would count them twice"
  );
  eq(
    report.totals.collected,
    report.payers.reduce((n, p) => n + p.collected, 0),
    "the total has to be the sum of the columns, or nobody believes either"
  );
  eq(
    report.totals.clinicNet,
    report.payers.reduce((n, p) => n + p.clinicNet, 0),
    "and so does the net"
  );

  // The rate shown is the rate that actually paid.
  const omarOnAxa = axa.doctors.find((d) => d.doctorId === "d1")!;
  eq(omarOnAxa.ratePct, 25, "one rate all period reads as that rate");
  const mixed = buildPayerReport(
    [],
    [
      { type: "payment", payerId: "axa", doctorId: "d1", doctorName: "Omar", paid: 100, doctorCommissionAmount: 25, doctorCommissionPercentage: 25 },
      { type: "payment", payerId: "axa", doctorId: "d1", doctorName: "Omar", paid: 100, doctorCommissionAmount: 30, doctorCommissionPercentage: 30 },
    ],
    payers
  );
  eq(
    mixed.payers.find((p) => p.payerId === "axa")!.doctors[0].ratePct,
    null,
    "two rates in one period must read as null, not as one of them — a sheet printing a single number would describe neither half"
  );

  // --- the payroll view, which is the same figures turned inside out -------------------------
  const payroll = byDoctor(report);
  const omar = payroll.find((r) => r.doctorId === "d1")!;
  const hana = payroll.find((r) => r.doctorId === "d2")!;

  eq(omar.totalCommission, 700, "Omar's total is his AXA work");
  eq(omar.byPayer.axa.commission, 700, "and it is all under AXA");
  ok(!omar.byPayer[PRIVATE_PAYER_ID], "Omar has no private column this period, and shows a dash rather than a zero");
  eq(hana.totalCommission, 320, "Hana's total");
  eq(hana.byPayer[PRIVATE_PAYER_ID].cases, 2, "Hana's private cases include the unstamped one");
  eq(
    payroll.reduce((n, r) => n + r.totalCommission, 0),
    report.totals.commission,
    "the payroll view and the payer view must total the same, or the owner is holding two answers"
  );
}

// --- 6. An empty period says so rather than showing zeros -------------------------------------
{
  const empty = buildPayerReport([], [], parsePayers(null));
  eq(empty.totals.cases, 0, "no cases");
  eq(empty.totals.collected, 0, "no money");
  eq(byDoctor(empty).length, 0, "and nobody on the payroll sheet");
}

// --- 7. The wiring, which is what makes any of the above reach real money ---------------------
{
  const procedures = read("src/app/api/clinical/procedures/route.ts");
  ok(
    procedures.includes("payerForPriceList") && procedures.includes("payerStamp"),
    "the treatment route no longer derives the payer from the price list, so nothing would be stamped"
  );
  ok(
    procedures.includes("commissionRateFor(staff, payerId)"),
    "the treatment route is back on the dentist's single rate — insurance work would pay the private percentage"
  );
  // One control, not two. A "paid by" picker beside the price list is what billed an insurance
  // case at the clinic's own prices: both claimed the same decision and the list quietly won.
  const editor = read("src/components/clinical-notes/ServiceEditorDrawer.tsx");
  ok(!/payerId/.test(editor), "the treatment editor has a payer picker again — the price list is the only control");
  /**
   * The control has to be in BOTH layouts, and this is not a style point.
   *
   * `discountField` carries the price-list picker, and it was rendered only in the compact inline
   * form the tooth chart uses. The drawer — the one that opens from the patient's file and the
   * appointment panel, which is where the front desk records treatments — had no list control at
   * all, so every treatment taken there silently used the clinic's default. Once the list became
   * the insurer, that meant an insurance case charged at clinic prices and counted as private
   * revenue, with nothing on screen to say otherwise.
   */
  eq(
    (editor.match(/\{discountField\}/g) || []).length,
    2,
    "the price-list picker is missing from one of the two layouts — the front desk cannot choose an insurer"
  );
  ok(
    !/lockedByPayer/.test(read("src/components/shared/DiscountEditor.tsx")),
    "the price-list picker is being driven by something other than the receptionist again"
  );

  /**
   * The menu has to quote the price the case will actually be charged.
   *
   * Every row in the service picker printed `service.price` — the clinic's own rate — whatever
   * list was selected above it. Reported from the clinic: the AXA list chosen, the menu offering
   * "Orthodontic Consultation — EGP 300", and AXA's own price of 200 nowhere on screen. A number
   * you are choosing from that is not the number you are choosing is worse than no number.
   */
  const combobox = read("src/components/shared/ServiceCombobox.tsx");
  ok(
    /resolveListPrice\(service/.test(combobox),
    "the service picker prints the clinic's own price again, whatever list is selected"
  );
  /**
   * The appointment panel's quick-add is the fastest way to record a treatment, which makes it
   * the one the front desk actually uses — and it had no price list at all. It read the clinic's
   * own price, sent no list, and the server fell back to the default, so a treatment recorded
   * there could never be an insurance case however carefully the clinic was set up.
   */
  const moneyTab = read("src/components/appointments/AppointmentMoneyTab.tsx");
  ok(
    /priceListId: procListId/.test(moneyTab),
    "the appointment panel's quick-add sends no price list again — every treatment from the front desk is private"
  );
  ok(
    /resolveListPrice\(svc, procListId\)/.test(moneyTab),
    "the quick-add fills in the clinic's own price again, whatever list is chosen"
  );

  for (const [rel, label] of [
    ["src/components/BookingModal.tsx", "booking"],
    ["src/components/clinical-notes/ServiceEditorDrawer.tsx", "the treatment editor"],
    ["src/components/appointments/AppointmentMoneyTab.tsx", "the appointment panel"],
  ] as const) {
    ok(
      /priceListId=\{/.test(read(rel)),
      `${label} no longer tells the service picker which list is selected, so it quotes the wrong price`
    );
  }
  ok(
    !/defaultPayerId/.test(read("src/app/(dashboard)/patients/[id]/page.tsx")),
    "the patient record is predicting a payer again — the list chosen per treatment already says"
  );

  const sync = read("src/lib/server/ledgerSync.ts");
  ok(
    sync.includes("commissionRateFor"),
    "payments recompute commission from the dentist's flat rate again — a payment against an insurance case would pay the private percentage"
  );
  ok(
    /payerId = typeof procedure\.payerId/.test(sync),
    "the payment's rate is no longer chosen by the treatment's payer"
  );

  const write = read("src/lib/ledgerWrite.ts");
  ok(
    /payerId: procedure \? procedure\.payerId \|\| null : null/.test(write),
    "payments no longer carry the payer, so revenue by insurer cannot be answered from the ledger"
  );

  const ledger = read("src/app/api/finance/ledger/route.ts");
  ok(
    /payerId: typeof procedureData\.payerId/.test(ledger),
    "the payer must be carried from the treatment, never from the request — a payment screen must not be able to move revenue between an insurer and the clinic"
  );
  ok(
    !/body\.payerId/.test(ledger),
    "the payment route reads a payer off the request body, which would let a client re-bill a case"
  );

  const settings = read("src/config/settingsRegistry.ts");
  ok(/id: "payers"/.test(settings), "the payers screen is not registered, so nothing can be configured");
}

// --- 8. Who came from each insurer --------------------------------------------------------------
//
// "How many patients come from this insurance" is the owner's first question and "which ones" is
// always his second, so the names travel with the count.
{
  const payers = parsePayers({
    payers: [
      { id: PRIVATE_PAYER_ID, name: "Private", active: true, isDefault: true },
      { id: "axa", name: "AXA", active: true, isDefault: false },
    ],
  });
  // One visit, two payers: the scaling is covered, the filling is not. This is the case the
  // clinic described, and it is why a payer is a property of a treatment and not of a visit.
  const procedures = [
    { type: "procedure", payerId: "axa", patientId: "p1", patientName: "Mona", doctorId: "d1", cost: 600 },
    { type: "procedure", payerId: PRIVATE_PAYER_ID, patientId: "p1", patientName: "Mona", doctorId: "d1", cost: 800 },
    { type: "procedure", payerId: "axa", patientId: "p2", patientName: "Sara", doctorId: "d1", cost: 1000 },
  ];
  const payments = [
    { type: "payment", payerId: "axa", patientId: "p1", patientName: "Mona", doctorId: "d1", paid: 600, doctorCommissionAmount: 150 },
    { type: "payment", payerId: PRIVATE_PAYER_ID, patientId: "p1", patientName: "Mona", doctorId: "d1", paid: 800, doctorCommissionAmount: 320 },
    { type: "payment", payerId: "axa", patientId: "p2", patientName: "Sara", doctorId: "d1", paid: 1000, doctorCommissionAmount: 250 },
  ];

  const report = buildPayerReport(procedures, payments, payers);
  const axa = report.payers.find((p) => p.payerId === "axa")!;
  const priv = report.payers.find((p) => p.payerId === PRIVATE_PAYER_ID)!;

  eq(axa.patients, 2, "AXA saw two patients");

  // The dentist row names who the work was for, so the figure on it can be read without a tab
  // switch. Keyed by patient id, so one patient seen twice is one name.
  const omarOnAxa2 = axa.doctors.find((d) => d.doctorId === "d1")!;
  eq(omarOnAxa2.patients, ["Mona", "Sara"], "the dentist row lists the patients behind its figure");
  eq(
    priv.doctors.find((d) => d.doctorId === "d1")!.patients,
    ["Mona"],
    "and only the ones under THIS payer — the same visit's private half belongs to the private row"
  );
  eq(axa.patientList.map((x) => x.patientName), ["Sara", "Mona"], "the patient list is biggest first");
  eq(
    axa.patientList.find((x) => x.patientId === "p1")!.charged,
    600,
    "a patient with work under two payers shows only THIS payer's work against their name"
  );
  eq(
    priv.patientList.find((x) => x.patientId === "p1")!.charged,
    800,
    "and the rest of that same visit against the other payer"
  );
  eq(report.totals.patients, 2, "the same person in both columns is still one patient overall");
  eq(
    axa.patientList.reduce((n, x) => n + x.collected, 0),
    axa.collected,
    "the patient list must total the payer's own collected figure"
  );

  // A payment landing for a treatment from an earlier period still counts the money.
  const late = buildPayerReport(
    [],
    [{ type: "payment", payerId: "axa", patientId: "p9", patientName: "Late", paid: 500 }],
    payers
  );
  const lateAxa = late.payers.find((p) => p.payerId === "axa")!;
  eq(lateAxa.patientList.length, 1, "a payment with no treatment this period still names its patient");
  eq(lateAxa.patientList[0].cases, 0, "with no cases against them, because none were recorded in the period");
}

// --- 9. The two failures that reached production together --------------------------------------
{
  /**
   * A duplicated list id. The wizard derives the id from the payer ("payer-axa"), and a stale
   * screen appended a second entry under it instead of reusing the first. Prices on the services
   * are keyed by that id, so both entries claimed the same prices while every picker showed the
   * insurer twice. The parser now collapses duplicates, keeping the first, so the next save heals
   * the stored document rather than copying the damage forward.
   */
  const healed = parsePriceLists({
    lists: [
      { id: "standard", name: "Standard", active: true, isDefault: true },
      { id: "payer-axa", name: "AXA", active: true },
      { id: "payer-axa", name: "AXA", active: true },
    ],
  });
  eq(healed.filter((l) => l.id === "payer-axa").length, 1, "a duplicated list id collapses to one entry");
  eq(healed.length, 2, "and nothing else is lost");

  /**
   * Loaders that strip the overrides. Three screens loaded services as {id, name, price} — no
   * `prices` map — so an insurer's tariff could not reach the booking screen or the appointment
   * panel at all. The clinic updated AXA's prices repeatedly and watched its own prices instead,
   * and every UI fix upstream of this was correct but starved of data.
   */
  for (const rel of [
    "src/app/(dashboard)/appointments/page.tsx",
    "src/components/dashboard/DesktopDashboard.tsx",
    "src/components/dashboard/MobileDashboard.tsx",
  ]) {
    const text = read(rel);
    ok(
      !/name: d\.data\(\)\.name, price: d\.data\(\)\.price \}\)/.test(text),
      `${rel} loads services without their per-list prices again — the insurer's tariff cannot reach the screen`
    );
    ok(
      /prices: d\.data\(\)\.prices/.test(text),
      `${rel} must carry the prices map through to the pickers`
    );
  }
}

// --- 10. Every writer sends the list, or the payer is lost on the way ---------------------------
//
// The list is the payer. A screen that resolves the right PRICE but omits the list hands the
// server a number with no provenance — it falls back to the clinic default and files an insurance
// case as private revenue. That is not hypothetical: it is what the ledger showed after the
// pickers were fixed. A treatment charged at AXA's 150, stamped `priceListId: standard`,
// `payerId: private`. The cost survived the trip and the payer did not, which is the worst shape
// this bug can take, because the screen looks right and the report is wrong.
{
  const booking = read("src/components/BookingModal.tsx");
  ok(
    /sessionProcedures\?: \{[^}]*priceListId/.test(booking),
    "the booking modal drops priceListId from the payload it hands its caller — the cost travels and the payer does not"
  );

  const service = read("src/lib/bookingService.ts");
  ok(
    /priceListId: sp\.priceListId/.test(service),
    "bookingService writes staged treatments without their list, so a visit booked on an insurer files as private"
  );
  ok(
    /priceListId\?: string \| null/.test(service),
    "the staged-treatment type must carry the list, or the field is dropped before it is even read"
  );

  /**
   * Every caller of createProcedure has to name a list. Counted by file rather than asserted
   * once, because each new screen is a fresh chance to omit it — and omitting it is silent.
   */
  for (const rel of [
    "src/lib/bookingService.ts",
    "src/components/appointments/AppointmentMoneyTab.tsx",
  ]) {
    const text = read(rel);
    const calls = (text.match(/createProcedure\(/g) || []).length;
    const lists = (text.match(/priceListId:/g) || []).length;
    ok(
      calls === 0 || lists >= 1,
      `${rel} calls createProcedure without ever naming a price list — that treatment cannot belong to an insurer`
    );
  }
}

console.log(`payers: ${checks} checks passed`);
