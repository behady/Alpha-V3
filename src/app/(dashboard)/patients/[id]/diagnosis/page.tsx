"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  Baby,
  Cloud,
  FileDown,
  Filter,
  Image as ImageIcon,
  Layers,
  Loader2,
  Search,
  Stethoscope,
  User,
  X,
} from "lucide-react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import TeethChart from "@/components/TeethChart";
import {
  DIAGNOSIS_CATEGORIES,
  findCategory,
  findOption,
  getStatusesFromTooth,
  normalizeToothData,
  type ToothData,
} from "@/lib/diagnosisCatalog";
import { generateDiagnosisReport } from "@/lib/diagnosisReportPdf";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export default function DiagnosisPage() {
  const params = useParams();
  const router = useRouter();
  const { language, isRTL, t } = useLanguage();
  const { showToast } = useUI();

  const rawId = (params?.id as string) || "";
  const id = rawId ? decodeURIComponent(rawId) : "";

  const [patient, setPatient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chartMode, setChartMode] = useState<"adult" | "pedo">("adult");
  const [filterCat, setFilterCat] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const teethData: Record<string, ToothData> = useMemo(() => {
    const raw = patient?.teethData || {};
    const cleaned: Record<string, ToothData> = {};
    Object.keys(raw).forEach(k => {
      cleaned[k] = normalizeToothData(raw[k]);
    });
    return cleaned;
  }, [patient?.teethData]);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(getClinicDoc("patients", id), snap => {
      if (snap.exists()) setPatient({ id: snap.id, ...snap.data() });
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  const persist = async (next: Record<string, ToothData>) => {
    if (!id) return;
    setSaving(true);
    try {
      await updateDoc(getClinicDoc("patients", id), { teethData: next });
    } catch (e) {
      console.error(e);
      showToast(language === "ar" ? "تعذّر الحفظ" : "Save failed", "error");
    } finally {
      setTimeout(() => setSaving(false), 400);
    }
  };

  const handleUpdateTooth = (toothId: number, statuses: string[], notes: string, imageUrl?: string) => {
    const next: Record<string, ToothData> = { ...teethData };
    const cleaned = statuses.filter(s => s && s !== "healthy");
    if (cleaned.length === 0 && !notes && !imageUrl) {
      delete next[toothId];
    } else {
      const payload: ToothData = { statuses: cleaned };
      if (notes) payload.notes = notes;
      if (imageUrl) payload.imageUrl = imageUrl;
      next[toothId] = payload;
    }
    persist(next);
  };

  const deleteDiagnosis = (toothId: number) => {
    const next = { ...teethData };
    delete next[String(toothId)];
    persist(next);
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await generateDiagnosisReport({
        patient: { name: patient?.name, phone: patient?.phone, id: patient?.id },
        teethData,
        isPrimary: chartMode === "pedo",
        language,
      });
    } catch (e) {
      console.error("Diagnosis report failed", e);
      showToast(language === "ar" ? "تعذّر إنشاء التقرير" : "Could not generate report", "error");
    } finally {
      setExporting(false);
    }
  };

  // Diagnosis log rows
  const diagnosisRows = useMemo(() => {
    const rows: Array<{ id: string; statuses: string[]; notes?: string; imageUrl?: string }> = [];
    Object.entries(teethData).forEach(([toothId, data]) => {
      const statuses = getStatusesFromTooth(data);
      const meaningful = statuses.filter(s => s !== "healthy");
      if (meaningful.length === 0 && !data.notes && !data.imageUrl) return;
      rows.push({ id: toothId, statuses: meaningful, notes: data.notes, imageUrl: data.imageUrl });
    });

    const term = search.trim().toLowerCase();
    return rows.filter(row => {
      if (filterCat !== "all") {
        const inCat = row.statuses.some(s => findOption(s)?.cat === filterCat);
        if (!inCat) return false;
      }
      if (term) {
        const matchesId = row.id.includes(term);
        const matchesNotes = (row.notes || "").toLowerCase().includes(term);
        const matchesStatus = row.statuses.some(s => {
          const opt = findOption(s);
          if (!opt) return false;
          return opt.labelEn.toLowerCase().includes(term) || opt.labelAr.toLowerCase().includes(term);
        });
        return matchesId || matchesNotes || matchesStatus;
      }
      return true;
    });
  }, [teethData, filterCat, search]);

  // Stats
  const stats = useMemo(() => {
    const byCat: Record<string, number> = {};
    let totalAffected = 0;
    Object.values(teethData).forEach(d => {
      const statuses = getStatusesFromTooth(d).filter(s => s !== "healthy");
      if (statuses.length > 0) totalAffected += 1;
      const cats = new Set(statuses.map(s => findOption(s)?.cat).filter(Boolean));
      cats.forEach(c => { if (c) byCat[c] = (byCat[c] || 0) + 1; });
    });
    return { totalAffected, byCat };
  }, [teethData]);

  if (loading || !patient) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f8fafc]">
        <Loader2 className="animate-spin text-[#27ae60]" size={32} />
      </div>
    );
  }

  return (
    <PermissionGuard permission="access.clinical">
      <div className="min-h-screen bg-[#f8fafc] pb-28 md:pb-12 animate-in fade-in">
        {/* Header */}
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/70 sticky top-0 z-40">
          <div className="max-w-[1600px] mx-auto px-3 md:px-6 py-3 flex items-center gap-3">
            <button
              onClick={() => router.push(`/patients/${encodeURIComponent(id)}`)}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors shrink-0"
            >
              {isRTL ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
            </button>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Stethoscope size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base md:text-lg font-bold text-slate-900 leading-tight">
                {language === "ar" ? "التشخيصات السنية" : "Dental Diagnoses"}
              </h1>
              <p className="text-[11px] md:text-xs text-slate-500 truncate">
                {patient.name} · {language === "ar" ? "السن" : "Patient"} {patient.phone || ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="hidden sm:flex bg-slate-100 p-1 rounded-full">
                <button
                  onClick={() => setChartMode("adult")}
                  className={`px-3 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 transition-all ${
                    chartMode === "adult" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  <User size={12} /> {language === "ar" ? "بالغ" : "Adult"}
                </button>
                <button
                  onClick={() => setChartMode("pedo")}
                  className={`px-3 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 transition-all ${
                    chartMode === "pedo" ? "bg-white text-[#27ae60] shadow-sm" : "text-slate-500"
                  }`}
                >
                  <Baby size={12} /> {language === "ar" ? "أطفال" : "Child"}
                </button>
              </div>

              <div className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 px-2.5 py-1.5 rounded-full border border-slate-200 bg-white">
                {saving ? (
                  <>
                    <Loader2 size={12} className="animate-spin text-blue-500" />
                    <span className="text-[#27ae60]">{t("saving") || "Saving…"}</span>
                  </>
                ) : (
                  <>
                    <Cloud size={12} className="text-emerald-500" />
                    <span className="hidden sm:inline">{t("allSaved") || "All changes saved"}</span>
                  </>
                )}
              </div>

              <button
                onClick={handleExportPdf}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#60d297] text-white shadow-sm shadow-blue-600/20 hover:bg-[#4eb37f] transition-colors disabled:opacity-60"
                title={language === "ar" ? "تنزيل تقرير PDF" : "Download PDF report"}
              >
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                <span className="hidden sm:inline">{language === "ar" ? "تقرير PDF" : "PDF report"}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5">
          {/* Stat strip */}
          <section className="grid grid-cols-2 md:grid-cols-5 gap-2.5 md:gap-3">
            <StatCard
              label={language === "ar" ? "أسنان متأثرة" : "Affected teeth"}
              value={stats.totalAffected}
              accent="#0f172a"
              icon={<Layers size={16} className="text-slate-700" />}
            />
            {DIAGNOSIS_CATEGORIES.filter(c => stats.byCat[c.id]).slice(0, 4).map(cat => {
              const Icon = cat.icon;
              return (
                <StatCard
                  key={cat.id}
                  label={language === "ar" ? cat.labelAr : cat.labelEn}
                  value={stats.byCat[cat.id] || 0}
                  accent={cat.color}
                  icon={<Icon size={16} style={{ color: cat.color }} />}
                />
              );
            })}
          </section>

          {/* Chart + log layout */}
          <section className="grid grid-cols-1 xl:grid-cols-5 gap-4 md:gap-5">
            {/* Chart card */}
            <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] p-3 md:p-5">
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Stethoscope size={14} className="text-blue-500" />
                  {language === "ar" ? "مخطط الأسنان" : "Odontogram"}
                </h2>
                <span className="text-[10px] font-bold text-slate-400 sm:hidden">
                  {language === "ar" ? "لمس السن للتشخيص" : "Tap a tooth"}
                </span>
              </div>
              <TeethChart
                data={teethData}
                onUpdateTooth={handleUpdateTooth}
                isPrimary={chartMode === "pedo"}
              />
            </div>

            {/* Diagnosis log */}
            <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] flex flex-col overflow-hidden min-h-[480px]">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-b from-white to-slate-50/40">
                <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={14} className="text-blue-500" />
                  {language === "ar" ? "سجل التشخيصات" : "Diagnoses log"}
                </h2>
                <span className="text-[10px] font-bold text-slate-400">
                  {diagnosisRows.length} {language === "ar" ? "سن" : diagnosisRows.length === 1 ? "tooth" : "teeth"}
                </span>
              </div>

              {/* Search + filter */}
              <div className="px-4 py-3 border-b border-slate-100 bg-white space-y-2">
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  <Search size={14} className="text-slate-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={language === "ar" ? "ابحث برقم السن أو الحالة…" : "Search by tooth, status, notes…"}
                    className="flex-1 bg-transparent outline-none text-xs font-semibold text-slate-700 placeholder:text-slate-400"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-700">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  <button
                    onClick={() => setFilterCat("all")}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                      filterCat === "all"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <Filter size={10} className="inline mr-1 -mt-0.5" />
                    {language === "ar" ? "الكل" : "All"}
                  </button>
                  {DIAGNOSIS_CATEGORIES.filter(c => c.id !== "healthy" && stats.byCat[c.id]).map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setFilterCat(cat.id)}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                        filterCat === cat.id
                          ? "text-white"
                          : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                      style={
                        filterCat === cat.id
                          ? { backgroundColor: cat.color, borderColor: cat.color }
                          : undefined
                      }
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: filterCat === cat.id ? "#ffffff" : cat.color }}
                      />
                      {language === "ar" ? cat.labelAr : cat.labelEn}
                      <span className="opacity-70">{stats.byCat[cat.id]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {diagnosisRows.length === 0 ? (
                  <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-slate-400">
                    <Activity size={32} className="mb-2 opacity-50" />
                    <p className="text-xs font-bold">{language === "ar" ? "لا توجد تشخيصات" : "No diagnoses yet"}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {language === "ar" ? "اضغط على سن في المخطط للبدء" : "Tap a tooth on the chart to begin"}
                    </p>
                  </div>
                ) : (
                  diagnosisRows.map(row => (
                    <DiagnosisRow
                      key={row.id}
                      row={row}
                      onOpenImage={url => setViewingImage(url)}
                      onDelete={() => deleteDiagnosis(Number(row.id))}
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        </main>

        {/* Lightbox */}
        {viewingImage && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-8">
            <div
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
              onClick={() => setViewingImage(null)}
            />
            <div className="relative w-full max-w-4xl flex flex-col items-center justify-center animate-in zoom-in-95 duration-200">
              <button
                onClick={() => setViewingImage(null)}
                className="absolute -top-12 right-0 text-white/60 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all"
              >
                <X size={22} strokeWidth={2.5} />
              </button>
              <img
                src={viewingImage}
                alt="Clinical attachment"
                className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10 bg-slate-900"
              />
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: number;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-xl border border-slate-100 px-3 py-2.5 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] flex items-center gap-2.5 min-w-0"
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${accent}12` }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-tight truncate">{label}</div>
        <div className="text-lg font-bold text-slate-900 tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

function DiagnosisRow({
  row,
  onOpenImage,
  onDelete,
}: {
  row: { id: string; statuses: string[]; notes?: string; imageUrl?: string };
  onOpenImage: (url: string) => void;
  onDelete: () => void;
}) {
  const { language } = useLanguage();

  return (
    <div className="group relative bg-white rounded-xl border border-slate-100 hover:border-[#A7E2C3] hover:shadow-sm transition-all p-3 flex gap-3">
      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 shrink-0 tabular-nums shadow-inner">
        {row.id}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-1 mb-1.5">
          {row.statuses.map(sid => {
            const opt = findOption(sid);
            const cat = findCategory(opt?.cat);
            if (!opt) return null;
            return (
              <span
                key={sid}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border"
                style={{
                  color: cat?.color,
                  borderColor: `${cat?.color}40`,
                  backgroundColor: `${cat?.color}10`,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat?.color }} />
                {language === "ar" ? opt.labelAr : opt.labelEn}
              </span>
            );
          })}
        </div>
        {row.notes && (
          <p className="text-xs text-slate-600 font-medium leading-snug line-clamp-2">"{row.notes}"</p>
        )}
        {row.imageUrl && (
          <button
            onClick={e => {
              e.stopPropagation();
              onOpenImage(row.imageUrl!);
            }}
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md hover:bg-indigo-100 transition-colors"
          >
            <ImageIcon size={10} /> {language === "ar" ? "عرض الصورة" : "View photo"}
          </button>
        )}
      </div>

      <button
        onClick={onDelete}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-500 rounded-full p-1 shadow-sm"
        title="Remove"
      >
        <X size={12} />
      </button>
    </div>
  );
}
