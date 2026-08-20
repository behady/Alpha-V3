"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import { X, Download, Loader2, Smartphone, Square } from "lucide-react";
import { Great_Vibes } from "next/font/google";
import { auth } from "@/lib/firebase";
import type { MarketingCase } from "@/components/marketing/CasesTab";

/**
 * The before/after composer — built to match the reference posts the user collected from
 * real clinic pages: two full-bleed photos stacked vertically, and at the seam only the
 * clinic's logo and (optionally) the dentist's name in a handwritten script. Nothing else —
 * no labels, no captions, no frames. The transformation IS the design.
 *
 * Photos arrive through our own API as data URLs (see the GET in api/marketing/cases), so
 * the export canvas never touches a cross-origin image and always rasterizes cleanly.
 */

const script = Great_Vibes({ subsets: ["latin"], weight: "400" });

type Format = "square" | "story";
const FORMATS: Record<Format, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

const DENTIST_NAME_KEY = "alphaMarketingDentistName";

export default function CaseComposer({
  caseItem,
  clinicId,
  clinicName,
  logoUrl,
  isAr,
  onClose,
}: {
  caseItem: MarketingCase;
  clinicId: string;
  clinicName: string;
  logoUrl: string;
  isAr: boolean;
  onClose: () => void;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalTarget(document.body), []);

  /* ------- load the photos (and logo) as data URLs ------- */

  const [beforeData, setBeforeData] = useState("");
  const [afterData, setAfterData] = useState("");
  const [logoData, setLogoData] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const toDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(blob);
      });

    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const fetchCase = async (path?: string, fallbackUrl?: string) => {
          if (path) {
            const res = await fetch(
              `/api/marketing/cases?c=${encodeURIComponent(clinicId)}&path=${encodeURIComponent(path)}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (res.ok) return toDataUrl(await res.blob());
          }
          // Old cases without stored paths: try the signed URL directly (may still work for preview).
          if (fallbackUrl) {
            const res = await fetch(fallbackUrl).catch(() => null);
            if (res?.ok) return toDataUrl(await res.blob());
          }
          throw new Error("photo");
        };

        const [b, a] = await Promise.all([
          fetchCase((caseItem as { beforePath?: string }).beforePath, caseItem.beforeUrl),
          fetchCase((caseItem as { afterPath?: string }).afterPath, caseItem.afterUrl),
        ]);
        if (cancelled) return;
        setBeforeData(b);
        setAfterData(a);
      } catch {
        if (!cancelled) setLoadError(isAr ? "تعذر تحميل صور الحالة" : "Could not load the case photos");
      }

      // Brand Kit logos are already data URLs — use directly. External URLs are best-effort:
      // a host that blocks reading simply means the clinic name takes the logo's place.
      if (logoUrl.startsWith("data:")) {
        if (!cancelled) setLogoData(logoUrl);
      } else if (logoUrl) {
        try {
          const res = await fetch(logoUrl);
          if (res.ok) {
            const d = await toDataUrl(await res.blob());
            if (!cancelled) setLogoData(d);
          }
        } catch {
          /* clinic name text takes its place */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseItem.id]);

  /* ------- options ------- */

  const [format, setFormat] = useState<Format>("square");
  const [dentistName, setDentistName] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [beforeFocus, setBeforeFocus] = useState(50);
  const [afterFocus, setAfterFocus] = useState(50);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      setDentistName(localStorage.getItem(DENTIST_NAME_KEY) || "");
    } catch {
      /* fresh field */
    }
  }, []);

  const rememberDentist = (v: string) => {
    setDentistName(v);
    try {
      localStorage.setItem(DENTIST_NAME_KEY, v);
    } catch {
      /* not persisted — still works this session */
    }
  };

  const download = async () => {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const { w, h } = FORMATS[format];
      const dataUrl = await toPng(exportRef.current, { width: w, height: h, pixelRatio: 1, cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${caseItem.procedure.replace(/[^\w؀-ۿ-]+/g, "_").slice(0, 50)}_${format}.png`;
      a.click();
    } catch (e) {
      console.error("Case export failed", e);
      setLoadError(isAr ? "فشل التصدير — جرّب مرة أخرى" : "Export failed — try again");
    } finally {
      setExporting(false);
    }
  };

  /* ------- the artboard: the reference design ------- */

  const Artboard = ({ w, h }: { w: number; h: number }) => (
    <div style={{ width: w, height: h, position: "relative", overflow: "hidden", background: "#000" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={beforeData}
        alt=""
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "50%", objectFit: "cover", objectPosition: `50% ${beforeFocus}%` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterData}
        alt=""
        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "50%", objectFit: "cover", objectPosition: `50% ${afterFocus}%` }}
      />

      {/* The seam, matched to the user's annotated design:
          — the logo sits across the exact middle on the left,
          — a THIN LINE runs along the seam from just after the logo to a few mm short of the
            right edge,
          — the dentist's name rests ON that line (text above, line under it), at the seam. */}
      {(() => {
        const padX = w * 0.055;
        const logoSize = w * 0.2;
        const hasLogo = showLogo && !!logoData;
        const leftBlockEnd = padX + (hasLogo ? logoSize : w * 0.3) + w * 0.03;
        const lineThickness = Math.max(2, w * 0.003);
        return (
          <>
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoData}
                alt=""
                style={{
                  position: "absolute",
                  left: padX,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: logoSize,
                  height: logoSize,
                  objectFit: "contain",
                  filter: "drop-shadow(0 3px 14px rgba(0,0,0,0.6))",
                }}
              />
            ) : (
              <span
                style={{
                  position: "absolute",
                  left: padX,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#fff",
                  fontSize: w * 0.04,
                  fontWeight: 800,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                  textAlign: "center",
                  lineHeight: 1.3,
                  maxWidth: w * 0.3,
                  textShadow: "0 2px 14px rgba(0,0,0,0.8)",
                }}
              >
                {clinicName}
              </span>
            )}

            {/* The seam line — from after the logo to a few mm short of the edge. */}
            <div
              style={{
                position: "absolute",
                left: leftBlockEnd,
                right: w * 0.045,
                top: "50%",
                transform: "translateY(-50%)",
                height: lineThickness,
                background: "rgba(255,255,255,0.92)",
                boxShadow: "0 1px 8px rgba(0,0,0,0.55)",
              }}
            />

            {/* The name stands ON the line, at the seam. */}
            {dentistName.trim() && (
              <span
                className={/[؀-ۿ]/.test(dentistName) ? undefined : script.className}
                style={{
                  position: "absolute",
                  left: leftBlockEnd + w * 0.02,
                  bottom: `calc(50% + ${lineThickness}px)`,
                  color: "#fff",
                  fontSize: /[؀-ۿ]/.test(dentistName) ? w * 0.05 : w * 0.068,
                  fontWeight: /[؀-ۿ]/.test(dentistName) ? 700 : 400,
                  lineHeight: 1.05,
                  textShadow: "0 2px 14px rgba(0,0,0,0.8)",
                  whiteSpace: "nowrap",
                  paddingBottom: w * 0.006,
                }}
              >
                {dentistName}
              </span>
            )}
          </>
        );
      })()}
    </div>
  );

  const { w, h } = FORMATS[format];
  const previewWidth = 330;
  const scale = previewWidth / w;
  const ready = beforeData && afterData;

  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[330] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-900">{isAr ? "تصميم قبل / بعد" : "Before / after design"}</h3>
            <p className="text-[11px] font-bold text-slate-400" dir="auto">{caseItem.procedure} · {caseItem.patientName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-[1fr_350px] gap-5">
          {/* Controls */}
          <div className="space-y-4 min-w-0">
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5">{isAr ? "المقاس" : "Format"}</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setFormat("square")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-black transition-colors ${
                    format === "square" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
                  }`}
                >
                  <Square size={13} /> {isAr ? "مربع (بوست)" : "Square (feed)"}
                </button>
                <button
                  onClick={() => setFormat("story")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-black transition-colors ${
                    format === "story" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
                  }`}
                >
                  <Smartphone size={13} /> {isAr ? "طولي (ستوري/ريلز)" : "Story (9:16)"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5">
                {isAr ? "اسم الطبيب (اختياري — يظهر بخط اليد)" : "Dentist name (optional — shown in script)"}
              </label>
              <input
                value={dentistName}
                onChange={(e) => rememberDentist(e.target.value)}
                dir="auto"
                maxLength={60}
                placeholder={isAr ? "مثال: Dr Ahmed Tarek" : "e.g. Dr Ahmed Tarek"}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
              />
            </div>

            {logoData && (
              <button
                onClick={() => setShowLogo((v) => !v)}
                className={`px-3 py-2 rounded-xl border text-xs font-black transition-colors ${
                  showLogo ? "bg-white text-slate-700 border-slate-300" : "bg-slate-100 text-slate-400 border-slate-200"
                }`}
              >
                {showLogo ? (isAr ? "اللوجو ظاهر" : "Logo on") : isAr ? "اللوجو مخفي — اسم العيادة بدلاً منه" : "Logo off — clinic name instead"}
              </button>
            )}

            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5">
                {isAr ? "ضبط قصّ صورة «قبل»" : "Adjust the BEFORE crop"}
              </label>
              <input type="range" min={0} max={100} value={beforeFocus} onChange={(e) => setBeforeFocus(Number(e.target.value))} className="w-full accent-emerald-500" />
              <label className="block text-xs font-black text-slate-500 mb-1.5 mt-2">
                {isAr ? "ضبط قصّ صورة «بعد»" : "Adjust the AFTER crop"}
              </label>
              <input type="range" min={0} max={100} value={afterFocus} onChange={(e) => setAfterFocus(Number(e.target.value))} className="w-full accent-emerald-500" />
            </div>

            {loadError && <p className="text-xs font-bold text-rose-600">{loadError}</p>}

            <button
              onClick={() => void download()}
              disabled={exporting || !ready}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {exporting ? (isAr ? "جارٍ التصدير…" : "Exporting…") : isAr ? "تحميل الصورة (PNG)" : "Download image (PNG)"}
            </button>
          </div>

          {/* Preview */}
          <div className="flex items-start justify-center">
            {ready ? (
              <div className="rounded-2xl border border-slate-200 shadow-lg overflow-hidden shrink-0" style={{ width: previewWidth, height: h * scale }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: w, height: h }}>
                  <Artboard w={w} h={h} />
                </div>
              </div>
            ) : (
              <div className="w-[330px] h-[330px] rounded-2xl border border-dashed border-slate-300 flex items-center justify-center">
                {loadError ? <X className="text-rose-300" /> : <Loader2 className="animate-spin text-slate-300" />}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden full-size artboard for export */}
      {ready && (
        <div style={{ position: "fixed", top: 0, left: -13000, pointerEvents: "none" }} aria-hidden="true">
          <div ref={exportRef}>
            <Artboard w={w} h={h} />
          </div>
        </div>
      )}
    </div>,
    portalTarget
  );
}
