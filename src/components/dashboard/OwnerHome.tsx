"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Timestamp, onSnapshot, query, where } from "firebase/firestore";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { auth } from "@/lib/firebase";
import { getClinicCollection } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { useUnreadChatCount } from "@/lib/useUnreadChatCount";
import { localYmd } from "@/lib/clinicDate";
import { LAB_CASES_COLLECTION } from "@/lib/labCases";
import type { Briefing, HrStaffRow } from "@/lib/automation/briefing/types";
import type { Row } from "@/lib/dentistHome";
import { attendanceByDoctor, cashToday, labChase, leadsFunnel, periodStart, sourcesOf, waitingRoom } from "@/lib/ownerHome";

/**
 * The owner's home: is the place running, and is the money moving?
 *
 * A live slab on top — cash so far today, who is on the floor, the waiting room this minute, and
 * the four things that slip if nobody acts — then the clinic in four tabs: Money, Team, The
 * floor, Growth. Sixteen tiles, every one of them a count or a sum of something the clinic
 * already records.
 *
 * The period figures come from The Brief's engine (/api/ai/daily-briefing), which already
 * computes cash, per-dentist collection, payroll, lateness, what slips, leads and stock for a
 * day, a week and now a month — one tested engine rather than a second copy of the arithmetic.
 * The slab and the floor read live from the browser's own subscriptions, because "3 waiting,
 * longest 18 minutes" is only worth showing if it is true this minute.
 *
 * This is the one screen where dentists are compared by name. Their own screens never are.
 */

type Period = "day" | "week" | "month";
type Tab = "money" | "team" | "floor" | "growth";

const ACCENT = "#1D7F46";
const DEEMPHASIS = "#CBD5E1";
const GRID = "#E2E8F0";
const TICK = { fontSize: 11, fill: "#78899F", fontWeight: 600 } as const;

export default function OwnerHome() {
  const router = useRouter();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { branches, activeBranch, matches } = useActiveBranch();
  const unread = useUnreadChatCount();
  const isAr = language === "ar";
  const today = localYmd();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // --- The Brief, per period ---------------------------------------------------------------------
  const [period, setPeriod] = useState<Period>("month");
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

  // The day brief feeds the slab and refreshes on its own; the chosen period loads on demand.
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
  const [joinRequests, setJoinRequests] = useState(0);
  const [staffNoLogin, setStaffNoLogin] = useState(0);
  const [queued, setQueued] = useState(0);
  const [handoffs, setHandoffs] = useState(0);
  useEffect(() => {
    if (!clinicId) return;
    const rows = (s: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): Row[] => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const unsubs = [
      onSnapshot(query(getClinicCollection("ledger"), where("date", "==", today)), (s) => setLedgerToday(rows(s))),
      onSnapshot(query(getClinicCollection("appointments"), where("date", "==", today)), (s) => setApptsToday(rows(s))),
      onSnapshot(query(getClinicCollection(LAB_CASES_COLLECTION), where("status", "==", "at_lab")), (s) => setLabAtLab(rows(s))),
      onSnapshot(query(getClinicCollection("join_requests"), where("clinicId", "==", clinicId), where("status", "in", ["pending", "Pending"])), (s) => setJoinRequests(s.size)),
      onSnapshot(getClinicCollection("staff"), (s) => setStaffNoLogin(s.docs.filter((d) => !d.data().uid).length)),
      onSnapshot(query(getClinicCollection("whatsapp_outbox"), where("status", "==", "queued")), (s) => setQueued(s.size)),
      onSnapshot(query(getClinicCollection("whatsapp_conversations"), where("needsHuman", "==", true)), (s) => setHandoffs(s.size)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [clinicId, today]);

  // New patients and leads since the period began — for "where from" and the funnel.
  const start = periodStart(period, today);
  const [patientsSince, setPatientsSince] = useState<Row[]>([]);
  const [leadsSince, setLeadsSince] = useState<Row[]>([]);
  useEffect(() => {
    if (!clinicId) return;
    const since = Timestamp.fromDate(new Date(`${start}T00:00:00`));
    const rows = (s: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): Row[] => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const unsubs = [
      onSnapshot(query(getClinicCollection("patients"), where("createdAt", ">=", since)), (s) => setPatientsSince(rows(s))),
      onSnapshot(query(getClinicCollection("leads"), where("createdAt", ">=", since)), (s) => setLeadsSince(rows(s))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [clinicId, start]);

  // Two one-off reads with no live twin: the debtors list, and recalls due.
  const [dues, setDues] = useState<{ totalOwed: number; patients: number; rows: Array<{ patientId: string; patientName: string; totalOwed: number }> } | null>(null);
  const [recallsDue, setRecallsDue] = useState<number | null>(null);
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const [duesRes, recallRes] = await Promise.all([
          fetch("/api/finance/recovery", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
          fetch(`/api/ai/recalls?clinicId=${encodeURIComponent(clinicId)}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (duesRes?.ok) setDues({ totalOwed: Number(duesRes.totals?.totalOwed) || 0, patients: Number(duesRes.totals?.patients) || 0, rows: (duesRes.rows || []).slice(0, 3) });
        if (recallRes?.ok) setRecallsDue(Number(recallRes.recalls?.counts?.due) || 0);
      } catch {
        /* the tiles say "—" */
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
  const slips = {
    unresolved: dayBrief?.actions.unresolvedCount ?? 0,
    lab: lab.late,
    stockOut: dayBrief?.stock.outOfStockCount ?? 0,
    unconfirmed: dayBrief?.actions.unconfirmedAhead ?? 0,
  };
  const slipsTotal = slips.unresolved + slips.lab + slips.stockOut + slips.unconfirmed;
  const attendance = useMemo(() => attendanceByDoctor((brief?.appointments || []) as unknown as Row[]), [brief]);
  const sources = useMemo(() => sourcesOf(patientsSince, isAr ? "غير معروف" : "Unknown"), [patientsSince, isAr]);
  const funnel = useMemo(() => leadsFunnel(leadsSince), [leadsSince]);
  const moneyHidden = !!brief && brief.redacted.includes("money");
  const hrHidden = !!brief && brief.redacted.includes("hr");

  const fmt = (n: number) => Math.round(n).toLocaleString(isAr ? "ar-EG" : "en-US");
  const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
  const hours = (mins: number) => `${Math.round(mins / 60)} ${isAr ? "س" : "h"}`;

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
  const tabs: Array<{ key: Tab; label: string; badge: string }> = [
    { key: "money", label: isAr ? "الفلوس" : "Money", badge: brief?.money ? compact(brief.money.netCash) : "" },
    { key: "team", label: isAr ? "الفريق" : "Team", badge: onFloor !== null && rostered !== null ? `${onFloor}/${rostered}` : "" },
    { key: "floor", label: isAr ? "الصالة" : "The floor", badge: dayBrief ? String(slipsTotal) : "" },
    { key: "growth", label: isAr ? "النمو" : "Growth", badge: brief ? String(brief.growth.newPatients) : "" },
  ];
  const eyebrow = "font-display text-[11px] font-black uppercase tracking-[0.12em] text-ink-muted";
  const ghost = "inline-flex items-center gap-1.5 h-[30px] px-3 rounded-xl bg-surface border border-line text-ink text-[11px] font-extrabold uppercase tracking-wide shadow-sm hover:bg-surface-subtle transition-colors whitespace-nowrap";
  const stale = loadingPeriod === period && !brief;

  return (
    <div className="min-h-screen pb-24 lg:pb-6 text-ink-strong" dir={isRTL ? "rtl" : "ltr"}>
      <div className="w-full max-w-[1400px] mx-auto p-4 md:p-6 lg:p-5 flex flex-col gap-4">

        {/* Header + the one filter row */}
        <div className="flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <h1 className="font-display text-[26px] md:text-[28px] font-medium text-ink-strong leading-tight">
              {greeting} <span className="font-bold text-ink">{firstName}</span>
            </h1>
            <p className="text-xs font-semibold text-ink-muted mt-1">
              {dateLine} · {timeLine}
              {branches.length > 0 && activeBranch ? ` · ${activeBranch.name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-full bg-surface border border-slate-200/60 p-1 shadow-sm">
              {periods.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)} className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-colors ${period === p.key ? "bg-ink-slab text-white" : "text-slate-500 hover:text-slate-900"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={refresh} aria-label={isAr ? "تحديث" : "Refresh"} className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-full bg-surface border border-slate-200/60 text-slate-500 hover:text-slate-900 shadow-sm transition-colors">
              {loadingPeriod ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
        </div>

        {/* The slab: always now */}
        <div className="relative overflow-hidden rounded-[2rem] bg-ink-slab text-white p-6 md:p-8 shadow-[0_20px_50px_rgba(26,33,48,0.18)]">
          <div className="absolute -top-[140px] -end-[90px] w-[380px] h-[380px] rounded-full bg-white/[0.04] pointer-events-none" />
          <div className="relative grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr] gap-6 md:gap-7">
            <div className="flex flex-col gap-2.5">
              <span className={`${eyebrow} text-white/50`}>{isAr ? "كاش النهارده · مباشر" : "Cash today · live"}</span>
              <span className="font-figure text-[44px] md:text-[52px] font-semibold leading-none">
                {fmt(cash.collected)} <span className="text-sm font-semibold text-white/45 tracking-[0.1em]">{isAr ? "ج.م" : "EGP"}</span>
              </span>
              <span className="text-[13px] font-semibold text-white/70">
                {dayBrief?.money?.comparison.sameWeekdayCollected != null && (
                  <>
                    {isAr ? "نفس اليوم الأسبوع اللي فات" : "Same weekday last week"} {fmt(dayBrief.money.comparison.sameWeekdayCollected)}
                    {dayBrief.money.comparison.sameWeekdayCollected > 0 && (
                      <span className={cash.collected >= dayBrief.money.comparison.sameWeekdayCollected ? " text-accent-soft" : " text-white/60"}>
                        {" "}{cash.collected >= dayBrief.money.comparison.sameWeekdayCollected ? "↑" : "↓"} {Math.abs(Math.round(((cash.collected - dayBrief.money.comparison.sameWeekdayCollected) / dayBrief.money.comparison.sameWeekdayCollected) * 100))}%
                      </span>
                    )}
                    {" · "}
                  </>
                )}
                {isAr ? "مصاريف" : "expenses"} {fmt(cash.expenses)} · {isAr ? "صافي" : "net"} {fmt(cash.net)}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 md:border-s md:border-white/10 md:ps-7">
              <span className={`${eyebrow} text-white/50`}>{isAr ? "على الأرض" : "On the floor"}</span>
              <span className="font-figure text-[36px] md:text-[40px] font-semibold leading-none">
                {onFloor ?? "—"} {rostered !== null && <span className="text-lg text-white/45">{isAr ? `من ${rostered}` : `of ${rostered}`}</span>}
              </span>
              <div className="flex flex-wrap gap-2">
                {lateToday.slice(0, 2).map((s) => (
                  <Pill key={s.staffId} dot="#FACC15">{isAr ? "متأخر" : "late"} · {s.name.split(" ")[0]}, {s.lateMinutes} {isAr ? "د" : "min"}</Pill>
                ))}
                {absentToday.slice(0, 2).map((s) => (
                  <Pill key={s.staffId} dot="#A0AAB2">{isAr ? "غايب" : "absent"} · {s.name.split(" ")[0]}</Pill>
                ))}
                {dayHr && lateToday.length === 0 && absentToday.length === 0 && <Pill dot="#8DE3C4">{isAr ? "كله في معاده" : "everyone on time"}</Pill>}
              </div>
            </div>
            <div className="flex flex-col gap-2.5 md:border-s md:border-white/10 md:ps-7">
              <span className={`${eyebrow} text-white/50`}>{isAr ? "صالة الانتظار" : "Waiting room"}</span>
              <span className="font-figure text-[36px] md:text-[40px] font-semibold leading-none">
                {room.waiting.length} <span className="text-lg text-white/45">{isAr ? "مستنيين" : "waiting"}</span>
              </span>
              <span className="text-[13px] font-semibold text-white/70">
                {room.longest !== null ? `${isAr ? "أطول انتظار" : "Longest"} ${room.longest} ${isAr ? "د" : "min"} · ` : ""}
                {room.inChair} {roomsTotal ? `${isAr ? "من" : "of"} ${roomsTotal}` : ""} {isAr ? "كراسي مشغولة" : "chairs in use"}
              </span>
            </div>
            <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <span className="text-[13px] font-bold text-white/85">
                {isAr ? "اللي هيضيع لو محدش اتحرك:" : "What slips if nobody acts:"}{" "}
                <b className="text-white">{slips.unresolved}</b> {isAr ? "زيارات فاتت محدش قفلها" : "past visits nobody closed"} ·{" "}
                <b className="text-white">{slips.lab}</b> {isAr ? "حالات معمل متأخرة" : "lab cases late"} ·{" "}
                <b className="text-white">{slips.stockOut}</b> {isAr ? "صنف خلص" : "out of stock"} ·{" "}
                <b className="text-white">{slips.unconfirmed}</b> {isAr ? "مش مؤكد بكرة" : "unconfirmed tomorrow"}
              </span>
              <button onClick={() => setTab("floor")} className="inline-flex items-center h-10 px-4 rounded-xl bg-white text-ink text-[12px] font-extrabold uppercase tracking-wide">
                {isAr ? "افتح القايمة" : "Open the list"}
              </button>
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

        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 transition-opacity ${loadingPeriod === period ? "opacity-60" : ""}`}>
          {tab === "money" && (
            <>
              <Card title={isAr ? "الكاش في الفترة" : "Cash this period"} eyebrow={eyebrow}>
                {moneyHidden ? <Hidden isAr={isAr} /> : brief?.money ? (
                  <>
                    <Big value={fmt(brief.money.netCash)} unit={isAr ? "ج.م صافي" : "EGP net"} />
                    <KV rows={[[isAr ? "اتحصّل" : "Collected", fmt(brief.money.collected)], [isAr ? "مصاريف" : "Expenses", fmt(brief.money.expenses)], [isAr ? "خصومات" : "Discounts", fmt(brief.money.discounts)]]} />
                    {brief.money.byMethod.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex h-2.5 rounded overflow-hidden gap-[2px]">
                          {brief.money.byMethod.map((m, i) => (
                            <div key={m.method} style={{ width: `${(m.amount / Math.max(1, brief.money!.collected)) * 100}%`, background: i === 0 ? ACCENT : i === 1 ? "#1D4FD8" : "#A0AAB2" }} />
                          ))}
                        </div>
                        <p className="text-xs font-semibold text-ink-muted">{brief.money.byMethod.map((m) => `${m.method} ${Math.round((m.amount / Math.max(1, brief.money!.collected)) * 100)}%`).join(" · ")}</p>
                      </div>
                    )}
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "لسه للعيادة" : "Still owed to the clinic"} eyebrow={eyebrow}>
                {moneyHidden ? <Hidden isAr={isAr} /> : dues ? (
                  <>
                    <Big value={fmt(dues.totalOwed)} unit={isAr ? "ج.م" : "EGP"} />
                    <p className="text-xs font-semibold text-ink-muted">{dues.patients} {isAr ? "مريض" : "patients"}{brief?.staleBalanceTotal != null ? ` · ${fmt(brief.staleBalanceTotal)} ${isAr ? "ساكت 45+ يوم" : "quiet 45+ days"}` : ""}</p>
                    <KV rows={dues.rows.map((r) => [r.patientName, fmt(r.totalOwed)])} bold />
                    <button onClick={() => router.push("/finance/recovery")} className={`${ghost} self-start`}>{isAr ? "حصّل المستحقات" : "Collect dues"} <ArrowUpRight size={12} /></button>
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "اتحصّل لكل دكتور" : "Collected per dentist"} eyebrow={eyebrow}>
                {moneyHidden ? <Hidden isAr={isAr} /> : brief?.production ? (
                  <>
                    <Bars rows={brief.production.doctors.slice(0, 5).map((d) => ({ label: d.name, value: d.collected, text: fmt(d.collected) }))} />
                    {brief.money && <p className="text-xs font-semibold text-ink-muted">{isAr ? "عمولات مستحقة" : "Commissions owed"} {fmt(brief.money.doctorCommissions)}</p>}
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={period === "day" ? (isAr ? "مقارنة" : "Against last time") : (isAr ? "الفترة دي والفترة اللي فاتت" : "This period vs last")} eyebrow={eyebrow}>
                {moneyHidden ? <Hidden isAr={isAr} /> : brief?.trend ? (
                  <>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={brief.trend.daily.map((d, i) => ({ i: i + 1, current: d.collected ?? 0, previous: brief.trend!.previousDaily[i]?.collected ?? null }))} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                        <XAxis dataKey="i" axisLine={false} tickLine={false} tick={TICK} interval="preserveStartEnd" />
                        <YAxis axisLine={false} tickLine={false} tick={TICK} tickFormatter={(v) => compact(Number(v))} width={44} />
                        <Tooltip content={<Tip fmt={fmt} isAr={isAr} />} />
                        <Line type="monotone" dataKey="previous" name={brief.money?.comparison.previousLabel || (isAr ? "الفترة اللي فاتت" : "Last time")} stroke={DEEMPHASIS} strokeWidth={2} dot={false} isAnimationActive animationDuration={900} />
                        <Line type="monotone" dataKey="current" name={isAr ? "الفترة دي" : "This period"} stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive animationDuration={900} />
                      </LineChart>
                    </ResponsiveContainer>
                    {(() => {
                      const p = brief.trend!.points.find((x) => x.key === "collected");
                      return p ? (
                        <p className="text-xs font-semibold text-ink-muted">
                          {fmt(p.current)} {isAr ? "مقابل" : "vs"} {fmt(p.previous)}
                          {p.changePercent !== null && <span className={p.changePercent >= 0 ? " text-ok font-extrabold" : " text-danger font-extrabold"}> {p.changePercent >= 0 ? "↑" : "↓"} {Math.abs(p.changePercent)}%</span>}
                        </p>
                      ) : null;
                    })()}
                  </>
                ) : brief?.money ? (
                  <>
                    <Big value={fmt(brief.money.collected)} unit={isAr ? "ج.م اتحصّل" : "EGP collected"} />
                    <KV rows={[[brief.money.comparison.previousLabel, brief.money.comparison.previousCollected === null ? "—" : fmt(brief.money.comparison.previousCollected)], ...(brief.money.comparison.sameWeekdayLabel ? [[brief.money.comparison.sameWeekdayLabel, brief.money.comparison.sameWeekdayCollected === null ? "—" : fmt(brief.money.comparison.sameWeekdayCollected)] as [string, string]] : [])]} />
                  </>
                ) : <Skeleton />}
              </Card>
            </>
          )}

          {tab === "team" && (
            <>
              <Card title={isAr ? "مين موجود دلوقتي" : "Who's in right now"} eyebrow={eyebrow}>
                {hrHidden ? <Hidden isAr={isAr} /> : dayHr ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      {sortStaff(dayHr.staff).slice(0, 7).map((s) => (
                        <div key={s.staffId} className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.activeNow ? ACCENT : s.lateDays > 0 ? "#FACC15" : s.absentDays > 0 ? "#A0AAB2" : "#E2E8F0" }} />
                          <span className={`text-[13px] font-bold flex-1 truncate ${s.absentDays > 0 ? "text-ink-muted" : "text-ink"}`}>{s.name}</span>
                          <span className="font-figure text-xs font-semibold text-ink-muted">
                            {s.activeNow ? (isAr ? "موجود" : "in") : s.lateDays > 0 ? `${isAr ? "متأخر" : "late"} ${s.lateMinutes} ${isAr ? "د" : "min"}` : s.absentDays > 0 ? (isAr ? "غايب" : "absent") : s.hasSchedule ? (isAr ? "مش في الجدول" : "not rostered") : (isAr ? "بدون جدول" : "no schedule")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => router.push("/attendance")} className={`${ghost} self-start`}>{isAr ? "الحضور" : "Time clock"} <ArrowUpRight size={12} /></button>
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "مستحقات الفترة" : "Pay owed this period"} eyebrow={eyebrow}>
                {hrHidden ? <Hidden isAr={isAr} /> : hr ? (
                  <>
                    <Big value={fmt(hr.labourCost)} unit={isAr ? "ج.م" : "EGP"} />
                    <KV rows={[...hr.staff].sort((a, b) => b.estimatedPay - a.estimatedPay).slice(0, 4).map((s) => [s.name, fmt(s.estimatedPay)])} bold />
                    {hr.overtimePendingCost > 0 && <p className="text-xs font-semibold text-warn">{isAr ? "أوفرتايم مستني موافقة" : "Overtime pending approval"} {fmt(hr.overtimePendingCost)}</p>}
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "ساعات الشغل" : "Hours worked"} eyebrow={eyebrow}>
                {hrHidden ? <Hidden isAr={isAr} /> : hr ? (
                  <Bars rows={[...hr.staff].filter((s) => s.minutesWorked > 0).sort((a, b) => b.minutesWorked - a.minutesWorked).slice(0, 6).map((s) => ({ label: s.name, value: s.minutesWorked, text: hours(s.minutesWorked), warn: s.overtimePendingMinutes > 0 }))} />
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "مستنيين قرارك" : "Waiting on you"} eyebrow={eyebrow}>
                <Action label={`${joinRequests} ${isAr ? "طلبات انضمام" : "join requests"}`} onClick={() => router.push("/settings/join-requests")} isAr={isAr} />
                <Action label={`${staffNoLogin} ${isAr ? "موظف من غير حساب" : "staff with no login"}`} onClick={() => router.push("/settings/users")} isAr={isAr} />
                <Action label={`${hr ? hr.staff.filter((s) => s.overtimePendingMinutes > 0).length : "—"} ${isAr ? "أوفرتايم للموافقة" : "overtime to approve"}`} onClick={() => router.push("/attendance")} isAr={isAr} />
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
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#8DE3C4" }} />
                        <span className="text-[13px] font-bold text-ink flex-1 truncate">{w.name}</span>
                        <span className="text-[11px] font-semibold text-ink-faint truncate max-w-[90px]">{w.doctor}</span>
                        <span className={`font-figure text-xs font-extrabold ${(w.minutes ?? 0) >= 15 ? "text-warn" : "text-ink-muted"}`}>{w.minutes === null ? "—" : `${w.minutes} ${isAr ? "د" : "min"}`}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs font-semibold text-ink-muted">{room.inChair} {roomsTotal ? `${isAr ? "من" : "of"} ${roomsTotal}` : ""} {isAr ? "كراسي مشغولة" : "chairs in use"}</p>
              </Card>
              <Card title={isAr ? "اللي هيضيع لو محدش اتحرك" : "What slips if nobody acts"} eyebrow={eyebrow}>
                <Action label={`${slips.unresolved} ${isAr ? "زيارات فاتت محدش قال حصل فيها إيه" : "past visits, nobody said what happened"}`} cta={isAr ? "اقفلها" : "Close out"} onClick={() => router.push("/ai?tab=noshows")} isAr={isAr} />
                <Action label={`${slips.lab} ${isAr ? "حالات معمل متأخرة" : "lab cases late"}${lab.dueToday ? ` · ${lab.dueToday} ${isAr ? "مستحقة النهارده" : "due today"}` : ""}`} cta={isAr ? "طارد" : "Chase"} onClick={() => router.push("/lab")} isAr={isAr} />
                <Action label={dayBrief?.stock.low[0] ? `${dayBrief.stock.low[0].name} · ${dayBrief.stock.low[0].outOfStock ? (isAr ? "خلص" : "out of stock") : (isAr ? "قرّب يخلص" : "running low")}${dayBrief.stock.lowCount > 1 ? ` (+${dayBrief.stock.lowCount - 1})` : ""}` : `0 ${isAr ? "أصناف قربت تخلص" : "items running low"}`} cta={isAr ? "اطلب" : "Order"} onClick={() => router.push("/inventory")} isAr={isAr} />
                <Action label={`${slips.unconfirmed} ${isAr ? "مواعيد بكرة مش مؤكدة" : "unconfirmed tomorrow"}`} cta={isAr ? "فكّرهم" : "Remind"} onClick={() => router.push("/appointments")} isAr={isAr} />
              </Card>
              <Card title={isAr ? "الغياب والإلغاء" : "No-shows & cancellations"} eyebrow={eyebrow}>
                {brief ? (
                  <>
                    <Big value={pct(attendance.overall.rate)} unit={isAr ? "غياب" : "no-show"} />
                    <p className="text-xs font-semibold text-ink-muted">{attendance.overall.missed} {isAr ? "غابوا من" : "missed of"} {attendance.overall.seen + attendance.overall.missed} · {attendance.overall.cancelled} {isAr ? "اتلغوا" : "cancelled"}</p>
                    <Bars rows={attendance.doctors.filter((d) => d.doctor !== "—").slice(0, 4).map((d) => ({ label: d.doctor, value: d.rate ?? 0, text: pct(d.rate), color: "#C51F1F" }))} max={1} />
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "امتلاء الجدول" : "Schedule fill"} eyebrow={eyebrow}>
                {brief?.production ? (
                  <>
                    {brief.production.chairUtilisation ? (
                      <>
                        <Big value={`${brief.production.chairUtilisation.percent}%`} unit={isAr ? "وقت الكراسي مستخدم" : "chair time used"} />
                        <div className="h-2.5 rounded bg-surface-muted overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.min(100, brief.production.chairUtilisation.percent)}%`, background: ACCENT }} /></div>
                      </>
                    ) : <p className="text-sm font-semibold text-ink-faint">{isAr ? "حدّد مواعيد العمل في الإعدادات ← الجدول عشان الرقم ده يظهر." : "Set opening hours under Settings → Schedule for this figure."}</p>}
                    <p className="text-xs font-semibold text-ink-muted">
                      {brief.nextUp.key === "tomorrow" ? (isAr ? "بكرة" : "Tomorrow") : (isAr ? "الأسبوع الجاي" : "Next week")}: {brief.nextUp.appointments} {isAr ? "محجوز" : "booked"} · {brief.nextUp.unconfirmed} {isAr ? "مش مؤكد" : "unconfirmed"}
                      {brief.production.biggestGap ? ` · ${isAr ? "أكبر فجوة" : "biggest gap"} ${brief.production.biggestGap.minutes} ${isAr ? "د" : "min"} ${isAr ? "الساعة" : "at"} ${brief.production.biggestGap.startsAt}` : ""}
                    </p>
                  </>
                ) : moneyHidden ? <Hidden isAr={isAr} /> : <Skeleton />}
              </Card>
            </>
          )}

          {tab === "growth" && (
            <>
              <Card title={isAr ? "مرضى جدد ومن فين" : "New patients & where from"} eyebrow={eyebrow}>
                {brief ? (
                  <>
                    <Big value={String(brief.growth.newPatients)} unit={brief.trend ? `${isAr ? "مقابل" : "vs"} ${brief.trend.points.find((p) => p.key === "new_patients")?.previous ?? "—"} ${isAr ? "الفترة اللي فاتت" : "last time"}` : undefined} />
                    <Bars rows={sources.slice(0, 5).map((s) => ({ label: s.source, value: s.count, text: String(s.count) }))} />
                  </>
                ) : <Skeleton />}
              </Card>
              <Card title={isAr ? "قمع العملاء المحتملين" : "Leads funnel"} eyebrow={eyebrow}>
                <Bars rows={[
                  { label: isAr ? "سألوا" : "Asked", value: funnel.asked, text: String(funnel.asked), color: DEEMPHASIS },
                  { label: isAr ? "اتردّ عليهم" : "Replied", value: funnel.replied, text: String(funnel.replied), color: "#94A3B8" },
                  { label: isAr ? "حجزوا" : "Booked", value: funnel.booked, text: String(funnel.booked) },
                ]} max={Math.max(1, funnel.asked)} />
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-extrabold ${funnel.untouched ? "text-warn" : "text-ink-muted"}`}>{funnel.untouched} {isAr ? "مستنيين رد" : "waiting on a reply"}</span>
                  <button onClick={() => router.push("/leads")} className={ghost}>{isAr ? "العملاء" : "Open leads"} <ArrowUpRight size={12} /></button>
                </div>
              </Card>
              <Card title={isAr ? "مرضى بيتسحبوا" : "Patients slipping away"} eyebrow={eyebrow}>
                <div className="grid grid-cols-3 gap-2">
                  <Stat n={recallsDue === null ? "—" : String(recallsDue)} label={isAr ? "متابعة مستحقة" : "recalls due"} />
                  <Stat n={brief ? String(brief.actions.seenWithoutNextVisitCount) : "—"} label={isAr ? "اتشافوا بلا موعد جاي" : "seen, no next visit"} />
                  <Stat n={brief ? String(brief.actions.overdueFollowUpCount) : "—"} label={isAr ? "متابعات فاتت" : "follow-ups overdue"} />
                </div>
                <button onClick={() => router.push("/ai/reactivation")} className={`${ghost} self-start`}>{isAr ? "ابعتلهم" : "Message them"} <ArrowUpRight size={12} /></button>
              </Card>
              <Card title={isAr ? "واتساب في نظرة" : "WhatsApp at a glance"} eyebrow={eyebrow}>
                <KV rows={[[isAr ? "رسايل مش مقروءة" : "Unread chats", String(unread)], [isAr ? "مستنية الإرسال" : "Waiting to send", String(queued)], [isAr ? "البوت سلّمها لحد" : "Handed to a person", String(handoffs)]]} bold big />
                <button onClick={() => router.push("/chats")} className={`${ghost} self-start`}>{isAr ? "افتح الشات" : "Open chats"} <ArrowUpRight size={12} /></button>
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
  const s = a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : a >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : String(Math.round(n));
  return s;
}

function Pill({ children, dot }: { children: React.ReactNode; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-white/[0.08] text-[11px] font-bold text-white/85 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
      {children}
    </span>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[1.75rem] border border-white/60 bg-white/80 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-3xl px-5 py-5 flex flex-col gap-3 min-w-0">
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

function KV({ rows, bold, big }: { rows: Array<[string, string]>; bold?: boolean; big?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className={`text-[13px] truncate ${bold ? "font-bold text-ink" : "font-semibold text-ink-muted"}`}>{k}</span>
          <span className={`font-figure font-extrabold text-ink shrink-0 ${big ? "text-[20px]" : "text-[13px]"}`}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows, max, }: { rows: Array<{ label: string; value: number; text: string; color?: string; warn?: boolean }>; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm font-semibold text-ink-faint">—</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className={`text-[13px] font-bold truncate ${r.warn ? "text-warn" : "text-ink"}`}>{r.label}</span>
            <span className="font-figure text-xs font-semibold text-ink-muted shrink-0">{r.text}</span>
          </div>
          <div className="h-2 rounded bg-surface-muted overflow-hidden">
            <div className="h-full rounded transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, (r.value / top) * 100)}%`, background: r.color || (r.warn ? "#C44A0A" : ACCENT) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Action({ label, cta, onClick, isAr }: { label: string; cta?: string; onClick: () => void; isAr: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] font-bold text-ink min-w-0 truncate">{label}</span>
      <button onClick={onClick} className="inline-flex items-center gap-1 h-[30px] px-3 rounded-xl bg-surface border border-line text-ink text-[11px] font-extrabold uppercase tracking-wide shadow-sm hover:bg-surface-subtle transition-colors whitespace-nowrap shrink-0">
        {cta || (isAr ? "افتح" : "Open")} <ArrowUpRight size={11} />
      </button>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="font-figure text-[24px] font-extrabold text-ink leading-none">{n}</span>
      <span className="text-[11px] font-semibold text-ink-muted leading-tight">{label}</span>
    </div>
  );
}

function Hidden({ isAr }: { isAr: boolean }) {
  return <p className="text-sm font-semibold text-ink-faint">{isAr ? "مش معروض لدورك." : "Not shown for your role."}</p>;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse" aria-hidden="true">
      <div className="h-7 w-32 rounded-lg bg-surface-muted" />
      <div className="h-3 w-full rounded bg-surface-muted" />
      <div className="h-3 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}

type TipPayload = { name?: string; value?: number | string | null; color?: string };
function Tip({ active, payload, label, fmt, isAr }: { active?: boolean; payload?: TipPayload[]; label?: string | number; fmt: (n: number) => string; isAr: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-ink-slab text-white shadow-xl px-3.5 py-2.5 min-w-[150px]" dir={isAr ? "rtl" : "ltr"}>
      <p className="font-figure text-[10px] font-bold text-white/50 mb-1.5">{isAr ? "يوم" : "Day"} {String(label ?? "")}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-3 h-[3px] rounded-full shrink-0" style={{ background: p.color || "#fff" }} />
          <span className="font-figure text-sm font-extrabold">{p.value == null ? "—" : fmt(Number(p.value))}</span>
          <span className="text-[11px] font-semibold text-white/60 truncate">{String(p.name || "")}</span>
        </div>
      ))}
    </div>
  );
}
