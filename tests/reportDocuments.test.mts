// The phone's reports: every catalogue entry builds a document from the same rows the website uses.
//
// The phone draws what lib/reports/documents hands it, so the failure that matters is a report that
// throws, comes back empty when the rows say otherwise, or names a figure in the wrong language.
// Every report is built twice, in both languages, over one fixture; a handful are checked for the
// figures a person would read first.
//
// Run with tsx: npm run test:report-docs
import assert from "node:assert/strict";
import { REPORT_CATALOG } from "../src/lib/reports/catalog";
import { buildDrillDoc, buildReportDoc, type ReportInputs } from "../src/lib/reports/documents";

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const range = { start: "2026-09-01", end: "2026-09-30" };
const procedures = [
  { id: "c1", type: "procedure", patientId: "p1", patientName: "Mona Adel", doctorName: "Dr. Omar", serviceId: "svc-crown", serviceName: "Crown", cost: 1500, labFee: 400, discountAmount: 100, listPrice: 1600, normDate: "2026-09-05", date: "2026-09-05", payerId: "ins-1", payerName: "AXA" },
  { id: "c2", type: "procedure", patientId: "p2", patientName: "Karim Said", doctorName: "Sara", serviceId: "svc-fill", serviceName: "Filling", cost: 300, normDate: "2026-09-12", date: "2026-09-12" },
];
const payments = [
  { id: "y1", type: "payment", patientId: "p1", patientName: "Mona Adel", doctorName: "Omar", doctorId: "s1", procedureId: "c1", paid: 1500, doctorCommissionAmount: 300, method: "Visa", normDate: "2026-09-05", date: "2026-09-05", createdAt: "2026-09-05T14:30:00", payerId: "ins-1", payerName: "AXA" },
  { id: "e1", type: "expense", cost: 5000, category: "Rent", isRecurring: true, description: "Rent", normDate: "2026-09-01", date: "2026-09-01" },
];
const allPatients = [
  { id: "p1", name: "Mona Adel", phone: "01001234567", referral: "Instagram", gender: "Female", dateOfBirth: "1990-01-01", createdAt: "2026-09-02" },
  { id: "p2", name: "Karim Said", phone: "01119876543", source: "whatsapp_bot", gender: "Male", age: 8, createdAt: "2025-01-01" },
];
const leads = [{ id: "l1", name: "Hana", phone: "0100", source: "Instagram", stage: "won", patientId: "p1", normDate: "2026-09-03", createdAt: "2026-09-03" }];
const data = {
  ledgerPrev: [{ id: "z", type: "payment", patientId: "p9", serviceId: "svc-crown", serviceName: "Crown", paid: 1000, normDate: "2026-08-10", date: "2026-08-10" }],
  ledgerLastYear: [],
  ledgerMonths12: [...procedures, ...payments],
  ledgerAll: [...procedures, ...payments],
  appointments: [{ id: "a", status: "Completed", date: "2026-09-05", time: "10:00 AM", doctorName: "Omar", duration: 30, patientId: "p1" }, { id: "b", status: "No Show", date: "2026-09-06", doctorName: "Omar" }],
  appointmentsWide: [{ id: "a", status: "Completed", date: "2026-09-05", patientId: "p1" }],
  treatmentPlans: [{ id: "t1", patientId: "p1", patientName: "Mona Adel", status: "accepted", total: 3000, doctorName: "Sara", createdAt: "2026-08-01", steps: [{ serviceId: "svc-crown" }] }],
  labCases: [{ id: "l1", status: "at_lab", labId: "L1", labName: "Smile Lab", agreedPrice: 700, sentAt: "2026-09-10", dueDate: "2026-09-20", workType: "emax", code: "MAD-2", patientName: "Mona" }],
  labPayments: [],
  inventory: [{ id: "i1", name: "Gloves", category: "Consumables", stock: 5, minStock: 10, costPerUnit: 50, unit: "box" }],
  inventoryTx: [{ id: "x", itemId: "i1", change: -3 }],
  staff: [{ id: "s1", name: "Omar", role: "Dentist" }],
  punches: [],
  conversations: [{ id: "2010", outcome: "booked", lastMessageAt: new Date("2026-09-05T10:00:00").getTime() }],
  whatsappLogs: [{ id: "w", type: "appointment_reminder24h", status: "success" }],
  smsOutbox: [],
  recallSettings: [{ id: "recall", intervalMonths: 6, configured: true }],
};
const payroll = [{ staffId: "s1", name: "Omar", role: "Dentist", hasSchedule: true, daysWorked: 20, minutesWorked: 9600, lateMinutes: 30, lateDays: 2, absentDays: 0, overtimeApprovedMinutes: 0, overtimePendingMinutes: 0, estimatedPay: 8000 }];

const inputs = (lang: "en" | "ar"): ReportInputs => ({
  procedures, payments, allPatients, leads, range, today: "2026-09-27", lang,
  payers: [{ id: "ins-1", name: "AXA", type: "insurance" } as unknown as ReportInputs["payers"][number]],
  data: data as unknown as ReportInputs["data"],
  payroll,
});

// --- every report, both languages, never throws and never comes back nameless ---------------------------
for (const meta of REPORT_CATALOG) {
  for (const lang of ["en", "ar"] as const) {
    const doc = buildReportDoc(meta.id, inputs(lang));
    eq(doc.id, meta.id, `${meta.id}/${lang}: keeps its id`);
    eq(doc.title, lang === "ar" ? meta.ar : meta.en, `${meta.id}/${lang}: titled in the language asked for`);
    ok(doc.figures.length > 0 || doc.sections.length > 0, `${meta.id}/${lang}: says something`);
    ok(doc.figures.every((f) => f.label && f.value !== undefined), `${meta.id}/${lang}: every figure has a label and a value`);
    for (const s of doc.sections) {
      if (s.type === "table") ok(s.columns.length > 0, `${meta.id}/${lang}: a table has columns`);
      if (s.type === "bars") ok(s.rows.every((r) => typeof r.value === "number"), `${meta.id}/${lang}: bars are numbers`);
    }
  }
}

// --- the figures a person reads first ---------------------------------------------------------------
const clinic = buildReportDoc("clinic", inputs("en"));
eq(clinic.figures[0], { label: "Total income", value: "1,500 EGP", tone: undefined }, "overview: income off the payment");
const newBar = clinic.sections.find((s) => s.type === "bars")!;
ok(newBar.type === "bars" && newBar.rows[0].drill === "new" && newBar.rows[0].value === 1, "overview: Mona's file was opened in September, so she is the one new patient, and the bar opens to her");

const compare = buildReportDoc("compare", inputs("en"));
ok(compare.figures[0].delta?.text.includes("50%"), "vs previous: income rose from 1,000 to 1,500, a 50% rise");
ok(!compare.figures[0].delta?.bad, "and a rise in income is not red");

const pnl = buildReportDoc("pnl", inputs("en"));
const statement = pnl.sections.find((s) => s.type === "statement")!;
ok(statement.type === "statement" && statement.lines[statement.lines.length - 1].value === 1500 - 400 - 300 - 5000, "P&L: net = income − lab − commissions − expenses");

const payers = buildReportDoc("payers", inputs("ar"));
eq(payers.title, "التأمين وجهات الدفع", "payers: Arabic title");
const payerTable = payers.sections.find((s) => s.type === "table")!;
ok(payerTable.type === "table" && payerTable.rows.some((r) => r.payer === "AXA" && r._drill === "payer:ins-1"), "payers: AXA's row opens to its patients");

const cases = buildReportDoc("cases", inputs("en"));
const sheet = cases.sections.find((s) => s.type === "table")!;
ok(sheet.type === "table" && sheet.rows.length === 2 && sheet.rows.find((r) => r.patient === "Karim Said")?._bad === true && sheet.rows.find((r) => r.patient === "Mona Adel")?._bad === false, "case sheet: Karim's filling is unpaid, so red; Mona's crown is paid");

const att = buildReportDoc("attendance", { ...inputs("en"), payroll: null });
ok(att.figures.length === 0 && att.sections[0].type === "note", "attendance without HR access says so instead of showing wages");

// --- drilling into a figure ---------------------------------------------------------------------------
const crown = buildDrillDoc("service", "service:svc-crown", inputs("en"));
ok(crown.type === "table" && crown.rows.length === 1 && crown.rows[0]._patientId === "p1" && crown.rows[0].paid === 1500, "service drill: the crown's one patient, with what she paid");
const omar = buildDrillDoc("dentist", "dentist:Omar", inputs("en"));
ok(omar.type === "table" && omar.rows.length === 1 && omar.rows[0].name === "Mona Adel", "dentist drill: Dr. Omar's one patient");
const insta = buildDrillDoc("source", "source:Instagram", inputs("ar"));
ok(insta.type === "table" && insta.title.startsWith("المرضى") && insta.rows.length === 1, "source drill in Arabic");
const returning = buildDrillDoc("clinic", "returning", inputs("en"));
ok(returning.type === "table" && returning.rows.length === 1 && returning.rows[0].name === "Karim Said", "returning drill: Karim's file predates the period");
const leadsDrill = buildDrillDoc("leads", "leads:Instagram", inputs("en"));
ok(leadsDrill.type === "table" && leadsDrill.rows[0].stage === "In the chair", "leads drill: the won lead, with its stage in words");
const srcDoc = buildReportDoc("incomeSources", inputs("en"));
ok(srcDoc.figures[0].value === "1,500 EGP" && srcDoc.figures[0].delta?.text.startsWith("▲ 50%"), "income sources: 1,500 now against 1,000 before, up 50%");
const byTreatment = srcDoc.sections.find((s) => s.type === "bars" && s.title === "By treatment");
ok(byTreatment?.type === "bars" && byTreatment.rows[0].label.startsWith("Crown") && byTreatment.rows[0].value === 1500, "income sources: the crown is the top treatment");
const newness = srcDoc.sections.find((s) => s.type === "bars" && s.title === "New or returning");
ok(newness?.type === "bars" && newness.rows[0].label.startsWith("New patients") && newness.rows[0].text.includes("100%"), "income sources: Mona's file opened in September, so all of it is new-patient money");
const srcAr = buildReportDoc("incomeSources", inputs("ar"));
ok(srcAr.sections.some((s) => s.type === "bars" && s.rows.some((r) => r.label.startsWith("مرضى جدد"))), "income sources: the newness labels follow the language");

const trendDoc = buildReportDoc("expenseTrend", inputs("en"));
ok(trendDoc.figures[0].value === "5,000 EGP" && trendDoc.figures[0].delta?.pct === null, "expense comparison: 5,000 this period, nothing before, so the delta is 'new'");
const matrix = trendDoc.sections.find((s) => s.type === "table" && s.title === "Every category, month by month");
ok(matrix?.type === "table" && matrix.columns.length === 15 && matrix.rows[0].category === "Rent" && matrix.rows[0].m11 === 5000 && matrix.rows[0].total === 5000, "expense comparison: category × twelve months, rent in the last column");
ok(matrix?.type === "table" && matrix.rows[0].average === 5000, "expense comparison: one active month, so the average is the month itself");
const vsPrev = trendDoc.sections.find((s) => s.type === "table" && s.title === "Against the period before");
ok(vsPrev?.type === "table" && vsPrev.rows[0].category === "Rent" && vsPrev.rows[0].then === 0 && vsPrev.rows[0].now === 5000, "expense comparison: rent against a period that had none");

const cfDoc = buildReportDoc("cashflow", inputs("en"));
ok(cfDoc.figures.map((f) => f.value).slice(0, 3).join("|") === "1,500 EGP|(5,700) EGP|-4,200 EGP", "cash flow: 1,500 in, 5,700 out (5,000 rent + 400 lab + 300 commission), net −4,200");
ok(cfDoc.figures[2].tone === "bad" && cfDoc.figures[4].value === "1", "cash flow: the net is red and one month is in the red");
const cfTable = cfDoc.sections.find((s) => s.type === "table");
ok(cfTable?.type === "table" && cfTable.rows.length === 12 && cfTable.rows[11].running === -4200 && cfTable.rows[11]._bad === true, "cash flow: twelve rows, the running total ends at −4,200, the bad month is marked");

const nothing = buildDrillDoc("pnl", "nope:x", inputs("en"));
eq(nothing.type, "note", "an unknown drill says so rather than throwing");

console.log(`reportDocuments: ${checks} checks passed`);
