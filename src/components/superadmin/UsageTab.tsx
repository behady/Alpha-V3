"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { ChevronDown, Loader2, Mail, Phone, RefreshCcw, Smartphone } from "lucide-react";
import { KNOWN_PAGES, formatDuration, pageLabel, type PageRow, type PersonRow } from "@/lib/usage";
import { useSuperAdminText } from "./i18n";

/**
 * Who uses what — across every clinic, by person.
 *
 * Two questions, two views. "People": who is in the app, for how long, on which screens and
 * pressing what — with the email and phone beside the name, because the point is to ring them and
 * ask. "Screens": which screens earn their place, and at the bottom the ones nobody opened at
 * all, which is the list to prune from.
 *
 * Time is ACTIVE time (lib/usage): the screen visible and touched within the last two minutes.
 */

interface Report {
  period: { from: string; to: string };
  clinics: Record<string, string>;
  months: string[];
  people: PersonRow[];
  pages: PageRow[];
}

const cell = "px-3 py-2.5 text-sm";
const head = "px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400 text-start";

function targetLabel(target: string, ar: boolean): string {
  if (target.startsWith("go:")) return `${ar ? "راح على" : "→"} ${pageLabel(target.slice(3), ar)}`;
  if (target.startsWith("tab:")) return `${ar ? "تبويب" : "Tab"} “${target.slice(4)}”`;
  return target;
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-[#FACC15]" style={{ width: `${Math.max(2, Math.round((value / Math.max(1, max)) * 100))}%` }} />
    </div>
  );
}

function PageBreakdown({ pages, ar }: { pages: PageRow[]; ar: boolean }) {
  const max = Math.max(1, ...pages.map((p) => p.sec));
  return (
    <div className="space-y-3 rounded-xl bg-slate-950/60 p-4">
      {pages.map((p) => (
        <div key={p.key} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-bold text-white">{pageLabel(p.key, ar)}</span>
            <span className="text-xs font-semibold text-slate-400">
              <span className="font-black text-white">{formatDuration(p.sec, ar)}</span> · {ar ? `اتفتحت ${p.opens} مرة · ${p.taps} ضغطة` : `opened ${p.opens}× · ${p.taps} taps`}
            </span>
          </div>
          <Bar value={p.sec} max={max} />
          {p.hits.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {p.hits.map((h) => (
                <span key={h.target} className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                  {targetLabel(h.target, ar)} <span className="font-black text-white">{h.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function UsageTab() {
  const { isAr: ar } = useSuperAdminText();
  const L = (en: string, arText: string) => (ar ? arText : en);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("days:30");
  const [clinic, setClinic] = useState("all");
  const [view, setView] = useState<"people" | "screens">("people");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const [kind, value] = period.split(":");
      const res = await fetch(`/api/admin/usage?${kind === "month" ? `month=${value}` : `days=${value}`}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(L("Could not load the usage report.", "تعذّر تحميل تقرير الاستخدام."));
      setReport(data as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : L("Could not load.", "تعذّر التحميل."));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(
    () => (report?.people ?? []).filter((p) => clinic === "all" || p.clinicId === clinic),
    [report, clinic]
  );

  /** Screens for the chosen clinic: rebuilt from its people, so the filter applies to both views. */
  const screens = useMemo(() => {
    if (!report) return [] as PageRow[];
    if (clinic === "all") return report.pages;
    const byKey = new Map<string, PageRow>();
    for (const person of people) {
      for (const p of person.pages) {
        const row = byKey.get(p.key) || { key: p.key, sec: 0, opens: 0, taps: 0, phoneSec: 0, people: 0, hits: [] };
        const hits = new Map(row.hits.map((h) => [h.target, h.count]));
        p.hits.forEach((h) => hits.set(h.target, (hits.get(h.target) || 0) + h.count));
        byKey.set(p.key, {
          ...row,
          sec: row.sec + p.sec,
          opens: row.opens + p.opens,
          taps: row.taps + p.taps,
          phoneSec: row.phoneSec + p.phoneSec,
          people: row.people + 1,
          hits: [...hits.entries()].map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count).slice(0, 8),
        });
      }
    }
    return [...byKey.values()].sort((a, b) => b.sec - a.sec || b.opens - a.opens);
  }, [report, clinic, people]);

  /** Menu screens with no time on them at all, counting a screen's tabs as the screen. */
  const unused = useMemo(() => {
    const used = new Set(screens.filter((s) => s.sec > 0 || s.opens > 0).flatMap((s) => [s.key, s.key.split("#")[0]]));
    return KNOWN_PAGES.filter((p) => !used.has(p.key));
  }, [screens]);

  const totalSec = people.reduce((n, p) => n + p.sec, 0);
  const maxScreen = Math.max(1, ...screens.map((s) => s.sec));
  const clinicOptions = Object.entries(report?.clinics ?? {}).sort((a, b) => a[1].localeCompare(b[1]));
  const select = "rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-200 outline-none";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-black text-white">{L("Usage", "الاستخدام")}</h2>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={select}>
          <option value="days:1">{L("Today", "النهارده")}</option>
          <option value="days:7">{L("Last 7 days", "آخر 7 أيام")}</option>
          <option value="days:30">{L("Last 30 days", "آخر 30 يوم")}</option>
          <option value="days:60">{L("Last 60 days", "آخر 60 يوم")}</option>
          {(report?.months ?? []).map((m) => (
            <option key={m} value={`month:${m}`}>{L(`Month ${m} (summary)`, `شهر ${m} (ملخص)`)}</option>
          ))}
        </select>
        <select value={clinic} onChange={(e) => setClinic(e.target.value)} className={select}>
          <option value="all">{L("All clinics", "كل العيادات")}</option>
          {clinicOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <div className="inline-flex rounded-lg bg-slate-800 p-1">
          {(["people", "screens"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm font-bold ${view === v ? "bg-[#FACC15] text-slate-900" : "text-slate-300 hover:text-white"}`}
            >
              {v === "people" ? L("People", "الأشخاص") : L("Screens", "الشاشات")}
            </button>
          ))}
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-700">
          <RefreshCcw size={14} /> {L("Refresh", "تحديث")}
        </button>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>

      <p className="text-xs font-medium text-slate-400">
        {L(
          "Time is active time: the screen open and touched in the last two minutes. Day-by-day detail is kept for two months, then only the monthly summary stays.",
          "الوقت هو وقت الاستخدام الفعلي: الشاشة مفتوحة واتلمست في آخر دقيقتين. تفاصيل كل يوم بتتحفظ شهرين، وبعدها بيفضل ملخص الشهر بس."
        )}
      </p>

      {error && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">{error}</p>}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: L("People active", "أشخاص استخدموا النظام"), value: String(people.length) },
              { label: L("Total active time", "إجمالي وقت الاستخدام"), value: formatDuration(totalSec, ar) },
              { label: L("Screens used", "شاشات اتستخدمت"), value: String(screens.filter((s) => s.sec > 0).length) },
            ].map((k) => (
              <div key={k.label} className="rounded-xl bg-slate-800/70 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{k.label}</p>
                <p className="mt-1 text-2xl font-black text-white">{k.value}</p>
              </div>
            ))}
          </div>

          {people.length === 0 && !loading && (
            <p className="rounded-xl bg-slate-800/60 px-4 py-6 text-center text-sm font-semibold text-slate-300">
              {L("Nothing recorded in this period yet. Counting starts the day this goes live.", "مفيش حاجة متسجلة في الفترة دي لسه. العدّ بيبدأ من يوم التشغيل.")}
            </p>
          )}

          {view === "people" && people.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[720px] border-collapse">
                <thead className="bg-slate-800/60">
                  <tr>
                    <th className={head}>{L("Person", "الشخص")}</th>
                    <th className={head}>{L("Clinic", "العيادة")}</th>
                    <th className={head}>{L("Active time", "وقت الاستخدام")}</th>
                    <th className={head}>{L("Days", "أيام")}</th>
                    <th className={head}>{L("Taps", "ضغطات")}</th>
                    <th className={head}>{L("Most used screen", "أكتر شاشة")}</th>
                    <th className={head} />
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const id = `${p.clinicId}__${p.uid}`;
                    const isOpen = open === id;
                    const phoneShare = p.sec > 0 ? Math.round((p.phoneSec / p.sec) * 100) : 0;
                    return (
                      <React.Fragment key={id}>
                        <tr onClick={() => setOpen(isOpen ? null : id)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40">
                          <td className={cell}>
                            <p className="font-bold text-white">{p.name || p.email || p.uid}</p>
                            <p className="text-xs font-semibold text-slate-400">{p.role}</p>
                          </td>
                          <td className={`${cell} font-semibold text-slate-200`}>{report.clinics[p.clinicId] || p.clinicId}</td>
                          <td className={`${cell} font-black text-white`}>
                            {formatDuration(p.sec, ar)}
                            {phoneShare > 0 && (
                              <span className="ms-2 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400" title={L("Share of the time spent on a phone", "نسبة الوقت على الموبايل")}>
                                <Smartphone size={11} /> {phoneShare}%
                              </span>
                            )}
                          </td>
                          <td className={`${cell} text-slate-200`}>{p.daysActive}</td>
                          <td className={`${cell} text-slate-200`}>{p.taps}</td>
                          <td className={`${cell} text-slate-200`}>
                            {p.pages[0] ? `${pageLabel(p.pages[0].key, ar)} · ${formatDuration(p.pages[0].sec, ar)}` : "—"}
                          </td>
                          <td className={cell}>
                            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-slate-800 bg-slate-900/60">
                            <td colSpan={7} className="space-y-3 px-3 py-4">
                              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-semibold text-slate-300">
                                {p.email && (
                                  <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 hover:text-white"><Mail size={13} /> {p.email}</a>
                                )}
                                {p.phone && (
                                  <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1.5 hover:text-white" dir="ltr"><Phone size={13} /> {p.phone}</a>
                                )}
                                {p.lastDay && <span>{L("Last active", "آخر استخدام")} {p.lastDay}</span>}
                                <span>{L(`Opened screens ${p.opens}×`, `فتح شاشات ${p.opens} مرة`)}</span>
                              </div>
                              <PageBreakdown pages={p.pages} ar={ar} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {view === "screens" && people.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead className="bg-slate-800/60">
                    <tr>
                      <th className={head}>{L("Screen", "الشاشة")}</th>
                      <th className={head}>{L("Active time", "وقت الاستخدام")}</th>
                      <th className={head}>{L("People", "أشخاص")}</th>
                      <th className={head}>{L("Opened", "اتفتحت")}</th>
                      <th className={head}>{L("Taps", "ضغطات")}</th>
                      <th className={head} />
                    </tr>
                  </thead>
                  <tbody>
                    {screens.map((s) => {
                      const isOpen = open === `s:${s.key}`;
                      return (
                        <React.Fragment key={s.key}>
                          <tr onClick={() => setOpen(isOpen ? null : `s:${s.key}`)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40">
                            <td className={cell}>
                              <p className="font-bold text-white">{pageLabel(s.key, ar)}</p>
                              <div className="mt-1.5 max-w-[260px]"><Bar value={s.sec} max={maxScreen} /></div>
                            </td>
                            <td className={`${cell} font-black text-white`}>{formatDuration(s.sec, ar)}</td>
                            <td className={`${cell} text-slate-200`}>{s.people}</td>
                            <td className={`${cell} text-slate-200`}>{s.opens}×</td>
                            <td className={`${cell} text-slate-200`}>{s.taps}</td>
                            <td className={cell}>
                              <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-t border-slate-800 bg-slate-900/60">
                              <td colSpan={6} className="space-y-3 px-3 py-4">
                                {s.hits.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {s.hits.map((h) => (
                                      <span key={h.target} className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                                        {targetLabel(h.target, ar)} <span className="font-black text-white">{h.count}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="space-y-1">
                                  {people
                                    .map((p) => ({ p, page: p.pages.find((x) => x.key === s.key) }))
                                    .filter((x) => x.page && (x.page.sec > 0 || x.page.opens > 0))
                                    .sort((a, b) => (b.page?.sec || 0) - (a.page?.sec || 0))
                                    .map(({ p, page }) => (
                                      <p key={`${p.clinicId}__${p.uid}`} className="flex flex-wrap justify-between gap-x-4 text-sm text-slate-300">
                                        <span>
                                          <span className="font-bold text-white">{p.name || p.email}</span> · {p.role} · {report.clinics[p.clinicId] || p.clinicId}
                                        </span>
                                        <span className="font-semibold">
                                          <span className="font-black text-white">{formatDuration(page?.sec || 0, ar)}</span> · {page?.opens}× · {page?.taps} {L("taps", "ضغطة")}
                                        </span>
                                      </p>
                                    ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {unused.length > 0 && (
                <div className="rounded-xl border border-slate-800 p-4">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{L("Opened by nobody in this period", "محدش فتحها في الفترة دي")}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {unused.map((p) => (
                      <span key={p.key} className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">{ar ? p.ar : p.label}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
