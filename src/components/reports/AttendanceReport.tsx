"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { staffLines, type PayrollRow, type StaffLine } from "@/lib/reports/opsStats";
import { buildHrSection } from "@/lib/automation/briefing/hr";
import type { PunchRecord, StaffRecord } from "@/lib/automation/briefing/data";
import { punchRecordFrom, staffRecordFrom, hoursText } from "@/lib/hrClient";
import { commissionByStaff } from "@/lib/staffCommission";
import { localYmd } from "@/lib/clinicDate";
import { getFirstDay } from "@/lib/reportHelpers";

const EMPTY: never[] = [];

/**
 * Hours, lateness, overtime and pay, one line per person, for the period on screen.
 *
 * The pay figures come from `buildHrSection` — the same function the nightly brief, /api/payroll
 * and the Team page use — run here in the browser, so this report cannot disagree with the
 * payslip. Commission is the stored amount on each payment in the period, keyed to the dentist.
 */
export default function AttendanceReport({ payments, range, isAr, data, clinic }: ReportProps) {
  const staffDocs = data.staff || EMPTY;
  const punches = data.punches || EMPTY;

  const lines = useMemo(() => {
    if (staffDocs.length === 0) return [];
    const staff: StaffRecord[] = staffDocs.map((d) => staffRecordFrom(d.id, d));
    const punchRecords: PunchRecord[] = punches.map((p) => punchRecordFrom(p.id, p));
    const now = new Date();
    const { section } = buildHrSection({
      staff,
      punches: punchRecords,
      startDate: range.start,
      endDate: range.end,
      today: localYmd(now),
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
      timeZone: "Africa/Cairo",
      geofenceRadiusM: Number((clinic as { geofenceRadiusM?: number } | null)?.geofenceRadiusM) || 200,
      monthStart: getFirstDay(),
    });
    const commission = commissionByStaff(payments, staffDocs.map((d) => ({ id: d.id, name: String(d.name ?? "") })));
    const byId = new Map<string, number>();
    commission.forEach((c, id) => byId.set(id, c.total));
    return staffLines(section.staff as PayrollRow[], byId);
  }, [staffDocs, punches, payments, range, clinic]);

  const egp = isAr ? "ج.م" : "EGP";
  const totals = lines.reduce(
    (t, l) => ({ pay: t.pay + l.estimatedPay, commission: t.commission + l.commission, hours: t.hours + l.hours, late: t.late + l.lateDays, absent: t.absent + l.absentDays, otPending: t.otPending + l.overtimePendingMinutes }),
    { pay: 0, commission: 0, hours: 0, late: 0, absent: 0, otPending: 0 },
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(lines.length)} label={isAr ? "أفراد" : "People"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${Math.round(totals.hours)}h`} label={isAr ? "ساعات شغل" : "Hours worked"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(totals.late)} label={isAr ? "أيام تأخير" : "Late days"} tone={totals.late > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(totals.absent)} label={isAr ? "أيام غياب" : "Absent days"} tone={totals.absent > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(totals.pay)} ${egp}`} label={isAr ? "مرتبات تقديرية" : "Estimated wages"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(totals.commission)} ${egp}`} label={isAr ? "نِسَب الأطباء" : "Commission earned"} /></div>
      </div>

      {totals.otPending > 0 && (
        <Note>{isAr ? `${hoursText(totals.otPending)} إضافي لسه مستني اعتماد — مش محسوب في المرتبات فوق.` : `${hoursText(totals.otPending)} of overtime is still awaiting approval and is not in the wages above.`}</Note>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "الساعات" : "Hours"}>
          <Bars rows={lines.map((l, i) => ({ label: l.name, value: l.hours, text: hoursText(l.minutesWorked), color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "التأخير بالدقايق" : "Lateness, in minutes"}>
          <Bars rows={[...lines].sort((a, b) => b.lateMinutes - a.lateMinutes).map((l) => ({ label: `${l.name} · ${l.lateDays} ${isAr ? "يوم" : "days"}`, value: l.lateMinutes, text: hoursText(l.lateMinutes), color: INK, warn: l.lateMinutes > 120 }))} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "الفريق" : "The team"}</SectionTitle>
        <DataTable<StaffLine>
          isAr={isAr}
          rows={lines}
          rowKey={(l) => l.staffId}
          exportName="Attendance_Payroll"
          columns={[
            { key: "name", label: isAr ? "الاسم" : "Name", render: (l) => (<div><a href={`/team?staff=${l.staffId}`} className="text-[13px] font-bold text-ink hover:underline">{l.name}</a><span className="block text-[11px] font-medium text-ink-faint">{l.role}{!l.hasSchedule && (isAr ? " · بدون روستر" : " · no roster")}</span></div>) },
            { key: "daysWorked", label: isAr ? "أيام" : "Days", align: "end", render: (l) => <Num v={l.daysWorked} /> },
            { key: "hours", label: isAr ? "ساعات" : "Hours", align: "end", render: (l) => <span className="font-figure text-[12.5px] text-ink-body">{hoursText(l.minutesWorked)}</span>, exportValue: (l) => l.hours },
            { key: "lateDays", label: isAr ? "تأخير" : "Late", align: "end", render: (l) => <span className={`font-figure text-[12.5px] ${l.lateDays > 0 ? "text-danger" : "text-ink-faint"}`}>{l.lateDays}{l.lateMinutes ? ` · ${hoursText(l.lateMinutes)}` : ""}</span> },
            { key: "absentDays", label: isAr ? "غياب" : "Absent", align: "end", render: (l) => <Num v={l.absentDays} bad={l.absentDays > 0} muted={l.absentDays === 0} /> },
            { key: "overtimeApprovedMinutes", label: isAr ? "إضافي معتمد" : "Overtime", align: "end", render: (l) => <span className="font-figure text-[12.5px] text-ink-body">{l.overtimeApprovedMinutes ? hoursText(l.overtimeApprovedMinutes) : "—"}{l.overtimePendingMinutes ? <span className="text-ink-faint"> (+{hoursText(l.overtimePendingMinutes)})</span> : null}</span>, exportValue: (l) => l.overtimeApprovedMinutes },
            { key: "estimatedPay", label: isAr ? "المرتب" : "Wages", align: "end", render: (l) => <Num v={l.estimatedPay} />, total: <Num v={totals.pay} bold /> },
            { key: "commission", label: isAr ? "النسبة" : "Commission", align: "end", render: (l) => <Num v={l.commission} muted={l.commission === 0} />, total: <Num v={totals.commission} bold /> },
            { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", render: (l) => <Num v={l.total} bold />, total: <Num v={totals.pay + totals.commission} bold /> },
          ]}
        />
        <Note>
          {isAr
            ? "المرتب = الساعات × سعر الساعة من المرتب الأساسي والروستر، زائد الإضافي المعتمد. اللي ملهوش روستر بيتحسب على روستر افتراضي. النسبة = المستحق على دفعات الفترة. الأرقام دي تقديرية لحد ما تعتمد."
            : "Wages = hours × the hourly rate from base salary and roster, plus approved overtime. People without a roster are priced on an assumed one. Commission is what the period's payments earned them. These are estimates until approved."}
        </Note>
      </section>
    </div>
  );
}
