"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, CalendarDays, Lock } from "lucide-react";
import { getDocs, query, where, Timestamp } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import PermissionGuard from "@/components/PermissionGuard";
import PageHeader, { headerButtonPrimary } from "@/components/dashboard/PageHeader";
import {
  getFirstDay, getToday, presetOf, rangeFor, rangeText,
  type DateRange, type RangePreset,
} from "@/lib/reportHelpers";
import { useClinic } from "@/context/ClinicContext";
import { usePricingPolicy } from "@/lib/usePricingPolicy";
import { getClinicCollection } from "@/lib/db-utils";
import FeatureGate, { FeatureLocked } from "@/components/FeatureGate";
import { isUnlocked } from "@/lib/featureCatalog";
import { REPORTS, REPORT_GROUPS, reportById, type ReportGroupId } from "@/components/reports/registry";
import { useReportData, type Row } from "@/components/reports/useReportData";
import { ReportState } from "@/components/reports/reportKit";

function normalizeDate(val: unknown): string {
  if (!val) return "1970-01-01";
  if (val instanceof Timestamp) return val.toDate().toISOString().split("T")[0];
  if (typeof val === "object" && val !== null && "toDate" in val) {
    return (val as { toDate: () => Date }).toDate().toISOString().split("T")[0];
  }
  const raw = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return "1970-01-01";
}

interface Snapshot {
  procedures: Row[];
  payments: Row[];
  allPatients: Row[];
  leads: Row[];
}

/** The report named in the URL, so a tab can be linked to and comes back after a reload. */
function reportFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("report");
}

function ReportsPage() {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [reportId, setReportId] = useState<string>(() => reportFromUrl() || "clinic");
  const report = reportById(reportId);
  const [group, setGroup] = useState<ReportGroupId>(report.group);
  const { payers } = usePricingPolicy();
  const { clinicId, clinic } = useClinic();
  /**
   * ONE piece of state, not two.
   *
   * Both dates used to be separate, and the fetch keyed on the pair — so a preset that set them in
   * sequence fired two full reads, and stepping a month field with the arrow keys fired one per
   * step. Moving them together makes a preset a single change.
   */
  const [range, setRange] = useState<DateRange>({ start: getFirstDay(), end: getToday() });
  const { start: startDate, end: endDate } = range;
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const preset = presetOf(range);
  const rangeLabel = rangeText(range, isAr);
  const today = getToday();

  // The report's extra data, fetched when it is opened and remembered for this range.
  const extras = useReportData(report.needs, range, clinicId);

  const pick = (id: string) => {
    setReportId(id);
    setGroup(reportById(id).group);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("report", id);
      window.history.replaceState(null, "", url.toString());
    }
  };

  const buildSnapshot = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      // Bounded by the selected range rather than pulled whole. This screen used to download
      // every ledger row and every lead the clinic had ever recorded and then throw away all but
      // the chosen month — fine in year one, progressively slower and more expensive after that.
      //
      // `date` is stored as YYYY-MM-DD, so a string range is a real range (the finance page relies
      // on the same property). Rows carrying no `date` at all now fall outside every range; they
      // were only ever reachable through the `r.date || r.createdAt` fallback below, and a money
      // row with no date cannot be attributed to a period honestly anyway.
      //
      // patients stay whole: new-vs-returning classification needs every patient's creation date,
      // and the collection is small.
      const leadsFrom = Timestamp.fromDate(new Date(`${startDate}T00:00:00`));
      const leadsTo = Timestamp.fromDate(new Date(`${endDate}T23:59:59.999`));

      const [ledgerSnap, patientsSnap, leadsSnap] = await Promise.all([
        getDocs(
          query(
            getClinicCollection("ledger"),
            where("date", ">=", startDate),
            where("date", "<=", endDate)
          )
        ),
        getDocs(getClinicCollection("patients")),
        getDocs(
          query(
            getClinicCollection("leads"),
            where("createdAt", ">=", leadsFrom),
            where("createdAt", "<=", leadsTo)
          )
        ),
      ]);

      const allPatients = patientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Row[];

      const allLedger = ledgerSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Row))
        .filter((r) => !["deleted", "cancelled"].includes(String(r.status || "").toLowerCase()));

      const inRange = (d: string) => d >= startDate && d <= endDate;

      const procedures = allLedger
        .filter((r) => r.type === "procedure")
        .map((r) => ({ ...r, normDate: normalizeDate(r.date || r.createdAt) }))
        .filter((r) => inRange(r.normDate as string));

      const payments = allLedger
        .filter((r) => r.type === "payment" || r.type === "expense" || r.type === "income")
        .map((r) => ({ ...r, normDate: normalizeDate(r.date || r.createdAt) }))
        .filter((r) => inRange(r.normDate as string));

      const leads = leadsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Row))
        .map((l) => ({ ...l, normDate: normalizeDate(l.createdAt) }))
        .filter((l) => inRange(l.normDate as string));

      setSnapshot({ procedures, payments, allPatients, leads });
    } catch (e) {
      /**
       * There was no catch at all, so a failure left `snapshot` null and the page showed "Click
       * Refresh to load data" — the same sentence it shows before the first load and on an empty
       * clinic. Three different situations, one message, and the only one of them that was a
       * problem told the owner to press a button that would fail again in silence.
       */
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // `clinicId` is a dependency even though it is not read here: `getClinicCollection` resolves
    // the tenant globally and THROWS before it has landed, so a cold load raced the pointer and
    // left the page empty with no way back. Now the arrival of a clinic refetches — which is also
    // what makes a superadmin switching clinics load the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, clinicId]);

  useEffect(() => {
    buildSnapshot();
  }, [buildSnapshot]);

  const refresh = () => {
    extras.invalidate();
    buildSnapshot();
    // Re-run the extras fetch for the open report by nudging the range object identity.
    setRange((r) => ({ ...r }));
  };

  const presets: { id: Exclude<RangePreset, "custom">; en: string; ar: string }[] = [
    { id: "today", en: "Today", ar: "النهارده" },
    { id: "week", en: "This week", ar: "الأسبوع ده" },
    { id: "month", en: "This month", ar: "الشهر ده" },
    { id: "lastMonth", en: "Last month", ar: "الشهر اللي فات" },
    { id: "quarter", en: "This quarter", ar: "الربع ده" },
    { id: "year", en: "This year", ar: "السنة دي" },
  ];

  const inGroup = useMemo(() => REPORTS.filter((r) => r.group === group), [group]);
  const locked = report.feature ? !isUnlocked(clinic, report.feature) : false;
  const ledger = useMemo(() => (snapshot ? [...snapshot.procedures, ...snapshot.payments] : []), [snapshot]);

  return (
    <PermissionGuard permission="access.reports">
      <div
        className="min-h-full pb-24 lg:pb-10"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 xl:px-10 pt-5 xl:pt-7 space-y-6">

          {/* Title in the black band; the date range and Refresh ride along with it, because a
              report you cannot re-scope is a screenshot. */}
          <PageHeader
            title={isAr ? "مركز التقارير" : "Reports Center"}
            subtitle={isAr ? "تحليلات احترافية قابلة للطباعة" : "Professional analytics with PDF export"}
          >
            <CalendarDays size={15} className="hidden text-white/40 sm:block" />
            {/* One control for the question everybody actually asks, in front of the two pickers
                for the one they occasionally do. Setting both ends at once is also a single
                refetch rather than two. */}
            <select
              value={preset}
              onChange={(e) => {
                const next = e.target.value as RangePreset;
                if (next !== "custom") setRange(rangeFor(next));
              }}
              className="cursor-pointer rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white outline-none [color-scheme:dark] focus:border-white/40"
            >
              {preset === "custom" && <option value="custom">{isAr ? "مدة مخصصة" : "Custom range"}</option>}
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{isAr ? p.ar : p.en}</option>
              ))}
            </select>
            <input
              type="date"
              value={startDate} data-tour="reports-date-start"
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              className="cursor-pointer rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white outline-none [color-scheme:dark] focus:border-white/40"
            />
            <span className="text-xs font-bold text-white/40">→</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              className="cursor-pointer rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white outline-none [color-scheme:dark] focus:border-white/40"
            />
            <button type="button" onClick={refresh} disabled={loading} className={headerButtonPrimary}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {isAr ? "تحديث" : "Refresh"}
            </button>
          </PageHeader>

          {/*
            Two rails. Twenty-seven reports in one row is a wall; grouped by the question being
            asked they are five words, and then a handful of reports under the chosen one. The
            group rail keeps the tour anchor the old rail had.
          */}
          <div className="space-y-3">
            <div
              data-tour="reports-tabs"
              className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            >
              {REPORT_GROUPS.map((g) => {
                const Icon = g.icon;
                const active = group === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setGroup(g.id);
                      const first = REPORTS.find((r) => r.group === g.id);
                      if (first && report.group !== g.id) pick(first.id);
                    }}
                    aria-current={active ? "page" : undefined}
                    className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold transition-colors ${
                      active
                        ? "bg-ink-slab text-white"
                        : "border border-line bg-surface text-ink-body hover:bg-surface-muted"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-white/70" : "text-ink-muted"} />
                    {isAr ? g.ar : g.en}
                    <span className={`font-figure text-[11px] ${active ? "text-white/50" : "text-ink-faint"}`}>{REPORTS.filter((r) => r.group === g.id).length}</span>
                  </button>
                );
              })}
            </div>
            <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {inGroup.map((r) => {
                const Icon = r.icon;
                const active = report.id === r.id;
                const isLocked = r.feature ? !isUnlocked(clinic, r.feature) : false;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pick(r.id)}
                    aria-current={active ? "page" : undefined}
                    title={isAr ? r.hintAr : r.hintEn}
                    className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-bold transition-colors ${
                      active ? "bg-surface-muted text-ink ring-1 ring-line" : "text-ink-muted hover:bg-surface-subtle hover:text-ink"
                    }`}
                  >
                    {isLocked ? <Lock size={13} className="text-ink-faint" /> : <Icon size={14} className={active ? "text-ink" : "text-ink-faint"} />}
                    {isAr ? r.ar : r.en}
                  </button>
                );
              })}
            </div>
          </div>

          {/* A failure is its own state now, and says what went wrong. */}
          {failed && !loading && (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-danger/30 bg-danger-tint px-6 py-10 text-center">
              <p className="text-sm font-black text-ink">
                {isAr ? "مقدرناش نحمّل التقرير." : "The report could not be loaded."}
              </p>
              <p className="max-w-lg text-[12px] font-semibold text-ink-muted">{failed}</p>
              <button type="button" onClick={buildSnapshot} className="rounded-xl bg-ink-slab px-4 py-2 text-[13px] font-bold text-white">
                {isAr ? "جرّب تاني" : "Try again"}
              </button>
            </div>
          )}

          {/* Report panels */}
          {!failed && snapshot && (
            /*
              The panel stays MOUNTED while a new range loads, and dims. It used to be replaced by
              a spinner card, so every tweak of a date collapsed the page to a small box and then
              threw it back open — a jump on the most common interaction this screen has.
            */
            <div className={`bg-surface rounded-3xl border border-line shadow-sm p-6 transition-opacity ${loading || extras.loading ? "pointer-events-none opacity-50" : "opacity-100"}`}>
              {/* Which report, and over what — said once, in words, rather than twice in ISO. */}
              <div className="flex items-start justify-between gap-3 mb-6">
                <div>
                  <h2 className="text-base font-black text-ink">{isAr ? report.ar : report.en}</h2>
                  <p className="text-[12px] font-semibold text-ink-muted">{isAr ? report.hintAr : report.hintEn}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-muted px-3 py-1.5 text-xs font-bold text-ink-body">
                  {loading || extras.loading ? <Loader2 size={12} className="animate-spin" /> : <CalendarDays size={12} />}
                  {report.allTime ? (isAr ? "كل الفترة" : "All time") : rangeLabel}
                </span>
              </div>

              {locked && report.feature ? (
                <FeatureLocked feature={report.feature} />
              ) : extras.error ? (
                <ReportState kind="error" isAr={isAr} text={extras.error} />
              ) : extras.loading && report.needs.some((k) => !extras.data[k]) ? (
                <ReportState kind="loading" isAr={isAr} />
              ) : (
                <div key={report.id}>
                  {report.render({
                    procedures: snapshot.procedures,
                    payments: snapshot.payments,
                    ledger,
                    allPatients: snapshot.allPatients,
                    leads: snapshot.leads,
                    range,
                    rangeLabel,
                    today,
                    isAr,
                    clinic,
                    data: extras.data,
                    payers,
                    setRange,
                  })}
                </div>
              )}
            </div>
          )}

          {/* First paint, before anything has arrived. Not a message — there is nothing to say
              yet, and "Click Refresh to load data" was untrue anyway: it loads by itself. */}
          {!failed && !snapshot && (
            <div className="flex items-center justify-center gap-2.5 rounded-3xl border border-line bg-surface px-6 py-16 text-ink-muted">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm font-bold">{isAr ? "بنجهّز التقرير…" : "Building the report…"}</span>
            </div>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}

/** Sold as an add-on: the page renders only once the clinic's subscription says so. */
export default function ReportsPageGated() {
  return (
    <FeatureGate feature="reports">
      <ReportsPage />
    </FeatureGate>
  );
}
