"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { adStats } from "@/lib/reports/adStats";

/**
 * Click-to-WhatsApp ads: which ad opened chats, which chats became bookings, and what they paid.
 *
 * Spend is not in the system, so the report stops one step short of cost-per-booking and says
 * so — the owner divides their Ads Manager figure by the "booked" column. Everything above that
 * line is what the ad platform cannot tell them: whether the people who clicked turned up.
 */
export default function AdsReport({ ledger, leads, range, isAr, data }: ReportProps) {
  const s = useMemo(() => adStats(data.conversations || [], data.appointments || [], ledger, range, leads), [data.conversations, data.appointments, ledger, range, leads]);
  const kind = (t: string) => (t === "post" ? (isAr ? "منشور" : "Post") : isAr ? "إعلان" : "Ad");

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.totals.chats)} label={isAr ? "محادثات من إعلانات" : "Chats from ads"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.totals.typed)} label={isAr ? "كتبوا رسالة" : "Wrote a message"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.totals.booked)} label={isAr ? "حجزوا" : "Booked"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.totals.attended)} label={isAr ? "حضروا" : "Attended"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(s.totals.conversionPct, 0)} label={isAr ? "محادثة ← حجز" : "Chat → booking"} tone={s.totals.conversionPct !== null && s.totals.conversionPct < 10 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmt(s.totals.revenue)} label={isAr ? "دفعوا (ج.م)" : "Paid (EGP)"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "الحجوزات لكل إعلان" : "Bookings per ad"} note={isAr ? "أعلى إعلان بالأصفر." : "The top ad in yellow."}>
          <Bars rows={s.rows.slice(0, 8).map((r, i) => ({ label: r.label, value: r.booked, text: String(r.booked), color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "الإعلانات مقابل باقي واتساب" : "Ads versus the rest of WhatsApp"} note={isAr ? "محادثات الفترة حسب مصدرها." : "This period's conversations by where they came from."}>
          <Bars
            rows={[
              { label: isAr ? "من إعلانات" : "From ads", value: s.totals.chats, text: String(s.totals.chats), color: MARK },
              { label: isAr ? "من غير إعلان" : "Not from an ad", value: s.organicChats, text: String(s.organicChats), color: INK },
            ]}
          />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "كل إعلان" : "Every ad"}</SectionTitle>
        <DataTable
          isAr={isAr}
          rows={s.rows}
          rowKey={(r) => r.key}
          exportName="Ads_WhatsApp"
          emptyText={isAr ? "مفيش محادثات جاية من إعلانات في الفترة دي. لما حد يضغط على إعلان «راسلنا على واتساب» هيظهر هنا." : "No conversations came from ads in this period. The moment someone taps a \"Send WhatsApp message\" ad, it shows up here."}
          columns={[
            { key: "label", label: isAr ? "الإعلان" : "Ad", render: (r) => (
              <span className="flex flex-col min-w-0">
                <span className="text-[13px] font-bold text-ink truncate max-w-[280px]" title={r.label} dir="auto">{r.label}</span>
                <span className="text-[11px] text-ink-muted">{kind(r.sourceType)}{r.key !== r.label ? ` · #${r.key.slice(-6)}` : ""}</span>
              </span>
            ), exportValue: (r) => r.label },
            { key: "chats", label: isAr ? "محادثات" : "Chats", align: "end", render: (r) => <Num v={r.chats} bold />, total: <Num v={s.totals.chats} bold /> },
            { key: "typed", label: isAr ? "كتبوا" : "Typed", align: "end", render: (r) => <Num v={r.typed} muted />, total: <Num v={s.totals.typed} muted /> },
            { key: "handoffs", label: isAr ? "لشخص" : "To a person", align: "end", render: (r) => <Num v={r.handoffs} muted />, total: <Num v={s.totals.handoffs} muted /> },
            { key: "hot", label: isAr ? "🔥 ساخن" : "🔥 Hot", align: "end", render: (r) => <Num v={r.hot} bold={r.hot > 0} muted={r.hot === 0} />, total: <Num v={s.totals.hot} bold /> },
            { key: "booked", label: isAr ? "حجزوا" : "Booked", align: "end", render: (r) => <Num v={r.booked} bold />, total: <Num v={s.totals.booked} bold /> },
            { key: "attended", label: isAr ? "حضروا" : "Attended", align: "end", render: (r) => <Num v={r.attended} muted />, total: <Num v={s.totals.attended} muted /> },
            { key: "conversionPct", label: isAr ? "تحويل" : "Conv.", align: "end", render: (r) => <span className="font-figure text-[13px] font-bold text-ink">{fmtPct(r.conversionPct, 0)}</span>, exportValue: (r) => r.conversionPct ?? "", total: <span className="font-figure text-[13px] font-bold text-ink">{fmtPct(s.totals.conversionPct, 0)}</span> },
            { key: "revenue", label: isAr ? "دفعوا" : "Paid", align: "end", render: (r) => <Num v={r.revenue} bold />, total: <Num v={s.totals.revenue} bold /> },
          ]}
        />
      </section>

      <Note>
        {isAr
          ? "تكلفة الحجز = اللي دفعته لميتا على الإعلان ÷ عمود «حجزوا». «كتبوا» أقل من «محادثات» لأن ناس كتير بتضغط الإعلان وتفتح الشات من غير ما تكتب — فعّل «الرد الأول من الإعلانات» في إعدادات واتساب عشان المساعد يسلّم عليهم هو الأول. الحجز بيتحسب لو الشخص حجز بعد الضغطة، حتى لو من الاستقبال."
          : "Cost per booking = what you paid Meta for the ad ÷ the Booked column. Typed is lower than Chats because many people tap an ad and open the chat without writing — switch on \"Speak first from ads\" in WhatsApp settings so the assistant greets them first. A booking counts if the person booked after the tap, even through the desk."}
      </Note>
    </div>
  );
}
