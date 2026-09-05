"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { getClinicCollection } from "@/lib/db-utils";
import { useClinic } from "@/context/ClinicContext";
import type { DentistIdentity, Row } from "@/lib/dentistHome";
import {
  attendanceByBucket, moneyByBucket, patientsByBucket, periodFor, procedureMix, reportTotals, toYmd,
  type PeriodKind,
} from "@/lib/dentistReport";

/**
 * The dentist's own report, under their home screen: how the period went, in four charts.
 *
 * Every figure is the dentist's own — charged and collected on their patients, how their bookings
 * ended, what they do most, who they saw. Nothing about anyone else, by decision: whether a clinic
 * wants its dentists compared is the clinic's call, not a default.
 *
 * Colour is spent carefully. The money chart is emphasis, not categories — what came in wears the
 * accent, what was charged sits behind it in grey. Attendance is three outcomes in three colours
 * that survive colour-blindness (validated, blue / red / grey — never green against red). The
 * procedure ring uses a fixed, validated six-hue order that never changes when a slice drops out,
 * so a crown is the same colour in September as it was in August. Every chart has a table twin,
 * so no number is reachable only by colour or only on hover.
 */

type Props = {
  me: DentistIdentity;
  ledger: Row[];
  patients: Array<{ id: string; createdAt?: unknown }>;
  showShare: boolean;
  today: string;
  isAr: boolean;
};

/** Six categorical hues drawn from the app's own tokens, in an order the validator passes. */
const MIX_COLORS = ["#1D7F46", "#1D4FD8", "#C44A0A", "#0D9488", "#7C3AED", "#BE185D"];
const OTHER_COLOR = "#A0AAB2";
const ACCENT = "#1D7F46";
const DEEMPHASIS = "#CBD5E1";
const SEEN = "#1D4FD8";
const NO_SHOW = "#C51F1F";
const CANCELLED = "#A0AAB2";
const GRID = "#E2E8F0";
const TICK = { fontSize: 11, fill: "#78899F", fontWeight: 600 } as const;
const ANIM = { isAnimationActive: true, animationDuration: 900, animationEasing: "ease-out" as const };

export default function DentistReport({ me, ledger, patients, showShare, today, isAr }: Props) {
  const { clinicId } = useClinic();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [view, setView] = useState<"charts" | "table">("charts");
  const period = useMemo(() => periodFor(kind, today), [kind, today]);

  // The bookings in the period. Its own subscription: the home screen only holds today's.
  const [appointments, setAppointments] = useState<Row[]>([]);
  // Which window the rows on screen belong to. While it lags the chosen period the charts hold
  // their last render at reduced opacity — no skeleton, no jump.
  const [loadedWindow, setLoadedWindow] = useState("");
  const loading = loadedWindow !== `${period.start}|${period.end}`;
  useEffect(() => {
    if (!clinicId) return;
    const q = query(getClinicCollection("appointments"), where("date", ">=", period.start), where("date", "<=", period.end));
    return onSnapshot(
      q,
      (s) => {
        setAppointments(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadedWindow(`${period.start}|${period.end}`);
      },
      () => setLoadedWindow(`${period.start}|${period.end}`)
    );
  }, [clinicId, period.start, period.end]);

  const createdAt = useMemo(() => new Map(patients.map((p) => [p.id, toYmd(p.createdAt)])), [patients]);
  const money = useMemo(() => moneyByBucket(ledger, me, period, isAr), [ledger, me, period, isAr]);
  const attendance = useMemo(() => attendanceByBucket(appointments, me, period, isAr), [appointments, me, period, isAr]);
  const mix = useMemo(() => procedureMix(ledger, me, period, isAr ? "غير ذلك" : "Other"), [ledger, me, period, isAr]);
  const people = useMemo(() => patientsByBucket(appointments, createdAt, me, period, isAr), [appointments, createdAt, me, period, isAr]);
  const totals = useMemo(() => reportTotals(money, attendance, people), [money, attendance, people]);

  const fmt = (n: number) => Math.round(n).toLocaleString(isAr ? "ar-EG" : "en-US");
  const periods: Array<{ key: PeriodKind; label: string }> = [
    { key: "week", label: isAr ? "الأسبوع ده" : "This week" },
    { key: "month", label: isAr ? "الشهر ده" : "This month" },
    { key: "quarter", label: isAr ? "آخر 3 شهور" : "Last 3 months" },
    { key: "year", label: isAr ? "السنة دي" : "This year" },
  ];
  const eyebrow = "font-display text-[11px] font-black uppercase tracking-[0.12em] text-ink-muted";
  const hasMoney = money.some((p) => p.charged || p.collected);
  const hasAtt = attendance.some((p) => p.seen || p.noShow || p.cancelled);
  const hasPeople = people.some((p) => p.newPatients || p.returning);

  return (
    <section className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2">
          <span className={eyebrow}>{isAr ? "تقريري" : "My report"}</span>
          <span className="font-figure text-xs font-bold text-ink-faint">
            {period.start} → {period.end}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-surface border border-slate-200/60 p-1 shadow-sm">
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => setKind(p.key)}
                className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-colors ${
                  kind === p.key ? "bg-ink-slab text-white" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setView((v) => (v === "charts" ? "table" : "charts"))}
            className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-full bg-surface border border-slate-200/60 text-[11px] font-bold text-slate-600 hover:text-slate-900 shadow-sm transition-colors"
            aria-pressed={view === "table"}
          >
            {view === "charts" ? <Table2 size={13} /> : <BarChart3 size={13} />}
            {view === "charts" ? (isAr ? "جدول" : "Table") : (isAr ? "رسوم" : "Charts")}
          </button>
        </div>
      </div>

      {/* The headline figures, counted up. */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
        <Tile label={isAr ? "اتحاسب" : "Charged"} value={totals.charged} unit={isAr ? "ج.م" : "EGP"} fmt={fmt} />
        <Tile
          label={isAr ? "اتحصّل" : "Collected"}
          value={totals.collected}
          unit={isAr ? "ج.م" : "EGP"}
          fmt={fmt}
          sub={showShare ? `${isAr ? "نصيبي" : "My share"} ${fmt(totals.share)}` : undefined}
        />
        <Tile
          label={isAr ? "مرضى اتشافوا" : "Patients seen"}
          value={totals.seen}
          fmt={fmt}
          sub={`${totals.newPatients} ${isAr ? "جدد" : "new"} · ${totals.patients - totals.newPatients} ${isAr ? "راجعين" : "returning"}`}
        />
        <Tile
          label={isAr ? "نسبة الغياب" : "No-show rate"}
          value={totals.noShowRate === null ? 0 : totals.noShowRate * 100}
          unit="%"
          fmt={(n) => (totals.noShowRate === null ? "—" : Math.round(n).toString())}
          tone={totals.noShowRate !== null && totals.noShowRate >= 0.2 ? "warn" : undefined}
        />
      </div>

      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {/* Money */}
        <Card title={isAr ? "اتحاسب واتحصّل" : "Charged vs collected"} eyebrow={eyebrow}>
          {view === "table" ? (
            <DataTable
              cols={[isAr ? "اليوم" : "When", isAr ? "اتحاسب" : "Charged", isAr ? "اتحصّل" : "Collected", ...(showShare ? [isAr ? "نصيبي" : "My share"] : [])]}
              rows={money.map((p) => [p.label, fmt(p.charged), fmt(p.collected), ...(showShare ? [fmt(p.share)] : [])])}
            />
          ) : !hasMoney ? (
            <Empty>{isAr ? "مفيش حسابات في الفترة دي." : "No money in this period yet."}</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={money} barCategoryGap="30%" barGap={2} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={TICK} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} tick={TICK} tickFormatter={(v) => compact(Number(v))} width={44} />
                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={<Tip fmt={fmt} isAr={isAr} unit={isAr ? "ج.م" : "EGP"} extra={showShare ? { key: "share", label: isAr ? "نصيبي" : "My share" } : undefined} />} />
                <Legend verticalAlign="top" align="right" iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "#64748B", paddingBottom: 8 }} />
                <Bar dataKey="charged" name={isAr ? "اتحاسب" : "Charged"} fill={DEEMPHASIS} radius={[4, 4, 0, 0]} maxBarSize={24} {...ANIM} />
                <Bar dataKey="collected" name={isAr ? "اتحصّل" : "Collected"} fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={24} {...ANIM} animationBegin={120} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Attendance */}
        <Card title={isAr ? "الحضور" : "How bookings ended"} eyebrow={eyebrow}>
          {view === "table" ? (
            <DataTable
              cols={[isAr ? "اليوم" : "When", isAr ? "حضروا" : "Seen", isAr ? "غابوا" : "No-show", isAr ? "اتلغوا" : "Cancelled"]}
              rows={attendance.map((p) => [p.label, String(p.seen), String(p.noShow), String(p.cancelled)])}
            />
          ) : !hasAtt ? (
            <Empty>{isAr ? "مفيش مواعيد اتقفلت في الفترة دي." : "No bookings decided in this period yet."}</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={attendance} barCategoryGap="30%" margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={TICK} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} tick={TICK} allowDecimals={false} width={44} />
                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={<Tip fmt={(n) => String(n)} isAr={isAr} />} />
                <Legend verticalAlign="top" align="right" iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "#64748B", paddingBottom: 8 }} />
                {/* A 2px surface stroke is the gap between stacked segments. */}
                <Bar dataKey="seen" stackId="a" name={isAr ? "حضروا" : "Seen"} fill={SEEN} stroke="#FFFFFF" strokeWidth={2} maxBarSize={24} {...ANIM} />
                <Bar dataKey="noShow" stackId="a" name={isAr ? "غابوا" : "No-show"} fill={NO_SHOW} stroke="#FFFFFF" strokeWidth={2} maxBarSize={24} {...ANIM} animationBegin={120} />
                <Bar dataKey="cancelled" stackId="a" name={isAr ? "اتلغوا" : "Cancelled"} fill={CANCELLED} stroke="#FFFFFF" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={24} {...ANIM} animationBegin={240} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Procedure mix */}
        <Card title={isAr ? "أكتر حاجة بعملها" : "What I do most"} eyebrow={eyebrow}>
          {view === "table" || mix.length === 0 ? (
            mix.length === 0 ? (
              <Empty>{isAr ? "مفيش إجراءات في الفترة دي." : "No procedures charged in this period yet."}</Empty>
            ) : (
              <DataTable
                cols={[isAr ? "الإجراء" : "Procedure", isAr ? "العدد" : "Count", isAr ? "ج.م" : "EGP"]}
                rows={mix.map((s) => [s.name, String(s.count), fmt(s.amount)])}
              />
            )
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-[180px] h-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={mix}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius={54}
                      outerRadius={84}
                      paddingAngle={2}
                      cornerRadius={3}
                      stroke="none"
                      {...ANIM}
                    >
                      {mix.map((s, i) => (
                        <Cell key={s.name} fill={s.other ? OTHER_COLOR : MIX_COLORS[i % MIX_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<Tip fmt={fmt} isAr={isAr} unit={isAr ? "ج.م" : "EGP"} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* The ring's direct labels: the list beside it carries name, count and money. */}
              <ul className="flex-1 min-w-0 w-full flex flex-col gap-1.5">
                {mix.map((s, i) => (
                  <li key={s.name} className="flex items-center gap-2.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.other ? OTHER_COLOR : MIX_COLORS[i % MIX_COLORS.length] }} />
                    <span className="font-bold text-ink truncate flex-1">{s.name}</span>
                    <span className="font-figure font-semibold text-ink-muted shrink-0">{s.count}×</span>
                    <span className="font-figure font-bold text-ink shrink-0 w-[72px] text-end">{fmt(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Patients */}
        <Card title={isAr ? "مرضى جدد وراجعين" : "New vs returning patients"} eyebrow={eyebrow}>
          {view === "table" ? (
            <DataTable
              cols={[isAr ? "اليوم" : "When", isAr ? "جدد" : "New", isAr ? "راجعين" : "Returning"]}
              rows={people.map((p) => [p.label, String(p.newPatients), String(p.returning)])}
            />
          ) : !hasPeople ? (
            <Empty>{isAr ? "مفيش مرضى اتشافوا في الفترة دي." : "No patients seen in this period yet."}</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={people} barCategoryGap="30%" margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={TICK} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} tick={TICK} allowDecimals={false} width={44} />
                <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={<Tip fmt={(n) => String(n)} isAr={isAr} />} />
                <Legend verticalAlign="top" align="right" iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "#64748B", paddingBottom: 8 }} />
                <Bar dataKey="returning" stackId="p" name={isAr ? "راجعين" : "Returning"} fill={DEEMPHASIS} stroke="#FFFFFF" strokeWidth={2} maxBarSize={24} {...ANIM} />
                <Bar dataKey="newPatients" stackId="p" name={isAr ? "جدد" : "New"} fill={ACCENT} stroke="#FFFFFF" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={24} {...ANIM} animationBegin={120} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </section>
  );
}

// --- Pieces ------------------------------------------------------------------------------------------

/** A number that counts up to where it is going. Sits still for people who asked for less motion. */
function useCountUp(target: number, ms = 800): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion still goes through one frame rather than setting state inside the effect:
    // the number lands in place, it just does not travel.
    const duration = reduce ? 0 : ms;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = duration === 0 ? 1 : Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(start + (target - start) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function Tile({ label, value, unit, fmt, sub, tone }: { label: string; value: number; unit?: string; fmt: (n: number) => string; sub?: string; tone?: "warn" }) {
  const shown = useCountUp(value);
  return (
    <div className="rounded-2xl bg-surface border border-line shadow-sm px-4 py-3.5 flex flex-col gap-1.5 min-w-0">
      <span className="font-display text-[10px] font-black uppercase tracking-[0.12em] text-ink-muted truncate">{label}</span>
      <span className={`font-figure text-[24px] font-extrabold leading-none ${tone === "warn" ? "text-warn" : "text-ink"}`} style={{ fontVariantNumeric: "normal" }}>
        {fmt(shown)}
        {unit && <span className="text-[11px] font-semibold text-ink-faint tracking-[0.08em] ms-1">{unit}</span>}
      </span>
      {sub && <span className="font-figure text-[11px] font-semibold text-ink-muted truncate">{sub}</span>}
    </div>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[2rem] border border-white/60 bg-white/80 shadow-[0_8px_40px_rgba(0,0,0,0.04)] backdrop-blur-3xl overflow-hidden flex flex-col">
      <div className="px-6 pt-5 pb-2">
        <span className={eyebrow}>{title}</span>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-2 pt-1 text-sm font-semibold text-ink-faint">{children}</p>;
}

function DataTable({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto max-h-[260px] overflow-y-auto rounded-xl border border-line">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-subtle">
          <tr>
            {cols.map((c, i) => (
              <th key={c} className={`px-3 py-2 font-display text-[10px] font-black uppercase tracking-[0.1em] text-ink-muted ${i === 0 ? "text-start" : "text-end"}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-muted">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`px-3 py-1.5 ${j === 0 ? "text-start font-bold text-ink" : "text-end font-figure font-semibold text-ink-body"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TipPayload = { name?: string; value?: number | string; color?: string; dataKey?: string; payload?: Record<string, unknown> };

/** Values lead, names follow; a short line key per series. */
function Tip({ active, payload, label, fmt, isAr, unit, extra }: {
  active?: boolean; payload?: TipPayload[]; label?: string;
  fmt: (n: number) => string; isAr: boolean; unit?: string; extra?: { key: string; label: string };
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.dataKey !== extra?.key);
  const first = payload[0]?.payload || {};
  return (
    <div className="rounded-xl bg-ink-slab text-white shadow-xl px-3.5 py-2.5 min-w-[150px]" dir={isAr ? "rtl" : "ltr"}>
      {label !== undefined && <p className="font-figure text-[10px] font-bold text-white/50 mb-1.5">{String(label)}</p>}
      {rows.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-3 h-[3px] rounded-full shrink-0" style={{ background: p.color || "#fff" }} />
          <span className="font-figure text-sm font-extrabold">{fmt(Number(p.value) || 0)}{unit ? <span className="text-[10px] font-semibold text-white/50 ms-1">{unit}</span> : null}</span>
          <span className="text-[11px] font-semibold text-white/60 truncate">{String(p.name || "")}</span>
        </div>
      ))}
      {extra && typeof first[extra.key] === "number" && (
        <div className="flex items-center gap-2 pt-1 mt-1 border-t border-white/10">
          <span className="w-3 h-[3px] rounded-full shrink-0 bg-white/30" />
          <span className="font-figure text-sm font-extrabold">{fmt(Number(first[extra.key]))}{unit ? <span className="text-[10px] font-semibold text-white/50 ms-1">{unit}</span> : null}</span>
          <span className="text-[11px] font-semibold text-white/60">{extra.label}</span>
        </div>
      )}
    </div>
  );
}

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}
