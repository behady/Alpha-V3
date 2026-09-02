"use client";

import { useEffect, useMemo, useState } from "react";
import { limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { ClipboardList, Search, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicCollection } from "@/lib/db-utils";

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

  /**
   * How many entries are subscribed to.
   *
   * This used to be every entry the clinic had ever written: an orderBy with no limit, on a
   * collection `logActivity` appends to on essentially every action. The page then paged through
   * them in the browser, so the whole audit trail was downloaded to show fifty rows.
   *
   * A growing window rather than a cursor because the list is live and the filters run in the
   * browser: raising it re-delivers a larger window, and new entries still arrive on their own.
   */
  const [windowSize, setWindowSize] = useState(200);
  /** True while the window is smaller than what the server holds, so there is more to show. */
  const [hasOlder, setHasOlder] = useState(false);

  useEffect(() => {
    // One more than the window, purely to learn whether older entries exist.
    const q = query(
      getClinicCollection("system_logs"),
      orderBy("timestamp", "desc"),
      limit(windowSize + 1)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.slice(0, windowSize);
        setLogs(docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog)));
        setHasOlder(snap.docs.length > windowSize);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [windowSize]);

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
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* An audit trail's first duty is to say what it is showing you, so that what it is NOT
          showing you is never mistaken for what did not happen. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-ink-on-accent shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-ink-on-accent/45">
            <ClipboardList size={12} />
            {language === "ar" ? "سجل النشاط" : "Activity log"}
          </p>
          <p className="max-w-xl text-[15px] font-bold leading-relaxed text-ink-on-accent sm:text-base">
            {language === "ar"
              ? "كل إجراء بيتسجل هنا باسم صاحبه وتاريخه — سواء اتعمل بالإيد أو عن طريق المساعد."
              : "Every action lands here with the person who took it and when — whether by hand or through the assistant."}
          </p>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <div className="relative md:col-span-1">
            <Search
              size={16}
              className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder={language === "ar" ? "بحث باسم المستخدم أو الإجراء..." : "Search by user or action..."}
              className="w-full rounded-xl border border-line bg-surface-subtle py-3 pe-4 ps-10 font-semibold text-ink outline-none transition-all focus:border-accent focus:bg-surface"
            />
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="py-3 px-4 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent transition-all"
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
            className="py-3 px-4 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent transition-all"
          >
            <option value="all">{language === "ar" ? "الكل" : "Everyone"}</option>
            <option value="staff">{language === "ar" ? "إجراءات يدوية" : "Done manually"}</option>
            <option value="ai">{language === "ar" ? "إجراءات المساعد الذكي" : "Done by Alpha AI"}</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="py-3 px-4 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent transition-all"
          >
            <option value="all">{language === "ar" ? "كل الدرجات" : "All Severities"}</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left">
            <thead className="bg-surface-subtle border-b border-line">
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
            <tbody className="divide-y divide-line">
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
                    <tr key={log.id} className="bg-surface hover:bg-surface-subtle">
                      <td className="px-4 py-3 text-sm font-bold text-ink">
                        <span className="flex items-center gap-2">
                          {log.userName || log.user || "Unknown"}
                          {log.actor === "ai" && (
                            // The person stays accountable, but it should be obvious at a glance
                            // that the change came through the assistant rather than by hand.
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-info/25 bg-info-tint text-info text-[9px] font-black uppercase tracking-widest">
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
                              ? "border-danger/25 bg-danger-tint text-danger"
                              : (log.severity || "LOW") === "MEDIUM"
                              ? "border-warn/25 bg-warn-tint text-warn"
                              : "bg-surface-subtle text-ink-body border-line"
                          }`}
                        >
                          {log.severity || "LOW"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-ink">{log.action || "-"}</td>
                      <td className="px-4 py-3 text-xs text-ink-body">{log.details || "-"}</td>
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

        {/* What is actually loaded. Filtering a list that is not all there, and saying nothing
            about it, is how someone concludes an entry is missing from the audit trail. */}
        {hasOlder && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-line bg-surface-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] font-semibold text-ink-body">
              {language === "ar"
                ? `يعرض آخر ${logs.length} إجراء. البحث والفلاتر تعمل على المعروض فقط.`
                : `Showing the most recent ${logs.length} actions. Search and filters apply to these.`}
            </p>
            <button
              type="button"
              onClick={() => setWindowSize((n) => n + 200)}
              className="shrink-0 rounded-xl border border-line bg-surface px-4 py-2 text-[13px] font-bold text-ink-body transition-colors hover:text-ink"
            >
              {language === "ar" ? "حمّل أقدم" : "Load older"}
            </button>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 bg-surface-subtle border border-line p-3 rounded-2xl">
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
