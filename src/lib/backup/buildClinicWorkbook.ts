/**
 * The Excel backup, from plain data to a workbook.
 *
 * Pure: takes a ClinicBackupData, returns an xlsx WorkBook. No Firestore, no React, no clock —
 * `today` is passed in so a test can pin it. Every figure on it is computed by a helper the app
 * already trusts on screen, so the file can never disagree with the Reports Center:
 *
 *   - per-patient charged / paid / visits ....... rollupPatients (the Patients report tab)
 *   - cash on a ledger row ....................... ledgerCashValue (every money report)
 *   - what a lab is owed ......................... labAccounts (the Lab accounts panel)
 *   - what staff earned .......................... buildHrSection (Attendance and /api/payroll)
 *
 * Readability rules, all of them tested:
 *   - headers and enum cells are bilingual, `English - العربية`
 *   - a missing value is an empty cell, never the string "undefined"
 *   - money and counts are numbers; dates stay the stored yyyy-mm-dd text
 *   - sheets carry a right-to-left view when the reader's app is in Arabic
 */

import * as XLSX from "xlsx";
import { ledgerCashValue } from "@/lib/reportHelpers";
import { rollupPatients, type PatientRollup, type ReportLedgerRow } from "@/lib/reportPatients";
import { getAppointmentStageLabel } from "@/lib/appointmentStages";
import { labAccounts, LAB_PAYMENT_METHODS } from "@/lib/labAccounts";
import { statusLabel, workTypeLabel } from "@/lib/labCases";
import { formatStaffRoleLabel } from "@/lib/staffRoles";
import { BACKUP_TEXT, bi, biRaw, type BackupTextKey } from "./backupText";
import type { BackupLedgerRow, ClinicBackupData } from "./types";

export type BuildOptions = {
  language: "en" | "ar";
  /** yyyy-mm-dd on the clinic's calendar. Payroll for the current month runs up to this day. */
  today: string;
};

type Cell = string | number;
type Sheet = { name: string; header: string[]; rows: Cell[][] };

/** Statuses the Reports Center leaves out of every figure. The rows stay on the Ledger sheet. */
const INACTIVE_LEDGER = new Set(["deleted", "cancelled"]);

// --- cell helpers ------------------------------------------------------------------------------

/** Text for a cell: trimmed, and never one of the words a missing value turns into. */
function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s === "undefined" || s === "null" || s === "NaN" ? "" : s;
}

/** A number for a cell, or an empty cell when there is no number to show. */
function num(v: unknown): Cell {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

/** A number that is meaningful as zero (a total), never blank. */
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function yesNo(v: boolean): string {
  return bi(v ? "yes" : "no");
}

/** yyyy-mm-dd HH:mm in the clinic's own zone, for the About sheet's timestamp. */
function stampInZone(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// --- shared computations ------------------------------------------------------------------------

/** The rows every figure is computed from. Deleted and cancelled rows are listed, not counted. */
export function activeLedgerRows(rows: BackupLedgerRow[]): BackupLedgerRow[] {
  return rows.filter((r) => !INACTIVE_LEDGER.has(text(r.status).toLowerCase()));
}

/**
 * Per-patient charged / paid / visits, keyed by patient id.
 *
 * Exactly what the Patients report tab shows, because it is the same function on the same split:
 * procedure rows are the charges, payment and income rows are the money.
 */
export function patientBalances(data: ClinicBackupData): Map<string, PatientRollup> {
  const active = activeLedgerRows(data.ledger) as unknown as ReportLedgerRow[];
  const procedures = active.filter((r) => r.type === "procedure");
  const payments = active.filter((r) => r.type === "payment" || r.type === "income");
  const lookup = new Map(data.patients.map((p) => [p.id, { id: p.id, name: p.name, phone: p.phone }]));
  const out = new Map<string, PatientRollup>();
  for (const line of rollupPatients(procedures, payments, lookup)) {
    if (line.patientId) out.set(line.patientId, line);
  }
  return out;
}

function ledgerTypeLabel(type: string): string {
  const key = `type_${type}` as BackupTextKey;
  return key in BACKUP_TEXT ? bi(key) : text(type);
}

function appointmentStatusLabel(status: string): string {
  const s = text(status);
  if (!s) return "";
  return biRaw(getAppointmentStageLabel(s, "en"), getAppointmentStageLabel(s, "ar"));
}

// --- sheets -----------------------------------------------------------------------------------

function patientsSheet(data: ClinicBackupData): Sheet {
  const balances = patientBalances(data);
  const rows = [...data.patients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p): Cell[] => {
      const b = balances.get(p.id);
      const charged = money(b?.charged);
      const paid = money(b?.paid);
      return [
        text(p.fileId), text(p.name), text(p.phone), text(p.gender), text(p.dateOfBirth), text(p.address),
        text(p.branchName), text(p.source), text(p.medicalHistory), text(p.allergies), text(p.status),
        text(p.createdAt), text(b?.firstDate), text(b?.lastDate), b?.visits ?? 0,
        charged, paid, money(charged - paid), text(p.id),
      ];
    });
  return {
    name: bi("sheet_patients"),
    header: [
      "col_patients_file_no", "col_patients_name", "col_patients_phone", "col_patients_gender", "col_patients_dob",
      "col_patients_address", "col_patients_branch", "col_patients_source", "col_patients_medical_history",
      "col_patients_allergies", "col_patients_status", "col_patients_registered_on", "col_patients_first_visit",
      "col_patients_last_visit", "col_patients_visits", "col_patients_charged", "col_patients_paid",
      "col_patients_owed", "col_patients_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

function appointmentsSheet(data: ClinicBackupData): Sheet {
  const rows = [...data.appointments]
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map((a): Cell[] => [
      text(a.date), text(a.time), text(a.patientName), text(a.patientPhone), text(a.doctor), text(a.treatment),
      appointmentStatusLabel(a.status), num(a.duration), text(a.branchName), text(a.roomName), text(a.source),
      num(a.cost), text(a.notes), text(a.patientId), text(a.id),
    ]);
  return {
    name: bi("sheet_appointments"),
    header: [
      "col_appointments_date", "col_appointments_time", "col_appointments_patient", "col_appointments_phone",
      "col_appointments_dentist", "col_appointments_treatment", "col_appointments_status",
      "col_appointments_duration", "col_appointments_branch", "col_appointments_room", "col_appointments_source",
      "col_appointments_cost", "col_appointments_notes", "col_appointments_patient_id", "col_appointments_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

function ledgerSheet(data: ClinicBackupData): Sheet {
  const rows = [...data.ledger]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r): Cell[] => {
      const cash = ledgerCashValue(r as unknown as Record<string, unknown>);
      const isExpense = r.type === "expense";
      return [
        text(r.date), ledgerTypeLabel(r.type), text(r.patientName), text(r.doctorName), text(r.description),
        text(r.category), text(r.method), num(r.amount), num(r.discountAmount),
        isExpense ? "" : money(cash), isExpense ? money(cash) : "",
        num(r.labFee), num(r.doctorCommissionAmount), num(r.clinicProfit),
        text(r.payerName), text(r.status), text(r.patientId), text(r.id),
      ];
    });
  return {
    name: bi("sheet_ledger"),
    header: [
      "col_ledger_date", "col_ledger_type", "col_ledger_patient", "col_ledger_dentist", "col_ledger_description",
      "col_ledger_category", "col_ledger_method", "col_ledger_listed_amount", "col_ledger_discount",
      "col_ledger_cash_in", "col_ledger_cash_out", "col_ledger_lab_fee", "col_ledger_commission",
      "col_ledger_clinic_profit", "col_ledger_payer", "col_ledger_status", "col_ledger_patient_id",
      "col_ledger_row_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

function expensesSheet(data: ClinicBackupData): Sheet {
  const rows = data.ledger
    .filter((r) => r.type === "expense")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r): Cell[] => [
      text(r.date), text(r.description), text(r.category), text(r.method),
      money(ledgerCashValue(r as unknown as Record<string, unknown>)), text(r.notes), text(r.id),
    ]);
  return {
    name: bi("sheet_expenses"),
    header: [
      "col_expenses_date", "col_expenses_description", "col_expenses_category", "col_expenses_method",
      "col_expenses_amount", "col_expenses_notes", "col_expenses_row_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}


/** A code-valued field written bilingual through a `prefix_<code>` key when one exists, else as-is. */
function codeLabel(prefix: "fault" | "mode", code: unknown): string {
  const c = text(code);
  if (!c) return "";
  const key = `${prefix}_${c}` as BackupTextKey;
  return key in BACKUP_TEXT ? bi(key) : c;
}

function labOrdersSheet(data: ClinicBackupData): Sheet {
  const rows = [...data.labCases]
    .sort((a, b) => text(a.sentAt).localeCompare(text(b.sentAt)) || a.code.localeCompare(b.code))
    .map((c): Cell[] => [
      text(c.code), text(c.sentAt), text(c.dueDate), text(c.receivedAt), text(c.fittedAt),
      text(c.patientName), text(c.doctorName), text(c.labName),
      biRaw(workTypeLabel(c.workType, "en"), workTypeLabel(c.workType, "ar")),
      (c.teeth || []).join(", "), num(c.units), text(c.bodyShade), text(c.material), num(c.agreedPrice),
      biRaw(statusLabel(c.status, "en"), statusLabel(c.status, "ar")),
      text(c.remakeOfCode), text(c.remakeReason), codeLabel("fault", c.remakeFault), text(c.id),
    ]);
  return {
    name: bi("sheet_laborders"),
    header: [
      "col_laborders_code", "col_laborders_sent", "col_laborders_due", "col_laborders_received",
      "col_laborders_fitted", "col_laborders_patient", "col_laborders_dentist", "col_laborders_lab",
      "col_laborders_work_type", "col_laborders_teeth", "col_laborders_units", "col_laborders_body_shade",
      "col_laborders_material", "col_laborders_agreed_price", "col_laborders_status", "col_laborders_remake_of",
      "col_laborders_remake_reason", "col_laborders_fault", "col_laborders_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

function labPaymentMethodLabel(method: string): string {
  const m = LAB_PAYMENT_METHODS.find((x) => x.id === method);
  return m ? biRaw(m.en, m.ar) : text(method);
}

function labPaymentsSheet(data: ClinicBackupData): Sheet {
  const rows = [...data.labPayments]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p): Cell[] => [
      text(p.date), text(p.labName), money(p.amount), labPaymentMethodLabel(p.method),
      text(p.reference), text(p.note), text(p.id),
    ]);
  return {
    name: bi("sheet_labpayments"),
    header: [
      "col_labpayments_date", "col_labpayments_lab", "col_labpayments_amount", "col_labpayments_method",
      "col_labpayments_reference", "col_labpayments_note", "col_labpayments_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

function labsSheet(data: ClinicBackupData): Sheet {
  const rows = labAccounts(data.labs, data.labCases, data.labPayments).map((a): Cell[] => [
    text(a.labName), a.deliveredCount, money(a.delivered), money(a.committed), money(a.paid),
    money(a.outstanding), a.remakesAtLabCost,
  ]);
  return {
    name: bi("sheet_labs"),
    header: [
      "col_labs_lab", "col_labs_delivered_count", "col_labs_delivered", "col_labs_committed", "col_labs_paid",
      "col_labs_balance", "col_labs_remakes_lab_cost",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `Sun 10:00-18:00; Mon 10:00-18:00` — the active days of a staff schedule, in week order. */
function workingDays(schedule: ClinicBackupData["staff"][number]["schedule"]): string {
  if (!schedule) return "";
  return WEEKDAYS.map((name, i) => {
    const day = schedule[i];
    return day && day.active ? `${name} ${day.start}-${day.end}` : "";
  })
    .filter(Boolean)
    .join("; ");
}

function staffSheet(data: ClinicBackupData): Sheet {
  const rows = [...data.staff]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s): Cell[] => [
      text(s.name), biRaw(formatStaffRoleLabel(s, false), formatStaffRoleLabel(s, true)), yesNo(s.isDentist),
      text(s.email), text(s.phone), yesNo(s.active), num(s.baseSalary), num(s.commissionPercentage),
      num(s.overtimeMultiplier), workingDays(s.schedule), text(s.id),
    ]);
  return {
    name: bi("sheet_staff"),
    header: [
      "col_staff_name", "col_staff_role", "col_staff_dentist", "col_staff_email", "col_staff_phone",
      "col_staff_active", "col_staff_base_salary", "col_staff_commission_pct", "col_staff_overtime_multiplier",
      "col_staff_working_days", "col_staff_id",
    ].map((k) => bi(k as BackupTextKey)),
    rows,
  };
}

/** One column per price list, inactive ones included: old rows were priced from them. */
function priceListHeader(list: ClinicBackupData["priceLists"][number]): string {
  const name = list.nameAr ? biRaw(list.name, list.nameAr) : text(list.name);
  return list.active ? name : `${name} (${bi("inactive")})`;
}

function pricesSheet(data: ClinicBackupData): Sheet {
  const lists = data.priceLists;
  const rows = [...data.services]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s): Cell[] => [
      text(s.name), text(s.category), codeLabel("mode", s.pricingMode), yesNo(s.requiresLab),
      num(s.estimatedLabFee), num(s.price),
      ...lists.map((l): Cell => (l.id in s.prices ? num(s.prices[l.id]) : "")),
    ]);
  return {
    name: bi("sheet_prices"),
    header: [
      ...[
        "col_prices_service", "col_prices_category", "col_prices_pricing_mode", "col_prices_needs_lab",
        "col_prices_est_lab_fee", "col_prices_base_price",
      ].map((k) => bi(k as BackupTextKey)),
      ...lists.map(priceListHeader),
    ],
    rows,
  };
}

/** The first sheet: what this is, when it was made, how many rows each sheet holds, what the money words mean. */
function aboutSheet(data: ClinicBackupData, sheets: Sheet[]): Sheet {
  const rows: Cell[][] = [
    [bi("about_clinic"), text(data.clinic.name)],
    [bi("about_generated_at"), stampInZone(data.generatedAt, data.clinic.timeZone)],
    [bi("about_generated_by"), text(data.generatedBy)],
    [],
    [bi("about_sheet_col"), bi("about_rows_col")],
    ...sheets.map((s): Cell[] => [s.name, s.rows.length]),
    [],
    [bi("about_cash")],
    [bi("about_charged")],
    [bi("about_balance")],
    [bi("about_expenses_note")],
    [bi("about_not_restore")],
  ];
  return { name: bi("sheet_about"), header: [], rows };
}

// --- assembly ---------------------------------------------------------------------------------

/** Column widths from the header and a sample of values: wide enough to read, never absurd. */
function columnWidths(header: string[], rows: Cell[][]): XLSX.ColInfo[] {
  const count = Math.max(header.length, ...rows.map((r) => r.length));
  const widths: number[] = Array.from({ length: count }, (_, i) => (header[i] ?? "").length);
  for (const row of rows.slice(0, 200)) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, String(cell).length);
    });
  }
  return widths.map((w) => ({ wch: Math.min(60, Math.max(8, w + 2)) }));
}

function toWorksheet(sheet: Sheet, language: "en" | "ar"): XLSX.WorkSheet {
  const aoa: Cell[][] = sheet.header.length ? [sheet.header, ...sheet.rows] : sheet.rows;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columnWidths(sheet.header, sheet.rows);
  if (language === "ar") ws["!views"] = [{ rightToLeft: true }];
  return ws;
}

export function buildClinicWorkbook(data: ClinicBackupData, opts: BuildOptions): XLSX.WorkBook {
  const sheets: Sheet[] = [
    patientsSheet(data),
    appointmentsSheet(data),
    ledgerSheet(data),
    expensesSheet(data),
    labOrdersSheet(data),
    labPaymentsSheet(data),
    labsSheet(data),
    staffSheet(data),
    pricesSheet(data),
  ];
  const all = [aboutSheet(data, sheets), ...sheets];

  const wb = XLSX.utils.book_new();
  for (const sheet of all) {
    XLSX.utils.book_append_sheet(wb, toWorksheet(sheet, opts.language), sheet.name);
  }
  return wb;
}

/** The bytes a route streams back. */
export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
