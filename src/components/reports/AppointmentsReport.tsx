"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, HeatGrid, Note, Num, SectionTitle, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { appointmentStats, type OutcomeCounts } from "@/lib/reports/opsStats";
import { WEEKDAYS_AR, WEEKDAYS_EN } from "@/lib/reports/periods";

const EMPTY: never[] = [];

/**
 * The appointment book as a report.
 *
 * Seen, missed, cancelled, still ahead — then the same four cut by weekday, dentist and where the
 * booking came from, because a no-show rate is only useful once it points at something. A past
 * booking nobody closed counts as a miss and is counted separately too, since "we forgot to mark
 * it" and "they did not come" need different fixes.
 */
export default function AppointmentsReport({ isAr, data, today }: ReportProps) {
  const appointments = data.appointments || EMPTY;
  const s = useMemo(() => appointmentStats(appointments, today, isAr ? "غير محدد" : "Unassigned"), [appointments, today, isAr]);
  const days = isAr ? WEEKDAYS_AR : WEEKDAYS_EN;
  const sourceLabel = (src: string) => (isAr ? { desk: "الاستقبال", online: "حجز أونلاين", whatsapp_bot: "مساعد واتساب" }[src] || src : { desk: "Front desk", online: "Online booking", whatsapp_bot: "WhatsApp assistant" }[src] || src);

  const outcomeCols = <T extends OutcomeCounts>(): import("@/components/reports/reportKit").Column<T>[] => [
    { key: "total", label: isAr ? "الكل" : "Total", align: "end", render: (r) => <Num v={r.total} /> },
    { key: "seen", label: isAr ? "حضروا" : "Seen", align: "end", render: (r) => <Num v={r.seen} bold /> },
    { key: "noShow", label: isAr ? "مجوش" : "No-show", align: "end", render: (r) => <Num v={r.noShow} bad={r.noShow > 0} /> },
    { key: "cancelled", label: isAr ? "ملغي" : "Cancelled", align: "end", render: (r) => <Num v={r.cancelled} muted /> },
    { key: "open", label: isAr ? "قادم" : "Ahead", align: "end", render: (r) => <Num v={r.open} muted /> },
    { key: "noShowPct", label: isAr ? "نسبة الغياب" : "No-show rate", align: "end", render: (r) => <span className={`font-figure text-[12.5px] font-bold ${r.noShowPct !== null && r.noShowPct >= 20 ? "text-danger" : "text-ink-body"}`}>{fmtPct(r.noShowPct, 0)}</span>, exportValue: (r) => r.noShowPct ?? "" },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.overall.total)} label={isAr ? "مواعيد" : "Bookings"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.overall.seen)} label={isAr ? "حضروا" : "Seen"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(s.overall.noShowPct, 0)} label={`${isAr ? "نسبة الغياب" : "No-show rate"} · ${s.overall.noShow}`} tone={s.overall.noShowPct !== null && s.overall.noShowPct >= 20 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.overall.cancelled)} label={isAr ? "ملغي" : "Cancelled"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={s.minutesPerDay === null ? "—" : `${(s.minutesPerDay / 60).toFixed(1)}h`} label={isAr ? `كراسي محجوزة / يوم (${s.workingDays} يوم)` : `Chair hours booked / day (${s.workingDays} days)`} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={s.waitMinutes === null ? "—" : `${Math.round(s.waitMinutes)}m`} label={isAr ? `انتظار قبل الكرسي (${s.waitSample})` : `Wait before the chair (${s.waitSample})`} tone={s.waitMinutes !== null && s.waitMinutes > 20 ? "bad" : "muted"} /></div>
      </div>

      {s.unclosed > 0 && (
        <Note>
          {isAr
            ? `${s.unclosed} موعد فات تاريخه ولسه «غير مؤكد» أو «مؤكد» — محدش قفله. محسوب غياب هنا؛ اقفله من الأجندة لو المريض حضر.`
            : `${s.unclosed} past bookings are still marked Unconfirmed or Confirmed — nobody closed them. They count as no-shows here; close them from the calendar if the patient did come.`}
        </Note>
      )}

      <ChartFrame title={isAr ? "أنهي يوم وأنهي ساعة" : "Which day, which hour"} note={isAr ? "كل المواعيد ما عدا الملغية، بساعة الحجز." : "Every booking except cancellations, by booked hour."}>
        <HeatGrid cells={s.heat} isAr={isAr} unit={isAr ? "موعد" : "bookings"} />
      </ChartFrame>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <SectionTitle>{isAr ? "حسب اليوم" : "By weekday"}</SectionTitle>
          <DataTable isAr={isAr} rows={s.byWeekday} rowKey={(r) => String(r.weekday)} dense exportName="Appointments_By_Weekday" columns={[{ key: "weekday", label: isAr ? "اليوم" : "Day", render: (r) => <span className="text-[13px] font-bold text-ink">{days[r.weekday]}</span>, exportValue: (r) => days[r.weekday] }, ...outcomeCols<(typeof s.byWeekday)[number]>()]} />
        </section>
        <section>
          <SectionTitle>{isAr ? "حسب المصدر" : "By source"}</SectionTitle>
          <DataTable isAr={isAr} rows={s.bySource} rowKey={(r) => r.source} dense exportName="Appointments_By_Source" columns={[{ key: "source", label: isAr ? "المصدر" : "Source", render: (r) => <span className="text-[13px] font-bold text-ink">{sourceLabel(r.source)}</span>, exportValue: (r) => sourceLabel(r.source) }, ...outcomeCols<(typeof s.bySource)[number]>()]} />
          <Note>{isAr ? "الحجز من الاستقبال مبيتسجلش ليه مصدر، فكل موعد مش أونلاين ومش من المساعد بيتحسب استقبال." : "Desk bookings carry no source, so anything not online or from the assistant is counted as the front desk."}</Note>
        </section>
      </div>

      <section>
        <SectionTitle>{isAr ? "حسب الدكتور" : "By dentist"}</SectionTitle>
        <DataTable isAr={isAr} rows={s.byDentist} rowKey={(r) => r.doctor} dense exportName="Appointments_By_Dentist" columns={[{ key: "doctor", label: isAr ? "الدكتور" : "Dentist", render: (r) => <span className="text-[13px] font-bold text-ink">{r.doctor}</span> }, ...outcomeCols<(typeof s.byDentist)[number]>()]} />
      </section>

      <ChartFrame title={isAr ? "الغياب حسب اليوم" : "No-shows by weekday"} note={s.leadDays !== null ? (isAr ? `المرضى بيحجزوا قبل الموعد بـ ${s.leadDays} يوم في المتوسط.` : `Patients book ${s.leadDays} days ahead on average.`) : undefined}>
        <Bars rows={s.byWeekday.map((r) => ({ label: days[r.weekday], value: r.noShow, text: `${r.noShow} · ${fmtPct(r.noShowPct, 0)}`, color: r.noShow === Math.max(...s.byWeekday.map((x) => x.noShow)) && r.noShow > 0 ? MARK : INK }))} />
      </ChartFrame>
      <Note>
        {isAr
          ? "«حضروا» = تسجيل وصول أو بالكرسي أو خروج أو مكتمل. نسبة الغياب = الغياب ÷ (الحضور + الغياب)؛ الإلغاء مش محسوب ضد حد — المريض اللي اتصل وألغى عمل الصح."
          : "\"Seen\" is checked in, in chair, checking out or completed. No-show rate = misses ÷ (seen + missed); cancellations are not held against anyone — a patient who rang to cancel did the right thing."}
      </Note>
    </div>
  );
}
