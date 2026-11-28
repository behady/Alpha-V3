/**
 * One of the Reports page's reports, built on the server for the assistant.
 *
 * The same steps as `/api/reports` (the phone's route): the `access.reports` gate, the add-on
 * lock, the base data plus the datasets the report asks for, payroll only for someone who
 * administers attendance, the contract companies' sheets for the insurance statement. That route
 * is left untouched; this repeats its steps so the assistant's number and the page's number come
 * from one set of functions in lib/reports.
 *
 * Two additions: the period's rows are narrowed to the branch on screen (the whole-history
 * ledger never is, because one patient is one account), and an unknown report id is refused
 * rather than silently answered with the first report in the catalogue.
 *
 * Server only: reads with the Admin SDK.
 */

import { holdsPermission } from "@/lib/permissions";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { isUnlocked } from "@/lib/featureCatalog";
import type { Clinic } from "@/types/saas";
import { REPORT_CATALOG, type DatasetKey } from "@/lib/reports/catalog";
import { buildReportDoc, type ReportDoc, type ReportInputs, type Row } from "@/lib/reports/documents";
import { loadBaseReportData, loadReportDatasets } from "@/lib/reports/loadReportData.server";
import { loadBriefingData } from "@/lib/automation/briefing/data";
import { buildHrSection } from "@/lib/automation/briefing/hr";
import { resolveBriefingAccess } from "@/lib/automation/briefing/build";
import type { PayrollRow } from "@/lib/reports/opsStats";
import { loadCompanySheetInputs } from "@/lib/server/companySheetData";
import type { SheetInputs } from "@/lib/insurance/companySheet";
import { PRIVATE_PAYER_ID, isInsurerFormat } from "@/lib/payers";
import { rowInScope } from "@/lib/branchAccess";
import { reportServerError } from "@/lib/server/reportError";

export const SARA_REPORT_IDS = REPORT_CATALOG.map((r) => r.id);

/** Datasets that are a period's rows, and so belong to a branch. Everything else is clinic-wide. */
const BRANCH_SCOPED: ReadonlySet<DatasetKey> = new Set(["ledgerPrev", "ledgerLastYear", "ledgerMonths12", "appointments", "appointmentsWide", "appointmentsAhead"]);

export type SaraReportResult = { ok: true; doc: ReportDoc } | { ok: false; error: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function runSaraReport(args: {
  clinicId: string;
  clinic: Clinic | null;
  reportId: string;
  startDate: string;
  endDate: string;
  lang: "en" | "ar";
  role: string | null | undefined;
  permissions: string[] | null | undefined;
  /** The branch on screen; "" or absent = the whole clinic. */
  branchId?: string;
}): Promise<SaraReportResult> {
  const { clinicId, clinic, role, permissions, lang } = args;

  if (!holdsPermission(role, permissions, "access.reports")) {
    return { ok: false, error: "This person does not have access to the clinic's reports. Tell them so plainly and give no figure." };
  }
  const meta = REPORT_CATALOG.find((r) => r.id === args.reportId);
  if (!meta) return { ok: false, error: `Unknown report "${args.reportId}". Use one of: ${SARA_REPORT_IDS.join(", ")}.` };
  if (meta.feature && !isUnlocked(clinic, meta.feature)) {
    return { ok: false, error: "This module is not enabled on the clinic's plan, so there is nothing to report." };
  }

  const timeZone = clinicTimeZone();
  const today = ymdInTimeZone(timeZone);
  const to = YMD.test(args.endDate) ? args.endDate : today;
  const from = YMD.test(args.startDate) ? args.startDate : `${to.slice(0, 7)}-01`;
  if (from > to) return { ok: false, error: "startDate must be on or before endDate (YYYY-MM-DD)." };
  const range = { start: from, end: to };

  const [base, loaded] = await Promise.all([loadBaseReportData(clinicId, range), loadReportDatasets(clinicId, meta.needs, range)]);

  const scope = typeof args.branchId === "string" ? args.branchId : "";
  const inScope = (rows: Row[]) => (scope === "" ? rows : rows.filter((r) => rowInScope(r, scope)));
  const data: Partial<Record<DatasetKey, Row[]>> = {};
  for (const [key, rows] of Object.entries(loaded) as [DatasetKey, Row[]][]) {
    data[key] = BRANCH_SCOPED.has(key) ? inScope(rows) : rows;
  }

  let payroll: PayrollRow[] | null = null;
  if (meta.id === "attendance" && resolveBriefingAccess(role, permissions as string[] | null).hr) {
    const hr = await loadBriefingData({ clinicId, startDate: from, endDate: to, comparisonStart: from, previousStart: null, previousEnd: null, attendanceStart: from, needsMoney: false, needsHr: true });
    const now = new Date();
    const { section } = buildHrSection({
      staff: hr.staff,
      punches: hr.punches,
      startDate: from,
      endDate: to,
      today,
      nowMinutes: Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now)) * 60 + now.getUTCMinutes(),
      timeZone,
      geofenceRadiusM: Number((clinic as { geofenceRadiusM?: number } | null)?.geofenceRadiusM) || 200,
      monthStart: `${today.slice(0, 8)}01`,
    });
    payroll = section.staff as PayrollRow[];
  }

  let companySheets: Record<string, SheetInputs> | undefined;
  if (meta.id === "insurance") {
    const contract = base.payers.filter((p) => p.active && p.id !== PRIVATE_PAYER_ID && !isInsurerFormat(p.format));
    companySheets = {};
    await Promise.all(contract.map(async (p) => {
      try {
        companySheets![p.id] = await loadCompanySheetInputs(clinicId, p.id);
      } catch (error) {
        reportServerError("sara report company sheet", error, { payerId: p.id });
      }
    }));
  }

  const inputs: ReportInputs = {
    ...base,
    procedures: inScope(base.procedures),
    payments: inScope(base.payments),
    range,
    today,
    lang,
    data,
    payroll,
    clinicName: String(clinic?.name || ""),
    companySheets,
  };
  return { ok: true, doc: buildReportDoc(meta.id, inputs) };
}
