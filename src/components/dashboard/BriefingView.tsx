"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  ClipboardList,
  Clock,
  Loader2,
  Lock,
  Printer,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { getClinicProfile } from "@/lib/clinicProfile";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { printBriefing } from "@/lib/briefingPdfHtml";
import type { Briefing } from "@/lib/automation/briefing/types";

/**
 * The brief on screen — one component for both periods.
 *
 * Daily and weekly are the same questions over different windows, so they are the same view with
 * one extra block. Splitting them into two components would mean every future section had to be
 * written twice and would drift.
 *
 * Sections the reader is not permitted to see never arrive in the payload. This renders what it
 * was given and states plainly what was withheld, rather than hiding fields it received.
 */

type Period = "day" | "week";

const FLAG_COPY: Record<string, { en: string; ar: string }> = {
  no_device_registered: { en: "no device registered", ar: "بلا جهاز مسجّل" },
  far_punch: { en: "punched far away", ar: "تسجيل من بعيد" },
  vague_gps: { en: "weak GPS", ar: "موقع ضعيف" },
};

const TREND_COPY: Record<string, { en: string; ar: string }> = {
  collected: { en: "Collected", ar: "المحصّل" },
  patients_seen: { en: "Patients seen", ar: "مرضى" },
  new_patients: { en: "New patients", ar: "مرضى جدد" },
  missed: { en: "Missed", ar: "ملغاة" },
};

const WEEKDAY_SHORT: Record<"en" | "ar", string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ar: ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"],
};

function Card({
  icon,
  title,
  action,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm p-5 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-slate-400">
          {icon}
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200/60 px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="font-figure text-[22px] leading-tight text-slate-900 mt-1">{value}</p>
      {sub ? <div className="mt-0.5">{sub}</div> : null}
    </div>
  );
}

function Delta({ percent, isRTL }: { percent: number | null; isRTL: boolean }) {
  if (percent === null) return <span className="text-[11px] font-bold text-slate-300">—</span>;
  const tone = percent > 0 ? "text-emerald-600" : percent < 0 ? "text-rose-600" : "text-slate-400";
  const arrow = percent > 0 ? "▲" : percent < 0 ? "▼" : "—";
  return (
    <span className={`font-figure text-[11px] ${tone}`} dir={isRTL ? "rtl" : "ltr"}>
      {arrow} {Math.abs(percent)}%
    </span>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] font-bold text-slate-400">{label}</span>
      <span className="font-figure text-[14px] text-slate-900">{value}</span>
    </div>
  );
}

function ActionList({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-200/60 overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200/60 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</span>
        <span className="font-figure text-[13px] text-slate-900 bg-white border border-slate-200 rounded-full px-2 leading-5">
          {count}
        </span>
      </div>
      <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">{children}</div>
    </div>
  );
}

function Row({
  href,
  name,
  meta,
}: {
  href?: string;
  name: string;
  meta?: React.ReactNode;
}) {
  const label = href ? (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[13px] font-bold text-slate-800 hover:text-violet-600 truncate transition-colors"
    >
      {name}
      <ArrowUpRight size={11} className="shrink-0" />
    </Link>
  ) : (
    <span className="text-[13px] font-bold text-slate-800 truncate">{name}</span>
  );

  return (
    <div className="px-4 py-2 flex items-center justify-between gap-3">
      {label}
      {meta ? <span className="shrink-0 text-[11px]">{meta}</span> : null}
    </div>
  );
}

export default function BriefingView({ period }: { period: Period }) {
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";

  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clinicInfo, setClinicInfo] = useState<{ name: string; logoUrl: string; currency: string }>({
    name: "Alpha Dental",
    logoUrl: "",
    currency: "EGP",
  });

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("no session");

      const res = await fetch(
        `/api/ai/daily-briefing?clinicId=${encodeURIComponent(clinicId)}&period=${period}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "failed");
      setBriefing(data.briefing as Briefing);
    } catch {
      setError(isAr ? "معرفناش نجهّز الملخص. جرّب تاني." : "Could not build the brief. Try again.");
    } finally {
      setLoading(false);
    }
  }, [clinicId, period, isAr]);

  useEffect(() => {
    void load();
  }, [load]);

  // Clinic identity for the printed header. Read once, and failures are silent — a brief without a
  // logo is still a brief.
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        // One read through the shared helper, which knows where the clinic's details live and
        // still falls back to the retired `clinicProfile` document for a clinic that has not
        // saved its profile since the two were merged.
        const profile = await getClinicProfile();
        if (cancelled) return;
        setClinicInfo({
          name: profile?.clinicName?.trim() || "Alpha Dental",
          logoUrl: profile?.logoUrl || "",
          currency: profile?.currency?.trim() || "EGP",
        });
      } catch {
        /* keeps the defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const locale = isAr ? "ar-EG" : "en-US";
  const money = useMemo(
    () => (n: number) => `${Math.round(n).toLocaleString(locale)} ${clinicInfo.currency}`,
    [locale, clinicInfo.currency]
  );
  const num = useMemo(() => (n: number) => Math.round(n).toLocaleString(locale), [locale]);
  const hours = useCallback(
    (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}`,
    []
  );

  const onPrint = useCallback(() => {
    if (!briefing) return;
    printBriefing({
      briefing,
      clinicName: clinicInfo.name,
      clinicLogoUrl: clinicInfo.logoUrl || undefined,
      language: isAr ? "ar" : "en",
      currency: clinicInfo.currency,
    });
  }, [briefing, clinicInfo, isAr]);

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <Loader2 size={22} className="animate-spin text-slate-300" />
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="bg-white rounded-[2rem] border border-slate-200/60 p-8 text-center">
        <p className="text-[13px] font-bold text-slate-500">{error}</p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink-slab px-5 py-2 text-xs font-bold text-white"
        >
          <RefreshCw size={13} />
          {isAr ? "إعادة المحاولة" : "Try again"}
        </button>
      </div>
    );
  }

  const b = briefing;
  const isWeek = b.period === "week";

  const headlineTiles: { label: string; value: string }[] = [
    ...(b.headline.collected !== null
      ? [{ label: isAr ? "المحصّل" : "Collected", value: money(b.headline.collected) }]
      : []),
    { label: isAr ? "مرضى تم استقبالهم" : "Patients seen", value: num(b.headline.patientsSeen) },
    { label: isAr ? "لم يحضروا بعد" : "Still to come", value: num(b.headline.stillToCome) },
    { label: isAr ? "ملغاة / لم يحضروا" : "Missed", value: num(b.headline.missed) },
    ...(b.headline.staffOnFloor !== null
      ? [{ label: isAr ? "داخل العيادة الآن" : "On the floor", value: num(b.headline.staffOnFloor) }]
      : []),
  ];

  return (
    <div className="space-y-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* --- The slab: the one dark surface, carrying the numbers that matter most --- */}
      <div className="bg-ink-slab text-white rounded-[2rem] p-5 md:p-7 shadow-[0_12px_40px_rgba(26,33,48,0.18)]">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-[#C8A24A]">
              <Sparkles size={14} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                {isWeek ? (isAr ? "ملخص الأسبوع" : "Weekly Brief") : isAr ? "ملخص اليوم" : "Daily Brief"}
              </span>
            </div>
            <p className="font-figure text-lg md:text-xl mt-1 text-white/90">
              {isWeek ? `${b.startDate} — ${b.endDate}` : b.startDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              title={isAr ? "تحديث" : "Refresh"}
              className="rounded-full border border-white/15 p-2 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onPrint}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-ink-slab hover:bg-white/90 transition-colors"
            >
              <Printer size={14} />
              {isAr ? "طباعة PDF" : "Print PDF"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {headlineTiles.map((tile) => (
            <div key={tile.label} className="rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">{tile.label}</p>
              <p className="font-figure text-[20px] md:text-[23px] leading-tight mt-1 text-white">{tile.value}</p>
            </div>
          ))}
        </div>

        {b.redacted.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-white/45">
            <Lock size={12} />
            <p className="text-[11px] font-semibold">
              {isAr ? "مخفي حسب صلاحياتك: " : "Hidden by your permissions: "}
              {b.redacted
                .map((r) =>
                  r === "money" ? (isAr ? "الحسابات" : "money") : isAr ? "فريق العمل" : "staff & payroll"
                )
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      {/* --- Week on week --- */}
      {b.trend && (
        <Card icon={<TrendingUp size={13} />} title={isAr ? "هذا الأسبوع مقابل الماضي" : "This week against last"}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {b.trend.points.map((pt) => (
              <Stat
                key={pt.key}
                label={TREND_COPY[pt.key]?.[isAr ? "ar" : "en"] ?? pt.key}
                value={pt.isMoney ? money(pt.current) : num(pt.current)}
                sub={<Delta percent={pt.changePercent} isRTL={isRTL} />}
              />
            ))}
          </div>

          <div className="mt-5 flex items-end gap-2 h-24">
            {b.trend.daily.map((d) => {
              const value = d.collected ?? d.patientsSeen;
              const max = Math.max(1, ...b.trend!.daily.map((x) => (x.collected ?? x.patientsSeen) || 0));
              return (
                <div key={d.dateKey} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div
                    className="w-full rounded-t-md bg-ink-slab"
                    style={{ height: `${Math.max(3, (value / max) * 72)}px` }}
                    title={`${d.dateKey} · ${d.collected !== null ? money(d.collected) : num(d.patientsSeen)}`}
                  />
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1.5">
                    {WEEKDAY_SHORT[isAr ? "ar" : "en"][d.weekday]}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {b.trend.bestDay && <KeyValue label={isAr ? "أفضل يوم" : "Best day"} value={b.trend.bestDay} />}
            {b.trend.quietestDay && (
              <KeyValue label={isAr ? "أهدأ يوم" : "Quietest day"} value={b.trend.quietestDay} />
            )}
            {b.trend.collectionRate !== null && (
              <KeyValue
                label={isAr ? "المحصّل مقابل المحسوب" : "Collected vs billed"}
                value={`${b.trend.collectionRate}%`}
              />
            )}
            {b.trend.payrollMonthToDate !== null && (
              <KeyValue
                label={isAr ? "الأجور منذ بداية الشهر" : "Payroll, month to date"}
                value={money(b.trend.payrollMonthToDate)}
              />
            )}
          </div>

          {b.trend.topProcedures.length > 0 && (
            <div className="mt-5 rounded-2xl border border-slate-200/60 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200/60">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {isAr ? "الأكثر إجراءً" : "Most done"}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {b.trend.topProcedures.map((proc) => (
                  <Row
                    key={proc.name}
                    name={proc.name}
                    meta={
                      <span className="font-figure text-[13px] text-slate-900">
                        {num(proc.count)}
                        {proc.revenue !== null ? (
                          <span className="text-slate-400"> · {money(proc.revenue)}</span>
                        ) : null}
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* --- Money --- */}
      {b.money && (
        <Card icon={<Wallet size={13} />} title={isAr ? "الحسابات" : "Money"}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Stat label={isAr ? "المحصّل" : "Collected"} value={money(b.money.collected)} />
            <Stat label={isAr ? "المصروفات" : "Expenses"} value={money(b.money.expenses)} />
            <Stat label={isAr ? "صافي النقد" : "Net cash"} value={money(b.money.netCash)} />
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {b.money.comparison.previousCollected !== null && (
              <KeyValue
                label={isAr ? "السابق" : "Previous"}
                value={money(b.money.comparison.previousCollected)}
              />
            )}
            {b.money.comparison.sameWeekdayCollected !== null && (
              <KeyValue
                label={isAr ? "نفس اليوم الأسبوع الماضي" : "Same day last week"}
                value={money(b.money.comparison.sameWeekdayCollected)}
              />
            )}
            {b.money.discounts > 0 && (
              <KeyValue label={isAr ? "خصومات" : "Discounts"} value={money(b.money.discounts)} />
            )}
            {b.money.labFees > 0 && (
              <KeyValue label={isAr ? "رسوم المعمل" : "Lab fees"} value={money(b.money.labFees)} />
            )}
            {b.money.doctorCommissions > 0 && (
              <KeyValue label={isAr ? "عمولات الأطباء" : "Commissions"} value={money(b.money.doctorCommissions)} />
            )}
            {b.money.clinicProfit !== 0 && (
              <KeyValue label={isAr ? "نصيب العيادة" : "Clinic share"} value={money(b.money.clinicProfit)} />
            )}
            {b.money.billedUnpaid > 0 && (
              <KeyValue
                label={isAr ? "محسوب ولم يُدفع" : "Billed, not yet paid"}
                value={money(b.money.billedUnpaid)}
              />
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            {b.money.byMethod.length > 0 && (
              <ActionList title={isAr ? "طريقة الدفع" : "How it was paid"} count={b.money.byMethod.length}>
                {b.money.byMethod.map((s) => (
                  <Row
                    key={s.method}
                    name={s.method}
                    meta={<span className="font-figure text-[13px] text-slate-900">{money(s.amount)}</span>}
                  />
                ))}
              </ActionList>
            )}
            {b.money.expensesByCategory.length > 0 && (
              <ActionList
                title={isAr ? "أوجه الصرف" : "Where it went"}
                count={b.money.expensesByCategory.length}
              >
                {b.money.expensesByCategory.map((s) => (
                  <Row
                    key={s.category}
                    name={s.category}
                    meta={<span className="font-figure text-[13px] text-slate-900">{money(s.amount)}</span>}
                  />
                ))}
              </ActionList>
            )}
          </div>
        </Card>
      )}

      {/* --- Production --- */}
      {b.production && (b.production.doctors.length > 0 || b.production.chairUtilisation) && (
        <Card icon={<ClipboardList size={13} />} title={isAr ? "الإنتاج" : "Production"}>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            {b.production.revenuePerPatientSeen !== null && (
              <KeyValue
                label={isAr ? "متوسط الإيراد لكل مريض" : "Revenue per patient"}
                value={money(b.production.revenuePerPatientSeen)}
              />
            )}
            {b.production.chairUtilisation && (
              <KeyValue
                label={isAr ? "استغلال وقت الكرسي" : "Chair time used"}
                value={`${b.production.chairUtilisation.percent}%`}
              />
            )}
            {b.production.busiestHour && (
              <KeyValue
                label={isAr ? "أكثر ساعة ازدحاماً" : "Busiest hour"}
                value={`${b.production.busiestHour.hour} · ${num(b.production.busiestHour.count)}`}
              />
            )}
            {b.production.biggestGap && (
              <KeyValue
                label={isAr ? "أكبر فجوة" : "Biggest gap"}
                value={`${b.production.biggestGap.startsAt} · ${num(b.production.biggestGap.minutes)}${
                  isAr ? "د" : "m"
                }`}
              />
            )}
          </div>

          {b.production.doctors.length > 0 && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <th className={`py-2 px-1 ${isRTL ? "text-right" : "text-left"}`}>
                      {isAr ? "الطبيب" : "Doctor"}
                    </th>
                    <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>{isAr ? "مرضى" : "Seen"}</th>
                    <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>
                      {isAr ? "إجراءات" : "Procedures"}
                    </th>
                    <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>
                      {isAr ? "المحصّل" : "Collected"}
                    </th>
                    <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>
                      {isAr ? "العمولة" : "Commission"}
                    </th>
                    <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>
                      {isAr ? "العيادة" : "Clinic"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {b.production.doctors.map((d) => (
                    <tr key={d.key}>
                      <td className="py-2 px-1 text-[13px] font-bold text-slate-800">{d.name}</td>
                      <td className={`py-2 px-1 font-figure text-[13px] text-slate-900 ${isRTL ? "text-left" : "text-right"}`}>
                        {num(d.patientsSeen)}
                      </td>
                      <td className={`py-2 px-1 font-figure text-[13px] text-slate-900 ${isRTL ? "text-left" : "text-right"}`}>
                        {num(d.procedures)}
                      </td>
                      <td className={`py-2 px-1 font-figure text-[13px] text-slate-900 ${isRTL ? "text-left" : "text-right"}`}>
                        {money(d.collected)}
                      </td>
                      <td className={`py-2 px-1 font-figure text-[13px] text-slate-500 ${isRTL ? "text-left" : "text-right"}`}>
                        {money(d.commission)}
                      </td>
                      <td className={`py-2 px-1 font-figure text-[13px] text-slate-900 ${isRTL ? "text-left" : "text-right"}`}>
                        {money(d.clinicProfit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* --- The floor --- */}
      {b.hr && b.hr.staff.length > 0 && (
        <Card icon={<Users size={13} />} title={isAr ? "فريق العمل" : "The floor"}>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            <KeyValue label={isAr ? "تكلفة العمالة" : "Labour cost"} value={money(b.hr.labourCost)} />
            <KeyValue label={isAr ? "إجمالي الساعات" : "Total hours"} value={hours(b.hr.totalMinutes)} />
            {b.hr.overtimePendingMinutes > 0 && (
              <KeyValue
                label={isAr ? "إضافي بانتظار الموافقة" : "Overtime awaiting approval"}
                value={`${hours(b.hr.overtimePendingMinutes)} · ${money(b.hr.overtimePendingCost)}`}
              />
            )}
            {b.hr.openShifts > 0 && (
              <KeyValue label={isAr ? "لم يسجّل خروجاً" : "Never clocked out"} value={num(b.hr.openShifts)} />
            )}
          </div>

          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <th className={`py-2 px-1 ${isRTL ? "text-right" : "text-left"}`}>{isAr ? "الاسم" : "Name"}</th>
                  <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>{isAr ? "ساعات" : "Hours"}</th>
                  <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>{isAr ? "تأخير" : "Late"}</th>
                  <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>{isAr ? "غياب" : "Absent"}</th>
                  <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>{isAr ? "إضافي" : "Overtime"}</th>
                  <th className={`py-2 px-1 ${isRTL ? "text-left" : "text-right"}`}>
                    {isAr ? "الأجر التقديري" : "Est. pay"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {b.hr.staff.map((s) => (
                  <tr key={s.staffId}>
                    <td className="py-2 px-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-slate-800">{s.name}</span>
                        {s.activeNow && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        <span className="text-[10px] font-bold text-slate-400">{s.role}</span>
                        {s.flags.map((f) => (
                          <span
                            key={f}
                            className="text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1"
                          >
                            {FLAG_COPY[f]?.[isAr ? "ar" : "en"] ?? f}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={`py-2 px-1 font-figure text-[13px] text-slate-900 ${isRTL ? "text-left" : "text-right"}`}>
                      {hours(s.minutesWorked)}
                    </td>
                    <td className={`py-2 px-1 font-figure text-[13px] ${s.lateDays > 0 ? "text-amber-600" : "text-slate-300"} ${isRTL ? "text-left" : "text-right"}`}>
                      {s.lateDays > 0 ? `${num(s.lateDays)} · ${num(s.lateMinutes)}${isAr ? "د" : "m"}` : "—"}
                    </td>
                    <td className={`py-2 px-1 font-figure text-[13px] ${s.absentDays > 0 ? "text-rose-600" : "text-slate-300"} ${isRTL ? "text-left" : "text-right"}`}>
                      {s.absentDays > 0 ? num(s.absentDays) : "—"}
                    </td>
                    <td className={`py-2 px-1 font-figure text-[13px] text-slate-500 ${isRTL ? "text-left" : "text-right"}`}>
                      {s.overtimeApprovedMinutes + s.overtimePendingMinutes > 0
                        ? hours(s.overtimeApprovedMinutes + s.overtimePendingMinutes)
                        : "—"}
                    </td>
                    <td className={`py-2 px-1 font-figure text-[13px] text-slate-900 ${isRTL ? "text-left" : "text-right"}`}>
                      {s.estimatedPay > 0 ? money(s.estimatedPay) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Link
            href="/attendance"
            className="inline-flex items-center gap-1 mt-4 text-[11px] font-black uppercase tracking-widest text-violet-600 hover:text-violet-700"
          >
            {isAr ? "فتح الحضور والأجور" : "Open attendance & payroll"}
            <ArrowUpRight size={12} />
          </Link>
        </Card>
      )}

      {/* --- Needs action --- */}
      <Card icon={<AlertCircle size={13} />} title={isAr ? "يحتاج تدخّلاً" : "Needs someone to act"}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionList
            title={isAr ? "مواعيد ماضية لم تُغلق" : "Past appointments never closed out"}
            count={b.actions.unresolvedCount}
          >
            {b.actions.unresolvedAppointments.map((i) => (
              <Row
                key={i.id}
                href={i.patientId ? `/patients/${i.patientId}` : "/appointments"}
                name={i.patientName}
                meta={
                  <span className="font-figure text-[12px] text-slate-400">
                    {num(i.daysAgo || 0)}
                    {isAr ? " يوم" : "d"}
                  </span>
                }
              />
            ))}
          </ActionList>

          <ActionList
            title={isAr ? "حضروا وخرجوا بلا موعد قادم" : "Seen, no next appointment"}
            count={b.actions.seenWithoutNextVisitCount}
          >
            {b.actions.seenWithoutNextVisit.map((i) => (
              <Row
                key={i.id}
                href={i.patientId ? `/patients/${i.patientId}` : undefined}
                name={i.patientName}
                meta={<span className="text-[11px] font-bold text-slate-400">{i.detail}</span>}
              />
            ))}
          </ActionList>

          <ActionList
            title={isAr ? "عمل محسوب بلا حجز" : "Billed work, nothing booked"}
            count={b.actions.billedWithoutBookingCount}
          >
            {b.actions.billedWithoutBooking.map((i) => (
              <Row
                key={i.id}
                href={`/patients/${i.patientId}?tab=finance`}
                name={i.patientName}
                meta={
                  i.amount !== undefined ? (
                    <span className="font-figure text-[13px] text-slate-900">{money(i.amount)}</span>
                  ) : null
                }
              />
            ))}
          </ActionList>

          <ActionList
            title={isAr ? "متابعات عملاء متأخرة" : "Lead follow-ups overdue"}
            count={b.actions.overdueFollowUpCount}
          >
            {b.actions.overdueFollowUps.map((i) => (
              <Row
                key={i.id}
                href="/leads"
                name={i.patientName}
                meta={
                  <span className="font-figure text-[12px] text-amber-600">
                    {num(i.daysAgo || 0)}
                    {isAr ? " يوم" : "d"}
                  </span>
                }
              />
            ))}
          </ActionList>

          <ActionList
            title={isAr ? "أرصدة بلا حركة حديثة" : "Balances with no recent activity"}
            count={b.actions.staleBalances.length}
          >
            {b.actions.staleBalances.map((i) => (
              <Row
                key={i.patientId}
                href={`/patients/${i.patientId}?tab=finance`}
                name={i.patientName}
                meta={
                  <span className="font-figure text-[13px] text-slate-900">
                    {money(i.balance)}
                    <span className="text-amber-600">
                      {" "}
                      · {num(i.daysSinceLastActivity)}
                      {isAr ? " يوم" : "d"}
                    </span>
                  </span>
                }
              />
            ))}
          </ActionList>
        </div>

        {b.actions.unresolvedCount === 0 &&
          b.actions.seenWithoutNextVisitCount === 0 &&
          b.actions.billedWithoutBookingCount === 0 &&
          b.actions.overdueFollowUpCount === 0 &&
          b.actions.staleBalances.length === 0 && (
            <p className="text-[13px] font-medium text-slate-400 text-center py-4">
              {isAr ? "لا يوجد ما يحتاج تدخّلاً." : "Nothing needs chasing."}
            </p>
          )}
      </Card>

      {/* --- Growth & stock --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card icon={<UserPlus size={13} />} title={isAr ? "النمو" : "Growth"}>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={isAr ? "مرضى جدد" : "New patients"} value={num(b.growth.newPatients)} />
            <Stat label={isAr ? "عملاء جدد" : "New leads"} value={num(b.growth.newLeads)} />
            <Stat label={isAr ? "تحوّلوا لمرضى" : "Converted"} value={num(b.growth.leadsConverted)} />
            <Stat
              label={isAr ? "عملاء أقدم بلا تواصل" : "Older leads untouched"}
              value={num(b.growth.leadsUntouched)}
            />
          </div>
          {b.growth.leadsBySource.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {b.growth.leadsBySource.map((s) => (
                <span
                  key={s.source}
                  className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200/60 rounded-full px-3 py-1"
                >
                  {s.source} <span className="font-figure text-slate-900">{num(s.count)}</span>
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card icon={<Boxes size={13} />} title={isAr ? "المخزون" : "Stock"}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={isAr ? "منخفض" : "Low"} value={num(b.stock.lowCount)} />
            <Stat label={isAr ? "نفد" : "Out"} value={num(b.stock.outOfStockCount)} />
            <Stat label={isAr ? "بلا حد" : "No threshold"} value={num(b.stock.noThresholdCount)} />
          </div>
          {b.stock.low.length > 0 && (
            <div className="mt-4 divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {b.stock.low.map((i) => (
                <Row
                  key={i.itemId}
                  href="/inventory"
                  name={i.name}
                  meta={
                    <span className={`font-figure text-[13px] ${i.outOfStock ? "text-rose-600" : "text-amber-600"}`}>
                      {num(i.stock)} / {num(i.minStock)} {i.unit}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* --- Coming up --- */}
      <Card
        icon={<CalendarDays size={13} />}
        title={`${isAr ? "القادم" : "Coming up"} — ${
          b.nextUp.key === "tomorrow" ? (isAr ? "غداً" : "Tomorrow") : isAr ? "الأسبوع القادم" : "Next week"
        }`}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label={isAr ? "مواعيد" : "Appointments"} value={num(b.nextUp.appointments)} />
          {b.nextUp.firstAppointmentTime && (
            <Stat label={isAr ? "أول موعد" : "First at"} value={b.nextUp.firstAppointmentTime} />
          )}
          <Stat label={isAr ? "غير مؤكدة" : "Unconfirmed"} value={num(b.nextUp.unconfirmed)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {b.nextUp.doctors.length > 0 && (
            <KeyValue label={isAr ? "الأطباء" : "Doctors on"} value={b.nextUp.doctors.join(" · ")} />
          )}
          {b.nextUp.staffRostered && b.nextUp.staffRostered.length > 0 && (
            <KeyValue label={isAr ? "المناوبة" : "Rostered"} value={b.nextUp.staffRostered.join(" · ")} />
          )}
        </div>
      </Card>

      {/* --- Today's schedule, daily only --- */}
      {!isWeek && b.appointments.length > 0 && (
        <Card icon={<Clock size={13} />} title={isAr ? "جدول اليوم" : "Today's schedule"}>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {b.appointments.map((a) => (
              <div key={a.id} className="px-1 py-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-figure text-[12px] text-slate-400 shrink-0 w-[64px]">{a.time || "—"}</span>
                  <Link
                    href={a.patientId ? `/patients/${a.patientId}` : "/appointments"}
                    className="text-[13px] font-bold text-slate-800 hover:text-violet-600 truncate transition-colors"
                  >
                    {a.patientName}
                  </Link>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* --- Notes --- */}
      {b.notes.length > 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-200/60 p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
            {isAr ? "ملاحظات مهمة" : "Worth knowing"}
          </p>
          <ul className="space-y-2">
            {b.notes.map((n, i) => (
              <li
                key={i}
                className={`text-[11px] font-medium text-slate-500 leading-relaxed ${
                  isRTL ? "border-r-2 pr-3" : "border-l-2 pl-3"
                } border-slate-200`}
              >
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
