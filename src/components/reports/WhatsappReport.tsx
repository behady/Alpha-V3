"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { whatsappStats } from "@/lib/reports/whatsappStats";
import type { PatientDoc } from "@/lib/reports/patientStats";

/**
 * The WhatsApp line: what the assistant carried, how fast people picked up what it could not,
 * what the automated sends did, and who asked to be left alone.
 *
 * Staff response time is measured on handoffs — the moment the bot raised a hand to the moment a
 * person first typed — because a patient the bot could answer never waited.
 */
export default function WhatsappReport({ allPatients, range, isAr, data }: ReportProps) {
  const s = useMemo(
    () => whatsappStats(data.conversations || [], data.appointments || [], data.whatsappLogs || [], data.smsOutbox || [], allPatients as PatientDoc[], range),
    [data.conversations, data.appointments, data.whatsappLogs, data.smsOutbox, allPatients, range],
  );
  const outcomeLabel = (o: string) => (isAr ? { booked: "حجز", handoff: "اتحوّل لشخص", quiet: "سكت", other: "أخرى" }[o] || o : { booked: "Booked", handoff: "Handed to a person", quiet: "Went quiet", other: "Other" }[o] || o);
  const severityLabel = (v: string) => (isAr ? { urgent: "عاجل", complaint: "شكوى", normal: "عادي" }[v] || v : { urgent: "Urgent", complaint: "Complaint", normal: "Normal" }[v] || v);
  const typeLabel = (t: string) => t.replace(/^appointment_/, "").replace(/_/g, " ");

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.conversations)} label={isAr ? "محادثات" : "Conversations"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(s.botAlonePct, 0)} label={isAr ? "المساعد خلّصها لوحده" : "Handled by the assistant alone"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.bookingsByBot)} label={isAr ? "حجوزات من المساعد" : "Bookings made by the assistant"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.handoffs.total)} label={`${isAr ? "اتحوّلت لشخص" : "Handoffs"}${s.handoffs.open ? ` · ${s.handoffs.open} ${isAr ? "مفتوحة" : "open"}` : ""}`} tone={s.handoffs.open > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={s.handoffs.medianMinutes === null ? "—" : `${s.handoffs.medianMinutes}m`} label={isAr ? "وسيط رد الموظف" : "Median staff response"} tone={s.handoffs.medianMinutes !== null && s.handoffs.medianMinutes > 60 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.optOuts.inPeriod)} label={`${isAr ? "طلبوا إيقاف الرسائل" : "Opted out"} · ${s.optOuts.total} ${isAr ? "إجمالي" : "total"}`} tone={s.optOuts.inPeriod > 0 ? "bad" : "muted"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ChartFrame title={isAr ? "المحادثات انتهت بإيه" : "How conversations ended"} note={isAr ? `${s.aiUsed} منها استخدمت الذكاء الاصطناعي.` : `${s.aiUsed} of them used the AI model.`}>
          <Bars rows={s.outcomes.map((o) => ({ label: outcomeLabel(o.outcome), value: o.count, text: String(o.count), color: o.outcome === "booked" ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "التحويلات حسب الخطورة" : "Handoffs by severity"} note={isAr ? `${s.handoffs.withinHour} من ${s.handoffs.resolved} اترد عليها في أقل من ساعة.` : `${s.handoffs.withinHour} of ${s.handoffs.resolved} answered within the hour.`}>
          <Bars rows={s.handoffs.bySeverity.map((v) => ({ label: severityLabel(v.severity), value: v.count, text: String(v.count), color: INK, warn: v.severity === "urgent" || v.severity === "complaint" }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "ليه اتحوّلت" : "Why they were handed over"}>
          <Bars rows={s.handoffs.byReason.map((r, i) => ({ label: r.reason, value: r.count, text: String(r.count), color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <SectionTitle>{isAr ? "رسائل واتساب التلقائية" : "Automated WhatsApp sends"}</SectionTitle>
          <DataTable
            isAr={isAr}
            rows={s.sends}
            rowKey={(r) => r.type}
            dense
            exportName="WhatsApp_Sends"
            emptyText={isAr ? "مفيش رسائل تلقائية في الفترة." : "No automated sends in this period."}
            columns={[
              { key: "type", label: isAr ? "النوع" : "Type", render: (r) => <span className="text-[13px] font-bold text-ink">{typeLabel(r.type)}</span> },
              { key: "sent", label: isAr ? "اتبعت" : "Sent", align: "end", render: (r) => <Num v={r.sent} bold /> },
              { key: "manual", label: isAr ? "يدوي" : "Manual", align: "end", render: (r) => <Num v={r.manual} muted /> },
              { key: "queued", label: isAr ? "في الانتظار" : "Queued", align: "end", render: (r) => <Num v={r.queued} muted /> },
              { key: "failed", label: isAr ? "فشل" : "Failed", align: "end", render: (r) => <Num v={r.failed} bad={r.failed > 0} muted={r.failed === 0} /> },
            ]}
          />
        </section>
        <section>
          <SectionTitle>{isAr ? "رسائل SMS" : "SMS"}</SectionTitle>
          <DataTable
            isAr={isAr}
            rows={s.sms}
            rowKey={(r) => r.type}
            dense
            exportName="SMS_Sends"
            emptyText={isAr ? "مفيش SMS في الفترة." : "No SMS in this period."}
            columns={[
              { key: "type", label: isAr ? "النوع" : "Type", render: (r) => <span className="text-[13px] font-bold text-ink">{r.type}</span> },
              { key: "sent", label: isAr ? "اتبعت" : "Sent", align: "end", render: (r) => <Num v={r.sent} bold /> },
              { key: "queued", label: isAr ? "في الانتظار" : "Queued", align: "end", render: (r) => <Num v={r.queued} muted /> },
              { key: "failed", label: isAr ? "فشل" : "Failed", align: "end", render: (r) => <Num v={r.failed} bad={r.failed > 0} muted={r.failed === 0} /> },
            ]}
          />
        </section>
      </div>

      <Note>
        {isAr
          ? `المساعد كمان عدّل ${s.reschedulesByBot} موعد وألغى ${s.cancellationsByBot} بطلب المرضى. محادثات التدريب (play) مش محسوبة. زمن الرد = من لحظة ما المساعد رفع إيده لأول رسالة من موظف.`
          : `The assistant also moved ${s.reschedulesByBot} appointments and cancelled ${s.cancellationsByBot} at patients' request. Rehearsal (play) threads are excluded. Response time runs from the moment the assistant raised a hand to the first message a person typed.`}
      </Note>
    </div>
  );
}
