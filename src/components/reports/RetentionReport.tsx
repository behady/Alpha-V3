"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { Note, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { retention, type PatientDoc } from "@/lib/reports/patientStats";
import { trailingMonths } from "@/lib/reports/periods";
import { rangeText } from "@/lib/reportHelpers";

/**
 * Who comes back.
 *
 * Two twelve-month windows: the one ending with the period on screen, and the twelve months
 * before it. A patient seen in the first and again in the second was retained; seen in the first
 * and not the second, lost. The list of the lost is the report's real product — it is the call
 * sheet — and it is named rather than counted.
 */
export default function RetentionReport({ allPatients, range, isAr, data, today }: ReportProps) {
  const later = useMemo(() => trailingMonths(range.end, 12).range, [range.end]);
  const earlier = useMemo(() => trailingMonths(trailingMonths(range.end, 13).range.start, 12).range, [range.end]);
  const r = useMemo(
    () => retention(data.ledgerAll || [], data.appointmentsWide || [], allPatients as PatientDoc[], earlier, later, today),
    [data.ledgerAll, data.appointmentsWide, allPatients, earlier, later, today],
  );
  const bucketLabel = (l: string) => (isAr ? { "0-3": "آخر ٣ شهور", "3-6": "٣–٦ شهور", "6-12": "٦–١٢ شهر", "12-24": "سنة–سنتين", "24+": "أكتر من سنتين" }[l] || l : `${l} months`);

  return (
    <div className="space-y-8">
      <Note>
        {isAr
          ? `الفترة الأولى: ${rangeText(earlier, true)}. الفترة التانية: ${rangeText(later, true)}.`
          : `Earlier window: ${rangeText(earlier, false)}. Later window: ${rangeText(later, false)}.`}
      </Note>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(r.retentionPct, 0)} label={isAr ? "نسبة الرجوع" : "Retention"} tone={r.retentionPct !== null && r.retentionPct < 50 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.before)} label={isAr ? "مرضى الفترة الأولى" : "Active earlier"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.retained)} label={isAr ? "رجعوا" : "Came back"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.lost)} label={isAr ? "مرجعوش" : "Did not"} tone={r.lost > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.newcomers)} label={isAr ? "جداد في الفترة التانية" : "New in later window"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ChartFrame title={isAr ? "المرضى الجداد اللي رجعوا" : "New patients who returned"} note={isAr ? `من ${r.newReturned.opened} ملف اتفتح في الفترة الأولى، ${r.newReturned.returned} رجعوا.` : `Of ${r.newReturned.opened} files opened in the earlier window, ${r.newReturned.returned} came back.`}>
          <div className="py-2"><Figure value={fmtPct(r.newReturned.pct, 0)} label={isAr ? "رجعوا بعد أول زيارة" : "returned after a first visit"} /></div>
        </ChartFrame>
        <ChartFrame title={isAr ? "المدة بين الزيارات" : "Time between visits"} note={isAr ? "الوسيط، بالشهور، لكل المرضى اللي زاروا مرتين أو أكتر." : "Median months between consecutive visits, over patients seen twice or more."}>
          <div className="py-2"><Figure value={r.medianGapMonths === null ? "—" : `${r.medianGapMonths}`} label={isAr ? "شهر" : "months"} /></div>
        </ChartFrame>
        <ChartFrame title={isAr ? "آخر زيارة كانت من" : "Last seen"} note={isAr ? "كل المرضى اللي ليهم زيارة." : "Everyone with a recorded visit."}>
          <Bars rows={r.lastSeen.map((b, i) => ({ label: bucketLabel(b.label), value: b.count, text: String(b.count), color: i === 0 ? MARK : INK, warn: b.label === "24+" && b.count > 0 }))} />
        </ChartFrame>
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="px-4 py-3">
          <h3 className="text-sm font-black tracking-tight text-ink">{isAr ? `مرجعوش (${r.lostPatients.length})` : `Did not come back (${r.lostPatients.length})`}</h3>
          <p className="text-[11px] font-semibold text-ink-muted">{isAr ? "كانوا في الفترة الأولى ومجوش في التانية. أول قائمة للاتصال." : "Active in the earlier window, absent in the later one. The first list to call."}</p>
        </div>
        {r.lostPatients.length === 0 ? (
          <p className="px-4 pb-6 text-center text-[12.5px] font-medium text-ink-faint">{isAr ? "مفيش حد." : "Nobody."}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3">
            {r.lostPatients.slice(0, 150).map((n) => (
              <span key={n} className="rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-body">{n}</span>
            ))}
            {r.lostPatients.length > 150 && <span className="px-2 py-1 text-[12px] font-bold text-ink-faint">+{r.lostPatients.length - 150}</span>}
          </div>
        )}
      </section>
      <Note>
        {isAr
          ? "الزيارة = يوم فيه علاج أو دفعة أو موعد حضره المريض. عيادة عمرها أقل من سنتين هتلاقي الفترة الأولى فاضية — الرقم بيبقى له معنى بعد سنتين من التسجيل."
          : "A visit is a day with a treatment, a payment or an attended appointment. A clinic younger than two years will find the earlier window empty; this number means something after two years of records."}
      </Note>
    </div>
  );
}
