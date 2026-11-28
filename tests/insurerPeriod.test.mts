// Which treatments a company's Finance tab shows for the dates picked on the page.
//
// The promise to the clinic: a whole month on Finance is exactly that month's company sheet.
//
//   npm run test:insurer-period
import assert from "node:assert/strict";
import { buildCompanySheets, placeCharges, type SheetCard, type SheetCharge } from "../src/lib/insurance/companySheet";
import { chargeInPeriod } from "../src/lib/insurance/chargePeriod";

const charge = (id: string, patientId: string, date: string, noteId?: string): SheetCharge => ({
  id,
  type: "procedure",
  payerId: "gasco",
  patientId,
  patientName: patientId,
  date,
  amount: 100,
  clinicalNoteId: noteId,
});
const card = (id: string, status: string, date: string, completedDate?: string): SheetCard => ({ id, status, date, completedDate });

const charges = [
  charge("old", "p0", "2026-10-20"),                // before the sheets began: its own date
  charge("plain", "p1", "2026-11-05"),              // no card: done on its date
  charge("late", "p2", "2026-11-28", "n-late"),     // started November, finished December
  charge("open", "p3", "2026-11-10", "n-open"),     // not finished, nobody placed it
  charge("picked", "p4", "2026-11-12", "n-picked"), // not finished, placed on December by hand
  charge("rolled", "p5", "2026-11-15"),             // finished in November after November was sent
  charge("sent", "p6", "2026-11-03"),               // on November's sent list
];
const cards = [card("n-late", "Completed", "2026-11-28", "2026-12-04"), card("n-open", "In Progress", "2026-11-10"), card("n-picked", "Planned", "2026-11-12")];
const inputs = { charges, cards, months: { picked: "2026-12" }, sent: [{ month: "2026-11", chargeIds: ["sent", "plain"] }], payerId: "gasco" };
const placed = placeCharges(inputs);
const shown = (start: string, end: string) =>
  charges.filter((c) => chargeInPeriod(c, { start, end }, placed.get(String(c.id)))).map((c) => String(c.id)).sort();

// A whole month is that month's sheet, charge for charge.
const sheets = buildCompanySheets({ ...inputs, through: "2026-12" });
for (const sheet of sheets) {
  const [y, m] = sheet.month.split("-").map(Number);
  const end = `${sheet.month}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
  const onSheet = sheet.printed.flatMap((p) => p.charges.map((c) => String(c.id))).sort();
  assert.deepEqual(shown(`${sheet.month}-01`, end), onSheet, `month ${sheet.month}`);
}
assert.deepEqual(shown("2026-11-01", "2026-11-30"), ["plain", "sent"]);
assert.deepEqual(shown("2026-12-01", "2026-12-31"), ["late", "picked", "rolled"]);

// Before the sheets began: the treatment's own date.
assert.deepEqual(shown("2026-10-01", "2026-10-31"), ["old"]);
assert.deepEqual(shown("2026-10-21", "2026-10-31"), []);

// One day: a procedure finished that day; one placed on a month by hand, sent or rolled on shows on any day of that month.
assert.deepEqual(shown("2026-12-04", "2026-12-04"), ["late", "picked", "rolled"]);
assert.deepEqual(shown("2026-12-05", "2026-12-05"), ["picked", "rolled"]);
assert.deepEqual(shown("2026-11-05", "2026-11-05"), ["plain", "sent"]); // both on November's sent list

// Not finished and not placed: in no period.
assert.deepEqual(shown("2026-01-01", "2027-12-31").includes("open"), false);
assert.deepEqual(shown("2026-01-01", "2027-12-31"), ["late", "old", "picked", "plain", "rolled", "sent"]);

// No placement (an approval insurer, or the sheet could not be read): the treatment's own date.
const bare = charge("m1", "p9", "2026-11-28");
assert.equal(chargeInPeriod(bare, { start: "2026-11-01", end: "2026-11-30" }), true);
assert.equal(chargeInPeriod(bare, { start: "2026-12-01", end: "2026-12-31" }), false);
assert.equal(chargeInPeriod({ ...bare, date: "" }, { start: "2026-11-01", end: "2026-11-30" }), false);

console.log("insurer period: all assertions passed");
