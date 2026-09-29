import { NextResponse } from "next/server";
import { reportServerError } from "@/lib/server/reportError";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { holdsPermission } from "@/lib/permissions";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { isUnlocked } from "@/lib/featureCatalog";
import type { Clinic } from "@/types/saas";
import { REPORT_CATALOG, REPORT_GROUP_META, reportMeta } from "@/lib/reports/catalog";
import { buildDrillDoc, buildReportDoc, type ReportInputs } from "@/lib/reports/documents";
import { loadBaseReportData, loadReportDatasets } from "@/lib/reports/loadReportData.server";
import { loadBriefingData } from "@/lib/automation/briefing/data";
import { buildHrSection } from "@/lib/automation/briefing/hr";
import { resolveBriefingAccess } from "@/lib/automation/briefing/build";
import type { PayrollRow } from "@/lib/reports/opsStats";
import { getFirstDay } from "@/lib/reportHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A whole ledger for the balance reports, on a clinic with years of history. */
export const maxDuration = 60;

/**
 * The reports, for the phone.
 *
 * The website builds each report in the browser from lib/reports. The phone cannot run those and
 * must not carry its own copy of the arithmetic, so this route runs the same functions here and
 * answers with a document — figures, bars, months, a heat grid, tables — that the phone draws
 * without knowing what a ledger row is (see lib/reports/documents).
 *
 *   ?list=1&lang=ar                       the catalogue, grouped, with locks for this clinic
 *   ?report=pnl&from=…&to=…&lang=en       one report over a range
 *   ?report=service&drill=service:crown   the patients behind one figure
 *
 * Reports are gated on `access.reports`, the same permission the website's page is behind, and a
 * report belonging to an add-on the clinic does not have is answered as locked rather than built.
 * Payroll is only computed for a caller who administers attendance, as /api/payroll does.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;
  const lang = url.searchParams.get("lang") === "ar" ? "ar" : "en";

  const authz = await requireStaffUser(request, requestedClinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;
  if (!holdsPermission(authz.role, authz.permissions, "access.reports")) {
    return NextResponse.json({ ok: false, error: "This account is not allowed to see the clinic's reports." }, { status: 403 });
  }

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    const clinic = clinicSnap.exists ? ({ id: clinicSnap.id, ...clinicSnap.data() } as unknown as Clinic) : null;
    const locked = (id: string) => { const f = reportMeta(id).feature; return f ? !isUnlocked(clinic, f) : false; };

    if (url.searchParams.get("list")) {
      return NextResponse.json({
        ok: true,
        groups: REPORT_GROUP_META.map((g) => ({
          id: g.id,
          label: lang === "ar" ? g.ar : g.en,
          reports: REPORT_CATALOG.filter((r) => r.group === g.id).map((r) => ({
            id: r.id,
            label: lang === "ar" ? r.ar : r.en,
            hint: lang === "ar" ? r.hintAr : r.hintEn,
            allTime: Boolean(r.allTime),
            locked: locked(r.id),
          })),
        })),
      });
    }

    const meta = reportMeta(url.searchParams.get("report"));
    if (locked(meta.id)) {
      return NextResponse.json({ ok: false, locked: true, error: lang === "ar" ? "الوحدة دي مش مفعّلة في اشتراك العيادة." : "This module is not enabled on the clinic's plan." }, { status: 403 });
    }

    const timeZone = clinicTimeZone();
    const today = ymdInTimeZone(timeZone);
    const to = url.searchParams.get("to")?.trim() || today;
    const from = url.searchParams.get("from")?.trim() || `${to.slice(0, 7)}-01`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return NextResponse.json({ ok: false, error: "Bad date range." }, { status: 400 });
    }
    const range = { start: from, end: to };

    const [base, data] = await Promise.all([loadBaseReportData(clinicId, range), loadReportDatasets(clinicId, meta.needs, range)]);

    // Payroll, only for the attendance report and only for someone who may see wages.
    let payroll: PayrollRow[] | null = null;
    if (meta.id === "attendance") {
      const access = resolveBriefingAccess(authz.role, authz.permissions);
      if (access.hr) {
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
          monthStart: getFirstDay(),
        });
        payroll = section.staff as PayrollRow[];
      }
    }

    const inputs: ReportInputs = { ...base, range, today, lang, data, payroll, clinicName: String(clinic?.name || "") };
    const drill = url.searchParams.get("drill")?.trim();
    if (drill) {
      return NextResponse.json({ ok: true, section: buildDrillDoc(meta.id, drill, inputs) });
    }
    return NextResponse.json({ ok: true, doc: buildReportDoc(meta.id, inputs) });
  } catch (error) {
    reportServerError("api/reports", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "The report could not be built." }, { status: 500 });
  }
}
