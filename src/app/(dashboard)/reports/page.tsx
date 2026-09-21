"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, RefreshCw, Stethoscope, UserCheck, Network, Building2, CalendarDays, Megaphone,
  Wallet,
  TableProperties,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import PermissionGuard from "@/components/PermissionGuard";
import PageHeader, { headerButtonPrimary } from "@/components/dashboard/PageHeader";
import {
  getFirstDay, getToday, presetOf, rangeFor, rangeText,
  type DateRange, type RangePreset,
} from "@/lib/reportHelpers";
import { useClinic } from "@/context/ClinicContext";

import ServiceReport from "@/components/reports/ServiceReport";
import DentistReport from "@/components/reports/DentistReport";
import SourceReport from "@/components/reports/SourceReport";
import ClinicReport from "@/components/reports/ClinicReport";
import LeadFunnelReport from "@/components/reports/LeadFunnelReport";
import PayerReport from "@/components/reports/PayerReport";
import CaseSheetReport from "@/components/reports/CaseSheetReport";
import { usePricingPolicy } from "@/lib/usePricingPolicy";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import FeatureGate from "@/components/FeatureGate";

type ReportTab = "service" | "dentist" | "source" | "payers" | "cases" | "leads" | "clinic";

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
  procedures: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  allPatients: { id: string; name?: string; phone?: string; referral?: string; source?: string; createdAt?: unknown }[];
  leads: Record<string, unknown>[];
}

function ReportsPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isAr = language === "ar";

  const [tab, setTab] = useState<ReportTab>("service");
  const { payers } = usePricingPolicy();
  const { clinicId } = useClinic();
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
      // patients and staff stay whole: new-vs-returning classification needs every patient's
      // creation date, name lookups need every staff member, and both collections are small.
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

      // The whole `staff` collection used to be read here on every range change, filtered into a
      // set of dentist names, and then thrown away with a `void` — dentists are named off the
      // ledger rows instead. It was a full collection read per keystroke, for nothing.
      const allPatients = patientsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as { id: string; name?: string; phone?: string; referral?: string; source?: string; createdAt?: unknown }[];

      const allLedger = ledgerSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
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
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
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

  /**
   * The seven tabs, with no colour of their own.
   *
   * Each used to carry a pastel chip — blue, emerald, cyan, rose, slate, amber, violet — which is
   * the templated-dashboard rainbow the app's own rule forbids: chrome stays achromatic so that
   * colour only ever names a destination. Seven colours name nothing.
   */
  const tabs: { id: ReportTab; label: string; labelAr: string; icon: React.ElementType }[] = [
    { id: "service", label: "Service Analysis", labelAr: "تحليل الخدمات", icon: Stethoscope },
    { id: "dentist", label: "Dentist Performance", labelAr: "أداء الأطباء", icon: UserCheck },
    { id: "source", label: "Patient Sources", labelAr: "مصادر المرضى", icon: Network },
    // Separate from Patient Sources on purpose: that one is marketing — where a patient heard about
    // the clinic. This one is who is paying for the work, which is a different question with a
    // different answer for the same patient.
    { id: "payers", label: "Insurance & Payers", labelAr: "التأمين وجهات الدفع", icon: Wallet },
    // The one report that groups nothing: a line per case, filterable down to the rows being
    // argued about. It is what the others get checked against.
    { id: "cases", label: "Case Sheet", labelAr: "سجل الحالات", icon: TableProperties },
    { id: "leads", label: "Marketing Funnel", labelAr: "قمع التسويق", icon: Megaphone },
    { id: "clinic", label: "Clinic Overview", labelAr: "نظرة عامة", icon: Building2 },
  ];

  const presets: { id: Exclude<RangePreset, "custom">; en: string; ar: string }[] = [
    { id: "today", en: "Today", ar: "النهارده" },
    { id: "week", en: "This week", ar: "الأسبوع ده" },
    { id: "month", en: "This month", ar: "الشهر ده" },
    { id: "lastMonth", en: "Last month", ar: "الشهر اللي فات" },
    { id: "quarter", en: "This quarter", ar: "الربع ده" },
    { id: "year", en: "This year", ar: "السنة دي" },
  ];

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
            <button type="button" onClick={buildSnapshot} disabled={loading} className={headerButtonPrimary}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {isAr ? "تحديث" : "Refresh"}
            </button>
          </PageHeader>

          {/*
            Seven tiles in a five-column grid left a two-thirds-empty second row on a desktop and
            a screen and a half of navigation to scroll past on a phone — before a single number.
            A pill rail instead: one row, one label each, scrolling sideways when it has to.

            The second label went with them. It was the raw English tab id — "Payers", "Cases" —
            printed above the translated one, so an Arabic reader got an English word they never
            asked for over the Arabic they did.
          */}
          <div
            data-tour="reports-tabs"
            className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold transition-colors ${
                    active
                      ? "bg-ink-slab text-white"
                      : "border border-line bg-surface text-ink-body hover:bg-surface-muted"
                  }`}
                >
                  <Icon size={15} className={active ? "text-white/70" : "text-ink-muted"} />
                  {isAr ? t.labelAr : t.label}
                </button>
              );
            })}
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
            <div className={`bg-surface rounded-3xl border border-line shadow-sm p-6 transition-opacity ${loading ? "pointer-events-none opacity-50" : "opacity-100"}`}>
              {/* Which report, and over what — said once, in words, rather than twice in ISO. */}
              <div className="flex items-center justify-between gap-3 mb-6">
                <h2 className="text-base font-black text-ink">
                  {isAr
                    ? tabs.find((t) => t.id === tab)?.labelAr
                    : tabs.find((t) => t.id === tab)?.label}
                </h2>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-muted px-3 py-1.5 text-xs font-bold text-ink-body">
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <CalendarDays size={12} />}
                  {rangeLabel}
                </span>
              </div>

              {tab === "service" && (
                <ServiceReport
                  procedures={snapshot.procedures}
                  payments={snapshot.payments}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
              )}

              {tab === "dentist" && (
                <DentistReport
                  procedures={snapshot.procedures}
                  payments={snapshot.payments}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
              )}

              {tab === "source" && (
                <SourceReport
                  procedures={snapshot.procedures}
                  payments={snapshot.payments}
                  allPatients={snapshot.allPatients}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
              )}

              {tab === "payers" && (
                <PayerReport
                  procedures={snapshot.procedures}
                  payments={snapshot.payments}
                  payers={payers}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
              )}

              {tab === "cases" && (
                <CaseSheetReport
                  procedures={snapshot.procedures}
                  payments={snapshot.payments}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
              )}

              {tab === "leads" && (
                <LeadFunnelReport
                  leads={snapshot.leads}
                  payments={snapshot.payments}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
              )}

              {tab === "clinic" && (
                <ClinicReport
                  procedures={snapshot.procedures}
                  payments={snapshot.payments}
                  allPatients={snapshot.allPatients}
                  startDate={startDate}
                  endDate={endDate}
                  rangeLabel={rangeLabel}
                  isAr={isAr}
                />
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
