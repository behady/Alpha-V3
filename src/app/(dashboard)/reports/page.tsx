"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileBarChart, Loader2, RefreshCw, Stethoscope, UserCheck, Network, Building2, CalendarDays,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, getDocs, Timestamp } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import PermissionGuard from "@/components/PermissionGuard";
import { getFirstDay, getToday } from "@/lib/reportHelpers";
import { isDentistStaff } from "@/lib/staffRoles";

import ServiceReport from "@/components/reports/ServiceReport";
import DentistReport from "@/components/reports/DentistReport";
import SourceReport from "@/components/reports/SourceReport";
import ClinicReport from "@/components/reports/ClinicReport";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

type ReportTab = "service" | "dentist" | "source" | "clinic";

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
  allPatients: { id: string; name?: string; phone?: string; referral?: string; createdAt?: unknown }[];
}

export default function ReportsPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isAr = language === "ar";

  const [tab, setTab] = useState<ReportTab>("service");
  const [startDate, setStartDate] = useState(getFirstDay());
  const [endDate, setEndDate] = useState(getToday());
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const rangeLabel = `${startDate} → ${endDate}`;

  const buildSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const [ledgerSnap, patientsSnap, staffSnap] = await Promise.all([
        getDocs(getClinicCollection("ledger")),
        getDocs(getClinicCollection("patients")),
        getDocs(getClinicCollection("staff")),
      ]);

      const staff = staffSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      const dentistSet = new Set<string>(
        staff
          .filter((s) => isDentistStaff(s as { role?: string; isDentist?: boolean }))
          .map((s) => String(s.name || ""))
          .filter(Boolean)
      );
      void dentistSet; // available for future use

      const allPatients = patientsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as { id: string; name?: string; phone?: string; referral?: string; createdAt?: unknown }[];

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

      setSnapshot({ procedures, payments, allPatients });
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    buildSnapshot();
  }, [buildSnapshot]);

  const tabs: { id: ReportTab; label: string; labelAr: string; icon: React.ElementType; color: string }[] = [
    { id: "service", label: "Service Analysis", labelAr: "تحليل الخدمات", icon: Stethoscope, color: "text-blue-600 bg-blue-50" },
    { id: "dentist", label: "Dentist Performance", labelAr: "أداء الأطباء", icon: UserCheck, color: "text-emerald-600 bg-emerald-50" },
    { id: "source", label: "Patient Sources", labelAr: "مصادر المرضى", icon: Network, color: "text-cyan-600 bg-cyan-50" },
    { id: "clinic", label: "Clinic Overview", labelAr: "نظرة عامة", icon: Building2, color: "text-violet-600 bg-violet-50" },
  ];

  return (
    <PermissionGuard permission="access.reports">
      <div
        className="min-h-screen bg-transparent pb-24 lg:pb-10"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 xl:px-10 pt-6 xl:pt-10 space-y-6">

          {/* Page header */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col lg:flex-row gap-5 lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-2xl bg-[#E8F7F0] text-[#27ae60] flex items-center justify-center">
                  <FileBarChart size={20} />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                    {isAr ? "مركز التقارير" : "Reports Center"}
                  </h1>
                  <p className="text-xs text-slate-400 font-semibold">
                    {isAr ? "تحليلات احترافية قابلة للطباعة" : "Professional analytics with PDF export"}
                  </p>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-bold">
                <CalendarDays size={14} />
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white outline-none focus:border-[#60d297] cursor-pointer"
              />
              <span className="text-slate-400 font-bold text-xs">→</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white outline-none focus:border-[#60d297] cursor-pointer"
              />
              <button
                type="button"
                onClick={buildSnapshot}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2D3748] text-white hover:text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 disabled:opacity-60 transition-all shadow-sm"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {isAr ? "تحديث" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Tab navigation */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-start ${
                    active
                      ? "bg-[#2D3748] border-[#2D3748] text-white shadow-lg shadow-[#2D3748]/30"
                      : "bg-white border-slate-200 hover:border-slate-300 shadow-sm text-slate-600"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? "bg-white/10" : t.color}`}>
                    <Icon size={18} className={active ? "text-white" : ""} />
                  </div>
                  <div>
                    <p className={`text-xs font-black uppercase tracking-wide ${active ? "text-slate-400" : "text-slate-400"}`}>
                      {t.id.charAt(0).toUpperCase() + t.id.slice(1)}
                    </p>
                    <p className={`text-sm font-black ${active ? "text-white" : "text-slate-800"}`}>
                      {isAr ? t.labelAr : t.label}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Loading */}
          {loading && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center gap-3 text-slate-500">
              <Loader2 size={28} className="animate-spin text-primary-500" />
              <p className="font-bold text-sm">
                {isAr ? "جاري تحميل البيانات…" : "Loading analytics…"}
              </p>
            </div>
          )}

          {/* Report panels */}
          {!loading && snapshot && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
              {/* Range badge */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-base font-black text-slate-900">
                    {isAr
                      ? tabs.find((t) => t.id === tab)?.labelAr
                      : tabs.find((t) => t.id === tab)?.label}
                  </h2>
                  <p className="text-xs text-slate-400 font-semibold mt-0.5">{rangeLabel}</p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-xs font-black text-slate-600">
                  <CalendarDays size={12} />
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

          {!loading && !snapshot && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
              <p className="font-bold">{isAr ? "اضغط تحديث لتحميل البيانات" : "Click Refresh to load data"}</p>
            </div>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
