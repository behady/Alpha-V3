// Lab case tracking. Run with tsx so the TS modules load directly. No network, no emulator.
//
// The rules worth pinning down here are the ones whose failure is invisible until a bag comes
// back and nobody can say whose it is: a code that reads the same as another code, a search that
// cannot find the number somebody wrote in marker, a due date that never turns red, and a printed
// order carrying a field the work type does not have — or, worse, a patient's full name.
import assert from "node:assert/strict";
import {
  BLEACH_SHADES,
  CLASSICAL_SHADES,
  DEFAULT_LAB_PAPER,
  TOOTH_SHADES,
  addDays,
  branchCodeFor,
  daysUntil,
  deriveBranchCode,
  dueStateFor,
  formatLabCode,
  isLabOrderPaper,
  matchesLabCode,
  nextStatuses,
  parseTeeth,
  statusFor,
  summarise,
  workTypeFor,
  optionLabel,
  RETENTION_OPTIONS,
} from "../src/lib/labCases.ts";
import {
  labPriceFor,
  labPricedCount,
  parseDentalLabs,
  parseLabPaper,
  serializeDentalLabs,
} from "../src/lib/dentalLabs.ts";
import { buildLabOrderSrcDoc } from "../src/lib/labOrderHtml.ts";
import { buildLabStatementSrcDoc } from "../src/lib/labStatementHtml.ts";
import {
  buildStatement,
  isBillable,
  labAccountFor,
  labAccountsTotal,
} from "../src/lib/labAccounts.ts";
import { parseClinicBranches } from "../src/lib/clinicLocations.ts";

// --- branch codes --------------------------------------------------------------------------------

assert.equal(deriveBranchCode("Maadi Branch"), "MAA");
assert.equal(deriveBranchCode("Nasr City"), "NAS");
// An explicit code always beats the derived one, normalised to letters and digits.
assert.equal(branchCodeFor({ name: "Maadi", code: "mad" }), "MAD");
assert.equal(branchCodeFor({ name: "Maadi", code: "M-A D!" }), "MAD");

// Egyptian clinics name branches in Arabic as often as not, and there is no Latin letter to take
// three of. Transliterating would invent a spelling the clinic never chose, so position wins.
assert.equal(deriveBranchCode("فرع مدينة نصر", 0), "B1");
assert.equal(deriveBranchCode("فرع المعادي", 1), "B2");
assert.equal(branchCodeFor({ name: "فرع المعادي" }, 1), "B2");

// A branch saved before lab tracking existed has no code at all and must still produce one.
assert.equal(branchCodeFor(null, 0), "B1");
assert.equal(branchCodeFor(undefined, 2), "B3");

// The code field survives a round trip through the branch sanitiser. If it did not, saving an
// unrelated branch edit would silently erase every clinic's prefixes — LocationsSettings writes
// back exactly what parseClinicBranches handed it.
const branches = parseClinicBranches({
  branches: [{ id: "b1", name: "Maadi", code: "mad", rooms: [] }],
});
assert.equal(branches[0].code, "MAD");

// --- code format ---------------------------------------------------------------------------------

assert.equal(formatLabCode("MAD", 1), "MAD-0001");
assert.equal(formatLabCode("MAD", 142), "MAD-0142");
assert.equal(formatLabCode("MAD", 12345), "MAD-12345");
// A remake keeps its own number and announces the round it is on.
assert.equal(formatLabCode("MAD", 142, 2), "MAD-0142-R2");
assert.equal(formatLabCode("MAD", 142, 1), "MAD-0142");
// A clinic with no branches configured still gets a usable prefix rather than a bare dash.
assert.equal(formatLabCode("", 7), "LAB-0007");

// --- searching by the number written on the bag --------------------------------------------------

// Nobody says "MAD-0142" out loud. They read "142" off a bag in marker.
assert.equal(matchesLabCode("MAD-0142", "142"), true);
assert.equal(matchesLabCode("MAD-0142", "0142"), true);
assert.equal(matchesLabCode("MAD-0142", "MAD-0142"), true);
assert.equal(matchesLabCode("MAD-0142", "mad"), true);
// Punctuation and spacing are noise on both sides.
assert.equal(matchesLabCode("MAD-0142", "mad 142"), true);
assert.equal(matchesLabCode("MAD-0142", "mad142"), true);
// A number typed without its padding still finds the case: "1" is not a substring of "MAD0001",
// but it is the same number.
assert.equal(matchesLabCode("MAD-0001", "1"), true);
// Deliberately a filter and not a scanner: a partial number narrows rather than empties the list,
// and a near miss costs a glance because every row prints its full code.
assert.equal(matchesLabCode("MAD-1420", "142"), true);
assert.equal(matchesLabCode("MAD-0142", "14"), true);
// But a number that is neither contained nor equal is not a match.
assert.equal(matchesLabCode("MAD-0142", "143"), false);
assert.equal(matchesLabCode("MAD-0142", "999"), false);
assert.equal(matchesLabCode("MAD-0142", "NSR"), false);
assert.equal(matchesLabCode("MAD-0142", ""), false);

// --- teeth ---------------------------------------------------------------------------------------

assert.deepEqual(parseTeeth("15, 14"), [15, 14]);
assert.deepEqual(parseTeeth("15 14"), [15, 14]);
// "Gen" is the magic string a clinical note carries when no tooth was picked. It is not empty,
// and printing it puts the word "Gen" on a lab order that goes to a technician.
assert.deepEqual(parseTeeth("Gen"), []);
assert.deepEqual(parseTeeth(""), []);
assert.deepEqual(parseTeeth(null), []);
// Primary teeth are real lab cases. The permanent-only filter used elsewhere drops them silently.
assert.deepEqual(parseTeeth("55, 54"), [55, 54]);
// Order is as entered, and duplicates collapse.
assert.deepEqual(parseTeeth("14, 15, 14"), [14, 15]);

// --- work types ----------------------------------------------------------------------------------

// A surgical guide has no shade of any kind. An order form that prints one is printing a blank.
const guide = workTypeFor("surgical_guide");
assert.equal(guide.toothShade, false);
assert.equal(guide.stumpShade, false);
assert.equal(guide.gumShade, false);
assert.equal(guide.implant, true);
// Nothing physical leaves the clinic for a guide — a scan and a CBCT go out as files.
assert.equal(guide.digitalByDefault, true);

// An implant crown without the system named is scrap metal to a technician.
assert.equal(workTypeFor("implant_crown").implant, true);
assert.equal(workTypeFor("implant_crown").toothShade, true);

// Dentures try in by default; a crown does not.
assert.equal(workTypeFor("full_denture").tryInByDefault, true);
assert.equal(workTypeFor("partial_denture").tryInByDefault, true);
assert.equal(workTypeFor("full_denture").gumShade, true);
assert.equal(workTypeFor("zirconia").tryInByDefault, false);
assert.equal(workTypeFor("zirconia").gumShade, false);

// An unknown id (an older record, a hand-edited document) must not crash a board that renders it.
assert.equal(workTypeFor("nonsense_type").id, "zirconia");
assert.equal(workTypeFor(undefined).id, "zirconia");

// --- shades --------------------------------------------------------------------------------------

// VITA classical is what Egyptian labs work to, and the bleach range leads because whitening
// cases ask for it first — a list that opens at A1 buries the shades those cases need.
assert.equal(TOOTH_SHADES[0], "BL1");
assert.equal(TOOTH_SHADES[BLEACH_SHADES.length], "A1");
assert.equal(CLASSICAL_SHADES.length, 16);
assert.equal(TOOTH_SHADES.length, 20);
assert.ok(TOOTH_SHADES.includes("A3.5"));
assert.ok(TOOTH_SHADES.includes("D4"));

// --- stages --------------------------------------------------------------------------------------

// A crown skips try-in entirely: one click from the lab to the clinic.
assert.ok(nextStatuses("at_lab", false).includes("back"));
assert.ok(!nextStatuses("at_lab", false).includes("tryin_back"));
// A denture can loop try-in as many times as it needs, so returning to the lab is never one-shot.
assert.ok(nextStatuses("at_lab", true).includes("tryin_back"));
assert.ok(nextStatuses("tryin_back", true).includes("returned_to_lab"));
assert.ok(nextStatuses("returned_to_lab", true).includes("tryin_back"));
// Fitted is not a dead end: a case can still come back for a remake.
assert.ok(nextStatuses("fitted", false).includes("returned_to_lab"));

// Only stages that mean "physically at the lab" can run late.
assert.equal(statusFor("at_lab").atLab, true);
assert.equal(statusFor("returned_to_lab").atLab, true);
assert.equal(statusFor("back").atLab, false);
assert.equal(statusFor("fitted").closed, true);
assert.equal(statusFor("cancelled").closed, true);

// --- due dates -----------------------------------------------------------------------------------

assert.equal(daysUntil("2026-09-01", "2026-08-27"), 5);
assert.equal(daysUntil("2026-08-25", "2026-08-27"), -2);

// addDays and daysUntil must be pure calendar arithmetic, identical in every timezone.
//
// This is not hypothetical. The first version parsed `${d}T00:00:00` — which, having no offset
// suffix, means LOCAL midnight — and then formatted with toISOString(), which is UTC. Everywhere
// east of Greenwich, including the Egypt this system is built for, that lost exactly one day:
// addDays("2026-08-27", 1) returned "2026-08-27". Every lab with a recorded turnaround got a due
// date a day early, so the board went amber and then red while the case was still inside the time
// the lab had actually been given. clinicDate.ts carries a comment about the same mistake being
// made once before, with attendance.
assert.equal(addDays("2026-08-27", 1), "2026-08-28");
assert.equal(addDays("2026-08-27", 7), "2026-09-03");
assert.equal(addDays("2026-08-27", 0), "2026-08-27");
assert.equal(addDays("2026-02-25", 4), "2026-03-01");
assert.equal(addDays("2026-12-30", 5), "2027-01-04");
assert.equal(addDays("2028-02-28", 1), "2028-02-29", "2028 is a leap year");
assert.equal(addDays("2026-09-03", -7), "2026-08-27");
// A malformed date is handed back untouched rather than printed as "Invalid Date" on an order.
assert.equal(addDays("not-a-date", 3), "not-a-date");
assert.equal(addDays("", 3), "");
assert.equal(daysUntil("bad", "2026-08-27"), null);

// The real proof: the same answers in timezones on both sides of UTC. Under the old implementation
// Tokyo and Cairo were wrong and New York was right, which is exactly why it survived being written
// on a machine west of Greenwich.
{
  const originalTz = process.env.TZ;
  const ZONES = ["Asia/Tokyo", "Africa/Cairo", "UTC", "America/New_York", "Pacific/Kiritimati"];

  // First prove the harness has teeth: local-time parsing MUST disagree across these zones. If it
  // does not, the runtime is ignoring TZ and the loop below would pass no matter what addDays did.
  const localMidnights = new Set(
    ZONES.map((tz) => {
      process.env.TZ = tz;
      return new Date("2026-08-27T00:00:00").toISOString();
    })
  );
  assert.ok(localMidnights.size > 1, "TZ switching had no effect — the checks below prove nothing");

  for (const tz of ZONES) {
    process.env.TZ = tz;
    assert.equal(addDays("2026-08-27", 1), "2026-08-28", `addDays differs in ${tz}`);
    assert.equal(addDays("2026-08-27", 7), "2026-09-03", `addDays differs in ${tz}`);
    assert.equal(addDays("2026-12-30", 5), "2027-01-04", `addDays differs in ${tz}`);
    assert.equal(daysUntil("2026-09-01", "2026-08-27"), 5, `daysUntil differs in ${tz}`);
    assert.equal(dueStateFor({ status: "at_lab", dueDate: "2026-08-28" }, "2026-08-27"), "due_soon", `dueStateFor differs in ${tz}`);
  }

  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

const today = "2026-08-27";
assert.equal(dueStateFor({ status: "at_lab", dueDate: "2026-08-25" }, today), "overdue");
assert.equal(dueStateFor({ status: "at_lab", dueDate: "2026-08-27" }, today), "due_today");
assert.equal(dueStateFor({ status: "at_lab", dueDate: "2026-08-29" }, today), "due_soon");
assert.equal(dueStateFor({ status: "at_lab", dueDate: "2026-09-30" }, today), "on_time");

// A case sitting on the reception desk waiting for the patient is a different problem with a
// different colour. Painting it red beside genuinely overdue work is how a board stops being read.
assert.equal(dueStateFor({ status: "back", dueDate: "2026-08-01" }, today), "none");
assert.equal(dueStateFor({ status: "fitted", dueDate: "2026-08-01" }, today), "none");
// No due date means nothing to be late for, not "late".
assert.equal(dueStateFor({ status: "at_lab" }, today), "none");

// --- the three counts ----------------------------------------------------------------------------

const board = [
  { status: "at_lab", dueDate: "2026-08-20" },   // overdue
  { status: "at_lab", dueDate: "2026-08-28" },   // due soon
  { status: "at_lab", dueDate: "2026-12-01" },   // far off
  { status: "back", dueDate: "2026-08-10" },     // waiting for the patient
  { status: "back" },                            // waiting for the patient
  { status: "fitted", dueDate: "2026-08-01" },   // done
];
const counts = summarise(board, today);
assert.equal(counts.overdue, 1);
assert.equal(counts.dueThisWeek, 1);
// The count worth having: finished work in a drawer nobody has called the patient about.
assert.equal(counts.waitingForPatient, 2);
assert.equal(counts.atLab, 3);
assert.equal(counts.total, 6);

// --- the labs directory --------------------------------------------------------------------------

assert.deepEqual(parseDentalLabs(null), []);
assert.deepEqual(parseDentalLabs({ labs: "not a list" }), []);
// A lab with no name is not a lab; it would render as a blank row in the picker.
assert.equal(parseDentalLabs({ labs: [{ id: "l1" }] }).length, 0);
assert.equal(parseDentalLabs({ labs: [{ name: "No id" }] }).length, 0);

const labs = parseDentalLabs({
  labs: [
    { id: "l1", name: "Cairo Lab", turnaroundDays: "5" },
    { id: "l2", name: "Zero Lab", turnaroundDays: 0 },
    { id: "l3", name: "Junk Lab", turnaroundDays: "abc" },
  ],
});
assert.equal(labs[0].turnaroundDays, 5);
// Zero would read as "same day" and make every case due the moment it was raised. An empty field
// means "we never recorded one", which is not the same claim.
assert.equal(labs[1].turnaroundDays, undefined);
assert.equal(labs[2].turnaroundDays, undefined);

// Nothing that reaches Firestore may carry `undefined`. The browser SDK rejects such a write
// outright, and because DentalLabsSettings round-trips this list straight back through setDoc, a
// single lab with no turnaround would have made the whole screen permanently unsavable — with an
// error that reads exactly like a permissions problem.
for (const lab of labs) {
  assert.ok(!("turnaroundDays" in lab) || typeof lab.turnaroundDays === "number",
    `sanitised lab must omit turnaroundDays rather than set it undefined: ${JSON.stringify(lab)}`);
}
for (const row of serializeDentalLabs([
  { id: "l1", name: "Cairo Lab", turnaroundDays: undefined, phone: undefined, notes: "x" },
  { id: "l2", name: "Second", turnaroundDays: 5 },
])) {
  for (const [k, v] of Object.entries(row)) {
    assert.notEqual(v, undefined, `serializeDentalLabs left ${k} undefined`);
  }
}
assert.equal(serializeDentalLabs([{ id: "l2", name: "Second", turnaroundDays: 5 }])[0].turnaroundDays, 5);

// --- per-lab price lists -------------------------------------------------------------------------

// The point of a price PER LAB: the clinic's own estimatedLabFee is one number for every lab, so
// it cannot know that one charges 600 for a crown and another 750. This can.
const priced = parseDentalLabs({
  labs: [
    {
      id: "l1",
      name: "Cairo Lab",
      prices: {
        zirconia: 600,
        emax: "750",          // a string from an old document still counts
        full_denture: 0,      // cleared: not priced, NOT free
        pfm: -50,             // nonsense
        unicorn_crown: 900,   // a work type that does not exist
      },
    },
    { id: "l2", name: "Nile Lab", prices: { zirconia: 750 } },
    { id: "l3", name: "Unpriced Lab" },
  ],
});

assert.equal(labPriceFor(priced[0], "zirconia"), 600);
assert.equal(labPriceFor(priced[0], "emax"), 750);
assert.equal(labPriceFor(priced[1], "zirconia"), 750, "the same work costs different money at different labs");
// An empty box means "we have never agreed a price", which is a different claim from "free". If
// this returned 0 the order would fill in as costing nothing.
assert.equal(labPriceFor(priced[0], "full_denture"), null);
assert.equal(labPriceFor(priced[0], "pfm"), null);
assert.equal(labPriceFor(priced[0], "night_guard"), null);
assert.equal(labPriceFor(priced[2], "zirconia"), null, "a lab with no price list at all");
assert.equal(labPriceFor(null, "zirconia"), null);
assert.equal(labPriceFor(priced[0], ""), null);
// A work type that no longer exists is dropped rather than carried forever, invisible in the
// settings screen and impossible to remove.
assert.ok(!("unicorn_crown" in (priced[0].prices || {})));
assert.equal(labPricedCount(priced[0]), 2);
assert.equal(labPricedCount(priced[2]), 0);

// A lab priced for nothing carries no empty object around.
assert.ok(!("prices" in priced[2]), "an unpriced lab should omit the key entirely");

// And nothing nested reaches Firestore as undefined — clearing a price box is the obvious way to
// produce one, and a nested undefined rejects the write exactly as a top-level one does.
const serializedPrices = serializeDentalLabs([
  { id: "l1", name: "Cairo Lab", prices: { zirconia: 600, emax: undefined, pfm: 0 } },
  { id: "l2", name: "Bare", prices: {} },
]);
assert.deepEqual(serializedPrices[0].prices, { zirconia: 600 });
assert.ok(!("prices" in serializedPrices[1]), "an emptied price table is dropped, not written as {}");
for (const row of serializedPrices) {
  for (const v of Object.values(row.prices || {})) assert.equal(typeof v, "number");
}

// --- option ids, not translated labels -----------------------------------------------------------

// These selects store the id. Storing the visible label meant a case raised in Arabic showed an
// empty box when reopened in English — and an empty controlled select displays its first option
// while holding nothing, so the form looked complete and saved blank.
assert.equal(optionLabel(RETENTION_OPTIONS, "screw", "en"), "Screw-retained");
assert.equal(optionLabel(RETENTION_OPTIONS, "screw", "ar"), "بمسمار");
assert.equal(optionLabel(RETENTION_OPTIONS, "", "en"), "");
// A value written before ids were stored is printed as it stands rather than blanked.
assert.equal(optionLabel(RETENTION_OPTIONS, "Screw-retained", "en"), "Screw-retained");

// Paper falls back rather than throwing: an old settings document must not stop an order printing.
assert.equal(parseLabPaper(null), DEFAULT_LAB_PAPER);
assert.equal(parseLabPaper({ paper: "a5" }), "a5");
assert.equal(parseLabPaper({ paper: "foolscap" }), DEFAULT_LAB_PAPER);
assert.equal(isLabOrderPaper("a4_two_up"), true);
assert.equal(isLabOrderPaper("legal"), false);

// --- the printed order ---------------------------------------------------------------------------

const clinic = { name: "Alpha Dental", phone: "0100", address: "Maadi", branchName: "Maadi Branch" };
// The layout takes rendered logo markup, not a Firebase-backed asset — which is what keeps this
// module importable without a browser or a clinic.
const noLogo = "";

const crown = {
  id: "c1",
  code: "MAD-0142",
  codeNumber: 142,
  branchCode: "MAD",
  branchId: "b1",
  branchName: "Maadi Branch",
  patientName: "Ahmed Fathy Mahmoud",
  patientFirstName: "Ahmed",
  doctorName: "Dr. Sara",
  labId: "l1",
  labName: "Cairo Lab",
  workType: "zirconia",
  workDescription: "2 x full crown",
  units: 2,
  teeth: [15, 14],
  toothShade: "A2",
  stumpShade: "ND3",
  agreedPrice: 1400,
  sentVia: "driver",
  status: "at_lab",
  needsTryIn: false,
  dueDate: "2026-09-01",
  notes: "Light contact distal on 15.",
};

const crownHtml = buildLabOrderSrcDoc(crown, clinic, "data:image/png;base64,AAA", noLogo, "en", "a4_two_up");

// The code is on the paper, and so is the QR of it.
assert.ok(crownHtml.includes("MAD-0142"));
assert.ok(crownHtml.includes("data:image/png;base64,AAA"));
// The whole point of this feature: the first name goes, the full name stays in the building.
assert.ok(crownHtml.includes("Ahmed"));
assert.ok(!crownHtml.includes("Ahmed Fathy Mahmoud"));
// The fields a crown has.
assert.ok(crownHtml.includes("A2"));
assert.ok(crownHtml.includes("ND3"));
assert.ok(crownHtml.includes("1,400 EGP"));
// A driver signs for it.
assert.ok(crownHtml.includes("Driver signature"));
// Two-up is one sheet cut in half, not two @page rules, so the body appears twice on one A4.
assert.equal((crownHtml.match(/MAD-0142/g) || []).length >= 4, true);
assert.ok(crownHtml.includes("size: A4 portrait"));
assert.ok(crownHtml.includes("cut here"));
// The chart marks the ordered teeth and shows the rest for context.
assert.ok(crownHtml.includes(">15<"));
assert.ok(crownHtml.includes(">28<"));

// A guide is a different piece of paper entirely.
const guideCase = {
  ...crown,
  code: "MAD-0143",
  workType: "surgical_guide",
  toothShade: "A2",
  stumpShade: "ND3",
  guideType: "Fully guided",
  implantSystem: "Dentium",
  sentVia: "digital",
  agreedPrice: 0,
};
const guideHtml = buildLabOrderSrcDoc(guideCase, clinic, "", noLogo, "en", "a4_full");

// Even though a shade is stored on the record, a guide never prints one — the work type decides.
assert.ok(!guideHtml.includes("ND3"));
assert.ok(guideHtml.includes("Dentium"));
assert.ok(guideHtml.includes("Fully guided"));
// Nothing was handed to anybody, so there is no line for anybody to sign. A signature box nobody
// can fill in trains people to ignore the ones that matter.
assert.ok(!guideHtml.includes("Driver signature"));
assert.ok(guideHtml.includes("Sent as digital files"));
// A price of zero is not printed as "0 EGP".
assert.ok(!guideHtml.includes("EGP"));
assert.ok(guideHtml.includes("size: A4 portrait"));

// A5 is its own sheet size.
assert.ok(buildLabOrderSrcDoc(crown, clinic, "", noLogo, "en", "a5").includes("size: A5 portrait"));

// A remake says so on the paper, and names what it replaces.
const remake = { ...crown, code: "MAD-0144-R2", remakeOfId: "c1", remakeOfCode: "MAD-0142", remakeReason: "Shade too dark", remakeRound: 2 };
const remakeHtml = buildLabOrderSrcDoc(remake, clinic, "", noLogo, "en", "a4_full");
assert.ok(remakeHtml.includes("REMAKE"));
assert.ok(remakeHtml.includes("MAD-0142"));
assert.ok(remakeHtml.includes("Shade too dark"));

// Anything a human typed is escaped before it reaches the page.
const nasty = { ...crown, notes: '<script>alert("x")</script>', patientFirstName: "A&B" };
const nastyHtml = buildLabOrderSrcDoc(nasty, clinic, "", noLogo, "en", "a4_full");
assert.ok(!nastyHtml.includes("<script>"));
assert.ok(nastyHtml.includes("&lt;script&gt;"));
assert.ok(nastyHtml.includes("A&amp;B"));

// A case with no teeth says so rather than printing an empty chart.
const general = { ...crown, teeth: [] };
assert.ok(buildLabOrderSrcDoc(general, clinic, "", noLogo, "en", "a4_full").includes("No specific teeth"));

console.log(
  "✓ lab cases: codes, bag-number search, teeth, 12 work types, 20 VITA shades, stages, due dates, board counts, labs directory, per-lab price lists, and the printed order in 3 paper sizes"
);

// --- lab accounts: what the clinic owes ----------------------------------------------------------
//
// The single rule this section exists to protect: a lab payment is NOT a new expense. The lab fee
// was booked against profit the moment the treatment was saved, so paying the lab settles a debt
// already recorded. Nothing here touches the ledger, and if that ever changes these totals will be
// the only place the double-count is visible.

const acctCases = [
  // Delivered: you have the work, so you owe for it.
  { id: "1", labId: "L1", status: "back", agreedPrice: 600 },
  { id: "2", labId: "L1", status: "fitted", agreedPrice: 750 },
  // Still out: committed, not yet a debt.
  { id: "3", labId: "L1", status: "at_lab", agreedPrice: 400 },
  { id: "4", labId: "L1", status: "returned_to_lab", agreedPrice: 300 },
  { id: "5", labId: "L1", status: "tryin_back", agreedPrice: 200 },
  // Never left, or called off. Owed nothing either way.
  { id: "6", labId: "L1", status: "draft", agreedPrice: 900 },
  { id: "7", labId: "L1", status: "cancelled", agreedPrice: 900 },
  // Another lab entirely.
  { id: "8", labId: "L2", status: "fitted", agreedPrice: 1000 },
  // Delivered with no price agreed — deliberately NOT counted, and surfaced separately.
  { id: "9", labId: "L1", status: "back", agreedPrice: 0 },
  // A remake the lab owned: real work, no charge.
  { id: "10", labId: "L1", status: "fitted", agreedPrice: 0, remakeOfId: "1", remakeFault: "lab" },
];
const acctPayments = [
  { id: "p1", labId: "L1", amount: 500, date: "2026-08-10", method: "cash" },
  { id: "p2", labId: "L1", amount: 200, date: "2026-08-20", method: "transfer" },
  { id: "p3", labId: "L2", amount: 1000, date: "2026-08-21", method: "cash" },
];

const l1 = labAccountFor("L1", "Cairo Lab", acctCases, acctPayments);
assert.equal(l1.delivered, 1350, "only back + fitted count as owed");
assert.equal(l1.deliveredCount, 4, "two priced, one unpriced, one free remake");
assert.equal(l1.committed, 900, "at_lab + returned_to_lab + tryin_back");
assert.equal(l1.committedCount, 3);
assert.equal(l1.paid, 700);
assert.equal(l1.outstanding, 650);
assert.equal(l1.remakesTotal, 1);
assert.equal(l1.remakesAtLabCost, 1);

// One lab's cases never total against another lab's payments.
const l2 = labAccountFor("L2", "Nile Lab", acctCases, acctPayments);
assert.equal(l2.delivered, 1000);
assert.equal(l2.paid, 1000);
assert.equal(l2.outstanding, 0);

// Paying ahead reads as a negative balance rather than being clamped to zero — the clinic is owed.
assert.equal(
  labAccountFor("L2", "Nile Lab", acctCases, [...acctPayments, { id: "p4", labId: "L2", amount: 250, date: "2026-08-22", method: "cash" }]).outstanding,
  -250
);

assert.equal(isBillable({ status: "back" }), true);
assert.equal(isBillable({ status: "fitted" }), true);
assert.equal(isBillable({ status: "at_lab" }), false);
assert.equal(isBillable({ status: "cancelled" }), false);
assert.equal(isBillable({ status: "draft" }), false);

// The count that explains why a total and a lab's invoice disagree, before anyone assumes a bug.
const totals = labAccountsTotal([l1, l2], acctCases);
assert.equal(totals.delivered, 2350);
assert.equal(totals.outstanding, 650);
assert.equal(totals.unpriced, 2, "the unpriced delivery and the free remake both lack a price");

// --- the statement -------------------------------------------------------------------------------

// Deliveries and payments interleave by date with a running balance, because that is how a lab
// reads its own book — not two columns neither side can reconcile.
const stmt = buildStatement(
  "L1",
  [
    { id: "1", labId: "L1", status: "back", agreedPrice: 600, code: "MAD-0001", receivedAt: "2026-08-05", patientFirstName: "Ahmed", workType: "zirconia", teeth: [] },
    { id: "2", labId: "L1", status: "fitted", agreedPrice: 750, code: "MAD-0002", receivedAt: "2026-08-15", patientFirstName: "Mona", workType: "emax", teeth: [] },
  ],
  [{ id: "p1", labId: "L1", amount: 500, date: "2026-08-10", method: "cash" }],
  () => "work"
);
assert.equal(stmt.lines.length, 3);
assert.deepEqual(stmt.lines.map((l) => l.balance), [600, 100, 850]);
assert.equal(stmt.closing, 850);
assert.equal(stmt.closing, 1350 - 500, "closing balance is delivered minus paid");

// The printed sheet carries the figures and says out loud what is missing from them.
const sheet = buildLabStatementSrcDoc({
  clinicName: "Alpha Dental",
  clinicPhone: "0100",
  account: l1,
  lines: stmt.lines,
  closing: stmt.closing,
  unpricedCount: 2,
  generatedOn: "2026-08-27",
  language: "en",
});
assert.ok(sheet.includes("Cairo Lab"));
assert.ok(sheet.includes("850"));
assert.ok(sheet.includes("MAD-0001"));
assert.ok(sheet.includes("size: A4 portrait"));
assert.ok(sheet.includes("2 delivered case(s) carry no agreed price"), "the disagreement is explained on the page");
// Nothing a human typed reaches the page unescaped.
assert.ok(
  !buildLabStatementSrcDoc({
    clinicName: '<script>x</script>', clinicPhone: "", account: l1, lines: [], closing: 0,
    unpricedCount: 0, generatedOn: "2026-08-27", language: "en",
  }).includes("<script>")
);

console.log("✓ lab accounts: what is owed vs merely committed, per-lab isolation, and a statement that reconciles");
