"use client";

/**
 * The activity log (Settings → Activity log, owner and admins): what happened, who did it and
 * when, for the dates picked, in the clinic's words.
 *
 * Everything below the dark header is computed over the whole loaded range (up to 5,000 entries),
 * never over "the latest 200": a filter over part of the data, saying nothing about it, is how an
 * entry that is merely not loaded gets read as something that never happened.
 *
 * With a `patientId` it is the patient file's tab instead: that patient's entries, newest first,
 * 200 at a time, no date presets and no patient box.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { addDaysYmd, clinicTimeZone, instantAtYmd, ymdInTimeZone } from "@/lib/clinicDate";
import {
  dayKey,
  filterEntries,
  foldGroups,
  personKey,
  personName,
  rangeFor,
  summarize,
  type FoldedEntry,
  type Preset,
  type Tab,
} from "@/lib/activity/feed";
import { useActivityRange, usePatientActivity } from "@/lib/activity/useActivity";
import type { ActivityLogDoc } from "@/lib/activity/types";
import ActivityEntry, { FlagMark } from "./ActivityEntry";
import ActivitySummary from "./ActivitySummary";

const TABS: Array<{ key: Tab; ar: string; en: string }> = [
  { key: "all", ar: "الكل", en: "All" },
  { key: "money", ar: "الفلوس", en: "Money" },
  { key: "discount", ar: "الخصومات", en: "Discounts" },
  { key: "insurance", ar: "التأمين", en: "Insurance" },
  { key: "appointment", ar: "المواعيد", en: "Appointments" },
  { key: "patient", ar: "المرضى", en: "Patients" },
  { key: "clinical", ar: "العلاج", en: "Treatment" },
  { key: "lab", ar: "المعمل", en: "Lab" },
  { key: "team", ar: "الفريق", en: "Team" },
  { key: "settings", ar: "الإعدادات", en: "Settings" },
];

type PresetKey = "today" | "yesterday" | "week" | "month" | "custom";
const PRESETS: Array<{ key: PresetKey; ar: string; en: string }> = [
  { key: "today", ar: "النهارده", en: "Today" },
  { key: "yesterday", ar: "إمبارح", en: "Yesterday" },
  { key: "week", ar: "آخر 7 أيام", en: "Last 7 days" },
  { key: "month", ar: "الشهر ده", en: "This month" },
  { key: "custom", ar: "اختار تواريخ", en: "Pick dates" },
];

/** Lines drawn at a time; the rest wait behind "show more" so 5,000 rows never render at once. */
const PAGE = 300;

const EYEBROW = "font-display text-[11px] font-black uppercase tracking-[0.12em]";
const SELECT =
  "h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink outline-none transition-colors focus:border-ink sm:w-auto sm:min-w-[11rem]";

/** A calendar day in words on the clinic's calendar, Latin digits like the rest of the page. */
function dayWords(ymd: string, tz: string, isAr: boolean, withWeekday: boolean, withYear = true): string {
  // Midday of that day, so no clock change can tip it into a neighbour.
  const at = new Date(instantAtYmd(tz, ymd).getTime() + 12 * 3600 * 1000);
  return new Intl.DateTimeFormat(isAr ? "ar-EG-u-nu-latn" : "en-GB", {
    timeZone: tz,
    ...(withWeekday ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(at);
}

export default function ActivityFeed({ patientId }: { patientId?: string }) {
  return patientId ? <PatientFeed patientId={patientId} /> : <RangeFeed />;
}

// ---------------------------------------------------------------- the settings page: a date range

function RangeFeed() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const tz = clinicTimeZone();
  // "Now" is pinned until refresh, so "today" does not move under the reader mid-scroll.
  const [now, setNow] = useState(() => new Date());
  const today = ymdInTimeZone(tz, now);
  const [presetKey, setPresetKey] = useState<PresetKey>("today");
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => {
    const t = ymdInTimeZone(clinicTimeZone(), new Date());
    return { from: t, to: t };
  });
  const preset: Preset = presetKey === "custom" ? custom : presetKey;
  const range = useMemo(() => rangeFor(preset, now, tz), [preset, now, tz]);
  const { logs, loading, capped, error, reload } = useActivityRange(range.start, range.end);

  const refresh = () => {
    setNow(new Date());
    reload();
  };

  const firstDay = ymdInTimeZone(tz, range.start);
  const lastDay = ymdInTimeZone(tz, new Date(range.end.getTime() - 1));
  const rangeLabel =
    firstDay === lastDay
      ? dayWords(firstDay, tz, isAr, true)
      : `${dayWords(firstDay, tz, isAr, false, firstDay.slice(0, 4) !== lastDay.slice(0, 4))} – ${dayWords(lastDay, tz, isAr, false)}`;

  const pill = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-[12px] font-bold whitespace-nowrap transition-colors ${
      active ? "bg-white text-ink" : "bg-white/[0.08] text-white/70 hover:text-white"
    }`;
  const dateInput =
    "h-9 rounded-xl border border-white/15 bg-white/[0.08] px-3 font-figure text-[13px] font-semibold text-white outline-none [color-scheme:dark] focus:border-white/50";

  const dateControls = (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={isAr ? "الفترة" : "Dates"} className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={presetKey === p.key} onClick={() => setPresetKey(p.key)} className={pill(presetKey === p.key)}>
            {isAr ? p.ar : p.en}
          </button>
        ))}
      </div>
      {presetKey === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] font-bold text-white/60">
            {isAr ? "من" : "From"}
            <input
              type="date"
              value={custom.from}
              max={today}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
              className={dateInput}
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] font-bold text-white/60">
            {isAr ? "إلى" : "To"}
            <input
              type="date"
              value={custom.to}
              max={today}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
              className={dateInput}
            />
          </label>
        </div>
      )}
    </div>
  );

  return (
    <FeedView
      logs={logs}
      loading={loading}
      error={error}
      capped={capped}
      onRefresh={refresh}
      today={today}
      tz={tz}
      rangeLabel={rangeLabel}
      dateControls={dateControls}
    />
  );
}

// ---------------------------------------------------------------- the patient file: one patient

function PatientFeed({ patientId }: { patientId: string }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const tz = clinicTimeZone();
  const [now, setNow] = useState(() => new Date());
  const { logs, loading, hasOlder, loadOlder, error, olderError, reload } = usePatientActivity(patientId);
  return (
    <FeedView
      logs={logs}
      loading={loading}
      error={error}
      capped={false}
      onRefresh={() => {
        setNow(new Date());
        reload();
      }}
      today={ymdInTimeZone(tz, now)}
      tz={tz}
      patientMode
      footer={
        hasOlder ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-ink-body transition-colors hover:text-ink disabled:opacity-50"
            >
              {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {isAr ? "حمّل أقدم" : "Load older"}
            </button>
            {olderError && (
              <p role="alert" className="text-[12px] font-bold text-ink-muted">
                {isAr ? "مقدرناش نحمّل الأقدم. حاول تاني." : "Could not load older entries. Try again."}
              </p>
            )}
          </div>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------- the shared body

function FeedView({
  logs,
  loading,
  error,
  capped,
  onRefresh,
  today,
  tz,
  rangeLabel,
  dateControls,
  patientMode = false,
  footer,
}: {
  logs: ActivityLogDoc[];
  loading: boolean;
  error: boolean;
  capped: boolean;
  onRefresh: () => void;
  today: string;
  tz: string;
  rangeLabel?: string;
  dateControls?: ReactNode;
  patientMode?: boolean;
  footer?: ReactNode;
}) {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const { branches } = useActiveBranch();

  const [tab, setTab] = useState<Tab>("all");
  const [userId, setUserId] = useState("");
  const [patient, setPatient] = useState("");
  const [branchId, setBranchId] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // People who appear in what is loaded. A person picked for other dates who is not here is
  // dropped from the filter rather than left selected on an option that does not exist.
  const people = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const log of logs) {
      const key = personKey(log);
      if (key && !byKey.get(key)) byKey.set(key, personName(log));
    }
    return Array.from(byKey, ([key, name]) => ({ key, name: name || (isAr ? "غير معروف" : "Unknown") })).sort((a, b) =>
      a.name.localeCompare(b.name, isAr ? "ar" : "en"),
    );
  }, [logs, isAr]);
  const person = people.some((p) => p.key === userId) ? userId : "";
  const showBranches = branches.length > 1;
  const branch = showBranches && branches.some((b) => b.id === branchId) ? branchId : "";
  const patientTerm = patientMode ? "" : patient;

  const everyoneHere = useMemo(
    () => filterEntries(logs, { tab, patient: patientTerm, branchId: branch || undefined, flaggedOnly }),
    [logs, tab, patientTerm, branch, flaggedOnly],
  );
  const folded = useMemo(
    () => foldGroups(person ? everyoneHere.filter((l) => personKey(l) === person) : everyoneHere),
    [everyoneHere, person],
  );
  // The people summary compares staff over a date range; on one patient's file it has no audience.
  const summaryTab = !patientMode && (tab === "money" || tab === "discount" || tab === "insurance") ? tab : null;
  const summary = useMemo(() => (summaryTab ? summarize(everyoneHere, summaryTab) : []), [everyoneHere, summaryTab]);
  const flaggedCount = useMemo(() => folded.filter((f) => f.log.flag === true).length, [folded]);

  const filterKey = JSON.stringify([tab, person, patientTerm, branch, flaggedOnly, logs.length]);
  const [shown, setShown] = useState({ key: "", n: PAGE });
  const limitN = shown.key === filterKey ? shown.n : PAGE;
  const visible = useMemo(() => folded.slice(0, limitN), [folded, limitN]);
  const days = useMemo(() => {
    const out: Array<{ day: string; entries: FoldedEntry[] }> = [];
    for (const entry of visible) {
      const day = dayKey(entry.log, tz);
      const last = out[out.length - 1];
      if (last && last.day === day) last.entries.push(entry);
      else out.push({ day, entries: [entry] });
    }
    return out;
  }, [visible, tz]);
  const dayTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of folded) {
      const d = dayKey(f.log, tz);
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [folded, tz]);

  const anyFilter = !!person || !!patientTerm.trim() || !!branch || flaggedOnly;
  const clearFilters = () => {
    setUserId("");
    setPatient("");
    setBranchId("");
    setFlaggedOnly(false);
  };
  const firstLoad = loading && logs.length === 0;
  const yesterday = addDaysYmd(today, -1);
  const dayHeading = (day: string) => {
    if (!day) return isAr ? "بدون تاريخ" : "No date";
    const words = dayWords(day, tz, isAr, true);
    if (day === today) return `${isAr ? "النهارده" : "Today"} · ${words}`;
    if (day === yesterday) return `${isAr ? "إمبارح" : "Yesterday"} · ${words}`;
    return words;
  };
  const num = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="w-full space-y-4 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* The one place with contrast: what is being shown, how much of it, and for when. */}
      <section className="rounded-[2rem] bg-ink-slab p-5 text-white shadow-[0_20px_50px_rgba(26,33,48,0.18)] md:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className={`${EYEBROW} text-white/50`}>{isAr ? "سجل النشاط" : "Activity log"}</span>
          <button
            type="button"
            onClick={onRefresh}
            aria-label={isAr ? "تحديث" : "Refresh"}
            title={isAr ? "تحديث" : "Refresh"}
            className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/70 transition-colors hover:text-white"
          >
            {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          <p className="flex items-baseline gap-2">
            <span className="font-figure text-[40px] font-semibold leading-none md:text-[48px]">{firstLoad || error ? "—" : num(folded.length)}</span>
            <span className="text-sm font-semibold text-white/45">{isAr ? "حركة" : folded.length === 1 ? "action" : "actions"}</span>
          </p>
          <p className="flex items-baseline gap-2">
            <span className="font-figure text-[26px] font-semibold leading-none">{firstLoad || error ? "—" : num(flaggedCount)}</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/45">
              <FlagMark isAr={isAr} className="self-center" />
              {isAr ? "تستاهل نظرة" : "worth a look"}
            </span>
          </p>
          {rangeLabel && <p className="text-[13px] font-semibold text-white/60 md:ms-auto">{rangeLabel}</p>}
        </div>

        {dateControls && <div className="mt-4 border-t border-white/10 pt-4">{dateControls}</div>}
      </section>

      {patientMode && (
        <p className="px-1 text-[12px] font-semibold text-ink-muted">
          {isAr
            ? "السجل ده بيبدأ من 14 أكتوبر 2026 — الحركات القديمة في صفحة سجل النشاط"
            : "This log starts on 14 October 2026 — older actions are on the Activity log page"}
        </p>
      )}

      {/* Tabs */}
      <div role="group" aria-label={isAr ? "الأقسام" : "Sections"} className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold whitespace-nowrap transition-colors ${
              tab === t.key ? "border-ink-slab bg-ink-slab text-white" : "border-line bg-surface text-ink-body hover:border-line-strong hover:text-ink"
            }`}
          >
            {isAr ? t.ar : t.en}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select aria-label={isAr ? "الشخص" : "Person"} value={person} onChange={(e) => setUserId(e.target.value)} className={SELECT}>
          <option value="">{isAr ? "كل الناس" : "Everyone"}</option>
          {people.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
        {!patientMode && (
          <div className="relative sm:w-56">
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={patient}
              onChange={(e) => setPatient(e.target.value)}
              aria-label={isAr ? "اسم المريض" : "Patient name"}
              placeholder={isAr ? "اسم المريض" : "Patient name"}
              className="h-10 w-full rounded-xl border border-line bg-surface pe-3 ps-9 text-[13px] font-semibold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-ink"
            />
          </div>
        )}
        {showBranches && (
          <select aria-label={isAr ? "الفرع" : "Branch"} value={branch} onChange={(e) => setBranchId(e.target.value)} className={SELECT}>
            <option value="">{isAr ? "كل الفروع" : "All branches"}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly((v) => !v)}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3.5 text-[13px] font-bold transition-colors ${
            flaggedOnly ? "border-accent bg-accent text-ink-on-accent" : "border-line bg-surface text-ink-body hover:text-ink"
          }`}
        >
          <FlagMark isAr={isAr} />
          {isAr ? "اللي تستاهل نظرة بس" : "Worth a look only"}
        </button>
        {anyFilter && (
          <button type="button" onClick={clearFilters} className="px-1 text-[12px] font-bold text-ink-muted underline underline-offset-4 hover:text-ink sm:ms-1">
            {isAr ? "مسح الفلاتر" : "Clear filters"}
          </button>
        )}
      </div>

      {capped && (
        <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] font-semibold text-ink-body">
          {isAr ? "عرض أول 5,000 حركة في الفترة دي — ضيّق التاريخ" : "Showing the first 5,000 actions in this period — narrow the dates"}
        </p>
      )}

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface px-5 py-6">
          <p className="text-[14px] font-bold text-ink">{isAr ? "مقدرناش نحمّل السجل." : "Could not load the log."}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-line px-3.5 text-[13px] font-bold text-ink-body hover:text-ink"
          >
            <RefreshCw size={13} aria-hidden="true" />
            {isAr ? "حاول تاني" : "Try again"}
          </button>
        </div>
      ) : firstLoad ? (
        <div aria-busy="true" className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <span className="sr-only">{isAr ? "جاري التحميل..." : "Loading..."}</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} aria-hidden="true" className="h-5 animate-pulse rounded-lg bg-surface-muted" style={{ width: `${88 - i * 14}%` }} />
          ))}
        </div>
      ) : (
        <div aria-busy={loading} className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {summaryTab && (
            <ActivitySummary people={summary} tab={summaryTab} isAr={isAr} activeUserId={person} onPick={setUserId} />
          )}

          {folded.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface px-5 py-10 text-center">
              {logs.length === 0 ? (
                <p className="text-[14px] font-bold text-ink-body">
                  {patientMode
                    ? isAr ? "مفيش نشاط مسجّل للمريض ده." : "No activity recorded for this patient."
                    : isAr ? "مفيش نشاط في الفترة دي." : "No activity in these dates."}
                </p>
              ) : (
                <>
                  <p className="text-[14px] font-bold text-ink-body">{isAr ? "مفيش حاجة بالفلاتر دي." : "Nothing matches these filters."}</p>
                  {anyFilter && (
                    <button type="button" onClick={clearFilters} className="mt-2 text-[13px] font-bold text-ink-muted underline underline-offset-4 hover:text-ink">
                      {isAr ? "مسح الفلاتر" : "Clear filters"}
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            days.map(({ day, entries }) => (
              <section key={day || "none"} aria-label={dayHeading(day)}>
                <h3 className={`${EYEBROW} mb-2 flex items-baseline justify-between gap-3 px-1 text-ink-muted`}>
                  <span>{dayHeading(day)}</span>
                  <span className="font-figure tracking-normal">{num(dayTotals.get(day) ?? entries.length)}</span>
                </h3>
                <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                  {entries.map((entry) => (
                    <ActivityEntry key={entry.log.id} entry={entry} isAr={isAr} isRTL={isRTL} tz={tz} linkPatient={!patientMode} />
                  ))}
                </ul>
              </section>
            ))
          )}

          {folded.length > visible.length && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShown({ key: filterKey, n: limitN + PAGE })}
                className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-ink-body transition-colors hover:text-ink"
              >
                {isAr ? `عرض المزيد (${num(folded.length - visible.length)} باقيين)` : `Show more (${num(folded.length - visible.length)} left)`}
              </button>
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
