"use client";

import { useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Eraser,
  FileText,
  ImagePlus,
  Loader2,
  Save,
  Search,
  X,
} from "lucide-react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  DIAGNOSIS_CATEGORIES,
  DIAGNOSIS_OPTIONS,
  findCategory,
  findOption,
  getStatusesFromTooth,
  type ToothData,
} from "@/lib/diagnosisCatalog";
import ToothSVG, { isUpperFDI, toothTypeFromFDI, toothTypeFromPrimaryFDI } from "@/components/teeth/ToothSVG";

const Q1 = [18, 17, 16, 15, 14, 13, 12, 11];
const Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
const Q4 = [48, 47, 46, 45, 44, 43, 42, 41];
const Q3 = [31, 32, 33, 34, 35, 36, 37, 38];

const ChildQ1 = [55, 54, 53, 52, 51];
const ChildQ2 = [61, 62, 63, 64, 65];
const ChildQ4 = [85, 84, 83, 82, 81];
const ChildQ3 = [71, 72, 73, 74, 75];

const ADULT_POSITIONS: Record<number, { left: string; top: string; rotate: string }> = {
  18: { left: "15%", top: "43%", rotate: "-80deg" },
  17: { left: "17%", top: "34%", rotate: "-65deg" },
  16: { left: "21%", top: "25%", rotate: "-50deg" },
  15: { left: "27%", top: "17%", rotate: "-35deg" },
  14: { left: "34%", top: "11%", rotate: "-20deg" },
  13: { left: "41%", top: "6%", rotate: "-10deg" },
  12: { left: "46%", top: "3%", rotate: "-5deg" },
  11: { left: "49%", top: "2%", rotate: "0deg" },
  21: { left: "51%", top: "2%", rotate: "0deg" },
  22: { left: "54%", top: "3%", rotate: "5deg" },
  23: { left: "59%", top: "6%", rotate: "10deg" },
  24: { left: "66%", top: "11%", rotate: "20deg" },
  25: { left: "73%", top: "17%", rotate: "35deg" },
  26: { left: "79%", top: "25%", rotate: "50deg" },
  27: { left: "83%", top: "34%", rotate: "65deg" },
  28: { left: "85%", top: "43%", rotate: "80deg" },
  38: { left: "85%", top: "57%", rotate: "100deg" },
  37: { left: "83%", top: "66%", rotate: "115deg" },
  36: { left: "79%", top: "75%", rotate: "130deg" },
  35: { left: "73%", top: "83%", rotate: "145deg" },
  34: { left: "66%", top: "89%", rotate: "160deg" },
  33: { left: "59%", top: "94%", rotate: "170deg" },
  32: { left: "54%", top: "97%", rotate: "175deg" },
  31: { left: "51%", top: "98%", rotate: "180deg" },
  41: { left: "49%", top: "98%", rotate: "180deg" },
  42: { left: "46%", top: "97%", rotate: "185deg" },
  43: { left: "41%", top: "94%", rotate: "190deg" },
  44: { left: "34%", top: "89%", rotate: "200deg" },
  45: { left: "27%", top: "83%", rotate: "215deg" },
  46: { left: "21%", top: "75%", rotate: "230deg" },
  47: { left: "17%", top: "66%", rotate: "245deg" },
  48: { left: "15%", top: "57%", rotate: "260deg" },
};

const PRIMARY_POSITIONS: Record<number, { left: string; top: string; rotate: string }> = {
  55: { left: "25%", top: "38%", rotate: "-60deg" },
  54: { left: "31%", top: "26%", rotate: "-40deg" },
  53: { left: "38%", top: "15%", rotate: "-20deg" },
  52: { left: "44%", top: "8%", rotate: "-10deg" },
  51: { left: "49%", top: "5%", rotate: "0deg" },
  61: { left: "51%", top: "5%", rotate: "0deg" },
  62: { left: "56%", top: "8%", rotate: "10deg" },
  63: { left: "62%", top: "15%", rotate: "20deg" },
  64: { left: "69%", top: "26%", rotate: "40deg" },
  65: { left: "75%", top: "38%", rotate: "60deg" },
  75: { left: "75%", top: "62%", rotate: "120deg" },
  74: { left: "69%", top: "74%", rotate: "140deg" },
  73: { left: "62%", top: "85%", rotate: "160deg" },
  72: { left: "56%", top: "92%", rotate: "170deg" },
  71: { left: "51%", top: "95%", rotate: "180deg" },
  81: { left: "49%", top: "95%", rotate: "180deg" },
  82: { left: "44%", top: "92%", rotate: "190deg" },
  83: { left: "38%", top: "85%", rotate: "200deg" },
  84: { left: "31%", top: "74%", rotate: "220deg" },
  85: { left: "25%", top: "62%", rotate: "240deg" },
};

interface TeethChartProps {
  data: Record<string, ToothData>;
  onUpdateTooth?: (id: number, statuses: string[], notes: string, imageUrl?: string) => void;
  onToothClick?: (id: number) => void;
  isPrimary?: boolean;
  readOnly?: boolean;
}

export type { ToothData };

export default function TeethChart({
  data = {},
  onUpdateTooth,
  onToothClick,
  isPrimary = false,
  readOnly = false,
}: TeethChartProps) {
  const { language, isRTL } = useLanguage();
  const [activeTooth, setActiveTooth] = useState<number | null>(null);
  const [hoverTooth, setHoverTooth] = useState<number | null>(null);

  // Modal/draft state
  const [draftStatuses, setDraftStatuses] = useState<string[]>([]);
  const [draftNotes, setDraftNotes] = useState<string>("");
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("caries");
  const [search, setSearch] = useState<string>("");

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const Q1_Active = isPrimary ? ChildQ1 : Q1;
  const Q2_Active = isPrimary ? ChildQ2 : Q2;
  const Q3_Active = isPrimary ? ChildQ3 : Q3;
  const Q4_Active = isPrimary ? ChildQ4 : Q4;

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) {
      return DIAGNOSIS_OPTIONS.filter(
        opt =>
          opt.id !== "healthy" &&
          (opt.labelEn.toLowerCase().includes(term) || opt.labelAr.toLowerCase().includes(term))
      );
    }
    return DIAGNOSIS_OPTIONS.filter(opt => opt.cat === activeCategory && opt.id !== "healthy");
  }, [activeCategory, search]);

  const openToothModal = (id: number) => {
    if (readOnly) return;
    onToothClick?.(id);

    const raw = data[String(id)];
    const statuses = getStatusesFromTooth(raw);
    setDraftStatuses(statuses);
    setDraftNotes((raw && typeof raw.notes === "string") ? raw.notes : "");
    setDraftImage((raw && typeof raw.imageUrl === "string") ? raw.imageUrl : null);
    setUploadProgress(0);
    setIsUploading(false);
    setSearch("");
    // Default expanded category: first selected non-healthy, else caries
    const firstCat = statuses
      .map(s => findOption(s)?.cat)
      .find(c => c && c !== "healthy");
    setActiveCategory(firstCat || "caries");

    setActiveTooth(id);
  };

  const toggleDraftStatus = (id: string) => {
    setDraftStatuses(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]));
  };

  const handleSaveDiagnosis = () => {
    if (activeTooth && typeof onUpdateTooth === "function") {
      onUpdateTooth(activeTooth, draftStatuses, draftNotes.trim(), draftImage || undefined);
    }
    setActiveTooth(null);
  };

  const handleClearTooth = () => {
    if (activeTooth && typeof onUpdateTooth === "function") {
      onUpdateTooth(activeTooth, [], "", undefined);
    }
    setActiveTooth(null);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTooth) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const compressedBlob = await new Promise<Blob>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
          const img = new globalThis.Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
              if (blob) resolve(blob);
              else reject(new Error("compression failed"));
            }, "image/jpeg", 0.78);
          };
        };
        reader.onerror = reject;
      });

      const filename = `clinical_notes/tooth_${activeTooth}_${Date.now()}.jpg`;
      const storageRef = ref(storage, filename);
      const uploadTask = uploadBytesResumable(storageRef, compressedBlob);

      uploadTask.on(
        "state_changed",
        snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        err => {
          console.error("Upload failed", err);
          setIsUploading(false);
        },
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setDraftImage(url);
          setIsUploading(false);
        }
      );
    } catch (err) {
      console.error("Compression/upload error", err);
      setIsUploading(false);
    }
  };

  const renderTooth = (id: number) => {
    const raw = data[String(id)];
    const statuses = getStatusesFromTooth(raw);
    const isActive = activeTooth === id;
    const isHover = hoverTooth === id;
    const hasNotes = !!(raw && (raw.notes || raw.imageUrl));
    const isUpper = isUpperFDI(id);
    const type = isPrimary ? toothTypeFromPrimaryFDI(id) : toothTypeFromFDI(id);

    // Hover tooltip text — full english labels of all statuses (or AR)
    const tooltipLines = statuses
      .map(s => findOption(s))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .map(o => (language === "ar" ? o.labelAr : o.labelEn));

    const pos = isPrimary ? PRIMARY_POSITIONS[id] : ADULT_POSITIONS[id];

    return (
      <div
        key={id}
        className="absolute flex flex-col items-center justify-center gap-1 cursor-pointer"
        style={{
          left: pos?.left,
          top: pos?.top,
          transform: `translate(${isUpper ? "-100%" : "0%"}, -50%) rotate(${pos?.rotate || "0deg"})`,
          marginLeft: isUpper ? "-2%" : "2%", 
        }}
        onClick={() => openToothModal(id)}
        onMouseEnter={() => setHoverTooth(id)}
        onMouseLeave={() => setHoverTooth(prev => (prev === id ? null : prev))}
      >
        <div
          className={`transition-all duration-150 ${isActive ? "scale-125 z-10 shadow-xl rounded-full" : isHover ? "scale-110 z-10" : ""}`}
          style={{ height: isPrimary ? 34 : 42, width: isPrimary ? 30 : 38 }}
        >
          <ToothSVG
            fdi={id}
            type={type}
            isUpper={isUpper}
            statuses={statuses}
            isActive={isActive}
            isHover={isHover}
            hasNotes={hasNotes}
            size={isPrimary ? 38 : 34}
            ariaLabel={`Tooth ${id}${tooltipLines.length ? ` — ${tooltipLines.join(", ")}` : ""}`}
          />
        </div>

        {/* Tooltip */}
        {isHover && tooltipLines.length > 0 && (
          <div
            className={`absolute z-30 ${isUpper ? "top-full mt-1.5" : "bottom-full mb-1.5"} left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold whitespace-nowrap shadow-lg pointer-events-none animate-in fade-in duration-100`}
          >
            <div className="text-[10px] opacity-70 mb-0.5">FDI {id}</div>
            {tooltipLines.slice(0, 3).map((l, i) => (
              <div key={i} className="leading-snug">{l}</div>
            ))}
            {tooltipLines.length > 3 && (
              <div className="text-[10px] opacity-70">+{tooltipLines.length - 3} more</div>
            )}
          </div>
        )}

        {/* Number outside arch */}
        <div
          className={`absolute text-[9px] md:text-[10px] font-bold tabular-nums tracking-tight ${
            isActive ? "text-blue-600" : "text-slate-400"
          }`}
          style={{
            top: isUpper ? "-45%" : "135%",
            transform: `rotate(calc(-1 * ${pos?.rotate || "0deg"}))`,
          }}
        >
          {id}
        </div>
      </div>
    );
  };

  const activeRaw = activeTooth != null ? data[String(activeTooth)] : undefined;
  const existingStatuses = activeRaw ? getStatusesFromTooth(activeRaw) : [];

  return (
    <div className="w-full" dir={isRTL ? "rtl" : "ltr"}>
      <div className="w-full overflow-x-auto no-scrollbar" dir="ltr">
        <div className="min-w-[620px] md:min-w-0 max-w-5xl mx-auto">
          {/* Arch label header */}
          <div className="flex items-center justify-between px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>{language === "ar" ? "يمين" : "Right"}</span>
            <span className="text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
              {isPrimary
                ? language === "ar" ? "أسنان لبنية" : "Primary"
                : language === "ar" ? "بالغ" : "Adult"}
            </span>
            <span>{language === "ar" ? "يسار" : "Left"}</span>
          </div>

          {/* Chart canvas (Arch Layout) */}
          <div className="relative rounded-3xl border border-slate-100 bg-white shadow-sm px-2 md:px-6 py-5 md:py-7 flex justify-center items-center">
            <div className="relative w-full max-w-[400px] aspect-[3/4]">
               {/* Center divider line */}
               <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-l border-dashed border-slate-200/60 z-0"></div>
               {/* Horizontal mid line */}
               <div className="absolute top-1/2 left-10 right-10 -translate-y-1/2 border-t border-dashed border-slate-200/60 z-0"></div>
               
               {[...Q1_Active, ...Q2_Active, ...Q4_Active, ...Q3_Active].map(renderTooth)}
            </div>
          </div>

          {/* Color legend */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[10px] font-semibold text-slate-500">
            {DIAGNOSIS_CATEGORIES.filter(c => c.id !== "healthy").map(cat => (
              <div key={cat.id} className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cat.color, opacity: 0.7 }} />
                <span>{language === "ar" ? cat.labelAr : cat.labelEn}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Diagnosis modal */}
      {activeTooth !== null && (
        <div className={`fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 pb-20 sm:pb-4 ${isRTL ? "text-right" : "text-left"}`}>
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setActiveTooth(null)}
          />

          <div className="relative w-full max-w-4xl bg-white rounded-t-[2rem] sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 flex flex-col max-h-[calc(100dvh-4.5rem)] sm:max-h-[80vh] overflow-hidden">
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

            {/* Header */}
            <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg sm:text-xl shadow-sm">
                  {activeTooth}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-base sm:text-lg leading-tight">
                    {language === "ar" ? "التشخيص السريري" : "Clinical Diagnosis"}
                  </h3>
                  <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                    {isPrimary ? (language === "ar" ? "سنة لبنية" : "Primary tooth") : (language === "ar" ? "سنة دائمة" : "Adult tooth")}
                    {" · "}FDI {activeTooth}
                    {draftStatuses.length > 0 && (
                      <span className="ms-1.5 inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold">
                        {draftStatuses.length} {language === "ar" ? "تشخيص" : draftStatuses.length === 1 ? "diagnosis" : "diagnoses"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveTooth(null)}
                className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-50 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-full flex items-center justify-center transition-colors"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            {/* Selected chips */}
            {draftStatuses.length > 0 && (
              <div className="px-4 sm:px-6 py-2.5 border-b border-slate-100 bg-slate-50/60 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {draftStatuses.map(sid => {
                    const opt = findOption(sid);
                    const cat = findCategory(opt?.cat);
                    if (!opt) return null;
                    return (
                      <button
                        key={sid}
                        type="button"
                        onClick={() => toggleDraftStatus(sid)}
                        className="group inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full border text-[11px] font-semibold transition-colors"
                        style={{
                          backgroundColor: `${cat?.color}10`,
                          borderColor: `${cat?.color}55`,
                          color: cat?.color,
                        }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat?.color }} />
                        {language === "ar" ? opt.labelAr : opt.labelEn}
                        <span className="w-4 h-4 rounded-full bg-white/70 group-hover:bg-white flex items-center justify-center">
                          <X size={10} strokeWidth={3} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden bg-slate-50/40">
              {/* Categories sidebar */}
              <div className="w-full sm:w-1/3 border-b sm:border-b-0 sm:border-r border-slate-200 bg-white flex flex-col shrink-0">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/40 flex items-center gap-2">
                  <Search size={14} className="text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={language === "ar" ? "ابحث عن تشخيص…" : "Search diagnoses…"}
                    className="flex-1 bg-transparent text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-700">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="flex sm:flex-col overflow-x-auto sm:overflow-y-auto no-scrollbar p-2 gap-1.5">
                  {DIAGNOSIS_CATEGORIES.filter(c => c.id !== "healthy").map(cat => {
                    const isActive = activeCategory === cat.id && !search;
                    const Icon = cat.icon;
                    const countInCat = draftStatuses
                      .map(s => findOption(s)?.cat)
                      .filter(c => c === cat.id).length;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => { setActiveCategory(cat.id); setSearch(""); }}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl whitespace-nowrap sm:whitespace-normal shrink-0 sm:w-full text-left transition-colors border ${
                          isActive
                            ? "bg-slate-50 border-slate-200"
                            : "bg-white border-transparent hover:bg-slate-50"
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${cat.color}15`, color: cat.color }}
                        >
                          <Icon size={15} strokeWidth={2.2} />
                        </div>
                        <span className={`text-xs sm:text-sm flex-1 ${isActive ? "font-bold text-slate-900" : "font-semibold text-slate-600"}`}>
                          {language === "ar" ? cat.labelAr : cat.labelEn}
                        </span>
                        {countInCat > 0 && (
                          <span
                            className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
                            style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                          >
                            {countInCat}
                          </span>
                        )}
                        {isActive && <ChevronRight size={14} className={`text-slate-400 hidden sm:block ${isRTL ? "rotate-180" : ""}`} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Options + notes */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                        {search
                          ? language === "ar" ? "نتائج البحث" : "Search results"
                          : language === "ar" ? "اختر التشخيصات (متعدد)" : "Select diagnoses (multi-select)"}
                      </label>
                      <span className="text-[10px] font-bold text-slate-400">
                        {filteredOptions.length} {language === "ar" ? "خيار" : "options"}
                      </span>
                    </div>

                    {/* Healthy / clear */}
                    <button
                      type="button"
                      onClick={() => setDraftStatuses([])}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-150 mb-3 ${
                        draftStatuses.length === 0
                          ? "border-emerald-400 bg-emerald-50/70 text-emerald-700 shadow-sm"
                          : "border-slate-200 bg-white hover:border-emerald-300 text-slate-600"
                      }`}
                    >
                      <CheckCircle2 size={18} className={draftStatuses.length === 0 ? "text-emerald-500" : "text-slate-400"} />
                      <span className="font-bold text-sm">
                        {language === "ar" ? "سن سليم / مسح التشخيصات" : "Healthy / Clear all diagnoses"}
                      </span>
                    </button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {filteredOptions.map(opt => {
                        const isSelected = draftStatuses.includes(opt.id);
                        const cat = findCategory(opt.cat);
                        return (
                          <button
                            key={opt.id}
                            onClick={() => toggleDraftStatus(opt.id)}
                            className="flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-150 text-left bg-white hover:shadow-sm"
                            style={{
                              borderColor: isSelected ? cat?.color : "#e2e8f0",
                              backgroundColor: isSelected ? `${cat?.color}10` : "#ffffff",
                            }}
                          >
                            <div
                              className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors"
                              style={{
                                borderColor: isSelected ? cat?.color : "#cbd5e1",
                                backgroundColor: isSelected ? cat?.color : "#ffffff",
                              }}
                            >
                              {isSelected && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
                                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={`text-sm leading-snug ${isSelected ? "font-bold text-slate-900" : "font-semibold text-slate-600"}`}>
                                {language === "ar" ? opt.labelAr : opt.labelEn}
                              </div>
                              {search && cat && (
                                <div className="text-[10px] font-semibold mt-0.5" style={{ color: cat.color }}>
                                  {language === "ar" ? cat.labelAr : cat.labelEn}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                      {filteredOptions.length === 0 && (
                        <div className="md:col-span-2 text-center text-xs font-semibold text-slate-400 py-6 border-2 border-dashed border-slate-200 rounded-xl">
                          {language === "ar" ? "لا توجد نتائج" : "No results"}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Notes & image */}
                  <div className="pt-4 border-t border-slate-200/60">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <FileText size={14} /> {language === "ar" ? "ملاحظات ومرفقات" : "Notes & attachments"}
                      </label>
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          ref={fileInputRef}
                          onChange={handleImageUpload}
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                          className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50"
                        >
                          {isUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                          {language === "ar" ? "إرفاق صورة" : "Attach photo"}
                        </button>
                      </div>
                    </div>

                    {isUploading && (
                      <div className="w-full h-1.5 bg-slate-100 rounded-full mb-3 overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    )}

                    {draftImage && !isUploading && (
                      <div className="mb-3 relative w-24 h-24 rounded-2xl border-2 border-indigo-100 overflow-hidden shadow-sm group">
                        <img src={draftImage} alt="Tooth attachment" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={() => setDraftImage(null)}
                            className="bg-white p-1.5 rounded-full text-rose-500 hover:text-rose-700 hover:scale-110 transition-all"
                            title="Remove image"
                          >
                            <X size={16} strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                    )}

                    <textarea
                      value={draftNotes}
                      onChange={e => setDraftNotes(e.target.value)}
                      placeholder={language === "ar" ? "اكتب أي ملاحظات سريرية حول هذا السن…" : "Type any clinical notes for this tooth…"}
                      rows={3}
                      className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 transition-all resize-none"
                    />
                  </div>

                  {/* Existing summary line */}
                  {existingStatuses.length > 0 && (
                    <div className="pt-3 border-t border-slate-200/60 text-[11px] text-slate-500 font-semibold flex items-center gap-2">
                      <Activity size={12} className="text-slate-400" />
                      {language === "ar" ? "محفوظ مسبقاً:" : "Previously saved:"} {existingStatuses.length} {language === "ar" ? "تشخيصات" : "items"}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer — pinned at modal bottom so Save stays visible on mobile */}
            <div className="p-3 sm:p-4 pb-safe bg-white border-t border-slate-200 flex items-center gap-2 shrink-0 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
              <button
                onClick={handleClearTooth}
                className="px-3.5 py-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0 font-semibold text-sm gap-2"
              >
                <Eraser size={16} /> <span className="hidden sm:inline">{language === "ar" ? "مسح" : "Clear"}</span>
              </button>
              <button
                onClick={handleSaveDiagnosis}
                disabled={isUploading}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 transition-transform active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
              >
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {language === "ar" ? "حفظ التحديثات" : "Save updates"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
