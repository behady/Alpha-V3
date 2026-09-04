"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, Activity, User, MapPin, MessageCircle,
  Stethoscope, CalendarDays, Clock, CheckCircle2, RotateCcw, Plus, Sparkles, MoreVertical,
  Save, Printer, Trash2
} from "lucide-react";
import { db } from "@/lib/firebase";
import {
  doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, limit,
} from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import PermissionGuard from "@/components/PermissionGuard";

interface OrthoVisit {
  visitNo: number;
  date: string;
  workDone: string;
  nextStep: string;
}

/**
 * Cephalometric notation, deliberately untranslated. SNA, SNB, ANB and IMPA are international
 * abbreviations, and Egyptian dentists write overjet and overbite in English too — translating
 * half of a measurement table would read worse than leaving all of it in the notation they use.
 */
const CEPH_FIELDS = [
  { id: "sna", label: "SNA (°)" },
  { id: "snb", label: "SNB (°)" },
  { id: "anb", label: "ANB (°)" },
  { id: "overjet", label: "Overjet (mm)" },
  { id: "overbite", label: "Overbite (mm)" },
  { id: "crowding", label: "Crowding" },
  { id: "spacing", label: "Spacing" },
  { id: "impa", label: "IMPA (°)" }
];

interface OrthoCase {
  patientId: string;
  patientName?: string;
  patientPhone?: string;
  startDate?: string;
  status?: "Active" | "Completed" | "Retention";
  completedDate?: string;
  visits?: OrthoVisit[];
  diagnosis?: string;
  cephData?: Record<string, string>;
}

export default function IsolatedOrthoWorkspace() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const { showToast, confirm } = useUI();
  const { user } = useAuth();
  const { isAdmin } = useClinic();
  const id = (params?.id as string) || "";

  const [patientData, setPatientData] = useState<any>(null);
  const [orthoCase, setOrthoCase] = useState<OrthoCase | null>(null);
  const [localVisits, setLocalVisits] = useState<OrthoVisit[]>([]);
  const [localDiagnosis, setLocalDiagnosis] = useState("");
  const [localCephData, setLocalCephData] = useState<Record<string, string>>({});
  const [hasSessions, setHasSessions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isManager = isAdmin || user?.role === "Dentist" || user?.role === "Admin";

  const isDirty = JSON.stringify(localVisits) !== JSON.stringify(orthoCase?.visits || []) || 
                  localDiagnosis !== (orthoCase?.diagnosis || "") || 
                  JSON.stringify(localCephData) !== JSON.stringify(orthoCase?.cephData || {});

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Realtime patient
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(getClinicDoc("patients", id), snap => {
      if (snap.exists()) setPatientData({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [id]);

  // Realtime ortho case + check legacy sessions
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const unsub = onSnapshot(getClinicDoc("ortho_cases", id), async snap => {
      if (cancelled) return;
      if (snap.exists()) {
        const data = snap.data() as OrthoCase;
        setOrthoCase(data);
        setLocalVisits(data.visits || []);
        setLocalDiagnosis(data.diagnosis || "");
        setLocalCephData(data.cephData || {});
        setLoading(false);
      } else {
        try {
          const q = query(getClinicCollection("ortho_sessions"), where("patientId", "==", id), limit(1));
          const sessSnap = await getDocs(q);
          if (!cancelled) setHasSessions(!sessSnap.empty);
        } catch {
          /* ignore */
        }
        setOrthoCase(null);
        setLoading(false);
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [id]);

  const calculateAge = (dob: string | number) => {
    if (!dob) return "N/A";
    if (typeof dob === "number" || /^\d{1,3}$/.test(String(dob))) return Number(dob);
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return "N/A";
    return Math.abs(new Date(Date.now() - birthDate.getTime()).getUTCFullYear() - 1970);
  };

  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const openWhatsApp = (phone: string) => {
    if (!phone) return;
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) cleaned = "2" + cleaned;
    else if (!cleaned.startsWith("20") && cleaned.length >= 10) cleaned = "20" + cleaned;
    window.open(`https://wa.me/${cleaned}`, "_blank");
  };

  const ensureCase = async () => {
    if (!patientData) return;
    setIsStarting(true);
    try {
      await setDoc(getClinicDoc("ortho_cases", id), {
        patientId: id,
        patientName: patientData.name || "",
        patientPhone: patientData.phone || "",
        startDate: new Date().toISOString(),
        status: "Active",
        visits: [],
        diagnosis: "",
        cephData: {}
      }, { merge: true });
      await updateDoc(getClinicDoc("patients", id), { isOrthoPatient: true }).catch(() => {});
      showToast(t("orthoActivated"), "success");
    } catch {
      showToast(t("orthoActivateFailed"), "error");
    } finally {
      setIsStarting(false);
    }
  };

  const setCaseStatus = async (status: OrthoCase["status"]) => {
    setMenuOpen(false);
    if (status === "Completed") {
      if (!(await confirm("Mark this orthodontic treatment as complete? It will move out of the active cases list."))) return;
    }
    try {
      await updateDoc(getClinicDoc("ortho_cases", id), {
        status,
        ...(status === "Completed" ? { completedDate: new Date().toISOString() } : {}),
      });
      showToast(status === "Completed" ? t("orthoMarkedComplete") : t("orthoReactivated"), "success");
    } catch {
      showToast(t("orthoUpdateFailed"), "error");
    }
  };

  const addVisit = () => {
    const nextNo = localVisits.length > 0 ? Math.max(...localVisits.map(v => v.visitNo)) + 1 : 1;
    const newVisit: OrthoVisit = {
      visitNo: nextNo,
      date: new Date().toISOString().split("T")[0],
      workDone: "",
      nextStep: ""
    };
    setLocalVisits([...localVisits, newVisit]);
  };

  const handleCellChange = (index: number, field: keyof OrthoVisit, value: any) => {
    const updated = [...localVisits];
    updated[index] = { ...updated[index], [field]: value };
    setLocalVisits(updated);
  };

  const deleteVisit = async (index: number) => {
    if (await confirm("Are you sure you want to delete this visit record?")) {
      const updated = localVisits.filter((_, i) => i !== index);
      // Re-number sequentially to keep visit numbers clean and sequential
      const renumbered = updated.map((v, i) => ({ ...v, visitNo: i + 1 }));
      setLocalVisits(renumbered);
    }
  };

  const saveChanges = async () => {
    setIsSaving(true);
    try {
      await updateDoc(getClinicDoc("ortho_cases", id), {
        visits: localVisits,
        diagnosis: localDiagnosis,
        cephData: localCephData
      });
      showToast(t("orthoSaved"), "success");
    } catch (error) {
      showToast(t("orthoSaveFailed"), "error");
    } finally {
      setIsSaving(false);
    }
  };

  const daysIn = (() => {
    if (!orthoCase?.startDate) return null;
    const start = new Date(orthoCase.startDate).getTime();
    if (isNaN(start)) return null;
    return Math.max(0, Math.floor((Date.now() - start) / 86400000));
  })();

  const fmtDuration = (days: number | null) => {
    if (days == null) return "—";
    if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
    const months = Math.floor(days / 30.4);
    if (months < 12) return `${months} mo`;
    const years = Math.floor(months / 12);
    const remMo = months % 12;
    return remMo ? `${years}y ${remMo}m` : `${years} year${years === 1 ? "" : "s"}`;
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-subtle">
        <Loader2 className="animate-spin text-purple-600" size={40} />
      </div>
    );
  }
  if (!patientData) return <div className="p-10 text-center font-black text-ink-muted">{t("orthoPatientNotFound")}</div>;

  const status = orthoCase?.status || "Active";
  /** The stored value is the contract; this is only how it reads on screen. */
  const statusLabel = (value: string) =>
    ({ Active: t("orthoActive"), Completed: t("orthoCompleted"), Retention: t("orthoRetention") })[value] ?? value;
  const statusStyles: Record<string, string> = {
    Active: "bg-emerald-400/20 text-emerald-200 border-emerald-400/30",
    Completed: "bg-sky-400/20 text-sky-200 border-sky-400/30",
    Retention: "bg-amber-400/20 text-amber-100 border-amber-400/30",
  };

  return (
    <PermissionGuard permission="access.ortho" allowedRoles={["Dentist"]}>
      <div className="min-h-screen bg-surface-subtle pb-20 animate-in fade-in">
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
          body * { visibility: hidden; }
          .print-container, .print-container * { visibility: visible; }
          .print-container { position: absolute; left: 0; top: 0; width: 100%; display: block !important; }
          .no-print { display: none !important; }
        }
      `}} />

      {/* HEADER */}
      <header className="bg-gradient-to-r from-purple-950 via-purple-900 to-fuchsia-950 px-4 md:px-6 py-4 md:py-5 sticky top-0 z-45 shadow-[0_10px_40px_-10px_rgba(88,28,135,0.5)] no-print">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3 md:gap-5 w-full md:w-auto min-w-0">
            <button
              onClick={() => router.push(`/patients/${id}`)}
              className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all text-purple-200 shrink-0 group"
              title={t("orthoBackToProfile")}
            >
              <ArrowLeft size={20} className="group-hover:-translate-x-0.5 transition-transform" />
            </button>

            <div className="w-12 h-12 md:w-14 md:h-14 bg-white/10 text-white border border-white/20 rounded-2xl flex items-center justify-center font-black text-lg md:text-xl shrink-0 shadow-inner backdrop-blur-md">
              {getInitials(patientData.name)}
            </div>

            <div className="min-w-0 text-white">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest flex items-center gap-1">
                  <Stethoscope size={11} /> Ortho Portal
                </span>
                {orthoCase && (
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${statusStyles[status]}`}>
                    {status}
                  </span>
                )}
              </div>
              <h1 className="text-xl md:text-2xl font-black truncate tracking-tight mt-1">{patientData.name}</h1>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-1.5 text-[10px] font-bold text-purple-200/80 uppercase tracking-widest">
                <button
                  onClick={() => openWhatsApp(patientData.phone)}
                  className="flex items-center gap-1.5 text-emerald-300 hover:text-emerald-200 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 px-2 py-0.5 rounded-md transition-colors"
                  title={t("orthoOpenWhatsapp")}
                >
                  <MessageCircle size={11} /> {patientData.phone || t("orthoNoPhone")}
                </button>
                <span className="flex items-center gap-1.5"><User size={11} className="opacity-70" /> {calculateAge(patientData.dateOfBirth || patientData.age)} Y / {patientData.gender || "—"}</span>
                <span className="hidden sm:flex items-center gap-1.5 truncate max-w-[220px]"><MapPin size={11} className="opacity-70" /> {patientData.address || t("orthoNoAddress")}</span>
              </div>
            </div>
          </div>

          {/* Right: duration + actions */}
          {orthoCase && (
            <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0">
              <div className="flex-1 md:flex-none bg-white/10 border border-white/15 rounded-2xl px-4 py-2.5 backdrop-blur-md">
                <div className="text-[9px] font-black text-purple-200/70 uppercase tracking-widest flex items-center gap-1.5"><Clock size={11} /> In treatment</div>
                <div className="text-white font-black text-lg leading-tight">{fmtDuration(daysIn)}</div>
              </div>

              {isManager && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(o => !o)}
                    className="p-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-white transition-all backdrop-blur-md"
                    title={t("orthoCaseActions")}
                  >
                    <MoreVertical size={18} />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-[calc(100%+8px)] w-60 bg-surface border border-line shadow-2xl rounded-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150 p-1.5">
                      <button onClick={() => { setMenuOpen(false); router.push(`/patients/${id}`); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-ink-body hover:bg-surface-subtle transition-colors">
                        <Activity size={16} className="text-blue-500" /> Clinical Profile
                      </button>
                      {status !== "Completed" ? (
                        <button onClick={() => setCaseStatus("Completed")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-emerald-700 hover:bg-emerald-50 transition-colors">
                          <CheckCircle2 size={16} /> Mark Treatment Complete
                        </button>
                      ) : (
                        <button onClick={() => setCaseStatus("Active")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-purple-700 hover:bg-purple-50 transition-colors">
                          <RotateCcw size={16} /> Reactivate Case
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* MAIN SCREEN (No Print) */}
      <main className="max-w-[1600px] mx-auto p-4 md:p-8 no-print">
        {!orthoCase ? (
          /* ---- NO ACTIVE CASE: activation hero ---- */
          <div className="max-w-xl mx-auto mt-10 bg-surface rounded-3xl border border-slate-100 shadow-sm p-8 md:p-10 text-center animate-in fade-in">
            <div className="w-20 h-20 bg-gradient-to-br from-purple-100 to-fuchsia-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Sparkles size={34} className="text-purple-600" />
            </div>
            <h2 className="text-2xl font-black text-ink mb-2">
              {hasSessions ? t("orthoRestoreOrtho") : t("orthoStartOrtho")}
            </h2>
            <p className="text-ink-muted font-medium mb-8">
              {hasSessions
                ? "This patient has past ortho records but no active case file. Restore the case to track it on the orthodontic dashboard."
                : "Create a dedicated orthodontic workspace for this patient. It will appear on the Orthodontics dashboard and keep treatment records separate from general dentistry."}
            </p>
            <button
              onClick={ensureCase}
              disabled={isStarting}
              className="bg-purple-600 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-wide flex items-center justify-center gap-2 mx-auto hover:bg-purple-700 transition-all shadow-lg shadow-purple-300/40 disabled:opacity-60"
            >
              {isStarting ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              {hasSessions ? t("orthoRestoreCase") : t("orthoStartTreatment")}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Case snapshot strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SnapshotCard icon={<Activity size={16} />} label={t("orthoStatus")} value={statusLabel(status)} accent="#7c3aed" />
              <SnapshotCard icon={<CalendarDays size={16} />} label={t("orthoStarted")} value={orthoCase.startDate ? new Date(orthoCase.startDate).toLocaleDateString() : "—"} accent="#2563eb" />
              <SnapshotCard icon={<Clock size={16} />} label={t("orthoDuration")} value={fmtDuration(daysIn)} accent="#0d9488" />
              <button
                onClick={() => openWhatsApp(patientData.phone)}
                className="bg-surface rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3 hover:border-emerald-200 hover:bg-emerald-50/40 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><MessageCircle size={16} /></div>
                <div className="min-w-0">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t("orthoContact")}</div>
                  <div className="text-sm font-black text-slate-800 truncate">WhatsApp</div>
                </div>
              </button>
            </div>

            {/* Simple Table Interface */}
            <div className="bg-surface rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-6">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-ink flex items-center gap-2">
                      <Stethoscope className="text-purple-500" size={22} /> Diagnosis & Records
                    </h2>
                    {isDirty && (
                      <span className="bg-amber-100 text-amber-800 text-[10px] font-black uppercase px-2 py-0.5 rounded-md animate-pulse">
                        Unsaved Changes
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-slate-400 mt-1">{t("orthoTrackHint")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={addVisit}
                    className="flex-1 sm:flex-none bg-purple-600 hover:bg-purple-700 text-white px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-200"
                  >
                    <Plus size={16} /> Add Visit
                  </button>
                  <button
                    onClick={saveChanges}
                    disabled={!isDirty || isSaving}
                    className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-100 disabled:text-slate-400 text-white px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg disabled:shadow-none"
                  >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Changes
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="flex-1 sm:flex-none bg-surface hover:bg-surface-subtle border border-line text-ink-body px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Printer size={16} /> Print File
                  </button>
                </div>
              </div>

              {/* Diagnosis Section */}
              <div className="mb-6 space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t("orthoMasterPlan")}</label>
                  <textarea
                    value={localDiagnosis}
                    onChange={(e) => setLocalDiagnosis(e.target.value)}
                    placeholder={t("orthoMasterPlanPlaceholder")}
                    className="w-full p-4 bg-surface-subtle border border-line hover:border-purple-300 focus:border-purple-500 focus:bg-surface rounded-xl outline-none font-bold text-sm text-slate-700 transition-all resize-y min-h-[100px]"
                  />
                </div>
                
                <div className="bg-surface-subtle rounded-xl border border-line p-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">{t("orthoCephData")}</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {CEPH_FIELDS.map(field => (
                      <div key={field.id}>
                        <label className="text-[9px] font-bold text-ink-muted block mb-1">{field.label}</label>
                        <input
                          type="text"
                          value={localCephData[field.id] || ""}
                          onChange={e => setLocalCephData({ ...localCephData, [field.id]: e.target.value })}
                          className="w-full p-2 bg-surface border border-line hover:border-purple-300 focus:border-purple-500 rounded-lg outline-none font-bold text-sm text-slate-700 transition-all"
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {localVisits.length === 0 ? (
                <div className="text-center py-16 border-2 border-dashed border-slate-100 rounded-3xl">
                  <CalendarDays className="mx-auto text-slate-300 mb-4" size={48} />
                  <p className="font-black text-slate-700 text-lg">{t("orthoNoVisits")}</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">Click t("orthoAddVisit") to log the first adjustment.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full text-left border-collapse">
                    <tbody className="divide-y divide-slate-100">
                      {localVisits.map((visit, idx) => (
                        <tr key={visit.visitNo} className="group hover:bg-slate-50/50 transition-colors">
                          <td className="py-4 px-6 font-black text-slate-800 text-sm">
                            #{visit.visitNo}
                          </td>
                          <td className="py-4 px-6">
                            <input
                              type="date"
                              value={visit.date}
                              onChange={(e) => handleCellChange(idx, "date", e.target.value)}
                              className="w-full p-2 bg-transparent border border-transparent hover:border-line focus:border-purple-500 focus:bg-surface rounded-lg outline-none font-bold text-sm text-slate-700 transition-all"
                            />
                          </td>
                          <td className="py-4 px-6">
                            <textarea
                              value={visit.workDone}
                              onChange={(e) => handleCellChange(idx, "workDone", e.target.value)}
                              placeholder={t("orthoVisitPlaceholder")}
                              rows={1}
                              className="w-full p-2 bg-transparent border border-transparent hover:border-line focus:border-purple-500 focus:bg-surface rounded-lg outline-none font-bold text-sm text-slate-700 transition-all resize-none overflow-hidden min-h-[38px] auto-grow"
                              onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = "auto";
                                target.style.height = `${target.scrollHeight}px`;
                              }}
                            />
                          </td>
                          <td className="py-4 px-6">
                            <textarea
                              value={visit.nextStep}
                              onChange={(e) => handleCellChange(idx, "nextStep", e.target.value)}
                              placeholder={t("orthoNextPlaceholder")}
                              rows={1}
                              className="w-full p-2 bg-transparent border border-transparent hover:border-line focus:border-purple-500 focus:bg-surface rounded-lg outline-none font-bold text-sm text-slate-700 transition-all resize-none overflow-hidden min-h-[38px] auto-grow"
                              onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = "auto";
                                target.style.height = `${target.scrollHeight}px`;
                              }}
                            />
                          </td>
                          <td className="py-4 px-6 text-center">
                            <button
                              onClick={() => deleteVisit(idx)}
                              className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                              title={t("orthoDeleteVisit")}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* PRINT LAYOUT (Only visible when printing) */}
      <div className="hidden print-container p-8 max-w-4xl mx-auto bg-surface text-slate-850 font-sans">
        <div className="grid grid-cols-3 gap-y-4 gap-x-6 p-6 border-2 border-t-0 border-line-strong rounded-b-3xl mb-8 text-sm font-bold bg-slate-50/30">
          <div className="col-span-2 border-b border-line pb-2">
            <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">{t("orthoName")}</span>
            <span className="text-slate-800 text-base">{patientData.name}</span>
          </div>
          <div className="border-b border-line pb-2">
            <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">Age</span>
            <span className="text-slate-800 text-base">{calculateAge(patientData.dateOfBirth || patientData.age)}</span>
          </div>
          <div className="border-b border-line pb-2">
            <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">{t("orthoGender")}</span>
            <span className="text-slate-800 text-base">{patientData.gender || "—"}</span>
          </div>
          <div className="col-span-2 border-b border-line pb-2">
            <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">{t("orthoPhoneLabel")}</span>
            <span className="text-slate-800 text-base">{patientData.phone || "—"}</span>
          </div>
          {localDiagnosis && (
            <div className="col-span-3 border-b border-line pb-2 pt-2">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">{t("orthoDiagnosis")}</span>
              <span className="text-slate-800 text-base whitespace-pre-wrap">{localDiagnosis}</span>
            </div>
          )}
          {Object.keys(localCephData).some(k => localCephData[k]) && (
            <div className="col-span-3 border-b border-line pb-2 pt-2">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-2">{t("orthoCephData")}</span>
              <div className="grid grid-cols-4 gap-4">
                {CEPH_FIELDS.map(field => localCephData[field.id] ? (
                  <div key={field.id}>
                    <span className="text-ink-muted text-[10px] block">{field.label}</span>
                    <span className="text-slate-800 font-bold">{localCephData[field.id]}</span>
                  </div>
                ) : null)}
              </div>
            </div>
          )}
          {patientData.address && (
            <div className="col-span-3 border-b border-line pb-2">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">{t("orthoAddress")}</span>
              <span className="text-slate-800 text-base">{patientData.address}</span>
            </div>
          )}
          {orthoCase?.startDate && (
            <div className="col-span-3 pb-1">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">{t("orthoDateBeginning")}</span>
              <span className="text-slate-800 text-base">{new Date(orthoCase.startDate).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Visits Table */}
        <table className="w-full text-left border-collapse border border-line-strong">
          <tbody>
            {localVisits.map((visit) => (
              <tr key={visit.visitNo} className="text-sm">
                <td className="py-3 px-4 border border-line-strong font-black text-slate-800">
                  #{visit.visitNo}
                </td>
                <td className="py-3 px-4 border border-line-strong font-bold text-slate-700">
                  {new Date(visit.date).toLocaleDateString()}
                </td>
                <td className="py-3 px-4 border border-line-strong text-slate-700 whitespace-pre-wrap font-medium">
                  {visit.workDone || "—"}
                </td>
                <td className="py-3 px-4 border border-line-strong text-slate-700 whitespace-pre-wrap font-medium">
                  {visit.nextStep || "—"}
                </td>
              </tr>
            ))}
            {/* Pad with empty rows to match the paper card look if there are few visits */}
            {localVisits.length < 12 &&
              Array.from({ length: 12 - localVisits.length }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="py-7 px-4 border border-line-strong"></td>
                  <td className="py-7 px-4 border border-line-strong"></td>
                  <td className="py-7 px-4 border border-line-strong"></td>
                  <td className="py-7 px-4 border border-line-strong"></td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      </div>
    </PermissionGuard>
  );
}

function SnapshotCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="bg-surface rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}14`, color: accent }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
        <div className="text-sm font-black text-slate-800 truncate">{value}</div>
      </div>
    </div>
  );
}
