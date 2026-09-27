"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Timestamp, onSnapshot, query, where } from "firebase/firestore";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { auth } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { localYmd } from "@/lib/clinicDate";
import { LAB_CASES_COLLECTION } from "@/lib/labCases";
import { clinicDayBoundsMinutes, parseClinicSchedule } from "@/lib/clinicSchedule";
import { weekDaysFrom } from "@/lib/weekSchedule";
import { TARGETS_DOC, parseTargets, type ClinicTargets } from "@/lib/clinicTargets";
import type { Briefing, HrStaffRow } from "@/lib/automation/briefing/types";
import type { Row } from "@/lib/dentistHome";
import { cashToday, labChase, periodStart, sourcesOf, waitingRoom } from "@/lib/ownerHome";
import {
  billedByDoctor,
  botShare,
  cashBySource,
  cashPace,
  dayFraction,
  monthFraction,
  needsYou,
  noShowSpike,
  noShowsByWeek,
  targetProgress,
  type NeedsYouItem,
} from "@/lib/ownerAlerts";
import PageHeader from "@/components/dashboard/PageHeader";
import HomeViewTabs from "@/components/dashboard/HomeViewTabs";
import Sparkline from "@/components/dashboard/Sparkline";

/**
 * The owner's home: what needs you, then is the money moving, then the clinic in four tabs.
 *
 * Rebuilt around what the owner said he opens it for (a twenty-question sitting, 2026-09-27):
 * several times a day, on every device, and the first thing he wants answered is "what is wrong
 * that needs me". So the top of the screen is the list of things that are actually wrong — cash
 * behind last month's pace, lab work late, staff absent, tomorrow unconfirmed, no-shows spiking —
 * and it is empty when nothing is. Under it, cash against the same span of last month with a
 * trend line, the two monthly targets, and the waiting room this minute. Then four tabs holding
 * only what he picked: Money (cash, owed, per dentist: work done, collected, share), Team (late
 * and absent today, overtime, pay owed), The floor (waiting, chair use, no-shows by week), Growth
 * (new patients against target, sources by count and by money, how much of WhatsApp the bot
 * carried alone). The period he last chose is remembered.
 *
 * The period figures come from The Brief's engine (/api/ai/daily-briefing) — one tested engine
 * rather than a second copy of the arithmetic. The live pieces read the browser's own listeners,
 * because "3 waiting, longest 18 minutes" is only worth showing if it is true this minute. The
 * rules for pace, targets and the alert list are in lib/ownerAlerts.ts, pinned by its test.
 *
 * This is the one screen where dentists are compared by name. Their own screens never are.
 */

type Period = "day" | "week" | "month";
type Tab = "money" | "team" | "floor" | "growth";
const INK = "var(--ink-slab)";
const MUTED = "#CBD5E1";

export default function OwnerHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { ownerPeriod: period, setOwnerPeriod: setPeriod } = useUI();
  const { branches, activeBranch, matches } = useActiveBranch();
  const isAr = language === "ar";
  const today = localYmd();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // --- The Brief, per period ---------------------------------------------------------------------
  const [tab, setTab] = useState<Tab>("money");
  const [briefs, setBriefs] = useState<Partial<Record<Period, Briefing>>>({});
  const [loadingPeriod, setLoadingPeriod] = useState<Period | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: Period) => {
      if (!clinicId) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`/api/ai/daily-briefing?clinicId=${encodeURIComponent(clinicId)}&period=${p}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "failed");
        setBriefs((prev) => ({ ...prev, [p]: data.briefing as Briefing }));
        setError(null);
      } catch {
        setError(isAr ? "معرفناش نجيب الأرقام. جرّب تاني." : "Could not load the numbers. Try again.");
      }
    },
    [clinicId, isAr]
  );

  // The day brief feeds the alerts and refreshes on its own; the chosen period loads on demand.
  useEffect(() => {
    void load("day");
    const id = setInterval(() => void load("day"), 180_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (briefs[period]) return;
    setLoadingPeriod(period);
    void load(period).finally(() => setLoadingPeriod((cur) => (cur === period ? null : cur)));
  }, [period, load, briefs]);
  const refresh = () => {
    setLoadingPeriod(period);
    void Promise.all([load("day"), period === "day" ? Promise.resolve() : load(period)]).finally(() => setLoadingPeriod(null));
  };

  const dayBrief = briefs.day;
  const brief = briefs[period];

  // --- Live rows ----------------------------------------------------------------------------------
  const [ledgerToday, setLedgerToday] = useState<Row[]>([]);
  const [apptsToday, setApptsToday] = useState<Row[]>([]);
  const [labAtLab, setLabAtLab] = useState<Row[]>([]);
  const [targets, setTargets] = useState<ClinicTargets>({ monthlyRevenue: 0, monthlyNewPatients: 0 });
  const [schedule, setSchedule] = useState(() => parseClinicSchedule(null));
  const [apptsRecent, setApptsRecent] = useState<Row[]>([]);

  useEffect(() => {
    if (!clinicId) return;
    const rows = (s: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): Row[] => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Four weeks back, for the no-show trend — the brief only carries the period on screen.
    const fourWeeksAgo = (() => {
      const d = new Date(`${weekDaysFrom(today)[0]}T12:00:00`);
      d.setDate(d.getDate() - 21);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const unsubs = [
      onSnapshot(query(getClinicCollection("ledger"), where("date", "==", today)), (s) => setLedgerToday(rows(s))),
      onSnapshot(query(getClinicCollection("appointments"), where("date", "==", today)), (s) => setApptsToday(rows(s))),
      onSnapshot(query(getClinicCollection("appointments"), where("date", ">=", fourWeeksAgo), where("date", "<=", today)), (s) => setApptsRecent(rows(s))),
      onSnapshot(query(getClinicCollection(LAB_CASES_COLLECTION), where("status", "==", "at_lab")), (s) => setLabAtLab(rows(s))),
      onSnapshot(getClinicDoc("settings", TARGETS_DOC), (s) => setTargets(parseTargets(s.exists() ? (s.data() as Record<string, unknown>) : null))),
      onSnapshot(getClinicDoc("settings", "clinic_info"), (s) => setSchedule(parseClinicSchedule(s.exists() ? (s.data() as Record<string, unknown>) : null))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [clinicId, today]);

  // Since the period began: new patients (where from), the ledger (cash by source, work billed
  // per dentist), and WhatsApp conversations (how much the bot carried alone).
  const start = periodStart(period, today);
  const [patientsSince, setPatientsSince] = useState<Row[]>([]);
  const [ledgerSince, setLedgerSince] = useState<Row[]>([]);
  const [conversationsSince, setConversationsSince] = useState<Row[]>([]);
  useEffect(() => {
    if (!clinicId) return;
    const sinceDate = new Date(`${start}T00:00:00`);
    const since = Timestamp.fromDate(sinceDate);
    const rows = (s: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): Row[] => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const unsubs = [
      onSnapshot(query(getClinicCollection("patients"), where("createdAt", ">=", since)), (s) => setPatientsSince(rows(s))),
      onSnapshot(query(getClinicCollection("ledger"), where("date", ">=", start), where("date", "<=", today)), (s) => setLedgerSince(rows(s)), () => setLedgerSince([])),
      onSnapshot(query(getClinicCollection("whatsapp_conversations"), where("lastMessageAt", ">=", sinceDate.getTime())), (s) => setConversationsSince(rows(s)), () => setConversationsSince([])),
    ];
    return () => unsubs.forEach((u) => u());
  }, [clinicId, start, today]);

  // The debtors list has no live twin.
  const [dues, setDues] = useState<{ totalOwed: number; patients: number; rows: Array<{ patientId: string; patientName: string; totalOwed: number }> } | null>(null);
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const duesRes = await fetch(`/api/finance/recovery?clinicId=${encodeURIComponent(clinicId)}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        if (cancelled) return;
        if (duesRes?.ok) setDues({ totalOwed: Number(duesRes.totals?.totalOwed) || 0, patients: Number(duesRes.totals?.patients) || 0, rows: (duesRes.rows || []).slice(0, 3) });
      } catch {
        /* the tile says "—" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  // --- What the screen is made of ---------------------------------------------------------------------
  const inBranch = useCallback((a: Row) => matches(a.branchId as string | null | undefined), [matches]);
  const cash = useMemo(() => cashToday(ledgerToday, today), [ledgerToday, today]);
  const room = useMemo(() => waitingRoom(apptsToday.filter(inBranch), now), [apptsToday, inBranch, now]);
  const lab = useMemo(() => labChase(labAtLab, today), [labAtLab, today]);
  const roomsTotal = activeBranch ? activeBranch.rooms.length : branches.reduce((n, b) => n + b.rooms.length, 0);

  const hr = brief?.hr;
  const dayHr = dayBrief?.hr;
  const onFloor = dayHr?.onFloorNow ?? null;
  const rostered = dayHr ? dayHr.staff.filter((s) => s.hasSchedule).length || dayHr.staff.length : null;
  const lateToday = dayHr ? dayHr.staff.filter((s) => s.lateDays > 0) : [];
  const absentToday = dayHr ? dayHr.staff.filter((s) => s.absentDays > 0) : [];
  const overtimeStaff = hr ? hr.staff.filter((s) => s.overtimePendingMinutes > 0) : [];

  const moneyHidden = !!brief && brief.redacted.includes("money");
  const hrHidden = !!brief && brief.redacted.includes("hr");

  // Cash for the period on screen, and what the same span brought in last time. Today's figure is
  // live and measured against the same weekday last week, prorated to how much of the day has gone;
  // the week and month briefs already compare equal windows.
  const bounds = clinicDayBoundsMinutes(schedule);
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const elapsedDay = dayFraction(nowMinutes, bounds.start, bounds.end);
  const periodCash = period === "day" ? cash.collected : brief?.money?.collected ?? null;
  const previousCash = period === "day" ? dayBrief?.money?.comparison.sameWeekdayCollected ?? null : brief?.money?.comparison.previousCollected ?? null;
  const pace = useMemo(() => cashPace(periodCash ?? 0, previousCash, period === "day" ? elapsedDay : 1), [periodCash, previousCash, period, elapsedDay]);

  const monthBrief = briefs.month;
  const monthElapsed = monthFraction(today);
  const revenueTarget = useMemo(() => targetProgress(monthBrief?.money?.collected ?? 0, targets.monthlyRevenue, monthElapsed), [monthBrief, targets.monthlyRevenue, monthElapsed]);
  const patientsTarget = useMemo(() => targetProgress(monthBrief?.growth.newPatients ?? 0, targets.monthlyNewPatients, monthElapsed), [monthBrief, targets.monthlyNewPatients, monthElapsed]);
  // The month brief feeds the target bars whatever period is on screen.
  useEffect(() => {
    if ((targets.monthlyRevenue > 0 || targets.monthlyNewPatients > 0) && !briefs.month) void load("month");
  }, [targets, briefs.month, load]);

  const weeks = useMemo(() => noShowsByWeek(apptsRecent.filter(inBranch), today, 4), [apptsRecent, inBranch, today]);
  const spike = useMemo(() => noShowSpike(weeks), [weeks]);

  const alerts = useMemo<NeedsYouItem[]>(
    () =>
      needsYou({
        pace,
        labLate: lab.late,
        labDueToday: lab.dueToday,
        absentToday: absentToday.length,
        lateToday: lateToday.length,
        unconfirmedTomorrow: dayBrief?.actions.unconfirmedAhead ?? 0,
        noShows: spike,
        overtimePending: dayHr ? dayHr.staff.filter((s) => s.overtimePendingMinutes > 0).length : 0,
      }),
    [pace, lab, absentToday.length, lateToday.length, dayBrief, spike, dayHr]
  );

  const sources = useMemo(() => sourcesOf(patientsSince, isAr ? "غير معروف" : "Unknown"), [patientsSince, isAr]);
  const sourceCash = useMemo(() => cashBySource(ledgerSince, patientsSince, isAr ? "غير معروف" : "Unknown"), [ledgerSince, patientsSince, isAr]);
  const billed = useMemo(() => billedByDoctor(ledgerSince), [ledgerSince]);
  const bot = useMemo(() => botShare(conversationsSince), [conversationsSince]);

  const fmt = (n: number) => Math.round(n).toLocaleString(isAr ? "ar-EG" : "en-US");
  const hours = (mins: number) => `${Math.round(mins / 60)} ${isAr ? "س" : "h"}`;
  const egp = isAr ? "ج.م" : "EGP";

  const hour = new Date(now).getHours();
  const greeting = isAr ? (hour < 12 ? "صباح الخير،" : "مساء الخير،") : hour < 12 ? "Good morning," : hour < 18 ? "Good afternoon," : "Good evening,";
  const firstName = (user?.name || "").split(" ").filter(Boolean)[0] || "";
  const dateLine = new Date(now).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  const timeLine = new Date(now).toLocaleTimeString(isAr ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  const periods: Array<{ key: Period; label: string }> = [
    { key: "day", label: isAr ? "النهارده" : "Today" },
    { key: "week", label: isAr ? "الأسبوع ده" : "This week" },
    { key: "month", label: isAr ? "الشهر ده" : "This month" },
  ];
  const periodWord = period === "day" ? (isAr ? "نفس اليوم الأسبوع اللي فات" : "same weekday last week") : period === "week" ? (isAr ? "الأسبوع اللي فات" : "last week") : (isAr ? "نفس الأيام الشهر اللي فات" : "the same days last month");
  const tabs: Array<{ key: Tab; label: string; badge: string }> = [
    { key: "money", label: isAr ? "الفلوس" : "Money", badge: brief?.money ? compact(brief.money.collected) : "" },
    { key: "team", label: isAr ? "الفريق" : "Team", badge: onFloor !== null && rostered !== null ? `${onFloor}/${rostered}` : "" },
    { key: "floor", label: isAr ? "الصالة" : "The floor", badge: room.waiting.length ? String(room.waiting.length) : "" },
    { key: "growth", label: isAr ? "النمو" : "Growth", badge: brief ? String(brief.growth.newPatients) : "" },
  ];
  const eyebrow = "font-display text-[11px] font-black uppercase tracking-[0.12em] text-ink-muted";
  const ghost = "inline-flex items-center gap-1.5 h-[30px] px-3 rounded-xl bg-surface border border-line text-ink text-[11px] font-extrabold uppercase tracking-wide shadow-sm hover:bg-surface-subtle transition-colors whitespace-nowrap";
  const stale = loadingPeriod === period && !brief;

  /** One alert, in words, with where it is handled. */
  const alertLine = (a: NeedsYouItem): { text: string; cta: string; href: string } => {
    switch (a.key) {
      case "cash_behind":
        return { text: isAr ? `الكاش أقل من ${periodWord} بنسبة ${a.n}% (ناقص ${fmt(a.extra || 0)} ${egp})` : `Cash is ${a.n}% behind ${periodWord} (${fmt(a.extra || 0)} ${egp} short)`, cta: isAr ? "الفلوس" : "Money", href: "/finance" };
      case "lab_late":
        return { text: isAr ? `${a.n} حالات معمل متأخرة${a.extra ? ` · ${a.extra} مستحقة النهارده` : ""}` : `${a.n} lab cases late${a.extra ? ` · ${a.extra} due today` : ""}`, cta: isAr ? "طارد" : "Chase", href: "/lab" };
      case "staff_absent":
        return { text: isAr ? `${a.n} من الفريق غايبين النهارده` : `${a.n} staff absent today`, cta: isAr ? "الحضور" : "Attendance", href: "/attendance" };
      case "staff_late":
        return { text: isAr ? `${a.n} من الفريق اتأخروا النهارده` : `${a.n} staff late today`, cta: isAr ? "الحضور" : "Attendance", href: "/attendance" };
      case "unconfirmed":
        return { text: isAr ? `${a.n} مواعيد بكرة لسه مش مؤكدة` : `${a.n} visits tomorrow still unconfirmed`, cta: isAr ? "فكّرهم" : "Remind", href: "/appointments" };
      case "noshow_spike":
        return { text: isAr ? `${a.n} غياب الأسبوع ده (العادي ${a.extra ?? 0})` : `${a.n} no-shows this week (usually ${a.extra ?? 0})`, cta: isAr ? "شوف مين" : "See who", href: "/ai?tab=noshows" };
      case "overtime":
        return { text: isAr ? `${a.n} من الفريق عندهم أوفرتايم مستني موافقتك` : `${a.n} staff with overtime waiting for your approval`, cta: isAr ? "وافق" : "Approve", href: "/attendance" };
    }
  };

  const trendValues = brief?.trend?.daily.map((d) => d.collected ?? 0) ?? [];
  const trendCompare = brief?.trend?.previousDaily.map((d) => d.collected ?? 0) ?? [];

  return (
    <div className="min-h-full pb-24 lg:pb-6 text-ink-strong" dir={isRTL ? "rtl" : "ltr"}>
      <div className="w-full max-w-[1400px] mx-auto p-4 md:p-6 lg:p-5 flex flex-col gap-4">

        <PageHeader
          title={<><span className="font-light">{greeting}</span> {firstName}</>}
          subtitle={`${dateLine} · ${timeLine}${branches.length > 0 && activeBranch ? ` · ${activeBranch.name}` : ""}`}
        >
          <HomeViewTabs />
        </PageHeader>

        {/* Needs you: only what is actually wrong. Empty is the good news. */}
        <div className="rounded-[2rem] bg-ink-slab text-white p-5 md:p-6 shadow-[0_20px_50px_rgba(26,33,48,0.18)]">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className={`${eyebrow} text-white/50`}>{isAr ? "محتاجك" : "Needs you"}</span>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] p-1">
                {periods.map((p) => (
                  <button key={p.key} onClick={() => setPeriod(p.key)} className={`rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${period === p.key ? "bg-white text-ink" : "text-white/60 hover:text-white"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <button onClick={refresh} aria-label={isAr ? "تحديث" : "Refresh"} className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full bg-white/[0.08] text-white/70 hover:text-white transition-colors">
                {loadingPeriod ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              </button>
            </div>
          </div>

          {!dayBrief ? (
            <div className="h-10 rounded-xl bg-white/[0.06] animate-pulse" aria-hidden="true" />
          ) : alerts.length === 0 ? (
            <p className="flex items-center gap-2 text-[15px] font-bold text-white/90">
              <CheckCircle2 size={18} className="text-accent" />
              {isAr ? "مفيش حاجة محتاجاك دلوقتي." : "Nothing needs you right now."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-white/10">
              {alerts.map((a) => {
                const line = alertLine(a);
                return (
                  <li key={a.key} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <AlertTriangle size={15} className={`shrink-0 ${a.severity === "high" ? "text-accent" : "text-white/50"}`} />
                      <span className={`text-[14px] truncate ${a.severity === "high" ? "font-bold text-white" : "font-semibold text-white/85"}`}>{line.text}</span>
                    </span>
                    <button onClick={() => router.push(line.href)} className="inline-flex items-center gap-1 h-8 px-3 rounded-xl bg-white text-ink text-[11px] font-extrabold uppercase tracking-wide whitespace-nowrap shrink-0">
                      {line.cta} <ArrowUpRight size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* The strip: cash, targets, the room */}
          <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_1fr] gap-5 md:gap-6 border-t border-white/10 mt-4 pt-4">
            <div className="flex flex-col gap-2 min-w-0">
              <span className={`${eyebrow} text-white/50`}>{period === "day" ? (isAr ? "كاش النهارده · مباشر" : "Cash today · live") : period === "week" ? (isAr ? "كاش الأسبوع" : "Cash this week") : (isAr ? "كاش الشهر" : "Cash this month")}</span>
              {moneyHidden ? <Hidden isAr={isAr} light /> : (
                <>
                  <div className="flex items-end gap-4 flex-wrap">
                    <span className="font-figure text-[40px] md:text-[48px] font-semibold leading-none">
                      {periodCash === null ? "—" : fmt(periodCash)} <span className="text-sm font-semibold text-white/45 tracking-[0.1em]">{egp}</span>
                    </span>
                    {trendValues.length >= 2 && <Sparkline values={trendValues} compare={trendCompare} width={110} height={30} className="text-white/90 mb-1" />}
                  </div>
                  <span className="text-[13px] font-semibold text-white/70">
                    {pace.ratio === null ? (isAr ? `مفيش ${periodWord} نقارن بيه` : `Nothing from ${periodWord} to compare`) : (
                      <>
                        {isAr ? "مقابل" : "vs"} {fmt(pace.expected)} {periodWord}
                        <span className={pace.ratio >= 1 ? " text-accent" : pace.ratio < 0.8 ? " text-white/95" : " text-white/70"}>
                          {" "}{pace.ratio >= 1 ? "↑" : "↓"} {Math.abs(Math.round((pace.ratio - 1) * 100))}%
                        </span>
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2.5 md:border-s md:border-white/10 md:ps-6 min-w-0">
              <span className={`${eyebrow} text-white/50`}>{isAr ? "أهداف الشهر" : "Month's targets"}</span>
              {moneyHidden ? <Hidden isAr={isAr} light /> : !revenueTarget && !patientsTarget ? (
                <button onClick={() => router.push("/settings/targets")} className="self-start text-[13px] font-semibold text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white">
                  {isAr ? "حدّد هدف الشهر" : "Set this month's targets"}
                </button>
              ) : (
                <>
                  {revenueTarget && <TargetBar label={isAr ? "الكاش" : "Cash"} value={fmt(monthBrief?.money?.collected ?? 0)} target={fmt(targets.monthlyRevenue)} progress={revenueTarget} isAr={isAr} />}
                  {patientsTarget && <TargetBar label={isAr ? "مرضى جدد" : "New patients"} value={String(monthBrief?.growth.newPatients ?? 0)} target={String(targets.monthlyNewPatients)} progress={patientsTarget} isAr={isAr} />}
                </>
              )}
            </div>
            <div className="flex flex-col gap-2 md:border-s md:border-white/10 md:ps-6 min-w-0">
              <span className={`${eyebrow} text-white/50`}>{isAr ? "الصالة دلوقتي" : "The room now"}</span>
              <span className="font-figure text-[32px] md:text-[36px] font-semibold leading-none">
                {room.waiting.length} <span className="text-base text-white/45">{isAr ? "مستنيين" : "waiting"}</span>
              </span>
              <span className="text-[13px] font-semibold text-white/70">
                {room.longest !== null ? `${isAr ? "أطول انتظار" : "longest"} ${room.longest} ${isAr ? "د" : "min"} · ` : ""}
                {room.inChair}{roomsTotal ? `/${roomsTotal}` : ""} {isAr ? "كراسي شغالة" : "chairs busy"}
                {onFloor !== null && rostered !== null ? ` · ${onFloor}/${rostered} ${isAr ? "من الفريق موجودين" : "staff in"}` : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 bg-surface border border-slate-200/60 rounded-2xl p-1.5 shadow-sm self-start">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-extrabold uppercase tracking-wide transition-colors ${tab === t.key ? "bg-ink-slab text-white" : "text-slate-500 hover:text-slate-900"}`}>
              {t.label}
              {t.badge && <span className={`font-figure text-[11px] font-extrabold rounded-full px-2 py-0.5 ${tab === t.key ? "bg-white/15 text-white" : "bg-surface-muted text-ink"}`}>{t.badge}</span>}
            </button>
          ))}
        </div>

        {error && <p className="px-1 text-sm font-semibold text-danger">{error}</p>}

        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity ${loadingPeriod === period ? "opacity-60" : ""}`}>
          {tab === "money" && (
            <>
              <Card title={isAr ? "الكاش اللي اتحصّل" : "Cash collected"} eyebrow={eyebrow}>
                {moneyHidden ? <Hidden isAr={isAr} /> : brief?.money ? (
                  <>
                    <div className="flex items-end justify-between gap-3">
                      <Big value={fmt(brief.money.collected)} unit={egp} />
                      {trendValues.length >= 2 && <Sparkline values={trendValues} compare={trendCompare} className="text-ink" />}
                    </div>
                    <KV rows={[[periodWord, brief.money.comparison.previousCollected === null ? "—" : fmt(brief.money.comparison.previousCollected)], [isAr ? "مصاريف" : "Expenses", fmt(brief.money.expenses)], [isAr ? "صافي" : "Net", fmt(brief.money.netCash)]]} />
                    {brief.money.byMethod.length > 0 && (
                      <p className="text-xs font-semibold text-ink-muted">{brief.money.byMethod.map((m) => `${m.method} ${Math.round((m.amount / Math.max(1, brief.money!.collected)) * 100)}%`).join(" · ")}</p>
                    )}
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "لسه للعيادة" : "Still owed to the clinic"} eyebrow={eyebrow}>
                {moneyHidden ? <Hidden isAr={isAr} /> : dues ? (
                  <>
                    <Big value={fmt(dues.totalOwed)} unit={egp} />
                    <p className="text-xs font-semibold text-ink-muted">{dues.patients} {isAr ? "مريض" : "patients"}{brief?.staleBalanceTotal != null ? ` · ${fmt(brief.staleBalanceTotal)} ${isAr ? "ساكت 45+ يوم" : "quiet 45+ days"}` : ""}</p>
                    <KV rows={dues.rows.map((r) => [r.patientName, fmt(r.totalOwed)])} bold />
                    <button onClick={() => router.push("/finance/recovery")} className={`${ghost} self-start`}>{isAr ? "حصّل المستحقات" : "Collect dues"} <ArrowUpRight size={12} /></button>
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "لكل دكتور" : "Per dentist"} eyebrow={eyebrow} wide>
                {moneyHidden ? <Hidden isAr={isAr} /> : brief?.production ? (
                  brief.production.doctors.length === 0 ? <p className="text-sm font-semibold text-ink-faint">{isAr ? "مفيش شغل في الفترة دي." : "No work in this period."}</p> : (
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-[0.1em] text-ink-muted">
                          <th className="text-start font-black pb-2">{isAr ? "الدكتور" : "Dentist"}</th>
                          <th className="text-end font-black pb-2">{isAr ? "شغل اتعمل" : "Work done"}</th>
                          <th className="text-end font-black pb-2">{isAr ? "اتحصّل" : "Collected"}</th>
                          <th className="text-end font-black pb-2">{isAr ? "نصيبه" : "Share owed"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brief.production.doctors.slice(0, 8).map((d) => (
                          <tr key={d.key} className="border-t border-line/60">
                            <td className="py-2 font-bold text-ink truncate max-w-[160px]">{d.name} <span className="font-figure text-[11px] font-semibold text-ink-muted">· {d.patientsSeen}</span></td>
                            <td className="py-2 text-end font-figure font-extrabold text-ink">{billed.has(d.name) ? fmt(billed.get(d.name) || 0) : `${d.procedures} ${isAr ? "إجراء" : "proc."}`}</td>
                            <td className="py-2 text-end font-figure font-extrabold text-ink">{fmt(d.collected)}</td>
                            <td className="py-2 text-end font-figure font-extrabold text-ink">{fmt(d.commission)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : <Skeleton />}
                {brief?.money && !moneyHidden && <p className="text-xs font-semibold text-ink-muted">{isAr ? "إجمالي نصيب الدكاترة" : "Total shares owed"} {fmt(brief.money.doctorCommissions)} · {isAr ? "معامل" : "lab"} {fmt(brief.money.labFees)}</p>}
              </Card>
            </>
          )}

          {tab === "team" && (
            <>
              <Card title={isAr ? "النهارده" : "Today"} eyebrow={eyebrow}>
                {hrHidden ? <Hidden isAr={isAr} /> : dayHr ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      {sortStaff(dayHr.staff).slice(0, 8).map((s) => (
                        <div key={s.staffId} className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.activeNow ? INK : s.lateDays > 0 ? "var(--accent)" : s.absentDays > 0 ? "var(--danger)" : MUTED }} />
                          <span className={`text-[13px] font-bold flex-1 truncate ${s.absentDays > 0 ? "text-ink-muted" : "text-ink"}`}>{s.name}</span>
                          <span className="font-figure text-xs font-semibold text-ink-muted">
                            {s.activeNow ? (isAr ? "موجود" : "in") : s.lateDays > 0 ? `${isAr ? "متأخر" : "late"} ${s.lateMinutes} ${isAr ? "د" : "min"}` : s.absentDays > 0 ? (isAr ? "غايب" : "absent") : s.hasSchedule ? (isAr ? "مش في الجدول" : "not rostered") : (isAr ? "بدون جدول" : "no schedule")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => router.push("/attendance")} className={`${ghost} self-start`}>{isAr ? "الحضور" : "Attendance"} <ArrowUpRight size={12} /></button>
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "أوفرتايم مستني موافقة" : "Overtime awaiting approval"} eyebrow={eyebrow}>
                {hrHidden ? <Hidden isAr={isAr} /> : hr ? (
                  overtimeStaff.length === 0 ? <p className="text-sm font-semibold text-ink-faint">{isAr ? "مفيش أوفرتايم مستني." : "Nothing pending."}</p> : (
                    <>
                      <Big value={hours(hr.overtimePendingMinutes)} unit={`${fmt(hr.overtimePendingCost)} ${egp}`} />
                      <KV rows={overtimeStaff.slice(0, 5).map((s) => [s.name, hours(s.overtimePendingMinutes)])} bold />
                      <button onClick={() => router.push("/attendance")} className={`${ghost} self-start`}>{isAr ? "وافق أو ارفض" : "Approve or reject"} <ArrowUpRight size={12} /></button>
                    </>
                  )
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "مستحقات الفترة" : "Pay owed this period"} eyebrow={eyebrow}>
                {hrHidden ? <Hidden isAr={isAr} /> : hr ? (
                  <>
                    <Big value={fmt(hr.labourCost)} unit={egp} />
                    <KV rows={[...hr.staff].sort((a, b) => b.estimatedPay - a.estimatedPay).slice(0, 5).map((s) => [s.name, fmt(s.estimatedPay)])} bold />
                    <p className="text-xs font-semibold text-ink-muted">{hours(hr.totalMinutes)} {isAr ? "شغل" : "worked"} · {hr.lateDays} {isAr ? "تأخير" : "late days"} · {hr.absentDays} {isAr ? "غياب" : "absent days"}</p>
                  </>
                ) : <Skeleton />}
              </Card>
            </>
          )}

          {tab === "floor" && (
            <>
              <Card title={isAr ? "صالة الانتظار دلوقتي" : "Waiting room now"} eyebrow={eyebrow}>
                {room.waiting.length === 0 ? <p className="text-sm font-semibold text-ink-faint">{isAr ? "مفيش حد مستني." : "Nobody waiting."}</p> : (
                  <div className="flex flex-col gap-1.5">
                    {room.waiting.slice(0, 6).map((w) => (
                      <div key={w.id} className="flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: (w.minutes ?? 0) >= 15 ? "var(--danger)" : INK }} />
                        <span className="text-[13px] font-bold text-ink flex-1 truncate">{w.name}</span>
                        <span className="text-[11px] font-semibold text-ink-faint truncate max-w-[90px]">{w.doctor}</span>
                        <span className={`font-figure text-xs font-extrabold ${(w.minutes ?? 0) >= 15 ? "text-danger" : "text-ink-muted"}`}>{w.minutes === null ? "—" : `${w.minutes} ${isAr ? "د" : "min"}`}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs font-semibold text-ink-muted">{room.inChair} {roomsTotal ? `${isAr ? "من" : "of"} ${roomsTotal}` : ""} {isAr ? "كراسي مشغولة" : "chairs in use"}</p>
              </Card>
              <Card title={isAr ? "استخدام الكراسي" : "Chair use"} eyebrow={eyebrow}>
                {brief?.production ? (
                  <>
                    {brief.production.chairUtilisation ? (
                      <>
                        <Big value={`${brief.production.chairUtilisation.percent}%`} unit={isAr ? "من وقت الفتح" : "of opening time"} />
                        <div className="h-2.5 rounded bg-surface-muted overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.min(100, brief.production.chairUtilisation.percent)}%`, background: INK }} /></div>
                      </>
                    ) : <p className="text-sm font-semibold text-ink-faint">{isAr ? "حدّد مواعيد العمل في الإعدادات ← ساعات العمل عشان الرقم ده يظهر." : "Set opening hours under Settings → Working hours for this figure."}</p>}
                    <p className="text-xs font-semibold text-ink-muted">
                      {brief.nextUp.key === "tomorrow" ? (isAr ? "بكرة" : "Tomorrow") : (isAr ? "الأسبوع الجاي" : "Next week")}: {brief.nextUp.appointments} {isAr ? "محجوز" : "booked"} · {brief.nextUp.unconfirmed} {isAr ? "مش مؤكد" : "unconfirmed"}
                      {brief.production.biggestGap ? ` · ${isAr ? "أكبر فجوة" : "biggest gap"} ${brief.production.biggestGap.minutes} ${isAr ? "د" : "min"} ${isAr ? "الساعة" : "at"} ${brief.production.biggestGap.startsAt}` : ""}
                    </p>
                  </>
                ) : moneyHidden ? <Hidden isAr={isAr} /> : <Skeleton />}
              </Card>
              <Card title={isAr ? "الغياب أسبوع بأسبوع" : "No-shows week by week"} eyebrow={eyebrow}>
                <div className="flex items-end justify-between gap-3">
                  <Big value={String(spike.thisWeek)} unit={isAr ? "الأسبوع ده" : "this week"} />
                  <Sparkline values={weeks.map((w) => w.noShows)} className={spike.spike ? "text-danger" : "text-ink"} />
                </div>
                <Bars rows={weeks.map((w) => ({ label: `${w.start.slice(5).replace("-", "/")}`, value: w.noShows, text: `${w.noShows} ${isAr ? "غياب" : "no-show"} · ${w.cancelled} ${isAr ? "إلغاء" : "cancelled"} · ${w.booked} ${isAr ? "محجوز" : "booked"}`, warn: spike.spike && w.start === weeks[weeks.length - 1]?.start }))} max={Math.max(1, ...weeks.map((w) => w.noShows))} />
                <p className={`text-xs font-semibold ${spike.spike ? "text-danger" : "text-ink-muted"}`}>
                  {spike.spike ? (isAr ? `أكتر من العادي (${spike.usual} في الأسبوع).` : `More than usual (${spike.usual} a week).`) : (isAr ? `العادي ${spike.usual} في الأسبوع.` : `Usually ${spike.usual} a week.`)}
                </p>
              </Card>
            </>
          )}

          {tab === "growth" && (
            <>
              <Card title={isAr ? "مرضى جدد" : "New patients"} eyebrow={eyebrow}>
                {brief ? (
                  <>
                    <Big value={String(brief.growth.newPatients)} unit={brief.trend ? `${isAr ? "مقابل" : "vs"} ${brief.trend.points.find((p) => p.key === "new_patients")?.previous ?? "—"} ${periodWord}` : undefined} />
                    {patientsTarget ? (
                      <TargetBar dark={false} label={isAr ? "هدف الشهر" : "Month's target"} value={String(monthBrief?.growth.newPatients ?? 0)} target={String(targets.monthlyNewPatients)} progress={patientsTarget} isAr={isAr} />
                    ) : (
                      <button onClick={() => router.push("/settings/targets")} className={`${ghost} self-start`}>{isAr ? "حدّد هدف" : "Set a target"} <ArrowUpRight size={12} /></button>
                    )}
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "من فين، وبكام" : "Where from, and worth what"} eyebrow={eyebrow}>
                {sources.length === 0 && sourceCash.length === 0 ? <p className="text-sm font-semibold text-ink-faint">{isAr ? "مفيش مرضى جدد في الفترة دي." : "No new patients in this period."}</p> : (
                  <>
                    <Bars rows={sources.slice(0, 5).map((s) => ({ label: s.source, value: s.count, text: `${s.count} ${isAr ? "مريض" : s.count === 1 ? "patient" : "patients"}` }))} />
                    {!moneyHidden && sourceCash.length > 0 && (
                      <>
                        <span className={eyebrow}>{isAr ? "الكاش حسب المصدر" : "Cash by source"}</span>
                        <Bars rows={sourceCash.slice(0, 5).map((s) => ({ label: s.source, value: s.cash, text: `${fmt(s.cash)} ${egp}` }))} />
                      </>
                    )}
                  </>
                )}
              </Card>
              <Card title={isAr ? "واتساب: البوت لوحده" : "WhatsApp: the bot alone"} eyebrow={eyebrow}>
                {bot.total === 0 ? <p className="text-sm font-semibold text-ink-faint">{isAr ? "مفيش محادثات في الفترة دي." : "No conversations in this period."}</p> : (
                  <>
                    <Big value={`${bot.percentBot ?? 0}%`} unit={isAr ? "من المحادثات من غير حد" : "of chats without a person"} />
                    <div className="flex h-2.5 rounded overflow-hidden gap-[2px]">
                      <div style={{ width: `${(bot.botAlone / bot.total) * 100}%`, background: INK }} />
                      <div style={{ width: `${(bot.handedOff / bot.total) * 100}%`, background: MUTED }} />
                    </div>
                    <p className="text-xs font-semibold text-ink-muted">{bot.botAlone} {isAr ? "البوت لوحده" : "bot alone"} · {bot.handedOff} {isAr ? "اتسلّمت لحد" : "handed to a person"} · {bot.total} {isAr ? "إجمالي" : "total"}</p>
                    <button onClick={() => router.push("/chats")} className={`${ghost} self-start`}>{isAr ? "افتح الشات" : "Open chats"} <ArrowUpRight size={12} /></button>
                  </>
                )}
              </Card>
            </>
          )}
        </div>
        {stale && <p className="px-1 text-xs font-semibold text-ink-faint">{isAr ? "بنجهّز الأرقام…" : "Working out the numbers…"}</p>}
      </div>
    </div>
  );
}

// --- Small pieces --------------------------------------------------------------------------------------

function sortStaff(rows: HrStaffRow[]): HrStaffRow[] {
  const rank = (s: HrStaffRow) => (s.activeNow ? 0 : s.lateDays > 0 ? 1 : s.absentDays > 0 ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function compact(n: number): string {
  const a = Math.abs(n);
  return a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : a >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : String(Math.round(n));
}

/** A target as a bar with a tick where the month should be by today. */
function TargetBar({ label, value, target, progress, isAr, dark = true }: { label: string; value: string; target: string; progress: { percent: number; expectedPercent: number; onPace: boolean }; isAr: boolean; dark?: boolean }) {
  const text = dark ? "text-white" : "text-ink";
  const dim = dark ? "text-white/60" : "text-ink-muted";
  const track = dark ? "bg-white/15" : "bg-surface-muted";
  const fill = progress.onPace ? (dark ? "bg-white" : "bg-ink-slab") : "bg-danger";
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={`font-bold ${text}`}>{label}</span>
        <span className={`font-figure font-semibold ${dim}`}>{value} / {target} · {progress.percent}%</span>
      </div>
      <div className={`relative h-2 rounded ${track} overflow-visible`}>
        <div className={`h-full rounded ${fill} transition-[width] duration-700 ease-out`} style={{ width: `${Math.min(100, progress.percent)}%` }} />
        <div className={`absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 ${dark ? "bg-white/70" : "bg-ink/60"}`} style={{ insetInlineStart: `${progress.expectedPercent}%` }} title={isAr ? `المفروض ${progress.expectedPercent}% بحلول النهارده` : `${progress.expectedPercent}% expected by today`} />
      </div>
    </div>
  );
}

function Card({ title, eyebrow, children, wide }: { title: string; eyebrow: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-[1.75rem] border border-line bg-surface shadow-[0_8px_40px_rgba(0,0,0,0.04)] px-5 py-5 flex flex-col gap-3 min-w-0 ${wide ? "md:col-span-2 xl:col-span-1" : ""}`}>
      <span className={eyebrow}>{title}</span>
      {children}
    </div>
  );
}

function Big({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="font-figure text-[26px] font-extrabold text-ink leading-none" style={{ fontVariantNumeric: "normal" }}>
      {value} {unit && <span className="text-[11px] font-semibold text-ink-faint tracking-[0.06em]">{unit}</span>}
    </span>
  );
}

function KV({ rows, bold }: { rows: Array<[string, string]>; bold?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className={`text-[13px] truncate ${bold ? "font-bold text-ink" : "font-semibold text-ink-muted"}`}>{k}</span>
          <span className="font-figure font-extrabold text-ink shrink-0 text-[13px]">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows, max }: { rows: Array<{ label: string; value: number; text: string; warn?: boolean }>; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm font-semibold text-ink-faint">—</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className={`text-[13px] font-bold truncate ${r.warn ? "text-danger" : "text-ink"}`}>{r.label}</span>
            <span className="font-figure text-xs font-semibold text-ink-muted shrink-0 truncate">{r.text}</span>
          </div>
          <div className="h-2 rounded bg-surface-muted overflow-hidden">
            <div className="h-full rounded transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, (r.value / top) * 100)}%`, background: r.warn ? "var(--danger)" : INK }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Hidden({ isAr, light }: { isAr: boolean; light?: boolean }) {
  return <p className={`text-sm font-semibold ${light ? "text-white/60" : "text-ink-faint"}`}>{isAr ? "مخفي حسب صلاحياتك." : "Hidden by your permissions."}</p>;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="h-7 w-2/3 rounded-lg bg-surface-muted animate-pulse" />
      <div className="h-3 w-1/2 rounded bg-surface-muted animate-pulse" />
      <div className="h-3 w-3/4 rounded bg-surface-muted animate-pulse" />
    </div>
  );
}
