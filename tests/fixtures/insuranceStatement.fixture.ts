// Ledger rows that reproduce the first three cases of the prospect's real Nextcare statement for
// February 2026 (docs/samples/insurance-statement-nextcare-2026-02.xlsx), plus every edge the
// builder must get right: a second visit of the same patient, rows that must be left out (another
// payer, another month, deleted), a line with no service name and no teeth, a flat-priced line
// with units, a primary tooth, and a patient with no member number.

import type { StatementRowLite } from "../../src/lib/insuranceStatement";

const NEXTCARE = "nextcare";

const row = (r: Partial<StatementRowLite> & { id: string }): StatementRowLite => ({
  type: "procedure",
  payerId: NEXTCARE,
  status: "",
  pricingMode: "per_tooth",
  unitsCount: 1,
  ...r,
});

export const memberNumbers: ReadonlyMap<string, string> = new Map([
  ["pat-07b5", "07B5"],
  ["pat-9c99", "9C99"],
  ["pat-5d04", "5D04"],
]);

export const rows: StatementRowLite[] = [
  // Case 1 — (07B5) محمد حسن اسماعيل: 2 zirconia crowns on 14,15 and a gum treatment. 4828.
  row({ id: "r1", patientId: "pat-07b5", patientName: "محمد حسن اسماعيل", date: "2026-02-01", appointmentId: "apt-1", serviceName: "طربوش زركونيا", description: "طربوش زركونيا (T: 14,15) | 2400*2=4800", unitsCount: 2, amount: 4800, cost: 4800 }),
  row({ id: "r2", patientId: "pat-07b5", patientName: "محمد حسن اسماعيل", date: "2026-02-01", appointmentId: "apt-1", serviceName: "علاج لثه صديديه", description: "علاج لثه صديديه (T: Gen) | 28=28", amount: 28, cost: 28 }),

  // Case 2 — (9C99) سامح احمد محمد: consultation and an x-ray. 85.
  row({ id: "r3", patientId: "pat-9c99", patientName: "سامح احمد محمد", date: "2026-02-02", appointmentId: "apt-2", serviceName: "كشف", description: "كشف (T: Gen) | 30=30", amount: 30, cost: 30 }),
  row({ id: "r4", patientId: "pat-9c99", patientName: "سامح احمد محمد", date: "2026-02-02", appointmentId: "apt-2", serviceName: "اشعه عاديه", description: "اشعه عاديه (T: Gen) | 55=55", amount: 55, cost: 55 }),

  // Case 3 — (5D04) مي محمود محمد توفيق: consultation, x-ray, impacted wisdom tooth. 1685.
  row({ id: "r5", patientId: "pat-5d04", patientName: "مي محمود محمد توفيق", date: "2026-02-03", appointmentId: "apt-3", serviceName: "كشف", description: "كشف (T: Gen) | 30=30", amount: 30, cost: 30 }),
  row({ id: "r6", patientId: "pat-5d04", patientName: "مي محمود محمد توفيق", date: "2026-02-03", appointmentId: "apt-3", serviceName: "اشعه عاديه", description: "اشعه عاديه (T: Gen) | 55=55", amount: 55, cost: 55 }),
  row({ id: "r7", patientId: "pat-5d04", patientName: "مي محمود محمد توفيق", date: "2026-02-03", appointmentId: "apt-3", serviceName: "خلع ضرس عقل مدفون كليا", description: "خلع ضرس عقل مدفون كليا (T: Gen) | 1600=1600", amount: 1600, cost: 1600 }),

  // Case 4 — the same patient back later in the month: its own case, its own serial. 2100.
  row({ id: "r8", patientId: "pat-5d04", patientName: "مي محمود محمد توفيق", date: "2026-02-20", appointmentId: "apt-4", serviceName: "حشو كمبوزيت", description: "حشو كمبوزيت (T: 13,14,15) | 700*3=2100", unitsCount: 3, amount: 2100, cost: 2100 }),

  // Case 5 — a patient with no member number: a line with no service name and no teeth, a flat
  // price with units (no count prefix), and a primary tooth (a letter, not a digit). 1600.
  row({ id: "r9", patientId: "pat-nomember", patientName: "Nour Adel", date: "2026-02-25", appointmentId: "", description: "Consultation | 50=50", amount: 50, cost: 50 }),
  row({ id: "r10", patientId: "pat-nomember", patientName: "Nour Adel", date: "2026-02-25", appointmentId: "", serviceName: "تنظيف جير", description: "تنظيف جير (T: Gen) | 550", unitsCount: 2, pricingMode: "flat", amount: 550, cost: 550 }),
  row({ id: "r11", patientId: "pat-nomember", patientName: "Nour Adel", date: "2026-02-25", appointmentId: "", serviceName: "حشو عصب اطفال", description: "حشو عصب اطفال (T: 55) | 1000*1=1000", amount: 1000, cost: 1000 }),

  // Left out: another payer, the previous month, a deleted row.
  row({ id: "other-payer", payerId: "axa", patientId: "pat-07b5", patientName: "محمد حسن اسماعيل", date: "2026-02-05", appointmentId: "apt-x", serviceName: "كشف", description: "كشف (T: Gen) | 30=30", amount: 30, cost: 30 }),
  row({ id: "last-month", patientId: "pat-9c99", patientName: "سامح احمد محمد", date: "2026-01-28", appointmentId: "apt-y", serviceName: "كشف", description: "كشف (T: Gen) | 30=30", amount: 30, cost: 30 }),
  row({ id: "deleted", patientId: "pat-9c99", patientName: "سامح احمد محمد", date: "2026-02-06", appointmentId: "apt-z", serviceName: "كشف", description: "كشف (T: Gen) | 30=30", amount: 30, cost: 30, status: "deleted" }),
];

/** What the five cases add up to, written out so a wrong total names which case moved. */
export const EXPECTED_SUBTOTALS = [4828, 85, 1685, 2100, 1600];
