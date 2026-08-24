"use client";
import { useClinic } from "@/context/ClinicContext";
import { toothImagePath } from "@/lib/storagePaths";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Stethoscope,
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
  normalizeToothData,
} from "@/lib/diagnosisCatalog";
import ToothSVG, { isUpperFDI, toothTypeFromFDI, toothTypeFromPrimaryFDI } from "@/components/teeth/ToothSVG";
import { type ToothSurface } from "./teeth/ToothSurfaces";
import PerioOverlay from "./perio/PerioOverlay";

const Q1 = [18, 17, 16, 15, 14, 13, 12, 11];
const Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
const Q4 = [48, 47, 46, 45, 44, 43, 42, 41];
const Q3 = [31, 32, 33, 34, 35, 36, 37, 38];

const ChildQ1 = [55, 54, 53, 52, 51];
const ChildQ2 = [61, 62, 63, 64, 65];
const ChildQ4 = [85, 84, 83, 82, 81];
const ChildQ3 = [71, 72, 73, 74, 75];



interface TeethChartProps {
  data?: Record<string, ToothData>;
  onUpdateTooth?: (id: number, statuses: string[], notes: string, imageUrl?: string, surfaces?: Record<string, string[]>) => void;
  onToothClick?: (id: number) => void;
  isPrimary?: boolean;
  readOnly?: boolean;
  selectionMode?: boolean;
  selectedTeeth?: number[];
  onToggleTooth?: (id: number) => void;
  compactMode?: boolean;
  /**
   * Let the chart use the whole container instead of the ~768px column it defaults to, and scale
   * the teeth up to match. For the Clinical tab, where the chart is the main input on a full-width
   * card rather than one element among many.
   */
  wide?: boolean;
  onSelectArch?: (arch: "upper" | "lower") => void;
  perioMode?: boolean;
  onPerioToothClick?: (id: number) => void;
}

export type { ToothData };

export default function TeethChart({
  data = {},
  onUpdateTooth,
  onToothClick,
  isPrimary = false,
  readOnly = false,
  selectionMode = false,
  selectedTeeth = [],
  onToggleTooth,
  compactMode = false,
  wide = false,
  onSelectArch,
  perioMode = false,
  onPerioToothClick,
}: TeethChartProps) {
  const { language, isRTL } = useLanguage();
  const { clinicId } = useClinic();
  const [activeTooth, setActiveTooth] = useState<number | null>(null);
  const [hoverTooth, setHoverTooth] = useState<number | null>(null);

  const upperRowRef = useRef<HTMLDivElement>(null);
  const lowerRowRef = useRef<HTMLDivElement>(null);

  /**
   * On phones the chart is wider than the screen and scrolls sideways (squeezing 16 teeth into
   * 360px made each tooth ~19px — unusable). Start the scroll centered so the front teeth, the
   * ones most often discussed, are what the user sees first.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [isPrimary]);

  // Modal/draft state
  const [draftStatuses, setDraftStatuses] = useState<string[]>([]);
  const [draftSurfaces, setDraftSurfaces] = useState<Record<string, string[]>>({});
  const [draftNotes, setDraftNotes] = useState<string>("");
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("caries");
  const [search, setSearch] = useState<string>("");

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);


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
    if (selectionMode) {
      onToggleTooth?.(id);
      return;
    }
    if (readOnly) return;
    if (perioMode && onPerioToothClick) {
      onPerioToothClick(id);
      return;
    }
    onToothClick?.(id);

    const raw = data[String(id)];
    // Need to use normalizeToothData here to safely get surfaces since it might be raw legacy data
    const normalized = normalizeToothData(raw);
    const statuses = normalized.statuses || [];
    
    setDraftStatuses(statuses);
    setDraftSurfaces(normalized.surfaces || {});
    setDraftNotes(normalized.notes || "");
    setDraftImage(normalized.imageUrl || null);
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
    setDraftStatuses(prev => {
      const isSelected = prev.includes(id);
      if (isSelected) {
        // Remove surfaces when deselecting
        setDraftSurfaces(s => {
          const next = { ...s };
          delete next[id];
          return next;
        });
        return prev.filter(s => s !== id);
      }
      return [...prev, id];
    });
  };

  const toggleSurface = (statusId: string, surface: ToothSurface) => {
    setDraftSurfaces(prev => {
      const active = prev[statusId] || [];
      const isSelected = active.includes(surface);
      return {
        ...prev,
        [statusId]: isSelected ? active.filter(s => s !== surface) : [...active, surface]
      };
    });
  };

  const handleSaveDiagnosis = () => {
    if (activeTooth && typeof onUpdateTooth === "function") {
      onUpdateTooth(activeTooth, draftStatuses, draftNotes.trim(), draftImage || undefined, draftSurfaces);
    }
    setActiveTooth(null);
  };

  const handleClearTooth = () => {
    if (activeTooth && typeof onUpdateTooth === "function") {
      onUpdateTooth(activeTooth, [], "", undefined, {});
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

      const storageRef = ref(storage, toothImagePath(clinicId, activeTooth));
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

  const renderTooth = (id: number, viewType: "buccal" | "occlusal" = "buccal") => {
    const raw = data[String(id)];
    const normalized = normalizeToothData(raw);
    const statuses = normalized.statuses || [];
    const hasNotes = !!normalized.notes;
    const isUpper = isUpperFDI(id);
    const type = isPrimary ? toothTypeFromPrimaryFDI(id) : toothTypeFromFDI(id);

    const isActive = activeTooth === id;
    const isHover = hoverTooth === id;

    // Build surface data for the rendering engine
    const activeSurfaces = new Set<ToothSurface>();
    const surfaceColors: Record<string, string> = {};
    if (normalized.surfaces) {
      Object.entries(normalized.surfaces).forEach(([statusId, surfs]) => {
        const cat = findOption(statusId)?.cat;
        const color = findCategory(cat)?.color || "#ef4444";
        surfs.forEach(surf => {
          activeSurfaces.add(surf as ToothSurface);
          // If multiple diagnoses on same surface, last one wins for color
          surfaceColors[surf] = color;
        });
      });
    }

    const tooltipLines = statuses
      .map(s => {
        const o = findOption(s);
        if (!o) return "";
        let line = language === "ar" ? o.labelAr : o.labelEn;
        const surfs = normalized.surfaces?.[s];
        if (surfs && surfs.length > 0) {
           line += ` (${surfs.join("")})`;
        }
        return line;
      })
      .filter(Boolean);

    return (
      <div
        key={`${id}-${viewType}`}
        data-tooth={id}
        className={`group relative flex flex-col items-center justify-center ${compactMode ? "mx-0.5" : "m-0.5 sm:m-1"} cursor-pointer ${
          selectionMode ? "cursor-pointer" : readOnly ? "cursor-default" : "cursor-pointer"
        }`}
        onClick={() => openToothModal(id)}
        onMouseEnter={() => setHoverTooth(id)}
        onMouseLeave={() => setHoverTooth(prev => (prev === id ? null : prev))}
      >
        {/* Perio Numbers (Upper) */}
        {perioMode && isUpper && viewType === "buccal" && (
          <div className="flex flex-col text-[7px] sm:text-[9px] items-center mb-1 font-mono tracking-tighter w-full justify-center">
             <div className="flex justify-between w-full text-blue-500">
               <span>{normalized.perio?.buccal.gm[0] ?? "-"}</span>
               <span>{normalized.perio?.buccal.gm[1] ?? "-"}</span>
               <span>{normalized.perio?.buccal.gm[2] ?? "-"}</span>
             </div>
             <div className="flex justify-between w-full text-red-500">
               <span>{normalized.perio?.buccal.pd[0] ?? "-"}</span>
               <span>{normalized.perio?.buccal.pd[1] ?? "-"}</span>
               <span>{normalized.perio?.buccal.pd[2] ?? "-"}</span>
             </div>
          </div>
        )}

        {/* Tooth number for Buccal upper */}
        {!isUpper && viewType === "buccal" && !perioMode && (
           <div className={`text-[10px] sm:text-xs font-bold tabular-nums tracking-tight transition-colors ${isActive ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"} mt-2`}>
             {id}
           </div>
        )}

        <div
          className={`transition-all duration-200 ${
            isPrimary
              ? `w-[28px] h-[36px] sm:w-[28px] sm:h-[36px] md:w-[36px] md:h-[44px] ${wide ? "lg:w-[44px] lg:h-[54px] xl:w-[52px] xl:h-[64px]" : ""}`
              // Sized so 16 teeth plus their margins still fit the card without a scrollbar at
              // each breakpoint: ~48px×16 inside a ~950px card at lg, ~58px×16 at xl and up.
              : `w-[30px] h-[40px] sm:w-[30px] sm:h-[40px] md:w-[42px] md:h-[52px] ${wide ? "lg:w-[48px] lg:h-[60px] xl:w-[58px] xl:h-[72px]" : ""}`
          } ${
            selectionMode && selectedTeeth.includes(id) 
              ? "scale-110 z-10 shadow-[0_0_15px_rgba(37,99,235,0.5)] bg-blue-500/10 rounded-full" 
              : isActive 
                ? "scale-110 z-10 shadow-lg rounded-full" 
                : isHover 
                  ? "scale-105 z-10" 
                  : "scale-100"
          }`}
        >
          <ToothSVG
            fdi={id}
            type={type}
            isUpper={isUpper}
            statuses={statuses}
            isActive={isActive}
            isHover={isHover}
            hasNotes={hasNotes}
            size={isPrimary ? 44 : 52}
            viewType={viewType}
            ariaLabel={`Tooth ${id} ${viewType}${tooltipLines.length ? ` — ${tooltipLines.join(", ")}` : ""}`}
            activeSurfaces={Array.from(activeSurfaces)}
            surfaceColors={surfaceColors}
            showRoot={perioMode}
          />
        </div>

        {/* Perio Numbers (Lower) */}
        {perioMode && !isUpper && viewType === "buccal" && (
          <div className="flex flex-col text-[7px] sm:text-[9px] items-center mt-1 font-mono tracking-tighter w-full justify-center">
             <div className="flex justify-between w-full text-red-500">
               <span>{normalized.perio?.buccal.pd[0] ?? "-"}</span>
               <span>{normalized.perio?.buccal.pd[1] ?? "-"}</span>
               <span>{normalized.perio?.buccal.pd[2] ?? "-"}</span>
             </div>
             <div className="flex justify-between w-full text-blue-500">
               <span>{normalized.perio?.buccal.gm[0] ?? "-"}</span>
               <span>{normalized.perio?.buccal.gm[1] ?? "-"}</span>
               <span>{normalized.perio?.buccal.gm[2] ?? "-"}</span>
             </div>
          </div>
        )}

        {/* Tooth number for lower (below tooth) */}
        {isUpper && viewType === "buccal" && !perioMode && (
           <div className={`text-[10px] sm:text-xs font-bold tabular-nums tracking-tight transition-colors ${isActive ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"} mb-2`}>
             {id}
           </div>
        )}

        {/* Tooltip */}
        {isHover && tooltipLines.length > 0 && (
          <div
            className={`absolute z-30 ${isUpper ? "top-full mt-2" : "bottom-full mb-2"} left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold whitespace-nowrap shadow-lg pointer-events-none animate-in fade-in duration-100`}
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
      </div>
    );
  };

  const activeRaw = activeTooth != null ? data[String(activeTooth)] : undefined;
  const existingStatuses = activeRaw ? getStatusesFromTooth(activeRaw) : [];

  return (
    <div className="w-full" dir={isRTL ? "rtl" : "ltr"}>
      <div className="relative" dir="ltr">
        {/* Edge fades — a quiet "there's more" hint while the chart can scroll (mobile only) */}
        <div className="md:hidden pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent z-20 rounded-l-3xl" />
        <div className="md:hidden pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent z-20 rounded-r-3xl" />
      <div ref={scrollRef} className="w-full overflow-x-auto no-scrollbar" dir="ltr">
        <div className={`w-full ${wide ? "max-w-none" : "max-w-5xl"} mx-auto ${isPrimary ? "min-w-[440px]" : "min-w-[620px]"} md:min-w-0`}>
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

          {/* Chart canvas (Grid Layout) */}
          <div className="rounded-3xl border border-slate-100 bg-white shadow-sm px-2 md:px-6 py-6 md:py-8 flex flex-col items-center justify-center overflow-hidden">
            <div className={`flex flex-col gap-6 md:gap-8 w-full ${wide ? "max-w-none" : "max-w-3xl"} items-center relative`}>
               
               {/* Global cross dividers for the entire grid */}
               <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-l-2 border-slate-100/80 z-0"></div>
               
               {/* Upper Arch (Buccal Row) */}
               <div ref={upperRowRef} className="flex w-full justify-center relative z-10 pb-2">
                 {perioMode && (
                   <PerioOverlay arch={[...(isPrimary ? ChildQ1 : Q1), ...(isPrimary ? ChildQ2 : Q2)]} data={data} isUpper={true} containerRef={upperRowRef} />
                 )}
                 <div className="flex flex-row w-full justify-center gap-0.5 md:gap-1 px-1 md:px-2">
                   <div className="flex justify-end gap-0 w-full">
                     { (isPrimary ? ChildQ1 : Q1).map((id, index) => (
                        <div key={`u-buc-${id}`} style={{ transform: `translateY(${(isPrimary ? 5 - index : 8 - index) * 3}px)` }}>
                          {renderTooth(id, "buccal")}
                        </div>
                     )) }
                   </div>
                   <div className="w-1 md:w-2 shrink-0" />
                   <div className="flex justify-start gap-0 w-full">
                     { (isPrimary ? ChildQ2 : Q2).map((id, index) => (
                        <div key={`u-buc-${id}`} style={{ transform: `translateY(${(index + 1) * 3}px)` }}>
                          {renderTooth(id, "buccal")}
                        </div>
                     )) }
                   </div>
                 </div>
               </div>



               {/* Center Numbers / Divider Area */}
               <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex items-center justify-center z-0 gap-2">
                 <div className="flex-1 border-t-2 border-slate-100/80"></div>
                 {selectionMode && onSelectArch && (
                   <div className="flex gap-2">
                     <button
                       type="button"
                       onClick={(e) => { e.stopPropagation(); onSelectArch("upper"); }}
                       className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200 transition-colors"
                     >
                       {language === "ar" ? "تحديد الفك العلوي" : "Select Upper Arch"}
                     </button>
                     <button
                       type="button"
                       onClick={(e) => { e.stopPropagation(); onSelectArch("lower"); }}
                       className="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200 transition-colors"
                     >
                       {language === "ar" ? "تحديد الفك السفلي" : "Select Lower Arch"}
                     </button>
                   </div>
                 )}
                 <div className="flex-1 border-t-2 border-slate-100/80"></div>
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-l-2 border-slate-100/80 h-full"></div>
               </div>



               {/* Lower Arch (Buccal Row) */}
               <div ref={lowerRowRef} className="flex w-full justify-center relative z-10 pt-2">
                 {perioMode && (
                   <PerioOverlay arch={[...(isPrimary ? ChildQ4 : Q4), ...(isPrimary ? ChildQ3 : Q3)]} data={data} isUpper={false} containerRef={lowerRowRef} />
                 )}
                 <div className="flex flex-row w-full justify-center gap-0.5 md:gap-1 px-1 md:px-2">
                   <div className="flex justify-end gap-0 w-full">
                     { (isPrimary ? ChildQ4 : Q4).map((id, index) => (
                        <div key={`l-buc-${id}`} style={{ transform: `translateY(-${(isPrimary ? 5 - index : 8 - index) * 3}px)` }}>
                          {renderTooth(id, "buccal")}
                        </div>
                     )) }
                   </div>
                   <div className="w-1 md:w-2 shrink-0" />
                   <div className="flex justify-start gap-0 w-full">
                     { (isPrimary ? ChildQ3 : Q3).map((id, index) => (
                        <div key={`l-buc-${id}`} style={{ transform: `translateY(-${(index + 1) * 3}px)` }}>
                          {renderTooth(id, "buccal")}
                        </div>
                     )) }
                   </div>
                 </div>
               </div>

            </div>
          </div>

        </div>
      </div>
      </div>

      {/* Legend — outside the scroll area so it stays put while the teeth scroll */}
      {!compactMode && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 pt-4 border-t border-slate-100 px-2 mt-4 text-[10px] md:text-xs max-w-5xl mx-auto">
          {DIAGNOSIS_CATEGORIES.filter(c => c.id !== "healthy").map(cat => (
            <div key={cat.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-slate-500 font-medium">{language === "ar" ? cat.labelAr : cat.labelEn}</span>
            </div>
          ))}
        </div>
      )}

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
                          <React.Fragment key={opt.id}>
                            <button
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
                            
                            {/* Surface Selector for active diagnoses */}
                            {isSelected && (
                              <div className="md:col-span-1 md:col-start-2 bg-slate-50 border-2 border-slate-200 border-t-0 -mt-3 pt-4 pb-2 px-3 rounded-b-xl flex items-center justify-between gap-1 mb-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{language === "ar" ? "الأسطح" : "Surfaces"}</span>
                                <div className="flex items-center gap-1">
                                  {(["M", "O", "D", "B", "L"] as ToothSurface[]).map(surf => {
                                    const isActive = (draftSurfaces[opt.id] || []).includes(surf);
                                    return (
                                      <button
                                        key={surf}
                                        type="button"
                                        onClick={() => toggleSurface(opt.id, surf)}
                                        className={`w-7 h-7 rounded-md text-xs font-bold transition-all ${
                                          isActive 
                                            ? "bg-blue-600 text-white shadow-sm" 
                                            : "bg-white text-slate-500 border border-slate-200 hover:border-blue-300"
                                        }`}
                                      >
                                        {surf}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </React.Fragment>
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
