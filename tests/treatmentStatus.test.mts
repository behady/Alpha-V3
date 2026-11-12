// Treatments by state: what is planned, in progress, and finished in a period.
//
// The failures that matter here are quiet ones:
//
//   - a crown finished this month but started last month counted in the wrong month, so the
//     owner's "done this month" is short and nobody can say why;
//   - a treatment continued into a second visit counted twice, or left "in progress" for ever
//     because the first card was never touched again;
//   - a patient with a visit booked shown on the list to phone, so reception calls somebody who
//     is already coming.
//
// Run with tsx: npm run test:treatment-status
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NO_TREATMENT_FILTERS,
  buildTreatmentStatus,
  dentistOptions,
  filterTreatments,
  inheritBranch,
  nextVisits,
  treatmentLabel,
} from "../src/lib/reports/treatmentStatus";

const REPO = join(import.meta.dirname, "..");
let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const NOVEMBER = { start: "2026-11-01", end: "2026-11-30" };
const TODAY = "2026-11-12";

const PATIENTS = [
  { id: "p1", name: "Mona Adel", phone: "01001234567" },
  { id: "p2", name: "Karim Said", phone: "01119876543" },
  { id: "p3", name: "أحمد علي", phone: "01200000000" },
];

const NOTES = [
  // Finished this month, started this month.
  { id: "n1", patientId: "p1", procedures: ["Filling"], tooth: "16", doctorId: "d1", doctor: "Omar", status: "Completed", date: "2026-11-03", completedDate: "2026-11-03", cost: 300 },
  // Started in October, marked done in November: November's.
  { id: "n2", patientId: "p1", procedures: ["Crown"], tooth: "26", doctorId: "d1", doctor: "Omar", status: "Completed", date: "2026-10-20", completedDate: "2026-11-10", cost: 1500 },
  // Finished in October, before the finish stamp existed: falls back to its own date, so not November's.
  { id: "n3", patientId: "p2", procedures: ["Scaling"], tooth: "Gen", doctorId: "d2", doctor: "Sara", status: "Completed", date: "2026-10-05", cost: 200 },
  // In progress this month.
  { id: "n4", patientId: "p2", procedures: ["Root canal"], tooth: "36", doctorId: "d2", doctor: "Sara", status: "Ongoing", date: "2026-11-08", cost: 900 },
  // Planned this month.
  { id: "n5", patientId: "p3", procedures: ["Implant"], tooth: "46", doctorId: "d1", doctor: "Omar", status: "Planned", date: "2026-11-11", cost: 8000 },
  // Planned in September and never started: older open work.
  { id: "n6", patientId: "p3", procedures: ["Whitening"], tooth: "Gen", doctorId: "d2", doctor: "Sara", status: "Planned", date: "2026-09-15", cost: 1200 },
  // A card from before states existed: not counted anywhere.
  { id: "n7", patientId: "p1", procedure: "Old note", date: "2026-11-02", cost: 50 },
  // Dated after the period: not this period's.
  { id: "n8", patientId: "p1", procedures: ["Veneer"], status: "Planned", date: "2026-12-02", cost: 4000 },
];

const AHEAD = [
  { id: "a1", patientId: "p2", date: "2026-11-20", status: "Confirmed" },
  { id: "a2", patientId: "p3", date: "2026-11-15", status: "Cancelled" },
];

const r = buildTreatmentStatus(NOTES, PATIENTS, AHEAD, NOVEMBER, TODAY);

// --- which month a treatment belongs to ---------------------------------------------------------
eq(r.totals.Completed, { count: 2, value: 1800 }, "done: the filling and the crown finished in November — the crown although it started in October");
eq(r.totals.Ongoing, { count: 1, value: 900 }, "in progress: the root canal");
eq(r.totals.Planned, { count: 1, value: 8000 }, "planned: the implant; December's veneer and September's whitening are not November's");
eq(r.older, { count: 1, value: 1200 }, "the September whitening is still open, and kept apart");
const crown = r.lines.find((l) => l.id === "n2")!;
eq(crown.date, "2026-11-10", "the crown is filed under the day it was finished, not the day it was started");
ok(!r.lines.some((l) => l.id === "n3"), "October's scaling is finished history, not on November's list");
ok(!r.lines.some((l) => l.id === "n7"), "a card with no state is not guessed at");
ok(!r.lines.some((l) => l.id === "n8"), "a card dated after the period is not in it");
eq(r.lines[r.lines.length - 1].id, "n6", "older open work sits after the period's lines");
eq(r.lines[0].id, "n5", "newest first");

// --- who the line is about ------------------------------------------------------------------------
eq([crown.patientName, crown.phone, crown.treatment, crown.tooth, crown.doctorName], ["Mona Adel", "01001234567", "Crown", "26", "Omar"], "name and phone come from the patient's file");
eq(r.lines.find((l) => l.id === "n6")!.tooth, "", "\"Gen\" is not a tooth");
eq(treatmentLabel({ id: "x", procedures: ["Filling", "Polish"] }), "Filling + Polish", "two treatments on one card are both named");
eq(treatmentLabel({ id: "x", serviceName: "Crown" }), "Crown", "the price-list name when nothing was typed");

// --- booked or not --------------------------------------------------------------------------------
eq(r.lines.find((l) => l.id === "n4")!.nextVisit, "2026-11-20", "Karim's root canal has a visit booked");
eq(r.lines.find((l) => l.id === "n5")!.nextVisit, "", "a cancelled visit is not a booking");
eq(crown.nextVisit, "", "finished work carries no next visit");
const visits = nextVisits(
  [
    { id: "1", patientId: "a", date: TODAY, status: "Confirmed" },
    { id: "2", patientId: "b", date: TODAY, status: "Completed" },
    { id: "3", patientId: "c", date: "2026-11-01", status: "Confirmed" },
    { id: "4", patientId: "d", date: "2026-12-01", status: "No Show" },
    { id: "5", patientId: "e", date: "2026-12-09", status: "Confirmed" },
    { id: "6", patientId: "e", date: "2026-11-25", status: "Pending" },
  ],
  TODAY,
);
eq([visits.get("a"), visits.get("b"), visits.get("c"), visits.get("d"), visits.get("e")], [TODAY, undefined, undefined, undefined, "2026-11-25"], "later today counts; already seen today, past, and no-show do not; the nearest visit wins");

// --- a treatment continued into a later visit is one treatment -----------------------------------
const CHAIN = [
  { id: "c1", patientId: "p1", procedures: ["Root canal"], tooth: "14", doctorId: "d1", doctor: "Omar", status: "Ongoing", date: "2026-10-28", cost: 900, branchId: "b1" },
  { id: "c2", patientId: "p1", procedures: ["Root canal"], tooth: "14", doctorId: "d1", doctor: "Omar", status: "Ongoing", date: "2026-11-04", cost: 0, isContinued: true, continuedFromNoteId: "c1" },
  { id: "c3", patientId: "p1", procedures: ["Root canal"], tooth: "14", doctorId: "d2", doctor: "Sara", status: "Completed", date: "2026-11-09", completedDate: "2026-11-09", cost: 0, isContinued: true, continuedFromNoteId: "c2" },
];
const chained = buildTreatmentStatus(CHAIN, PATIENTS, [], NOVEMBER, TODAY);
eq(chained.lines.length, 1, "three cards, one treatment");
eq(chained.totals.Completed, { count: 1, value: 900 }, "done, at the first card's price — the first card still says Ongoing and is not believed");
eq([chained.lines[0].id, chained.lines[0].date, chained.lines[0].doctorName], ["c1", "2026-11-09", "Sara"], "known by its first card, dated and signed by its last");
const open = buildTreatmentStatus(CHAIN.slice(0, 2), PATIENTS, [], NOVEMBER, TODAY);
eq([open.totals.Ongoing.count, open.older.count, open.lines[0].date], [1, 0, "2026-11-04"], "continued in November, so in progress THIS month although it began in October");
const orphan = buildTreatmentStatus([CHAIN[1]], PATIENTS, [], NOVEMBER, TODAY);
eq(orphan.lines.length, 1, "a continuation whose first card is not on hand still shows");
const branched = inheritBranch(CHAIN);
eq(branched.map((n) => (n as { branchId?: string }).branchId), ["b1", "b1", "b1"], "a continuation has no charge, so it takes the branch of the treatment it continues");
eq(inheritBranch([CHAIN[1]])[0], CHAIN[1], "and is left alone when there is nothing to take it from");

// --- filters ----------------------------------------------------------------------------------------
const none = NO_TREATMENT_FILTERS;
eq(filterTreatments(r.lines, none).length, 4, "older open work is hidden until asked for");
eq(filterTreatments(r.lines, { ...none, includeOlder: true }).length, 5, "and shown when asked");
eq(filterTreatments(r.lines, { ...none, state: "Completed" }).map((l) => l.id), ["n2", "n1"], "one state at a time");
eq(filterTreatments(r.lines, { ...none, doctorId: "d2" }).map((l) => l.id), ["n4"], "one dentist's work");
eq(filterTreatments(r.lines, { ...none, unbookedOnly: true, includeOlder: true }).map((l) => l.id), ["n5", "n6"], "the list to phone: open work, nothing booked — never finished work");
eq(filterTreatments(r.lines, { ...none, search: "احمد", includeOlder: true }).length, 2, "أحمد is found by احمد");
eq(filterTreatments(r.lines, { ...none, search: "0111 987" }).map((l) => l.id), ["n4"], "and a patient by part of the phone");
eq(dentistOptions(r.lines), [{ value: "d1", label: "Omar" }, { value: "d2", label: "Sara" }], "the dentists on the list, once each");

// --- the finish day is stamped where the state is written ----------------------------------------
const route = readFileSync(join(REPO, "src/app/api/clinical/procedures/route.ts"), "utf8");
ok(/completedDate/.test(route), "the procedures route stamps the finish day");
ok(/delete clone\.completedDate/.test(route), "and a continuation does not inherit one");

// --- it is on the Reports page ---------------------------------------------------------------------
const catalog = readFileSync(join(REPO, "src/lib/reports/catalog.ts"), "utf8");
const registry = readFileSync(join(REPO, "src/components/reports/registry.tsx"), "utf8");
ok(/id: "treatments"/.test(catalog) && /treatments: \{[^\n]*TreatmentStatusReport/.test(registry), "the tab is in the catalogue and drawn by the registry");

// --- a link from inside the app opens the report it names ----------------------------------------
// An in-app link renders the page before the address bar has moved; reading `?report=` on the first
// render opened the overview under the right address. The page mounts once the address is the new one.
const reportsPage = readFileSync(join(REPO, "src/app/(dashboard)/reports/page.tsx"), "utf8");
ok(/\{addressReady \? <ReportsPage \/> : null\}/.test(reportsPage), "the Reports page reads its address after an in-app link has landed");
const numbersCard = readFileSync(join(REPO, "src/components/dashboard/TreatmentNumbersCard.tsx"), "utf8");
ok(/report=treatments&preset=\$\{preset\}/.test(numbersCard), "and the home's numbers name the report and the period they were counted over");

console.log(`treatment status: ${checks} checks passed`);
