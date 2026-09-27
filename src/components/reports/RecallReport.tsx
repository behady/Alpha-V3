"use client";

import { useMemo, useState } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, PatientLink, Phone, SectionTitle } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { recallDue, type PatientDoc, type RecallLine } from "@/lib/reports/patientStats";
import { dayText } from "@/lib/reportHelpers";

/**
 * Who is due back and has not booked.
 *
 * The recall interval comes from the clinic's own settings (the same ones the weekly recall
 * message uses). A patient is due when their last visit is older than that and nothing is booked
 * ahead. Bucketed by how overdue, because a patient a week late and one a year late are different
 * phone calls. The list carries the phone, the last visit, and whether a recall was already sent.
 */
export default function RecallReport({ allPatients, isAr, data, today }: ReportProps) {
  const settings = data.recallSettings?.[0] as { intervalMonths?: number; configured?: boolean } | undefined;
  const interval = Number(settings?.intervalMonths) || 6;
  const r = useMemo(
    () => recallDue(allPatients as PatientDoc[], data.ledgerAll || [], data.appointmentsWide || [], today, interval),
    [allPatients, data.ledgerAll, data.appointmentsWide, today, interval],
  );
  const [bucket, setBucket] = useState<RecallLine["bucket"] | "">("");
  const shown = bucket ? r.lines.filter((l) => l.bucket === bucket) : r.lines;
  const label = (b: RecallLine["bucket"]) => (isAr ? { due: "مستحق (أقل من شهر)", "1-3m": "متأخر ١–٣ شهور", "3-6m": "متأخر ٣–٦ شهور", "6m+": "متأخر أكتر من ٦ شهور" }[b] : { due: "Due (under a month)", "1-3m": "1–3 months overdue", "3-6m": "3–6 months overdue", "6m+": "6+ months overdue" }[b]);
  const neverSent = r.lines.filter((l) => !l.recallSentAt).length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.lines.length)} label={isAr ? "مستحق ومش حاجز" : "Due, not booked"} tone={r.lines.length > 0 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.booked)} label={isAr ? "عندهم موعد قادم" : "Already booked"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(neverSent)} label={isAr ? "ماتبعتلهمش تذكير" : "Never messaged"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${interval}`} label={isAr ? "شهر فترة الاستدعاء" : "month recall interval"} tone="muted" /></div>
      </div>

      {!settings?.configured && (
        <Note>
          {isAr
            ? `مفيش فترة استدعاء مضبوطة في الإعدادات، فالتقرير بيستخدم ${interval} شهور. اضبطها من الإعدادات ← واتساب ← الاستدعاء.`
            : `No recall interval is set in Settings, so this report assumes ${interval} months. Set it under Settings → WhatsApp → Recall.`}
        </Note>
      )}

      <ChartFrame title={isAr ? "حسب التأخير" : "By how overdue"} note={isAr ? "اضغط شريحة لعرض أصحابها." : "Click a bucket to see who is in it."}>
        <div className="flex flex-col gap-2.5">
          {r.buckets.map((b, i) => (
            <button key={b.bucket} type="button" onClick={() => setBucket(bucket === b.bucket ? "" : b.bucket)} className={`rounded-lg px-1 text-start transition-colors ${bucket === b.bucket ? "bg-surface-subtle" : "hover:bg-surface-subtle"}`}>
              <Bars rows={[{ label: label(b.bucket), value: b.count, text: String(b.count), color: i === 0 ? MARK : INK, warn: b.bucket === "6m+" && b.count > 0 }]} max={Math.max(1, ...r.buckets.map((x) => x.count))} />
            </button>
          ))}
        </div>
      </ChartFrame>

      <section>
        <SectionTitle aside={bucket && <button type="button" onClick={() => setBucket("")} className="text-[11.5px] font-black text-ink-faint hover:text-ink">{isAr ? "الكل" : "Show all"}</button>}>
          {bucket ? `${label(bucket)} (${shown.length})` : isAr ? `قائمة الاستدعاء (${r.lines.length})` : `The recall list (${r.lines.length})`}
        </SectionTitle>
        <DataTable<RecallLine>
          isAr={isAr}
          rows={shown}
          rowKey={(l) => l.patientId}
          exportName={`Recall_Due${bucket ? `_${bucket}` : ""}`}
          maxRows={100}
          columns={[
            { key: "name", label: isAr ? "المريض" : "Patient", render: (l) => (<div><PatientLink id={l.patientId} name={l.name} isAr={isAr} />{l.whatsappOptOut && <span className="ms-2 rounded-full bg-surface-muted px-1.5 py-0.5 text-[9.5px] font-black text-ink-body">{isAr ? "اتصل" : "call only"}</span>}</div>) },
            { key: "phone", label: isAr ? "الهاتف" : "Phone", render: (l) => <Phone value={l.phone} /> },
            { key: "lastVisit", label: isAr ? "آخر زيارة" : "Last visit", render: (l) => <span className="whitespace-nowrap font-figure text-ink-body">{dayText(l.lastVisit, isAr)}</span> },
            { key: "overdueDays", label: isAr ? "متأخر (يوم)" : "Overdue (days)", align: "end", render: (l) => <Num v={l.overdueDays} bad={l.overdueDays > 180} /> },
            { key: "recallSentAt", label: isAr ? "آخر تذكير" : "Last recall sent", render: (l) => (l.recallSentAt ? <span className="whitespace-nowrap font-figure text-ink-muted">{dayText(l.recallSentAt, isAr)}{l.recallCount > 1 ? ` ×${l.recallCount}` : ""}</span> : <span className="text-[11px] font-bold text-ink-faint">{isAr ? "لا" : "never"}</span>) },
          ]}
        />
        <Note>
          {isAr
            ? `${r.neverSeen} مريض ملفهم مفتوح ومفيش ولا زيارة مسجلة ليهم؛ مش في القائمة لأن مفيش تاريخ نحسب منه. التذكير التلقائي بيتبعت من صفحة الأتمتة؛ التقرير ده للمتابعة اليدوية.`
            : `${r.neverSeen} patients have a file but no recorded visit and are left out — there is no date to count from. Automatic recalls go out from the Automation settings; this list is for following up by hand.`}
        </Note>
      </section>
    </div>
  );
}
