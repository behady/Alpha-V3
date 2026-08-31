"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { ClipboardList, Search, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

type ActivityLog = {
  id: string;
  userId?: string | null;
  userName?: string;
  userRole?: string | null;
  user?: string;
  action?: string;
  details?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  module?: string;
  /** "ai" when the assistant performed the action on the user's behalf; absent for manual work. */
  actor?: string;
  date?: string;
  timestamp?: { toDate?: () => Date };
};

export default function ActivityLogs() {
  const { language, isRTL } = useLanguage();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryText, setQueryText] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  useEffect(() => {
    const q = query(getClinicCollection("system_logs"), orderBy("timestamp", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const filteredLogs = useMemo(() => {
    const term = queryText.trim().toLowerCase();
    return logs.filter((log) => {
      if (severityFilter !== "all" && (log.severity || "LOW") !== severityFilter) return false;
      if (moduleFilter !== "all" && (log.module || "system") !== moduleFilter) return false;
      if (actorFilter === "ai" && log.actor !== "ai") return false;
      if (actorFilter === "staff" && log.actor === "ai") return false;
      if (!term) return true;
      return [log.userName, log.user, log.userRole, log.action, log.details, log.severity, log.module]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [logs, queryText, severityFilter, moduleFilter, actorFilter]);

  const modules = useMemo(
    () => Array.from(new Set(logs.map((log) => log.module || "system"))).sort(),
    [logs]
  );

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / ITEMS_PER_PAGE));
  
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLogs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredLogs, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [queryText, severityFilter, moduleFilter, actorFilter]);

  return (
    <div className="space-y-6 animate-in fade-in" dir={isRTL ? "rtl" : "ltr"}>
      <div className="bg-surface p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
              <ClipboardList size={28} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-ink">
                {language === "ar" ? "سجل نشاط المستخدمين" : "User Activity Logs"}
              </h3>
              <p className="text-sm font-semibold text-ink-muted mt-1">
                {language === "ar"
                  ? "سجل كامل لكل مستخدم والإجراء المنفذ مع التاريخ والوقت."
                  : "Track each user action with date and time."}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <div className="relative md:col-span-1">
            <Search
              size={16}
              className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`}
            />
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder={language === "ar" ? "بحث باسم المستخدم أو الإجراء..." : "Search by user or action..."}
              className={`w-full py-3 bg-surface-subtle rounded-xl border border-slate-200/60 font-semibold text-ink outline-none focus:bg-surface focus:border-primary-500 transition-all ${isRTL ? "pr-10 pl-4" : "pl-10 pr-4"}`}
            />
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="py-3 px-4 bg-surface-subtle rounded-xl border border-slate-200/60 font-semibold text-ink outline-none focus:bg-surface focus:border-primary-500 transition-all"
          >
            <option value="all">{language === "ar" ? "كل الوحدات" : "All Modules"}</option>
            {modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="py-3 px-4 bg-surface-subtle rounded-xl border border-slate-200/60 font-semibold text-ink outline-none focus:bg-surface focus:border-primary-500 transition-all"
          >
            <option value="all">{language === "ar" ? "الكل" : "Everyone"}</option>
            <option value="staff">{language === "ar" ? "إجراءات يدوية" : "Done manually"}</option>
            <option value="ai">{language === "ar" ? "إجراءات المساعد الذكي" : "Done by Alpha AI"}</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="py-3 px-4 bg-surface-subtle rounded-xl border border-slate-200/60 font-semibold text-ink outline-none focus:bg-surface focus:border-primary-500 transition-all"
          >
            <option value="all">{language === "ar" ? "كل الدرجات" : "All Severities"}</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200/60">
          <table className="w-full text-left">
            <thead className="bg-surface-subtle border-b border-slate-200/60">
              <tr>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">User</th>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">Role</th>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">Module</th>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">Severity</th>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">Action</th>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">Details</th>
                <th className="px-4 py-3 text-[11px] font-bold text-ink-muted uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm font-semibold text-ink-muted">
                    {language === "ar" ? "جاري تحميل السجلات..." : "Loading logs..."}
                  </td>
                </tr>
              )}

              {!loading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm font-semibold text-ink-muted">
                    {language === "ar" ? "لا توجد سجلات حتى الآن." : "No logs found."}
                  </td>
                </tr>
              )}

              {!loading &&
                paginatedLogs.map((log) => {
                  const when = log.timestamp?.toDate ? log.timestamp.toDate() : null;
                  return (
                    <tr key={log.id} className="bg-surface hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-sm font-bold text-ink">
                        <span className="flex items-center gap-2">
                          {log.userName || log.user || "Unknown"}
                          {log.actor === "ai" && (
                            // The person stays accountable, but it should be obvious at a glance
                            // that the change came through the assistant rather than by hand.
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200 text-[9px] font-black uppercase tracking-widest">
                              <Sparkles size={9} /> AI
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-ink-body">{log.userRole || "-"}</td>
                      <td className="px-4 py-3 text-[11px] font-black text-ink-body uppercase">{log.module || "system"}</td>
                      <td className="px-4 py-3 text-[11px] font-black uppercase">
                        <span
                          className={`px-2 py-1 rounded-lg border ${
                            (log.severity || "LOW") === "HIGH" || (log.severity || "LOW") === "CRITICAL"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : (log.severity || "LOW") === "MEDIUM"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-surface-subtle text-ink-body border-line"
                          }`}
                        >
                          {log.severity || "LOW"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-primary-700">{log.action || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-700">{log.details || "-"}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-ink-body">
                        {when
                          ? when.toLocaleString(language === "ar" ? "ar-EG" : "en-US")
                          : log.date || "-"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 bg-surface-subtle border border-slate-200/60 p-3 rounded-2xl">
            <span className="text-sm font-semibold text-ink-muted px-2">
              {language === "ar"
                ? `صفحة ${currentPage} من ${totalPages}`
                : `Page ${currentPage} of ${totalPages}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-2 bg-surface shadow-sm rounded-lg text-ink-body border border-line hover:bg-surface-subtle disabled:opacity-50"
              >
                <ChevronLeft size={16} className={isRTL ? "rotate-180" : ""} />
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-2 bg-surface shadow-sm rounded-lg text-ink-body border border-line hover:bg-surface-subtle disabled:opacity-50"
              >
                <ChevronRight size={16} className={isRTL ? "rotate-180" : ""} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
