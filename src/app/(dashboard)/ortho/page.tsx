"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, Search, ChevronRight, Loader2, Stethoscope, MessageCircle,
  Clock, CheckCircle2, Users, CalendarPlus, X,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import PermissionGuard from "@/components/PermissionGuard";
import { collection, onSnapshot } from "firebase/firestore";

interface OrthoCase {
  id: string;
  patientId: string;
  patientName?: string;
  patientPhone?: string;
  startDate?: string;
  status?: string;
  completedDate?: string;
}

type Filter = "Active" | "Completed" | "All";

export default function OrthoDashboard() {
  const router = useRouter();
  const [cases, setCases] = useState<OrthoCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("Active");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "ortho_cases"), snap => {
      setCases(snap.docs.map(d => ({ id: d.id, ...d.data() } as OrthoCase)));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    const active = cases.filter(c => (c.status || "Active") === "Active").length;
    const completed = cases.filter(c => c.status === "Completed").length;
    const now = new Date();
    const thisMonth = cases.filter(c => {
      if (!c.startDate) return false;
      const d = new Date(c.startDate);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    return { active, completed, thisMonth, total: cases.length };
  }, [cases]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cases
      .filter(c => {
        const st = c.status || "Active";
        if (filter === "All") return true;
        return st === filter;
      })
      .filter(c => {
        if (!term) return true;
        return (
          (c.patientName || "").toLowerCase().includes(term) ||
          (c.patientPhone || "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime());
  }, [cases, filter, search]);

  const getInitials = (name?: string) => {
    if (!name) return "?";
    const p = name.trim().split(/\s+/);
    return (p.length >= 2 ? p[0][0] + p[1][0] : name.substring(0, 2)).toUpperCase();
  };

  const durationLabel = (startDate?: string) => {
    if (!startDate) return "—";
    const start = new Date(startDate).getTime();
    if (isNaN(start)) return "—";
    const days = Math.max(0, Math.floor((Date.now() - start) / 86400000));
    if (days < 31) return `${days}d`;
    const months = Math.floor(days / 30.4);
    if (months < 12) return `${months} mo`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem ? `${years}y ${rem}m` : `${years}y`;
  };

  const openWhatsApp = (e: React.MouseEvent, phone?: string) => {
    e.stopPropagation();
    if (!phone) return;
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) cleaned = "2" + cleaned;
    else if (!cleaned.startsWith("20") && cleaned.length >= 10) cleaned = "20" + cleaned;
    window.open(`https://wa.me/${cleaned}`, "_blank");
  };

  return (
    <PermissionGuard permission="access.ortho" allowedRoles={["Dentist"]}>
      <div className="min-h-screen bg-[#f7f7fb] pb-24 lg:pb-10">
      <div className="max-w-7xl mx-auto p-4 md:p-8 animate-in fade-in">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-fuchsia-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
              <Activity className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Orthodontics</h1>
              <p className="text-sm font-bold text-slate-500">Track and manage every orthodontic case.</p>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard icon={<Activity size={18} />} label="Active cases" value={stats.active} accent="#7c3aed" />
          <StatCard icon={<CheckCircle2 size={18} />} label="Completed" value={stats.completed} accent="#0284c7" />
          <StatCard icon={<CalendarPlus size={18} />} label="Started this month" value={stats.thisMonth} accent="#0d9488" />
          <StatCard icon={<Users size={18} />} label="Total cases" value={stats.total} accent="#475569" />
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2.5 flex-1 shadow-sm">
            <Search size={16} className="text-slate-400 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by patient name or phone…"
              className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-700 placeholder:text-slate-400"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
            )}
          </div>
          <div className="flex bg-white border border-slate-200 rounded-2xl p-1 shadow-sm">
            {(["Active", "Completed", "All"] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all ${
                  filter === f ? "bg-purple-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-purple-600" size={40} /></div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm text-center py-20 px-6">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Stethoscope size={28} className="text-slate-300" />
            </div>
            <p className="font-black text-slate-900 text-lg">
              {search ? "No matching cases" : filter === "Active" ? "No active cases" : "Nothing here yet"}
            </p>
            <p className="text-slate-500 font-medium mt-1">
              {search ? "Try a different name or phone number." : "Open a patient profile and tap “Ortho” to activate a case."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filtered.map(c => {
              const st = c.status || "Active";
              const isDone = st === "Completed";
              return (
                <div
                  key={c.id}
                  onClick={() => router.push(`/ortho/${c.patientId}`)}
                  className="group bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-purple-200 transition-all cursor-pointer p-4 flex items-center gap-4"
                >
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-white shrink-0 shadow-sm ${isDone ? "bg-gradient-to-br from-sky-500 to-blue-600" : "bg-gradient-to-br from-purple-600 to-fuchsia-600"}`}>
                    {getInitials(c.patientName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-slate-900 truncate group-hover:text-purple-700 transition-colors">{c.patientName || "Unnamed"}</h3>
                      <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 ${isDone ? "bg-sky-50 text-sky-600" : st === "Retention" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
                        {st}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] font-bold text-slate-400">
                      <span className="flex items-center gap-1"><Clock size={11} /> {durationLabel(c.startDate)}</span>
                      {c.patientPhone && (
                        <button onClick={e => openWhatsApp(e, c.patientPhone)} className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 transition-colors">
                          <MessageCircle size={11} /> {c.patientPhone}
                        </button>
                      )}
                    </div>
                  </div>

                  <ChevronRight className="text-slate-300 group-hover:text-purple-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </PermissionGuard>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3.5 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}14`, color: accent }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-tight truncate">{label}</div>
        <div className="text-xl font-black text-slate-900 tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}
